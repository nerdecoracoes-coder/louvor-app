// Tutoriais em vídeo: gravação da tela com legendas e narração pela voz do próprio aparelho (gratuita).
import { esc, icon, empty, on } from "../core.js";

export const TUTORIAIS = [
  { grupo: "Escalas", slug: "criar-escala", title: "Como criar uma escala", about: "Escolher data, participantes e músicas, e avisar a equipe." },
  { grupo: "Escalas", slug: "confirmar-escala", title: "Como confirmar que viu a escala", about: "Abrir a escala em que você foi escalado e confirmar." },
  { grupo: "Escalas", slug: "panorama", title: "Como ver o Panorama de escalas", about: "Ver quem serviu no mês e filtrar por dia e horário." },
  { pronto: false, grupo: "Multimídia", slug: "letras-midia", title: "Como preparar as letras para a projeção", about: "Ajustar fonte, cores e partes e baixar em PowerPoint." },
  { pronto: false, grupo: "Multimídia", slug: "pacote-culto", title: "Como baixar o pacote do culto", about: "Letras e slides de todas as músicas do culto, de uma vez." },
  { pronto: false, grupo: "Multimídia", slug: "roteiro-culto", title: "Como montar o roteiro do culto", about: "Ordem do culto com horários e responsáveis." },
  { pronto: false, grupo: "Multimídia", slug: "checklist-pre-culto", title: "Como usar o checklist pré-culto", about: "Conferir os itens antes do culto." },
  { pronto: false, grupo: "Multimídia", slug: "pedir-midia", title: "Como pedir uma arte ou um vídeo", about: "Qualquer time pode pedir material à Multimídia." },
  { pronto: false, grupo: "Multimídia", slug: "atender-pedido", title: "Como atender um pedido de mídia", about: "Acompanhar os pedidos e avisar quando estiver pronto." },
  { pronto: false, grupo: "Ministério Infantil", slug: "criancas", title: "Cadastro, entrada e saída de crianças", about: "Alergias, responsável e código de retirada." },
  { pronto: false, grupo: "Diáconos", slug: "visitantes", title: "Como registrar visitantes", about: "Registrar quem visita a igreja e acompanhar o contato." },
];

export function register(route) {
  route("/ajuda", (p, el) => list(el));
  route("/ajuda/:slug", (p, el, a) => watch(p.slug, el, a));
}

function list(el) {
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><h1>Tutoriais</h1></div>
    <p class="muted small">Vídeos curtos mostrando o aplicativo passo a passo. A narração é lida em voz alta pelo seu aparelho.</p>
    ${[...new Set(TUTORIAIS.filter((t) => t.pronto !== false).map((t) => t.grupo))].map((g) => `<div class="sec"><h2>${esc(g)}</h2></div><div class="list">${TUTORIAIS.filter((t) => t.pronto !== false && t.grupo === g).map((t) => `<a class="li" href="#/ajuda/${t.slug}"><span class="cover">${icon("play")}</span><span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${esc(t.about)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`).join("")}`;
}

async function watch(slug, el, alive) {
  const t = TUTORIAIS.find((x) => x.slug === slug);
  let meta = null;
  try { const r = await fetch(`app/tutoriais/${slug}.json`); if (r.ok) meta = await r.json(); } catch { /* sem rede */ }
  if (!alive()) return;
  if (!t || !meta) { el.innerHTML = empty("play", "Tutorial não encontrado", "Volte à lista e escolha outro."); return; }
  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  let narrate = !!synth, cur = -1, voice = null;
  const pickVoice = () => { const vs = synth?.getVoices() || []; voice = vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null; };
  pickVoice(); if (synth) synth.onvoiceschanged = pickVoice;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/ajuda">${icon("chevronLeft")}</a><h1 style="font-size:22px">${esc(t.title)}</h1></div>
    <div class="tvideo"><video id="tv" src="app/tutoriais/${slug}.mp4" playsinline controls preload="metadata"></video><div class="tcap" id="tc" aria-live="polite"></div></div>
    ${synth ? `<label class="switchrow"><span class="grow"><b>Narração em voz alta</b><small>Usa a voz do seu aparelho. Aumente o volume do celular.</small></span><span class="switch"><input type="checkbox" id="tn" checked><i></i></span></label>` : `<p class="small muted">Seu aparelho não lê em voz alta. Siga pelas legendas.</p>`}
    <ol class="tsteps">${meta.cues.map((c, i) => `<li><button data-seek="${c.t}" data-i="${i}">${esc(c.text)}</button></li>`).join("")}</ol>`;
  const v = el.querySelector("#tv"), cap = el.querySelector("#tc");
  const speak = (text) => {
    if (!synth || !narrate) return;
    synth.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = voice?.lang || "pt-BR"; if (voice) u.voice = voice; u.rate = 1.0; synth.speak(u);
  };
  const at = () => { let k = -1; meta.cues.forEach((c, i) => { if (v.currentTime + 0.15 >= c.t) k = i; }); return k; };
  const sync = () => {
    const k = at(); if (k === cur) return; cur = k;
    cap.textContent = k >= 0 ? meta.cues[k].text : "";
    el.querySelectorAll("[data-i]").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === k));
    if (k >= 0 && !v.paused) speak(meta.cues[k].text);
  };
  v.addEventListener("timeupdate", sync);
  v.addEventListener("pause", () => synth?.cancel());
  v.addEventListener("play", () => { cur = -1; sync(); });
  v.addEventListener("ended", () => synth?.cancel());
  el.querySelector("#tn")?.addEventListener("change", (e) => { narrate = e.target.checked; if (!narrate) synth.cancel(); else { cur = -1; sync(); } });
  on(el, "click", "[data-seek]", (e, b) => { v.currentTime = Number(b.dataset.seek); cur = -1; v.play().catch(() => {}); });
  window.addEventListener("hashchange", () => synth?.cancel(), { once: true });
}
