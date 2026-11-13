// Cachea solo la interfaz (los datos siempre vienen de /api). Subir CACHE al cambiar archivos.
const CACHE = 'proyectos-v11';
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'api.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

// Red primero para la interfaz (así los cambios llegan enseguida); caché si no hay conexión.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // /api y /cdn-cgi (datos, archivos y login de Access) nunca se cachean
  if (e.request.method !== 'GET' || url.origin !== location.origin || /^\/(api|cdn-cgi)\//.test(url.pathname)) return;
  e.respondWith(
    // no-cache: revalida siempre, así un deploy nuevo llega aunque el hosting mande max-age (GitHub Pages mandaba 600)
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
