// Letras para a mídia: as letras do repertório divididas em partes (Verso 1, Refrão...), com estilo
// próprio do time e exportação para PowerPoint e texto. Serve ao Louvor e à Multimídia.
import { sb, state, must, esc, attr, icon, sheet, toast, errMsg, busy, on, empty, spinner, teamHas, canManageTeam } from "../core.js";
import { parseLyricsText, lyricsToText } from "./songs.js";
import { buildPptx } from "../lib/pptx.js";

export function register(route) {
  route("/times/:id/letras", (p, el, a) => library(p.id, el, a));
  route("/times/:id/letras/:song", (p, el, a) => editor(p.id, p.song, el, a));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-05-letras.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST|function/i.test(String(e?.message || e?.code || e));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const FONTS = ["Arial", "Calibri", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Impact", "Montserrat", "Roboto", "Open Sans"];
export const DEFAULT_STYLE = { font: "Arial", size: 54, color: "#FFFFFF", bg: "#000000", per: 2, caps: false, showLabel: true };
const TEXT_COLORS = ["#FFFFFF", "#FFE066", "#9BD1FF", "#000000"], BG_COLORS = ["#000000", "#0B1F3A", "#1B1B1B", "#12301F", "#FFFFFF"];
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
async function loadLibrary(teamId) {
  const r = await sb.rpc("lyrics_library", { p_team: teamId });
  if (r.error) throw r.error;
  return r.data || [];
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
      ${mine.has(s.id) ? `<span class="tag soft">Editada</span>` : ""}${icon("chevronRight", "chev")}</a>`).join("")
      || `<div style="padding:10px">${empty("lyrics", songs.length ? "Nenhuma música encontrada" : "Nenhuma letra cadastrada", songs.length ? "Tente outro nome." : "Quando o Louvor cadastrar a letra das músicas, elas aparecem aqui já divididas em partes.")}</div>`;
  };
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Letras</h1></div>
    <p class="muted small">Letras do repertório, já divididas em partes. Ajuste fonte e cores, edite o que precisar e baixe em PowerPoint ou texto para importar no programa de projeção. A letra original do Louvor não muda.</p>
    <label class="search srch" style="display:block">${icon("search")}<input class="input" id="lq" placeholder="Procurar música"></label>
    <div class="list mt" id="ll"></div>`;
  draw();
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
  } catch (e) { el.innerHTML = missing(e) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(e)); return; }
  if (!alive()) return;
  if (!song) { el.innerHTML = empty("lyrics", "Letra não encontrada", "A música pode ter sido removida ou ainda não tem letra."); return; }
  const original = song.lyrics?.blocks || [];
  let text = lyricsToText(saved?.blocks?.length ? saved.blocks : original);
  let st = { ...DEFAULT_STYLE, ...(saved?.style || {}) };
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
        <div class="field"><span>Opções</span><div class="row gap-s" style="flex-wrap:wrap"><button type="button" class="chip ${st.caps ? "on" : ""}" id="scaps">CAIXA ALTA</button><button type="button" class="chip ${st.showLabel ? "on" : ""}" id="slabel">Nome da parte</button></div></div></div></div>`;
  const preview = () => {
    const sl = slidesOf(blocks(), st.per);
    const fs = (st.size / 960) * 100;
    return sl.length ? `<div class="thumbs">${sl.map((s) => `<div class="thumb" style="background:${attr(st.bg)};color:${attr(st.color)};font-family:'${attr(st.font)}',sans-serif;font-size:${fs}cqw">
      ${st.showLabel && s.label ? `<small>${esc(st.caps ? s.label.toUpperCase() : s.label)}</small>` : ""}<span>${esc(st.caps ? s.text.toUpperCase() : s.text)}</span></div>`).join("")}</div>`
      : `<div class="card small muted">Escreva a letra acima para ver os slides.</div>`;
  };
  const draw = () => {
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/letras">${icon("chevronLeft")}</a><div class="grow"><h1 style="font-size:22px">${esc(song.title)}</h1><span class="small muted">${esc(song.artist || "")}${song.song_key ? ` · Tom ${esc(song.song_key)}` : ""}</span></div></div>
      <div class="sec"><h2>Partes da letra</h2><button class="more" id="restore">Restaurar original</button></div>
      <p class="tiny muted" style="margin:0 0 8px">Separe as partes com uma linha em branco. Para nomear, escreva na primeira linha entre colchetes, como <b>[Refrão]</b>.</p>
      <label class="field"><textarea id="ltxt" style="min-height:240px;font-size:16px;line-height:1.5">${esc(text)}</textarea></label>
      <div class="sec"><h2>Estilo</h2></div>${controls()}
      <div class="sec"><h2>Slides <small class="muted">${slidesOf(blocks(), st.per).length}</small></h2></div><div id="pv">${preview()}</div>
      <div class="row gap mt wrap"><button class="btn primary grow" id="dpptx">${icon("download")} PowerPoint (.pptx)</button><button class="btn ghost grow" id="dtxt">${icon("file")} Texto (.txt)</button></div>
      <button class="btn ghost block mt-s" id="save">${icon("check")} Salvar minha versão</button>
      <p class="tiny muted" style="margin-top:8px">${saved ? "Você já tem uma versão própria desta música." : "Ainda não salvou uma versão própria. A letra do Louvor não é alterada."}</p>`;
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
  on(el, "click", "#slabel", () => { st.showLabel = !st.showLabel; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#restore", () => { text = lyricsToText(original); draw(); toast("Letra original restaurada"); });
  on(el, "click", "#dpptx", () => {
    const sl = slidesOf(blocks(), st.per); if (!sl.length) return toast("Escreva a letra primeiro.", "err");
    download(buildPptx([{ label: "", text: song.title + (song.artist ? "\n" + song.artist : "") }, ...sl], st), `${slug(song.title)}.pptx`); toast("PowerPoint gerado");
  });
  on(el, "click", "#dtxt", () => { download(new Blob([textOf(song.title, blocks())], { type: "text/plain;charset=utf-8" }), `${slug(song.title)}.txt`); toast("Texto gerado"); });
  on(el, "click", "#save", async (e, b) => {
    busy(b);
    const bl = blocks();
    const r = await sb.from("lyric_slides").upsert({ team_id: teamId, song_id: songId, org_id: team.org_id, blocks: bl.length ? bl : null, style: st, updated_by: state.user.id, updated_at: new Date().toISOString() }, { onConflict: "team_id,song_id" });
    busy(b, false);
    if (r.error) return toast(errMsg(r.error), "err");
    saved = true; toast("Versão salva");
  });
  void canManageTeam;
}
