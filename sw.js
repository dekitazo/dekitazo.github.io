// できたぞ service worker: アプリ本体はキャッシュ、問題データは新しいものを優先
const VER = "dekitazo-v0.3.0-b22865d2";
const SHELL = ["./", "./index.html", "./style.css", "./config.js", "./core.js", "./app.js", "./manifest.webmanifest",
  "./img/flower.svg", "./img/force.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 問題データ・JS はネット優先（更新を早く反映）、失敗したらキャッシュ
  if (/\/data\/.*\.js$|app\.js$|core\.js$|config\.js$|style\.css$/.test(url.pathname)) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VER).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
