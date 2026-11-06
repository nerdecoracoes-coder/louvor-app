// Letras para a mídia: as letras do repertório divididas em partes (Verso 1, Refrão...), com estilo
// próprio do time e exportação para PowerPoint e texto. Serve ao Louvor e à Multimídia.
import { sb, state, must, esc, attr, icon, sheet, toast, errMsg, busy, on, empty, spinner, teamHas, canManageTeam, confirmDialog } from "../core.js";
import { parseLyricsText, lyricsToText } from "./songs.js";
import { buildPptx, zipStore, RATIOS, ratioOf } from "../lib/pptx.js";
import { fDate, fTime } from "../core.js";
import { letraBoxes, titleBoxes, thumbOf, layoutOf, DEFAULT_LAYOUT } from "../lib/slidelayout.js";

export function register(route) {
  route("/times/:id/letras", (p, el, a) => library(p.id, el, a));
  route("/times/:id/letras/modelo", (p, el, a) => layoutPage(p.id, el, a));
  route("/times/:id/letras/:song", (p, el, a) => editor(p.id, p.song, el, a));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-05-letras.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST|function/i.test(String(e?.message || e?.code || e));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const FONTS = ["Arial", "Calibri", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Impact", "Montserrat", "Roboto", "Open Sans"];
export const DEFAULT_STYLE = { font: "Arial", size: 54, color: "#FFFFFF", bg: "#000000", per: 2, caps: false, showLabel: true };
const TEXT_COLORS = ["#FFFFFF", "#FFE066", "#9BD1FF", "#000000"], BG_COLORS = ["#000000", "#0B1F3A", "#1B1B1B", "#12301F", "#FFFFFF"];
// slides do PowerPoint com o padrão de tela da igreja
const pptxSlides = (title, artist, sl, st, footer) => [{ boxes: titleBoxes(title, artist, st), bg: st.bg, color: st.color }, ...sl.map((x) => ({ boxes: letraBoxes({ ...x, footer }, st), bg: st.bg, color: st.color }))];
const aspect = (r) => ratioOf(r).join(" / ");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "musica";

export function slidesOf(blocks, per = 2) {
  const out = [];
  for (const b of blocks || []) {
    const lines = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += per) out.push({ label: i === 0 ? b.label || "" : "", text: lines.slice(i, i + per).join("\n") });
  }
  return out;
}
const textOf = (title, blocks) => `${title}\n\n${lyricsToText(blocks)}\n`;
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

async function getTeam(id) { return state.orgTeams.find((t) => t.id === id) || (await must(sb.from("teams").select("*").eq("id", id).maybeSingle())); }
export async function loadLibrary(teamId) {
  const r = await sb.rpc("lyrics_library", { p_team: teamId });
  if (r.error) throw r.error;
  // letras criadas pela própria mídia (se a tabela ainda não existir, só as do repertório)
  const own = await sb.from("media_lyrics").select("*").eq("team_id", teamId);
  const mine = (own.error ? [] : own.data || []).map((x) => ({ id: x.id, title: x.title, artist: x.artist, song_key: null, lyrics: { blocks: x.blocks || [] }, own: true, style: x.style }));
  return [...(r.data || []), ...mine].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

// pergunta a medida da tela em pixels (ex.: 1920 x 1080) ou a proporção (ex.: 21:9)
function askRatio() {
  return new Promise((res) => {
    let done = false;
    const s = sheet(`<h3>Medida da tela</h3><p class="small muted">Digite a resolução da tela ou do telão (ex.: <b>1920x1080</b>, <b>1280x800</b>) ou a proporção (ex.: <b>21:9</b>).</p>
      <label class="field"><span>Medida</span><input id="rv" placeholder="1920x1080" inputmode="text" autocomplete="off"></label>
      <button class="btn primary block" id="rok">Usar esta medida</button>`, { onClose: () => { if (!done) res(null); } });
    s.el.querySelector("#rok").onclick = () => {
      const v = s.el.querySelector("#rv").value.trim().replace(/\s+/g, "");
      if (!/^\d{1,5}[x:×]\d{1,5}$/i.test(v)) return toast("Use o formato 1920x1080 ou 21:9", "err");
      const [a, b] = ratioOf(v); if (a / b > 6 || a / b < 0.5) return toast("Proporção fora do comum. Confira os números.", "err");
      done = true; res(v.replace("×", "x")); s.close();
    };
  });
}

// ---------------------------------------------------------------- lista
async function library(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "letras")) { el.innerHTML = empty("lyrics", "Este time não usa letras para a mídia."); return; }
  let songs = [], mine = new Set();
  try {
    songs = await loadLibrary(teamId);
    mine = new Set((await must(sb.from("lyric_slides").select("song_id").eq("team_id", teamId))).map((x) => x.song_id));
  } catch (e) { el.innerHTML = missing(e) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(e)); return; }
  if (!alive()) return;
  let q = "";
  const draw = () => {
    const list = songs.filter((s) => !q || norm(s.title + " " + (s.artist || "")).includes(norm(q)));
    el.querySelector("#ll").innerHTML = list.map((s) => `<a class="li" href="#/times/${teamId}/letras/${s.id}"><span class="cover">${icon("lyrics")}</span>
      <span class="grow" style="min-width:0"><span class="t ellipsis">${esc(s.title)}</span><span class="s">${esc(s.artist || "")}${s.song_key ? ` · Tom ${esc(s.song_key)}` : ""} · ${(s.lyrics?.blocks || []).length} partes</span></span>
      ${s.own ? `<span class="tag soft">Própria</span>` : mine.has(s.id) ? `<span class="tag soft">Editada</span>` : ""}${icon("chevronRight", "chev")}</a>`).join("")
      || `<div style="padding:10px">${empty("lyrics", songs.length ? "Nenhuma música encontrada" : "Nenhuma letra cadastrada", songs.length ? "Tente outro nome." : "Quando o Louvor cadastrar a letra das músicas, elas aparecem aqui já divididas em partes.")}</div>`;
  };
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Letras</h1><button class="btn primary sm" id="newl">${icon("plus")} Nova letra</button></div>
    <p class="muted small">Letras do repertório, já divididas em partes. Ajuste fonte e cores, edite o que precisar e baixe em PowerPoint ou texto para importar no programa de projeção. A letra original do Louvor não muda.</p>
    <div class="card ratiobox"><label class="field" style="margin:0"><span>Tela da projeção</span>
      <select id="ratio" ${canManageTeam(teamId) ? "" : "disabled"}>${Object.entries(RATIOS).map(([k, v]) => `<option value="${k}" ${k === (team.slide_ratio || "16:9") ? "selected" : ""}>${v}</option>`).join("")}${RATIOS[team.slide_ratio || "16:9"] ? "" : `<option selected value="${attr(team.slide_ratio)}">${esc(team.slide_ratio)}</option>`}<option value="custom">Outra medida…</option></select></label>
      <p class="tiny muted" style="margin:8px 0 0">Cada igreja tem uma tela diferente. Todos os slides e arquivos seguem esta proporção.${canManageTeam(teamId) ? "" : " Quem coordena o time pode mudar."}</p></div>
    <a class="li" href="#/times/${teamId}/letras/modelo" style="margin-bottom:10px"><span class="cover">${icon("sliders")}</span><span class="grow"><span class="t">Padrão da letra na tela</span><span class="s">Margens, alinhamento, posição do nome da parte e do rodapé</span></span>${icon("chevronRight", "chev")}</a>
    <label class="search srch" style="display:block">${icon("search")}<input class="input" id="lq" placeholder="Procurar música"></label>
    <div class="list mt" id="ll"></div>`;
  draw();
  el.querySelector("#newl").onclick = () => {
    const sh = sheet(`<h3>Nova letra</h3><p class="small muted">Para músicas que não estão no repertório do Louvor, ou qualquer texto que a mídia precise projetar.</p>
      <label class="field"><span>Título *</span><input id="nt" maxlength="160" placeholder="Nome da música"></label>
      <label class="field"><span>Artista ou autor</span><input id="na" maxlength="160"></label>
      <label class="field"><span>Letra</span><textarea id="nl" rows="7" placeholder="[Verso 1]\nPrimeira linha...\n\n[Refrão]\n..."></textarea></label>
      <button class="btn primary block" id="nok">Criar letra</button>`, { wide: true });
    sh.el.querySelector("#nok").onclick = async (ev) => {
      const title = sh.el.querySelector("#nt").value.trim(); if (!title) return toast("Escreva o título.", "err");
      busy(ev.currentTarget);
      const bl = parseLyricsText(sh.el.querySelector("#nl").value);
      const r = await sb.from("media_lyrics").insert({ team_id: teamId, org_id: team.org_id, title, artist: sh.el.querySelector("#na").value.trim() || null, blocks: bl.length ? bl : null, created_by: state.user.id, updated_by: state.user.id }).select("id").single();
      if (r.error) { busy(ev.currentTarget, false); return toast(missing(r.error) ? "Falta rodar a atualização do banco (letras próprias)." : errMsg(r.error), "err"); }
      sh.close(); location.hash = `#/times/${teamId}/letras/${r.data.id}`;
    };
  };
  el.querySelector("#ratio")?.addEventListener("change", async (e) => {
    let v = e.target.value;
    if (v === "custom") {
      v = (await askRatio()) || (team.slide_ratio || "16:9");
      if (!v) return;
    }
    const r = await sb.from("teams").update({ slide_ratio: v }).eq("id", teamId);
    if (r.error) { toast(missing(r.error) ? "Falta rodar a atualização do banco (tela da projeção)." : errMsg(r.error), "err"); return library(teamId, el, alive); }
    team.slide_ratio = v; toast("Tela da projeção atualizada"); library(teamId, el, alive);
  });
  el.querySelector("#lq").oninput = (e) => { q = e.target.value; draw(); };
}

// ---------------------------------------------------------------- editor
async function editor(teamId, songId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "letras")) { el.innerHTML = empty("lyrics", "Este time não usa letras para a mídia."); return; }
  let song, saved;
  try {
    song = (await loadLibrary(teamId)).find((s) => s.id === songId);
    saved = await must(sb.from("lyric_slides").select("*").eq("team_id", teamId).eq("song_id", songId).maybeSingle());
    if (song?.own) saved = { blocks: song.lyrics?.blocks || [], style: song.style };
  } catch (e) { el.innerHTML = missing(e) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(e)); return; }
  if (!alive()) return;
  if (!song) { el.innerHTML = empty("lyrics", "Letra não encontrada", "A música pode ter sido removida ou ainda não tem letra."); return; }
  const original = song.lyrics?.blocks || [];
  let text = lyricsToText(saved?.blocks?.length ? saved.blocks : original);
  let st = { ...DEFAULT_STYLE, ...(saved?.style || {}), ratio: team.slide_ratio || "16:9", layout: team.slide_layout };
  const blocks = () => parseLyricsText(text);

  const swatches = (key, list) => `<div class="swatches">${list.map((c) => `<button type="button" class="sw${st[key].toLowerCase() === c.toLowerCase() ? " on" : ""}" data-sw="${key}:${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}
    <label class="sw custom" title="Outra cor"><input type="color" data-color="${key}" value="${attr(st[key])}">${icon("plus")}</label></div>`;
  const controls = () => `
    <div class="card"><div class="two">
      <label class="field"><span>Fonte</span><select id="sfont">${FONTS.map((f) => `<option ${st.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label class="field"><span>Tamanho (${st.size} pt)</span><input type="range" id="ssize" min="28" max="90" step="2" value="${st.size}"></label></div>
      <p class="tiny muted" style="margin:-4px 0 10px">A fonte precisa estar instalada no computador onde o arquivo for aberto.</p>
      <div class="field"><span>Cor da letra</span>${swatches("color", TEXT_COLORS)}</div>
      <div class="field"><span>Cor do fundo</span>${swatches("bg", BG_COLORS)}</div>
      <div class="two"><label class="field"><span>Linhas por slide</span><select id="sper">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${st.per === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <div class="field"><span>Opções</span><div class="row gap-s" style="flex-wrap:wrap"><button type="button" class="chip ${st.caps ? "on" : ""}" id="scaps">CAIXA ALTA</button><button type="button" class="chip ${st.showLabel ? "on" : ""}" id="slabel">Nome da parte</button><button type="button" class="chip ${st.showFooter ? "on" : ""}" id="sfooter">MÚSICA NO RODAPÉ</button></div></div></div></div>`;
  const preview = () => {
    const sl = slidesOf(blocks(), st.per);
    return sl.length ? `<div class="thumbs">${sl.map((x) => thumbOf(letraBoxes({ ...x, footer: st.showFooter ? [song.title, song.artist].filter(Boolean).join(" · ") : "" }, st), { bg: st.bg, color: st.color, font: st.font, ratio: st.ratio })).join("")}</div>`
      : `<div class="card small muted">Escreva a letra acima para ver os slides.</div>`;
  };
  const draw = () => {
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/letras">${icon("chevronLeft")}</a><div class="grow">${song.own ? `<input class="input" id="otitle" value="${attr(song.title)}" maxlength="160" aria-label="Título" style="font-size:20px;font-weight:700"><input class="input" id="oartist" value="${attr(song.artist || "")}" maxlength="160" placeholder="Artista ou autor" aria-label="Artista" style="margin-top:6px">` : `<h1 style="font-size:22px">${esc(song.title)}</h1>`}<span class="small muted">${esc(song.artist || "")}${song.song_key ? ` · Tom ${esc(song.song_key)}` : ""}</span></div></div>
      <div class="sec"><h2>Partes da letra</h2>${song.own ? "" : `<button class="more" id="restore">Restaurar original</button>`}</div>
      <p class="tiny muted" style="margin:0 0 8px">Separe as partes com uma linha em branco. Para nomear, escreva na primeira linha entre colchetes, como <b>[Refrão]</b>.</p>
      <label class="field"><textarea id="ltxt" style="min-height:240px;font-size:16px;line-height:1.5">${esc(text)}</textarea></label>
      <div class="sec"><h2>Estilo</h2></div>${controls()}
      <div class="sec"><h2>Slides <small class="muted">${slidesOf(blocks(), st.per).length}</small></h2></div><div id="pv">${preview()}</div>
      <div class="row gap mt wrap"><button class="btn primary grow" id="dpptx">${icon("download")} PowerPoint (.pptx)</button><button class="btn ghost grow" id="dtxt">${icon("file")} Texto (.txt)</button></div>
      <button class="btn ghost block mt-s" id="save">${icon("check")} Salvar minha versão</button>
      <p class="tiny muted" style="margin-top:8px">${song.own ? "Esta letra é da Multimídia." : saved ? "Você já tem uma versão própria desta música." : "Ainda não salvou uma versão própria. A letra do Louvor não é alterada."}</p>
      ${song.own ? `<button class="btn ghost danger block mt-s" id="delown">${icon("trash")} Excluir esta letra</button>` : ""}`;
  };
  draw();
  const repaint = () => { el.querySelector("#pv").innerHTML = preview(); el.querySelector(".sec h2 small").textContent = slidesOf(blocks(), st.per).length; };
  el.addEventListener("input", (e) => {
    if (e.target.id === "ltxt") { text = e.target.value; repaint(); }
    else if (e.target.id === "ssize") { st.size = Number(e.target.value); el.querySelectorAll(".field span").forEach((s) => { if (/^Tamanho/.test(s.textContent)) s.textContent = `Tamanho (${st.size} pt)`; }); repaint(); }
    else if (e.target.dataset?.color) { st[e.target.dataset.color] = e.target.value; repaint(); }
  });
  el.addEventListener("change", (e) => {
    if (e.target.id === "sfont") { st.font = e.target.value; repaint(); }
    else if (e.target.id === "sper") { st.per = Number(e.target.value); repaint(); }
  });
  on(el, "click", "[data-sw]", (e, b) => { const [k, c] = b.dataset.sw.split(":"); st[k] = c; const keep = el.querySelector("#ltxt").scrollTop; text = el.querySelector("#ltxt").value; draw(); el.querySelector("#ltxt").scrollTop = keep; });
  on(el, "click", "#scaps", () => { st.caps = !st.caps; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#sfooter", () => { st.showFooter = !st.showFooter; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#slabel", () => { st.showLabel = !st.showLabel; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#restore", () => { text = lyricsToText(original); draw(); toast("Letra original restaurada"); });
  on(el, "click", "#dpptx", () => {
    const sl = slidesOf(blocks(), st.per); if (!sl.length) return toast("Escreva a letra primeiro.", "err");
    download(buildPptx(pptxSlides(song.title, song.artist, sl, st, st.showFooter ? [song.title, song.artist].filter(Boolean).join(" · ") : ""), st), `${slug(song.title)}.pptx`); toast("PowerPoint gerado");
  });
  on(el, "click", "#dtxt", () => { download(new Blob([textOf(song.title, blocks())], { type: "text/plain;charset=utf-8" }), `${slug(song.title)}.txt`); toast("Texto gerado"); });
  on(el, "click", "#save", async (e, b) => {
    busy(b);
    const bl = blocks();
    if (song.own) {
      song.title = el.querySelector("#otitle")?.value.trim() || song.title; song.artist = el.querySelector("#oartist")?.value.trim() || null;
      const u = await sb.from("media_lyrics").update({ title: song.title, artist: song.artist, blocks: bl.length ? bl : null, style: st, updated_by: state.user.id, updated_at: new Date().toISOString() }).eq("id", songId);
      busy(b, false); if (u.error) return toast(errMsg(u.error), "err"); saved = true; return toast("Letra salva");
    }
    const r = await sb.from("lyric_slides").upsert({ team_id: teamId, song_id: songId, org_id: team.org_id, blocks: bl.length ? bl : null, style: st, updated_by: state.user.id, updated_at: new Date().toISOString() }, { onConflict: "team_id,song_id" });
    busy(b, false);
    if (r.error) return toast(errMsg(r.error), "err");
    saved = true; toast("Versão salva");
  });
  on(el, "click", "#delown", async () => {
    if (!(await confirmDialog("Excluir esta letra?", "Excluir", true))) return;
    const d = await sb.from("media_lyrics").delete().eq("id", songId); if (d.error) return toast(errMsg(d.error), "err");
    toast("Letra excluída"); location.hash = `#/times/${teamId}/letras`;
  });
  void canManageTeam;
}

// ---------------------------------------------------------------- pacote do culto
// Um .zip com: ordem do culto, um PowerPoint com todas as músicas na ordem e, para cada música, PowerPoint e texto.
export const letrasTeamOf = () => state.myTeams.find((t) => t.id === state.space?.id && teamHas(t, "letras")) || state.myTeams.find((t) => teamHas(t, "letras")) || state.orgTeams.find((t) => teamHas(t, "letras") && state.role === "admin") || null;

export async function downloadPackage(s) {
  const team = letrasTeamOf();
  if (!team) throw new Error("Seu time não usa letras para a mídia.");
  const lib = new Map((await loadLibrary(team.id)).map((x) => [x.id, x]));
  const mine = new Map((await must(sb.from("lyric_slides").select("*").eq("team_id", team.id))).map((x) => [x.song_id, x]));
  let list = (await must(sb.from("schedule_songs").select("song_id,position,title_snapshot,artist_snapshot,song_key").eq("schedule_id", s.id).order("position")))
    .map((x) => { const l = lib.get(x.song_id); return { id: x.song_id, title: l?.title || x.title_snapshot, artist: l?.artist || x.artist_snapshot, key: x.song_key || l?.song_key, blocks: l?.lyrics?.blocks || [] }; });
  if (!list.length) {
    const r = await sb.rpc("service_songs", { p_schedule: s.id });
    list = (r.data || []).map((x) => ({ id: x.song_id, title: x.title, artist: x.artist, key: x.song_key, blocks: x.lyrics?.blocks || [] }));
  }
  if (!list.length) throw new Error("Esta escala ainda não tem músicas.");
  const cues = (await sb.from("schedule_cues").select("at_time,title,responsible,duration_min,kind").eq("schedule_id", s.id).order("position")).data || [];
  const folder = slug(`${s.title} ${String(s.starts_at).slice(0, 10)}`), pad = (n) => String(n).padStart(2, "0");
  const files = [], all = [];
  list.forEach((m, i) => {
    const saved = mine.get(m.id), blocks = saved?.blocks?.length ? saved.blocks : m.blocks, st = { ...DEFAULT_STYLE, ...(saved?.style || {}), ratio: team.slide_ratio || "16:9", layout: team.slide_layout };
    const sl = slidesOf(blocks, st.per);
    const slides = pptxSlides(m.title, m.artist, sl, st, st.showFooter ? [m.title, m.artist].filter(Boolean).join(" · ") : "");
    all.push(...slides);
    const base = `${folder}/${pad(i + 1)}-${slug(m.title)}`;
    if (sl.length) { files.push([`${base}.pptx`, new Uint8Array(0)]); files[files.length - 1][1] = buildPptx(slides, st); }
    files.push([`${base}.txt`, textOf(m.title, blocks)]);
  });
  const order = [`${s.title}`, `${fDate(s.starts_at)} às ${fTime(s.starts_at)}`, "", "MÚSICAS", ...list.map((m, i) => `${i + 1}. ${m.title}${m.artist ? " — " + m.artist : ""}${m.key ? ` (Tom ${m.key})` : ""}${m.blocks.length ? "" : "  [sem letra cadastrada]"}`),
    ...(cues.length ? ["", "ROTEIRO", ...cues.map((c) => `${c.at_time ? String(c.at_time).slice(0, 5) : "--:--"}  ${c.title}${c.duration_min ? ` (${c.duration_min} min)` : ""}${c.responsible ? ` — ${c.responsible}` : ""}`)] : [])].join("\n");
  files.unshift([`${folder}/00-ordem-do-culto.txt`, order + "\n"]);
  if (all.length) files.splice(1, 0, [`${folder}/culto-completo.pptx`, buildPptx(all, { ...DEFAULT_STYLE, ratio: team.slide_ratio || "16:9", layout: team.slide_layout })]);
  // os Blob dos PowerPoint viram bytes para entrar no zip
  const out = [];
  for (const [n, d] of files) out.push([n, d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : d]);
  download(zipStore(out), `${folder}.zip`);
  return list.length;
}

// ---------------------------------------------------------------- padrão da letra na tela
async function layoutPage(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "letras")) { el.innerHTML = empty("lyrics", "Este time não usa letras para a mídia."); return; }
  if (!alive()) return;
  const can = canManageTeam(teamId);
  let L = layoutOf(team.slide_layout), st = { ...DEFAULT_STYLE, ratio: team.slide_ratio || "16:9", showLabel: true };
  const sample = { label: "Refrão", text: "Tua graça me alcançou\nTeu amor me transformou" }, foot = "Nome da música · Artista";
  const seg = (key, opts) => `<div class="segs">${opts.map(([v, t]) => `<button type="button" class="seg${L[key] === v ? " on" : ""}" data-seg="${key}:${v}">${t}</button>`).join("")}</div>`;
  const slider = (key, label, min, max, step = 1, unit = "%") => `<label class="field"><span>${label} (<b id="${key}v">${L[key]}</b>${unit})</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${L[key]}"></label>`;
  const draw = () => {
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/letras">${icon("chevronLeft")}</a><h1>Padrão da letra</h1></div>
      <p class="muted small">Cada igreja projeta de um jeito. Ajuste aqui onde o texto fica na tela. Vale para todas as letras e para os arquivos em PowerPoint. O tamanho da letra e as cores você muda em cada música.</p>
      <div id="pv" style="position:sticky;top:var(--hdr,56px);z-index:3">${thumbOf(letraBoxes({ ...sample, footer: L.footer !== "off" ? foot : "" }, { ...st, layout: L }), { bg: st.bg, color: st.color, font: st.font, ratio: st.ratio, big: true })}</div>
      <div class="card mt">
        ${slider("mx", "Margem das laterais", 0, 25)}${slider("mt", "Margem de cima", 0, 40)}${slider("mb", "Margem de baixo", 0, 40)}${slider("spacing", "Espaço entre as linhas", 80, 200, 5)}
        <div class="field"><span>Alinhamento do texto</span>${seg("align", [["l", "Esquerda"], ["ctr", "Centro"], ["r", "Direita"]])}</div>
        <div class="field"><span>Posição na altura</span>${seg("anchor", [["t", "Em cima"], ["ctr", "No meio"], ["b", "Embaixo"]])}</div>
        <div class="field"><span>Nome da parte (Verso, Refrão)</span>${seg("label", [["tl", "Canto esquerdo"], ["tr", "Canto direito"], ["off", "Não mostrar"]])}</div>
        <div class="field"><span>Nome da música e artista</span>${seg("footer", [["bottom", "Embaixo"], ["top", "Em cima"], ["off", "Não mostrar"]])}</div>
      </div>
      ${can ? `<button class="btn primary block mt" id="ok">${icon("check")} Salvar padrão</button><button class="btn ghost block mt-s" id="reset">Voltar ao padrão do Somos</button>` : `<p class="small muted">Quem coordena o time pode mudar.</p>`}`;
  };
  draw();
  const repaint = () => { el.querySelector("#pv").innerHTML = thumbOf(letraBoxes({ ...sample, footer: L.footer !== "off" ? foot : "" }, { ...st, layout: L }), { bg: st.bg, color: st.color, font: st.font, ratio: st.ratio, big: true }); };
  el.addEventListener("input", (e) => { const k = e.target.dataset?.k; if (!k) return; L[k] = +e.target.value; el.querySelector(`#${k}v`).textContent = e.target.value; repaint(); });
  on(el, "click", "[data-seg]", (e, b) => { const [k, v] = b.dataset.seg.split(":"); L[k] = v; draw(); });
  on(el, "click", "#reset", () => { L = { ...DEFAULT_LAYOUT }; draw(); });
  on(el, "click", "#ok", async (e, b) => {
    busy(b);
    const r = await sb.from("teams").update({ slide_layout: L }).eq("id", teamId);
    busy(b, false);
    if (r.error) return toast(missing(r.error) ? "Falta rodar a atualização do banco (padrão da letra)." : errMsg(r.error), "err");
    team.slide_layout = L; toast("Padrão salvo");
  });
}
