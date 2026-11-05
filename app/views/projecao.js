// Projeção de letras: tela cheia, uma estrofe por vez, a partir das músicas da escala.
import { esc, icon } from "../core.js";

export function slidesOf(songs, perSlide = 2) {
  const out = [];
  songs.forEach((s, si) => {
    out.push({ si, kind: "title", title: s.title, sub: [s.artist, s.song_key ? `Tom ${s.song_key}` : ""].filter(Boolean).join(" · ") });
    for (const b of s.lyrics?.blocks || []) {
      const lines = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i += perSlide) out.push({ si, kind: "lyric", label: i === 0 ? b.label || "" : "", text: lines.slice(i, i + perSlide).join("\n") });
    }
  });
  return out;
}

export function openProjection(songs, { perSlide = 2 } = {}) {
  const slides = slidesOf(songs, perSlide);
  if (!slides.length) return;
  let i = 0, black = false, size = 6.2, bar = true, hideT;
  const wrap = document.createElement("div");
  wrap.className = "proj";
  wrap.innerHTML = `<div class="pj-slide" id="pjs"></div><div class="pj-bar" id="pjb">
    <button data-a="prev" aria-label="Anterior">${icon("chevronLeft")}</button>
    <select id="pjsong" aria-label="Música">${songs.map((s, k) => `<option value="${k}">${esc(s.title)}</option>`).join("")}</select>
    <button data-a="next" aria-label="Próximo">${icon("chevronRight")}</button>
    <button data-a="smaller" aria-label="Letra menor">A−</button><button data-a="bigger" aria-label="Letra maior">A+</button>
    <button data-a="black" aria-label="Tela preta">${icon("eye")}</button><button data-a="close" aria-label="Fechar">${icon("x")}</button></div>`;
  document.body.appendChild(wrap);
  try { wrap.requestFullscreen?.(); } catch { /* sem tela cheia */ }
  const box = wrap.querySelector("#pjs"), sel = wrap.querySelector("#pjsong");
  const draw = () => {
    const s = slides[i];
    sel.value = String(s.si);
    box.classList.toggle("off", black);
    box.style.fontSize = size + "vmin";
    box.innerHTML = black ? "" : s.kind === "title" ? `<div class="pj-title">${esc(s.title)}</div><div class="pj-sub">${esc(s.sub)}</div>`
      : `${s.label ? `<div class="pj-label">${esc(s.label)}</div>` : ""}<div class="pj-text">${esc(s.text)}</div>`;
  };
  const go = (d) => { i = Math.max(0, Math.min(slides.length - 1, i + d)); black = false; draw(); };
  const close = () => { document.removeEventListener("keydown", key); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); wrap.remove(); };
  const showBar = () => { bar = true; wrap.classList.remove("nobar"); clearTimeout(hideT); hideT = setTimeout(() => wrap.classList.add("nobar"), 3500); };
  const key = (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === "b" || e.key === "B" || e.key === ".") { black = !black; draw(); }
    else if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", key);
  box.addEventListener("click", (e) => { const r = box.getBoundingClientRect(); if (e.clientY > r.bottom - 90) return showBar(); go(e.clientX < r.left + r.width / 3 ? -1 : 1); showBar(); });
  wrap.querySelector("#pjb").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return; e.stopPropagation(); showBar();
    const a = b.dataset.a;
    if (a === "next") go(1); else if (a === "prev") go(-1);
    else if (a === "bigger") { size = Math.min(12, size + .6); draw(); } else if (a === "smaller") { size = Math.max(3, size - .6); draw(); }
    else if (a === "black") { black = !black; draw(); } else if (a === "close") close();
  });
  sel.onchange = () => { i = Math.max(0, slides.findIndex((s) => s.si === Number(sel.value))); black = false; draw(); };
  draw(); showBar(); void bar;
}
