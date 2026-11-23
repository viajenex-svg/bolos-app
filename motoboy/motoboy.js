/* App do motoboy — abre por link do painel (?o=<num>&t=<mtoken>),
   marca "a caminho"/"entregue" e compartilha a posição enquanto a entrega roda. */
(function () {
  'use strict';

  var PAY_TEXT = { pix: 'Pix', card: 'Cartão na entrega', cash: 'Dinheiro' };
  var ST_TEXT = ['', 'Pedido recebido', 'No forno', 'A caminho', 'Entregue'];

  /* entregador de moto (boneco em SVG) no marcador do mapa */
  var RIDER_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="32" cy="55" rx="21" ry="4" fill="#2b2118" opacity=".18"/>' +
    '<circle cx="17" cy="46" r="8" fill="#2b2118"/><circle cx="17" cy="46" r="3" fill="#f6ece1"/>' +
    '<circle cx="47" cy="46" r="8" fill="#2b2118"/><circle cx="47" cy="46" r="3" fill="#f6ece1"/>' +
    '<path d="M13 40c0-5 4-8 9-8h9l4 8z" fill="#f4761d"/>' +
    '<rect x="30" y="36" width="13" height="5" rx="2.5" fill="#3a2e24"/>' +
    '<path d="M40 41l6-16" stroke="#f4761d" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M44 25h6" stroke="#2b2118" stroke-width="3.5" stroke-linecap="round"/>' +
    '<rect x="15" y="29" width="15" height="6" rx="3" fill="#2b2118"/>' +
    '<rect x="12" y="15" width="14" height="15" rx="3" fill="#e2574c"/>' +
    '<rect x="12" y="15" width="14" height="5" rx="2.5" fill="#f4761d"/>' +
    '<path d="M30 30l4 6 5 3" stroke="#3c5a78" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M30 31l5-14" stroke="#f4761d" stroke-width="9" stroke-linecap="round"/>' +
    '<path d="M35 18l9 8" stroke="#f4761d" stroke-width="6" stroke-linecap="round"/>' +
    '<circle cx="45" cy="26" r="2.6" fill="#8d5a3b"/>' +
    '<circle cx="36" cy="12" r="6.5" fill="#2b2118"/>' +
    '<path d="M35 8.5h4a3.5 3.5 0 0 1 0 7h-4z" fill="#cfe6f2"/>' +
    '</svg>';
  var SEND_MS = 10000;   /* no máximo um envio a cada 10 s... */
  var SEND_M = 25;       /* ...ou quando andar mais de 25 m. */
  var POLL_MS = 30000;

  var $ = function (id) { return document.getElementById(id); };

  function qparam(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  var num = qparam('o') || '';
  var tok = qparam('t') || '';

  var S = {
    order: null,
    status: 0,
    busy: false,
    watchId: null,
    lastSentAt: 0,
    lastSent: null,
    lastFix: null,
    pollTimer: null,
    wake: null,
    map: null,
    layers: {},
    routeCoords: null,
    fitted: false
  };

  /* ---------------- utilidades ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function brl(v) {
    return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
  }

  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function apiGet(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (d) { return { code: r.status, data: d }; },
                          function () { return { code: r.status, data: {} }; });
    });
  }

  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) { return { code: r.status, data: d }; },
                          function () { return { code: r.status, data: {} }; });
    });
  }

  function distanceM(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ---------------- telas ---------------- */

  function errorCard(title, msg) {
    $('loading').hidden = true;
    $('main').hidden = true;
    $('bar').hidden = true;
    $('doneCard').hidden = true;
    $('errTitle').textContent = title;
    $('errMsg').textContent = msg;
    $('errorCard').hidden = false;
  }

  function renderOrder(o) {
    var nm = o.store || '';
    if (nm) $('brandName').textContent = nm;
    $('cName').textContent = o.name || 'Cliente';
    $('cAddr').textContent = o.addr || 'Endereço não informado';
    $('cPay').textContent = PAY_TEXT[o.pay] || o.pay || '—';
    $('cTotal').textContent = brl(o.total);

    var tel = onlyDigits(o.phone);
    var call = $('callBtn');
    if (tel) { call.href = 'tel:' + tel; call.hidden = false; }
    else call.hidden = true;

    var items = o.items || [];
    var box = $('itemsCard');
    if (items.length) {
      var html = '<div class="lbl">Itens do pedido</div>';
      for (var i = 0; i < items.length; i++) {
        html += '<div class="row"><span>' + esc(items[i].name) + '</span>' +
                '<b>' + (Number(items[i].qty) || 1) + '×</b></div>';
      }
      box.innerHTML = html;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function renderNav(d) {
    var o = (d && d.order) || S.order || {};
    var dest = (d && d.dest) || null;
    var coords = d && d.route && d.route.coords;
    if (!dest && coords && coords.length > 1) {
      var last = coords[coords.length - 1];
      dest = { lat: last[0], lon: last[1] };
    }
    var addr = o.addr || '';
    var row = $('navRow');
    if (!dest && !addr) { row.hidden = true; return; }
    row.hidden = false;
    if (dest) {
      var ll = Number(dest.lat).toFixed(6) + ',' + Number(dest.lon).toFixed(6);
      $('wazeBtn').href = 'https://waze.com/ul?ll=' + ll + '&navigate=yes';
      $('mapsBtn').href = 'https://www.google.com/maps/dir/?api=1&destination=' +
        ll + '&travelmode=driving';
    } else {
      var q = encodeURIComponent(addr);
      $('wazeBtn').href = 'https://waze.com/ul?q=' + q + '&navigate=yes';
      $('mapsBtn').href = 'https://www.google.com/maps/dir/?api=1&destination=' +
        q + '&travelmode=driving';
    }
  }

  function renderStatus(st) {
    var pill = $('statusPill');
    pill.className = 'pill' + (st === 3 ? ' s3' : st === 4 ? ' s4' : '');
    pill.textContent = ST_TEXT[st] || '—';

    var b = $('actionBtn');
    b.className = 'btn ' + (st === 3 ? 'finish' : 'go');
    b.textContent = st === 3 ? 'Entregue ✓' : st >= 4 ? 'Entregue' : 'Iniciar entrega';
    b.disabled = S.busy || st >= 4;

    var dot = $('liveDot');
    dot.className = 'dot' + (st === 3 ? ' on' : '');
  }

  function finishUI() {
    S.status = 4;
    stopAll();
    renderStatus(4);
    $('main').hidden = true;
    $('bar').hidden = true;
    $('loading').hidden = true;
    $('errorCard').hidden = true;
    $('doneCard').hidden = false;
  }

  /* ---------------- carregar ---------------- */

  function boot() {
    if (!num || !tok) {
      errorCard('Abra o link enviado pelo painel',
        'Este endereço não tem o pedido. O link do motoboy é gerado no painel da loja, no próprio pedido.');
      return;
    }
    load();
  }

  function load() {
    $('loading').hidden = false;
    apiGet('/api/motoboy/order?num=' + encodeURIComponent(num) + '&t=' + encodeURIComponent(tok))
      .then(function (r) {
        $('loading').hidden = true;
        if (r.code === 404) {
          return errorCard('Link inválido ou expirado',
            'Peça um link novo no painel da loja. Cada link vale só para o pedido dele.');
        }
        if (r.code === 429) {
          return errorCard('Muitas tentativas', 'Aguarde um minuto e recarregue a página.');
        }
        if (!r.data || !r.data.ok) {
          return errorCard('Não foi possível abrir a entrega',
            'Confira a conexão com a loja e recarregue a página.');
        }
        apply(r.data);
      })
      .catch(function () {
        $('loading').hidden = true;
        errorCard('Sem conexão', 'Não consegui falar com a loja. Confira o Wi-Fi ou o 4G e recarregue.');
      });
  }

  function apply(d) {
    var o = d.order || {};
    var st = Number(d.status) || Number(o.status) || 1;
    S.order = o;

    $('errorCard').hidden = true;
    $('orderNum').hidden = false;
    $('orderNum').textContent = '#' + o.num;
    renderOrder(o);
    renderNav(d);
    renderStatus(st);

    if (st >= 4) { finishUI(); return; }

    S.status = st;
    $('main').hidden = false;
    $('bar').hidden = false;
    renderMap(d);
    if (st === 3) {
      startGps();
      startPoll();
    }
  }

  /* ---------------- mapa ---------------- */

  function ensureMap() {
    if (S.map) return S.map;
    if (typeof L === 'undefined') return null;
    var box = $('map');
    if (!box) return null;
    S.map = L.map(box, { zoomControl: false });
    S.map.setView([-8.05, -34.88], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(S.map);
    return S.map;
  }

  function paintProgress(idx) {
    var c = S.routeCoords;
    if (!c || !S.layers.left) return;
    idx = Math.max(0, Math.min(Number(idx) || 0, c.length - 1));
    S.layers.done.setLatLngs(c.slice(0, idx + 1));
    S.layers.left.setLatLngs(c.slice(idx));
  }

  function renderMap(d) {
    if (!d) return;
    if (d.dest || d.origin) $('mapCard').hidden = false;
    var m = ensureMap();
    if (!m) { $('mapLine').textContent = 'Mapa indisponível neste aparelho — siga o endereço acima.'; return; }
    setTimeout(function () { if (S.map) S.map.invalidateSize(); }, 80);

    if (d.origin && !S.layers.origin) {
      S.layers.origin = L.circleMarker([d.origin.lat, d.origin.lon], {
        radius: 6, color: '#f6ece1', weight: 2, fillColor: '#2b2118', fillOpacity: 1
      }).addTo(m).bindPopup('Loja');
    }
    if (d.dest && !S.layers.dest) {
      S.layers.dest = L.circleMarker([d.dest.lat, d.dest.lon], {
        radius: 8, color: '#3fbf6e', weight: 3, fillColor: '#3fbf6e', fillOpacity: 1
      }).addTo(m).bindPopup('Entregar aqui');
    }

    var coords = d.route && d.route.coords && d.route.coords.length > 1 ? d.route.coords : null;
    var near = d.origin && d.dest &&
      Math.abs(d.origin.lat - d.dest.lat) < 0.0006 && Math.abs(d.origin.lon - d.dest.lon) < 0.0006;
    if (coords && (near || (Number(d.route.distanceM) > 0 && Number(d.route.distanceM) < 60))) {
      coords = null;
    }
    if (coords) {
      if (S.layers.fallback) { m.removeLayer(S.layers.fallback); S.layers.fallback = null; }
      if (!S.layers.left) {
        S.layers.left = L.polyline([], { color: '#f4761d', weight: 5, opacity: 0.95 }).addTo(m);
        S.layers.done = L.polyline([], { color: '#9a8f86', weight: 5, opacity: 0.95 }).addTo(m);
      }
      S.routeCoords = coords;
      paintProgress(d.route.idx);
      var km = (Number(d.route.distanceM) || 0) / 1000;
      var min = Math.round((Number(d.route.durationS) || 0) / 60);
      $('mapLine').textContent = 'Rota: ' + km.toFixed(1).replace('.', ',') + ' km · ~' +
        Math.max(1, min) + ' min — cinza já feito, laranja o que falta';
    } else if (d.origin && d.dest && !near) {
      if (S.layers.left) { m.removeLayer(S.layers.left); S.layers.left = null; }
      if (S.layers.done) { m.removeLayer(S.layers.done); S.layers.done = null; }
      if (!S.layers.fallback) {
        S.layers.fallback = L.polyline(
          [[d.origin.lat, d.origin.lon], [d.dest.lat, d.dest.lon]],
          { color: '#f4761d', weight: 4, dashArray: '8 8', opacity: 0.8 }
        ).addTo(m);
      }
      $('mapLine').textContent = 'Sem rota traçada — linha reta da loja até o cliente.';
    } else if (near) {
      if (S.layers.left) { m.removeLayer(S.layers.left); S.layers.left = null; }
      if (S.layers.done) { m.removeLayer(S.layers.done); S.layers.done = null; }
      if (S.layers.fallback) { m.removeLayer(S.layers.fallback); S.layers.fallback = null; }
      $('mapLine').textContent = 'Loja e endereço no mesmo ponto — siga o endereço acima.';
    } else {
      $('mapLine').textContent = 'Calculando a rota…';
    }

    if (!S.fitted) {
      var pts = [];
      if (coords) pts = coords.slice();
      else {
        if (d.origin) pts.push([d.origin.lat, d.origin.lon]);
        if (d.dest) pts.push([d.dest.lat, d.dest.lon]);
      }
      var me = (d.courier && d.courier.lat != null) ? [d.courier.lat, d.courier.lon] : null;
      if (!me && S.lastFix && S.lastFix.lat != null) me = [S.lastFix.lat, S.lastFix.lon];
      if (me) pts.push(me);
      if (pts.length) {
        var b = L.latLngBounds(pts);
        var sw = b.getSouthWest(), ne = b.getNorthEast();
        if (Math.abs(ne.lat - sw.lat) < 0.0006 && Math.abs(ne.lng - sw.lng) < 0.0006) {
          m.setView(b.getCenter(), 16, { animate: false });
        } else {
          m.fitBounds(b.pad(0.2), { animate: false, maxZoom: 16 });
        }
        S.fitted = true;
      }
    }
  }

  function moveMe(f) {
    var m = ensureMap();
    if (!m) return;
    var ll = [f.lat, f.lon];
    if (!S.layers.me) {
      S.layers.me = L.marker(ll, {
        icon: L.divIcon({ className: 'tl-scooter', html: '<span>' + RIDER_SVG + '</span>',
                          iconSize: [44, 44], iconAnchor: [22, 22] }),
        zIndexOffset: 600
      }).addTo(m);
    } else {
      S.layers.me.setLatLng(ll);
    }
  }

  /* ---------------- GPS ---------------- */

  function gpsUI(kind, title, sub, retry) {
    $('gpsBox').hidden = false;
    $('gpsDot').className = 'gps-dot ' + kind;
    $('gpsTitle').textContent = title;
    $('gpsSub').textContent = sub;
    $('gpsRetry').hidden = !retry;
  }

  function startGps() {
    $('gpsBox').hidden = false;
    if (S.watchId != null) return;
    if (!navigator.geolocation) {
      gpsUI('err', 'Sem GPS neste aparelho', 'Marque "Entregue" normalmente ao chegar.', false);
      return;
    }
    if (!window.isSecureContext) {
      gpsUI('warn', 'GPS bloqueado neste endereço',
        'O navegador só libera localização em HTTPS ou no próprio celular da loja (localhost). ' +
        'A entrega continua funcionando: use o mapa/endereço e marque entregue ao chegar.', false);
      return;
    }
    gpsUI('warn', 'Ligando o GPS…', 'Aceite a permissão de localização.', false);
    S.watchId = navigator.geolocation.watchPosition(onFix, onGpsError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 30000
    });
    acquireWake();
  }

  function stopWatch() {
    if (S.watchId != null) {
      try { navigator.geolocation.clearWatch(S.watchId); } catch (e) {}
      S.watchId = null;
    }
  }

  function retryGps() {
    stopWatch();
    startGps();
  }

  function onGpsError(e) {
    if (e && e.code === 1) {
      stopWatch();
      gpsUI('err', 'Permissão de localização negada',
        'Libere a localização para este site nas configurações do navegador e toque em Tentar.', true);
    } else if (e && e.code === 2) {
      gpsUI('warn', 'Sem sinal de GPS', 'Vá para um lugar aberto e toque em Tentar.', true);
    } else {
      gpsUI('warn', 'GPS demorando', 'Ainda procurando sinal. Toque em Tentar se demorar.', true);
    }
  }

  function onFix(p) {
    var c = p.coords;
    var f = {
      lat: c.latitude,
      lon: c.longitude,
      acc: c.accuracy,
      heading: (typeof c.heading === 'number' && isFinite(c.heading)) ? c.heading : null,
      speed: (typeof c.speed === 'number' && isFinite(c.speed)) ? c.speed * 3.6 : null
    };
    S.lastFix = f;
    moveMe(f);

    var now = Date.now();
    var moved = S.lastSent ? distanceM(S.lastSent, f) : Infinity;
    if (now - S.lastSentAt < SEND_MS && moved < SEND_M) {
      gpsUI('ok', 'GPS ativo', 'Precisão de ' + Math.round(f.acc || 0) + ' m — enviando a cada ~10 s', false);
      return;
    }
    sendFix(f);
  }

  function sendFix(f) {
    S.lastSentAt = Date.now();
    S.lastSent = { lat: f.lat, lon: f.lon };
    apiPost('/api/motoboy/location', {
      num: num, t: tok,
      lat: f.lat, lon: f.lon,
      acc: f.acc, heading: f.heading, speed: f.speed
    }).then(function (r) {
      if (r.code === 409) { finishUI(); return; }
      if (r.data && r.data.ok) {
        gpsUI('ok', 'GPS ativo', 'Posição enviada · precisão ' + Math.round(f.acc || 0) + ' m', false);
        if (r.data.idx != null) paintProgress(r.data.idx);
      } else {
        gpsUI('warn', 'GPS ativo', 'Posição não enviada — tento de novo em instantes', false);
      }
    }).catch(function () {
      gpsUI('warn', 'GPS ativo', 'Sem conexão — a posição vai na próxima tentativa', false);
    });
  }

  /* ---------------- tela acesa / envio final ---------------- */

  function acquireWake() {
    if (!navigator.wakeLock || S.wake) return;
    navigator.wakeLock.request('screen').then(function (w) {
      S.wake = w;
      w.addEventListener('release', function () { S.wake = null; });
    }).catch(function () {});
  }

  function releaseWake() {
    if (S.wake) {
      try { S.wake.release(); } catch (e) {}
      S.wake = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden || S.status !== 3) return;
    acquireWake();
    if (S.watchId == null) startGps();
  });

  window.addEventListener('pagehide', function () {
    if (S.status !== 3 || !S.lastFix) return;
    try {
      var body = new Blob([JSON.stringify({
        num: num, t: tok,
        lat: S.lastFix.lat, lon: S.lastFix.lon,
        acc: S.lastFix.acc, heading: S.lastFix.heading, speed: S.lastFix.speed
      })], { type: 'application/json' });
      navigator.sendBeacon('/api/motoboy/location', body);
    } catch (e) {}
  });

  /* ---------------- ações ---------------- */

  function startDelivery() {
    if (S.busy || S.status >= 4) return;
    S.busy = true;
    renderStatus(S.status);
    apiPost('/api/motoboy/status', { num: num, t: tok, status: 3 })
      .then(function (r) {
        S.busy = false;
        if (r.data && r.data.ok) {
          S.status = 3;
          renderStatus(3);
          $('main').hidden = false;
          $('bar').hidden = false;
          startGps();
          startPoll();
          refresh();
          return;
        }
        renderStatus(S.status);
        if (r.code === 409) { toast('Este pedido já está em outra etapa.'); load(); }
        else toast('Não consegui iniciar. Confira a conexão.');
      })
      .catch(function () {
        S.busy = false;
        renderStatus(S.status);
        toast('Sem conexão. Tente de novo.');
      });
  }

  function deliver() {
    if (S.busy) return;
    if (!window.confirm('Confirmar que a entrega foi concluída?')) return;
    S.busy = true;
    renderStatus(S.status);
    apiPost('/api/motoboy/status', { num: num, t: tok, status: 4 })
      .then(function (r) {
        S.busy = false;
        if (r.data && r.data.ok) { finishUI(); return; }
        renderStatus(S.status);
        if (r.code === 409) { load(); return; }
        toast('Não consegui marcar. Confira a conexão.');
      })
      .catch(function () {
        S.busy = false;
        renderStatus(S.status);
        toast('Sem conexão. Tente de novo.');
      });
  }

  /* ---------------- reconciliação ---------------- */

  function startPoll() {
    if (S.pollTimer) return;
    S.pollTimer = setInterval(refresh, POLL_MS);
  }

  function refresh() {
    if (!num || !tok) return;
    apiGet('/api/motoboy/order?num=' + encodeURIComponent(num) + '&t=' + encodeURIComponent(tok))
      .then(function (r) {
        if (!r.data || !r.data.ok) return;
        var st = Number(r.data.status) || 0;
        if (r.data.order) S.order = r.data.order;
        if (st >= 4 && S.status !== 4) { finishUI(); return; }
        renderNav(r.data);
        renderMap(r.data);
      })
      .catch(function () {});
  }

  function stopAll() {
    stopWatch();
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    releaseWake();
    $('gpsBox').hidden = true;
  }

  /* ---------------- início ---------------- */

  $('actionBtn').addEventListener('click', function () {
    if (S.status === 3) deliver();
    else startDelivery();
  });
  $('gpsRetry').addEventListener('click', retryGps);

  boot();
})();
