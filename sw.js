/* Delícias do Aleff · Bolos — service worker
   pré-cache do app shell, cache-first com atualização em segundo plano */

var CACHE = 'sc-bolos-v12';

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
  './img/logo-bolos-mark.png'
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
