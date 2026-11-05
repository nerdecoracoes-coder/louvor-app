// Páginas do menu lateral: aniversariantes (todos os meses) e metrônomo.
import { sb, state, must, esc, icon, avatar, people, empty, spinner, ymd } from "../core.js";

export function register(route) {
  route("/aniversariantes", birthdays);
  route("/metronomo", metronome);
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const backHead = (title) => `<div class="pagehead"><a class="back" href="javascript:history.back()" aria-label="Voltar">${icon("chevronLeft")}</a><h1>${title}</h1></div>`;

// ---------------------------------------------------------------- aniversariantes
async function birthdays(_, el, alive) {
  el.innerHTML = spinner();
  const ppl = await people();
  let list = [...ppl.values()];
  if (state.space) {
    const ids = new Set((await must(sb.from("team_members").select("user_id").eq("team_id", state.space.id))).map((m) => m.user_id));
    list = list.filter((p) => ids.has(p.id));
  }
  if (alive && !alive()) return;
  const withDate = list.filter((p) => p.birth_date), without = list.length - withDate.length;
  const today = ymd(new Date()), thisMonth = Number(today.slice(5, 7)), thisDay = Number(today.slice(8, 10));
  const byMonth = new Map();
  for (const p of withDate) {
    const m = Number(p.birth_date.slice(5, 7)), d = Number(p.birth_date.slice(8, 10));
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push({ p, d });
  }
  const order = Array.from({ length: 12 }, (_, i) => ((thisMonth - 1 + i) % 12) + 1).filter((m) => byMonth.has(m));
  el.innerHTML = `${backHead("Aniversariantes")}
    <p class="subhead">${state.space ? esc(state.space.name) : esc(state.org.name)}, a partir de ${MONTHS[thisMonth - 1]}.</p>
    ${order.length ? order.map((m) => `<div class="sec"><h2>${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)}</h2></div>
      <div class="list">${byMonth.get(m).sort((a, b) => a.d - b.d || a.p.display_name.localeCompare(b.p.display_name)).map(({ p, d }) => {
        const isToday = m === thisMonth && d === thisDay;
        return `<div class="li">${avatar(p, 44, isToday)}<span class="grow t" style="min-width:0">${esc(p.display_name)}</span>${isToday ? `<span class="tag">Hoje</span>` : `<span class="muted small">${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}</span>`}</div>`;
      }).join("")}</div>`).join("")
      : `<div class="card">${empty("gift", "Nenhuma data de nascimento cadastrada", "Peça para os integrantes completarem o perfil com a data de nascimento.")}</div>`}
    ${without && order.length ? `<p class="small muted mt">${without} pessoa${without === 1 ? "" : "s"} sem data de nascimento cadastrada.</p>` : ""}`;
}

// ---------------------------------------------------------------- metrônomo
async function metronome(_, el) {
  let bpm = 90, beats = 4, running = false, ctx = null, timer = null, nextAt = 0, beat = 0;
  const taps = [];
  const clamp = (v) => Math.max(30, Math.min(260, Math.round(v)));
  el.innerHTML = `${backHead("Metrônomo")}
    <div class="metro">
      <div class="bpmrow"><button class="iconbtn" data-d="-5" aria-label="Diminuir 5">${icon("chevronLeft")}</button><div class="bpm"><b id="bpm">${bpm}</b><span>BPM</span></div><button class="iconbtn" data-d="5" aria-label="Aumentar 5">${icon("chevronRight")}</button></div>
      <input type="range" id="rng" min="30" max="260" value="${bpm}" aria-label="Andamento em BPM">
      <div class="row gap" style="justify-content:center"><button class="chip" data-d="-1">−1</button><button class="chip" data-d="1">+1</button><button class="chip" id="tap">Toque no ritmo</button></div>
      <div class="dots2" id="dots"></div>
      <div class="chips" style="justify-content:center">${[2, 3, 4, 6].map((n) => `<button class="chip${n === beats ? " on" : ""}" data-b="${n}">${n} tempos</button>`).join("")}</div>
      <button class="btn primary block" id="go">${icon("play")} Iniciar</button>
    </div>`;
  const dots = () => { el.querySelector("#dots").innerHTML = Array.from({ length: beats }, (_, i) => `<i class="${i === 0 ? "ac" : ""}"></i>`).join(""); };
  const setBpm = (v) => { bpm = clamp(v); el.querySelector("#bpm").textContent = bpm; el.querySelector("#rng").value = bpm; };
  const click = (t, accent) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1500 : 1000; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.start(t); o.stop(t + 0.08);
  };
  const flash = (i, t) => setTimeout(() => { if (!running) return; el.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === i)); }, Math.max(0, (t - ctx.currentTime) * 1000));
  const tick = () => {
    while (nextAt < ctx.currentTime + 0.12) { click(nextAt, beat === 0); flash(beat, nextAt); nextAt += 60 / bpm; beat = (beat + 1) % beats; }
  };
  const stop = () => { running = false; clearInterval(timer); el.querySelectorAll("#dots i").forEach((d) => d.classList.remove("on")); const b = el.querySelector("#go"); if (b) b.innerHTML = `${icon("play")} Iniciar`; };
  const start = async () => {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    running = true; beat = 0; nextAt = ctx.currentTime + 0.05;
    timer = setInterval(tick, 25); tick();
    el.querySelector("#go").innerHTML = `${icon("stop")} Parar`;
  };
  dots();
  el.addEventListener("click", (e) => {
    const d = e.target.closest("[data-d]"); if (d) return setBpm(bpm + Number(d.dataset.d));
    const b = e.target.closest("[data-b]"); if (b) { beats = Number(b.dataset.b); beat = 0; el.querySelectorAll("[data-b]").forEach((x) => x.classList.toggle("on", x === b)); return dots(); }
    if (e.target.closest("#tap")) {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
      taps.push(now); if (taps.length > 6) taps.shift();
      if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
      return;
    }
    if (e.target.closest("#go")) running ? stop() : start();
  });
  el.querySelector("#rng").addEventListener("input", (e) => setBpm(Number(e.target.value)));
  window.addEventListener("hashchange", () => { stop(); ctx?.close().catch(() => {}); ctx = null; }, { once: true });
}
