// Cachea solo la interfaz (los datos siempre vienen de Supabase). Subir CACHE al cambiar archivos.
const CACHE = 'proyectos-v4';
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'config.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

// Red primero para la interfaz (así los cambios llegan enseguida); caché si no hay conexión.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: GitHub Pages manda max-age=600 y sin esto los cambios tardan 10 min en llegar
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
