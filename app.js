/* ============================================================
   DELÍCIAS DO ALEFF — Delivery PWA
   navegação, cardápio, carrinho, cupom, checkout, rastreio
   estado persistido em localStorage
   ============================================================ */

(function () {
  'use strict';

  var doc = document;

  /* ---------------- dados ---------------- */

  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    burger: '<path d="M4 10a8 8 0 0 1 16 0"/><path d="M3.5 13.5h17"/><path d="M4 17h16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/>',
    flame: '<path d="M12 3s5 4.4 5 9a5 5 0 0 1-10 0c0-2 1-3.6 2-4.6 0 2 1 3 2 3s1.3-2-1-7.4Z"/>',
    fries: '<path d="M6 9h12l-1.4 10.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6 9Z"/><path d="M8.5 9V5M12 9V3.5M15.5 9V5.5"/>',
    cup: '<path d="M6.5 8h11l-1 11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2l-1-11Z"/><path d="M5 8h14"/><path d="m13.5 3-1 5"/>',
    ice: '<path d="M8 11a4 4 0 0 1 8 0"/><path d="M7.5 13h9L12 21l-4.5-8Z"/>',
    utensils: '<path d="M7 3v6a2.5 2.5 0 0 0 5 0V3"/><path d="M9.5 11.5V21"/><path d="M18 3c-1.4 1.2-2 3-2 5.5s.7 3.5 2 3.5V21"/>',
    cake: '<path d="M4 21h16"/><path d="M6 21v-7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7"/><path d="M6 16c1.5 1 2.5 1 4 0s2.5-1 4 0 2.5 1 4 0"/><path d="M12 9V6"/><path d="M12 3.5c.6.3 1 .9 1 1.4 0 .8-1 1.6-1 1.6s-1-.8-1-1.6c0-.5.4-1.1 1-1.4Z"/>',
    slice: '<path d="M4 20 20 4v9a7 7 0 0 1-7 7H4Z"/><path d="m7 16 9-9"/><path d="M4 20h9"/>',
    tart: '<path d="M3.5 13h17"/><path d="M5 13a7 7 0 0 1 14 0"/><path d="M6 17c2 1.3 4 1.3 6 0s4-1.3 6 0"/>',
    candy: '<circle cx="12" cy="12" r="4"/><path d="m8 9-4-2v10l4-2"/><path d="m16 9 4-2v10l-4-2"/>',
    box: '<path d="M4 8h16v12H4Z"/><path d="M2 4h20v4H2Z"/><path d="M12 4v16"/><path d="M12 4c-1-2-4-2-4 0h4Z"/><path d="M12 4c1-2 4-2 4 0h-4Z"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="7.5" cy="7.5" r="1.4"/>'
  };

  /* aparência de cada categoria; as criadas no painel ganham ícone padrão */
  var CAT_LOOK = {
    bolos: { icon: '🎂', svg: ICONS.cake },
    fatias: { icon: '🍰', svg: ICONS.slice },
    tortas: { icon: '🥧', svg: ICONS.tart },
    doces: { icon: '🍬', svg: ICONS.candy },
    kits: { icon: '🎁', svg: ICONS.box },
    bebidas: { icon: '🥤', svg: ICONS.cup }
  };
  var CAT_EMOJI = ['🧁', '🍪', '🍫', '🍮', '🥐', '🍩', '🍨', '🥮', '🧇', '🍯'];

  var CATS = [
    { id: 'all', label: 'Tudo', icon: '🎂', svg: ICONS.grid },
    { id: 'bolos', label: 'Bolos', icon: '🎂', svg: ICONS.cake },
    { id: 'fatias', label: 'Fatias', icon: '🍰', svg: ICONS.slice },
    { id: 'tortas', label: 'Tortas', icon: '🥧', svg: ICONS.tart },
    { id: 'doces', label: 'Docinhos', short: 'Doces', icon: '🍬', svg: ICONS.candy },
    { id: 'kits', label: 'Kits festa', short: 'Kits', icon: '🎁', svg: ICONS.box },
    { id: 'bebidas', label: 'Bebidas', icon: '🥤', svg: ICONS.cup }
  ];

  function setCats(list) {
    CATS = [{ id: 'all', label: 'Tudo', icon: '🎂', svg: ICONS.grid }].concat(list.map(function (c, i) {
      var look = CAT_LOOK[c.id] || { icon: CAT_EMOJI[i % CAT_EMOJI.length], svg: ICONS.tag };
      return { id: c.id, label: c.label, short: c.short || '', icon: look.icon, svg: look.svg, emoji: c.icon || '' };
    }));
    if (!CATS.some(function (c) { return c.id === activeCat; })) activeCat = 'all';
  }

  var PRODUCTS = [
    {
      id: 'bolo-choco', name: 'Bolo de Chocolate', cat: 'bolos', price: 89.9,
      rating: 4.9, time: 'Encomenda · 1 dia', kcal: 0, tag: 'Mais pedido',
      img: 'img/bolo-chocolate.webp', sizes: ['p', 'm', 'g'],
      desc: 'Massa de cacau 50% com recheio de brigadeiro cremoso e ganache por cima. Feito no dia da entrega.'
    },
    {
      id: 'bolo-morango', name: 'Bolo de Morango', cat: 'bolos', price: 95.0,
      rating: 4.9, time: 'Encomenda · 1 dia', kcal: 0, tag: 'Da casa',
      img: 'img/bolo-morango.webp', sizes: ['p', 'm', 'g'],
      desc: 'Pão de ló fofinho, chantilly fresco e morangos picados entre as camadas. Leve e cremoso.'
    },
    {
      id: 'bolo-cenoura', name: 'Bolo de Cenoura', cat: 'bolos', price: 69.9,
      rating: 4.8, time: 'Encomenda · 1 dia', kcal: 0, tag: '',
      img: 'img/bolo-cenoura.webp', sizes: ['p', 'm', 'g'],
      desc: 'Bolo de cenoura com pedaços, coberto com calda de chocolate meio amargo. O clássico da casa.'
    },
    {
      id: 'redvelvet', name: 'Red Velvet', cat: 'bolos', price: 105.0,
      rating: 5.0, time: 'Encomenda · 1 dia', kcal: 0, tag: 'Especial',
      img: 'img/bolo-redvelvet.webp', sizes: ['p', 'm', 'g'],
      desc: 'Massa vermelha de cacau com cream cheese frosting e raspas de limão. Para ocasiões especiais.'
    },
    {
      id: 'fatia-choco', name: 'Fatia de Chocolate', cat: 'fatias', price: 14.9,
      rating: 4.9, time: '30–40 min', kcal: 380, tag: 'Quentinho',
      img: 'img/fatia-chocolate.webp', sizes: [],
      desc: 'Fatia generosa do bolo de chocolate com brigadeiro e ganache. Servida gelada.'
    },
    {
      id: 'fatia-morango', name: 'Fatia de Morango', cat: 'fatias', price: 16.9,
      rating: 4.8, time: '30–40 min', kcal: 360, tag: '',
      img: 'img/fatia-morango.webp', sizes: [],
      desc: 'Pão de ló, chantilly e morangos frescos em camadas. Doce na medida.'
    },
    {
      id: 'torta-limao', name: 'Torta de Limão', cat: 'tortas', price: 18.9,
      rating: 4.8, time: '30–40 min', kcal: 340, tag: '',
      img: 'img/torta-limao.webp', sizes: [],
      desc: 'Base de biscoito, creme de limão siciliano e merengue maçaricado. Azedinho do jeito certo.'
    },
    {
      id: 'torta-maracuja', name: 'Torta de Maracujá', cat: 'tortas', price: 18.9,
      rating: 4.7, time: '30–40 min', kcal: 350, tag: '',
      img: 'img/torta-maracuja.webp', sizes: [],
      desc: 'Creme de maracujá com calda de sementes e base de biscoito. Refrescante.'
    },
    {
      id: 'brigadeiro', name: 'Brigadeiro Gourmet (6)', cat: 'doces', price: 18.0,
      rating: 5.0, time: '30–40 min', kcal: 420, tag: 'Mais pedido',
      img: 'img/docinhos.webp',
      desc: 'Seis brigadeiros de chocolate nobre enrolados à mão, com granulado belga.'
    },
    {
      id: 'beijinho', name: 'Beijinho (6)', cat: 'doces', price: 16.0,
      rating: 4.8, time: '30–40 min', kcal: 400, tag: '',
      img: 'img/docinhos.webp',
      desc: 'Seis beijinhos de coco com cravo. Docinhos de festa feitos na casa.'
    },
    {
      id: 'kit-festa', name: 'Kit Festa 20 pessoas', cat: 'kits', price: 249.0,
      rating: 4.9, time: 'Encomenda · 2 dias', kcal: 0, tag: 'Festa',
      img: 'img/kit-festa.webp', sizes: [],
      desc: 'Bolo médio, 40 docinhos sortidos, pratos, talheres e velas. Encomende com 2 dias.'
    },
    {
      id: 'cafe', name: 'Café Coado 300 ml', cat: 'bebidas', price: 6.9,
      rating: 4.7, time: '20–30 min', kcal: 90, tag: '',
      img: 'img/bebida.webp', extras: [], sizes: [],
      desc: 'Café coado na hora, torra média. Vem quente em copo térmico.'
    },
    {
      id: 'refri', name: 'Refrigerante lata', cat: 'bebidas', price: 6.0,
      rating: 4.5, time: '20–30 min', kcal: 140, tag: '',
      img: 'img/bebida.webp', extras: [], sizes: [],
      desc: 'Lata de 350 ml bem gelada — cola, guaraná ou laranja. Avise o sabor na observação.'
    }
  ];

  /* configuração da loja — sobrescrita pelo painel via /api/menu */
  var STORE = {
    name: 'Delícias do Aleff · Bolos',
    logo: '',
    open: true,
    hours: 'Seg a Sáb, 9h às 19h',
    whatsapp: '5511999999999',
    minOrder: 0,
    popular: [],
    sizes: [
      { id: 'p', label: 'Pequeno · 12 fatias', extra: 0 },
      { id: 'm', label: 'Médio · 20 fatias', extra: 40 },
      { id: 'g', label: 'Grande · 30 fatias', extra: 80 }
    ]
  };

  var SIZES = [
    { id: 'p', label: 'Pequeno · 12 fatias', extra: 0 },
    { id: 'm', label: 'Médio · 20 fatias', extra: 40 },
    { id: 'g', label: 'Grande · 30 fatias', extra: 80 }
  ];

  var EXTRAS = [
    { id: 'vela', label: 'Vela de aniversário', price: 0 },
    { id: 'choco', label: 'Chocolate extra', price: 8 },
    { id: 'morango', label: 'Morangos frescos', price: 12 },
    { id: 'cartao', label: 'Cartãozinho', price: 0 },
    { id: 'presente', label: 'Embalagem de presente', price: 5 }
  ];

  var FEE = 6.9;                 /* taxa fixa do servidor (reserva/fallback) */
  var DELIVERY = { cep: '', km: null, fee: null, source: 'fixed', tooFar: false, loading: false };
  var DELIVERY_CFG = { mode: 'fixed' };
  var geoFeeCache = {};
  var COUPONS = { BOLO10: 0.1, FESTA15: 0.15 };

  var DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  /* ---------------- estado ---------------- */

  var store = {
    cart: [],
    favs: [],
    orders: [],
    coupon: null,
    customer: '',
    addresses: [],
    addr: { id: '', title: 'Casa', name: '', cep: '', street: '', district: '', city: '',
            state: '', number: '', complement: '', phone: '',
            text: 'Rua das Brasas, 128 — Centro' },
    pay: 'pix',
    notif: true
  };

  try {
    var saved = JSON.parse(localStorage.getItem('sc-delivery-v1') || 'null');
    if (saved && typeof saved === 'object') {
      Object.keys(store).forEach(function (k) {
        if (saved[k] !== undefined) store[k] = saved[k];
      });
    }
  } catch (e) { /* estado novo */ }

  store.addr = migrarEndereco(store.addr);

  /* agenda de endereços: migra o endereço único antigo para a lista */
  function newAddrId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  (function migrarAgenda() {
    var lista = Array.isArray(store.addresses) ? store.addresses.map(migrarEndereco) : [];
    if (store.addr && store.addr.cep) {
      var achou = null;
      for (var i = 0; i < lista.length; i++) {
        if (store.addr.id && lista[i].id === store.addr.id) achou = lista[i];
        else if (!store.addr.id && lista[i].cep === store.addr.cep &&
                 lista[i].number === store.addr.number) achou = lista[i];
      }
      if (!achou) {
        if (!store.addr.id) store.addr.id = newAddrId();
        lista.push(store.addr);
      } else if (!store.addr.id) {
        store.addr.id = achou.id;
      }
    }
    store.addresses = lista;
  })();

  function enderecoTexto(a) {
    var linha = '';
    if (a.street) linha = a.number ? a.street + ', ' + a.number : a.street;
    else if (a.number) linha = a.number;
    var local = [a.district, a.city].filter(Boolean).join(', ');
    var txt = [linha, local].filter(Boolean).join(' — ');
    return txt || a.text || '';
  }

  function migrarEndereco(a) {
    var base = { id: '', title: 'Casa', name: '', cep: '', street: '', district: '',
                 city: '', state: '', number: '', complement: '', phone: '', text: '' };
    if (a && typeof a === 'object') {
      Object.keys(base).forEach(function (k) {
        if (a[k] != null) base[k] = String(a[k]);
      });
    } else if (typeof a === 'string') {
      base.text = a;
    }
    if (!base.text) base.text = enderecoTexto(base);
    if (!base.text) base.text = 'Definir endereço';
    return base;
  }

  function save() {
    try { localStorage.setItem('sc-delivery-v1', JSON.stringify(store)); } catch (e) {}
  }

  /* ---------------- utilidades ---------------- */

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }

  function brl(v) {
    return 'R$ ' + v.toFixed(2).replace('.', ',');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function soldOut(p) {
    return !!p && (p.active === false || p.stock === 0);
  }

  function product(id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  }

  function nowTime() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var toastEl = $('#toast');
  var toastTimer;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function buzz() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  /* ---------------- telas ---------------- */

  var current = 'home';

  function go(name, opts) {
    var target = $('#screen-' + name);
    if (!target) return;
    $$('.screen').forEach(function (s) { s.classList.remove('is-active'); });
    target.classList.add('is-active');
    current = name;
    $$('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === name);
    });
    var tabbar = $('#tabbar');
    tabbar.style.display = (name === 'track') ? 'none' : '';
    if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
    if (name === 'cart') renderCart();
    if (name === 'profile') renderProfile();
    if (name === 'menu') renderMenu();
    if (name === 'home') renderHome();
    if (name === 'track') syncTrackView();
    else stopTrackMap();
    buzz();
  }

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { go(tab.getAttribute('data-tab')); });
  });

  doc.addEventListener('click', function (e) {
    var el = e.target.closest('[data-goto]');
    if (!el) return;
    var cat = el.getAttribute('data-cat');
    if (cat && cat !== 'all') {
      activeCat = cat;
      renderChips();
      renderPopular();
      renderMenu();
    }
    go(el.getAttribute('data-goto'));
  });

  /* ---------------- home ---------------- */

  var activeCat = 'all';

  function catIcon(c) {
    return c.emoji ? '<span class="cat-emo">' + esc(c.emoji) + '</span>'
      : '<svg viewBox="0 0 24 24" class="ico">' + c.svg + '</svg>';
  }

  function renderChips() {
    var vis = CATS.filter(function (c) {
      return c.id === 'all' || PRODUCTS.some(function (p) { return p.cat === c.id; });
    });
    var chips = vis.map(function (c) {
      return '<button class="chip' + (c.id === activeCat ? ' is-on' : '') + '" type="button" data-cat="' + c.id + '">' +
        '<i>' + catIcon(c) + '</i>' + esc(c.label) + '</button>';
    }).join('');
    var tiles = vis.map(function (c) {
      return '<button class="cat-tile' + (c.id === activeCat ? ' is-on' : '') + '" type="button" data-cat="' + c.id + '">' +
        '<i>' + catIcon(c) + '</i>' +
        '<b>' + esc(c.short || c.label) + '</b></button>';
    }).join('');
    $('#catTiles').innerHTML = tiles;
    $('#menuChips').innerHTML = chips;
  }

  function scrollToSection(sel) {
    var sec = $(sel);
    if (!sec) return;
    requestAnimationFrame(function () {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  doc.addEventListener('click', function (e) {
    /* "Ver todas" dentro do bloco filtrado volta o catálogo inteiro */
    if (e.target.closest('[data-clear-cat]')) {
      activeCat = 'all';
      renderChips();
      renderPopular();
      renderHomeCats();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      buzz();
      return;
    }

    var chip = e.target.closest('.chip[data-cat], .cat-tile[data-cat]');
    if (!chip) return;
    var cat = chip.getAttribute('data-cat');

    /* na home o quadradinho filtra o catálogo e desce até o bloco — dá pra
       continuar rolando a partir dali, sem voltar pro topo */
    if (chip.classList.contains('cat-tile') && current === 'home') {
      activeCat = cat;
      renderChips();
      renderPopular();
      renderHomeCats();
      if (cat === 'all') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollToSection('#home-cat-' + cat);
      }
      buzz();
      return;
    }

    activeCat = cat;
    renderChips();
    renderPopular();
    renderMenu();
    /* pílula do cardápio já está no cardápio */
    if (chip.classList.contains('chip') && current !== 'menu') go('menu');
  });

  function cardHTML(p, compact) {
    var img = '<img src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy">';
    var out = soldOut(p);
    var tag = out ? '<span class="sold-tag">Esgotado</span>' : '';
    var cls = out ? ' sold-out' : '';
    if (compact) {
      return '<article class="p-card' + cls + '" data-pid="' + p.id + '">' +
        img + tag +
        '<button class="hcard-add" type="button" data-add="' + p.id + '" aria-label="Adicionar ' + esc(p.name) + '">+</button>' +
        '<div class="p-card-body">' +
          '<h4>' + esc(p.name) + '</h4>' +
          '<div class="p-card-meta"><span class="star">★ ' + Number(p.rating || 0).toFixed(1) + '</span>' +
          '<b>' + brl(p.price) + '</b></div>' +
        '</div></article>';
    }
    return '<article class="card' + cls + '" data-pid="' + p.id + '">' +
      '<img class="card-thumb" src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy">' + tag +
      '<div class="card-body">' +
        '<h4>' + esc(p.name) + '</h4>' +
        '<p>' + esc(p.desc) + '</p>' +
        '<div class="card-foot"><b>' + brl(p.price) + '</b>' +
        '<span class="meta">★ ' + Number(p.rating || 0).toFixed(1) + '</span>' +
        '<span class="meta">' + esc(p.time) + '</span></div>' +
      '</div>' +
      '<button class="add-btn" type="button" data-add="' + p.id + '" aria-label="Adicionar ' + esc(p.name) + '">+</button>' +
      '</article>';
  }

  function gridHTML(p) {
    var out = soldOut(p);
    var tag = out ? '<span class="sold-tag">Esgotado</span>' : '';
    var stars = '';
    var rate = Math.round(Number(p.rating || 0));
    for (var i = 1; i <= 5; i++) stars += '<i' + (i > rate ? ' class="off"' : '') + '>★</i>';
    return '<article class="gcard' + (out ? ' sold-out' : '') + '" data-pid="' + p.id + '">' +
      '<div class="gcard-img"><img src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy">' + tag + '</div>' +
      '<div class="gcard-body">' +
        '<h4>' + esc(p.name) + '</h4>' +
        '<div class="gcard-stars">' + stars + '</div>' +
        '<div class="gcard-foot"><b>' + brl(p.price) + '</b>' +
        '<button class="g-add" type="button" data-add="' + p.id + '" aria-label="Adicionar ' + esc(p.name) + '">' +
        (out ? 'Esgotado' : 'Adicionar') + '</button></div>' +
      '</div></article>';
  }

  function listFor(cat) {
    return PRODUCTS.filter(function (p) { return cat === 'all' || p.cat === cat; });
  }

  function renderPopular() {
    var list = listFor(activeCat);
    if (!list.length) list = PRODUCTS.slice();
    list = list.map(function (p, i) {
      var k = STORE.popular.indexOf(p.id);
      return { p: p, k: k < 0 ? 1000 + i : k };
    }).sort(function (a, b) { return a.k - b.k; })
      .map(function (x) { return x.p; });
    var el = $('#popularTitle');
    if (el) el.textContent = 'Mais pedidos';
    /* com filtro ativo a categoria já aparece no bloco dela logo abaixo */
    var pb = $('#popularBlock');
    if (pb) pb.hidden = activeCat !== 'all';
    $('#popularList').innerHTML = list.slice(0, 6).map(gridHTML).join('');
  }

  /* catálogo completo na home, um bloco por categoria (ou só o filtrado) */
  function renderHomeCats() {
    var host = $('#homeCats');
    if (!host) return;
    var blocks = CATS.map(function (c) {
      if (c.id === 'all') return '';
      if (activeCat !== 'all' && c.id !== activeCat) return '';
      var list = PRODUCTS.filter(function (p) { return p.cat === c.id; });
      if (!list.length) return '';
      return '<div class="home-cat" id="home-cat-' + c.id + '">' +
        '<div class="row-head"><h3>' + esc(c.label) + '</h3>' +
        '<button class="link" type="button" data-goto="menu" data-cat="' + c.id + '">Ver no cardápio</button></div>' +
        '<div class="grid-2">' + list.map(gridHTML).join('') + '</div>' +
      '</div>';
    }).join('');
    var bar = activeCat !== 'all'
      ? '<div class="home-filter"><button class="link" type="button" data-clear-cat>← Ver todas as categorias</button></div>'
      : '';
    host.innerHTML = bar + blocks;
  }

  function customerName() {
    var n = (store.customer || (store.addr && store.addr.name) || '');
    return n.trim();
  }

  function firstName() {
    return customerName().split(/\s+/)[0] || '';
  }

  function renderGreeting() {
    var h = new Date().getHours();
    var greet = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    var nome = firstName();
    var h1 = $('.home-greet h1');
    if (h1) h1.innerHTML = greet + (nome ? ', <em>' + esc(nome) + '</em>' : '') + ' 👋';
  }

  function renderHome() {
    renderGreeting();
    renderChips();
    renderPopular();
    renderHomeCats();
  }

  /* ---------------- banners da home (slide) ---------------- */

  var DEFAULT_BANNERS = [{ tag: 'Feito no dia', title: 'BOLOS', off: 'CASEIROS',
    sub: 'encomende o seu', btn: 'Pedir agora', img: 'img/banner-bolos.webp', active: true }];
  var BANNERS = DEFAULT_BANNERS.slice();
  var bannersSig = JSON.stringify(BANNERS);
  var promoIdx = 0;
  var promoTimer = null;

  /* ---------------- anúncio em pop-up ---------------- */

  var POPUP = null;
  var popupSig = '';
  var adShown = false;
  var adTimer = null;

  function adKey(p) {
    return 'ad:' + (String(p.title || '') + '|' + String(p.text || '') + '|' + String(p.img || '')).slice(0, 100);
  }

  function adDue(p) {
    try {
      if (p.freq === 'session') return !sessionStorage.getItem(adKey(p));
      var last = Number(localStorage.getItem(adKey(p)) || 0);
      if (!last) return true;
      return p.freq === 'always' ? Date.now() - last > 60000 : Date.now() - last > 86400000;
    } catch (e) { return true; }
  }

  function adMark(p) {
    try {
      if (p.freq === 'session') sessionStorage.setItem(adKey(p), '1');
      else localStorage.setItem(adKey(p), String(Date.now()));
    } catch (e) { /* modo privado: mostra de novo */ }
  }

  function scheduleAd() {
    if (!POPUP || POPUP.active === false || adShown || !adDue(POPUP)) return;
    clearTimeout(adTimer);
    adTimer = setTimeout(function () {
      if (adShown || !POPUP || POPUP.active === false) return;
      if (openStack.length || current !== 'home') return;
      showAd(POPUP);
    }, 1100);
  }

  function showAd(p) {
    adShown = true;
    adMark(p);
    var img = $('#adImg');
    if (p.img) { img.src = p.img; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute('src'); }
    var title = $('#adTitle');
    title.textContent = p.title || '';
    title.hidden = !p.title;
    var text = $('#adText');
    text.textContent = p.text || '';
    text.hidden = !p.text;
    $('#adBtn').textContent = p.btn || 'Ver cardápio';
    openSheet($('#adSheet'));
  }

  function renderPromos() {
    var track = $('#promoTrack');
    var wrap = $('#promoSlider');
    if (!track || !wrap) return;
    var list = (BANNERS || []).filter(function (b) {
      return b && b.active !== false &&
        (b.img || b.tag || b.title || b.off || b.sub || b.btn);
    });
    wrap.hidden = !list.length;
    if (!list.length) { clearInterval(promoTimer); promoIdx = 0; return; }

    track.innerHTML = list.map(function (b) {
      var head = b.tag ? '<span class="promo-tag">' + esc(b.tag) + '</span>' : '';
      var h2 = esc(b.title || '');
      if (b.off) h2 += (h2 ? ' ' : '') + '<span class="promo-off">' + esc(b.off) + '</span>';
      if (b.sub) h2 += '<small>' + esc(b.sub) + '</small>';
      var hasCopy = !!(b.tag || b.title || b.off || b.sub || b.btn);
      var copy = '<div class="promo-copy">' + head + (h2 ? '<h2>' + h2 + '</h2>' : '') +
        (b.btn ? '<button class="promo-btn" type="button">' + esc(b.btn) + ' →</button>' : '') +
        '</div>';

      var goto = b.goto && b.goto !== 'all' ? ' data-cat="' + esc(b.goto) + '"' : '';

      // Com foto: ela ocupa o slide inteiro, no formato da própria imagem.
      if (b.img) {
        var style = 'background-image:url(' + esc(b.img) + ')';
        return '<article class="promo promo-art' + (hasCopy ? ' has-copy' : '') +
          '" data-goto="menu"' + goto + ' style="' + style + '">' +
          (hasCopy ? copy : '') + '</article>';
      }

      return '<article class="promo" data-goto="menu"' + goto + '>' + copy + '</article>';
    }).join('');

    var dots = $('#promoDots');
    dots.hidden = list.length < 2;
    dots.innerHTML = list.map(function (_, i) {
      return '<button type="button" class="promo-dot' + (i === 0 ? ' is-on' : '') +
        '" data-i="' + i + '" aria-label="Banner ' + (i + 1) + '"></button>';
    }).join('');

    promoIdx = 0;
    track.scrollLeft = 0;
    startPromoAutoplay();
  }

  function syncPromoDots() {
    var track = $('#promoTrack');
    if (!track || !track.children.length) return;
    var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    promoIdx = Math.max(0, Math.min(i, track.children.length - 1));
    $$('.promo-dot').forEach(function (d, j) {
      d.classList.toggle('is-on', j === promoIdx);
    });
  }

  function promoGo(i) {
    var track = $('#promoTrack');
    if (!track || !track.children.length) return;
    var n = track.children.length;
    promoIdx = (i + n) % n;
    track.scrollTo({ left: promoIdx * track.clientWidth, behavior: 'smooth' });
    syncPromoDots();
  }

  function startPromoAutoplay() {
    clearInterval(promoTimer);
    var track = $('#promoTrack');
    if (!track || track.children.length < 2) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    promoTimer = setInterval(function () { promoGo(promoIdx + 1); }, 5200);
  }

  /* ---------------- abrir produto ---------------- */

  var sheetProduct = $('#productSheet');
  var currentProduct = null;
  var pState = { size: 'single', extras: [], qty: 1, note: '' };

  /* "que tal levar também?" — atalhos dentro do produto, um toque adiciona */
  var SUG_ORDER = ['bebidas', 'doces', 'kits', 'fatias', 'tortas', 'bolos'];

  function renderPsSuggest(p) {
    var host = $('#psSuggest');
    var block = $('#psSuggestBlock');
    if (!host || !block) return;
    var list = PRODUCTS.filter(function (x) {
      return x.id !== p.id && !soldOut(x);
    }).map(function (x, i) {
      var cat = SUG_ORDER.indexOf(x.cat);
      var pop = STORE.popular.indexOf(x.id);
      return { p: x, cat: cat < 0 ? SUG_ORDER.length : cat, pop: pop < 0 ? 999 + i : pop };
    }).sort(function (a, b) {
      return a.cat - b.cat || a.pop - b.pop;
    }).slice(0, 6).map(function (x) { return x.p; });

    block.hidden = !list.length;
    host.innerHTML = list.map(function (x) {
      return '<button class="ps-sug" type="button" data-add="' + esc(x.id) + '" aria-label="Adicionar ' + esc(x.name) + '">' +
        '<span class="ps-sug-img"><img src="' + esc(x.img) + '" alt=""></span>' +
        '<span class="ps-sug-txt"><b>' + esc(x.name) + '</b><small>' + brl(x.price) + '</small></span>' +
        '<i class="ps-sug-add">+</i>' +
      '</button>';
    }).join('');
  }

  function openProduct(id) {
    var p = product(id);
    if (!p) return;
    if (soldOut(p)) { toast(p.name + ' está esgotado 😕'); return; }
    currentProduct = p;
    var sizeList = Array.isArray(p.sizes)
      ? SIZES.filter(function (s) { return p.sizes.indexOf(s.id) >= 0; })
      : SIZES;
    pState = { size: sizeList.length ? sizeList[0].id : null, extras: [], qty: 1, note: '' };

    $('#psImg').src = p.img;
    $('#psImg').alt = p.name;
    $('#psName').textContent = p.name;
    $('#psRate').textContent = p.rating.toFixed(1);
    $('#psTime').textContent = p.time;
    $('#psKcal').textContent = Number(p.kcal) > 0 ? p.kcal + ' kcal' : '—';
    $('#psDesc').textContent = p.desc;
    $('#psNote').value = '';
    $('#psQty').textContent = '1';
    $('#psFav').textContent = store.favs.indexOf(p.id) >= 0 ? '♥' : '♡';
    $('#psFav').classList.toggle('on', store.favs.indexOf(p.id) >= 0);

    var sizeLabel = $('#psSizesLabel');
    if (sizeLabel) sizeLabel.hidden = !sizeList.length;
    $('#psSizes').hidden = !sizeList.length;
    $('#psSizes').innerHTML = sizeList.map(function (s) {
      return '<button class="opt' + (s.id === pState.size ? ' is-on' : '') + '" type="button" data-size="' + esc(s.id) + '">' +
        '<b>' + esc(s.label) + '</b><small>' + (s.extra ? '+ ' + brl(s.extra) : 'padrão') + '</small></button>';
    }).join('');

    var exList = Array.isArray(p.extras)
      ? EXTRAS.filter(function (x) { return p.extras.indexOf(x.id) >= 0; })
      : EXTRAS;
    var exLabel = $('#psExtrasLabel');
    if (exLabel) exLabel.hidden = !exList.length;
    $('#psExtras').innerHTML = exList.map(function (x) {
      var price = Number(x.price) > 0 ? '+ ' + brl(Number(x.price)) : 'grátis';
      return '<label class="opt-line"><input type="checkbox" value="' + esc(x.id) + '">' +
        '<span class="check"></span><span class="txt">' + esc(x.label) + '</span>' +
        '<span class="price">' + price + '</span></label>';
    }).join('');

    renderPsSuggest(p);
    updateAddBtn();
    openSheet(sheetProduct);
  }

  function extrasTotal() {
    var t = 0;
    pState.extras.forEach(function (id) {
      for (var i = 0; i < EXTRAS.length; i++) if (EXTRAS[i].id === id) t += EXTRAS[i].price;
    });
    return t;
  }

  function sizeExtra() {
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === pState.size) return SIZES[i].extra;
    return 0;
  }

  function unitPrice() {
    return (currentProduct ? currentProduct.price : 0) + sizeExtra() + extrasTotal();
  }

  function updateAddBtn() {
    $('#psAdd').textContent = 'Adicionar · ' + brl(unitPrice() * pState.qty);
  }

  $('#psSizes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-size]');
    if (!b) return;
    pState.size = b.getAttribute('data-size');
    $$('.opt', $('#psSizes')).forEach(function (o) { o.classList.toggle('is-on', o === b); });
    updateAddBtn();
  });

  $('#psExtras').addEventListener('change', function (e) {
    var inp = e.target;
    if (!inp.matches('input[type="checkbox"]')) return;
    var id = inp.value;
    var i = pState.extras.indexOf(id);
    if (inp.checked && i < 0) pState.extras.push(id);
    if (!inp.checked && i >= 0) pState.extras.splice(i, 1);
    updateAddBtn();
  });

  $('#psStepper').addEventListener('click', function (e) {
    var b = e.target.closest('[data-step]');
    if (!b) return;
    pState.qty = Math.max(1, Math.min(20, pState.qty + Number(b.getAttribute('data-step'))));
    $('#psQty').textContent = String(pState.qty);
    updateAddBtn();
  });

  $('#psNote').addEventListener('input', function () {
    pState.note = this.value.trim();
  });

  $('#psFav').addEventListener('click', function () {
    if (!currentProduct) return;
    var i = store.favs.indexOf(currentProduct.id);
    if (i >= 0) { store.favs.splice(i, 1); toast('Removido dos favoritos'); }
    else { store.favs.push(currentProduct.id); toast('Salvo nos favoritos ♥'); }
    save();
    this.textContent = i >= 0 ? '♡' : '♥';
    this.classList.toggle('on', i < 0);
  });

  $('#psAdd').addEventListener('click', function () {
    if (!currentProduct) return;
    var size = null;
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === pState.size) size = SIZES[i];
    var extras = pState.extras.map(function (id) {
      for (var j = 0; j < EXTRAS.length; j++) if (EXTRAS[j].id === id) return EXTRAS[j];
      return null;
    }).filter(Boolean);

    var unit = unitPrice();
    var key = currentProduct.id + '|' + pState.size + '|' + pState.extras.slice().sort().join(',') + '|' + pState.note;
    var existing = null;
    for (var k = 0; k < store.cart.length; k++) if (store.cart[k].key === key) existing = store.cart[k];

    if (existing) {
      existing.qty += pState.qty;
    } else {
      store.cart.push({
        key: key,
        pid: currentProduct.id,
        name: currentProduct.name,
        img: currentProduct.img,
        size: size && size.extra ? size.label : null,
        extras: extras.map(function (x) { return x.label; }),
        note: pState.note,
        unit: unit,
        qty: pState.qty
      });
    }

    save();
    renderBadge();
    closeSheets();
    toast(currentProduct.name + ' adicionado 🛒');
  });

  /* ---------------- carrinho ---------------- */

  function cartCount() {
    return store.cart.reduce(function (n, i) { return n + i.qty; }, 0);
  }

  function subtotal() {
    return store.cart.reduce(function (n, i) { return n + i.unit * i.qty; }, 0);
  }

  function discountValue() {
    if (!store.coupon) return 0;
    return subtotal() * (COUPONS[store.coupon] || 0);
  }

  function feeNow() {
    if (DELIVERY.tooFar) return 0;
    return DELIVERY.fee != null ? DELIVERY.fee : FEE;
  }

  function kmLabel() {
    if (DELIVERY.km == null) return '';
    return String(DELIVERY.km).replace('.', ',') + ' km';
  }

  function feeTag() {
    if (DELIVERY.loading) return 'calculando…';
    if (DELIVERY.tooFar) return 'fora da área';
    if (DELIVERY.source === 'km' && DELIVERY.km != null) return kmLabel();
    if (DELIVERY.source === 'offline') return 'taxa fixa (offline)';
    return 'taxa fixa';
  }

  function totalValue() {
    var t = subtotal() - discountValue();
    if (subtotal() > 0) t += feeNow();
    return Math.max(0, t);
  }

  function geoFee(force) {
    var cep = store.addr.cep;
    if (!cep || DELIVERY_CFG.mode !== 'km') {
      DELIVERY = { cep: cep || '', km: null, fee: null, source: 'fixed',
                   tooFar: false, loading: false };
      return Promise.resolve(DELIVERY);
    }
    if (!force && geoFeeCache[cep]) {
      DELIVERY = geoFeeCache[cep];
      return Promise.resolve(DELIVERY);
    }
    DELIVERY = { cep: cep, km: null, fee: null, source: 'fixed', tooFar: false, loading: true };
    return fetch('api/geo/fee?cep=' + encodeURIComponent(cep), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var st = {
          cep: cep,
          km: d.km != null ? Number(d.km) : null,
          fee: d.fee != null ? Number(d.fee) : null,
          source: d.source || 'fixed',
          tooFar: d.source === 'too_far',
          loading: false
        };
        geoFeeCache[cep] = st;
        DELIVERY = st;
        return st;
      })
      .catch(function () {
        DELIVERY = { cep: cep, km: null, fee: null, source: 'offline',
                     tooFar: false, loading: false };
        return DELIVERY;
      });
  }

  function refreshFeeUI() {
    renderCart();
    if (openStack.indexOf($('#checkoutSheet')) > -1) renderCheckout();
  }

  function renderBadge() {
    var n = cartCount();
    var badge = $('#cartBadge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    $('#cartCountLabel').textContent = n === 1 ? '1 item' : n + ' itens';
  }

  function renderCart() {
    renderBadge();
    var empty = $('#cartEmpty');
    var body = $('#cartBody');

    if (!store.cart.length) {
      empty.hidden = false;
      body.hidden = true;
      return;
    }

    empty.hidden = true;
    body.hidden = false;

    $('#cartList').innerHTML = store.cart.map(function (item, idx) {
      var opts = [];
      if (item.size) opts.push(item.size);
      if (item.extras.length) opts.push(item.extras.join(', '));
      if (item.note) opts.push('“' + item.note + '”');
      return '<article class="cart-item">' +
        '<img src="' + item.img + '" alt="" loading="lazy">' +
        '<div class="ci-body">' +
          '<h4>' + esc(item.name) + '</h4>' +
          (opts.length ? '<p class="ci-opts">' + esc(opts.join(' · ')) + '</p>' : '') +
          '<div class="ci-foot"><b>' + brl(item.unit * item.qty) + '</b>' +
            '<span class="stepper">' +
              '<button type="button" data-cart-step="-1" data-idx="' + idx + '" aria-label="Diminuir">−</button>' +
              '<span>' + item.qty + '</span>' +
              '<button type="button" data-cart-step="1" data-idx="' + idx + '" aria-label="Aumentar">+</button>' +
            '</span>' +
          '</div>' +
        '</div></article>';
    }).join('');

    var sub = subtotal();
    var disc = discountValue();
    $('#sumSub').textContent = brl(sub);
    $('#sumDiscountRow').hidden = disc <= 0;
    $('#sumDiscount').textContent = '−' + brl(disc);
    $('#sumFee').textContent = brl(feeNow()) +
      (feeTag() ? ' · ' + feeTag() : '');
    $('#sumTotal').textContent = brl(totalValue());
  }

  $('#cartList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cart-step]');
    if (!b) return;
    var idx = Number(b.getAttribute('data-idx'));
    var delta = Number(b.getAttribute('data-cart-step'));
    var item = store.cart[idx];
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) store.cart.splice(idx, 1);
    save();
    renderCart();
  });

  $('#clearCartBtn').addEventListener('click', function () {
    if (!store.cart.length) return;
    store.cart = [];
    store.coupon = null;
    $('#couponInput').value = '';
    save();
    renderCart();
    toast('Carrinho esvaziado');
  });

  $('#couponBtn').addEventListener('click', applyCoupon);

  $('#couponInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
  });

  function applyCoupon() {
    var code = $('#couponInput').value.trim().toUpperCase();
    if (!code) { toast('Digite um cupom'); return; }
    if (!COUPONS[code]) { toast('Cupom inválido'); return; }
    if (store.coupon === code) { toast('Cupom já aplicado'); return; }
    store.coupon = code;
    save();
    renderCart();
    toast(code + ' aplicado: ' + Math.round(COUPONS[code] * 100) + '% off 🎉');
  }

  /* ---------------- checkout ---------------- */

  var coOpen = false;

  $('#goCheckout').addEventListener('click', function () {
    if (!store.cart.length) return;
    if (!STORE.open) { toast('A loja está fechada agora 😴'); return; }
    renderCheckout();
    openSheet($('#checkoutSheet'));
    coOpen = true;
  });

  function renderCheckout() {
    $('#coAddrTitle').textContent = store.addr.title;
    $('#coAddrText').textContent = store.addr.text;
    $$('#coSummary .tline').forEach(function (n) { n.remove(); });

    var rows = store.cart.map(function (i) {
      return '<div class="tline"><span>' + i.qty + '× ' + esc(i.name) + '</span><b>' + brl(i.unit * i.qty) + '</b></div>';
    });

    rows.push('<div class="tline"><span>Subtotal</span><b>' + brl(subtotal()) + '</b></div>');
    if (discountValue() > 0) {
      rows.push('<div class="tline"><span>Cupom ' + esc(store.coupon) + '</span><b>−' + brl(discountValue()) + '</b></div>');
    }
    var feeTxt = DELIVERY.tooFar ? '—' : brl(feeNow());
    var tag = feeTag();
    rows.push('<div class="tline' + (DELIVERY.tooFar ? ' fee-too-far' : '') + '">' +
      '<span>Entrega' + (tag ? ' (' + esc(tag) + ')' : '') + '</span><b>' + feeTxt + '</b></div>');
    rows.push('<div class="srow total"><span>Total</span><b>' + brl(totalValue()) + '</b></div>');

    $('#coSummary').insertAdjacentHTML('beforeend', rows.join(''));

    var btn = $('#placeOrder');
    btn.disabled = DELIVERY.tooFar;
    btn.textContent = DELIVERY.tooFar ? 'Fora da área de entrega' : 'Confirmar pedido';
    var note = $('#coFeeNote');
    note.hidden = !DELIVERY.tooFar;
    note.textContent = DELIVERY.tooFar
      ? 'Esse CEP fica fora da área de entrega. Troque o endereço para continuar.'
      : '';

    $$('#payList input[name="pay"]').forEach(function (r) {
      r.checked = r.value === store.pay;
    });
  }

  $('#payList').addEventListener('change', function (e) {
    if (e.target.name === 'pay') store.pay = e.target.value;
  });

  /* ---------------- endereço por CEP ---------------- */

  var addrAfter = null;
  var looked = { district: '', city: '', state: '' };
  var cepSeq = 0;

  function cepDigits() {
    return $('#afCep').value.replace(/\D/g, '').slice(0, 8);
  }

  function setCepStatus(msg, cls) {
    var el = $('#afCepStatus');
    el.textContent = msg || '';
    el.className = 'cep-status' + (cls ? ' ' + cls : '');
  }

  function geoLookup(cep) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 10000);
    return fetch('api/geo/cep/' + encodeURIComponent(cep),
                 { signal: ctrl.signal, cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            var e = new Error(d.error || 'CEP não encontrado');
            e.status = r.status;
            throw e;
          }
          return d;
        });
      })
      .then(function (d) { clearTimeout(timer); return d; },
            function (e) { clearTimeout(timer); throw e; });
  }

  var addrEditingId = null;

  function fillAddrForm(a) {
    $('#afCep').value = a.cep ? a.cep.slice(0, 5) + '-' + a.cep.slice(5) : '';
    $('#afStreet').value = a.street || '';
    $('#afName').value = a.name || customerName();
    $('#afNum').value = a.number || '';
    $('#afComp').value = a.complement || '';
    $('#afPhone').value = a.phone || '';
    looked = { district: a.district || '', city: a.city || '', state: a.state || '' };
    var loc = [looked.district, looked.city, looked.state].filter(Boolean).join(' · ');
    $('#afCity').hidden = !loc;
    $('#afCity').textContent = loc;
    $('#afError').hidden = true;
    setCepStatus('', '');
    $$('.af-tag').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-title') === a.title);
    });
  }

  function savedAddr(id) {
    for (var i = 0; i < store.addresses.length; i++) {
      if (store.addresses[i].id === id) return store.addresses[i];
    }
    return null;
  }

  function renderSavedAddrs() {
    var box = $('#afSavedList');
    var wrap = $('#afSaved');
    var list = store.addresses || [];
    wrap.hidden = list.length === 0;
    $('#afNew').hidden = list.length === 0;
    box.innerHTML = list.map(function (a) {
      var on = store.addr && a.id === store.addr.id;
      return '<div class="af-saved-row' + (on ? ' is-on' : '') + '" data-id="' + esc(a.id) + '">' +
        '<button class="af-saved-main" type="button" data-pick="' + esc(a.id) + '">' +
        '<b>' + esc(a.title || 'Endereço') + (on ? ' ✓' : '') + '</b>' +
        '<small>' + esc(a.text || '') + '</small>' +
        '</button>' +
        '<button class="af-mini" type="button" data-edit="' + esc(a.id) + '" aria-label="Editar endereço">✎</button>' +
        '<button class="af-mini danger" type="button" data-del="' + esc(a.id) + '" aria-label="Excluir endereço">✕</button>' +
        '</div>';
    }).join('');
  }

  function setAddr(a) {
    store.addr = a;
    addrEditingId = a.id || null;
    save();
    DELIVERY = { cep: a.cep || '', km: null, fee: null, source: 'fixed', tooFar: false, loading: !!a.cep };
    $('#locLabel').textContent = a.text ? a.text.split('—')[0].trim() : 'Entregar em';
    $('#profileAddr').textContent = a.text || 'Definir endereço';
    renderSavedAddrs();
    renderGreeting();
    if (current === 'profile') renderProfile();
    if (a.cep) {
      geoFee(true).then(function () {
        refreshFeeUI();
        if (DELIVERY.tooFar) toast('Esse CEP fica fora da área de entrega 😕');
      });
    }
  }

  function openAddressSheet(after) {
    addrAfter = after || null;
    var a = store.addr;
    addrEditingId = a.id || null;
    fillAddrForm(a);
    renderSavedAddrs();
    openSheet($('#addrSheet'));
    setTimeout(function () { $('#afCep').focus(); }, 80);
  }

  $('#afSavedList').addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]');
    var edit = e.target.closest('[data-edit]');
    var del = e.target.closest('[data-del]');

    if (pick) {
      var a = savedAddr(pick.getAttribute('data-pick'));
      if (!a) return;
      setAddr(a);
      toast('Entrega em ' + (a.title || 'endereço'));
      leaveAddressSheet();
      return;
    }

    if (edit) {
      var b = savedAddr(edit.getAttribute('data-edit'));
      if (!b) return;
      addrEditingId = b.id;
      fillAddrForm(b);
      renderSavedAddrs();
      $('#afStreet').focus();
      return;
    }

    if (del) {
      var id = del.getAttribute('data-del');
      store.addresses = store.addresses.filter(function (x) { return x.id !== id; });
      if (store.addr && store.addr.id === id) {
        var next = store.addresses[0];
        if (!next) {
          next = migrarEndereco({});
          next.id = newAddrId();
          store.addresses = [next];
        }
        setAddr(next);
        fillAddrForm(next);
      } else {
        renderSavedAddrs();
      }
      save();
      toast('Endereço removido');
    }
  });

  $('#afNew').addEventListener('click', function () {
    addrEditingId = null;
    fillAddrForm({ title: 'Casa', text: '' });
    renderSavedAddrs();
    $('#afCep').focus();
  });

  function leaveAddressSheet() {
    closeSheets();
    var cb = addrAfter;
    addrAfter = null;
    if (cb) cb();
  }

  function buscarCep() {
    var cep = cepDigits();
    if (cep.length !== 8) {
      setCepStatus('Digite os 8 números do CEP', 'err');
      return;
    }
    var seq = ++cepSeq;
    setCepStatus('Buscando endereço…', '');
    $('#afCepBtn').disabled = true;
    geoLookup(cep).then(function (d) {
      if (seq !== cepSeq) return;
      var a = d.addr || {};
      $('#afStreet').value = a.street || '';
      looked = { district: a.district || '', city: a.city || '', state: a.state || '' };
      var loc = [looked.district, looked.city, looked.state].filter(Boolean).join(' · ');
      $('#afCity').hidden = !loc;
      $('#afCity').textContent = loc;
      setCepStatus(a.street ? 'Endereço encontrado. Informe o número.'
                            : 'CEP encontrado — complete a rua.', 'ok');
      if (!cepDigits()) return;
      $('#afNum').focus();
    }).catch(function (e) {
      if (seq !== cepSeq) return;
      setCepStatus(e.status === 404
        ? 'CEP não encontrado — confira os números.'
        : 'Não consegui buscar agora. Digite a rua e o número.', 'err');
    }).then(function () {
      $('#afCepBtn').disabled = false;
    });
  }

  $('#afCep').addEventListener('input', function () {
    var d = cepDigits();
    this.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
    if (d.length === 8) buscarCep();
  });

  $('#afCepBtn').addEventListener('click', buscarCep);

  $$('.af-tag').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.af-tag').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    });
  });

  $('#addrClose').addEventListener('click', leaveAddressSheet);

  $('#afSave').addEventListener('click', function () {
    var cep = cepDigits();
    var street = $('#afStreet').value.trim();
    var number = $('#afNum').value.trim();
    var name = $('#afName').value.trim();
    var err = $('#afError');

    function fail(msg) {
      err.hidden = false;
      err.textContent = msg;
    }
    if (cep.length !== 8) return fail('Informe o CEP (8 números).');
    if (!street) return fail('Informe a rua — se a busca não preencheu, digite aqui.');
    if (!number) return fail('Informe o número da casa.');
    if (!name) return fail('Informe o nome de quem vai receber.');

    err.hidden = true;
    var tag = $('.af-tag.is-on');
    var a = {
      id: addrEditingId || '',
      title: tag ? tag.getAttribute('data-title') : (store.addr.title || 'Casa'),
      name: name, cep: cep, street: street,
      district: looked.district, city: looked.city, state: looked.state,
      number: number, complement: $('#afComp').value.trim(),
      phone: $('#afPhone').value.replace(/\D/g, '').slice(0, 13),
      text: ''
    };
    a.text = enderecoTexto(a);

    /* mesmo endereço já salvo? atualiza em vez de duplicar */
    if (!a.id) {
      for (var k = 0; k < store.addresses.length; k++) {
        var s = store.addresses[k];
        if (s.cep === a.cep && s.number === a.number && s.complement === a.complement) {
          a.id = s.id;
          break;
        }
      }
    }
    if (!a.id) a.id = newAddrId();

    var it = -1;
    for (var j = 0; j < store.addresses.length; j++) {
      if (store.addresses[j].id === a.id) it = j;
    }
    if (it >= 0) store.addresses[it] = a;
    else store.addresses.push(a);
    if (store.addresses.length > 8) store.addresses = store.addresses.slice(-8);

    setAddr(a);
    addrEditingId = a.id;
    if (!store.customer) { store.customer = a.name; save(); }

    leaveAddressSheet();
    toast(it >= 0 ? 'Endereço atualizado' : 'Endereço salvo');
  });

  $('#addrCard').addEventListener('click', function () {
    openAddressSheet(function () {
      renderCheckout();
      openSheet($('#checkoutSheet'));
    });
  });

  var placing = false;

  function sendOrder(payload) {
    return fetch('api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.error || 'Não foi possível enviar o pedido');
          e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  $('#placeOrder').addEventListener('click', function () {
    if (!store.cart.length || placing) return;
    if (!STORE.open) { toast('A loja está fechada agora 😴'); return; }
    if (!store.addr.cep) {
      openAddressSheet(function () { renderCheckout(); openSheet($('#checkoutSheet')); });
      toast('Informe o CEP para calcular a entrega');
      return;
    }
    if (DELIVERY.tooFar) { toast('Seu CEP fica fora da área de entrega 😕'); return; }

    placing = true;
    var btn = this;
    btn.textContent = 'Enviando…';
    btn.style.opacity = '.7';
    var prevNote = $('#coFeeNote');
    prevNote.hidden = true;
    prevNote.textContent = '';

    var payload = {
      pay: store.pay,
      name: store.addr.name || '',
      phone: store.addr.phone || '',
      cep: store.addr.cep || '',
      addr: store.addr.text,
      items: store.cart.map(function (i) {
        return { pid: i.pid, qty: i.qty, unit: i.unit, size: i.size, extras: i.extras, note: i.note };
      })
    };

    function restore() {
      placing = false;
      btn.textContent = 'Confirmar pedido';
      btn.style.opacity = '';
    }

    function fail(msg) {
      restore();
      var note = $('#coFeeNote');
      note.hidden = false;
      note.textContent = msg;
      toast(msg);
    }

    function finish(server) {
      var so = server && server.order;
      if (!so) {
        /* sem confirmação do servidor não existe pedido: nada de "confirmado" falso */
        fail('Não conseguimos confirmar o seu pedido. Tente de novo em instantes.');
        return;
      }
      var order = {
        num: String(so.num),
        items: store.cart.slice(),
        subtotal: so.subtotal,
        fee: so.fee,
        total: so.total,
        pay: so.pay,
        name: so.name,
        phone: so.phone,
        addr: so.addr,
        time: so.time,
        createdAt: so.createdAt,
        status: so.status || 1,
        token: so.token || ''
      };
      store.orders.unshift(order);
      store.cart = [];
      store.coupon = null;
      $('#couponInput').value = '';
      save();
      renderBadge();
      renderCart();
      restore();

      closeSheets();
      $('#successNum').textContent = '#' + order.num;
      openSheet($('#successSheet'));
      $('#successTrack').onclick = function () {
        closeSheets();
        showTrack(order.num);
      };
      startOrderPoll(order.num);
      refreshMenu();
    }

    sendOrder(payload).then(finish).catch(function (err) {
      if (err && err.status) {
        fail(err.message || 'Não foi possível enviar o pedido');
      } else {
        fail('Sem conexão com a loja — o pedido não foi enviado. Confira a internet e tente de novo.');
      }
      refreshMenu();
    });
  });

  /* ---------------- rastreio ---------------- */

  var trackTimers = [];

  function clearTrackTimers() {
    trackTimers.forEach(clearTimeout);
    trackTimers = [];
    if (tmapAnim) {
      cancelAnimationFrame(tmapAnim);
      tmapAnim = null;
    }
  }

  function showTrack(num) {
    clearTrackTimers();
    var order = null;
    for (var i = 0; i < store.orders.length; i++) if (store.orders[i].num === num) order = store.orders[i];
    if (!order) return;

    if (tmapNum !== num) resetTrackMapLayers();
    tmapNum = num;

    go('track');

    $('#trackNum').textContent = '#' + order.num;
    $('#trackTotal').textContent = brl(order.total);
    $('#tlTime').textContent = order.time;
    $('#trackItems').innerHTML = order.items.map(function (i) {
      return '<div class="tline"><span>' + i.qty + '× ' + esc(i.name) + '</span><b>' + brl(i.unit * i.qty) + '</b></div>';
    }).join('') + '<div class="tline"><span>Entrega</span><b>' + esc(order.addr) + '</b></div>';

    setStatus(order.status || 1);

    $('#receiptBtn').onclick = function () { openReceipt(order); };

    $('#repeatOrderBtn').onclick = function () {
      order.items.forEach(function (old) {
        var p = product(old.pid);
        if (!p) return;
        var key = old.key + '|reorder';
        var found = null;
        for (var k = 0; k < store.cart.length; k++) if (store.cart[k].key === key) found = store.cart[k];
        if (found) found.qty += old.qty;
        else store.cart.push({
          key: key, pid: old.pid, name: old.name, img: old.img,
          size: old.size, extras: old.extras.slice(), note: old.note,
          unit: old.unit, qty: old.qty
        });
      });
      save();
      renderBadge();
      go('cart');
      toast('Itens adicionados ao carrinho');
    };
  }

  /* ---------------- recibo ---------------- */

  var PAY_TEXT = { pix: 'Pix', card: 'Cartão na entrega', cash: 'Dinheiro' };

  function receiptHTML(order) {
    var when = '';
    if (order.createdAt) {
      var d = new Date(order.createdAt * 1000);
      when = d.toLocaleDateString('pt-BR') + ' às ' +
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else if (order.time) {
      when = order.time;
    }

    var rows = order.items.map(function (i) {
      var sub = [i.size].concat(i.extras || []).filter(Boolean).join(' · ');
      return '<tr><td>' + i.qty + '× ' + esc(i.name) +
        (sub ? '<br><small>' + esc(sub) + '</small>' : '') +
        (i.note ? '<br><small>obs.: ' + esc(i.note) + '</small>' : '') +
        '</td><td class="r">' + brl(i.unit * i.qty) + '</td></tr>';
    }).join('');

    var fee = Number(order.fee) || 0;
    var sub = order.subtotal != null ? Number(order.subtotal) : null;

    return '<div class="rc">' +
      '<div class="rc-brand">' + esc(STORE.name || 'Delícias do Aleff') + '</div>' +
      (STORE.tagline ? '<div class="rc-tag">' + esc(STORE.tagline) + '</div>' : '') +
      '<hr>' +
      '<div class="rc-line"><span>Pedido</span><b>#' + esc(order.num) + '</b></div>' +
      (when ? '<div class="rc-line"><span>Data</span><b>' + esc(when) + '</b></div>' : '') +
      (order.name ? '<div class="rc-line"><span>Cliente</span><b>' + esc(order.name) + '</b></div>' : '') +
      (order.phone ? '<div class="rc-line"><span>WhatsApp</span><b>' + esc(order.phone) + '</b></div>' : '') +
      '<div class="rc-addr">' + esc(order.addr || '') + '</div>' +
      '<hr>' +
      '<table class="rc-items">' + rows + '</table>' +
      '<hr>' +
      (sub != null ? '<div class="rc-line"><span>Subtotal</span><b>' + brl(sub) + '</b></div>' : '') +
      (fee > 0 ? '<div class="rc-line"><span>Entrega</span><b>' + brl(fee) + '</b></div>' : '') +
      '<div class="rc-line rc-total"><span>Total</span><b>' + brl(order.total) + '</b></div>' +
      '<div class="rc-line"><span>Pagamento</span><b>' + esc(PAY_TEXT[order.pay] || order.pay || '—') + '</b></div>' +
      '<p class="rc-thanks">Obrigado pela preferência! 🍔</p>' +
      '</div>';
  }

  function openReceipt(order) {
    $('#rcBody').innerHTML = receiptHTML(order);
    openSheet($('#receiptSheet'));
  }

  function printReceipt() {
    var w = window.open('', '_blank');
    if (!w) { toast('Não foi possível abrir. Libere pop-ups.'); return; }
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Recibo</title><style>' +
      'body{margin:0;padding:24px;font:14px/1.5 Georgia,serif;color:#2B2118;max-width:420px}' +
      'hr{border:0;border-top:1px dashed #c9b49d;margin:12px 0}' +
      '.rc-brand{font-size:22px;font-weight:700}' +
      '.rc-tag{font-size:12px;color:#7a6a5a;margin-top:2px}' +
      '.rc-line{display:flex;justify-content:space-between;gap:10px;margin:5px 0}' +
      '.rc-line span{color:#7a6a5a}.rc-addr{font-size:12px;color:#7a6a5a;margin:6px 0}' +
      '.rc-items{width:100%;border-collapse:collapse}' +
      '.rc-items td{padding:6px 0;vertical-align:top}.rc-items td.r{text-align:right;white-space:nowrap}' +
      '.rc-items small{color:#7a6a5a;font-size:11px}' +
      '.rc-total b{font-size:17px}.rc-thanks{text-align:center;margin:16px 0 4px;color:#7a6a5a;font-size:12px}' +
      '@media print{body{padding:0}}' +
      '</style></head><body>' + $('#rcBody').innerHTML + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* usuário fecha */ } }, 400);
  }

  $('#rcClose').addEventListener('click', function () { closeSheets(); });
  $('#rcPrint').addEventListener('click', printReceipt);

  var STATUS_TEXT = ['', 'Pedido recebido', 'No forno 🎂', 'A caminho 🛵', 'Entregue ✓'];

  function setStatus(step) {
    var items = $$('#timeline li');
    items.forEach(function (li, idx) {
      li.classList.toggle('done', idx + 1 < step);
      li.classList.toggle('active', idx + 1 === step);
    });
    $('#trackStatus').textContent = STATUS_TEXT[step] || 'Pedido recebido';
    if (step === 4) {
      $('#trackEta').textContent = 'Entregue — bom apetite!';
      $$('.track-pulse span')[0].style.background = 'var(--green)';
    }
    syncTrackView();
  }

  /* ---------------- mapa ao vivo do motoboy ---------------- */

  var tmap = null;                  /* instância Leaflet */
  var tmapLayers = {};
  var tmapTimer = null;
  var tmapNum = null;
  var tmapFitted = false;
  var tmapAnim = null;
  var tmapLast = null;              /* última posição animada [lat,lon] */
  var TMAP_MS = 7000;

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

  function mapNote(msg) {
    var n = $('#trackMapNote');
    if (!n) return;
    n.hidden = !msg;
    n.textContent = msg || '';
  }

  function ensureTrackMap() {
    if (tmap) return tmap;
    if (typeof L === 'undefined') return null;
    var box = $('#trackMap');
    if (!box) return null;
    tmap = L.map(box, { zoomControl: false });
    tmap.setView([-8.05, -34.88], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(tmap);
    return tmap;
  }

  function resetTrackMapLayers() {
    if (tmap) {
      Object.keys(tmapLayers).forEach(function (k) {
        if (tmapLayers[k]) tmap.removeLayer(tmapLayers[k]);
      });
    }
    tmapLayers = {};
    tmapLast = null;
    tmapFitted = false;
    mapNote('');
  }

  function stopTrackMap() {
    if (tmapTimer) { clearInterval(tmapTimer); tmapTimer = null; }
    if (tmapAnim) { cancelAnimationFrame(tmapAnim); tmapAnim = null; }
    tmapNum = null;
  }

  function syncTrackView() {
    var order = tmapNum ? orderByNum(tmapNum) : null;
    var step = order ? (Number(order.status) || 1) : 1;
    var onTick = current === 'track' && !document.hidden;

    if (step < 3 || step >= 4) {
      if (tmapTimer) { clearInterval(tmapTimer); tmapTimer = null; }
      $('#trackMapWrap').hidden = true;
      $('#trackMapHint').hidden = step >= 4;
      if (step < 3) $('#trackMapHint').textContent = 'O mapa ao vivo aparece quando o pedido sair para entrega.';
      return;
    }
    if (!onTick) {
      if (tmapTimer) { clearInterval(tmapTimer); tmapTimer = null; }
      return;
    }

    $('#trackMapHint').hidden = true;
    $('#trackMapWrap').hidden = false;
    if (typeof L === 'undefined') {
      $('#trackMapWrap').hidden = true;
      $('#trackMapHint').hidden = false;
      $('#trackMapHint').textContent = 'Mapa indisponível neste aparelho.';
      return;
    }
    if (!ensureTrackMap()) return;
    setTimeout(function () { if (tmap) tmap.invalidateSize(); }, 60);
    trackMapTick();
    if (!tmapTimer) tmapTimer = setInterval(trackMapTick, TMAP_MS);
  }

  function trackMapTick() {
    var order = tmapNum ? orderByNum(tmapNum) : null;
    if (!order || !order.token) { stopTrackMap(); return; }
    if (current !== 'track' || document.hidden || (Number(order.status) || 1) !== 3) return;
    fetch('api/order/' + encodeURIComponent(order.num) + '/track?t=' + encodeURIComponent(order.token),
      { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) renderTrackData(d); })
      .catch(function () { mapNote('Sem conexão — o mapa tenta de novo em instantes.'); });
  }

  function animateTo(marker, target) {
    var from = tmapLast || target;
    tmapLast = target;
    if (tmapAnim) { cancelAnimationFrame(tmapAnim); tmapAnim = null; }
    if (from[0] === target[0] && from[1] === target[1]) return;
    var t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1200);
      var ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      marker.setLatLng([from[0] + (target[0] - from[0]) * ease,
                        from[1] + (target[1] - from[1]) * ease]);
      tmapAnim = p < 1 ? requestAnimationFrame(step) : null;
    }
    tmapAnim = requestAnimationFrame(step);
  }

  function fmtAge(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' s';
    return Math.round(sec / 60) + ' min';
  }

  function renderTrackData(d) {
    var map = ensureTrackMap();
    if (!map || d.status !== 3) return;

    var origin = d.origin, dest = d.dest, route = d.route;
    var coords = route && route.coords && route.coords.length > 1 ? route.coords : null;

    if (origin) {
      if (!tmapLayers.origin) tmapLayers.origin = L.circleMarker([origin.lat, origin.lon], {
        radius: 6, color: '#2b2118', weight: 2, fillColor: '#2b2118', fillOpacity: 1
      }).addTo(map).bindPopup('Loja');
      else tmapLayers.origin.setLatLng([origin.lat, origin.lon]);
    }
    if (dest) {
      if (!tmapLayers.dest) tmapLayers.dest = L.circleMarker([dest.lat, dest.lon], {
        radius: 8, color: '#1f9d55', weight: 3, fillColor: '#1f9d55', fillOpacity: 1
      }).addTo(map).bindPopup('Seu endereço');
      else tmapLayers.dest.setLatLng([dest.lat, dest.lon]);
    }

    if (coords) {
      var idx = Math.max(0, Math.min(Number(route.idx) || 0, coords.length - 1));
      if (tmapLayers.fallback) { map.removeLayer(tmapLayers.fallback); tmapLayers.fallback = null; }
      if (!tmapLayers.done) {
        tmapLayers.done = L.polyline([], { color: '#9a8f86', weight: 5, opacity: 0.95 }).addTo(map);
        tmapLayers.left = L.polyline([], { color: '#e8622c', weight: 5, opacity: 0.95 }).addTo(map);
      }
      tmapLayers.done.setLatLngs(coords.slice(0, idx + 1));
      tmapLayers.left.setLatLngs(coords.slice(idx));
    } else if (origin && dest) {
      if (tmapLayers.done) { map.removeLayer(tmapLayers.done); tmapLayers.done = null; }
      if (tmapLayers.left) { map.removeLayer(tmapLayers.left); tmapLayers.left = null; }
      if (!tmapLayers.fallback) tmapLayers.fallback = L.polyline(
        [[origin.lat, origin.lon], [dest.lat, dest.lon]],
        { color: '#e8622c', weight: 4, dashArray: '8 8', opacity: 0.8 }
      ).addTo(map);
      mapNote('Rota aproximada: linha reta entre a loja e você.');
    } else {
      mapNote('Calculando a rota…');
    }

    if (!tmapFitted) {
      var pts = coords ? coords.slice() : [];
      if (!pts.length) {
        if (origin) pts.push([origin.lat, origin.lon]);
        if (dest) pts.push([dest.lat, dest.lon]);
      }
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: false });
        tmapFitted = true;
      }
    }

    var c = d.courier;
    if (c && c.lat != null && c.lon != null) {
      var target = [c.lat, c.lon];
      if (!tmapLayers.courier) {
        tmapLayers.courier = L.marker(target, {
          icon: L.divIcon({ className: 'tl-scooter', html: '<span>' + RIDER_SVG + '</span>',
                            iconSize: [44, 44], iconAnchor: [22, 22] }),
          zIndexOffset: 600
        }).addTo(map);
        tmapLast = target;
      } else {
        animateTo(tmapLayers.courier, target);
      }
      var age = (Number(d.serverNow) || 0) - (Number(c.updatedAt) || 0);
      mapNote(c.stale ? 'Sem sinal do motoboy há ' + fmtAge(age) + '.' : '');
    } else if (coords) {
      mapNote('O motoboy ainda não começou a compartilhar a posição.');
    }
  }

  /* ---------------- status real do pedido (aviso "saiu para entrega") ---------------- */

  var orderPolls = {};
  var alertTimer = null;
  var alertNum = null;

  function orderByNum(num) {
    for (var k = 0; k < store.orders.length; k++) {
      if (store.orders[k].num === num) return store.orders[k];
    }
    return null;
  }

  function stopOrderPoll(num) {
    if (orderPolls[num]) {
      clearInterval(orderPolls[num]);
      delete orderPolls[num];
    }
  }

  function chirp() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ac = new AC();
      [0, 0.22].forEach(function (t, i) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = i ? 1180 : 880;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
        o.connect(g);
        g.connect(ac.destination);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + 0.2);
      });
      setTimeout(function () { ac.close && ac.close(); }, 900);
    } catch (e) { /* sem áudio: só vibra */ }
  }

  function announceStatus(num, st) {
    if (st === 2) {
      toast('Seu pedido está no forno 🎂');
      return;
    }
    if (st === 4) {
      toast('Pedido entregue. Bom apetite! ✓');
      return;
    }
    if (st !== 3) return;

    if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
    chirp();

    var box = $('#orderAlert');
    alertNum = num;
    $('#oaTitle').textContent = 'Saiu para entrega!';
    $('#oaBody').textContent = 'Seu pedido #' + num + ' está a caminho 🛵';
    box.hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { box.hidden = true; }, 12000);
  }

  $('#oaBtn').addEventListener('click', function () {
    $('#orderAlert').hidden = true;
    if (alertNum) showTrack(alertNum);
  });

  function startOrderPoll(num) {
    stopOrderPoll(num);
    var order = orderByNum(num);
    if (!order || !order.token) return;   /* pedido feito offline: sem acompanhamento */

    function tick() {
      var o = orderByNum(num);
      if (!o) { stopOrderPoll(num); return; }
      if ((Number(o.status) || 1) >= 4) { stopOrderPoll(num); return; }
      fetch('api/order/' + encodeURIComponent(num) + '?t=' + encodeURIComponent(o.token), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.order) return;
          var st = Math.min(4, Math.max(1, Number(d.order.status) || 1));
          var prev = Number(o.status) || 1;
          if (st <= prev) return;
          o.status = st;
          save();
          if (current === 'track' && $('#trackNum').textContent === '#' + num) setStatus(st);
          announceStatus(num, st);
          if (st >= 4) stopOrderPoll(num);
        })
        .catch(function () { /* app offline: tenta de novo no próximo ciclo */ });
    }

    tick();
    orderPolls[num] = setInterval(tick, 20000);
  }

  function resumeOrderPolls() {
    store.orders.forEach(function (o) {
      if (o && o.token && (Number(o.status) || 1) < 4) startOrderPoll(o.num);
    });
  }

  /* ---------------- menu ---------------- */

  function renderMenu() {
    var list = listFor(activeCat);
    $('#menuList').innerHTML = list.length
      ? list.map(function (p) { return cardHTML(p, false); }).join('')
      : '<div class="search-empty">Nada por aqui nessa categoria.</div>';
  }

  /* ---------------- perfil ---------------- */

  function renderProfile() {
    var nome = customerName();
    $('#profileName').textContent = nome || 'Seu perfil';
    $('#profileAvatar').textContent = nome ? nome.charAt(0).toUpperCase() : '?';
    $('#profileAddr').textContent = store.addr.text;
    $('#statOrders').textContent = String(store.orders.length);
    $('#statFavs').textContent = String(store.favs.length);

    var favs = store.favs.map(product).filter(Boolean);
    $('#favList').innerHTML = favs.length
      ? favs.map(function (p) { return cardHTML(p, false); }).join('')
      : '<p class="search-empty">Toque no ♡ de um bolo para salvar aqui.</p>';

    var hist = store.orders.slice(0, 5);
    $('#historyList').innerHTML = hist.length
      ? hist.map(function (o) {
          var first = o.items[0] ? o.items[0].name : 'Pedido';
          return '<button class="card" type="button" data-order="' + esc(o.num) + '" style="text-align:left;width:100%">' +
            '<span class="card-thumb" style="display:grid;place-items:center;font-size:22px;background:var(--accent-soft)">🧾</span>' +
            '<span class="card-body"><h4>#' + esc(o.num) + ' · ' + esc(first) + '</h4>' +
            '<p>' + esc(o.addr) + '</p>' +
            '<span class="card-foot"><b>' + brl(o.total) + '</b><span class="meta">' + esc(o.time) + '</span></span></span>' +
            '<span class="chev">›</span></button>';
        }).join('')
      : '<p class="search-empty">Nenhum pedido ainda. O forno está esperando.</p>';
  }

  $('#historyList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-order]');
    if (b) showTrack(b.getAttribute('data-order'));
  });

  $('#editProfileBtn').addEventListener('click', function () {
    openAddressSheet(function () { renderProfile(); });
  });

  $('#notifToggle').addEventListener('change', function () {
    store.notif = this.checked;
    save();
    toast(this.checked ? 'Notificações ligadas' : 'Notificações desligadas');
  });

  /* ---------------- busca ---------------- */

  var searchSheet = $('#searchSheet');
  var searchInput = $('#searchInput');
  var SUGGEST = ['Chocolate', 'Morango', 'Cenoura', 'Red velvet', 'Fatia', 'Torta'];

  function renderSuggest() {
    $('#searchSuggest').innerHTML = SUGGEST.map(function (s) {
      return '<button class="chip" type="button" data-suggest="' + s + '">' + s + '</button>';
    }).join('');
  }

  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) {
      $('#searchResults').innerHTML = '';
      return;
    }
    var res = PRODUCTS.filter(function (p) {
      return (p.name + ' ' + p.desc + ' ' + p.cat).toLowerCase().indexOf(q) >= 0;
    });
    $('#searchResults').innerHTML = res.length
      ? res.map(function (p) { return cardHTML(p, false); }).join('')
      : '<div class="search-empty">Nada encontrado para “' + esc(q) + '”.<br>Tente “chocolate” ou “morango”.</div>';
  }

  $('#searchSuggest').addEventListener('click', function (e) {
    var b = e.target.closest('[data-suggest]');
    if (!b) return;
    searchInput.value = b.getAttribute('data-suggest');
    runSearch(searchInput.value);
  });

  searchInput.addEventListener('input', function () { runSearch(this.value); });

  $('#searchBtn').addEventListener('click', openSearch);
  $('#menuSearchBtn').addEventListener('click', openSearch);

  function openSearch() {
    renderSuggest();
    searchInput.value = '';
    $('#searchResults').innerHTML = '';
    openSheet(searchSheet);
    setTimeout(function () { searchInput.focus(); }, 260);
  }

  /* ---------------- cards de produto ---------------- */

  doc.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) {
      e.stopPropagation();
      quickAdd(add.getAttribute('data-add'));
      var sug = add.closest('.ps-sug');
      if (sug) {
        sug.classList.add('is-added');
        setTimeout(function () { sug.classList.remove('is-added'); }, 900);
      }
      return;
    }
    var card = e.target.closest('[data-pid]');
    if (card) openProduct(card.getAttribute('data-pid'));
  });

  function quickAdd(id) {
    var p = product(id);
    if (!p) return;
    if (soldOut(p)) { toast(p.name + ' está esgotado 😕'); return; }
    var key = p.id + '|single||';
    var found = null;
    for (var k = 0; k < store.cart.length; k++) if (store.cart[k].key === key) found = store.cart[k];
    if (found) found.qty += 1;
    else store.cart.push({
      key: key, pid: p.id, name: p.name, img: p.img,
      size: null, extras: [], note: '', unit: p.price, qty: 1
    });
    save();
    renderBadge();
    if (current === 'cart') renderCart();
    buzz();
    toast(p.name + ' no carrinho 🛒');
  }

  /* ---------------- sheets: abrir/fechar ---------------- */

  var scrim = $('#scrim');
  var openStack = [];
  var gateOpen = false;   /* pop-up de boas-vindas bloqueando o app */

  function openSheet(el) {
    closeSheets(true);
    el.hidden = false;
    scrim.hidden = false;
    openStack.push(el);
    doc.body.style.overflow = 'hidden';
    el.setAttribute('data-open', '1');
  }

  function closeSheets(keepScrim) {
    keepScrim = keepScrim === true;   /* ouvinte de clique passa o evento aqui */
    if (gateOpen) return;
    openStack.forEach(function (el) {
      el.hidden = true;
      el.removeAttribute('data-open');
    });
    openStack = [];
    if (!keepScrim) {
      scrim.hidden = true;
      doc.body.style.overflow = '';
    }
  }

  scrim.addEventListener('click', function () { if (!gateOpen) closeSheets(); });

  $('#psClose').addEventListener('click', function () { closeSheets(); });
  $('#searchClose').addEventListener('click', function () { closeSheets(); });
  $('#coClose').addEventListener('click', function () { closeSheets(); });
  $('#adClose').addEventListener('click', function () { closeSheets(); });
  $('#adDismiss').addEventListener('click', function () { closeSheets(); });

  $('#adBtn').addEventListener('click', function () {
    var goto = POPUP && POPUP.goto ? POPUP.goto : 'all';
    closeSheets();
    if (goto.indexOf('p:') === 0) { openProduct(goto.slice(2)); return; }
    if (goto !== 'all') {
      activeCat = goto;
      renderChips();
      renderPopular();
      renderMenu();
    }
    go('menu');
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openStack.length) {
      if (gateOpen || openStack[0] === $('#checkoutSheet')) return;
      closeSheets();
    }
  });

  /* ---------------- boas-vindas (nome antes de entrar) ---------------- */

  function openWelcome(isGate) {
    gateOpen = !!isGate;
    var lg = $('#welcomeLogo');
    if (STORE.logo) { lg.src = STORE.logo; lg.hidden = false; }
    else lg.hidden = true;
    $('#welcomeName').value = customerName();
    $('#welcomeErr').hidden = true;
    $('#welcomeBtn').textContent = isGate ? 'Entrar' : 'Salvar nome';
    $('#welcomeSheet .welcome-thanks').hidden = !isGate;
    openSheet($('#welcomeSheet'));
    setTimeout(function () { $('#welcomeName').focus(); }, 350);
  }

  function saveWelcome() {
    var name = $('#welcomeName').value.trim().replace(/\s+/g, ' ');
    if (!name) {
      $('#welcomeErr').hidden = false;
      $('#welcomeName').focus();
      return;
    }
    var wasGate = gateOpen;
    var antes = customerName();
    store.customer = name;
    /* mantém o nome da entrega em dia, a menos que tenha sido personalizado */
    if (store.addr && (!store.addr.name || store.addr.name === antes)) store.addr.name = name;
    save();
    gateOpen = false;
    closeSheets();
    renderGreeting();
    if (current === 'profile') renderProfile();
    scheduleAd();
    toast(wasGate ? 'Bem-vindo(a), ' + firstName() + '! 🍰' : 'Nome atualizado ✔');
  }

  $('#welcomeBtn').addEventListener('click', saveWelcome);
  $('#welcomeName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveWelcome(); }
  });
  $('#editNameBtn').addEventListener('click', function () { openWelcome(false); });

  $('#locBtn').addEventListener('click', function () {
    openAddressSheet(function () {
      $('#locLabel').textContent = store.addr.text.split('—')[0].trim();
    });
  });

  $('#bellBtn').addEventListener('click', function () {
    toast(store.notif ? 'Você está por dentro: promoções e status do pedido 🔔' : 'Ative as notificações no Perfil');
  });

  $('#promoSlider').addEventListener('click', function (e) {
    var dot = e.target.closest('.promo-dot');
    if (dot) {
      promoGo(Number(dot.getAttribute('data-i')) || 0);
      startPromoAutoplay();
    }
  });

  var promoTrack = $('#promoTrack');
  var promoScrollT = null;
  var promoRestartT = null;
  promoTrack.addEventListener('scroll', function () {
    clearTimeout(promoScrollT);
    promoScrollT = setTimeout(syncPromoDots, 90);
  }, { passive: true });

  /* arrastar com o dedo pausa a troca automática por alguns segundos */
  $('#promoSlider').addEventListener('pointerdown', function () {
    clearInterval(promoTimer);
    clearTimeout(promoRestartT);
  });
  $('#promoSlider').addEventListener('pointerup', function () {
    clearTimeout(promoRestartT);
    promoRestartT = setTimeout(startPromoAutoplay, 9000);
  });
  window.addEventListener('resize', function () { syncPromoDots(); });

  /* ---------------- PWA: service worker + instalar ---------------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  var installEvt = null;
  var installBtn = $('#installBtn');

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', function () {
    if (!installEvt) { toast('Use o menu do navegador → “Adicionar à tela inicial”'); return; }
    installEvt.prompt();
    installEvt.userChoice.then(function (r) {
      if (r.outcome === 'accepted') toast('Aplicativo instalado 🎉');
      installEvt = null;
      installBtn.hidden = true;
    });
  });

  window.addEventListener('appinstalled', function () {
    installBtn.hidden = true;
    toast('Instalado! Abra pelo ícone na tela inicial');
  });

  /* ---------------- cardápio e loja vindos do painel ---------------- */

  function applyMenu(d) {
    if (d.store) {
      var s = d.store;
      if (s.name) STORE.name = s.name;
      STORE.logo = s.logo || '';
      STORE.open = s.open !== false;
      if (s.hours) STORE.hours = s.hours;
      if (s.whatsapp) STORE.whatsapp = s.whatsapp;
      if (s.fee != null) FEE = Number(s.fee) || 0;
      if (s.minOrder != null) STORE.minOrder = Number(s.minOrder) || 0;
      if (s.coupons && typeof s.coupons === 'object') COUPONS = s.coupons;
      if (s.delivery && typeof s.delivery === 'object') DELIVERY_CFG = s.delivery;
      if (Array.isArray(s.banners)) {
        var sig = JSON.stringify(s.banners);
        if (sig !== bannersSig) { bannersSig = sig; BANNERS = s.banners; renderPromos(); }
      }
      if (s.popup && typeof s.popup === 'object') {
        var psig = JSON.stringify(s.popup);
        if (psig !== popupSig) {
          popupSig = psig;
          POPUP = s.popup;
          adShown = false;
          scheduleAd();
        }
      }
      if (Array.isArray(s.extras)) EXTRAS = s.extras;
      if (Array.isArray(s.categories) && s.categories.length) setCats(s.categories);
      if (Array.isArray(s.popular)) STORE.popular = s.popular;
      if (Array.isArray(s.sizes)) { SIZES = s.sizes; STORE.sizes = s.sizes; }
      geoFeeCache = {};
      geoFee(false).then(refreshFeeUI);
    }

    if (Array.isArray(d.products) && d.products.length) {
      var incoming = d.products.map(function (p) {
        return {
          id: p.id, name: p.name, cat: p.cat, price: Number(p.price) || 0,
          rating: Number(p.rating) || 0, time: p.time, kcal: p.kcal,
          tag: p.tag, img: p.img, desc: p.desc,
          stock: (p.stock === null || p.stock === undefined) ? null : Number(p.stock),
          extras: Array.isArray(p.extras) ? p.extras : null,
          sizes: Array.isArray(p.sizes) ? p.sizes : null
        };
      });
      PRODUCTS.length = 0;
      incoming.forEach(function (p) { PRODUCTS.push(p); });
    }

    renderBrand();
    renderHome();
    renderMenu();
    renderCart();
    if (current === 'profile') renderProfile();
  }

  function refreshMenu() {
    return fetch('api/menu', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('menu');
        return r.json();
      })
      .then(applyMenu)
      .catch(function () { /* offline: mantém o cardápio atual */ });
  }

  function renderBrand() {
    var nm = $('#brandName');
    if (nm) nm.textContent = STORE.name || 'Delícias do Aleff';

    var lg = $('#brandLogo');
    if (lg) {
      if (STORE.logo) { lg.src = STORE.logo; lg.hidden = false; }
      else lg.hidden = true;
    }

    var pill = $('#brandPill');
    if (pill) {
      pill.textContent = STORE.open ? 'Aberto' : 'Fechado';
      pill.classList.toggle('closed', !STORE.open);
    }

    var bar = $('#closedBar');
    if (bar) bar.hidden = STORE.open;

    document.title = (STORE.name || 'Delícias do Aleff') + ' — Delivery';

    var wa = $('#screen-profile .card-list a[href^="https://wa.me/"]');
    if (wa && STORE.whatsapp) wa.href = 'https://wa.me/' + STORE.whatsapp;
    var waSmall = wa ? $('small', wa) : null;
    if (waSmall && STORE.hours) waSmall.textContent = 'WhatsApp · ' + STORE.hours;
  }

  var lastRefresh = 0;
  function softRefresh() {
    if (Date.now() - lastRefresh < 8000) return;
    lastRefresh = Date.now();
    refreshMenu();
  }

  /* ---------------- boot ---------------- */

  /* ?reset=1 limpa o nome salvo — só para testar a tela de boas-vindas */
  if (/[?&]reset=1\b/.test(location.search)) {
    store.customer = '';
    if (store.addr) store.addr.name = '';
    save();
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }

  $('#locLabel').textContent = store.addr.text.split('—')[0].trim();
  $('#profileAddr').textContent = store.addr.text;
  $('#notifToggle').checked = store.notif !== false;
  renderBrand();
  renderHome();
  renderPromos();
  renderBadge();
  renderCart();
  resumeOrderPolls();
  refreshMenu();

  if (!customerName()) setTimeout(function () { openWelcome(true); }, 450);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (tmapTimer) { clearInterval(tmapTimer); tmapTimer = null; }
      return;
    }
    softRefresh();
    resumeOrderPolls();
    if (current === 'track') syncTrackView();
  });
  window.addEventListener('focus', softRefresh);
})();
