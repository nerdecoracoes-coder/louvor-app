// Player multitrack: abas Faixas, Mix e Letra, linha do tempo com marcadores/regiões e transporte.
import { sb, state, must, esc, attr, icon, toast, errMsg, isRepertoireStaff as isStaff, fDur } from "../core.js";
import { Engine, gainToDb } from "./engine.js";

// Cores salvas no REAPER (PEAKCOL das faixas e cor de marcadores/regiões): só valem com o bit 0x1000000 ligado;
// o valor vem no formato do Windows (0x00BBGGRR).
const rcol = (n) => { n = Number(n); if (!n || !(n & 0x1000000)) return null; const c = n & 0xffffff; return [c & 255, (c >> 8) & 255, (c >> 16) & 255]; };
const css = (c, a = 1) => (c ? (a === 1 ? `rgb(${c.join(",")})` : `rgba(${c.join(",")},${a})`) : null);

let current = null;

export function closePlayer() {
  if (!current) return;
  current.destroy();
  current = null;
}

const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };
const dbLabel = (g) => { const d = gainToDb(g); return d === -Infinity ? "-∞" : (d > 0 ? "+" : "") + d.toFixed(1); };

export async function openPlayer(songId) {
  closePlayer();
  const root = document.createElement("div");
  root.className = "player";
  root.innerHTML = `<div class="backdrop"></div><div class="ph"><button class="back" data-x aria-label="Fechar">${icon("chevronDown")}</button><div class="grow">${'<div class="spin" style="margin:6px 0"></div>'}</div></div>`;
  document.body.appendChild(root);
  document.body.classList.add("noscroll");
  const ctrl = { destroy() { engine?.destroy(); cancelAnimationFrame(raf); clearTimeout(saveT); root.remove(); document.body.classList.remove("noscroll"); window.__player = null; } };
  current = ctrl;
  let engine = null, raf = 0, saveT = 0;
  root.querySelector("[data-x]").onclick = close;
  function close() { if (history.length > 1 && location.hash.startsWith("#/player/")) history.back(); else { location.hash = "/musicas"; } }

  try {
    const song = await must(sb.from("songs").select("*").eq("id", songId).maybeSingle());
    if (!song) throw new Error("Música não encontrada.");
    if (!song.current_project_id || song.status !== "ready") throw new Error(song.status === "removed" ? "Esta música saiu do repertório." : "Esta música ainda não tem projeto multitrack pronto.");
    const [project, tracks, markers, media, preset] = await Promise.all([
      must(sb.from("multitrack_projects").select("*").eq("id", song.current_project_id).single()),
      must(sb.from("project_tracks").select("*").eq("project_id", song.current_project_id).order("idx")),
      must(sb.from("project_markers").select("*").eq("project_id", song.current_project_id).order("position")),
      must(sb.from("project_media").select("*").eq("project_id", song.current_project_id)),
      must(sb.from("mix_presets").select("*").eq("user_id", state.user.id).eq("song_id", songId).maybeSingle()),
    ]);
    if (current !== ctrl) return;
    const mediaBase = sb.functions.url("drive-media");
    engine = new Engine({
      project, tracks, markers: markers.map((m) => ({ ...m, position: Number(m.position), end_position: m.end_position == null ? null : Number(m.end_position) })),
      media, mix: preset && preset.project_id === project.id ? preset.settings : preset?.settings,
      mediaUrl: (id) => `${mediaBase}?file=${encodeURIComponent(id)}`, token: () => sb.auth.token(), anonKey: sb.anonKey,
    });
    await engine.init();
    window.__player = engine;
    build(root, song, project, engine);
  } catch (e) {
    root.innerHTML = `<div class="backdrop"></div><div class="ph"><button class="back" data-x>${icon("chevronDown")}</button></div><div class="empty">${icon("alert")}<b>Não foi possível abrir o player</b><p>${esc(errMsg(e))}</p></div>`;
    root.querySelector("[data-x]").onclick = close;
    return;
  }

  function build(root, song, project, engine) {
    let tab = "faixas";
    const lyr = song.lyrics?.blocks || [];
    const regions = engine.markers.filter((m) => m.is_region && m.end_position != null);
    const marks = engine.markers.filter((m) => !m.is_region);
    const L = engine.length || 1;
    const audioTracks = engine.tracks.filter((t) => t.kind === "audio" || t.kind === "folder");
    // cor da faixa: a dela, senão a da pasta (como o REAPER mostra)
    const tcol = (t) => rcol(t.color) || (t.parent_idx != null ? tcol(engine.tracks.find((x) => x.idx === t.parent_idx) || {}) : null);
    // partes da música: regiões; sem regiões, os marcadores (cada um até o próximo)
    const parts = regions.length ? regions.map((r) => ({ id: r.id, name: r.name || "Região", start: r.position, end: r.end_position, color: rcol(r.color), region: r }))
      : marks.map((m, i) => ({ id: m.id, name: m.name || `Marcador ${i + 1}`, start: m.position, end: marks[i + 1]?.position ?? L, color: rcol(m.color) }));
    const other = engine.tracks.filter((t) => !["audio", "folder"].includes(t.kind));
    const warnings = [...(project.warnings || []), ...engine.tracks.flatMap((t) => (t.warnings || []).map((w) => `${t.name}: ${w}`))];
    root.innerHTML = `<div class="backdrop"></div>
      <div class="ph"><button class="back" data-x aria-label="Fechar">${icon("chevronDown")}</button>
        <span class="cover">${song.cover_url ? `<img src="${attr(song.cover_url)}" alt="">` : icon("music")}</span>
        <div class="grow" style="min-width:0"><h2 class="ellipsis">${esc(song.title)}</h2><div class="s ellipsis">${esc(song.artist || "")}</div></div>
        <button class="iconbtn" id="mixreset" title="Restaurar a mixagem do projeto" aria-label="Restaurar mix">${icon("refresh")}</button></div>
      <div class="pmeta">${song.song_key ? `<span class="tag soft">Tom ${esc(song.song_key)}</span>` : ""}${song.bpm ? `<span class="tag soft">${Number(song.bpm)} BPM</span>` : ""}
        ${project.time_sig_num ? `<span class="tag gray">${project.time_sig_num}/${project.time_sig_den}</span>` : ""}<span class="tag gray">${audioTracks.filter((t) => t.kind === "audio").length} faixas</span>
        <span class="tag gray" id="mixtag">Mix do projeto</span><span class="tag gray hidden" id="buf">Carregando…</span></div>
      <div class="ptabs"><button data-tab="faixas" class="on">${icon("tracks")} Faixas</button><button data-tab="mix">${icon("sliders")} Mix</button><button data-tab="letra">${icon("lyrics")} Letra</button></div>
      <div class="pbody" id="pbody"></div>
      <div class="loadbar"><i id="lb" style="width:0"></i></div>
      <div class="timeline" id="tl">
        ${regions.map((r) => { const c = rcol(r.color); return `<div class="rg" data-rg="${r.id}" style="left:${(r.position / L) * 100}%;width:${((r.end_position - r.position) / L) * 100}%${c ? `;--rc:${c.join(",")}` : ""}">${esc(r.name)}</div>`; }).join("")}
        ${marks.map((m) => { const c = rcol(m.color); return `<div class="mk" style="left:${(m.position / L) * 100}%${c ? `;border-color:${css(c)};color:${css(c)}` : ""}" title="${attr(m.name)}">${esc(m.name)}</div>`; }).join("")}
        <div class="rail"></div><div class="prog" id="prog"></div><div class="head" id="head"></div></div>
      <div class="times"><span id="tcur">0:00.0</span><span id="tmark"></span><span>${fmt(L)}</span></div>
      ${parts.length ? `<div class="parts" id="parts">${parts.map((x) => `<button class="part" data-part="${x.id}" style="${x.color ? `--pc:${x.color.join(",")}` : ""}"><b class="ellipsis">${esc(x.name)}</b><span>${fmt(x.start).replace(/\.\d$/, "")}</span></button>`).join("")}</div>` : ""}
      <div class="transport">
        <button data-t="prev" aria-label="Marcador anterior">${icon("prev")}</button>
        <button data-t="rew" aria-label="Retroceder 5 segundos">${icon("rew")}</button>
        <button data-t="play" class="pp" aria-label="Tocar">${icon("play")}</button>
        <button data-t="stop" aria-label="Parar">${icon("stop")}</button>
        <button data-t="fwd" aria-label="Avançar 5 segundos">${icon("fwd")}</button>
        <button data-t="next" aria-label="Próximo marcador">${icon("next")}</button>
        <button data-t="rep" aria-label="Repetir">${icon("repeat")}</button>
        <label class="master">${icon("volume")}<input type="range" class="fader" id="mvol" min="0" max="1.5" step="0.01" value="${engine.master.user}" aria-label="Volume master"><span class="tiny" id="mdb">${dbLabel(engine.master.user)}</span></label>
      </div>`;
    root.querySelector("[data-x]").onclick = close;
    const body = root.querySelector("#pbody");

    // ---------- abas
    const drawTab = () => {
      root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
      if (tab === "faixas") {
        body.innerHTML = audioTracks.map((t) => `<div class="trk${t.parent_idx != null ? " child" : ""}${t.kind === "folder" ? " folder" : ""}" data-ti="${t.idx}"${tcol(t) ? ` style="--tc:${tcol(t).join(",")}"` : ""}>
          <div><div class="nm">${t.kind === "folder" ? icon("layers") : ""}<span class="ellipsis" title="${attr(t.name)}">${esc(t.name)}</span></div>
            <div class="ctl"><button class="ms m" data-m="${t.idx}">M</button><button class="ms s" data-s="${t.idx}">S</button>
              <input type="range" class="fader" data-v="${t.idx}" min="0" max="1.6" step="0.01" aria-label="Volume ${attr(t.name)}" style="width:60px"></div>
            <div class="ctl"><span class="tiny muted" style="width:16px">L</span><input type="range" class="fader" data-p="${t.idx}" min="-1" max="1" step="0.01" aria-label="Pan ${attr(t.name)}" style="width:72px"><span class="tiny muted">R</span></div></div>
          <div class="wave" data-w="${t.idx}"><canvas></canvas><span class="ph-line"></span></div></div>`).join("")
          + (other.length ? `<p class="tiny muted mt">Sem áudio para reproduzir: ${other.map((t) => esc(t.name) + (t.kind === "lyrics" ? " (letra)" : t.kind === "midi" ? " (MIDI)" : "")).join(", ")}.</p>` : "")
          + (warnings.length ? `<details class="card mt small"><summary class="warn" style="cursor:pointer">${warnings.length} recurso(s) do projeto não reproduzido(s) pelo player</summary><ul style="padding-left:18px;margin:8px 0 0">${[...new Set(warnings)].map((w) => `<li class="muted" style="margin:4px 0">${esc(w)}</li>`).join("")}</ul></details>` : "");
        syncControls(); drawAllWaves();
      } else if (tab === "mix") {
        body.innerHTML = `<div class="mixer">${audioTracks.map((t) => `<div class="strip" data-ti="${t.idx}"${tcol(t) ? ` style="--tc:${tcol(t).join(",")}"` : ""}><div class="nm" title="${attr(t.name)}">${esc(t.name)}</div>
          <input type="range" class="fader" data-p="${t.idx}" min="-1" max="1" step="0.01" style="width:66px" aria-label="Pan"><span class="tiny muted" data-pl="${t.idx}"></span>
          <div class="fz"><input type="range" class="vfader" data-v="${t.idx}" min="0" max="1.6" step="0.01" orient="vertical" aria-label="Volume ${attr(t.name)}"><div class="meter"><i data-lv="${t.idx}"></i></div></div>
          <span class="db" data-db="${t.idx}"></span><div class="row gap-s"><button class="ms m" data-m="${t.idx}">M</button><button class="ms s" data-s="${t.idx}">S</button></div></div>`).join("")}
          <div class="strip master"><div class="nm">MASTER</div><span class="tiny muted" style="height:38px"></span>
            <div class="fz"><input type="range" class="vfader" id="mvol2" min="0" max="1.5" step="0.01" orient="vertical" value="${engine.master.user}" aria-label="Volume master"><div class="meter"><i id="mlv"></i></div></div>
            <span class="db" id="mdb2">${dbLabel(engine.master.user * engine.master.volume)}</span><button class="ms m ${engine.master.muted ? "on" : ""}" id="mmute">M</button></div></div>
          <p class="tiny muted">Os ajustes ficam salvos só para você e não alteram o projeto original no Google Drive.</p>`;
        syncControls();
      } else {
        const synced = lyr.some((b) => b.start != null);
        body.innerHTML = lyr.length ? `<div class="lyr${engine.playing && synced ? " playing" : ""}" id="lyr">
            ${isStaff() ? `<div class="row between mb"><span class="tiny muted">${synced ? "Letra sincronizada" : "Letra sem tempos marcados"}</span><button class="chip" id="markmode">${icon("clock")} Marcar tempos</button></div>` : ""}
            ${lyr.map((b, i) => `<div class="blk" data-bi="${i}">${b.label ? `<h4>${esc(b.label)}</h4>` : ""}<p>${esc(b.text)}</p>${b.start != null ? `<span class="tm">${fmt(b.start)}</span>` : ""}</div>`).join("")}</div>`
          : `<div class="empty">${icon("lyrics")}<b>Sem letra para esta música</b><p>${project.lyrics_raw ? "O projeto tem uma track de letra; a leitura automática será ativada após a validação do formato com um projeto real. Enquanto isso, a letra pode ser cadastrada manualmente." : "A letra pode ser cadastrada na página da música."}</p>${isStaff() ? `<a class="btn ghost mt" href="#/musica/${song.id}/letra">Cadastrar letra</a>` : ""}</div>`;
        bindLyrics();
      }
    };
    root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; drawTab(); }));

    function syncControls() {
      for (const t of engine.tracks) {
        root.querySelectorAll(`[data-m="${t.idx}"]`).forEach((b) => b.classList.toggle("on", t.muted));
        root.querySelectorAll(`[data-s="${t.idx}"]`).forEach((b) => b.classList.toggle("on", t.soloed));
        root.querySelectorAll(`[data-v="${t.idx}"]`).forEach((i) => { if (document.activeElement !== i) i.value = t.volume; });
        root.querySelectorAll(`[data-p="${t.idx}"]`).forEach((i) => { if (document.activeElement !== i) i.value = t.pan; });
        const db = root.querySelector(`[data-db="${t.idx}"]`); if (db) db.textContent = dbLabel(t.volume) + " dB";
        const pl = root.querySelector(`[data-pl="${t.idx}"]`); if (pl) pl.textContent = Math.abs(t.pan) < 0.01 ? "C" : `${Math.round(Math.abs(t.pan) * 100)}${t.pan < 0 ? "L" : "R"}`;
        root.querySelector(`.trk[data-ti="${t.idx}"]`)?.classList.toggle("silent", !engine.audible(t));
      }
      const custom = engine.isCustom();
      const tagEl = root.querySelector("#mixtag"); tagEl.textContent = custom ? "Mix pessoal" : "Mix do projeto"; tagEl.className = `tag ${custom ? "soft" : "gray"}`;
      root.querySelector("#mixreset").style.opacity = custom ? 1 : 0.35;
    }
    const saveMix = () => {
      clearTimeout(saveT);
      saveT = setTimeout(async () => {
        if (engine.isCustom()) await sb.from("mix_presets").upsert({ user_id: state.user.id, song_id: song.id, project_id: project.id, settings: engine.mixState(), updated_at: new Date().toISOString() }, { onConflict: "user_id,song_id" });
        else await sb.from("mix_presets").delete().eq("user_id", state.user.id).eq("song_id", song.id);
      }, 700);
    };
    const T = (idx) => engine.tracks.find((t) => t.idx === Number(idx));
    root.addEventListener("input", (e) => {
      const d = e.target.dataset;
      if (d.v) engine.setTrack(T(d.v), { volume: Number(e.target.value) });
      else if (d.p) engine.setTrack(T(d.p), { pan: Number(e.target.value) });
      else if (e.target.id === "mvol" || e.target.id === "mvol2") { engine.setMaster(Number(e.target.value)); root.querySelectorAll("#mvol,#mvol2").forEach((x) => x !== e.target && (x.value = e.target.value)); root.querySelector("#mdb").textContent = dbLabel(engine.master.user); const d2 = root.querySelector("#mdb2"); if (d2) d2.textContent = dbLabel(engine.master.user * engine.master.volume); }
      else return;
      syncControls(); saveMix();
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.m) { const t = T(b.dataset.m); engine.setTrack(t, { muted: !t.muted }); syncControls(); saveMix(); }
      if (b.dataset.s) { const t = T(b.dataset.s); engine.setTrack(t, { soloed: !t.soloed }); syncControls(); saveMix(); }
      if (b.id === "mmute") { engine.master.muted = !engine.master.muted; engine.updateGains(); b.classList.toggle("on", engine.master.muted); syncControls(); saveMix(); }
      if (b.id === "mixreset") { if (!engine.isCustom()) return; engine.resetMix(); root.querySelectorAll("#mvol,#mvol2").forEach((x) => (x.value = 1)); syncControls(); saveMix(); toast("Mixagem do projeto restaurada"); }
    });
    // dois toques no fader volta ao valor do projeto
    root.addEventListener("dblclick", (e) => { const d = e.target.dataset; if (d.v) { const t = T(d.v); engine.setTrack(t, { volume: t.orig.volume }); } else if (d.p) { const t = T(d.p); engine.setTrack(t, { pan: t.orig.pan }); } else return; syncControls(); saveMix(); });

    // ---------- formas de onda
    const drawWave = (t) => {
      const box = root.querySelector(`[data-w="${t.idx}"]`); if (!box) return;
      const cv = box.querySelector("canvas"); const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, box.clientWidth * dpr), h = Math.max(1, box.clientHeight * dpr);
      if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
      const g = cv.getContext("2d"); g.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim() || "30,167,255";
      const items = t.kind === "folder" ? engine.descendants(t).flatMap((c) => c.items) : t.items;
      const R = Engine.PEAK_RATE;
      for (const it of items) {
        const pk = engine.peaksFor(it.fileId);
        const x0 = (it.position / L) * w, x1 = ((it.position + it.length) / L) * w;
        g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(x0, 0, x1 - x0, h);
        if (!pk) continue;
        g.fillStyle = `rgba(${tcol(t)?.join(",") || accent},.9)`;
        for (let x = Math.floor(x0); x < x1; x++) {
          const ts = (x / w) * L - it.position + it.offset, te = ((x + 1) / w) * L - it.position + it.offset;
          let mn = 1, mx = -1, any = false;
          for (let k = Math.floor(ts * R); k <= Math.floor(te * R); k++) { const a = pk[k * 2], b = pk[k * 2 + 1]; if (a === undefined || Number.isNaN(a)) continue; any = true; if (a < mn) mn = a; if (b > mx) mx = b; }
          if (!any) continue;
          const v = (it.volume ?? 1);
          const y1 = h / 2 - Math.min(1, mx * v) * (h / 2 - 1), y2 = h / 2 - Math.max(-1, mn * v) * (h / 2 - 1);
          g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
        }
      }
    };
    const drawAllWaves = () => { if (tab === "faixas") audioTracks.forEach(drawWave); };
    let waveT = 0;
    engine.addEventListener("peaks", () => { if (waveT) return; waveT = setTimeout(() => { waveT = 0; drawAllWaves(); }, 350); });
    const ro = new ResizeObserver(() => drawAllWaves()); ro.observe(root);

    // ---------- linha do tempo e transporte
    const tl = root.querySelector("#tl");
    const seekFromEvent = (e) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * L; };
    let dragging = false;
    tl.addEventListener("pointerdown", (e) => {
      const rg = e.target.closest("[data-rg]");
      if (rg) { const r = regions.find((x) => x.id === rg.dataset.rg); engine.setLoop(engine.loop && engine.loop[0] === r.position ? null : [r.position, r.end_position]); engine.seek(r.position); return; }
      dragging = true; tl.setPointerCapture(e.pointerId); engine.seek(seekFromEvent(e));
    });
    tl.addEventListener("pointerup", (e) => { if (dragging) { dragging = false; engine.seek(seekFromEvent(e)); } });
    body.addEventListener("click", (e) => { const w = e.target.closest(".wave"); if (!w) return; const r = w.getBoundingClientRect(); engine.seek(((e.clientX - r.left) / r.width) * L); });
    const starts = () => [...engine.markers.map((m) => m.position), 0].sort((a, b) => a - b);
    root.querySelector(".transport").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      const p = engine.position();
      switch (b.dataset.t) {
        case "play": engine.playing || engine.buffering ? engine.pause() : engine.play(); break;
        case "stop": engine.stop(); break;
        case "rew": engine.seek(p - 5); break;
        case "fwd": engine.seek(p + 5); break;
        case "prev": { const s = starts().filter((x) => x < p - 0.8); engine.seek(s.length ? s[s.length - 1] : 0); break; }
        case "next": { const s = starts().find((x) => x > p + 0.05); if (s != null) engine.seek(s); break; }
        case "rep": if (engine.loop) engine.setLoop(null); else engine.repeat = !engine.repeat; updateState(); break;
      }
    });
    const keys = (e) => { if (e.target.matches("input,textarea")) return; if (e.code === "Space") { e.preventDefault(); engine.playing ? engine.pause() : engine.play(); } if (e.key === "Escape") close(); };
    document.addEventListener("keydown", keys);
    const origDestroy = ctrl.destroy; ctrl.destroy = () => { document.removeEventListener("keydown", keys); ro.disconnect(); origDestroy(); };

    const updateState = () => {
      const pp = root.querySelector('[data-t="play"]');
      pp.innerHTML = icon(engine.playing ? "pause" : "play");
      pp.setAttribute("aria-label", engine.playing ? "Pausar" : "Tocar");
      root.querySelector('[data-t="rep"]').classList.toggle("on", engine.repeat || !!engine.loop);
      root.querySelector("#buf").classList.toggle("hidden", !engine.buffering);
      root.querySelectorAll("[data-rg]").forEach((x) => { const r = regions.find((y) => y.id === x.dataset.rg); x.classList.toggle("on", !!engine.loop && engine.loop[0] === r.position); });
      const ly = root.querySelector("#lyr"); if (ly) ly.classList.toggle("playing", engine.playing && lyr.some((b) => b.start != null));
    };
    engine.addEventListener("state", updateState);
    engine.addEventListener("loading", (e) => { root.querySelector("#lb").style.width = `${Math.round(e.detail.progress * 100)}%`; });
    engine.addEventListener("error", (e) => toast(e.detail.message, "err"));
    engine.addEventListener("background", (e) => { root.querySelector("#lb").style.width = `${Math.round(e.detail.progress * 100)}%`; if (e.detail.progress >= 1) setTimeout(() => (root.querySelector(".loadbar").style.opacity = 0), 600); });

    // ---------- letra
    let markMode = false, markIdx = 0;
    function bindLyrics() {
      root.querySelector("#markmode")?.addEventListener("click", (e) => {
        markMode = !markMode; markIdx = 0; e.currentTarget.classList.toggle("on", markMode);
        toast(markMode ? "Toque em cada bloco no momento em que ele começa. Toque de novo em 'Marcar tempos' para salvar." : "Salvando tempos…");
        if (!markMode) saveLyrics();
        else if (!engine.playing) engine.play();
      });
      root.querySelector("#lyr")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-bi]"); if (!b) return;
        const i = Number(b.dataset.bi);
        if (markMode) { lyr[i].start = Math.round(engine.position() * 100) / 100; b.querySelector(".tm")?.remove(); b.insertAdjacentHTML("beforeend", `<span class="tm">${fmt(lyr[i].start)}</span>`); markIdx = i + 1; return; }
        if (lyr[i].start != null) engine.seek(lyr[i].start);
      });
    }
    async function saveLyrics() {
      const r = await sb.from("songs").update({ lyrics: { ...(song.lyrics || {}), blocks: lyr, synced: lyr.some((b) => b.start != null) } }).eq("id", song.id);
      if (r.error) toast(errMsg(r.error), "err"); else toast("Tempos da letra salvos");
    }
    // cartões das partes: toque leva o cursor para o início da parte e toca a partir dali
    root.querySelector("#parts")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-part]"); if (!b) return;
      const x = parts.find((y) => String(y.id) === b.dataset.part); if (!x) return;
      if (engine.loop && !(engine.loop[0] === x.start)) engine.setLoop(null);
      engine.seek(x.start);
      if (!engine.playing) engine.play();
    });
    let lastPart = null;
    let lastBlock = -1;
    const lyricsAt = (p) => { let k = -1; lyr.forEach((b, i) => { if (b.start != null && b.start <= p + 0.05) k = i; }); return k; };

    // ---------- quadro a quadro
    const loop = () => {
      const p = engine.position();
      const pct = (p / L) * 100;
      root.querySelector("#prog").style.width = pct + "%";
      root.querySelector("#head").style.left = pct + "%";
      root.querySelector("#tcur").textContent = fmt(p);
      const cur = [...engine.markers].reverse().find((m) => m.position <= p + 0.01);
      root.querySelector("#tmark").textContent = cur ? cur.name : "";
      root.querySelectorAll(".ph-line").forEach((l) => (l.style.left = pct + "%"));
      const pc = parts.find((x) => p >= x.start - 0.01 && p < x.end - 0.01);
      if ((pc?.id ?? null) !== lastPart) {
        lastPart = pc?.id ?? null;
        root.querySelectorAll("[data-part]").forEach((b) => b.classList.toggle("on", b.dataset.part === String(lastPart)));
        const el = lastPart != null && root.querySelector(`[data-part="${lastPart}"]`);
        if (el && engine.playing) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
      if (tab === "mix" && engine.playing) {
        const lv = engine.levels();
        engine.tracks.forEach((t, i) => { const el = root.querySelector(`[data-lv="${t.idx}"]`); if (el) el.style.height = Math.min(100, lv.tracks[i] * 100) + "%"; });
        const ml = root.querySelector("#mlv"); if (ml) ml.style.height = Math.min(100, lv.master * 100) + "%";
      }
      if (tab === "letra" && lyr.length) {
        const k = lyricsAt(p);
        if (k !== lastBlock) {
          lastBlock = k;
          root.querySelectorAll("[data-bi]").forEach((b) => b.classList.toggle("on", Number(b.dataset.bi) === k));
          if (k >= 0 && engine.playing) root.querySelector(`[data-bi="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    drawTab(); updateState(); loop();
    // carregamento inicial (primeiros segundos) e o restante em segundo plano
    engine.preload(0, 1, (p) => { root.querySelector("#lb").style.width = `${Math.round(p * 100)}%`; }).then(() => engine.background()).catch((e) => toast(errMsg(e), "err"));
  }
}
