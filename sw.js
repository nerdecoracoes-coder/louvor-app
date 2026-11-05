/* Somos — service worker: torna o app instalável e abre mesmo com internet instável.
   Os arquivos do app usam "rede primeiro" (sempre a versão mais nova quando há conexão).
   Os áudios do player ficam em um cache separado gerenciado pelo próprio player. */
const SHELL = "somos-shell-v10";
const FILES = ["./", "index.html", "config.js", "manifest.json", "icon.svg", "app/styles.css", "app/main.js", "app/core.js", "app/sb.js",
  "app/views/home.js", "app/views/teams.js", "app/views/schedules.js", "app/views/songs.js", "app/views/chat.js", "app/views/account.js", "app/views/multimidia.js", "app/views/timepage.js", "app/views/extras.js",
  "app/player/engine.js", "app/player/view.js", "app/player/warm.js", "app/player/ogg.js", "app/player/opus-decoder.min.js", "app/fonts/sora.woff"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {}))))); });
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if ((k.startsWith("louvor-shell-") || k.startsWith("somos-shell-")) && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
