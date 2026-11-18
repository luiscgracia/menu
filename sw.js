/* =====================================================================
   Service Worker — menú de restaurante
   ---------------------------------------------------------------------
   Estrategias:
     • install   → precachea el "shell" (HTML, CSS, JS, fuentes, header,
                    footer, iconos, imágenes de la intro)
     • activate  → limpia caches viejas de versiones anteriores
     • fetch     → según tipo de recurso:
          - HEAD              → responde desde caché si existe
                                 (así mobile.html detecta secciones offline)
          - imgs/**           → cache-first
          - fuentes/**        → cache-first
          - *.html / navigate → network-first (cae a caché si offline)
          - css/js/resto shell→ stale-while-revalidate
     • message   → { type: 'precache', urls: [...] } desde mobile.html
   ---------------------------------------------------------------------
   CUÁNDO SUBIR VERSION (sw.js):
     Solo cuando EDITAS el contenido de un archivo ya cacheado
     (un SVG existente, header.svg, footer.svg, fuentes, iconos).
   CUÁNDO SUBIR CACHE_KEY (mobile.html):
     Cuando AÑADES secciones nuevas (7.1.svg, 8.1.svg…).
   Si dudas, subir las dos a la vez es seguro: solo se re-descarga de más.
   ===================================================================== */

var VERSION      = 'v6';
var SHELL_CACHE  = 'menu-shell-' + VERSION;
var IMG_CACHE    = 'menu-imgs-'  + VERSION;

var SHELL = [
  './',
  './mobile.html',
  './manifest.json',
  './css/jquery.fullPage.css',
  './js/jquery.fullPage.js',
  './fuentes/Arlrdlt.woff',
  './fuentes/Arlrdlt.ttf',
  './fuentes/Arlrdbd.woff',
  './fuentes/Arlrdbd.ttf',
  './imgs/icon-192.png',
  './imgs/icon-512.png',
  './imgs/logocrepes1.png',
  './imgs/logocrepes1.svg',
  './imgs/bebidas.jpg',
  './imgs/mobile/header.svg',
  './imgs/mobile/footer.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // add() por separado para que un 404 no rompa la instalación entera
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== SHELL_CACHE && k !== IMG_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  /* ---- HEAD: usado por la detección de secciones de mobile.html ----
     IMPORTANTE: consultar la RED primero para reflejar la realidad (un
     archivo inexistente debe dar 404, no un 200 fabricado desde caché).
     Solo si la red falla (offline) se recurre a la caché. */
  if (req.method === 'HEAD') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match(req.url, { ignoreMethod: true }).then(function (hit) {
          if (hit) {
            return new Response('', {
              status: 200,
              headers: { 'Content-Type': hit.headers.get('Content-Type') || 'image/webp' }
            });
          }
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  if (req.method !== 'GET') return;

  /* ---- Imágenes: cache-first (incluye .webp) ---- */
  if (sameOrigin && /\/imgs\//.test(url.pathname) &&
      /\.(svg|png|jpe?g|webp|gif)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  /* ---- Fuentes: cache-first ---- */
  if (sameOrigin && /\/fuentes\//.test(url.pathname)) {
    e.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  /* ---- HTML: network-first con fallback a caché ---- */
  if (req.mode === 'navigate' || (sameOrigin && /\.html?$/.test(url.pathname))) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  /* ---- CSS / JS / otros del shell: stale-while-revalidate ---- */
  if (sameOrigin) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
});

/* ------------------------------------------------------------------ */
/* Estrategias                                                          */
/* ------------------------------------------------------------------ */

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(function () {
        // Offline y sin caché previa: respuesta de error controlada
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    });
  });
}

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(req).then(function (resp) {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(function () {
      return cache.match(req).then(function (c) {
        return c || new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    });
  });
}

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var fetchPromise = fetch(req).then(function (resp) {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(function () { return cached; });
      return cached || fetchPromise;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Mensaje desde mobile.html: precachear todos los SVG detectados      */
/* ------------------------------------------------------------------ */

self.addEventListener('message', function (e) {
  var data = e.data;
  if (!data || data.type !== 'precache' || !Array.isArray(data.urls)) return;

  e.waitUntil(
    caches.open(IMG_CACHE).then(function (cache) {
      // Pequeño retardo para no competir con lo que el usuario está mirando
      return new Promise(function (r) { setTimeout(r, 2500); }).then(function () {
        var urls = data.urls;
        var idx = 0, active = 0, done = 0, concurrencia = 4;
        return new Promise(function (resolve) {
          if (!urls.length) return resolve();
          function next() {
            while (active < concurrencia && idx < urls.length) {
              (function (url) {
                active++;
                cache.match(url).then(function (hit) {
                  if (hit) return;
                  return fetch(url).then(function (resp) {
                    if (resp && resp.ok) return cache.put(url, resp);
                  }).catch(function () {});
                }).then(function () {
                  active--; done++;
                  if (done === urls.length) resolve();
                  else next();
                });
              })(urls[idx++]);
            }
          }
          next();
        });
      });
    })
  );
});
