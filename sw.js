/* Somos — service worker: torna o app instalável e abre mesmo com internet instável.
   Os arquivos do app usam "rede primeiro" (sempre a versão mais nova quando há conexão).
   Os áudios do player ficam em um cache separado gerenciado pelo próprio player. */
const SHELL = "somos-shell-v170";
const FILES = ["./", "index.html", "config.js", "manifest.json", "icon.svg", "app/styles.css", "app/main.js", "app/core.js", "app/sb.js",
  "app/views/home.js", "app/views/jornadas.js", "app/views/contatos.js", "app/lib/pdf.js", "app/views/relatorios-pessoas.js", "app/views/segmentacao.js", "app/views/carteira.js", "app/views/celulas.js", "app/views/programacoes.js", "app/views/escalas.js", "app/lib/mod-ui.js", "app/lib/cards.js", "app/lib/shortcuts.js", "app/views/destaques.js", "app/views/inscricoes.js", "app/views/financeiro.js", "app/views/comunicacao.js", "app/views/cuidado.js", "app/views/digital.js", "app/views/instituicao.js", "app/views/integracoes.js", "app/lib/push.js", "app/views/servico.js", "app/views/teams.js", "app/views/schedules.js", "app/views/songs.js", "app/views/chat.js", "app/views/account.js", "app/views/multimidia.js", "app/views/ministerios.js", "app/views/letras.js", "app/views/ajuda.js", "app/views/igreja.js", "app/views/estudio.js", "app/views/ferramentas.js", "app/views/eventos.js", "app/lib/pptx.js", "app/lib/videoz.js", "app/views/timepage.js", "app/views/palco.js", "app/views/palco-art.js", "app/assets/palco/drums.webp", "app/assets/palco/keys.webp", "app/assets/palco/eguitar.webp", "app/assets/palco/bass.webp", "app/assets/palco/acoustic.webp", "app/assets/palco/mic.webp", "app/views/extras.js", "app/views/chamados.js", "app/views/pessoas.js", "app/views/acolher.js", "app/views/acolhimento.js", "app/views/meu-cadastro.js", "app/views/novos-convertidos.js", "app/lib/xlsx.js", "app/lib/qr.js", "app/lib/pessoas-import.js",
  "app/player/engine.js", "app/player/pitch-worklet.js", "app/lib/keys.js", "app/lib/repeat.js", "app/player/view.js", "app/player/warm.js", "app/player/ogg.js", "app/player/opus-decoder.min.js", "app/fonts/sora.woff"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {}))))); });
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if ((k.startsWith("louvor-shell-") || k.startsWith("somos-shell-")) && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || e.request.headers.has("range") || u.pathname.endsWith(".mp4")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});

// Aviso no celular (push): chega com o app fechado. O envio é feito pela Edge Function push-send.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Somos", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Somos", { body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", vibrate: [120, 60, 120], tag: d.tag || undefined, data: { link: d.link || "#/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "#/";
  e.waitUntil((async () => {
    const base = new URL("./", self.registration.scope).href;
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (c.url.startsWith(base)) { await c.focus(); c.postMessage({ type: "push-open", link }); if ("navigate" in c) try { await c.navigate(base + (link.startsWith("#") ? link : "#/")); } catch {} return; }
    }
    await self.clients.openWindow(base + (link.startsWith("#") ? link : "#/"));
  })());
});
