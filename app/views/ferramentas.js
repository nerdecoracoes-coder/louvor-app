// Ferramentas do estúdio: editor de imagem, vídeos prontos (abertura, encerramento, contagem) e legendas (.srt).
// Tudo roda no navegador do voluntário; nada é enviado a servidor, exceto quando ele salva uma imagem nos Fundos.
import { sb, state, must, esc, attr, icon, sheet, toast, errMsg, busy, on, empty, spinner, teamHas, pickFile } from "../core.js";
import { ratioOf } from "../lib/pptx.js";
import { FONTS } from "./letras.js";

export function register(route) {
  route("/times/:id/estudio/imagem", (p, el, a) => imageEditor(p.id, el, a));
  route("/times/:id/estudio/video", (p, el, a) => videos(p.id, el, a));
  route("/times/:id/estudio/legendas", (p, el, a) => captions(p.id, el, a));
}

const teamOf = async (id) => state.orgTeams.find((t) => t.id === id) || (await must(sb.from("teams").select("*").eq("id", id).maybeSingle()));
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "arquivo";
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
// carrega imagem sem "contaminar" o canvas (precisa de CORS; o armazenamento do Supabase libera)
async function loadBitmap(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src, { mode: "cors" })).blob();
  return createImageBitmap(blob);
}
const COLORS = ["#FFFFFF", "#FFE066", "#9BD1FF", "#000000", "#FF6B6B"];
const guard = async (team, el, alive) => {
  if (!team || !teamHas(team, "estudio")) { el.innerHTML = empty("sparkle", "Este time não usa o estúdio de mídia."); return false; }
  return alive();
};
const head = (teamId, title, extra = "") => `<div class="pagehead"><a class="back" href="#/times/${teamId}/estudio">${icon("chevronLeft")}</a><h1>${title}</h1>${extra}</div>`;
const sliderField = (id, label, min, max, step, val, unit = "") => `<label class="field"><span>${label} (<b id="${id}v">${val}</b>${unit})</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;

// ---------------------------------------------------------------- editor de imagem
// Texto e imagem sobre uma tela na proporção da projeção. Exporta PNG ou salva nos Fundos do time.
async function imageEditor(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!(await guard(team, el, alive))) return;
  const [ra, rb] = ratioOf(team.slide_ratio || "16:9"), W = 1920, H = Math.round((W * rb) / ra);
  const S = { img: null, zoom: 1, ox: 0, oy: 0, bright: 100, contrast: 100, sat: 100, blur: 0, dim: 0, bg: "#0B1F3A", texts: [{ id: uid(), text: "Título aqui", size: 120, color: "#FFFFFF", x: 50, y: 50, bold: true, shadow: true, font: "Arial" }], sel: 0 };
  el.innerHTML = `${head(teamId, "Editor de imagem")}
    <p class="muted small">Tela de ${W} × ${H}. Escolha uma foto, ajuste, escreva o texto e baixe a imagem pronta.</p>
    <canvas id="cv" width="${W}" height="${H}" class="cv"></canvas>
    <div class="row gap wrap mt"><button class="btn ghost grow" id="pick">${icon("image")} Escolher foto</button><button class="btn ghost grow" id="clr">Sem foto</button></div>
    <div class="sec"><h2>Foto</h2></div><div class="card">
      ${sliderField("zoom", "Zoom", 100, 300, 5, 100, "%")}${sliderField("ox", "Mover para os lados", -100, 100, 1, 0)}${sliderField("oy", "Mover para cima e para baixo", -100, 100, 1, 0)}
      ${sliderField("bright", "Brilho", 40, 180, 5, 100, "%")}${sliderField("contrast", "Contraste", 40, 180, 5, 100, "%")}${sliderField("sat", "Cor", 0, 200, 5, 100, "%")}
      ${sliderField("blur", "Desfoque", 0, 20, 1, 0)}${sliderField("dim", "Escurecer", 0, 80, 5, 0, "%")}
      <div class="field"><span>Cor de fundo (sem foto)</span><input type="color" id="bgc" value="${S.bg}"></div></div>
    <div class="sec"><h2>Textos</h2><button class="more" id="addt">${icon("plus")} Texto</button></div>
    <div id="tl"></div>
    <div class="row gap mt wrap"><button class="btn primary grow" id="png">${icon("download")} Baixar PNG</button><button class="btn ghost grow" id="tofundo">${icon("image")} Salvar nos Fundos</button></div>`;
  const cv = el.querySelector("#cv"), ctx = cv.getContext("2d");
  const draw = () => {
    ctx.save(); ctx.clearRect(0, 0, W, H); ctx.fillStyle = S.bg; ctx.fillRect(0, 0, W, H);
    if (S.img) {
      ctx.filter = `brightness(${S.bright}%) contrast(${S.contrast}%) saturate(${S.sat}%) blur(${S.blur}px)`;
      const k = Math.max(W / S.img.width, H / S.img.height) * S.zoom, w = S.img.width * k, h = S.img.height * k;
      ctx.drawImage(S.img, (W - w) / 2 + (S.ox / 100) * (w - W) / 2, (H - h) / 2 + (S.oy / 100) * (h - H) / 2, w, h); ctx.filter = "none";
    }
    if (S.dim) { ctx.fillStyle = `rgba(0,0,0,${S.dim / 100})`; ctx.fillRect(0, 0, W, H); }
    for (const t of S.texts) {
      ctx.font = `${t.bold ? "700" : "400"} ${t.size}px "${t.font}", sans-serif`; ctx.fillStyle = t.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (t.shadow) { ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = t.size / 8; ctx.shadowOffsetY = t.size / 20; } else ctx.shadowColor = "transparent";
      const lines = String(t.text || "").split("\n"), lh = t.size * 1.15, y0 = (t.y / 100) * H - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => ctx.fillText(l, (t.x / 100) * W, y0 + i * lh, W * 0.94));
    }
    ctx.restore();
  };
  const tlist = () => {
    el.querySelector("#tl").innerHTML = S.texts.map((t, i) => `<div class="card tcard"><label class="field"><span>Texto ${i + 1}</span><textarea data-i="${i}" data-k="text" rows="2">${esc(t.text)}</textarea></label>
      <div class="two"><label class="field"><span>Fonte</span><select data-i="${i}" data-k="font">${FONTS.map((f) => `<option ${t.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label class="field"><span>Tamanho (${t.size})</span><input type="range" data-i="${i}" data-k="size" min="30" max="300" step="5" value="${t.size}"></label></div>
      <div class="two"><label class="field"><span>Posição: lados (${t.x})</span><input type="range" data-i="${i}" data-k="x" min="0" max="100" value="${t.x}"></label>
      <label class="field"><span>Posição: altura (${t.y})</span><input type="range" data-i="${i}" data-k="y" min="0" max="100" value="${t.y}"></label></div>
      <div class="row gap wrap"><div class="swatches">${COLORS.map((c) => `<button type="button" class="sw${t.color === c ? " on" : ""}" data-i="${i}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
      <label class="check" style="padding:0"><input type="checkbox" data-i="${i}" data-k="bold" ${t.bold ? "checked" : ""}> Negrito</label>
      <label class="check" style="padding:0"><input type="checkbox" data-i="${i}" data-k="shadow" ${t.shadow ? "checked" : ""}> Sombra</label>
      <button class="btn ghost sm danger" data-rm="${i}">${icon("trash")}</button></div></div>`).join("");
  };
  tlist(); draw();
  for (const k of ["zoom", "ox", "oy", "bright", "contrast", "sat", "blur", "dim"]) el.querySelector("#" + k).addEventListener("input", (e) => { S[k] = +e.target.value; el.querySelector(`#${k}v`).textContent = e.target.value; draw(); });
  el.querySelector("#bgc").oninput = (e) => { S.bg = e.target.value; draw(); };
  el.querySelector("#addt").onclick = () => { S.texts.push({ id: uid(), text: "Novo texto", size: 70, color: "#FFFFFF", x: 50, y: 75, bold: true, shadow: true, font: "Arial" }); tlist(); draw(); };
  const upd = (e) => {
    const t = e.target, i = t.dataset.i; if (i === undefined || t.dataset.k === undefined) return;
    const k = t.dataset.k, v = t.type === "checkbox" ? t.checked : t.type === "range" ? +t.value : t.value;
    S.texts[+i][k] = v; draw(); if (t.type === "range") t.closest("label").querySelector("span").textContent = t.closest("label").querySelector("span").textContent.replace(/\(.*\)/, `(${v})`);
  };
  el.addEventListener("input", upd); el.addEventListener("change", upd);
  on(el, "click", "[data-c]", (e, b) => { S.texts[+b.dataset.i].color = b.dataset.c; tlist(); draw(); });
  on(el, "click", "[data-rm]", (e, b) => { S.texts.splice(+b.dataset.rm, 1); tlist(); draw(); });
  el.querySelector("#pick").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { S.img = await loadBitmap(f); S.zoom = 1; draw(); } catch { toast("Não foi possível abrir esta imagem.", "err"); } };
  el.querySelector("#clr").onclick = () => { S.img = null; draw(); };
  const blob = () => new Promise((r) => cv.toBlob(r, "image/png"));
  el.querySelector("#png").onclick = async () => { saveBlob(await blob(), `${slug(S.texts[0]?.text || "imagem")}.png`); toast("Imagem pronta"); };
  el.querySelector("#tofundo").onclick = async (e) => {
    busy(e.currentTarget);
    try {
      const b = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9)), path = `studio/${team.org_id}/${team.id}/${Date.now()}-${uid()}.jpg`;
      const up = await sb.storage.from("media").upload(path, b, { upsert: false }); if (up.error) throw up.error;
      await must(sb.from("studio_assets").insert({ team_id: team.id, org_id: team.org_id, name: (S.texts[0]?.text || "Imagem").slice(0, 100), kind: "imagem", path, url: sb.storage.from("media").publicUrl(path), created_by: state.user.id }));
      toast("Salva nos Fundos");
    } catch (err) { toast(errMsg(err), "err"); }
    busy(e.currentTarget, false);
  };
}

// ---------------------------------------------------------------- vídeos prontos
// Gera o vídeo no próprio navegador (grava uma tela animada). Abertura e encerramento levam poucos segundos;
// a contagem regressiva dura o tempo real da contagem, porque o navegador grava ao vivo.
const mimeFor = () => ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => window.MediaRecorder?.isTypeSupported?.(m));

async function videos(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!(await guard(team, el, alive))) return;
  const [ra, rb] = ratioOf(team.slide_ratio || "16:9"), W = 1280, H = Math.round((W * rb) / ra);
  const assets = (await sb.from("studio_assets").select("name,url").eq("team_id", teamId).order("created_at", { ascending: false })).data || [];
  const V = { kind: "abertura", title: team.name ? "Bem-vindos" : "Bem-vindos", sub: state.org?.name || "", min: 5, bg: "#0B1F3A", bgUrl: "", color: "#FFFFFF", secs: 8 };
  const supported = !!mimeFor() && !!HTMLCanvasElement.prototype.captureStream;
  el.innerHTML = `${head(teamId, "Vídeos prontos")}
    <p class="muted small">Escolha o tipo, ajuste o texto e o fundo e gere o vídeo. Ele é criado aqui no seu aparelho e baixado para você importar no programa de projeção.</p>
    ${supported ? "" : `<div class="card small">Este navegador não consegue gravar vídeo. Abra o Somos no Chrome do computador ou do celular.</div>`}
    <canvas id="cv" width="${W}" height="${H}" class="cv"></canvas>
    <div class="card mt">
      <label class="field"><span>Tipo</span><select id="kind"><option value="abertura">Abertura (título e logotipo)</option><option value="encerramento">Encerramento</option><option value="contagem">Contagem regressiva</option></select></label>
      <label class="field"><span>Título</span><input id="title" value="${attr(V.title)}" maxlength="80"></label>
      <label class="field"><span>Linha de baixo</span><input id="sub" value="${attr(V.sub)}" maxlength="100"></label>
      <div id="dur"></div>
      <div class="field"><span>Fundo</span><div class="swatches"><label class="sw custom" title="Cor"><input type="color" id="bg" value="${V.bg}">${icon("plus")}</label></div>
        ${assets.length ? `<div class="bgpick">${assets.map((a) => `<button type="button" class="bgp" data-bga="${attr(a.url)}"><img src="${attr(a.url)}" alt="${attr(a.name)}"></button>`).join("")}</div>` : ""}</div>
      <label class="check"><input type="checkbox" id="logo" ${team.logo_url || state.org?.logo_url ? "checked" : "disabled"}> Mostrar o logotipo</label>
    </div>
    <button class="btn primary block mt" id="gen" ${supported ? "" : "disabled"}>${icon("play")} Gerar vídeo</button><div id="prog" class="small muted mt-s"></div>`;
  const cv = el.querySelector("#cv"), ctx = cv.getContext("2d");
  let bgImg = null, logoImg = null;
  const logoUrl = team.logo_url || state.org?.logo_url;
  if (logoUrl) loadBitmap(logoUrl).then((b) => { logoImg = b; render(0.8); }).catch(() => {});
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  // t = segundos decorridos; total = duração
  function render(t, total = V.secs) {
    ctx.save(); ctx.clearRect(0, 0, W, H); ctx.fillStyle = V.bg; ctx.fillRect(0, 0, W, H);
    if (bgImg) { const k = Math.max(W / bgImg.width, H / bgImg.height), w = bgImg.width * k, h = bgImg.height * k; ctx.drawImage(bgImg, (W - w) / 2, (H - h) / 2, w, h); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(0, 0, W, H); }
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3), a = ease(t / 1.2), out = total - t < 0.8 ? Math.max(0, (total - t) / 0.8) : 1;
    ctx.globalAlpha = a * out; ctx.fillStyle = V.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lg = el.querySelector("#logo")?.checked && logoImg, ly = lg ? H * 0.34 : H * 0.42;
    if (lg) { const s = Math.min(H * 0.26 / logoImg.height, W * 0.3 / logoImg.width); ctx.drawImage(logoImg, W / 2 - (logoImg.width * s) / 2, H * 0.1 + (1 - a) * 20, logoImg.width * s, logoImg.height * s); }
    if (V.kind === "contagem") {
      ctx.font = `700 ${H * 0.07}px Arial, sans-serif`; ctx.fillText(V.title, W / 2, H * (lg ? 0.46 : 0.28), W * 0.9);
      ctx.font = `700 ${H * 0.34}px Arial, sans-serif`; ctx.fillText(mmss(Math.max(0, total - t)), W / 2, H * (lg ? 0.68 : 0.55));
      ctx.font = `400 ${H * 0.05}px Arial, sans-serif`; ctx.globalAlpha *= 0.8; ctx.fillText(V.sub, W / 2, H * 0.9, W * 0.9);
    } else {
      ctx.font = `700 ${H * 0.12}px Arial, sans-serif`; ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 18; ctx.fillText(V.title, W / 2, H * (lg ? 0.64 : 0.46) + (1 - a) * 30, W * 0.9);
      ctx.font = `400 ${H * 0.055}px Arial, sans-serif`; ctx.globalAlpha = a * out * 0.85; ctx.fillText(V.sub, W / 2, H * (lg ? 0.78 : 0.62) + (1 - a) * 30, W * 0.9);
    }
    ctx.restore();
  }
  const durUi = () => {
    el.querySelector("#dur").innerHTML = V.kind === "contagem" ? `<label class="field"><span>Duração da contagem (<b id="mv">${V.min}</b> min)</span><input type="range" id="min" min="1" max="15" value="${V.min}"></label><p class="tiny muted">A contagem é gravada ao vivo: ${V.min} min de contagem levam ${V.min} min para gerar. Mantenha esta tela aberta.</p>`
      : `<label class="field"><span>Duração (<b id="sv">${V.secs}</b> s)</span><input type="range" id="secs" min="4" max="20" value="${V.secs}"></label>`;
    el.querySelector("#min")?.addEventListener("input", (e) => { V.min = +e.target.value; durUi(); render(1.5, V.min * 60); });
    el.querySelector("#secs")?.addEventListener("input", (e) => { V.secs = +e.target.value; el.querySelector("#sv").textContent = e.target.value; });
  };
  const preview = () => render(V.kind === "contagem" ? 1.5 : 1.8, V.kind === "contagem" ? V.min * 60 : V.secs);
  el.querySelector("#kind").onchange = (e) => {
    V.kind = e.target.value; const d = { abertura: ["Bem-vindos", state.org?.name || ""], encerramento: ["Obrigado por estar conosco", "Deus abençoe você"], contagem: ["O culto começa em", state.org?.name || ""] }[V.kind];
    V.title = d[0]; V.sub = d[1]; el.querySelector("#title").value = d[0]; el.querySelector("#sub").value = d[1]; durUi(); preview();
  };
  el.querySelector("#title").oninput = (e) => { V.title = e.target.value; preview(); };
  el.querySelector("#sub").oninput = (e) => { V.sub = e.target.value; preview(); };
  el.querySelector("#bg").oninput = (e) => { V.bg = e.target.value; bgImg = null; preview(); };
  el.querySelector("#logo").onchange = preview;
  on(el, "click", "[data-bga]", async (e, b) => { try { bgImg = await loadBitmap(b.dataset.bga); preview(); } catch { toast("Não foi possível abrir esta imagem.", "err"); } });
  durUi(); preview();

  el.querySelector("#gen").onclick = async (e) => {
    const btn = e.currentTarget, total = V.kind === "contagem" ? V.min * 60 : V.secs, mime = mimeFor(), prog = el.querySelector("#prog");
    busy(btn);
    let lock = null; try { lock = await navigator.wakeLock?.request("screen"); } catch { /* opcional */ }
    const stream = cv.captureStream(30), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = (x) => x.data.size && chunks.push(x.data);
    const done = new Promise((r) => (rec.onstop = r));
    const t0 = performance.now(); rec.start(500);
    await new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000; render(t, total); prog.textContent = `Gravando… ${mmss(t)} de ${mmss(total)}`;
        if (t >= total) return res(); setTimeout(tick, 1000 / 30);
      }; tick();
    });
    rec.stop(); await done; try { lock?.release(); } catch { /* ok */ }
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    saveBlob(new Blob(chunks, { type: mime.split(";")[0] }), `${slug(V.kind + "-" + V.title)}.${ext}`);
    prog.textContent = ext === "webm" ? "Pronto. Este navegador gera .webm; se o programa não abrir, converta para .mp4 ou use o Chrome." : "Pronto. O vídeo foi baixado.";
    busy(btn, false); preview();
  };
}

// ---------------------------------------------------------------- legendas
// Sincroniza as linhas de um texto com um vídeo gravado, tocando nos tempos certos, e gera o .srt
async function captions(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!(await guard(team, el, alive))) return;
  const L = { lines: [], idx: 0, video: null };
  const stamp = (t) => { const ms = Math.round(t * 1000), p = (n, l = 2) => String(n).padStart(l, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  const short = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t * 10) % 10)}`;
  el.innerHTML = `${head(teamId, "Legendas")}
    <p class="muted small">1) Escolha o vídeo. 2) Cole o texto (uma frase por linha). 3) Toque o vídeo e aperte <b>Marcar</b> no momento em que cada frase começa. 4) Baixe o arquivo .srt para importar no editor de vídeo.</p>
    <div class="row gap wrap"><button class="btn ghost grow" id="vf">${icon("play")} Escolher vídeo</button></div>
    <video id="vid" class="cv" controls playsinline hidden></video>
    <label class="field mt"><span>Texto da legenda</span><textarea id="txt" rows="6" placeholder="Uma frase por linha"></textarea></label>
    <button class="btn ghost block" id="build">Montar lista de frases</button>
    <div id="ed" class="mt"></div>`;
  const vid = el.querySelector("#vid"), ed = el.querySelector("#ed");
  const paint = () => {
    if (!L.lines.length) { ed.innerHTML = ""; return; }
    const cur = L.lines[L.idx];
    ed.innerHTML = `<div class="card"><p class="small muted" style="margin:0 0 6px">Próxima frase (${Math.min(L.idx + 1, L.lines.length)} de ${L.lines.length})</p>
      <p style="font-size:20px;font-weight:700;margin:0 0 12px;min-height:54px">${cur ? esc(cur.text) : "Todas as frases foram marcadas."}</p>
      <div class="row gap wrap"><button class="btn primary grow" id="mark" ${cur ? "" : "disabled"}>Marcar agora</button><button class="btn ghost" id="back" ${L.idx ? "" : "disabled"}>Voltar uma</button></div></div>
      <div class="list mt">${L.lines.map((l, i) => `<div class="li"><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(l.text)}</span><span class="s">${l.t == null ? "sem marca" : short(l.t)}</span></span>
        ${l.t != null ? `<button class="btn ghost sm" data-seek="${i}">${icon("play")}</button><button class="btn ghost sm" data-nudge="${i}:-0.2">−0,2</button><button class="btn ghost sm" data-nudge="${i}:0.2">+0,2</button>` : ""}</div>`).join("")}</div>
      <div class="row gap mt wrap"><button class="btn primary grow" id="srt">${icon("download")} Baixar .srt</button><button class="btn ghost grow" id="vtt">.vtt</button></div>`;
  };
  el.querySelector("#vf").onclick = async () => { const f = await pickFile("video/*"); if (!f) return; if (L.video) URL.revokeObjectURL(L.video); L.video = URL.createObjectURL(f); vid.src = L.video; vid.hidden = false; };
  el.querySelector("#build").onclick = () => { L.lines = el.querySelector("#txt").value.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, t: null })); L.idx = 0; paint(); };
  on(el, "click", "#mark", () => { if (!L.lines[L.idx]) return; L.lines[L.idx].t = vid.hidden ? 0 : vid.currentTime; L.idx++; paint(); });
  on(el, "click", "#back", () => { L.idx = Math.max(0, L.idx - 1); L.lines[L.idx].t = null; paint(); });
  on(el, "click", "[data-seek]", (e, b) => { vid.currentTime = Math.max(0, L.lines[+b.dataset.seek].t - 0.3); vid.play(); });
  on(el, "click", "[data-nudge]", (e, b) => { const [i, d] = b.dataset.nudge.split(":"); L.lines[+i].t = Math.max(0, L.lines[+i].t + +d); paint(); });
  const out = (vtt) => {
    const done = L.lines.filter((l) => l.t != null);
    if (!done.length) { toast("Marque ao menos uma frase.", "err"); return; }
    const cues = done.map((l, i) => { const end = done[i + 1]?.t ?? Math.min(l.t + 4, vid.duration || l.t + 4); return { s: l.t, e: Math.max(end - 0.05, l.t + 0.5), text: l.text }; });
    const f = (t) => (vtt ? stamp(t).replace(",", ".") : stamp(t));
    const body = cues.map((c, i) => `${vtt ? "" : i + 1 + "\n"}${f(c.s)} --> ${f(c.e)}\n${c.text}\n`).join("\n");
    saveBlob(new Blob([(vtt ? "WEBVTT\n\n" : "") + body], { type: "text/plain;charset=utf-8" }), `legenda.${vtt ? "vtt" : "srt"}`); toast("Legenda pronta");
  };
  on(el, "click", "#srt", () => out(false)); on(el, "click", "#vtt", () => out(true));
}
