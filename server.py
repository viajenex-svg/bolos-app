#!/usr/bin/env python3
"""
Delícias do Aleff — servidor do app (PWA) + painel administrativo.

  http://<ip>:8001/         → app de delivery
  http://<ip>:8001/painel   → painel (PIN)
  http://<ip>:8001/api/...  → API

Só usa a biblioteca padrão. PIL é opcional (regenera ícones ao trocar o logo).
"""

import base64
import hmac
import json
import math
import os
import re
import smtplib
import threading
import time
import urllib.error
import urllib.request
import uuid
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None

# Web Push é opcional: no Termux (sem as libs) o app funciona, só sem avisos.
try:
    from pywebpush import webpush as _webpush, WebPushException as _WebPushException
except Exception:  # pragma: no cover
    _webpush = None

    class _WebPushException(Exception):
        pass

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE, 'data.json')
UPLOAD_DIR = os.path.join(BASE, 'uploads')
ICON_DIR = os.path.join(BASE, 'icons')
PIN = os.environ.get('SC_PIN', '1234')   # PIN inicial de um banco novo; o atual fica no banco
PORT = int(os.environ.get('SC_PORT') or os.environ.get('PORT') or '8002')
LOCK = threading.RLock()

# envio do PIN por e-mail ("Esqueci o PIN" no painel). Configure no servidor:
#   SMTP_HOST, SMTP_PORT (587/465), SMTP_USER, SMTP_PASS, SMTP_FROM (opcional)
# SMTP_SECURE=1 usa SSL direto (porta 465); senão STARTTLS.
SMTP_HOST = os.environ.get('SMTP_HOST', '').strip()
SMTP_PORT = int(os.environ.get('SMTP_PORT') or '587')
SMTP_USER = os.environ.get('SMTP_USER', '').strip()
SMTP_PASS = os.environ.get('SMTP_PASS', '')
SMTP_FROM = os.environ.get('SMTP_FROM', '').strip() or SMTP_USER
SMTP_SECURE = os.environ.get('SMTP_SECURE', '').strip().lower() in ('1', 'true', 'sim')

MAX_BODY = 8 * 1024 * 1024      # 8 MB
MAX_UPLOAD = 4 * 1024 * 1024    # 4 MB de imagem

# notificações push (avisos de "a caminho" e "entregue" com o app fechado)
PUSH_TTL = 3600                 # push válido por 1 h na fila do serviço
PUSH_MAX_SUBS = 5               # aparelhos por pedido
_BROADCAST_MAX = 2000           # aparelhos que recebem avisos da loja
PUSH_CONTACT = (os.environ.get('PUSH_CONTACT', '').strip()
                or 'mailto:contato@deliciasdoaleff.com')

# --- persistência -------------------------------------------------------
# Sem DATABASE_URL (Termux) usa data.json + uploads/ como sempre.
# Com DATABASE_URL (Render + Neon) guarda o estado e as fotos no Postgres.
DB_URL = os.environ.get('DATABASE_URL', '').strip()
DB_MODE = bool(DB_URL)
SEED_PATH = os.path.join(BASE, 'data.seed.json')
_db_local = threading.local()

# geocodificação (ViaCEP + Nominatim) — tudo grátis, sem chave
GEO_UA = 'DeliciasDoAleffDelivery/1.0 (app local)'
GEO_TIMEOUT = 4
GEO_TTL = 30 * 86400            # cache positivo: 30 dias
GEO_FAIL_TTL = 3600             # cache negativo: 1 h
GEO_MIN_INTERVAL = 1.1          # 1 req/s no Nominatim (política do serviço)
GEO_CACHE_PATH = os.path.join(BASE, 'geo-cache.json')
GEO_LOCK = threading.RLock()    # cache em memória/disco
GEO_RATE = threading.Lock()     # serializa chamadas ao Nominatim
_geo_cache = None
_geo_last = [0.0]
_geo_hits = {}

# rastreio do motoboy — arquivo separado: ping de GPS não regrava o data.json
TRACK_PATH = os.path.join(BASE, 'tracking.json')
TRACK_LOCK = threading.RLock()
TRACK_TTL = 3600                 # entrega encerrada fica 1 h no arquivo
TRACK_STALE = 45                 # sem ping por 45 s = "sem sinal"
TRACK_KEEP = 300                 # mesmo limite de pedidos guardados
ROUTE_FAIL_TTL = 600             # rota falhou: tenta de novo em 10 min
OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/%f,%f;%f,%f'
_track_mem = None
_route_locks = {}

DEFAULT_DELIVERY = {
    'mode': 'fixed',            # 'fixed' (taxa da loja) | 'km' (base + por km)
    'base': 3.0,
    'perKm': 2.0,
    'minFee': 6.9,
    'maxKm': 0.0,               # 0 = sem limite
    'roadFactor': 1.3,          # linha reta → estrada
}

DEFAULT_BANNERS = [
    {'tag': 'Feito no dia', 'title': 'BOLOS', 'off': 'CASEIROS',
     'sub': 'encomende o seu', 'btn': 'Pedir agora',
     'img': 'img/banner-bolos.webp', 'active': True, 'price': 0},
]

BANNER_FIELDS = (('tag', 24), ('title', 40), ('off', 20), ('sub', 60),
                 ('btn', 24), ('img', 200), ('pname', 60))

# anúncio em pop-up mostrado ao cliente (configurado no painel)
DEFAULT_POPUP = {
    'active': False, 'title': '', 'text': '', 'img': '', 'btn': '',
    'goto': 'all', 'freq': 'day',
}
POPUP_FIELDS = (('title', 40), ('text', 120), ('img', 200), ('btn', 24))
# categorias do cardápio (editáveis no painel: criar, renomear e excluir)
DEFAULT_CATS = [
    {'id': 'bolos', 'label': 'Bolos', 'short': ''},
    {'id': 'fatias', 'label': 'Fatias', 'short': ''},
    {'id': 'tortas', 'label': 'Tortas', 'short': ''},
    {'id': 'doces', 'label': 'Docinhos', 'short': 'Doces'},
    {'id': 'kits', 'label': 'Kits festa', 'short': 'Kits'},
    {'id': 'bebidas', 'label': 'Bebidas', 'short': ''},
]

DEFAULT_EXTRAS = [
    {'id': 'vela', 'label': 'Vela de aniversário', 'price': 0.0},
    {'id': 'choco', 'label': 'Chocolate extra', 'price': 8.0},
    {'id': 'morango', 'label': 'Morangos frescos', 'price': 12.0},
    {'id': 'cartao', 'label': 'Cartãozinho', 'price': 0.0},
    {'id': 'presente', 'label': 'Embalagem de presente', 'price': 5.0},
    {'id': 'talheres', 'label': 'Talheres e guardanapos', 'price': 0.0},
    {'id': 'sache', 'label': 'Sachês (açúcar/adoçante)', 'price': 0.0},
]

# tamanhos do produto (acréscimo no preço)
DEFAULT_SIZES = [
    {'id': 'p', 'label': 'Pequeno · 12 fatias', 'extra': 0.0},
    {'id': 'm', 'label': 'Médio · 20 fatias', 'extra': 40.0},
    {'id': 'g', 'label': 'Grande · 30 fatias', 'extra': 80.0},
]

# horário de funcionamento: índice 0 = domingo ... 6 = sábado
DAY_NAMES = ('Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado')
DEFAULT_SCHEDULE = [
    {'closed': True,  'from': '09:00', 'to': '19:00'},   # dom
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # seg
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # ter
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # qua
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # qui
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # sex
    {'closed': False, 'from': '09:00', 'to': '19:00'},   # sáb
]


def _hm(v):
    """'18:30' -> minutos desde a meia-noite (None se inválido)."""
    m = re.match(r'^\s*(\d{1,2}):(\d{2})\s*$', str(v or ''))
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return h * 60 + mi


def _fmt_hm(minutes):
    return '%02d:%02d' % (minutes // 60, minutes % 60)


def _nice_hm(hm):
    h, m = hm.split(':')
    return h + 'h' + (m if m != '00' else '')


def schedule_cfg(st):
    raw = st.get('schedule')
    out = []
    for i in range(7):
        d = raw[i] if isinstance(raw, list) and i < len(raw) and isinstance(raw[i], dict) else {}
        base = DEFAULT_SCHEDULE[i]
        f = _hm(d.get('from'))
        t = _hm(d.get('to'))
        out.append({'closed': bool(d['closed']) if 'closed' in d else base['closed'],
                    'from': _fmt_hm(f if f is not None else _hm(base['from'])),
                    'to': _fmt_hm(t if t is not None else _hm(base['to']))})
    return out


def is_open_now(st):
    if not st.get('hoursAuto'):
        return bool(st.get('open', True))
    sched = schedule_cfg(st)
    tm = time.localtime()
    now = tm.tm_hour * 60 + tm.tm_min
    today = (tm.tm_wday + 1) % 7          # Python: segunda = 0 → domingo = 0
    yesterday = (today - 1) % 7
    d = sched[today]
    if not d['closed']:
        f, t = _hm(d['from']), _hm(d['to'])
        if f < t and f <= now < t:
            return True
        if f > t and now >= f:            # fecha depois da meia-noite
            return True
    y = sched[yesterday]
    if not y['closed']:
        f, t = _hm(y['from']), _hm(y['to'])
        if f > t and now < t:             # madrugada que pertence ao dia anterior
            return True
    return False


def hours_text(st):
    if not st.get('hoursAuto'):
        return str(st.get('hours') or '')
    sched = schedule_cfg(st)
    parts = []
    i = 0
    while i < 7:
        d = sched[i]
        j = i
        while j + 1 < 7:
            n = sched[j + 1]
            if n['closed'] != d['closed']:
                break
            if not d['closed'] and (n['from'], n['to']) != (d['from'], d['to']):
                break
            j += 1
        label = DAY_NAMES[i] if i == j else '%s a %s' % (DAY_NAMES[i], DAY_NAMES[j])
        if d['closed']:
            parts.append('%s fechado' % label)
        else:
            parts.append('%s, %s às %s' % (label, _nice_hm(d['from']), _nice_hm(d['to'])))
        i = j + 1
    return ' · '.join(parts)

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
}

PUBLIC_FILES_DENY = {'data.json', 'data.seed.json', 'server.py', 'geo-cache.json', 'tracking.json'}

DEFAULT = {
    'store': {
        'name': 'Delícias do Aleff · Bolos',
        'tagline': 'Bolos caseiros, feitos no dia.',
        'logo': 'img/logo-bolos-mark.png',
        'fee': 6.9,
        'minOrder': 20.0,
        'whatsapp': '5511999999999',
        'open': True,
        'hours': 'Seg a Sáb, 9h às 19h',
        'hoursAuto': False,
        'schedule': [dict(d) for d in DEFAULT_SCHEDULE],
        'address': 'Rua das Brasas, 128 — Centro',
        'originCep': '',
        'originLat': None,
        'originLon': None,
        'delivery': dict(DEFAULT_DELIVERY),
        'banners': [dict(b) for b in DEFAULT_BANNERS],
        'popup': dict(DEFAULT_POPUP),
        'extras': [dict(e) for e in DEFAULT_EXTRAS],
        'sizes': [dict(s) for s in DEFAULT_SIZES],
        'categories': [dict(c) for c in DEFAULT_CATS],
        'coupons': {'BOLO10': 0.10, 'FESTA15': 0.15},
    },
    'products': [
        {'id': 'bolo-choco', 'name': 'Bolo de Chocolate', 'cat': 'bolos', 'price': 89.9,
         'rating': 4.9, 'time': 'Encomenda · 1 dia', 'kcal': 0, 'tag': 'Mais pedido',
         'img': 'img/bolo-chocolate.webp', 'active': True, 'stock': 10,
         'sizes': ['p', 'm', 'g'],
         'desc': 'Massa de cacau 50% com recheio de brigadeiro cremoso e ganache por cima. Feito no dia da entrega.'},
        {'id': 'bolo-morango', 'name': 'Bolo de Morango', 'cat': 'bolos', 'price': 95.0,
         'rating': 4.9, 'time': 'Encomenda · 1 dia', 'kcal': 0, 'tag': 'Da casa',
         'img': 'img/bolo-morango.webp', 'active': True, 'stock': 8,
         'sizes': ['p', 'm', 'g'],
         'desc': 'Pão de ló fofinho, chantilly fresco e morangos picados entre as camadas. Leve e cremoso.'},
        {'id': 'bolo-cenoura', 'name': 'Bolo de Cenoura', 'cat': 'bolos', 'price': 69.9,
         'rating': 4.8, 'time': 'Encomenda · 1 dia', 'kcal': 0, 'tag': '',
         'img': 'img/bolo-cenoura.webp', 'active': True, 'stock': 12,
         'sizes': ['p', 'm', 'g'],
         'desc': 'Bolo de cenoura com pedaços, coberto com calda de chocolate meio amargo. O clássico da casa.'},
        {'id': 'redvelvet', 'name': 'Red Velvet', 'cat': 'bolos', 'price': 105.0,
         'rating': 5.0, 'time': 'Encomenda · 1 dia', 'kcal': 0, 'tag': 'Especial',
         'img': 'img/bolo-redvelvet.webp', 'active': True, 'stock': 6,
         'sizes': ['p', 'm', 'g'],
         'desc': 'Massa vermelha de cacau com cream cheese frosting e raspas de limão. Para ocasiões especiais.'},
        {'id': 'fatia-choco', 'name': 'Fatia de Chocolate', 'cat': 'fatias', 'price': 14.9,
         'rating': 4.9, 'time': '30–40 min', 'kcal': 380, 'tag': 'Quentinho',
         'img': 'img/fatia-chocolate.webp', 'active': True, 'stock': None,
         'sizes': [],
         'desc': 'Fatia generosa do bolo de chocolate com brigadeiro e ganache. Servida gelada.'},
        {'id': 'fatia-morango', 'name': 'Fatia de Morango', 'cat': 'fatias', 'price': 16.9,
         'rating': 4.8, 'time': '30–40 min', 'kcal': 360, 'tag': '',
         'img': 'img/fatia-morango.webp', 'active': True, 'stock': None,
         'sizes': [],
         'desc': 'Pão de ló, chantilly e morangos frescos em camadas. Doce na medida.'},
        {'id': 'torta-limao', 'name': 'Torta de Limão', 'cat': 'tortas', 'price': 18.9,
         'rating': 4.8, 'time': '30–40 min', 'kcal': 340, 'tag': '',
         'img': 'img/torta-limao.webp', 'active': True, 'stock': None,
         'sizes': [],
         'desc': 'Base de biscoito, creme de limão siciliano e merengue maçaricado. Azedinho do jeito certo.'},
        {'id': 'torta-maracuja', 'name': 'Torta de Maracujá', 'cat': 'tortas', 'price': 18.9,
         'rating': 4.7, 'time': '30–40 min', 'kcal': 350, 'tag': '',
         'img': 'img/torta-maracuja.webp', 'active': True, 'stock': None,
         'sizes': [],
         'desc': 'Creme de maracujá com calda de sementes e base de biscoito. Refrescante.'},
        {'id': 'brigadeiro', 'name': 'Brigadeiro Gourmet (6)', 'cat': 'doces', 'price': 18.0,
         'rating': 5.0, 'time': '30–40 min', 'kcal': 420, 'tag': 'Mais pedido',
         'img': 'img/docinhos.webp', 'active': True, 'stock': None,
         'desc': 'Seis brigadeiros de chocolate nobre enrolados à mão, com granulado belga.'},
        {'id': 'beijinho', 'name': 'Beijinho (6)', 'cat': 'doces', 'price': 16.0,
         'rating': 4.8, 'time': '30–40 min', 'kcal': 400, 'tag': '',
         'img': 'img/docinhos.webp', 'active': True, 'stock': None,
         'desc': 'Seis beijinhos de coco com cravo. Docinhos de festa feitos na casa.'},
        {'id': 'kit-festa', 'name': 'Kit Festa 20 pessoas', 'cat': 'kits', 'price': 249.0,
         'rating': 4.9, 'time': 'Encomenda · 2 dias', 'kcal': 0, 'tag': 'Festa',
         'img': 'img/kit-festa.webp', 'active': True, 'stock': 5,
         'sizes': [],
         'desc': 'Bolo médio, 40 docinhos sortidos, pratos, talheres e velas. Encomende com 2 dias.'},
        {'id': 'cafe', 'name': 'Café Coado 300 ml', 'cat': 'bebidas', 'price': 6.9,
         'rating': 4.7, 'time': '20–30 min', 'kcal': 90, 'tag': '',
         'img': 'img/bebida.webp', 'active': True, 'stock': None,
         'extras': [], 'sizes': [],
         'desc': 'Café coado na hora, torra média. Vem quente em copo térmico.'},
        {'id': 'refri', 'name': 'Refrigerante lata', 'cat': 'bebidas', 'price': 6.0,
         'rating': 4.5, 'time': '20–30 min', 'kcal': 140, 'tag': '',
         'img': 'img/bebida.webp', 'active': True, 'stock': None,
         'extras': [], 'sizes': [],
         'desc': 'Lata de 350 ml bem gelada — cola, guaraná ou laranja. Avise o sabor na observação.'},
    ],
    'orders': [],
}


# ----------------------------------------------------------------- dados

def db_execute(sql, params=()):
    """Executa SQL no Neon/Postgres com uma conexão por thread.

    O Neon suspende o compute quando fica ocioso; se a conexão cair, ela é
    descartada e a consulta é repetida uma vez com conexão nova.
    """
    import psycopg
    conn = None
    for attempt in (1, 2):
        try:
            conn = getattr(_db_local, 'conn', None)
            if conn is None or conn.closed:
                conn = psycopg.connect(DB_URL, connect_timeout=10,
                                       autocommit=True, prepare_threshold=None)
                _db_local.conn = conn
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    return cur.fetchall()
                return None
        except Exception:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            _db_local.conn = None
            conn = None
            if attempt == 2:
                raise


def _seed_data():
    """Estado inicial do banco: data.seed.json (sem pedidos) ou o DEFAULT."""
    if os.path.exists(SEED_PATH):
        try:
            with open(SEED_PATH, encoding='utf-8') as f:
                seed = json.load(f)
            seed['orders'] = []
            return seed
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT))


def db_init():
    """Cria as tabelas e grava o catálogo inicial, se o banco estiver vazio."""
    if not DB_MODE:
        return
    db_execute('''CREATE TABLE IF NOT EXISTS app_state (
        id integer PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())''')
    db_execute('''CREATE TABLE IF NOT EXISTS uploads (
        name text PRIMARY KEY,
        mime text NOT NULL,
        content bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now())''')
    if not db_execute('SELECT 1 FROM app_state WHERE id = 1'):
        seed = _seed_data()
        db_execute('INSERT INTO app_state (id, data) VALUES (1, %s::jsonb)',
                   (json.dumps(seed, ensure_ascii=False),))
        print('  Neon ...... catálogo inicial gravado')
    n = _seed_uploads()
    if n:
        print('  Neon ...... %d foto(s) de uploads/ importada(s)' % n)


def _seed_uploads():
    """Primeira subida: leva as fotos da pasta uploads/ para o banco."""
    rows = db_execute('SELECT count(*) FROM uploads')
    if rows and rows[0][0]:
        return 0
    if not os.path.isdir(UPLOAD_DIR):
        return 0
    n = 0
    for name in sorted(os.listdir(UPLOAD_DIR)):
        full = os.path.join(UPLOAD_DIR, name)
        if name.startswith('.') or not os.path.isfile(full):
            continue
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        mime = {'webp': 'image/webp', 'png': 'image/png', 'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg', 'gif': 'image/gif'}.get(ext,
                'application/octet-stream')
        try:
            with open(full, 'rb') as f:
                db_put_upload(name, mime, f.read())
            n += 1
        except Exception as e:
            print('  aviso: upload %s não importado (%s)' % (name, e))
    return n


def db_put_upload(name, mime, content):
    db_execute('''INSERT INTO uploads (name, mime, content) VALUES (%s, %s, %s)
        ON CONFLICT (name) DO UPDATE
        SET mime = EXCLUDED.mime, content = EXCLUDED.content''',
               (name, mime, content))


def db_get_upload(name):
    rows = db_execute('SELECT mime, content FROM uploads WHERE name = %s', (name,))
    if not rows:
        return None
    return rows[0][0], bytes(rows[0][1])


def save(data):
    with LOCK:
        if DB_MODE:
            db_execute('''INSERT INTO app_state (id, data, updated_at)
                VALUES (1, %s::jsonb, now())
                ON CONFLICT (id) DO UPDATE
                SET data = EXCLUDED.data, updated_at = now()''',
                       (json.dumps(data, ensure_ascii=False),))
            return
        tmp = DATA_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_PATH)


def load():
    with LOCK:
        if DB_MODE:
            rows = db_execute('SELECT data FROM app_state WHERE id = 1')
            if rows:
                data = rows[0][0]
            else:
                data = json.loads(json.dumps(DEFAULT))
                save(data)
        else:
            if not os.path.exists(DATA_PATH):
                save(DEFAULT)
            try:
                with open(DATA_PATH, encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                data = json.loads(json.dumps(DEFAULT))
        data.setdefault('store', {})
        data.setdefault('admin', {})       # PIN atual e ajustes de segurança
        data.setdefault('products', [])
        data.setdefault('orders', [])
        data.setdefault('admin_push_subs', [])   # aparelhos do painel avisados de pedidos novos
        data.setdefault('broadcast_subs', [])    # aparelhos de clientes que aceitaram avisos
        data.setdefault('broadcast_log', [])     # últimos avisos enviados pelo painel
        return data


# --- PIN do painel ------------------------------------------------------
# O PIN fica no banco (data['admin']['pin']) e pode ser trocado pelo painel
# sem reiniciar. SC_PIN só vale como valor inicial quando o banco ainda não
# tem PIN gravado.
_PIN_STATE = {'pin': None, 'ts': 0.0}
_PIN_STATE_LOCK = threading.Lock()
_PIN_TTL = 60                   # relê do banco a cada 1 min (Fly e Render dividem o banco)


def current_pin():
    with _PIN_STATE_LOCK:
        now = time.time()
        if _PIN_STATE['pin'] is None or now - _PIN_STATE['ts'] > _PIN_TTL:
            try:
                pin = str((load().get('admin') or {}).get('pin') or '') or PIN
            except Exception:
                pin = _PIN_STATE['pin'] or PIN
            _PIN_STATE['pin'] = pin
            _PIN_STATE['ts'] = now
        return _PIN_STATE['pin']


def set_pin(new):
    data = load()
    data.setdefault('admin', {})['pin'] = str(new)
    save(data)
    with _PIN_STATE_LOCK:
        _PIN_STATE['pin'] = str(new)
        _PIN_STATE['ts'] = time.time()


def smtp_ready():
    return bool(SMTP_HOST and SMTP_FROM)


def send_mail(to, subject, text):
    """Envia e-mail simples pelo SMTP configurado. Levanta exceção se falhar."""
    if not smtp_ready():
        raise RuntimeError('SMTP não configurado')
    msg = EmailMessage()
    msg['From'] = SMTP_FROM
    msg['To'] = to
    msg['Subject'] = subject
    msg.set_content(text)
    cls = smtplib.SMTP_SSL if SMTP_SECURE else smtplib.SMTP
    with cls(SMTP_HOST, SMTP_PORT, timeout=20) as s:
        if not SMTP_SECURE:
            s.starttls()
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)


def public_menu(data):
    st = data.get('store', {})
    store = {k: st.get(k) for k in (
        'name', 'tagline', 'logo', 'fee', 'minOrder', 'whatsapp',
        'open', 'hours', 'address', 'coupons')}
    store['open'] = is_open_now(st)
    store['hours'] = hours_text(st)
    store['delivery'] = delivery_cfg(st)
    bans = banners_cfg(st)
    store['banners'] = [b for b in bans if b.get('active') is not False]
    store['popup'] = popup_cfg(st)
    store['extras'] = extras_cfg(st)
    store['sizes'] = sizes_cfg(st)
    store['categories'] = cats_cfg(st)
    products = []
    for p in data.get('products', []):
        if p.get('active') is False:
            continue
        products.append({k: p.get(k) for k in (
            'id', 'name', 'cat', 'price', 'rating', 'time', 'kcal', 'tag',
            'img', 'desc', 'stock', 'extras', 'sizes')})
    products.extend(banner_products(st, bans))
    store['popular'] = popular_ids(data, products)
    store['pixAuto'] = mp_public(data).get('on') is True
    return {'store': store, 'products': products, 'ts': int(time.time())}


# ----------------------------------------------------------------- geo/frete

def delivery_cfg(st):
    """Config de frete com defaults — data.json antigo continua válido."""
    cfg = dict(DEFAULT_DELIVERY)
    d = st.get('delivery') if isinstance(st, dict) else None
    if isinstance(d, dict):
        if d.get('mode') in ('fixed', 'km'):
            cfg['mode'] = d['mode']
        for k in ('base', 'perKm', 'minFee'):
            try:
                cfg[k] = max(0.0, round(float(d[k]), 2))
            except (KeyError, TypeError, ValueError):
                pass
        try:
            cfg['maxKm'] = max(0.0, min(100.0, round(float(d['maxKm']), 1)))
        except (KeyError, TypeError, ValueError):
            pass
        try:
            cfg['roadFactor'] = max(1.0, min(3.0, round(float(d['roadFactor']), 2)))
        except (KeyError, TypeError, ValueError):
            pass
    return cfg


def cats_cfg(st, raw=None):
    """Categorias do cardápio (id fixo, nome e abreviação editáveis)."""
    src = raw if isinstance(raw, list) else (st.get('categories') if isinstance(st, dict) else None)
    if not isinstance(src, list):
        return [dict(c) for c in DEFAULT_CATS]
    out = []
    for c in src[:12]:
        if not isinstance(c, dict):
            continue
        label = str(c.get('label') or '').strip()[:30]
        if not label:
            continue
        cid = slug(c.get('id') or label)[:24] or ('cat%d' % (len(out) + 1))
        taken = {x['id'] for x in out}
        base, n = cid, 2
        while cid in taken:
            cid = '%s-%d' % (base, n)
            n += 1
        icon = str(c.get('icon') or '').strip()[:8]
        out.append({'id': cid, 'label': label, 'short': str(c.get('short') or '').strip()[:12],
                    'icon': icon})
    return out


def extras_cfg(st, raw=None):
    """Adicionais do produto (nome + preço), editáveis no painel."""
    src = raw if isinstance(raw, list) else (st.get('extras') if isinstance(st, dict) else None)
    if not isinstance(src, list):
        return [dict(e) for e in DEFAULT_EXTRAS]
    out = []
    for e in src[:12]:
        if not isinstance(e, dict):
            continue
        label = str(e.get('label') or '').strip()[:30]
        if not label:
            continue
        eid = slug(e.get('id') or label)
        taken = {x['id'] for x in out}
        base, n = eid, 2
        while eid in taken:
            eid = '%s-%d' % (base, n)
            n += 1
        try:
            price = max(0.0, min(500.0, round(float(e.get('price') or 0), 2)))
        except (TypeError, ValueError):
            price = 0.0
        out.append({'id': eid, 'label': label, 'price': price})
    return out


def sizes_cfg(st, raw=None):
    """Tamanhos do produto (nome + acréscimo), editáveis no painel."""
    src = raw if isinstance(raw, list) else (st.get('sizes') if isinstance(st, dict) else None)
    if not isinstance(src, list):
        return [dict(s) for s in DEFAULT_SIZES]
    out = []
    for s in src[:6]:
        if not isinstance(s, dict):
            continue
        label = str(s.get('label') or '').strip()[:20]
        if not label:
            continue
        sid = slug(s.get('id') or label)
        taken = {x['id'] for x in out}
        base, n = sid, 2
        while sid in taken:
            sid = '%s-%d' % (base, n)
            n += 1
        try:
            extra = max(0.0, min(500.0, round(float(s.get('extra') or 0), 2)))
        except (TypeError, ValueError):
            extra = 0.0
        out.append({'id': sid, 'label': label, 'extra': extra})
    return out


def popular_cfg(st):
    """Ids fixados no painel para o bloco “Mais pedidos”, na ordem escolhida."""
    src = st.get('popular') if isinstance(st, dict) else None
    if not isinstance(src, list):
        return []
    out = []
    for pid in src[:20]:
        pid = str(pid or '').strip()[:40]
        if pid and pid not in out:
            out.append(pid)
    return out[:12]


def sales_rank(data):
    """Ids de produto ordenados por unidades vendidas (todos os pedidos)."""
    sold = {}
    for o in data.get('orders', []):
        for it in o.get('items') or []:
            pid = it.get('pid')
            if not pid:
                continue
            try:
                q = max(0, int(it.get('qty') or 0))
            except (TypeError, ValueError):
                q = 0
            sold[pid] = sold.get(pid, 0) + q
    return [pid for pid, _ in sorted(sold.items(), key=lambda kv: -kv[1])]


def popular_ids(data, products):
    """Fila do “Mais pedidos”: fixados no painel primeiro, resto pelos mais vendidos."""
    have = {p['id'] for p in products}
    out = [pid for pid in popular_cfg(data.get('store', {})) if pid in have]
    for pid in sales_rank(data):
        if pid in have and pid not in out:
            out.append(pid)
    for p in products:  # completa com o catálogo, para nunca faltar
        if p['id'] not in out:
            out.append(p['id'])
    return out


def banners_cfg(st, raw=None):
    """Lista de banners da home, sanitizada (data.json antigo cai no padrão)."""
    src = raw if isinstance(raw, list) else (st.get('banners') if isinstance(st, dict) else None)
    if not isinstance(src, list):
        return [dict(b) for b in DEFAULT_BANNERS]
    out = []
    for b in src[:6]:
        if not isinstance(b, dict):
            continue
        item = {}
        for k, limit in BANNER_FIELDS:
            item[k] = str(b.get(k) or '').strip()[:limit]
        if not (item['title'] or item['off'] or item['sub'] or item['img'] or item['pname']):
            continue
        item['active'] = b.get('active') is not False
        goto = str(b.get('goto') or '').strip().lower()
        allowed = {'all'} | {c['id'] for c in cats_cfg(st)}
        item['goto'] = goto if goto in allowed else 'all'
        try:
            ar = float(b.get('ar') or 0)
        except (TypeError, ValueError):
            ar = 0
        item['ar'] = round(ar, 4) if 0.4 <= ar <= 4 else 0
        try:
            item['price'] = max(0.0, min(500.0, round(float(b.get('price') or 0), 2)))
        except (TypeError, ValueError):
            item['price'] = 0.0
        base = slug(item['pname'] or item['title'] or item['tag'] or item['off'] or 'banner')
        bid, n = base, 2
        taken = {x['id'] for x in out}
        while bid in taken:
            bid = '%s-%d' % (base, n)
            n += 1
        item['id'] = bid
        out.append(item)
    return out


def popup_cfg(st, raw=None):
    """Anúncio em pop-up do app, sanitizado. Sem título nem imagem = não aparece."""
    src = raw if isinstance(raw, dict) else (st.get('popup') if isinstance(st, dict) else None)
    if not isinstance(src, dict):
        src = {}
    item = {}
    for k, limit in POPUP_FIELDS:
        item[k] = str(src.get(k) or '').strip()[:limit]
    item['active'] = bool(src.get('active')) and bool(item['title'] or item['img'])

    goto = str(src.get('goto') or '').strip()
    allowed = {'all'} | {c['id'] for c in cats_cfg(st)}
    low = goto.lower()
    if low.startswith('p:') and re.match(r'^[a-z0-9_-]{1,60}$', low[2:]):
        item['goto'] = 'p:' + low[2:]
    else:
        item['goto'] = low if low in allowed else 'all'

    freq = src.get('freq')
    item['freq'] = freq if freq in ('day', 'session', 'always') else 'day'
    return item


def banner_products(st, bans=None):
    """Banners com preço > 0 também viram produto da categoria escolhida."""
    out = []
    for b in (bans if isinstance(bans, list) else banners_cfg(st)):
        if b.get('active') is False or not b.get('price'):
            continue
        name = b.get('pname') or b.get('title') or b.get('tag') or b.get('off') or 'Promoção'
        out.append({
            'id': 'bn_' + b['id'],
            'name': name[:60],
            'cat': b.get('goto') or 'all',
            'price': b['price'],
            'rating': 5.0,
            'time': '25–35 min',
            'kcal': 0,
            'tag': b.get('off') or b.get('tag') or 'Promoção',
            'img': b.get('img') or '',
            'desc': b.get('sub') or b.get('tag') or '',
            'stock': None,
            'banner': True,
        })
    return out


def norm_cep(s):
    digits = re.sub(r'\D', '', str(s or ''))
    if len(digits) != 8 or digits == '00000000':
        return ''
    return digits


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _geo_json(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': GEO_UA,
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=GEO_TIMEOUT) as res:
        return json.loads(res.read().decode('utf-8', 'replace'))


def viacep(cep):
    try:
        d = _geo_json('https://viacep.com.br/ws/%s/json/' % cep)
    except Exception:
        return None
    if not isinstance(d, dict) or d.get('erro'):
        return None
    street = str(d.get('logradouro') or '').strip()
    district = str(d.get('bairro') or '').strip()
    city = str(d.get('localidade') or '').strip()
    state = str(d.get('uf') or '').strip()
    if not city:
        return None
    return {'street': street, 'district': district, 'city': city, 'state': state}


def _inside_brazil(lat, lon):
    return -34.0 <= lat <= 6.0 and -74.5 <= lon <= -33.0


def nominatim(cep, addr=None):
    """CEP → lat/lon. Serializa as chamadas (política de 1 req/s do serviço)."""
    addr = addr or {}
    queries = [{'postalcode': cep, 'country': 'Brazil'}]
    if addr.get('street') and addr.get('city'):
        queries.append({'street': addr['street'],
                        'city': '%s, %s' % (addr['city'], addr.get('state') or ''),
                        'country': 'Brazil'})
    for q in queries:
        q = dict(q, format='json', limit='1', countrycodes='br')
        with GEO_RATE:
            wait = GEO_MIN_INTERVAL - (time.time() - _geo_last[0])
            if wait > 0:
                time.sleep(wait)
            try:
                res = _geo_json('https://nominatim.openstreetmap.org/search?' + urlencode(q))
            except Exception:
                res = None
            _geo_last[0] = time.time()
        if isinstance(res, list) and res:
            try:
                lat, lon = float(res[0]['lat']), float(res[0]['lon'])
            except (KeyError, TypeError, ValueError):
                continue
            if _inside_brazil(lat, lon):
                return lat, lon
    return None


def _geo_store(cache):
    try:
        tmp = GEO_CACHE_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, GEO_CACHE_PATH)
    except Exception:
        pass


def _geo_all():
    global _geo_cache
    with GEO_LOCK:
        if _geo_cache is None:
            try:
                with open(GEO_CACHE_PATH, encoding='utf-8') as f:
                    _geo_cache = json.load(f)
            except Exception:
                _geo_cache = {}
            if not isinstance(_geo_cache, dict):
                _geo_cache = {}
        return _geo_cache


def resolve_cep(cep):
    """CEP → {addr, lat, lon, reason}. Usa cache em memória + disco."""
    cep = norm_cep(cep)
    if not cep:
        return {'addr': None, 'lat': None, 'lon': None, 'reason': 'invalid_cep'}

    now = int(time.time())
    cache = _geo_all()
    with GEO_LOCK:
        ent = cache.get(cep)
    if isinstance(ent, dict):
        ttl = GEO_FAIL_TTL if ent.get('reason') else GEO_TTL
        if now - int(ent.get('ts') or 0) < ttl:
            return ent

    addr = viacep(cep)
    lat = lon = None
    if addr:
        coords = nominatim(cep, addr)
        if coords:
            lat, lon = coords

    ent = {'ts': now, 'addr': addr, 'lat': lat, 'lon': lon,
           'reason': '' if addr else 'cep_not_found'}
    with GEO_LOCK:
        cache[cep] = ent
        if len(cache) > 2000:
            keep = sorted(cache.items(), key=lambda kv: kv[1].get('ts', 0))[-2000:]
            cache.clear()
            cache.update(keep)
        _geo_store(cache)
    return ent


_RL = {}
_RL_LOCK = threading.Lock()


def rate_ok(ip, limit=120, window=60):
    """Rate limit simples por IP nos endpoints públicos de geo."""
    now = time.time()
    with _RL_LOCK:
        hits = [t for t in _RL.get(ip, []) if now - t < window]
        hits.append(now)
        _RL[ip] = hits
        if len(_RL) > 500:
            for k in list(_RL)[:100]:
                _RL.pop(k, None)
        return len(hits) <= limit


_PIN_FAIL = {}
_PIN_LOCK = threading.Lock()


def pin_ok(ip, pin):
    """Confere o PIN bloqueando força bruta: 10 erros por IP a cada 15 min."""
    now = time.time()
    with _PIN_LOCK:
        fails = [t for t in _PIN_FAIL.get(ip, []) if now - t < 900]
        _PIN_FAIL[ip] = fails
        if len(fails) >= 10:
            return False
    ok = hmac.compare_digest(str(pin or ''), current_pin())
    with _PIN_LOCK:
        if not ok:
            _PIN_FAIL.setdefault(ip, []).append(now)
        else:
            _PIN_FAIL.pop(ip, None)
        if len(_PIN_FAIL) > 500:
            for k in list(_PIN_FAIL)[:100]:
                _PIN_FAIL.pop(k, None)
    return ok


def _geo_ent_json(cep, r):
    return {'ok': bool(r.get('addr')), 'cep': cep, 'addr': r.get('addr'),
            'lat': r.get('lat'), 'lon': r.get('lon'),
            'reason': r.get('reason') or ''}


def origin_coords(data):
    """Coordenadas do CEP da loja (geocoda 1 vez e guarda em originLat/Lon)."""
    st = data.get('store') or {}
    cfg = delivery_cfg(st)
    if cfg['mode'] != 'km' or not norm_cep(st.get('originCep')):
        return None
    try:
        return float(st['originLat']), float(st['originLon'])
    except (KeyError, TypeError, ValueError):
        pass
    r = resolve_cep(st.get('originCep'))
    if r.get('lat') is None:
        return None
    st['originLat'], st['originLon'] = r['lat'], r['lon']
    return r['lat'], r['lon']


def calc_fee(data, cep):
    """Regra do frete. Nunca levanta exceção: falhou → taxa fixa da loja."""
    st = data.get('store') or {}
    cfg = delivery_cfg(st)
    try:
        fixed = round(float(st.get('fee') or 0), 2)
    except (TypeError, ValueError):
        fixed = 0.0

    out = {'ok': True, 'source': 'fixed', 'cep': '', 'addr': None,
           'lat': None, 'lon': None, 'km': None, 'fee': fixed,
           'maxKm': cfg['maxKm'], 'reason': ''}

    if cfg['mode'] != 'km':
        out['reason'] = 'mode_fixed'
        return out
    if not norm_cep(st.get('originCep')):
        out['reason'] = 'no_origin'
        return out

    cep = norm_cep(cep)
    if not cep:
        out['reason'] = 'no_cep'
        return out

    out['cep'] = cep
    r = resolve_cep(cep)
    out['addr'] = r.get('addr')
    out['lat'], out['lon'] = r.get('lat'), r.get('lon')
    if not r.get('addr'):
        out['reason'] = r.get('reason') or 'cep_not_found'
        return out

    origin = origin_coords(data)
    if origin is None or r.get('lat') is None:
        out['reason'] = 'geocode_failed'
        return out

    km = round(haversine_km(origin[0], origin[1], r['lat'], r['lon']) * cfg['roadFactor'], 1)
    out['km'] = km
    if cfg['maxKm'] and km > cfg['maxKm']:
        out['ok'] = False
        out['source'] = 'too_far'
        out['fee'] = None
        return out

    fee = max(cfg['minFee'], cfg['base'] + km * cfg['perKm'])
    out['source'] = 'km'
    out['fee'] = round(math.ceil(fee * 2 - 1e-9) / 2.0, 2)
    return out


# ------------------------------------------------- rastreio do motoboy

def _track_all():
    """tracking.json em memória (lazy). Sempre {'version':1,'orders':{...}}."""
    global _track_mem
    with TRACK_LOCK:
        if _track_mem is None:
            try:
                with open(TRACK_PATH, encoding='utf-8') as f:
                    _track_mem = json.load(f)
            except Exception:
                _track_mem = {}
            if not isinstance(_track_mem, dict) or not isinstance(_track_mem.get('orders'), dict):
                _track_mem = {}
            _track_mem['version'] = 1
            _track_mem.setdefault('orders', {})
        return _track_mem


def _track_ent(track, num, create=False):
    orders = track.setdefault('orders', {})
    ent = orders.get(str(num))
    if ent is None and create:
        ent = {'updatedAt': 0}
        orders[str(num)] = ent
    return ent


def _track_prune(track, data):
    """Descarta pedidos inexistentes, entregas velhas e o excedente."""
    orders = track.get('orders') or {}
    alive = {str(o.get('num')) for o in data.get('orders', [])}
    now = int(time.time())
    for num in list(orders):
        ent = orders[num] or {}
        done = ent.get('deliveredAt') or 0
        if num not in alive or (done and now - int(done) > TRACK_TTL):
            orders.pop(num, None)
    if len(orders) > TRACK_KEEP:
        keep = sorted(orders.items(),
                      key=lambda kv: kv[1].get('updatedAt') or kv[1].get('startedAt') or 0)
        orders.clear()
        orders.update(keep[-TRACK_KEEP:])


def _track_save(track, data):
    """Grava tracking.json de forma atômica e poda."""
    global _track_mem
    with TRACK_LOCK:
        _track_prune(track, data)
        try:
            tmp = TRACK_PATH + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(track, f, ensure_ascii=False, separators=(',', ':'))
            os.replace(tmp, TRACK_PATH)
        except Exception:
            pass
        _track_mem = track


def _track_drop(data, num):
    """Encerra o rastreio de um pedido (entregue pelo painel)."""
    track = _track_all()
    ent = _track_ent(track, num)
    if not ent:
        return
    ent['deliveredAt'] = int(time.time())
    ent['updatedAt'] = ent['deliveredAt']
    ent.pop('courier', None)
    ent.pop('idx', None)
    _track_save(track, data)


def store_origin_any(data):
    """Coordenadas da loja pelo CEP de origem, em qualquer modo de frete."""
    st = data.get('store') or {}
    cep = norm_cep(st.get('originCep'))
    if not cep:
        return None
    try:
        return float(st['originLat']), float(st['originLon'])
    except (KeyError, TypeError, ValueError):
        pass
    r = resolve_cep(cep)
    if r.get('lat') is None:
        return None
    return float(r['lat']), float(r['lon'])


def order_dest(order):
    """Destino do pedido: coords gravadas na criação ou resolve o CEP antigo."""
    try:
        return float(order['destLat']), float(order['destLon'])
    except (KeyError, TypeError, ValueError):
        pass
    cep = norm_cep(order.get('cep'))
    if not cep:
        return None
    r = resolve_cep(cep)
    if r.get('lat') is None:
        return None
    return float(r['lat']), float(r['lon'])


def _pt(p):
    return {'lat': round(float(p[0]), 5), 'lon': round(float(p[1]), 5)} if p else None


def _route_key(a, b):
    return '%.5f,%.5f>%.5f,%.5f' % (a[0], a[1], b[0], b[1])


def osrm_route(a, b):
    """Rota de carro no OSRM público. [lat,lon] na entrada e na saída."""
    url = OSRM_URL % (a[1], a[0], b[1], b[0]) + '?overview=full&geometries=geojson'
    try:
        d = _geo_json(url)
    except Exception:
        return None
    if not isinstance(d, dict) or d.get('code') != 'Ok':
        return None
    routes = d.get('routes') or []
    if not routes or not isinstance(routes[0], dict):
        return None
    r = routes[0]
    coords = []
    for pt in ((r.get('geometry') or {}).get('coordinates') or []):
        try:
            lon, lat = float(pt[0]), float(pt[1])
        except (IndexError, KeyError, TypeError, ValueError):
            continue
        coords.append([round(lat, 5), round(lon, 5)])
    if len(coords) < 2:
        return None
    try:
        dist = int(round(float(r.get('distance') or 0)))
        dur = int(round(float(r.get('duration') or 0)))
    except (TypeError, ValueError):
        dist, dur = 0, 0
    return {'coords': coords, 'distanceM': dist, 'durationS': dur}


def ensure_route(track, num, a, b):
    """Rota em cache para origem→destino. Retorna (rota|None, mudou?)."""
    lock = _route_locks.setdefault(str(num), threading.Lock())
    with lock:
        ent = _track_ent(track, num, True)
        key = _route_key(a, b)
        route = ent.get('route')
        if route and route.get('key') == key:
            return route, False
        now = int(time.time())
        if now - int(ent.get('routeFailedAt') or 0) < ROUTE_FAIL_TTL:
            return route, False
        r = osrm_route(a, b)
        if r:
            r.update({'key': key, 'source': 'osrm', 'createdAt': now})
            ent['route'] = r
            ent.pop('routeFailedAt', None)
        else:
            ent['routeFailedAt'] = now
        ent['updatedAt'] = now
        return ent.get('route'), True


def nearest_on_route(coords, lat, lon, start=0):
    """Índice do ponto mais próximo, sem andar para trás (ruído de GPS)."""
    n = len(coords)
    if not n:
        return 0
    i0 = max(0, min(int(start or 0), n - 1))
    best_i, best_d = i0, None
    for i in range(i0, n):
        d = haversine_km(lat, lon, coords[i][0], coords[i][1])
        if best_d is None or d < best_d:
            best_i, best_d = i, d
    return best_i


def _token_eq(given, expected):
    try:
        return bool(expected) and hmac.compare_digest(str(given or ''), str(expected))
    except Exception:
        return False


def public_order(o):
    """Pedido sem tokens — só o que o cliente e o motoboy podem ver."""
    out = {'num': o.get('num'), 'status': o.get('status') or 1,
           'time': o.get('time'), 'createdAt': o.get('createdAt'),
           'total': o.get('total'), 'name': o.get('name'), 'addr': o.get('addr'),
           'pay': o.get('pay'), 'paid': bool(o.get('paid'))}
    pix = o.get('pix')
    if pix and not o.get('paid'):
        out['pix'] = {'copy': pix.get('copy'), 'qr': pix.get('qr')}
    return out


# ------------------------------------------------------- Mercado Pago (Pix)

MP_API = 'https://api.mercadopago.com'

# O Access Token é de cada instalação: fica no banco (mp_cfg), nunca no
# repositório, nunca em /api/admin/all e nunca no backup. Quem vende ou aluga
# o app troca o token no painel e passa a receber na própria conta do MP.


def mp_cfg(data):
    cfg = data.get('mp_cfg')
    return cfg if isinstance(cfg, dict) else {}


def mp_public(data):
    cfg = mp_cfg(data)
    return {'configured': bool(cfg.get('token')),
            'on': bool(cfg.get('on')) and bool(cfg.get('token')),
            'account': str(cfg.get('account') or '')[:60],
            'updatedAt': cfg.get('updatedAt')}


def _mp_call(method, path, token, body=None, key='', timeout=12):
    headers = {'Authorization': 'Bearer %s' % token,
               'Content-Type': 'application/json',
               'Accept': 'application/json'}
    if key:
        headers['X-Idempotency-Key'] = key
    req = urllib.request.Request(
        MP_API + path, method=method, headers=headers,
        data=json.dumps(body).encode('utf-8') if body is not None else None)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8') or '{}')


def _mp_payer_email(data, num):
    """E-mail do pagador: +alias no e-mail da loja (o recibo cai no dono)."""
    mail = str((data.get('store') or {}).get('email') or '').strip().lower()
    m = re.match(r'^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$', mail)
    if m:
        return '%s+pedido%s@%s' % (m.group(1), num, m.group(2))
    return 'pedido%s@example.com' % num


def mp_pix(data, order, base_url):
    """Cria a cobrança Pix na conta do token configurado no painel."""
    cfg = mp_cfg(data)
    token = str(cfg.get('token') or '')
    if not token or not cfg.get('on'):
        return None
    body = {'transaction_amount': round(float(order.get('total') or 0), 2),
            'description': 'Pedido #%s' % order.get('num'),
            'payment_method_id': 'pix',
            'external_reference': str(order.get('num')),
            'payer': {'email': _mp_payer_email(data, order.get('num'))}}
    base = str(base_url or '').rstrip('/')
    if base.startswith('https://'):
        body['notification_url'] = base + '/api/mp/webhook'
    try:
        r = _mp_call('POST', '/v1/payments', token, body,
                     key='bolos-%s-%s' % (order.get('num'), uuid.uuid4().hex[:10]))
    except Exception as e:
        print('  aviso: Mercado Pago recusou o Pix (%s)' % e, flush=True)
        return None
    tr = ((r.get('point_of_interaction') or {}).get('transaction_data') or {})
    qr = tr.get('qr_code') or ''
    if not qr:
        print('  aviso: Mercado Pago respondeu sem qr_code', flush=True)
        return None
    return {'id': str(r.get('id') or ''), 'copy': qr,
            'qr': tr.get('qr_code_base64') or '', 'url': tr.get('ticket_url') or ''}


# ----------------------------------------------------------------- push

def _gen_vapid():
    """Gera um par EC P-256; devolve DER privado e ponto público em base64url.

    O pywebpush não lê PEM: ele decodifica a string como base64url e espera
    DER (ou a chave crua de 32 bytes). Por isso guardamos DER em base64url.
    """
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except Exception:
        return None
    key = ec.generate_private_key(ec.SECP256R1())
    der = key.private_bytes(serialization.Encoding.DER,
                            serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    priv = base64.urlsafe_b64encode(der).rstrip(b'=').decode('ascii')
    nums = key.public_key().public_numbers()
    raw = b'\x04' + nums.x.to_bytes(32, 'big') + nums.y.to_bytes(32, 'big')
    pub = base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')
    return {'private': priv, 'public': pub, 'createdAt': int(time.time()),
            'subject': PUSH_CONTACT, 'fmt': 'der-pkcs8'}


def _vapid_der(priv):
    """Aceita chave no formato atual (DER base64url) ou PEM antigo."""
    priv = str(priv or '').strip()
    if 'BEGIN' not in priv:
        return priv
    try:
        from cryptography.hazmat.primitives import serialization
        key = serialization.load_pem_private_key(priv.encode('ascii'), password=None)
        der = key.private_bytes(serialization.Encoding.DER,
                                serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        return base64.urlsafe_b64encode(der).rstrip(b'=').decode('ascii')
    except Exception:
        return priv


def ensure_push_cfg(data=None):
    """Env > chaves persistidas > gera uma vez. None = push indisponível."""
    pub = os.environ.get('PUSH_VAPID_PUBLIC', '').strip()
    priv = os.environ.get('PUSH_VAPID_PRIVATE', '').strip()
    if pub and priv:
        return {'public': pub, 'private': priv, 'subject': PUSH_CONTACT}
    if isinstance(data, dict):
        cfg = data.get('push_cfg')
        if isinstance(cfg, dict) and cfg.get('public') and cfg.get('private'):
            cfg.setdefault('subject', PUSH_CONTACT)
            return cfg
    with LOCK:                       # RLock: load()/save() reentrantes
        fresh = load()
        cfg = fresh.get('push_cfg')
        if isinstance(cfg, dict) and cfg.get('public') and cfg.get('private'):
            cfg.setdefault('subject', PUSH_CONTACT)
            return cfg
        cfg = _gen_vapid()
        if not cfg:
            return None
        fresh['push_cfg'] = cfg
        save(fresh)
        return cfg


def _push_payload(num, status):
    num = str(num)
    if status == 4:
        title, body = 'Pedido entregue ✓', 'Seu pedido #%s foi entregue. Bom apetite!' % num
    else:
        title, body = 'Saiu para entrega! 🛵', 'Seu pedido #%s está a caminho.' % num
    return {'title': title, 'body': body, 'tag': 'order-%s' % num,
            'url': './?pedido=%s' % quote(num), 'num': num, 'status': status}


def _push_payload_admin(order):
    """Aviso de pedido novo para os aparelhos inscritos no painel."""
    num = str(order.get('num') or '')
    items = order.get('items') or []
    qty = 0
    for it in items:
        try:
            qty += int(it.get('qty') or 1)
        except (TypeError, ValueError):
            qty += 1
    try:
        total = ('R$ %.2f' % float(order.get('total') or 0)).replace('.', ',')
    except (TypeError, ValueError):
        total = 'R$ 0,00'
    who = (str(order.get('name') or '').strip() or 'Cliente').split(' ')[0]
    return {'title': 'Novo pedido #%s 🧾' % num,
            'body': '%s · %d item(ns) · %s' % (who, qty, total),
            'tag': 'admin-order-%s' % num,
            'url': '/painel/?aba=pedidos',
            'num': num, 'panel': True}


def _broadcast_payload(title, body, url):
    return {'title': title, 'body': body, 'url': url or './',
            'tag': 'promo-%d' % int(time.time()), 'promo': True}


def _all_app_subs(data):
    """Todos os aparelhos de clientes: inscrições globais + as feitas por pedido.

    Muitos clientes ativaram os avisos antes de existir o cadastro global;
    unir as duas fontes evita pedir que eles ativem de novo.
    """
    seen = {}
    for s in (data.get('broadcast_subs') or []):
        if s.get('endpoint'):
            seen[s['endpoint']] = s
    for o in (data.get('orders') or []):
        for s in (o.get('push_subs') or []):
            if s.get('endpoint'):
                seen.setdefault(s['endpoint'], s)
    return list(seen.values())


def _push_broadcast(title, body, url, subs):
    if _webpush is None:
        return
    cfg = ensure_push_cfg()
    if not cfg:
        return
    payload = json.dumps(_broadcast_payload(title, body, url), ensure_ascii=False)
    priv = _vapid_der(cfg.get('private'))
    gone = []
    sent = 0
    for s in subs:
        info = {'endpoint': s.get('endpoint'), 'keys': s.get('keys') or {}}
        try:
            _webpush(subscription_info=info, data=payload,
                     vapid_private_key=priv,
                     vapid_claims={'sub': cfg.get('subject') or PUSH_CONTACT},
                     ttl=PUSH_TTL, timeout=10,
                     headers={'Urgency': 'normal'})
            sent += 1
        except _WebPushException as e:
            code = getattr(getattr(e, 'response', None), 'status_code', None)
            if code in (404, 410):
                gone.append(info['endpoint'])
            else:
                print('broadcast: erro %s %s' % (code or '?', str(e)[:200]), flush=True)
        except Exception as e:
            print('broadcast: falhou (%s)' % (str(e)[:200]), flush=True)
    print('broadcast: %d/%d enviado(s)' % (sent, len(subs)), flush=True)
    gone_set = set(gone)
    with LOCK:
        fresh = load()
        changed = False
        kept = [s for s in (fresh.get('broadcast_subs') or [])
                if s.get('endpoint') not in gone_set]
        if len(kept) != len(fresh.get('broadcast_subs') or []):
            fresh['broadcast_subs'] = kept
            changed = True
        for o in (fresh.get('orders') or []):
            subs_now = o.get('push_subs') or []
            sub_kept = [s for s in subs_now if s.get('endpoint') not in gone_set]
            if len(sub_kept) != len(subs_now):
                o['push_subs'] = sub_kept
                changed = True
        if changed:
            save(fresh)


def _push_notify_admin(data, order):
    """Push imediato para os aparelhos do painel; nunca atrasa a resposta."""
    if _webpush is None:
        return
    subs = [dict(s) for s in (data.get('admin_push_subs') or []) if s.get('endpoint')]
    if not subs:
        return
    payload = json.dumps(_push_payload_admin(order), ensure_ascii=False)
    threading.Thread(target=_push_send_admin, daemon=True,
                     args=(payload, subs)).start()


_ADMIN_PUSH_MAX = 10            # aparelhos do painel inscritos


def _push_send_admin(payload, subs):
    if _webpush is None:
        return
    cfg = ensure_push_cfg()
    if not cfg:
        return
    priv = _vapid_der(cfg.get('private'))
    gone = []
    sent = 0
    for s in subs:
        info = {'endpoint': s.get('endpoint'), 'keys': s.get('keys') or {}}
        try:
            _webpush(subscription_info=info, data=payload,
                     vapid_private_key=priv,
                     vapid_claims={'sub': cfg.get('subject') or PUSH_CONTACT},
                     ttl=PUSH_TTL, timeout=10,
                     headers={'Urgency': 'high'})
            sent += 1
        except _WebPushException as e:
            code = getattr(getattr(e, 'response', None), 'status_code', None)
            if code in (404, 410):
                gone.append(info['endpoint'])
            else:
                print('push painel: erro %s %s' % (code or '?', str(e)[:200]), flush=True)
        except Exception as e:
            print('push painel: falhou (%s)' % (str(e)[:200]), flush=True)
    if sent:
        print('push painel: %d aviso(s) enviado(s)' % sent, flush=True)
    if not gone:
        return
    with LOCK:
        fresh = load()
        subs_now = fresh.get('admin_push_subs') or []
        gone_set = set(gone)
        kept = [s for s in subs_now if s.get('endpoint') not in gone_set]
        if len(kept) != len(subs_now):
            fresh['admin_push_subs'] = kept
            save(fresh)



def _push_notify(data, order, status):
    """Agenda o envio em thread daemon; nunca atrasa nem derruba a resposta."""
    if status not in (3, 4) or _webpush is None:
        return
    subs = [dict(s) for s in (order.get('push_subs') or []) if s.get('endpoint')]
    if not subs or not order.get('num'):
        return
    threading.Thread(target=_push_send, daemon=True,
                     args=(str(order.get('num')), status, subs)).start()


def _push_send(num, status, subs):
    if _webpush is None:
        return
    cfg = ensure_push_cfg()
    if not cfg:
        return
    payload = json.dumps(_push_payload(num, status), ensure_ascii=False)
    priv = _vapid_der(cfg.get('private'))
    gone = []
    sent = 0
    for s in subs:
        info = {'endpoint': s.get('endpoint'), 'keys': s.get('keys') or {}}
        try:
            _webpush(subscription_info=info, data=payload,
                     vapid_private_key=priv,
                     vapid_claims={'sub': cfg.get('subject') or PUSH_CONTACT},
                     ttl=PUSH_TTL, timeout=10,
                     headers={'Urgency': 'high'})
            sent += 1
        except _WebPushException as e:
            code = getattr(getattr(e, 'response', None), 'status_code', None)
            if code in (404, 410):
                gone.append(info['endpoint'])
            else:
                print('push %s: erro %s %s' % (num, code or '?', str(e)[:200]),
                      flush=True)
        except Exception as e:
            print('push %s: falhou (%s)' % (num, str(e)[:200]), flush=True)
    if sent:
        print('push %s: %d aviso(s) enviado(s)' % (num, sent), flush=True)
    if gone:
        _push_prune(num, gone)


def _push_prune(num, endpoints):
    """Remove inscrições que o serviço de push disse que não existem mais."""
    gone = set(endpoints)
    with LOCK:
        data = load()
        for o in data.get('orders', []):
            if str(o.get('num')) == str(num):
                subs = o.get('push_subs') or []
                kept = [s for s in subs if s.get('endpoint') not in gone]
                if len(kept) != len(subs):
                    o['push_subs'] = kept
                    save(data)
                break


def _clean_sub(b):
    """Valida e enxuga a inscrição enviada pelo navegador."""
    if not isinstance(b, dict):
        return None
    ep = str(b.get('endpoint') or '').strip()
    keys = b.get('keys') if isinstance(b.get('keys'), dict) else {}
    p256 = str(keys.get('p256dh') or '').strip()
    auth = str(keys.get('auth') or '').strip()
    if not ep.startswith('https://') or not p256 or not auth:
        return None
    if len(ep) > 1500 or len(p256) > 200 or len(auth) > 100:
        return None
    sub = {'endpoint': ep, 'keys': {'p256dh': p256, 'auth': auth}}
    exp = b.get('expirationTime')
    if isinstance(exp, (int, float)):
        sub['expirationTime'] = int(exp)
    return sub


def slug(text):
    s = re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-')
    return s[:32] or 'item'


# ----------------------------------------------------------------- ícones

def make_icons(src, accent='#2B2118'):
    """Regenera os ícones do PWA a partir do logo enviado."""
    if Image is None:
        return False
    try:
        im = Image.open(src).convert('RGBA')
    except Exception:
        return False

    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))

    os.makedirs(ICON_DIR, exist_ok=True)

    def build(size, radius_ratio, bg, inset, path, alpha=True):
        mode = 'RGBA' if alpha else 'RGB'
        base = Image.new(mode, (size, size), bg if not alpha else (0, 0, 0, 0))
        if alpha:
            layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            d.rounded_rectangle([0, 0, size - 1, size - 1],
                                radius=int(size * radius_ratio), fill=bg)
            base = layer
        inner = max(1, int(size * inset))
        icon = im.resize((inner, inner), Image.LANCZOS)
        base.alpha_composite(icon, ((size - inner) // 2, (size - inner) // 2)) if alpha else base.paste(icon, ((size - inner) // 2, (size - inner) // 2), icon)
        base.save(path)

    try:
        build(192, .22, '#FDF6EF', .78, os.path.join(ICON_DIR, 'icon-192.png'))
        build(512, .22, '#FDF6EF', .78, os.path.join(ICON_DIR, 'icon-512.png'))
        build(512, .00, accent, .66, os.path.join(ICON_DIR, 'maskable-512.png'))
        build(180, .00, '#FDF6EF', .76, os.path.join(ICON_DIR, 'apple-touch-icon.png'))
        return True
    except Exception:
        return False


# ----------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    server_version = 'DeliciasDoAleff/1.0'
    protocol_version = 'HTTP/1.1'

    # ---------- helpers ----------

    def log_message(self, fmt, *args):
        try:
            line = fmt % args
        except Exception:
            line = fmt
        line = re.sub(r'([?&]t=)[^&\s"]+', r'\1***', line)   # token não vai para o log
        # API e painel sempre no log (ajuda a diagnosticar login); resto só com SC_VERBOSE
        if os.environ.get('SC_VERBOSE') or '/api/' in line or 'painel' in line:
            print('%s - %s' % (self.address_string(), line), flush=True)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._json({'error': msg}, code)

    def _auth(self):
        return hmac.compare_digest(str(self.headers.get('X-Pin', '')), current_pin())

    def _need_auth(self):
        if not self._auth():
            self._err(401, 'PIN incorreto')
            return False
        return True

    def _body(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return {}
        if n <= 0 or n > MAX_BODY:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return {}

    def _change_pin(self, b):
        cur = str(b.get('current') or '')
        new = str(b.get('new') or '').strip()
        if not hmac.compare_digest(cur, current_pin()):
            return self._err(403, 'PIN atual incorreto')
        if not 4 <= len(new) <= 32 or re.search(r'\s', new):
            return self._err(400, 'o novo PIN precisa ter de 4 a 32 caracteres, sem espaços')
        set_pin(new)
        return self._json({'ok': True})

    def _forgot_pin(self, b):
        ip = self.client_address[0]
        if not rate_ok('forgot:%s' % ip, 3, 3600):
            return self._err(429, 'muitas tentativas, aguarde uma hora')
        email = str(b.get('email') or '').strip().lower()[:120]
        data = load()
        target = str((data.get('store') or {}).get('email') or '').strip().lower()
        if not target:
            return self._err(409, 'nenhum e-mail de recuperação cadastrado no painel')
        if not smtp_ready():
            return self._err(503, 'envio de e-mail não configurado no servidor')
        if not email or email != target:
            # resposta genérica: não revela qual e-mail está cadastrado
            return self._json({'ok': True})
        store_name = str((data.get('store') or {}).get('name') or 'sua loja')
        try:
            send_mail(target,
                      'PIN do painel — %s' % store_name,
                      'Olá!\n\nO PIN de administrador de %s é: %s\n\n'
                      'Se não foi você quem pediu, entre no painel e troque o PIN '
                      '(aba Loja → Segurança).\n' % (store_name, current_pin()))
        except Exception as e:
            print('  aviso: falha ao enviar o PIN por e-mail (%s)' % e, flush=True)
            return self._err(502, 'não consegui enviar o e-mail agora; tente mais tarde')
        return self._json({'ok': True})

    def _base_url(self):
        """URL pública desta instalação (para o webhook do Mercado Pago)."""
        env = os.environ.get('SC_BASE_URL', '').strip()
        if env:
            return env.rstrip('/')
        host = str(self.headers.get('Host') or 'localhost:%d' % PORT)
        proto = (self.headers.get('X-Forwarded-Proto') or '').strip().lower()
        if proto not in ('http', 'https'):
            local = re.match(r'^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)', host)
            proto = 'http' if local else 'https'
        return '%s://%s' % (proto, host)

    def _save_mp(self, b):
        """Configuração do Pix do Mercado Pago — de cada dono do app."""
        data = load()
        old = mp_cfg(data)
        if b.get('clear'):
            data.pop('mp_cfg', None)
            save(data)
            return self._json({'ok': True, 'mp': mp_public(data)})

        token = str(b.get('token') or '').strip()
        if token and len(token) < 20:
            return self._err(400, 'esse token parece curto — copie o Access Token inteiro')
        if not token:
            token = str(old.get('token') or '')
        if not token:
            return self._err(400, 'cole o Access Token do Mercado Pago')

        account = str(old.get('account') or '')
        if token != str(old.get('token') or ''):
            try:
                me = _mp_call('GET', '/users/me', token)
                account = str(me.get('nickname') or me.get('email') or '')[:60]
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    return self._err(403, 'token recusado pelo Mercado Pago — confira e cole de novo')
                return self._err(502, 'não consegui falar com o Mercado Pago agora (tente de novo)')
            except Exception:
                return self._err(502, 'não consegui falar com o Mercado Pago agora (tente de novo)')

        on = b.get('on')
        data['mp_cfg'] = {'token': token,
                          'on': bool(on) if on is not None else bool(old.get('on')),
                          'account': account,
                          'updatedAt': int(time.time())}
        save(data)
        return self._json({'ok': True, 'mp': mp_public(data)})

    def _mp_webhook(self, query):
        """O Mercado Pago avisa aqui. Confere na API e marca o pedido como pago."""
        b = self._body() or {}
        typ = str(b.get('type') or b.get('topic') or (query.get('type') or query.get('topic') or [''])[0])
        data_id = str((b.get('data') or {}).get('id') or (query.get('data.id') or query.get('id') or [''])[0])
        if typ != 'payment' or not data_id:
            return self._json({'ok': True})
        data = load()
        token = str(mp_cfg(data).get('token') or '')
        if not token:
            return self._json({'ok': True})
        try:
            pay = _mp_call('GET', '/v1/payments/%s' % quote(data_id), token)
        except Exception as e:
            print('  aviso: webhook do MP não verificou o pagamento %s (%s)' % (data_id, e), flush=True)
            return self._json({'ok': True})
        if str(pay.get('status')) != 'approved':
            return self._json({'ok': True})
        ref = str(pay.get('external_reference') or '')
        pid = str(pay.get('id') or data_id)
        for o in data.get('orders', []):
            mine = str(o.get('num')) == ref or str((o.get('pix') or {}).get('id') or '') == pid
            if not mine:
                continue
            if not o.get('paid'):
                o['paid'] = True
                o['paidAt'] = int(time.time())
                o['paidVia'] = 'mp'
                save(data)
                print('  Pix pago: pedido %s' % o.get('num'), flush=True)
            break
        return self._json({'ok': True})

    # ---------- GET ----------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith('/api/'):
            return self._api_get(path, query)

        # pasta sem barra final quebra links relativos (/painel → /painel.css)
        if not path.endswith('/'):
            full = os.path.normpath(os.path.join(BASE, unquote(path).lstrip('/')))
            if (full == BASE or full.startswith(BASE + os.sep)) and os.path.isdir(full):
                self.send_response(301)
                self.send_header('Location', path + '/')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return

        if path in ('/', ''):
            path = '/index.html'
        if path in ('/painel', '/painel/'):
            path = '/painel/index.html'

        return self._static(path)

    def _track_view(self, data, order):
        """Mapa + rota + posição de um pedido (cliente e motoboy)."""
        now = int(time.time())
        status = int(order.get('status') or 1)
        origin = store_origin_any(data)
        dest = order_dest(order)
        out = {'ok': True, 'num': order.get('num'), 'status': status,
               'paid': bool(order.get('paid')),
               'serverNow': now, 'staleAfter': TRACK_STALE,
               'origin': _pt(origin), 'dest': _pt(dest),
               'route': None, 'courier': None}
        if status < 3 or not origin or not dest:
            return out

        track = _track_all()
        ent = _track_ent(track, order.get('num'), True)
        route, changed = ensure_route(track, order.get('num'), origin, dest)
        if changed:
            _track_save(track, data)

        if route and route.get('coords'):
            coords = route['coords']
            n = len(coords) - 1
            idx = max(0, min(int(ent.get('idx') or 0), n))
            out['route'] = {'coords': coords,
                            'distanceM': route.get('distanceM'),
                            'durationS': route.get('durationS'),
                            'idx': idx,
                            'progress': round(idx / float(n), 4) if n > 0 else 0,
                            'source': route.get('source')}
        if status == 3:
            c = ent.get('courier')
            if isinstance(c, dict) and c.get('updatedAt'):
                out['courier'] = {'lat': c.get('lat'), 'lon': c.get('lon'),
                                  'heading': c.get('heading'),
                                  'speed': c.get('speed'), 'acc': c.get('acc'),
                                  'updatedAt': c.get('updatedAt'),
                                  'stale': now - int(c.get('updatedAt') or 0) > TRACK_STALE}
        return out

    def _api_get(self, path, query=None):
        query = query or {}

        # ping sem tocar no banco: o uptime check mantém o Render acordado
        # e deixa o Neon suspender quando a loja está sem movimento
        if path == '/api/ping':
            return self._json({'ok': True, 'ts': int(time.time())})

        if path == '/api/push/key':
            if _webpush is None:
                return self._json({'key': None})
            cfg = ensure_push_cfg()
            return self._json({'key': cfg['public'] if cfg else None})

        data = load()

        if path == '/api/menu':
            return self._json(public_menu(data))

        m = re.match(r'^/api/order/([^/]+)$', path)
        if m:
            if not rate_ok(self.client_address[0]):
                return self._err(429, 'muitas consultas, aguarde um minuto')
            num = unquote(m.group(1))
            token = (query.get('t') or [''])[0]
            o = next((x for x in data.get('orders', [])
                      if str(x.get('num')) == num), None)
            if not o or not token or token != o.get('token'):
                return self._err(404, 'pedido não encontrado')
            return self._json({'ok': True, 'order': public_order(o)})

        m = re.match(r'^/api/order/([^/]+)/track$', path)
        if m:
            ip = self.client_address[0]
            num = unquote(m.group(1))
            token = (query.get('t') or [''])[0]
            if not rate_ok('trk:%s:%s' % (num, str(token)[:8]), 40):
                return self._err(429, 'muitas consultas, aguarde um instante')
            if not rate_ok(ip):
                return self._err(429, 'muitas consultas, aguarde um instante')
            o = next((x for x in data.get('orders', [])
                      if str(x.get('num')) == num), None)
            if not o or not _token_eq(token, o.get('token')):
                return self._err(404, 'pedido não encontrado')
            return self._json(self._track_view(data, o))

        if path == '/api/motoboy/order':
            ip = self.client_address[0]
            if not rate_ok('mb:%s' % ip):
                return self._err(429, 'muitas consultas, aguarde um minuto')
            num = unquote((query.get('num') or [''])[0])
            token = (query.get('t') or [''])[0]
            o = next((x for x in data.get('orders', [])
                      if str(x.get('num')) == num), None)
            if not o or not _token_eq(token, o.get('mtoken')):
                return self._err(404, 'link inválido ou expirado')
            out = self._track_view(data, o)
            oview = public_order(o)
            oview.update({
                'phone': o.get('phone'), 'pay': o.get('pay'),
                'store': str((data.get('store') or {}).get('name') or '')[:80],
                'items': [{'name': it.get('name'), 'qty': it.get('qty')}
                          for it in (o.get('items') or [])],
            })
            out['order'] = oview
            return self._json(out)

        if path.startswith('/api/geo/'):
            if not rate_ok(self.client_address[0]):
                return self._err(429, 'muitas consultas de CEP, aguarde um minuto')
            m = re.match(r'^/api/geo/cep/([^/]+)$', path)
            if m:
                cep = norm_cep(unquote(m.group(1)))
                if not cep:
                    return self._err(400, 'CEP inválido (use 8 números)')
                r = resolve_cep(cep)
                if not r.get('addr'):
                    return self._err(404, 'CEP não encontrado')
                return self._json(_geo_ent_json(cep, r))
            if path == '/api/geo/fee':
                cep = (query.get('cep') or [''])[0]
                if not norm_cep(cep):
                    return self._err(400, 'CEP inválido (use 8 números)')
                return self._json(calc_fee(data, cep))
            return self._err(404, 'rota não encontrada')

        if path == '/api/admin/all':
            if not self._need_auth():
                return
            data = dict(data)
            mp = mp_public(data)
            data.pop('mp_cfg', None)        # o token do Mercado Pago nunca sai daqui
            data.pop('push_cfg', None)      # a chave privada VAPID nunca sai daqui
            data.pop('admin', None)         # o PIN nunca sai daqui
            data['mp'] = mp
            data['pushDevices'] = len(data.pop('admin_push_subs', None) or [])
            data['appDevices'] = len(_all_app_subs(data))
            data.pop('broadcast_subs', None)
            data['store'] = dict(data['store'],
                                 openNow=is_open_now(data['store']),
                                 hoursText=hours_text(data['store']))
            return self._json(data)

        if path == '/api/admin/orders':
            if not self._need_auth():
                return
            changed = False
            for o in data.get('orders', []):
                if int(o.get('status') or 1) < 4 and not o.get('mtoken'):
                    o['mtoken'] = uuid.uuid4().hex[:16]   # link do motoboy p/ pedidos antigos
                    changed = True
            if changed:
                save(data)
            return self._json({'orders': data.get('orders', [])})

        if path == '/api/admin/backup':
            if not self._need_auth():
                return
            # sem a chave privada VAPID nem inscrições: o backup pode ir para
            # artefato público do GitHub e ninguém deve poder enviar push
            safe = json.loads(json.dumps(data, ensure_ascii=False))
            safe.pop('mp_cfg', None)         # backup público não leva o token do MP
            safe.pop('push_cfg', None)
            safe.pop('admin', None)          # backup público não leva o PIN
            safe.pop('admin_push_subs', None)
            safe.pop('broadcast_subs', None)
            for o in safe.get('orders', []):
                o.pop('push_subs', None)
            body = json.dumps(safe, ensure_ascii=False, indent=1).encode('utf-8')
            stamp = time.strftime('%Y-%m-%d')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition',
                             'attachment; filename="backup-bolos-%s.json"' % stamp)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return

        if path == '/api/admin/geo/test':
            if not self._need_auth():
                return
            cep = (query.get('cep') or [''])[0]
            origin = (query.get('origin') or [''])[0]
            if not norm_cep(cep):
                return self._err(400, 'CEP de destino inválido')
            st = dict(data['store'])
            cfg = delivery_cfg(st)
            cfg['mode'] = 'km'
            st['delivery'] = cfg
            if origin:
                ocep = norm_cep(origin)
                if not ocep:
                    return self._err(400, 'CEP de origem inválido')
                st['originCep'] = ocep
                st['originLat'] = None
                st['originLon'] = None
            elif not norm_cep(st.get('originCep')):
                return self._err(400, 'configure o CEP da loja primeiro')
            return self._json(calc_fee(dict(data, store=st), cep))

        return self._err(404, 'rota não encontrada')

    def _static(self, path):
        rel = unquote(path).lstrip('/')

        if not rel or rel.split('/')[0] in PUBLIC_FILES_DENY or rel.endswith('.tmp'):
            return self._err(403, 'acesso negado')
        if rel.endswith('.py') or rel.startswith('.'):
            return self._err(403, 'acesso negado')

        full = os.path.normpath(os.path.join(BASE, rel))
        if not (full == BASE or full.startswith(BASE + os.sep)):
            return self._err(403, 'acesso negado')

        # fotos novas enviadas pelo painel ficam no Postgres (hospedagem)
        if DB_MODE and rel.startswith('uploads/'):
            got = db_get_upload(rel.split('/', 1)[1])
            if got:
                mime, body = got
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self.end_headers()
                self.wfile.write(body)
                return

        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')

        if not os.path.isfile(full):
            return self._err(404, 'arquivo não encontrado')

        ext = os.path.splitext(full)[1].lower()
        try:
            with open(full, 'rb') as f:
                body = f.read()
        except Exception:
            return self._err(500, 'erro ao ler arquivo')

        self.send_response(200)
        self.send_header('Content-Type', MIME.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(body)))
        if ext in ('.html', '.css', '.js', '.webmanifest'):
            self.send_header('Cache-Control', 'no-cache')
        elif ext in ('.png', '.webp', '.jpg', '.jpeg', '.svg', '.ico', '.mp4'):
            self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers()
        self.wfile.write(body)

    # ---------- POST ----------

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        m = re.match(r'^/api/order/([^/]+)/push$', path)
        if m:
            return self._push_subscribe(unquote(m.group(1)), query)

        if path == '/api/mp/webhook':
            return self._mp_webhook(query)

        if path == '/api/auth':
            b = self._body()
            if pin_ok(self.client_address[0], b.get('pin')):
                return self._json({'ok': True})
            return self._err(401, 'PIN incorreto')

        if path == '/api/pin/forgot':
            return self._forgot_pin(self._body())

        if path == '/api/admin/pin':
            if not self._need_auth():
                return
            return self._change_pin(self._body())

        if path == '/api/admin/pdv':
            if not self._need_auth():
                return
            return self._create_pdv_sale(self._body())

        if path == '/api/admin/mp':
            if not self._need_auth():
                return
            return self._save_mp(self._body())

        if path == '/api/push/subscribe':
            return self._app_push_subscribe()

        if path == '/api/orders':
            return self._create_order(self._body())

        if path == '/api/motoboy/location':
            return self._motoboy_location(self._body())

        if path == '/api/motoboy/status':
            return self._motoboy_status(self._body())

        if path == '/api/upload':
            if not self._need_auth():
                return
            return self._upload(self._body())

        if path == '/api/admin/push':
            if not self._need_auth():
                return
            return self._admin_push_save()

        if path == '/api/admin/broadcast':
            if not self._need_auth():
                return
            return self._send_broadcast(self._body())

        if path == '/api/admin/products':
            if not self._need_auth():
                return
            return self._save_product(self._body(), None)

        if path == '/api/admin/icons':
            if not self._need_auth():
                return
            data = load()
            logo = os.path.join(BASE, data['store'].get('logo', ''))
            ok = make_icons(logo) if os.path.isfile(logo) else False
            return self._json({'ok': ok})

        return self._err(404, 'rota não encontrada')

    # ---------- PUT ----------

    def do_PUT(self):
        path = urlparse(self.path).path
        if not self._need_auth():
            return

        if path == '/api/admin/store':
            return self._save_store(self._body())

        m = re.match(r'^/api/admin/products/([\w-]+)$', path)
        if m:
            return self._save_product(self._body(), m.group(1))

        m = re.match(r'^/api/admin/orders/([\w-]+)$', path)
        if m:
            b = self._body()
            data = load()
            for o in data.get('orders', []):
                if str(o.get('num')) == m.group(1):
                    old = int(o.get('status') or 1)
                    new = old
                    if 'status' in b:
                        try:
                            st = int(b.get('status'))
                        except (TypeError, ValueError):
                            return self._err(400, 'status inválido')
                        if st < 1 or st > 4:
                            return self._err(400, 'status inválido')
                        new = st
                        o['status'] = st
                    save(data)
                    if new == 4:
                        _track_drop(data, o.get('num'))   # encerra o rastreio
                    if new in (3, 4) and new != old:
                        _push_notify(data, o, new)        # avisa o cliente
                    return self._json({'ok': True, 'order': o})
            return self._err(404, 'pedido não encontrado')

        return self._err(404, 'rota não encontrada')

    # ---------- DELETE ----------

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self._need_auth():
            return

        m = re.match(r'^/api/admin/orders/([\w-]+)$', path)
        if m:
            num = m.group(1)
            data = load()
            before = len(data.get('orders', []))
            data['orders'] = [o for o in data.get('orders', []) if str(o.get('num')) != num]
            if len(data['orders']) == before:
                return self._err(404, 'pedido não encontrado')
            save(data)
            # apaga também o rastreio (posição do motoboy, rota em cache)
            track = _track_all()
            track.get('orders', {}).pop(num, None)
            _track_save(track, data)
            return self._json({'ok': True})

        if path == '/api/admin/push':
            b = self._body()
            ep = str(b.get('endpoint') or '').strip()
            data = load()
            subs = data.get('admin_push_subs') or []
            kept = [s for s in subs if s.get('endpoint') != ep]
            if len(kept) != len(subs):
                data['admin_push_subs'] = kept
                save(data)
            return self._json({'ok': True, 'count': len(data.get('admin_push_subs') or [])})

        m = re.match(r'^/api/admin/products/([\w-]+)$', path)
        if not m:
            return self._err(404, 'rota não encontrada')
        data = load()
        before = len(data['products'])
        data['products'] = [p for p in data['products'] if p.get('id') != m.group(1)]
        if len(data['products']) == before:
            return self._err(404, 'produto não encontrado')
        save(data)
        return self._json({'ok': True})

    # ---------- ações ----------

    def _app_push_subscribe(self):
        """Inscrição global do aparelho do cliente (recebe avisos da loja)."""
        if _webpush is None:
            return self._err(503, 'avisos indisponíveis nesta versão')
        if not rate_ok('bsub:%s' % self.client_address[0], 20):
            return self._err(429, 'muitas inscrições, aguarde um minuto')
        sub = _clean_sub(self._body())
        if not sub:
            return self._err(400, 'inscrição inválida')
        with LOCK:
            data = load()
            subs = [s for s in (data.get('broadcast_subs') or [])
                    if s.get('endpoint') != sub['endpoint']]
            sub['addedAt'] = int(time.time())
            subs.append(sub)
            data['broadcast_subs'] = subs[-_BROADCAST_MAX:]
            save(data)
            count = len(_all_app_subs(data))
        return self._json({'ok': True, 'subscribers': count})

    def _send_broadcast(self, b):
        """Envia um aviso promocional para todos os aparelhos dos clientes."""
        if _webpush is None:
            return self._err(503, 'avisos indisponíveis nesta versão')
        title = str(b.get('title') or '').strip()[:70]
        body = str(b.get('body') or '').strip()[:180]
        url = str(b.get('url') or '').strip()[:300]
        if not title or not body:
            return self._err(400, 'título e mensagem são obrigatórios')
        if url and not (url.startswith('/') or url.startswith('https://')):
            return self._err(400, 'link inválido')
        if not rate_ok('bc:%s' % self.client_address[0], 6, 60):
            return self._err(429, 'muitos avisos seguidos — aguarde um minuto')
        with LOCK:
            data = load()
            subs = _all_app_subs(data)
            entry = {'title': title, 'body': body, 'url': url,
                     'at': int(time.time()), 'total': len(subs)}
            log = data.get('broadcast_log') or []
            log.insert(0, entry)
            data['broadcast_log'] = log[:30]
            save(data)
        if not subs:
            return self._json({'ok': True, 'targets': 0,
                               'message': 'nenhum aparelho inscrito ainda'})
        threading.Thread(target=_push_broadcast, daemon=True,
                         args=(title, body, url, subs)).start()
        return self._json({'ok': True, 'targets': len(subs)})

    def _admin_push_save(self):
        """Guarda a inscrição de push do aparelho que está com o painel aberto."""
        if _webpush is None:
            return self._err(503, 'avisos indisponíveis nesta versão')
        if not rate_ok('apush:%s' % self.client_address[0], 20):
            return self._err(429, 'muitas inscrições, aguarde um minuto')
        sub = _clean_sub(self._body())
        if not sub:
            return self._err(400, 'inscrição inválida')
        with LOCK:
            data = load()
            subs = [s for s in (data.get('admin_push_subs') or [])
                    if s.get('endpoint') != sub['endpoint']]
            subs.append(sub)
            data['admin_push_subs'] = subs[-_ADMIN_PUSH_MAX:]
            save(data)
            count = len(data['admin_push_subs'])
        return self._json({'ok': True, 'count': count})

    def _push_subscribe(self, num, query):
        """Guarda a inscrição de push do aparelho para este pedido."""
        if _webpush is None:
            return self._err(503, 'avisos indisponíveis nesta versão')
        if not rate_ok('pweb:%s' % self.client_address[0], 30):
            return self._err(429, 'muitas inscrições, aguarde um minuto')
        token = (query.get('t') or [''])[0]
        sub = _clean_sub(self._body())
        if not sub:
            return self._err(400, 'inscrição inválida')
        with LOCK:
            data = load()
            o = next((x for x in data.get('orders', [])
                      if str(x.get('num')) == num), None)
            if not o or not _token_eq(token, o.get('token')):
                return self._err(404, 'pedido não encontrado')
            if int(o.get('status') or 1) >= 4:
                return self._err(409, 'pedido já entregue')
            subs = [s for s in (o.get('push_subs') or [])
                    if s.get('endpoint') != sub['endpoint']]
            subs.append(sub)
            o['push_subs'] = subs[-PUSH_MAX_SUBS:]
            save(data)
            count = len(o['push_subs'])
        return self._json({'ok': True, 'count': count})

    def _save_store(self, b):
        data = load()
        st = data['store']
        for k in ('name', 'tagline', 'logo', 'whatsapp', 'hours', 'address'):
            if k in b:
                st[k] = str(b[k])[:200]
        if 'email' in b:
            em = str(b['email'] or '').strip().lower()[:120]
            st['email'] = em if re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', em) else ''
        for k in ('fee', 'minOrder'):
            if k in b:
                try:
                    st[k] = max(0.0, round(float(b[k]), 2))
                except (TypeError, ValueError):
                    pass
        if 'open' in b:
            st['open'] = bool(b['open'])
        if 'hoursAuto' in b:
            st['hoursAuto'] = bool(b['hoursAuto'])
        if isinstance(b.get('schedule'), list):
            st['schedule'] = schedule_cfg({'schedule': b['schedule']})
        if 'originCep' in b:
            cep = norm_cep(b['originCep'])
            if cep != norm_cep(st.get('originCep')):
                st['originLat'] = None
                st['originLon'] = None
            st['originCep'] = cep
        if isinstance(b.get('delivery'), dict):
            d = b['delivery']
            cfg = delivery_cfg(st)
            if d.get('mode') in ('fixed', 'km'):
                cfg['mode'] = d['mode']
            for k in ('base', 'perKm', 'minFee'):
                if k in d:
                    try:
                        cfg[k] = max(0.0, round(float(d[k]), 2))
                    except (TypeError, ValueError):
                        pass
            if 'maxKm' in d:
                try:
                    cfg['maxKm'] = max(0.0, min(100.0, round(float(d['maxKm']), 1)))
                except (TypeError, ValueError):
                    pass
            if 'roadFactor' in d:
                try:
                    cfg['roadFactor'] = max(1.0, min(3.0, round(float(d['roadFactor']), 2)))
                except (TypeError, ValueError):
                    pass
            st['delivery'] = cfg
        if isinstance(b.get('banners'), list):
            st['banners'] = banners_cfg(st, b['banners'])
        if isinstance(b.get('extras'), list):
            st['extras'] = extras_cfg(st, b['extras'])
        if isinstance(b.get('categories'), list):
            st['categories'] = cats_cfg(st, b['categories'])
        if isinstance(b.get('popup'), dict):
            st['popup'] = popup_cfg(st, b['popup'])
        if isinstance(b.get('sizes'), list):
            st['sizes'] = sizes_cfg(st, b['sizes'])
        if isinstance(b.get('popular'), list):
            st['popular'] = popular_cfg({'popular': b['popular']})
        if isinstance(b.get('coupons'), dict):
            clean = {}
            for code, pct in b['coupons'].items():
                code = str(code).upper().strip()[:20]
                if not code:
                    continue
                try:
                    v = float(pct)
                except (TypeError, ValueError):
                    continue
                if 0 < v < 1:
                    clean[code] = round(v, 3)
            st['coupons'] = clean
        save(data)
        out = dict(st)
        out['openNow'] = is_open_now(st)
        out['hoursText'] = hours_text(st)
        return self._json({'ok': True, 'store': out})

    def _save_product(self, b, pid):
        data = load()
        prods = data['products']

        if pid is None:
            name = str(b.get('name') or '').strip()
            if not name:
                return self._err(400, 'nome é obrigatório')
            pid = slug(name)
            base_id, n = pid, 2
            while any(p.get('id') == pid for p in prods):
                pid = '%s-%d' % (base_id, n)
                n += 1
            prods.append({'id': pid, 'name': name, 'cat': 'bolos', 'price': 0.0,
                          'rating': 4.8, 'time': 'Encomenda · 1 dia', 'kcal': 0, 'tag': '',
                          'img': '', 'desc': '', 'active': True, 'stock': None,
                          'extras': None, 'sizes': None})

        p = next((x for x in prods if x.get('id') == pid), None)
        if not p:
            return self._err(404, 'produto não encontrado')

        if 'name' in b:
            p['name'] = str(b['name']).strip()[:80] or p['name']
        if 'cat' in b:
            p['cat'] = str(b['cat'])[:24]
        if 'desc' in b:
            p['desc'] = str(b['desc'])[:400]
        if 'tag' in b:
            p['tag'] = str(b['tag'])[:30]
        if 'time' in b:
            p['time'] = str(b['time'])[:30]
        if 'img' in b:
            p['img'] = str(b['img'])[:200]
        if 'price' in b:
            try:
                p['price'] = max(0.0, round(float(b['price']), 2))
            except (TypeError, ValueError):
                pass
        if 'kcal' in b:
            try:
                p['kcal'] = max(0, int(float(b['kcal'])))
            except (TypeError, ValueError):
                pass
        if 'rating' in b:
            try:
                p['rating'] = min(5.0, max(0.0, round(float(b['rating']), 1)))
            except (TypeError, ValueError):
                pass
        if 'active' in b:
            p['active'] = bool(b['active'])
        if 'stock' in b:
            if b['stock'] is None or b['stock'] == '':
                p['stock'] = None
            else:
                try:
                    p['stock'] = max(0, int(float(b['stock'])))
                except (TypeError, ValueError):
                    p['stock'] = None
        if 'extras' in b:
            if b['extras'] is None:
                p['extras'] = None   # None = todos os adicionais da loja
            elif isinstance(b['extras'], list):
                ids = []
                for eid in b['extras'][:24]:
                    eid = str(eid or '').strip()[:40]
                    if eid and eid not in ids:
                        ids.append(eid)
                p['extras'] = ids
        if 'sizes' in b:
            if b['sizes'] is None:
                p['sizes'] = None    # None = todos os tamanhos da loja
            elif isinstance(b['sizes'], list):
                ids = []
                for sid in b['sizes'][:6]:
                    sid = str(sid or '').strip()[:30]
                    if sid and sid not in ids:
                        ids.append(sid)
                p['sizes'] = ids

        save(data)
        return self._json({'ok': True, 'product': p})

    def _upload(self, b):
        data_url = b.get('data') or ''
        if not data_url:
            return self._err(400, 'imagem vazia')
        if ',' in data_url:
            head, data_url = data_url.split(',', 1)
            mime = re.search(r'data:([\w/+.-]+)', head or '')
            mime = mime.group(1) if mime else 'image/png'
        else:
            mime = b.get('type') or 'image/png'

        try:
            raw = base64.b64decode(data_url, validate=False)
        except Exception:
            return self._err(400, 'base64 inválido')

        if not raw or len(raw) > MAX_UPLOAD:
            return self._err(413, 'imagem muito grande (máx. 4 MB)')

        ext = {'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png'}.get(mime, 'png')
        name = 'p%s.%s' % (uuid.uuid4().hex[:10], ext)
        if DB_MODE:
            db_put_upload(name, mime, raw)
        else:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            with open(os.path.join(UPLOAD_DIR, name), 'wb') as f:
                f.write(raw)

        return self._json({'ok': True, 'path': 'uploads/' + name})

    def _create_order(self, b):
        items = b.get('items') or []
        if not isinstance(items, list) or not items:
            return self._err(400, 'carrinho vazio')

        data = load()
        st = data['store']
        if not is_open_now(st):
            return self._err(409, 'a loja está fechada no momento')

        prods = {p['id']: p for p in data['products']}
        for bp in banner_products(st):
            prods.setdefault(bp['id'], bp)
        total = 0.0
        clean = []

        for it in items:
            pid = it.get('pid')
            p = prods.get(pid)
            if not p or p.get('active') is False:
                return self._err(409, 'produto indisponível: %s' % pid)
            try:
                qty = max(1, min(50, int(it.get('qty') or 1)))
                unit = max(0.0, float(it.get('unit') or p['price']))
            except (TypeError, ValueError):
                return self._err(400, 'item inválido')
            stock = p.get('stock')
            if stock is not None and stock < qty:
                return self._err(409, 'sem estoque: %s' % p['name'])
            total += unit * qty
            clean.append({'pid': pid, 'name': p['name'], 'img': p.get('img', ''),
                          'qty': qty, 'unit': round(unit, 2),
                          'size': it.get('size'), 'extras': it.get('extras') or [],
                          'note': str(it.get('note') or '')[:200]})

        for it in clean:
            p = prods[it['pid']]
            if p.get('stock') is not None:
                p['stock'] = max(0, p['stock'] - it['qty'])

        cep = norm_cep(b.get('cep'))
        geo = calc_fee(data, cep)
        if not geo.get('ok'):
            return self._err(409, 'não entregamos nesse endereço (%.1f km)'
                             % (geo.get('km') or 0))
        fee = float(geo.get('fee') or 0)

        # coordenadas do destino para o mapa do rastreio (modo fixo também resolve)
        dest = None
        try:
            if geo.get('lat') is not None and geo.get('lon') is not None:
                dest = (float(geo['lat']), float(geo['lon']))
        except (TypeError, ValueError):
            dest = None
        if dest is None and cep:
            r = resolve_cep(cep)
            if r.get('lat') is not None:
                dest = (float(r['lat']), float(r['lon']))
        nums = [int(o.get('num', 0)) for o in data['orders'] if str(o.get('num', '')).isdigit()]
        num = (max(nums) + 1) if nums else 1001

        order = {
            'num': str(num),
            'items': clean,
            'subtotal': round(total, 2),
            'fee': round(fee, 2),
            'total': round(total + fee, 2),
            'pay': str(b.get('pay') or 'pix')[:20],
            'name': str(b.get('name') or '')[:60],
            'phone': re.sub(r'\D', '', str(b.get('phone') or ''))[:13],
            'token': uuid.uuid4().hex[:16],
            'mtoken': uuid.uuid4().hex[:16],
            'cep': geo.get('cep') or cep,
            'km': geo.get('km'),
            'feeSource': geo.get('source'),
            'destLat': round(dest[0], 5) if dest else None,
            'destLon': round(dest[1], 5) if dest else None,
            'addr': str(b.get('addr') or st.get('address') or '')[:200],
            'time': time.strftime('%H:%M'),
            'createdAt': int(time.time()),
            'status': 1,
            'paid': False,
        }

        # Pix automático: cobra na conta do Mercado Pago configurada no painel.
        # Se o MP falhar, o pedido é criado do mesmo jeito (pix fica de fora).
        if order['pay'] == 'pix':
            pix = mp_pix(data, order, self._base_url())
            if pix:
                order['pix'] = pix

        data['orders'].insert(0, order)
        data['orders'] = data['orders'][:300]
        save(data)
        _push_notify_admin(data, order)

        # resposta pública: sem o mtoken (o link do motoboy só sai pelo painel)
        return self._json({'ok': True,
                           'order': {k: v for k, v in order.items() if k != 'mtoken'}})

    def _create_pdv_sale(self, b):
        """venda de balcão: vale fora do horário, sem frete, já concluída"""
        items = b.get('items') or []
        if not isinstance(items, list) or not items:
            return self._err(400, 'venda sem itens')

        data = load()
        prods = {p['id']: p for p in data['products']}
        for bp in banner_products(data['store']):
            prods.setdefault(bp['id'], bp)
        subtotal = 0.0
        clean = []

        for it in items:
            pid = it.get('pid')
            p = prods.get(pid)
            if not p:
                return self._err(409, 'produto indisponível: %s' % pid)
            try:
                qty = max(1, min(50, int(it.get('qty') or 1)))
                unit = it.get('unit')
                unit = max(0.0, float(p['price'] if unit is None else unit))
            except (TypeError, ValueError):
                return self._err(400, 'item inválido')
            stock = p.get('stock')
            if stock is not None and stock < qty:
                return self._err(409, 'sem estoque: %s' % p['name'])
            ex = it.get('extras') or []
            if not isinstance(ex, list):
                ex = []
            subtotal += unit * qty
            clean.append({'pid': pid, 'name': p['name'], 'img': p.get('img', ''),
                          'qty': qty, 'unit': round(unit, 2),
                          'size': it.get('size'),
                          'extras': [str(x)[:40] for x in ex][:10],
                          'note': str(it.get('note') or '')[:200]})

        try:
            disc = max(0.0, float(b.get('discount') or 0))
        except (TypeError, ValueError):
            return self._err(400, 'desconto inválido')
        if b.get('discountType') == 'pct':
            disc = subtotal * min(100.0, disc) / 100.0
        disc = min(subtotal, round(disc, 2))
        total = round(subtotal - disc, 2)

        for it in clean:
            p = prods[it['pid']]
            if p.get('stock') is not None:
                p['stock'] = max(0, p['stock'] - it['qty'])

        nums = [int(o.get('num', 0)) for o in data['orders'] if str(o.get('num', '')).isdigit()]
        num = (max(nums) + 1) if nums else 1001

        order = {
            'num': str(num),
            'items': clean,
            'subtotal': round(subtotal, 2),
            'discount': round(disc, 2),
            'fee': 0.0,
            'total': total,
            'pay': str(b.get('pay') or 'cash')[:20],
            'name': str(b.get('name') or 'Balcão')[:60],
            'phone': '',
            'token': uuid.uuid4().hex[:16],
            'mtoken': '',
            'cep': '',
            'km': None,
            'feeSource': 'pdv',
            'destLat': None,
            'destLon': None,
            'addr': 'Balcão',
            'time': time.strftime('%H:%M'),
            'createdAt': int(time.time()),
            'status': 4,
            'paid': True,
            'paidVia': 'pdv',
            'channel': 'pdv',
            'note': str(b.get('note') or '')[:200]
        }
        data['orders'].insert(0, order)
        data['orders'] = data['orders'][:300]
        save(data)
        return self._json({'ok': True, 'order': order})

    # ---------- motoboy ----------

    def _motoboy_order(self, b):
        """Valida num + mtoken. Retorna (pedido, data) ou None (já respondeu)."""
        num = str(b.get('num') or '')
        if not rate_ok('mb:%s' % num[:12], 60):
            self._err(429, 'muitos envios, aguarde um minuto')
            return None
        data = load()
        o = next((x for x in data.get('orders', []) if str(x.get('num')) == num), None)
        if not o or not _token_eq(b.get('t'), o.get('mtoken')):
            self._err(404, 'link inválido ou expirado')
            return None
        return o, data

    def _motoboy_location(self, b):
        got = self._motoboy_order(b)
        if not got:
            return
        o, data = got
        num = str(o.get('num'))
        if int(o.get('status') or 1) != 3:
            return self._json({'error': 'entrega não está em andamento',
                               'status': o.get('status') or 1}, 409)
        try:
            lat, lon = float(b.get('lat')), float(b.get('lon'))
        except (TypeError, ValueError):
            return self._err(400, 'posição inválida')
        if not _inside_brazil(lat, lon):
            return self._err(400, 'posição inválida')

        def clamp(v, lo, hi):
            try:
                return max(lo, min(hi, float(v)))
            except (TypeError, ValueError):
                return None

        acc = clamp(b.get('acc'), 0, 5000)
        speed = clamp(b.get('speed'), 0, 90)
        heading = clamp(b.get('heading'), 0, 360)
        if heading is not None:
            heading = int(round(heading)) % 360

        now = int(time.time())
        track = _track_all()
        ent = _track_ent(track, num, True)
        ent['courier'] = {'lat': round(lat, 5), 'lon': round(lon, 5),
                          'heading': heading,
                          'speed': round(speed, 1) if speed is not None else None,
                          'acc': int(round(acc)) if acc is not None else None,
                          'updatedAt': now}
        idx = int(ent.get('idx') or 0)
        route = ent.get('route') or {}
        coords = route.get('coords') or []
        if coords:
            idx = nearest_on_route(coords, lat, lon, idx)
            ent['idx'] = idx
        ent['updatedAt'] = now
        _track_save(track, data)
        n = len(coords) - 1
        return self._json({'ok': True, 'updatedAt': now, 'idx': idx,
                           'progress': round(idx / float(n), 4) if n > 0 else 0})

    def _motoboy_status(self, b):
        got = self._motoboy_order(b)
        if not got:
            return
        o, data = got
        num = str(o.get('num'))
        try:
            want = int(b.get('status'))
        except (TypeError, ValueError):
            return self._err(400, 'status inválido')
        if want not in (3, 4):
            return self._err(400, 'status inválido')
        cur = int(o.get('status') or 1)
        if want < cur:
            return self._err(409, 'o pedido já está em outra etapa')
        if want == cur:
            return self._json({'ok': True, 'order': public_order(o)})

        o['status'] = want
        save(data)
        _push_notify(data, o, want)       # avisa o cliente (a caminho / entregue)
        now = int(time.time())
        track = _track_all()
        ent = _track_ent(track, num, True)
        ent['updatedAt'] = now
        if want == 3:
            ent['startedAt'] = ent.get('startedAt') or now
            origin, dest = store_origin_any(data), order_dest(o)
            if origin and dest:
                ensure_route(track, num, origin, dest)
        else:
            ent['deliveredAt'] = now
            ent.pop('courier', None)   # posição some ao entregar
            ent.pop('idx', None)
        _track_save(track, data)
        return self._json({'ok': True, 'order': public_order(o)})


def main():
    if DB_MODE:
        db_init()
    else:
        if not os.path.exists(DATA_PATH):
            save(DEFAULT)
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('')
    print('  🍰  Delícias do Aleff')
    print('  App ....... http://localhost:%d/' % PORT)
    print('  Painel .... http://localhost:%d/painel' % PORT)
    print('  PIN ....... %s' % (current_pin() if not DB_MODE else 'definido no painel'))
    print('  Dados ..... %s' % ('Neon/Postgres' if DB_MODE else DATA_PATH))
    print('')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n  encerrado')


if __name__ == '__main__':
    main()
