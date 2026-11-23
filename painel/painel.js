/* Painel Delícias do Aleff — admin */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var PIN_KEY = 'sc-admin-pin';
  var TAB_KEY = 'sc-admin-tab';
  var pin = localStorage.getItem(PIN_KEY) || '';

  var state = { store: {}, products: [], orders: [] };
  var editing = null;          // id do produto em edição, 'new' ou null
  var editingImg = '';
  var activeTab = 'produtos';
  var pollTimer = null;
  var stockTimers = {};
  var cashPeriod = 'today';

  var DEFAULT_CATS = [
    { id: 'bolos', label: 'Bolos', short: '' },
    { id: 'fatias', label: 'Fatias', short: '' },
    { id: 'tortas', label: 'Tortas', short: '' },
    { id: 'doces', label: 'Docinhos', short: 'Doces' },
    { id: 'kits', label: 'Kits festa', short: 'Kits' },
    { id: 'bebidas', label: 'Bebidas', short: '' }
  ];
  var catsDirty = false;
  var CAT_ICONS = ['🎂', '🧁', '🍰', '🥧', '🍫', '🍪', '🍬', '🍮', '🍩', '🍨', '🍯', '🥮',
                   '🧇', '🥐', '🍓', '🍦', '🍧', '🎁', '🥤', '☕', '🧊', '🥳', '🎉', '⭐'];

  function catIconOptions(sel) {
    return '<option value="">Ícone</option>' + CAT_ICONS.map(function (e) {
      return '<option value="' + e + '"' + (e === sel ? ' selected' : '') + '>' + e + '</option>';
    }).join('');
  }

  function rowsCats() {
    return $$('#catList .cat-row').map(function (row) {
      return {
        id: row.getAttribute('data-id') || '',
        label: $('.cat-name', row).value.trim(),
        short: $('.cat-short', row).value.trim(),
        icon: $('.cat-emoji', row).value
      };
    });
  }

  function catList() {
    if (catsDirty) return rowsCats().filter(function (c) { return c.label; });
    var c = state.store.categories;
    return Array.isArray(c) ? c : DEFAULT_CATS.slice();
  }

  function catMap() {
    var out = {};
    catList().forEach(function (c) { out[c.id] = c.label; });
    return out;
  }
  var STATUS = ['Recebido', 'No forno', 'A caminho', 'Entregue'];
  var PAY = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro' };

  // ---------------------------------------------------------------- util

  function money(v) {
    return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function imgSrc(path) {
    if (!path) return '';
    if (/^(https?:)?\/\//.test(path) || path.charAt(0) === '/') return path;
    return '/' + path;
  }

  function toast(msg) {
    var t = $('#toastP');
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
      boot();
    }).catch(function (e) {
      err.hidden = false;
      err.textContent = e.status === 401
        ? 'PIN incorreto. O padrão é 1234.'
        : 'Não consegui falar com o servidor (HTTP ' + (e.status || 'sem conexão') +
          '). Abra o painel em http://' + location.hostname + ':8001/painel';
      $('#pinInput').select();
    });
  });

  window.addEventListener('error', function () {
    var err = $('#loginErr');
    if (err && !$('#login').hidden) {
      err.hidden = false;
      err.textContent = 'Falha ao carregar o painel. Recarregue a página.';
    }
  });

  function logout(silent) {
    localStorage.removeItem(PIN_KEY);
    pin = '';
    clearInterval(pollTimer);
    $('#app').hidden = true;
    $('#login').hidden = false;
    if (!silent) toast('Saiu do painel');
    setTimeout(function () { $('#pinInput').focus(); }, 50);
  }

  $('#logoutBtn').addEventListener('click', function () { logout(false); });

  // ---------------------------------------------------------------- boot

  function boot() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    loadAll().then(function () {
      /* recarregou a página: volta para a aba em que estava */
      var saved = localStorage.getItem(TAB_KEY);
      if (saved && saved !== activeTab && $('#tab-' + saved)) setTab(saved);
      if (window.innerWidth > 760) $('#pinInput').blur();
    });
    clearInterval(pollTimer);
    pollTimer = setInterval(pollOrders, 15000);
  }

  function loadAll() {
    return api('/api/admin/all').then(function (d) {
      state.store = d.store || {};
      state.products = d.products || [];
      state.orders = d.orders || [];
      renderAll();
    }).catch(function (e) {
      if (e.status === 401) {
        logout(true); /* PIN salvo não vale mais — volta pro login sem alarme */
      } else {
        toast('Erro ao carregar: ' + e.message);
      }
    });
  }

  function pollOrders() {
    api('/api/admin/orders').then(function (d) {
      state.orders = d.orders || [];
      renderOrders();
    }).catch(function () { /* silencioso */ });
  }

  // ---------------------------------------------------------------- render

  function renderAll() {
    renderBrand();
    renderProducts();
    renderStock();
    renderOrders();
    renderStore();
    renderCash();
  }

  function renderBrand() {
    var s = state.store;
    var logo = imgSrc(s.logo) || '/icons/icon-192.png';
    $('#brandName').textContent = s.name || 'Minha loja';
    $('#brandLogo').src = logo;
    $('#loginLogo').src = logo;
    var open = s.openNow !== undefined ? s.openNow === true : s.open !== false;
    var btn = $('#openToggle');
    btn.className = 'pill ' + (open ? 'green' : 'red');
    btn.innerHTML = '<i class="led"></i>' + (open ? 'Aberto' : 'Fechado');
    btn.title = s.hoursAuto ? 'Horário automático — mude na aba Loja' : 'Abrir / fechar a loja';
    $('#brandStatus').textContent = (open ? 'loja aberta' : 'loja fechada') +
      (s.hoursAuto ? ' · automático' : '');
    document.title = (s.name || 'Loja') + ' — Painel';
  }

  function stockBadge(p) {
    if (p.active === false) return '<span class="badge off">Oculto</span>';
    if (p.stock === 0) return '<span class="badge out">Esgotado</span>';
    if (p.stock != null && p.stock <= 5) return '<span class="badge low">Restam ' + p.stock + '</span>';
    return '';
  }

  function renderProducts() {
    var total = state.products.length;
    var live = state.products.filter(function (p) { return p.active !== false; }).length;
    $('#prodCount').textContent = total + ' itens · ' + live + ' aparecendo no cardápio';

    if (!total) {
      $('#productGrid').innerHTML =
        '<div class="empty-state"><div class="ico">🍔</div><b>Nenhum produto ainda</b>' +
        '<small>Toque em “Novo produto” para começar.</small></div>';
      return;
    }

    $('#productGrid').innerHTML = state.products.map(function (p) {
      var img = p.img
        ? '<img src="' + esc(imgSrc(p.img)) + '" alt="" loading="lazy">'
        : '<div class="ph">🍔</div>';
      var stockTxt = p.stock == null ? 'estoque ilimitado' : p.stock + ' em estoque';
      return '<article class="pcard" data-id="' + esc(p.id) + '">' +
        '<div class="pcard-img">' + img + stockBadge(p) + '</div>' +
        '<div class="pcard-body">' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<span class="price">' + money(p.price) + '</span>' +
        '<div class="meta"><span>' + esc(catMap()[p.cat] || p.cat || '—') + '</span><span>' + esc(stockTxt) + '</span></div>' +
        '<div class="pcard-foot"><button class="btn ghost small" type="button" data-edit="' + esc(p.id) + '">Editar</button></div>' +
        '</div></article>';
    }).join('');
  }

  function renderStock() {
    $('#stockList').innerHTML = state.products.map(function (p) {
      var inf = p.stock == null;
      var small = inf ? 'ilimitado' : (p.stock === 0 ? 'esgotado' : p.stock + ' unidades');
      return '<div class="srow" data-id="' + esc(p.id) + '">' +
        (p.img ? '<img src="' + esc(imgSrc(p.img)) + '" alt="">' : '') +
        '<div class="sinfo"><b>' + esc(p.name) + '</b>' +
        '<small class="' + (p.stock === 0 ? 'out' : '') + '">' + esc(small) + '</small></div>' +
        '<div class="stepper">' +
        '<button type="button" data-step="-1" aria-label="Diminuir">−</button>' +
        '<input type="number" min="0" step="1" inputmode="numeric" value="' + (inf ? '' : p.stock) + '" placeholder="∞">' +
        '<button type="button" data-step="1" aria-label="Aumentar">+</button>' +
        '</div>' +
        '<label class="inf-toggle"><input type="checkbox" data-inf ' + (inf ? 'checked' : '') + '> ilimitado</label>' +
        '</div>';
    }).join('');
  }

  function updateStockLabels() {
    state.products.forEach(function (p) {
      var row = $('.srow[data-id="' + p.id + '"]');
      if (!row) return;
      var small = $('.sinfo small', row);
      var inf = p.stock == null;
      small.textContent = inf ? 'ilimitado' : (p.stock === 0 ? 'esgotado' : p.stock + ' unidades');
      small.classList.toggle('out', p.stock === 0);
    });
  }

  function renderOrders() {
    var pending = state.orders.filter(function (o) { return Number(o.status) < 4; }).length;
    var badge = $('#ordersBadge');
    badge.hidden = pending === 0;
    badge.textContent = pending;

    var box = $('#ordersList');
    if (!state.orders.length) {
      box.innerHTML = '<div class="empty-state"><div class="ico">🧾</div><b>Nenhum pedido ainda</b>' +
        '<small>Os pedidos feitos no app aparecem aqui.</small></div>';
      return;
    }

    box.innerHTML = state.orders.map(function (o) {
      var st = Math.min(4, Math.max(1, Number(o.status) || 1));
      var when = o.createdAt
        ? new Date(o.createdAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : (o.time || '—');
      var items = (o.items || []).map(function (it) {
        return '<li><span>' + it.qty + '× ' + esc(it.name) + '</span><b>' + money(it.unit * it.qty) + '</b></li>';
      }).join('');
      var tel = String(o.phone || '').replace(/\D/g, '');
      var waHref = '';
      if (tel.length >= 10) {
        var full = (tel.indexOf('55') === 0 && tel.length >= 12) ? tel : '55' + tel;
        var first = (o.name || '').split(' ')[0];
        var msg = 'Olá' + (first ? ' ' + first : '') + '! Seu pedido #' + o.num +
          ' saiu para entrega 🛵 Já está a caminho.';
        waHref = 'https://wa.me/' + full + '?text=' + encodeURIComponent(msg);
      }
      var mbHref = o.mtoken
        ? location.origin + '/motoboy/?o=' + encodeURIComponent(o.num) + '&t=' + encodeURIComponent(o.mtoken)
        : '';
      var btns = STATUS.map(function (label, i) {
        var n = i + 1;
        var cls = n === st ? 'on' : (n === st + 1 ? 'next' : '');
        return '<button type="button" class="' + cls + '" data-status="' + n + '">' + label + '</button>';
      }).join('');
      return '<article class="order' + (st === 1 ? ' new' : '') + '" data-num="' + esc(o.num) + '">' +
        '<div class="order-head">' +
        '<div><b>#' + esc(o.num) + '</b> <span class="when">' + when + '</span></div>' +
        '<span class="order-total">' + money(o.total) + '</span>' +
        '</div>' +
        '<ul class="order-items">' + items + '</ul>' +
        '<div class="order-meta">' +
        '<span>📍 ' + esc(o.addr || '—') + '</span>' +
        (tel ? '<span>📞 ' + esc(tel) + '</span>' : '') +
        '<span>💳 ' + esc(PAY[o.pay] || o.pay || '—') + '</span>' +
        '</div>' +
        (waHref ? '<a class="wa-link" href="' + waHref + '" target="_blank" rel="noopener">💬 Avisar no WhatsApp</a>' : '') +
        (mbHref ? '<div class="mb-line">' +
          '<a class="mb-link" href="' + esc(mbHref) + '" target="_blank" rel="noopener">🛵 Link do motoboy</a>' +
          '<button type="button" class="mb-copy" data-copy="' + esc(mbHref) + '">Copiar link</button>' +
          '</div>' : '') +
        '<div class="status-btns">' + btns +
          '<button type="button" class="order-del" data-odel aria-label="Apagar pedido">🗑 Apagar</button>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  function deliveryCfg() {
    var d = state.store.delivery || {};
    return {
      mode: d.mode === 'km' ? 'km' : 'fixed',
      base: d.base != null ? Number(d.base) : 3,
      perKm: d.perKm != null ? Number(d.perKm) : 2,
      minFee: d.minFee != null ? Number(d.minFee) : 6.9,
      maxKm: d.maxKm != null ? Number(d.maxKm) : 0,
      roadFactor: d.roadFactor != null ? Number(d.roadFactor) : 1.3
    };
  }

  function renderStore() {
    var s = state.store;
    var d = deliveryCfg();
    $('#storeLogo').src = imgSrc(s.logo) || '/icons/icon-192.png';
    $('#stName').value = s.name || '';
    $('#stTagline').value = s.tagline || '';
    $('#stFee').value = s.fee != null ? s.fee : '';
    $('#stMin').value = s.minOrder != null ? s.minOrder : '';
    $('#stWa').value = s.whatsapp || '';
    $('#stHours').value = s.hours || '';
    $('#stAddr').value = s.address || '';
    $('#stOriginCep').value = s.originCep || '';
    $('#stMode').value = d.mode;
    $('#stBase').value = d.base;
    $('#stPerKm').value = d.perKm;
    $('#stMinFee').value = d.minFee;
    $('#stMaxKm').value = d.maxKm;
    $('#stRoad').value = d.roadFactor;
    renderFeePreview();
    renderHours();
    renderBanners(s.banners);
    renderPopup(s.popup);
    renderPopularPick();
    renderSizes();
    renderExtras();
    renderCategoriesSection();
    renderCoupons();
  }

  /* ---------------- horário de funcionamento ---------------- */

  var DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  function scheduleCfg() {
    var s = state.store.schedule;
    var out = [];
    for (var i = 0; i < 7; i++) {
      var d = Array.isArray(s) && s[i] ? s[i] : {};
      out.push({
        closed: d.closed === true,
        from: /^\d{1,2}:\d{2}$/.test(d.from || '') ? d.from : '18:00',
        to: /^\d{1,2}:\d{2}$/.test(d.to || '') ? d.to : '23:30'
      });
    }
    return out;
  }

  function hmMin(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }

  function openNow(sched, now) {
    now = now || new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var today = now.getDay();
    var yesterday = (today + 6) % 7;
    var d = sched[today];
    if (!d.closed) {
      var f = hmMin(d.from), t = hmMin(d.to);
      if (f < t && f <= nowMin && nowMin < t) return true;
      if (f > t && nowMin >= f) return true;
    }
    var y = sched[yesterday];
    if (!y.closed) {
      var f2 = hmMin(y.from), t2 = hmMin(y.to);
      if (f2 > t2 && nowMin < t2) return true;
    }
    return false;
  }

  function renderHours() {
    $('#stHoursAuto').checked = state.store.hoursAuto === true;
    $('#hoursGrid').innerHTML = scheduleCfg().map(function (d, i) {
      return '<div class="hs-row' + (d.closed ? ' is-off' : '') + '" data-day="' + i + '">' +
        '<span class="hs-day">' + DAY_NAMES[i] + '</span>' +
        '<label class="hs-chk" title="Fechado nesse dia"><input type="checkbox" class="hs-closed"' + (d.closed ? ' checked' : '') + '></label>' +
        '<input type="time" class="hs-from" value="' + d.from + '" aria-label="Abre ' + DAY_NAMES[i] + '">' +
        '<input type="time" class="hs-to" value="' + d.to + '" aria-label="Fecha ' + DAY_NAMES[i] + '">' +
        '</div>';
    }).join('');
    updateHoursPreview();
  }

  function readSchedule() {
    return $$('#hoursGrid .hs-row').map(function (row) {
      return {
        closed: $('.hs-closed', row).checked,
        from: $('.hs-from', row).value || '18:00',
        to: $('.hs-to', row).value || '23:30'
      };
    });
  }

  function updateHoursPreview() {
    var el = $('#hoursPreview');
    if (!$('#stHoursAuto').checked) {
      el.innerHTML = 'Automático desligado — vale o botão <b>Aberto/Fechado</b> no topo.';
      return;
    }
    var open = openNow(readSchedule());
    el.innerHTML = 'Agora: <b>' + (open ? 'aberto' : 'fechado') + '</b> segundo esse horário. ' +
      'O app e o aceite de pedidos seguem sozinhos.';
  }

  $('#stHoursAuto').addEventListener('change', updateHoursPreview);

  $('#hoursGrid').addEventListener('input', function (e) {
    var row = e.target.closest('.hs-row');
    if (row && e.target.classList.contains('hs-closed')) {
      row.classList.toggle('is-off', e.target.checked);
    }
    updateHoursPreview();
  });
  $('#hoursGrid').addEventListener('change', updateHoursPreview);

  function previewFee(km) {
    var d = deliveryCfg();
    var base = parseFloat($('#stBase').value) || 0;
    var perKm = parseFloat($('#stPerKm').value) || 0;
    var minFee = parseFloat($('#stMinFee').value) || 0;
    var fee = Math.max(minFee, base + km * perKm);
    return Math.ceil(fee * 2 - 1e-9) / 2;
  }

  function renderFeePreview() {
    var el = $('#feePreview');
    var d = deliveryCfg();
    if (d.mode !== 'km') {
      el.innerHTML = 'Modo taxa fixa: o app cobra o valor <b>Taxa fixa / reserva</b> acima.';
      return;
    }
    var parts = [1, 3, 5, 10].map(function (km) {
      return km + ' km → <b>' + money(previewFee(km)) + '</b>';
    });
    el.innerHTML = parts.join(' · ') + '<br>Arredonda para cima em R$ 0,50 · distância aproximada pelo CEP.';
  }

  ['#stBase', '#stPerKm', '#stMinFee', '#stMaxKm', '#stRoad', '#stMode'].forEach(function (sel) {
    $(sel).addEventListener('input', renderFeePreview);
    $(sel).addEventListener('change', renderFeePreview);
  });

  $('#testCepBtn').addEventListener('click', function () {
    var cep = $('#testCep').value.replace(/\D/g, '');
    var out = $('#testCepResult');
    if (cep.length !== 8) {
      out.className = 'fee-hint err';
      out.textContent = 'Digite os 8 números do CEP de destino.';
      return;
    }
    var btn = this;
    btn.disabled = true;
    out.className = 'fee-hint';
    out.textContent = 'Consultando…';
    var q = '/api/admin/geo/test?cep=' + encodeURIComponent(cep);
    var origin = $('#stOriginCep').value.replace(/\D/g, '');
    if (origin.length === 8) q += '&origin=' + encodeURIComponent(origin);
    api(q).then(function (r) {
      var a = r.addr || {};
      var loc = [a.street, a.district, a.city, a.state].filter(Boolean).join(', ');
      if (r.source === 'km') {
        out.className = 'fee-hint';
        out.innerHTML = loc + '<br>' + String(r.km).replace('.', ',') + ' km → <b>' + money(r.fee) + '</b>';
      } else {
        out.className = 'fee-hint err';
        out.innerHTML = (loc ? loc + '<br>' : '') +
          'Sem frete por km (' + esc(r.reason || 'falhou') + '). O app usaria a taxa fixa de ' + money(state.store.fee || 0) + '.';
      }
    }).catch(function (e) {
      out.className = 'fee-hint err';
      out.textContent = e.message;
    }).then(function () { btn.disabled = false; });
  });

  // ---------------------------------------------------------------- banners

  var DEFAULT_BANNERS = [{ tag: 'Primeira compra', title: 'EXTRA', off: '30% OFF',
    sub: 'no seu primeiro pedido', btn: 'Pedir agora', img: 'img/dish-duplo.webp', active: true, price: 0 }];

  function bannersList() {
    var bl = state.store.banners;
    return Array.isArray(bl) ? bl : DEFAULT_BANNERS.map(function (b) {
      return { tag: b.tag, title: b.title, off: b.off, sub: b.sub, btn: b.btn, pname: b.pname || '', img: b.img, active: b.active, goto: b.goto || 'all', price: b.price || 0 };
    });
  }

  function readBanners() {
    return $$('#bannerList .bn-row').map(function (row) {
      var ar = parseFloat(row.getAttribute('data-ar') || '0');
      return {
        tag: $('.bn-tag', row).value.trim(),
        title: $('.bn-title', row).value.trim(),
        off: $('.bn-off', row).value.trim(),
        sub: $('.bn-sub', row).value.trim(),
        btn: $('.bn-btn', row).value.trim(),
        pname: $('.bn-pname', row).value.trim(),
        img: row.getAttribute('data-img') || '',
        active: $('.bn-active', row).checked,
        goto: $('.bn-goto', row).value,
        price: Math.max(0, Math.min(500, parseFloat($('.bn-price', row).value) || 0)),
        ar: ar > 0 ? Math.round(ar * 1000) / 1000 : 0
      };
    });
  }

  function renderBanners(list) {
    var box = $('#bannerList');
    var arr = Array.isArray(list) ? list : bannersList();
    if (!arr.length) {
      box.innerHTML = '<p class="hint bn-empty">Nenhum banner — a home fica sem o slide.</p>';
      return;
    }
    box.innerHTML = arr.map(function (b, i) {
      var im = b.img ? imgSrc(b.img) : '';
      var ar = Number(b.ar) > 0 ? Number(b.ar) : 0;
      return '<div class="bn-row" data-img="' + esc(b.img || '') + '" data-ar="' + (ar || '') + '">' +
        '<div class="bn-top">' +
          '<b>Banner ' + (i + 1) + '</b>' +
          '<label class="check bn-check"><input type="checkbox" class="bn-active"' + (b.active === false ? '' : ' checked') + '> <span>Ativo</span></label>' +
          '<button type="button" class="btn danger ghost small bn-del" aria-label="Remover banner">✕</button>' +
        '</div>' +
        '<div class="bn-img">' +
          (im ? '<img src="' + esc(im) + '" alt="">' : '<span class="bn-noimg">sem imagem</span>') +
          '<label class="btn ghost small">Trocar imagem<input type="file" class="bn-file" accept="image/*" hidden></label>' +
        '</div>' +
        '<div class="two">' +
          '<label class="field"><span>Selo pequeno</span><input class="bn-tag" type="text" maxlength="24" value="' + esc(b.tag || '') + '"></label>' +
          '<label class="field"><span>Destaque (dourado)</span><input class="bn-off" type="text" maxlength="20" value="' + esc(b.off || '') + '"></label>' +
        '</div>' +
        '<label class="field"><span>Título</span><input class="bn-title" type="text" maxlength="40" value="' + esc(b.title || '') + '"></label>' +
        '<label class="field"><span>Subtítulo</span><input class="bn-sub" type="text" maxlength="60" value="' + esc(b.sub || '') + '"></label>' +
        '<label class="field"><span>Texto do botão (vazio = sem botão)</span><input class="bn-btn" type="text" maxlength="24" value="' + esc(b.btn || '') + '"></label>' +
        '<div class="two">' +
          '<label class="field"><span>Categoria / ao tocar</span><select class="bn-goto">' +
            '<option value="all"' + (b.goto === 'all' || !b.goto ? ' selected' : '') + '>Cardápio (tudo)</option>' +
            catList().map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (b.goto === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
            }).join('') +
          '</select></label>' +
          '<label class="field"><span>Preço como produto (R$)</span><input class="bn-price" type="number" min="0" max="500" step="0.5" inputmode="decimal" value="' + (Number(b.price) || 0) + '"></label>' +
        '</div>' +
        '<label class="field"><span>Nome no cardápio (opcional)</span><input class="bn-pname" type="text" maxlength="60" value="' + esc(b.pname || '') + '" placeholder="Ex.: Combo Casal"></label>' +
        '<p class="fee-hint" style="margin:0">Preço acima de R$ 0 = o banner também vira um produto comprável na categoria escolhida. Em R$ 0 ele é só banner.</p>' +
      '</div>';
    }).join('');
  }

  $('#addBanner').addEventListener('click', function () {
    var list = readBanners();
    if (list.length >= 6) { toast('Máximo de 6 banners'); return; }
    list.push({ tag: '', title: '', off: '', sub: '', btn: '', pname: '', img: '', active: true, goto: 'all', price: 0, ar: 0 });
    renderBanners(list);
  });

  $('#bannerList').addEventListener('click', function (e) {
    var del = e.target.closest('.bn-del');
    if (!del) return;
    var list = readBanners();
    var rows = $$('#bannerList .bn-row');
    var idx = rows.indexOf(del.closest('.bn-row'));
    if (idx > -1) list.splice(idx, 1);
    renderBanners(list);
  });

  $('#bannerList').addEventListener('change', function (e) {
    var f = e.target.closest('.bn-file');
    if (!f) return;
    var file = f.files && f.files[0];
    f.value = '';
    if (!file) return;
    var row = f.closest('.bn-row');
    uploadFile(file, function (path, ar) {
      row.setAttribute('data-img', path);
      if (ar > 0) row.setAttribute('data-ar', String(Math.round(ar * 1000) / 1000));
      var box = $('.bn-img', row);
      var img = $('.bn-img img', row);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        box.insertBefore(img, box.firstChild);
        var no = $('.bn-noimg', row);
        if (no) no.remove();
      }
      img.src = imgSrc(path);
    });
  });

  /* ---------------- anúncio em pop-up ---------------- */

  function renderPopup(p) {
    p = p && typeof p === 'object' ? p : {};
    $('#ppActive').checked = !!p.active;
    $('#ppTitle').value = p.title || '';
    $('#ppText').value = p.text || '';
    $('#ppBtn').value = p.btn || '';
    $('#ppFreq').value = (p.freq === 'session' || p.freq === 'always') ? p.freq : 'day';

    var goto = p.goto || 'all';
    var opts = '<option value="all"' + (goto === 'all' ? ' selected' : '') + '>Cardápio (tudo)</option>';
    if (catList().length) {
      opts += '<optgroup label="Categorias">' + catList().map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (goto === c.id ? ' selected' : '') + '>' +
          esc(c.label) + '</option>';
      }).join('') + '</optgroup>';
    }
    var prods = state.products || [];
    if (prods.length) {
      opts += '<optgroup label="Produtos">' + prods.map(function (pr) {
        return '<option value="p:' + esc(pr.id) + '"' + (goto === 'p:' + pr.id ? ' selected' : '') + '>' +
          esc(pr.name) + '</option>';
      }).join('') + '</optgroup>';
    }
    $('#ppGoto').innerHTML = opts;
    renderPopupImg(p.img || '');
  }

  function renderPopupImg(path) {
    var img = $('#ppImg');
    var no = $('#ppNoImg');
    $('#popupBox').setAttribute('data-img', path || '');
    if (path) {
      img.src = imgSrc(path);
      img.hidden = false;
      no.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      no.hidden = false;
    }
  }

  function readPopup() {
    return {
      active: $('#ppActive').checked,
      title: $('#ppTitle').value.trim(),
      text: $('#ppText').value.trim(),
      btn: $('#ppBtn').value.trim(),
      goto: $('#ppGoto').value || 'all',
      freq: $('#ppFreq').value,
      img: $('#popupBox').getAttribute('data-img') || ''
    };
  }

  $('#ppFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    uploadFile(file, function (path) {
      renderPopupImg(path);
      toast('Imagem do pop-up atualizada');
    });
  });

  var DEFAULT_EXTRAS = [
    { id: 'vela', label: 'Vela de aniversário', price: 0 },
    { id: 'choco', label: 'Chocolate extra', price: 8 },
    { id: 'morango', label: 'Morangos frescos', price: 12 },
    { id: 'cartao', label: 'Cartãozinho', price: 0 },
    { id: 'presente', label: 'Embalagem de presente', price: 5 }
  ];

  var DEFAULT_SIZES = [
    { id: 'p', label: 'Pequeno · 12 fatias', extra: 0 },
    { id: 'm', label: 'Médio · 20 fatias', extra: 40 },
    { id: 'g', label: 'Grande · 30 fatias', extra: 80 }
  ];

  function sizesList() {
    var sz = state.store.sizes;
    return Array.isArray(sz) ? sz : DEFAULT_SIZES.slice();
  }

  function rowsSizes() {
    return $$('#sizeList .coupon-row').map(function (row) {
      return {
        id: row.getAttribute('data-id') || '',
        label: $('.code', row).value.trim(),
        extra: Math.max(0, parseFloat($('.pct', row).value) || 0)
      };
    });
  }

  function readSizes() {
    return rowsSizes().filter(function (s) { return s.label; });
  }

  function renderSizes() {
    var box = $('#sizeList');
    var list = sizesList();
    if (!list.length) {
      box.innerHTML = '<p class="hint" style="color:var(--muted);font-size:13px;margin:0">Nenhum tamanho — a ficha do produto fica sem tamanhos.</p>';
      return;
    }
    box.innerHTML = list.map(function (s) {
      return '<div class="coupon-row" data-id="' + esc(s.id || '') + '">' +
        '<input class="code" type="text" value="' + esc(s.label || '') + '" maxlength="20" placeholder="Ex.: Duplo" aria-label="Nome do tamanho">' +
        '<input class="pct" type="number" min="0" max="500" step="0.5" inputmode="decimal" value="' + (Number(s.extra) || 0) + '" aria-label="Acréscimo do tamanho">' +
        '<span class="unit">R$</span>' +
        '<button type="button" class="del" data-del aria-label="Remover">✕</button>' +
        '</div>';
    }).join('');
  }

  $('#addSize').addEventListener('click', function () {
    var list = rowsSizes();
    if (list.length >= 6) { toast('Máximo de 6 tamanhos'); return; }
    list.push({ id: '', label: '', extra: 0 });
    state.store.sizes = list;
    renderSizes();
    var rows = $$('#sizeList .coupon-row');
    var last = rows[rows.length - 1];
    if (last) $('.code', last).focus();
  });

  $('#sizeList').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (!del) return;
    var list = rowsSizes();
    var rows = $$('#sizeList .coupon-row');
    var idx = rows.indexOf(del.closest('.coupon-row'));
    if (idx > -1) list.splice(idx, 1);
    state.store.sizes = list;
    renderSizes();
  });

  function extrasList() {
    var ex = state.store.extras;
    return Array.isArray(ex) ? ex : DEFAULT_EXTRAS.slice();
  }

  function rowsExtras() {
    return $$('#extraList .coupon-row').map(function (row) {
      return {
        id: row.getAttribute('data-id') || '',
        label: $('.code', row).value.trim(),
        price: Math.max(0, parseFloat($('.pct', row).value) || 0)
      };
    });
  }

  function readExtras() {
    return rowsExtras().filter(function (e) { return e.label; });
  }

  function readCats() {
    return rowsCats().filter(function (c) { return c.label; }).map(function (c) {
      return { id: c.id, label: c.label, short: c.short, icon: c.icon };
    });
  }

  function renderExtras() {
    var box = $('#extraList');
    var list = extrasList();
    if (!list.length) {
      box.innerHTML = '<p class="hint" style="color:var(--muted);font-size:13px;margin:0">Nenhum adicional — a ficha do produto fica sem extras.</p>';
      return;
    }
    box.innerHTML = list.map(function (e) {
      return '<div class="coupon-row" data-id="' + esc(e.id || '') + '">' +
        '<input class="code" type="text" value="' + esc(e.label || '') + '" maxlength="30" placeholder="Ex.: Morango extra" aria-label="Nome do adicional">' +
        '<input class="pct" type="number" min="0" max="500" step="0.5" inputmode="decimal" value="' + (Number(e.price) || 0) + '" aria-label="Preço do adicional">' +
        '<span class="unit">R$</span>' +
        '<button type="button" class="del" data-del aria-label="Remover">✕</button>' +
        '</div>';
    }).join('');
  }

  $('#addExtra').addEventListener('click', function () {
    var list = rowsExtras();
    if (list.length >= 12) { toast('Máximo de 12 adicionais'); return; }
    list.push({ id: '', label: '', price: 0 });
    state.store.extras = list;
    renderExtras();
    var rows = $$('#extraList .coupon-row');
    var last = rows[rows.length - 1];
    if (last) $('.code', last).focus();
  });

  $('#extraList').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (!del) return;
    var list = rowsExtras();
    var rows = $$('#extraList .coupon-row');
    var idx = rows.indexOf(del.closest('.coupon-row'));
    if (idx > -1) list.splice(idx, 1);
    state.store.extras = list;
    renderExtras();
  });

  /* ---------------- categorias ---------------- */

  function renderCategoriesSection() {
    catsDirty = false;
    renderCats();
  }

  function renderCats(list) {
    var box = $('#catList');
    if (!box) return;
    var items = Array.isArray(list) ? list : catList();
    box.innerHTML = items.map(function (c) {
      return '<div class="coupon-row cat-row" data-id="' + esc(c.id || '') + '">' +
        '<input class="code cat-name" type="text" maxlength="30" value="' + esc(c.label || '') + '" placeholder="Ex.: Salgados" aria-label="Nome da categoria">' +
        '<input class="pct cat-short" type="text" maxlength="12" value="' + esc(c.short || '') + '" placeholder="Abrev." aria-label="Abreviação para os botões">' +
        '<select class="cat-emoji" aria-label="Ícone da categoria">' + catIconOptions(c.icon || '') + '</select>' +
        '<button type="button" class="del" data-del aria-label="Excluir categoria">✕</button>' +
        '</div>';
    }).join('') || '<p class="fee-hint" style="margin:0">Nenhuma categoria — o app mostra só a lista completa.</p>';
  }

  $('#addCat').addEventListener('click', function () {
    var list = rowsCats();
    if (list.length >= 12) { toast('Máximo de 12 categorias'); return; }
    catsDirty = true;
    list.push({ id: '', label: '', short: '', icon: '' });
    state.store.categories = list;
    renderCats(list);
    var rows = $$('#catList .cat-row');
    var last = rows[rows.length - 1];
    if (last) $('.cat-name', last).focus();
  });

  $('#catList').addEventListener('input', function () { catsDirty = true; });
  $('#catList').addEventListener('change', function (e) {
    if (e.target.classList.contains('cat-emoji')) catsDirty = true;
  });

  $('#catList').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (!del) return;
    var row = del.closest('.cat-row');
    var id = row.getAttribute('data-id');
    if (id) {
      var used = state.products.filter(function (p) { return p.cat === id; });
      if (used.length) {
        toast(used.length + ' produto(s) usam esta categoria — troque a categoria deles antes de excluir');
        return;
      }
    }
    catsDirty = true;
    var list = rowsCats();
    var rows = $$('#catList .cat-row');
    var idx = rows.indexOf(row);
    if (idx > -1) list.splice(idx, 1);
    state.store.categories = list;
    renderCats();
  });

  /* ---------------- mais pedidos ---------------- */

  function popularSel() {
    var p = state.store.popular;
    return Array.isArray(p) ? p.slice() : [];
  }

  function soldRank() {
    var sold = {};
    state.orders.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        if (!it.pid) return;
        sold[it.pid] = (sold[it.pid] || 0) + (Number(it.qty) || 0);
      });
    });
    return Object.keys(sold).sort(function (a, b) { return sold[b] - sold[a]; });
  }

  function renderPopularPick() {
    var box = $('#popularPick');
    var sel = popularSel();
    var prod = state.products.filter(function (p) { return p.active !== false; });
    if (!prod.length) {
      box.innerHTML = '<p class="hint" style="color:var(--muted);font-size:13px;margin:0">Nenhum produto ativo no cardápio.</p>';
      $('#popularAuto').textContent = '';
      return;
    }
    box.innerHTML = prod.map(function (p) {
      var i = sel.indexOf(p.id);
      return '<button type="button" class="pop-chip' + (i > -1 ? ' is-on' : '') + '" data-pop="' + esc(p.id) + '">' +
        (i > -1 ? '<b>' + (i + 1) + '</b>' : '') + esc(p.name) + '</button>';
    }).join('');
    var auto = soldRank().filter(function (id) {
      return sel.indexOf(id) < 0 && prod.some(function (p) { return p.id === id; });
    }).slice(0, 3).map(function (id) {
      for (var i = 0; i < prod.length; i++) if (prod[i].id === id) return prod[i].name;
      return '';
    });
    $('#popularAuto').innerHTML = auto.length
      ? 'Completando sozinho pelos mais vendidos: <b>' + auto.map(esc).join('</b>, <b>') + '</b>.'
      : 'Ainda sem vendas registradas — os demais entram na ordem do cardápio.';
  }

  $('#popularPick').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-pop]');
    if (!chip) return;
    var id = chip.getAttribute('data-pop');
    var sel = popularSel();
    var i = sel.indexOf(id);
    if (i > -1) sel.splice(i, 1);
    else if (sel.length >= 6) { toast('Máximo de 6 fixados — o app mostra 6'); return; }
    else sel.push(id);
    state.store.popular = sel;
    renderPopularPick();
  });

  function renderCoupons() {
    var cps = state.store.coupons || {};
    var codes = Object.keys(cps);
    var box = $('#couponList');
    if (!codes.length) {
      box.innerHTML = '<p class="hint" style="color:var(--muted);font-size:13px;margin:0">Nenhum cupom ativo.</p>';
      return;
    }
    box.innerHTML = codes.map(function (code) {
      return '<div class="coupon-row" data-code="' + esc(code) + '">' +
        '<input class="code" type="text" value="' + esc(code) + '" maxlength="20" aria-label="Código">' +
        '<input class="pct" type="number" min="1" max="90" step="1" inputmode="numeric" value="' + Math.round(cps[code] * 100) + '" aria-label="Percentual">' +
        '<span class="unit">%</span>' +
        '<button type="button" class="del" data-del aria-label="Remover">✕</button>' +
        '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------- tabs

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    setTab(b.dataset.tab);
  });

  function setTab(name) {
    activeTab = name;
    try { localStorage.setItem(TAB_KEY, name); } catch (e) {}
    $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === name); });
    $$('.panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    window.scrollTo(0, 0);
    if (name === 'pedidos') pollOrders();
    else loadAll();
  }

  // ---------------------------------------------------------------- caixa

  $('#periodChips').addEventListener('click', function (e) {
    var b = e.target.closest('.pchip');
    if (!b) return;
    cashPeriod = b.getAttribute('data-period');
    $$('.pchip').forEach(function (c) { c.classList.toggle('is-on', c === b); });
    renderCash();
  });

  function periodStart(p) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var t = Math.floor(d.getTime() / 1000);
    if (p === 'today') return t;
    if (p === 'week') return t - 6 * 86400;
    if (p === 'month') return t - 29 * 86400;
    return 0;
  }

  function renderCash() {
    var box = $('#kpis');
    if (!box) return;

    var from = periodStart(cashPeriod);
    var list = state.orders.filter(function (o) {
      return (Number(o.createdAt) || 0) >= from;
    }).sort(function (a, b) { return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); });

    var revenue = 0, fees = 0, units = 0, items = {};
    var pay = { pix: 0, card: 0, cash: 0 };
    var pending = 0;

    list.forEach(function (o) {
      var total = Number(o.total) || 0;
      var sub = Number(o.subtotal);
      if (isNaN(sub)) {
        sub = 0;
        (o.items || []).forEach(function (it) { sub += (Number(it.unit) || 0) * (Number(it.qty) || 1); });
      }
      revenue += total;
      fees += Math.max(0, total - sub);
      if (Number(o.status) < 4) pending++;

      var k = pay[o.pay] != null ? o.pay : 'pix';
      pay[k] += total;

      (o.items || []).forEach(function (it) {
        var qty = Number(it.qty) || 1;
        units += qty;
        var name = it.name || '—';
        if (!items[name]) items[name] = { qty: 0, revenue: 0 };
        items[name].qty += qty;
        items[name].revenue += (Number(it.unit) || 0) * qty;
      });
    });

    var tickets = list.length ? revenue / list.length : 0;
    var sold = revenue - fees;

    box.innerHTML = [
      kpi('Faturamento', money(revenue), 'total com entrega'),
      kpi('Produtos', money(sold), 'só os itens'),
      kpi('Entregas', money(fees), 'taxas cobradas'),
      kpi('Pedidos', String(list.length), pending ? pending + ' em andamento' : 'todos entregues'),
      kpi('Ticket médio', money(tickets), 'por pedido'),
      kpi('Itens vendidos', String(units), 'unidades')
    ].join('');

    /* por dia (ou por hora, se for hoje) */
    var buckets = {};
    list.forEach(function (o) {
      var d = new Date((Number(o.createdAt) || 0) * 1000);
      var key = cashPeriod === 'today'
        ? pad(d.getHours()) + 'h'
        : pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
      buckets[key] = (buckets[key] || 0) + (Number(o.total) || 0);
    });

    var keys;
    if (cashPeriod === 'today') {
      keys = [];
      var h0 = new Date().getHours();
      for (var h = 0; h <= h0; h++) keys.push(pad(h) + 'h');
      keys = keys.filter(function (k) { return buckets[k] || k === pad(h0) + 'h'; });
    } else {
      keys = Object.keys(buckets);
      if (cashPeriod === 'week') {
        keys = [];
        for (var i = 6; i >= 0; i--) {
          var dd = new Date(Date.now() - i * 86400000);
          keys.push(pad(dd.getDate()) + '/' + pad(dd.getMonth() + 1));
        }
      }
    }

    var max = Math.max.apply(null, keys.map(function (k) { return buckets[k] || 0; }).concat([1]));
    var bars = keys.length
      ? keys.map(function (k) {
          var v = buckets[k] || 0;
          var pct = Math.round(v / max * 100);
          return '<div class="bar" title="' + k + ' · ' + money(v) + '">' +
            '<i style="height:' + Math.max(v ? 4 : 0, pct) + '%"></i>' +
            '<span>' + k + '</span></div>';
        }).join('')
      : '<p class="cash-empty">Nenhuma venda no período.</p>';
    $('#barsByDay').innerHTML = bars;

    /* pagamento */
    var payTotal = pay.pix + pay.card + pay.cash;
    $('#payBreak').innerHTML = [['pix', 'Pix'], ['card', 'Cartão'], ['cash', 'Dinheiro']].map(function (p) {
      var pct = payTotal ? Math.round(pay[p[0]] / payTotal * 100) : 0;
      return '<div class="pay-row"><div class="pay-line"><b>' + p[1] + '</b>' +
        '<span>' + money(pay[p[0]]) + ' · ' + pct + '%</span></div>' +
        '<div class="pay-bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');

    /* mais vendidos */
    var top = Object.keys(items).map(function (name) {
      return { name: name, qty: items[name].qty, revenue: items[name].revenue };
    }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 6);

    $('#topProducts').innerHTML = top.length
      ? top.map(function (t, i) {
          return '<div class="top-row"><span class="rank">' + (i + 1) + '</span>' +
            '<b>' + esc(t.name) + '</b><span class="qty">' + t.qty + ' un</span>' +
            '<span class="rev">' + money(t.revenue) + '</span></div>';
        }).join('')
      : '<p class="cash-empty">Nenhuma venda no período.</p>';
  }

  function kpi(label, value, hint) {
    return '<div class="kpi"><span>' + label + '</span><b>' + value + '</b><small>' + hint + '</small></div>';
  }

  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

  // ---------------------------------------------------------------- produtos

  $('#newProduct').addEventListener('click', function () { openProduct('new'); });

  $('#productGrid').addEventListener('click', function (e) {
    var card = e.target.closest('.pcard');
    if (!card) return;
    openProduct(card.dataset.id);
  });

  function openProduct(id) {
    editing = id;
    editingImg = '';
    var isNew = id === 'new';
    var p = isNew
      ? { name: '', cat: (catList()[0] || {}).id || 'bolos', price: '', stock: '', tag: '', time: 'Encomenda · 1 dia', kcal: '', desc: '', active: true, img: '', extras: null }
      : state.products.filter(function (x) { return x.id === id; })[0];

    if (!p) return;

    $('#pModalTitle').textContent = isNew ? 'Novo produto' : 'Editar produto';
    $('#pDelete').hidden = isNew;

    editingImg = p.img || '';
    $('#pmImg').src = editingImg ? imgSrc(editingImg) : '';
    $('#pmImg').style.visibility = editingImg ? 'visible' : 'hidden';
    $('#pmName').value = p.name || '';
    var cats = catList();
    var catSel = $('#pmCat');
    catSel.innerHTML = cats.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
    }).join('');
    var pcat = p.cat || (cats[0] && cats[0].id) || 'bolos';
    if (pcat && !cats.some(function (c) { return c.id === pcat; })) {
      catSel.innerHTML += '<option value="' + esc(pcat) + '">' + esc(pcat) + ' (categoria inexistente)</option>';
    }
    catSel.value = pcat;
    $('#pmPrice').value = p.price !== '' && p.price != null ? p.price : '';
    $('#pmStock').value = p.stock != null ? p.stock : '';
    $('#pmTag').value = p.tag || '';
    $('#pmTime').value = p.time || '';
    $('#pmKcal').value = p.kcal || '';
    $('#pmDesc').value = p.desc || '';
    $('#pmActive').checked = p.active !== false;

    var szAll = !Array.isArray(p.sizes);
    $('#pmSizesAll').checked = szAll;
    $('#pmSizesPick').innerHTML = sizesList().map(function (s) {
      var on = szAll || p.sizes.indexOf(s.id) >= 0;
      return '<label class="check"><input type="checkbox" class="pm-sz" value="' + esc(s.id) + '"' + (on ? ' checked' : '') + '> <span>' + esc(s.label) + '</span></label>';
    }).join('') || '<p class="fee-hint" style="margin:0">Nenhum tamanho cadastrado na loja.</p>';
    syncPicks();

    var exAll = !Array.isArray(p.extras);
    $('#pmExtrasAll').checked = exAll;
    var exList = Array.isArray(state.store.extras) ? state.store.extras : DEFAULT_EXTRAS;
    $('#pmExtrasPick').innerHTML = exList.map(function (x) {
      var on = exAll || p.extras.indexOf(x.id) >= 0;
      return '<label class="check"><input type="checkbox" class="pm-ex" value="' + esc(x.id) + '"' + (on ? ' checked' : '') + '> <span>' + esc(x.label) + '</span></label>';
    }).join('') || '<p class="fee-hint" style="margin:0">Nenhum adicional cadastrado na loja.</p>';
    syncPicks();

    $('#pModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('#pmName').focus(); }, 80);
  }

  function syncPicks() {
    var sz = $('#pmSizesPick'), ex = $('#pmExtrasPick');
    if (sz) sz.hidden = $('#pmSizesAll').checked;
    if (ex) ex.hidden = $('#pmExtrasAll').checked;
  }

  $('#pmSizesAll').addEventListener('change', syncPicks);
  $('#pmExtrasAll').addEventListener('change', syncPicks);

  function closeProduct() {
    $('#pModal').hidden = true;
    document.body.style.overflow = '';
    editing = null;
    editingImg = '';
  }

  $('#pCancel').addEventListener('click', closeProduct);
  $('#pCancelX').addEventListener('click', closeProduct);
  $('#pModal').addEventListener('click', function (e) {
    if (e.target === $('#pModal')) closeProduct();
  });

  $('#pmClearImg').addEventListener('click', function () {
    editingImg = '';
    $('#pmImg').src = '';
    $('#pmImg').style.visibility = 'hidden';
  });

  $('#pSave').addEventListener('click', function () {
    var name = $('#pmName').value.trim();
    if (!name) { toast('Dê um nome ao produto'); $('#pmName').focus(); return; }

    var extras = $('#pmExtrasAll').checked ? null : $$('#pmExtrasPick .pm-ex').filter(function (c) {
      return c.checked;
    }).map(function (c) { return c.value; });
    var sizes = $('#pmSizesAll').checked ? null : $$('#pmSizesPick .pm-sz').filter(function (c) {
      return c.checked;
    }).map(function (c) { return c.value; });

    var body = {
      name: name,
      cat: $('#pmCat').value,
      price: parseFloat($('#pmPrice').value) || 0,
      stock: $('#pmStock').value.trim() === '' ? null : Math.max(0, parseInt($('#pmStock').value, 10) || 0),
      tag: $('#pmTag').value.trim(),
      time: $('#pmTime').value.trim(),
      kcal: parseInt($('#pmKcal').value, 10) || 0,
      desc: $('#pmDesc').value.trim(),
      active: $('#pmActive').checked,
      extras: extras,
      sizes: sizes,
      img: editingImg
    };

    var btn = $('#pSave');
    btn.disabled = true;
    var req = editing === 'new'
      ? api('/api/admin/products', { method: 'POST', body: body })
      : api('/api/admin/products/' + encodeURIComponent(editing), { method: 'PUT', body: body });

    req.then(function (d) {
      var p = d.product;
      if (editing === 'new') state.products.push(p);
      else {
        state.products = state.products.map(function (x) { return x.id === p.id ? p : x; });
      }
      renderProducts();
      renderStock();
      closeProduct();
      toast('Produto salvo');
    }).catch(function (e) {
      toast(e.message);
    }).then(function () { btn.disabled = false; });
  });

  $('#pDelete').addEventListener('click', function () {
    if (!editing || editing === 'new') return;
    var p = state.products.filter(function (x) { return x.id === editing; })[0];
    if (!confirm('Excluir “' + (p ? p.name : 'produto') + '” do cardápio?')) return;
    api('/api/admin/products/' + encodeURIComponent(editing), { method: 'DELETE' }).then(function () {
      state.products = state.products.filter(function (x) { return x.id !== editing; });
      renderProducts();
      renderStock();
      closeProduct();
      toast('Produto excluído');
    }).catch(function (e) { toast(e.message); });
  });

  // upload de foto do produto
  $('#pmFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    uploadFile(file, function (path) {
      editingImg = path;
      $('#pmImg').src = imgSrc(path);
      $('#pmImg').style.visibility = 'visible';
    });
    e.target.value = '';
  });

  // ---------------------------------------------------------------- estoque

  function queueStockSave(id, value) {
    clearTimeout(stockTimers[id]);
    stockTimers[id] = setTimeout(function () {
      api('/api/admin/products/' + encodeURIComponent(id), { method: 'PUT', body: { stock: value } })
        .then(function (d) {
          var p = state.products.filter(function (x) { return x.id === id; })[0];
          if (p) p.stock = d.product.stock;
          updateStockLabels();
        })
        .catch(function (e) { toast(e.message); });
    }, 400);
  }

  $('#stockList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-step]');
    if (!btn) return;
    var row = btn.closest('.srow');
    var input = $('input[type=number]', row);
    var cur = input.value === '' ? 0 : (parseInt(input.value, 10) || 0);
    var next = Math.max(0, cur + parseInt(btn.dataset.step, 10));
    input.value = next;
    $('[data-inf]', row).checked = false;
    var p = state.products.filter(function (x) { return x.id === row.dataset.id; })[0];
    if (p) p.stock = next;
    updateStockLabels();
    queueStockSave(row.dataset.id, next);
  });

  $('#stockList').addEventListener('change', function (e) {
    var row = e.target.closest('.srow');
    if (!row) return;
    var id = row.dataset.id;

    if (e.target.hasAttribute('data-inf')) {
      var input = $('input[type=number]', row);
      if (e.target.checked) {
        input.value = '';
        queueStockSave(id, null);
      } else {
        if (input.value === '') input.value = 0;
        queueStockSave(id, Math.max(0, parseInt(input.value, 10) || 0));
      }
      var p0 = state.products.filter(function (x) { return x.id === id; })[0];
      if (p0) p0.stock = e.target.checked ? null : Math.max(0, parseInt(input.value, 10) || 0);
      updateStockLabels();
      return;
    }

    if (e.target.type === 'number') {
      var v = e.target.value.trim();
      var val = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
      var p = state.products.filter(function (x) { return x.id === id; })[0];
      if (p) p.stock = val;
      updateStockLabels();
      queueStockSave(id, val);
    }
  });

  // ---------------------------------------------------------------- pedidos

  $('#refreshOrders').addEventListener('click', function () { pollOrders(); toast('Atualizado'); });

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

  $('#ordersList').addEventListener('click', function (e) {
    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      copyText(copyBtn.dataset.copy)
        .then(function () { toast('Link do motoboy copiado'); })
        .catch(function (err) { toast(err.message); });
      return;
    }

    var delBtn = e.target.closest('[data-odel]');
    if (delBtn) {
      var dcard = delBtn.closest('.order');
      var dnum = dcard.dataset.num;
      if (!confirm('Apagar o pedido #' + dnum + '?\n\nEle sai do painel e do histórico. Não dá para desfazer.')) return;
      delBtn.disabled = true;
      api('/api/admin/orders/' + encodeURIComponent(dnum), { method: 'DELETE' })
        .then(function () {
          state.orders = state.orders.filter(function (o) { return String(o.num) !== String(dnum); });
          renderOrders();
          toast('Pedido #' + dnum + ' apagado');
        })
        .catch(function (err) {
          delBtn.disabled = false;
          toast(err.message);
        });
      return;
    }

    var btn = e.target.closest('[data-status]');
    if (!btn) return;
    var card = btn.closest('.order');
    var num = card.dataset.num;
    var status = parseInt(btn.dataset.status, 10);

    api('/api/admin/orders/' + encodeURIComponent(num), { method: 'PUT', body: { status: status } })
      .then(function (d) {
        state.orders = state.orders.map(function (o) {
          return String(o.num) === String(num) ? d.order : o;
        });
        renderOrders();
        toast('Pedido #' + num + ' → ' + STATUS[status - 1]);
      })
      .catch(function (err) { toast(err.message); });
  });

  // ---------------------------------------------------------------- loja

  $('#saveStore').addEventListener('click', function () {
    var coupons = {};
    $$('#couponList .coupon-row').forEach(function (row) {
      var code = $('.code', row).value.trim().toUpperCase();
      var pct = parseFloat($('.pct', row).value);
      if (code && pct > 0) coupons[code] = Math.min(90, pct) / 100;
    });

    var mode = $('#stMode').value === 'km' ? 'km' : 'fixed';
    var originCep = $('#stOriginCep').value.replace(/\D/g, '');
    if (mode === 'km' && originCep.length !== 8) {
      toast('Informe o CEP da loja para cobrar por distância');
      $('#stOriginCep').focus();
      return;
    }

    var body = {
      name: $('#stName').value.trim(),
      tagline: $('#stTagline').value.trim(),
      fee: parseFloat($('#stFee').value) || 0,
      minOrder: parseFloat($('#stMin').value) || 0,
      whatsapp: $('#stWa').value.replace(/\D/g, ''),
      hours: $('#stHours').value.trim(),
      hoursAuto: $('#stHoursAuto').checked,
      schedule: readSchedule(),
      address: $('#stAddr').value.trim(),
      originCep: originCep,
      delivery: {
        mode: mode,
        base: parseFloat($('#stBase').value) || 0,
        perKm: parseFloat($('#stPerKm').value) || 0,
        minFee: parseFloat($('#stMinFee').value) || 0,
        maxKm: parseFloat($('#stMaxKm').value) || 0,
        roadFactor: parseFloat($('#stRoad').value) || 1.3
      },
      banners: readBanners(),
      popup: readPopup(),
      popular: popularSel(),
      sizes: readSizes(),
      extras: readExtras(),
      categories: readCats(),
      coupons: coupons,
      open: state.store.open !== false
    };

    var btn = $('#saveStore');
    btn.disabled = true;
    api('/api/admin/store', { method: 'PUT', body: body }).then(function (d) {
      state.store = d.store;
      renderBrand();
      renderStore();
      toast('Loja atualizada');
    }).catch(function (e) { toast(e.message); })
      .then(function () { btn.disabled = false; });
  });

  $('#openToggle').addEventListener('click', function () {
    if (state.store.hoursAuto) {
      toast('Horário automático ativo — desligue na aba Loja para abrir/fechar na mão');
      return;
    }
    var open = !(state.store.open !== false);
    api('/api/admin/store', { method: 'PUT', body: { open: open } }).then(function (d) {
      state.store = d.store;
      renderBrand();
      toast(open ? 'Loja aberta — já aceita pedidos' : 'Loja fechada — app bloqueia pedidos');
    }).catch(function (e) { toast(e.message); });
  });

  $('#addCoupon').addEventListener('click', function () {
    var cps = state.store.coupons || {};
    state.store.coupons = cps;
    if (!Object.keys(cps).length) {
      state.store.coupons = { 'NOVO10': 0.10 };
    } else {
      var n = 2, code;
      do { code = 'CUPOM' + n; n++; } while (cps[code]);
      cps[code] = 0.10;
    }
    renderCoupons();
    var rows = $$('#couponList .coupon-row');
    var last = rows[rows.length - 1];
    if (last) { last.querySelector('.code').focus(); last.querySelector('.code').select(); }
  });

  $('#couponList').addEventListener('click', function (e) {
    if (!e.target.closest('[data-del]')) return;
    var row = e.target.closest('.coupon-row');
    var code = $('.code', row).value.trim().toUpperCase();
    if (state.store.coupons) delete state.store.coupons[code];
    renderCoupons();
  });

  // upload do logo
  $('#logoFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    uploadFile(file, function (path) {
      api('/api/admin/store', { method: 'PUT', body: { logo: path } })
        .then(function (d) {
          state.store = d.store;
          renderBrand();
          renderStore();
          api('/api/admin/icons', { method: 'POST' }).then(function (r) {
            toast(r.ok ? 'Logo salvo e ícones do app atualizados' : 'Logo salvo');
          }).catch(function () { toast('Logo salvo'); });
        })
        .catch(function (err) { toast(err.message); });
    }, true);
    e.target.value = '';
  });

  // ---------------------------------------------------------------- upload

  function uploadFile(file, done, big) {
    if (!/^image\//.test(file.type)) { toast('Escolha um arquivo de imagem'); return; }
    var hint = $('#pmUploading');
    if (hint) hint.hidden = false;

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = big ? 900 : 1100;
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/webp', 0.86);
        var ar = canvas.height > 0 ? canvas.width / canvas.height : 0;

        api('/api/upload', { method: 'POST', body: { data: dataUrl } }).then(function (d) {
          done(d.path, ar);
        }).catch(function (e) {
          toast('Falha no envio: ' + e.message);
        }).then(function () {
          if (hint) hint.hidden = true;
        });
      };
      img.onerror = function () {
        toast('Não consegui ler essa imagem');
        if (hint) hint.hidden = true;
      };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('Falha ao ler arquivo'); };
    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------------- start

  if (pin) {
    boot();
  } else {
    setTimeout(function () { $('#pinInput').focus(); }, 100);
  }

})();
