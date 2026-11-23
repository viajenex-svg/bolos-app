/* Pedidos ao vivo — quadro da cozinha */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var PIN_KEY = 'sc-admin-pin';
  var pin = localStorage.getItem(PIN_KEY) || '';
  var POLL = 5000;

  var STATUS = ['Recebido', 'No forno', 'A caminho', 'Entregue'];
  var PAY = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro' };

  var orders = [];
  var filter = 'live';
  var seen = {};           /* num → true: já contabilizado pro aviso */
  var firstLoad = true;
  var timer = null;
  var soundOn = localStorage.getItem('sc-orders-sound') !== 'off';
  var audio = null;

  // ---------------------------------------------------------------- util

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }

  function ago(ts) {
    if (!ts) return '';
    var s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (s < 60) return 'agora';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'há ' + h + 'h';
    return 'há ' + Math.floor(h / 24) + 'd';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'X-Pin': pin };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.error || ('erro ' + r.status));
          e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error('não consegui copiar'));
    });
  }

  function fmtPhone(d) {
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return d;
  }

  // ---------------------------------------------------------------- som

  function unlockAudio() {
    if (audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audio = new AC(); } catch (e) { audio = null; }
  }

  function chime() {
    if (!soundOn || !audio) return;
    if (audio.state === 'suspended') audio.resume();
    var t0 = audio.currentTime;
    [880, 1174.7].forEach(function (f, i) {
      var o = audio.createOscillator();
      var g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      o.connect(g);
      g.connect(audio.destination);
      o.start(t0 + i * 0.18);
      o.stop(t0 + i * 0.18 + 0.55);
    });
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }

  function updateSoundBtn() {
    var b = $('#soundBtn');
    b.textContent = soundOn ? '🔔' : '🔕';
    b.classList.toggle('on', soundOn);
    b.setAttribute('aria-label', soundOn ? 'Desligar som' : 'Ligar som');
  }

  $('#soundBtn').addEventListener('click', function () {
    soundOn = !soundOn;
    localStorage.setItem('sc-orders-sound', soundOn ? 'on' : 'off');
    unlockAudio();
    updateSoundBtn();
    if (soundOn) { chime(); requestNotify(); }
  });

  function requestNotify() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function notifyNew(o) {
    chime();
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('Novo pedido #' + o.num, {
          body: (o.items || []).map(function (i) { return i.qty + '× ' + i.name; }).join(', '),
          icon: '/icons/icon-192.png',
          tag: 'pedido-' + o.num
        });
      } catch (e) { /* ignora */ }
    }
  }

  // ---------------------------------------------------------------- login

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var val = $('#pinInput').value.trim();
    if (!val) return;
    var err = $('#loginErr');
    err.hidden = true;
    api('/api/auth', { method: 'POST', body: { pin: val } }).then(function () {
      pin = val;
      localStorage.setItem(PIN_KEY, pin);
      unlockAudio();
      requestNotify();
      start();
    }).catch(function (e) {
      err.hidden = false;
      err.textContent = e.status === 401
        ? 'PIN incorreto. O padrão é 1234.'
        : 'Servidor não respondeu (HTTP ' + (e.status || 'sem conexão') + '). Abra em http://' + location.hostname + ':8001/pedidos/';
    });
  });

  // ---------------------------------------------------------------- dados

  function start() {
    $('#login').hidden = true;
    $('#board').hidden = false;
    updateSoundBtn();
    fetchOrders();
    clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden) fetchOrders();
    }, POLL);
    keepAwake();
  }

  function fetchOrders() {
    api('/api/admin/orders').then(function (d) {
      var list = (d.orders || []).slice().sort(function (a, b) {
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      });
      var fresh = list.filter(function (o) {
        return Number(o.status) === 1 && !seen[o.num];
      });
      list.forEach(function (o) { seen[o.num] = true; });
      orders = list;
      render();
      if (!firstLoad && fresh.length) {
        fresh.slice(0, 3).forEach(notifyNew);
        if (fresh.length > 3) toast('+' + (fresh.length - 3) + ' pedidos novos');
      }
      firstLoad = false;
      $('#liveLed').classList.remove('off');
    }).catch(function (e) {
      $('#liveLed').classList.add('off');
      if (e.status === 401) {
        localStorage.removeItem(PIN_KEY);
        pin = '';
        $('#board').hidden = true;
        $('#login').hidden = false;
        $('#loginErr').hidden = false;
        $('#loginErr').textContent = 'Sessão expirada. Entre de novo.';
      }
      /* outros erros: mantém a tela e tenta no próximo ciclo */
    });
  }

  // ---------------------------------------------------------------- render

  function inFilter(o) {
    var st = Number(o.status) || 1;
    if (filter === 'live') return st === 1;
    if (filter === 'doing') return st === 2 || st === 3;
    if (filter === 'done') return st === 4;
    return true;
  }

  function itemHTML(it) {
    var extra = [];
    if (it.size) extra.push(esc(it.size));
    (it.extras || []).forEach(function (x) {
      extra.push(esc(typeof x === 'string' ? x : (x.name || '')));
    });
    return '<li class="item">' +
      '<div class="item-top"><b><em>' + (Number(it.qty) || 1) + '×</em>' + esc(it.name) + '</b>' +
      '<span>' + money((Number(it.unit) || 0) * (Number(it.qty) || 1)) + '</span></div>' +
      (extra.length ? '<small>' + extra.join(' · ') + '</small>' : '') +
      (it.note ? '<span class="note">' + esc(it.note) + '</span>' : '') +
      '</li>';
  }

  function stepsHTML(o) {
    var st = Math.min(4, Math.max(1, Number(o.status) || 1));
    var short = ['Recebido', 'No forno', 'A caminho', 'Entregue'];
    return '<div class="steps">' + short.map(function (lbl, i) {
      var n = i + 1;
      var cls = n === st ? 'on' : (n === st + 1 ? 'next' : '');
      return '<button type="button" class="step ' + cls + '" data-num="' + esc(o.num) + '" data-status="' + n + '"' +
        (n === st ? ' disabled' : '') + '>' + lbl + '</button>';
    }).join('') + '</div>';
  }

  function cardHTML(o) {
    var st = Math.min(4, Math.max(1, Number(o.status) || 1));
    var when = o.createdAt
      ? new Date(Number(o.createdAt) * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : (o.time || '—');
    var tel = String(o.phone || '').replace(/\D/g, '');
    var mbHref = o.mtoken
      ? location.origin + '/motoboy/?o=' + encodeURIComponent(o.num) + '&t=' + encodeURIComponent(o.mtoken)
      : '';
    return '<article class="order st' + st + '" data-num="' + esc(o.num) + '">' +
      '<div class="oh"><span class="num">#' + esc(o.num) + '</span>' +
      '<span class="meta"><b>' + STATUS[st - 1] + '</b><small>' + when + ' · ' + ago(o.createdAt) + '</small></span></div>' +
      '<div class="cust">👤 <b>' + esc(o.name || 'Cliente') + '</b>' +
      (tel ? '<a href="tel:' + esc(tel) + '">📞 ' + esc(fmtPhone(tel)) + '</a>' : '') +
      '</div>' +
      '<ul class="items">' + (o.items || []).map(itemHTML).join('') + '</ul>' +
      '<div class="meta-row">' +
      '<span>📍 <b>' + esc(o.addr || '—') + '</b></span>' +
      '<span>💳 <b>' + esc(PAY[o.pay] || o.pay || '—') + '</b></span>' +
      '</div>' +
      '<div class="total-row"><span class="lbl">Total</span><span class="val">' + money(o.total) + '</span></div>' +
      stepsHTML(o) +
      '<div class="mb-line">' +
      (mbHref ? '<a class="mb-link" href="' + esc(mbHref) + '" target="_blank" rel="noopener">🛵 Link do motoboy</a>' +
        '<button type="button" class="mb-copy" data-copy="' + esc(mbHref) + '">Copiar link</button>' : '') +
      '<button type="button" class="order-del" data-odel aria-label="Apagar pedido">🗑 Apagar</button>' +
      '</div>' +
      '</article>';
  }

  function render() {
    var live = orders.filter(function (o) { return Number(o.status) === 1; }).length;
    var doing = orders.filter(function (o) { var s = Number(o.status); return s === 2 || s === 3; }).length;
    var done = orders.filter(function (o) { return Number(o.status) === 4; }).length;

    $('#cLive').textContent = live;
    $('#cDoing').textContent = doing;
    $('#cDone').textContent = done;
    $('#pendingCount').hidden = live === 0;
    $('#pendingCount').textContent = live;

    document.title = (live ? '(' + live + ') ' : '') + 'Pedidos — Delícias do Aleff';

    var list = orders.filter(inFilter);
    if (filter === 'done' || filter === 'all') list = list.slice(0, 30);

    $('#ordersList').innerHTML = list.map(cardHTML).join('');
    $('#emptyState').hidden = list.length > 0;
    if (!list.length) {
      var txt = {
        live: 'Nenhum pedido novo',
        doing: 'Nada em andamento',
        done: 'Nenhum pedido entregue ainda',
        all: 'Nenhum pedido por aqui'
      }[filter];
      $('#emptyState b').textContent = txt;
    }
  }

  // ---------------------------------------------------------------- ações

  $('#filters').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    filter = b.getAttribute('data-filter');
    $$('.chip').forEach(function (c) { c.classList.toggle('is-on', c === b); });
    render();
  });

  $('#ordersList').addEventListener('click', function (e) {
    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      copyText(copyBtn.getAttribute('data-copy'))
        .then(function () { toast('Link do motoboy copiado'); })
        .catch(function (err) { toast(err.message); });
      return;
    }

    var delBtn = e.target.closest('[data-odel]');
    if (delBtn) {
      var dcard = delBtn.closest('.order');
      var dnum = dcard.getAttribute('data-num');
      if (!confirm('Apagar o pedido #' + dnum + '?\n\nEle sai do quadro, do painel e do histórico. Não dá para desfazer.')) return;
      delBtn.disabled = true;
      api('/api/admin/orders/' + encodeURIComponent(dnum), { method: 'DELETE' })
        .then(function () {
          orders = orders.filter(function (o) { return String(o.num) !== String(dnum); });
          delete seen[dnum];
          render();
          toast('Pedido #' + dnum + ' apagado');
        })
        .catch(function (err) {
          delBtn.disabled = false;
          toast('Não deu: ' + err.message);
        });
      return;
    }

    var b = e.target.closest('.step');
    if (!b || b.disabled) return;
    var num = b.getAttribute('data-num');
    var status = Number(b.getAttribute('data-status'));
    b.disabled = true;
    api('/api/admin/orders/' + encodeURIComponent(num), { method: 'PUT', body: { status: status } })
      .then(function () {
        orders = orders.map(function (o) {
          if (String(o.num) === String(num)) o.status = status;
          return o;
        });
        render();
        toast('#' + num + ' → ' + STATUS[status - 1]);
      })
      .catch(function (err) {
        b.disabled = false;
        toast('Não deu: ' + err.message);
      });
  });

  $('#fullBtn').addEventListener('click', function () {
    var el = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(function () { toast('Tela cheia não disponível'); });
    } else {
      toast('Tela cheia não disponível neste navegador');
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && pin) fetchOrders();
  });

  /* tela não apaga enquanto o quadro está aberto (quando suportado) */
  function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    var lock = null;
    function acquire() {
      navigator.wakeLock.request('screen').then(function (l) {
        lock = l;
        l.addEventListener('release', function () { lock = null; });
      }).catch(function () { /* ignora */ });
    }
    acquire();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !lock) acquire();
    });
  }

  // ---------------------------------------------------------------- start

  updateSoundBtn();
  if (pin) {
    start();
  } else {
    setTimeout(function () { $('#pinInput').focus(); }, 100);
  }
})();
