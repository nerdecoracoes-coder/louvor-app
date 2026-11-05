// Tutoriais em vídeo: gravação da tela com legendas e narração pela voz do próprio aparelho (gratuita).
import { esc, icon, empty, on } from "../core.js";

export const TUTORIAIS = [
  { slug: "criar-escala", title: "Como criar uma escala", about: "Escolher data, participantes e músicas, e avisar a equipe.", time: "1 min" },
];

export function register(route) {
  route("/ajuda", (p, el) => list(el));
  route("/ajuda/:slug", (p, el, a) => watch(p.slug, el, a));
}

function list(el) {
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><h1>Tutoriais</h1></div>
    <p class="muted small">Vídeos curtos mostrando o aplicativo passo a passo. A narração é lida em voz alta pelo seu aparelho.</p>
    <div class="list mt">${TUTORIAIS.map((t) => `<a class="li" href="#/ajuda/${t.slug}"><span class="cover">${icon("play")}</span><span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${esc(t.about)} · ${esc(t.time)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`;
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
