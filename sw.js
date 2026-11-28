/* Delícias do Aleff · Bolos — service worker (v27)
   pré-cache do app shell, cache-first com atualização em segundo plano */

var CACHE = 'sc-bolos-20261128e';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './privacidade/',
  './privacidade/index.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './img/bolo-chocolate.webp',
  './img/bolo-morango.webp',
  './img/bolo-cenoura.webp',
  './img/bolo-redvelvet.webp',
  './img/fatia-chocolate.webp',
  './img/fatia-morango.webp',
  './img/torta-limao.webp',
  './img/torta-maracuja.webp',
  './img/docinhos.webp',
  './img/kit-festa.webp',
  './img/bebida.webp',
  './img/banner-bolos.webp',
  './img/logo-bolos-mark.png',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { /* segue instalando mesmo com falha parcial */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return; /* fontes e WhatsApp vão direto à rede */
  if (url.pathname.indexOf('/api/') === 0) return; /* API do painel: sempre da rede */
  if (url.pathname.indexOf('/painel') === 0) return; /* painel admin nunca vem do cache */
  if (url.pathname.indexOf('/pedidos') === 0) return; /* quadro de pedidos sempre da rede */
  if (url.pathname.indexOf('/motoboy') === 0) return; /* link do motoboy tem token na URL: nunca cachear */

  /* navegação (HTML): rede primeiro, cache só como reserva offline —
     assim uma página nova nunca fica presa numa versão velha */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });

      return hit || network;
    })
  );
});

/* ---------------- avisos push (a caminho / entregue) ---------------- */

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var num = d.num ? String(d.num) : '';
  var status = Number(d.status) || 3;
  var promo = !!d.promo;
  var title = d.title || (num ? 'Pedido #' + num : 'Delícias do Aleff');
  var opts = {
    body: d.body || 'Seu pedido atualizou.',
    icon: 'icons/icon-192.png',
    badge: 'icons/apple-touch-icon.png',
    tag: d.tag || ('order-' + num),
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: (!promo && status === 3) || !!d.panel,
    data: { url: d.url || './', num: num, status: status }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  var target = data.url || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var i, c;
      /* aviso de pedido novo: foca o painel e abre a aba Pedidos */
      if (data.panel) {
        for (i = 0; i < list.length; i++) {
          c = list[i];
          if (c.url.indexOf('/painel') === -1) continue;
          return c.focus().then(function (win) {
            if (win) win.postMessage({ type: 'push-orders' });
            return win;
          });
        }
        return clients.openWindow(target);
      }
      for (i = 0; i < list.length; i++) {
        c = list[i];
        /* painel, quadro e app do motoboy não são o app do cliente */
        if (c.url.indexOf('/painel') !== -1 || c.url.indexOf('/pedidos') !== -1 ||
            c.url.indexOf('/motoboy') !== -1) continue;
        return c.focus().then(function (win) {
          if (win && data.num) win.postMessage({ type: 'push-track', num: String(data.num) });
          return win;
        });
      }
      return clients.openWindow(target);
    })
  );
});
