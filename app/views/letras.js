// Letras para a mídia: as letras do repertório divididas em partes (Verso 1, Refrão...), com estilo
// próprio do time e exportação para PowerPoint e texto. Serve ao Louvor e à Multimídia.
import { go, sb, state, must, esc, attr, icon, sheet, toast, errMsg, busy, on, empty, spinner, teamHas, canManageTeam, confirmDialog } from "../core.js";
import { parseLyricsText, lyricsToText } from "./songs.js";
import { buildPptx, zipStore, RATIOS, ratioOf } from "../lib/pptx.js";
import { fDate, fTime } from "../core.js";
import { letraBoxes, titleBoxes, thumbOf, layoutOf, DEFAULT_LAYOUT, ppOf } from "../lib/slidelayout.js";

export function register(route) {
  route("/times/:id/letras", (p, el, a) => simulator(p.id, null, el, a));
  route("/times/:id/letras/biblioteca", (p, el, a) => library(p.id, el, a));
  route("/times/:id/letras/modelo", (p, el, a) => layoutPage(p.id, el, a));
  route("/times/:id/letras/:song/simulador", (p, el, a) => simulator(p.id, p.song, el, a));
  route("/times/:id/letras/:song", (p, el, a) => editor(p.id, p.song, el, a));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-05-letras.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST|function/i.test(String(e?.message || e?.code || e));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const FONTS = ["Gotham", "Arial", "Calibri", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Impact", "Montserrat", "Roboto", "Open Sans"];
export const DEFAULT_STYLE = { font: "Arial", size: 54, color: "#FFFFFF", bg: "#000000", bgAlpha: 1, per: 2, caps: false, showLabel: true };
const TEXT_COLORS = ["#FFFFFF", "#FFE066", "#9BD1FF", "#000000"], BG_COLORS = ["#000000", "#0B1F3A", "#1B1B1B", "#12301F", "#FFFFFF"];
// slides do PowerPoint com o padrão de tela da igreja
const pptxSlides = (title, artist, sl, st, footer) => [{ boxes: titleBoxes(title, artist, st), bg: st.bg, bgAlpha: st.bgAlpha, color: st.color, trans: st.pp?.trans }, ...sl.map((x) => ({ boxes: letraBoxes({ ...x, footer }, st), bg: st.bg, bgAlpha: st.bgAlpha, color: st.color, trans: st.pp?.trans }))];
const layoutFor = (team, style) => ({ ...(team.slide_layout || {}), ...(style?.layout || {}) });
const aspect = (r) => ratioOf(r).join(" / ");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "musica";

export function slidesOf(blocks, per = 2) {
  const out = []; blocks = blocks || [];
  for (const b of blocks || []) {
    const lines = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += per) out.push({ label: i === 0 ? b.label || "" : "", text: lines.slice(i, i + per).join("\n"), idx: out.length, bi: blocks.indexOf(b), from: i, n: Math.min(per, lines.length - i), part: b.label || "" });
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
      const [a, b] = ratioOf(v); if (a / b > 10 || a / b < 0.5) return toast("Proporção fora do comum. Confira os números.", "err");
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
  try { localStorage.setItem(`somos.letra.${teamId}`, songId); } catch {}
  const original = song.lyrics?.blocks || [];
  let text = lyricsToText(saved?.blocks?.length ? saved.blocks : original);
  let custom = !!saved?.style?.layout, st = { ...DEFAULT_STYLE, ...(saved?.style || {}), ratio: team.slide_ratio || "16:9", layout: layoutFor(team, saved?.style) };
  const blocks = () => parseLyricsText(text);

  const swatches = (key, list) => `<div class="swatches">${list.map((c) => `<button type="button" class="sw${st[key].toLowerCase() === c.toLowerCase() ? " on" : ""}" data-sw="${key}:${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}
    <label class="sw custom" title="Outra cor"><input type="color" data-color="${key}" value="${attr(st[key])}">${icon("plus")}</label></div>`;
  const posCard = () => {
    const L = layoutOf(st.layout);
    const seg = (key, opts) => `<div class="segs">${opts.map(([v, t]) => `<button type="button" class="seg${L[key] === v ? " on" : ""}" data-lseg="${key}:${v}">${t}</button>`).join("")}</div>`;
    const sl = (key, label, min, max, step = 1) => `<div class="field"><span>${label} (%)</span><div class="numrow"><input type="range" data-lk="${key}" min="${min}" max="${max}" step="${step}" value="${L[key]}" aria-label="${label}"><input type="number" class="num" inputmode="decimal" data-lk="${key}" min="${min}" max="${max}" step="${step}" value="${L[key]}" aria-label="${label} em número"></div></div>`;
    return `<div class="card"><label class="check" style="padding-top:0"><input type="checkbox" id="lcustom" ${custom ? "checked" : ""}> Personalizar só para esta música</label>
      ${custom ? `${sl("mx", "Margem das laterais", 0, 25)}${sl("mt", "Margem de cima", 0, 40)}${sl("mb", "Margem de baixo", 0, 40)}${sl("spacing", "Espaço entre as linhas", 80, 200, 5)}
        <div class="field"><span>Alinhamento do texto</span>${seg("align", [["l", "Esquerda"], ["ctr", "Centro"], ["r", "Direita"]])}</div>
        <div class="field"><span>Posição na altura</span>${seg("anchor", [["t", "Em cima"], ["ctr", "No meio"], ["b", "Embaixo"]])}</div>
        <p class="tiny muted">Só esta música usa estas medidas.</p>`
        : `<p class="tiny muted" style="margin:0">Usando o padrão do time. <a class="link" href="#/times/${teamId}/letras/modelo">Editar o padrão</a></p>`}</div>`;
  };
  const controls = () => `
    <div class="card"><div class="two">
      <label class="field"><span>Fonte</span><select id="sfont">${FONTS.map((f) => `<option ${st.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label class="field"><span>Tamanho (${st.size} pt)</span><input type="range" id="ssize" min="28" max="90" step="2" value="${st.size}"></label></div>
      <p class="tiny muted" style="margin:-4px 0 10px">A fonte precisa estar instalada no computador onde o arquivo for aberto.</p>
      <div class="field"><span>Cor da letra</span>${swatches("color", TEXT_COLORS)}</div>
      <div class="field"><span>Cor do fundo</span>${swatches("bg", BG_COLORS)}</div>
      <div class="two"><label class="field"><span>Linhas por slide</span><select id="sper">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${st.per === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <div class="field"><span>Opções</span><div class="row gap-s" style="flex-wrap:wrap"><button type="button" class="chip ${st.caps ? "on" : ""}" id="scaps">CAIXA ALTA</button><button type="button" class="chip ${st.showLabel ? "on" : ""}" id="slabel">Nome da parte</button><button type="button" class="chip ${st.showFooter ? "on" : ""}" id="sfooter">MÚSICA NO RODAPÉ</button></div></div></div></div>`;
  const styleToSave = () => { const o = { ...st }; delete o.ratio; if (!custom) delete o.layout; return o; };
  const preview = () => {
    const sl = slidesOf(blocks(), st.per);
    return sl.length ? `<div class="thumbs">${sl.map((x) => thumbOf(letraBoxes({ ...x, footer: st.showFooter ? [song.title, song.artist].filter(Boolean).join(" · ") : "" }, st), { bg: st.bg, color: st.color, font: st.font, ratio: st.ratio })).join("")}</div>`
      : `<div class="card small muted">Escreva a letra acima para ver os slides.</div>`;
  };
  const draw = () => {
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/letras/biblioteca">${icon("chevronLeft")}</a><div class="grow">${song.own ? `<input class="input" id="otitle" value="${attr(song.title)}" maxlength="160" aria-label="Título" style="font-size:20px;font-weight:700"><input class="input" id="oartist" value="${attr(song.artist || "")}" maxlength="160" placeholder="Artista ou autor" aria-label="Artista" style="margin-top:6px">` : `<h1 style="font-size:22px">${esc(song.title)}</h1>`}<span class="small muted">${esc(song.artist || "")}${song.song_key ? ` · Tom ${esc(song.song_key)}` : ""}</span></div></div>
      <div class="sec"><h2>Partes da letra</h2>${song.own ? "" : `<button class="more" id="restore">Restaurar original</button>`}</div>
      <p class="tiny muted" style="margin:0 0 8px">Separe as partes com uma linha em branco. Para nomear, escreva na primeira linha entre colchetes, como <b>[Refrão]</b>.</p>
      <label class="field"><textarea id="ltxt" style="min-height:240px;font-size:16px;line-height:1.5">${esc(text)}</textarea></label>
      <div class="sec"><h2>Estilo</h2></div>${controls()}
      <div class="sec"><h2>Posição na tela</h2></div>${posCard()}
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
  on(el, "change", "#lcustom", (e) => {
    custom = e.target.checked; text = el.querySelector("#ltxt").value;
    st.layout = custom ? layoutOf(st.layout) : layoutFor(team, null); draw();
  });
  on(el, "click", "[data-lseg]", (e, b) => { const [k, v] = b.dataset.lseg.split(":"); st.layout = { ...layoutOf(st.layout), [k]: v }; text = el.querySelector("#ltxt").value; draw(); });
  el.addEventListener("input", (e) => {
    const k = e.target.dataset?.lk; if (!k || e.target.value === "") return;
    const v = Math.min(+e.target.max, Math.max(+e.target.min, +e.target.value)); st.layout = { ...layoutOf(st.layout), [k]: v };
    el.querySelectorAll(`[data-lk="${k}"]`).forEach((n) => { if (n !== e.target) n.value = v; }); repaint();
  });
  on(el, "click", "#scaps", () => { st.caps = !st.caps; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#sfooter", () => { st.showFooter = !st.showFooter; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#slabel", () => { st.showLabel = !st.showLabel; text = el.querySelector("#ltxt").value; draw(); });
  on(el, "click", "#restore", () => { text = lyricsToText(original); draw(); toast("Letra original restaurada"); });
  on(el, "click", "#dpptx", () => {
    const sl = slidesOf(blocks(), st.per); if (!sl.length) return toast("Escreva a letra primeiro.", "err");
    download(buildPptx(pptxSlides(song.title, song.artist, sl, st, st.showFooter ? [song.title, song.artist].filter(Boolean).join(" · ") : ""), st), `${slug(song.title)}.pptx`); toast("PowerPoint gerado");
  });
  on(el, "click", "#dtxt", () => { download(new Blob([textOf(song.title, blocks())], { type: "text/plain;charset=utf-8" }), `${slug(song.title)}.txt`); toast("Texto gerado"); });
  const doSave = async (b) => {
    busy(b);
    const bl = blocks();
    if (song.own) {
      song.title = el.querySelector("#otitle")?.value.trim() || song.title; song.artist = el.querySelector("#oartist")?.value.trim() || null;
      const u = await sb.from("media_lyrics").update({ title: song.title, artist: song.artist, blocks: bl.length ? bl : null, style: styleToSave(), updated_by: state.user.id, updated_at: new Date().toISOString() }).eq("id", songId);
      busy(b, false); if (u.error) { toast(errMsg(u.error), "err"); return false; } saved = true; toast("Letra salva"); return true;
    }
    const r = await sb.from("lyric_slides").upsert({ team_id: teamId, song_id: songId, org_id: team.org_id, blocks: bl.length ? bl : null, style: styleToSave(), updated_by: state.user.id, updated_at: new Date().toISOString() }, { onConflict: "team_id,song_id" });
    busy(b, false);
    if (r.error) { toast(errMsg(r.error), "err"); return false; }
    saved = true; toast("Versão salva"); return true;
  };
  on(el, "click", "#save", (e, b) => doSave(b));
  on(el, "click", "#delown", async () => {
    if (!(await confirmDialog("Excluir esta letra?", "Excluir", true))) return;
    const d = await sb.from("media_lyrics").delete().eq("id", songId); if (d.error) return toast(errMsg(d.error), "err");
    toast("Letra excluída"); go(`/times/${teamId}/letras/biblioteca`);
  });
  void canManageTeam;
}

// ---------------------------------------------------------------- simulador ProPresenter
// Mesmo desenho do ProPresenter: slides à esquerda, tela no centro e painel Forma / Texto / Compilação à direita.
// Presets da igreja, copiados do ProPresenter: tela 3840x1080; caixa 1519,7 x 181,5 na posição 1160,2 / 158,2 (centrada na largura);
// Gotham Book 50 branca, centralizada, sombra preta 100% a 314,68° (deslocamento 12, desfocar 10). Só o fundo muda entre os três.
// Os valores em "pt" são os px da tela x 960 / 3840 (a lâmina do PowerPoint tem 960 pt de largura).
const PX = 960 / 3840;
const TXT_LOUVOR = { shape: { x: 1160.2 / 3840, y: 158.2 / 1080, w: 1519.7 / 3840, h: 181.5 / 1080, rot: 0, opacity: 1, fill: { on: false }, stroke: { on: false } },
  tx: { font: "Gotham", size: 50 * PX, bold: false, italic: false, underline: false, strike: false, caps: "none", align: "ctr", anchor: "ctr", stroke: { on: false },
    shadow: { on: true, color: "#000000", op: 1, angle: 314.68, off: 12 * PX, blur: 10 * PX } }, trans: "none" };
const LOUVOR = { font: "Gotham", size: 50 * PX, color: "#FFFFFF", bg: "#000000", per: 2, showLabel: false, ratio: "3840x1080", pp: TXT_LOUVOR };
export const BUILTIN_PRESETS = [
  ["Louvor", { ...LOUVOR, bgAlpha: 0.5 }],
  ["Louvor 1 mais escuro", { ...LOUVOR, bgAlpha: 0.75 }],
  ["Louvor Sem opacidade", { ...LOUVOR, bgAlpha: 1 }],
];
const CAPS = [[null, "Padrão"], ["none", "Nenhuma"], ["upper", "MAIÚSCULAS"], ["lower", "minúsculas"], ["title", "Título"]];
const TRANS = [["none", "Nenhuma"], ["fade", "Esmaecer"], ["push", "Empurrar"], ["wipe", "Revelar"]];
async function simulator(teamId, songId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "letras")) { el.innerHTML = empty("lyrics", "Este time não usa letras para a mídia."); return; }
  let song, saved, lib = [];
  try {
    lib = await loadLibrary(teamId);
    if (!songId) { let last = null; try { last = localStorage.getItem(`somos.letra.${teamId}`); } catch {} songId = (lib.find((x) => x.id === last) || lib[0])?.id || null; }
    song = lib.find((x) => x.id === songId);
    if (song) {
      saved = await must(sb.from("lyric_slides").select("*").eq("team_id", teamId).eq("song_id", songId).maybeSingle());
      if (song.own) saved = { blocks: song.lyrics?.blocks || [], style: song.style };
    }
  } catch (e) { el.innerHTML = missing(e) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(e)); return; }
  if (!alive()) return;
  if (!song) { el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Letras</h1></div><div class="card">${empty("lyrics", lib.length ? "Letra não encontrada" : "Nenhuma letra cadastrada", "Crie uma letra ou espere o Louvor cadastrar as músicas.")}<a class="btn primary block mt" href="#/times/${teamId}/letras/biblioteca">${icon("plus")} Biblioteca de letras</a></div>`; return; }
  try { localStorage.setItem(`somos.letra.${teamId}`, songId); } catch {}
  const original = song.lyrics?.blocks || [];
  let text = lyricsToText(saved?.blocks?.length ? saved.blocks : original);
  const custom = !!saved?.style?.layout;
  const st = { ...DEFAULT_STYLE, ...(saved?.style || {}), ratio: team.slide_ratio || "16:9", layout: layoutFor(team, saved?.style) };
  st.pp = { shape: {}, tx: {}, over: {}, trans: "none", ...(st.pp || {}) };
  st.pp.shape = st.pp.shape || {}; st.pp.tx = st.pp.tx || {}; st.pp.over = st.pp.over || {};
  let sel = 0, tab = "forma", scope = "all", dirty = false, editing = false;
  let rw = 16, rh = 9, resW = 1920, resH = 1080;
  const calcRes = () => { [rw, rh] = ratioOf(st.ratio); resW = /^\d{3,5}\s*[x×]/i.test(String(st.ratio)) ? rw : 1920; resH = Math.round((resW * rh) / rw); };
  calcRes();
  const blocks = () => parseLyricsText(text);
  const slides = () => slidesOf(blocks(), st.per);
  const footer = () => (st.showFooter ? [song.title, song.artist].filter(Boolean).join(" · ") : "");
  const cur = () => ppOf(st.pp, sel);
  const target = () => (scope === "one" ? (st.pp.over[sel] ||= {}) : st.pp);
  const get = (path) => path.split(".").reduce((o, k) => o?.[k], cur());
  const set = (path, v) => { const ks = path.split("."); let o = target(); for (const k of ks.slice(0, -1)) o = (o[k] ||= {}); o[ks.at(-1)] = v; dirty = true; };
  const boxesOf = (sl) => letraBoxes({ ...sl, footer: footer() }, st);
  const thumb = (sl, big = false) => thumbOf(boxesOf(sl), { bg: st.bg, bgAlpha: st.bgAlpha, color: st.color, font: st.font, ratio: st.ratio, big });
  const seg = (path, opts, val) => `<div class="segs">${opts.map(([v, t, ic]) => `<button type="button" class="seg${val === v ? " on" : ""}" data-pseg="${path}:${v}" title="${t}">${ic || t}</button>`).join("")}</div>`;
  const num = (path, label, o = {}) => { const v = get(path) ?? o.dflt ?? 0; return `<label class="ppn"><span>${label}</span><input type="number" data-p="${path}" ${o.ax ? `data-ax="${o.ax}"` : ""} ${o.scale ? `data-scale="${o.scale}"` : ""} ${o.px ? 'data-px="1"' : ""} step="${o.step || 1}" ${o.min != null ? `min="${o.min}"` : ""} ${o.max != null ? `max="${o.max}"` : ""} value="${o.ax ? Math.round(v * (o.ax === "W" ? resW : resH) * 10) / 10 : o.scale ? Math.round(v * o.scale) : o.px ? Math.round(((v * resW) / 960) * 10) / 10 : v}"></label>`; };
  const chk = (path, label) => `<label class="check ppc"><input type="checkbox" data-p="${path}" ${get(path) ? "checked" : ""}> ${label}</label>`;
  const color = (path, dflt) => `<input type="color" class="ppcolor" data-p="${path}" value="${attr(get(path) || dflt)}">`;
  const formaTab = () => { const sl = slides()[sel]; const b = sl ? boxesOf(sl)[0] : { x: 0, y: 0, w: 1, h: 1 };
    const sh = { x: b.x, y: b.y, w: b.w, h: b.h };
    return `<div class="ppg"><b>Posição</b>${[["x", "X", "W"], ["y", "Y", "H"]].map(([k, l, ax]) => `<label class="ppn"><span>${l}</span><input type="number" data-p="shape.${k}" data-ax="${ax}" step="1" value="${Math.round(sh[k] * (ax === "W" ? resW : resH) * 10) / 10}"></label>`).join("")}</div>
      <div class="ppg"><b>Tamanho</b>${[["w", "Largura", "W"], ["h", "Altura", "H"]].map(([k, l, ax]) => `<label class="ppn"><span>${l}</span><input type="number" data-p="shape.${k}" data-ax="${ax}" step="1" min="1" value="${Math.round(sh[k] * (ax === "W" ? resW : resH) * 10) / 10}"></label>`).join("")}</div>
      <div class="ppg"><b>Transformar</b>${num("shape.rot", "Rotação (°)", { min: -360, max: 360 })}</div>
      <div class="ppg"><b>Opacidade</b><input type="range" data-p="shape.opacity" data-scale="100" min="0" max="100" value="${Math.round((get("shape.opacity") ?? 1) * 100)}"></div>
      <div class="ppg col">${chk("shape.fill.on", "Preencher")}${get("shape.fill.on") ? `<div class="row gap-s">${color("shape.fill.color", "#000000")}</div>` : ""}</div>
      <div class="ppg col">${chk("shape.stroke.on", "Traço")}${get("shape.stroke.on") ? `<div class="row gap-s">${color("shape.stroke.color", "#ffffff")}${num("shape.stroke.w", "Espessura (px)", { min: 0, max: 200, px: 1 })}</div>` : ""}</div>
      <div class="ppg"><b>Fundo</b><input type="color" class="ppcolor" data-st="bg" value="${attr(st.bg)}"><label class="ppn"><span>Opacidade do fundo %</span><input type="number" data-st="bgAlpha" data-scale="100" min="0" max="100" value="${Math.round((st.bgAlpha ?? 1) * 100)}"></label></div>
      <button type="button" class="btn ghost block mt-s" id="boxreset">Restaurar posição e tamanho</button>`; };
  const textoTab = () => { const sl = slides()[sel]; const eff = sl ? boxesOf(sl)[0] : {};
    const fontNow = get("tx.font") || st.font;
    return `<div class="ppg col"><b>Fonte</b><select data-p="tx.font">${FONTS.map((f) => `<option ${fontNow === f ? "selected" : ""}>${f}</option>`).join("")}</select>
        <div class="row gap-s">${num("tx.size", "Tamanho (px)", { dflt: eff.size || st.size, min: 4, max: 600, px: 1 })}
        <div class="segs sm"><button type="button" class="seg${get("tx.bold") !== false ? " on" : ""}" data-ptog="tx.bold"><b>B</b></button><button type="button" class="seg${get("tx.italic") ? " on" : ""}" data-ptog="tx.italic"><i>I</i></button><button type="button" class="seg${get("tx.underline") ? " on" : ""}" data-ptog="tx.underline"><u>U</u></button><button type="button" class="seg${get("tx.strike") ? " on" : ""}" data-ptog="tx.strike"><s>S</s></button></div></div></div>
      <div class="ppg"><b>Capitalização</b><select data-pcaps>${CAPS.map(([v, t]) => `<option value="${v ?? ""}" ${(get("tx.caps") ?? null) === v || (v === null && get("tx.caps") == null) ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="ppg"><b>Cor do texto</b>${color("tx.color", st.color)}<button type="button" class="link small" data-pclear="tx.color">padrão</button></div>
      <div class="ppg col"><b>Alinhamento</b>${seg("tx.align", [["l", "Esquerda"], ["ctr", "Centro"], ["r", "Direita"], ["just", "Justificado"]], get("tx.align") || st.layout.align)}${seg("tx.anchor", [["t", "Em cima"], ["ctr", "Meio"], ["b", "Embaixo"]], get("tx.anchor") || st.layout.anchor)}</div>
      <div class="ppg col">${chk("tx.stroke.on", "Traço")}${get("tx.stroke.on") ? `<div class="row gap-s">${color("tx.stroke.color", "#000000")}${num("tx.stroke.w", "Espessura (px)", { min: 0, max: 80, px: 1 })}</div>` : ""}</div>
      <div class="ppg col">${chk("tx.shadow.on", "Sombra")}${get("tx.shadow.on") ? `<div class="row gap-s">${color("tx.shadow.color", "#000000")}${num("tx.shadow.op", "Opacidade %", { scale: 100, min: 0, max: 100 })}</div>
        <div class="row gap-s">${num("tx.shadow.angle", "Ângulo (°)", { min: 0, max: 359 })}${num("tx.shadow.off", "Deslocamento", { min: 0, max: 200, px: 1 })}${num("tx.shadow.blur", "Desfocar", { min: 0, max: 200, px: 1 })}</div>` : ""}</div>`; };
  const compTab = () => `<div class="ppg col"><b>Transição ao entrar no slide</b><select data-ptrans>${TRANS.map(([v, t]) => `<option value="${v}" ${(st.pp.trans || "none") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      <p class="tiny muted" style="margin:6px 0 0">Vale para todos os slides desta música no PowerPoint exportado.</p></div>`;
  const canvasHTML = () => { const sl = slides()[sel]; if (!sl) return `<div class="card small muted">Esta música ainda não tem letra. Escreva na tela de edição.</div>`; return `<div class="ppstage" id="stage">${thumb(sl, true)}<div class="ppsel" id="psel"></div></div>`; };
  const listHTML = () => { const sl = slides(); let last = null; return sl.map((x) => { const head = x.label && x.label !== last ? (last = x.label, `<div class="pphead">${esc(x.label)}</div>`) : ""; return `${head}<button type="button" class="ppsl${x.idx === sel ? " on" : ""}" data-sl="${x.idx}">${thumb(x)}<small>${x.idx + 1}</small></button>`; }).join("") || `<p class="tiny muted">Sem slides.</p>`; };
  const place = () => { // caixa de seleção sobre o texto
    const stg = el.querySelector("#stage"), box = stg?.querySelector("[data-main]"), ov = el.querySelector("#psel"); if (!stg || !box || !ov) return;
    const sl = slides()[sel], b = boxesOf(sl)[0];
    ov.style.cssText = `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;transform:rotate(${b.rot || 0}deg)`;
    if (!ov.querySelector(".hd")) ov.innerHTML = `<i class="hd" data-h="nw"></i><i class="hd" data-h="n"></i><i class="hd" data-h="ne"></i><i class="hd" data-h="e"></i><i class="hd" data-h="se"></i><i class="hd" data-h="s"></i><i class="hd" data-h="sw"></i><i class="hd" data-h="w"></i><span class="dims"></span>`;
    ov.querySelector(".dims").textContent = `${Math.round(b.w * resW)} × ${Math.round(b.h * resH)}`;
  };
  const paintCanvas = () => { // troca só o desenho do slide, para a caixa de seleção continuar viva durante o arraste
    const c = el.querySelector("#cv"); if (!c || editing) return; const sl = slides()[sel], stg = c.querySelector("#stage");
    if (stg && sl) { stg.querySelector(".thumb").outerHTML = thumb(sl, true); place(); return; }
    c.innerHTML = canvasHTML(); place(); };
  const paintList = () => { const l = el.querySelector("#sl"); if (l) l.innerHTML = listHTML(); };
  const paintInsp = () => { const i = el.querySelector("#insp"); if (i) i.innerHTML = tab === "forma" ? formaTab() : tab === "texto" ? textoTab() : compTab(); el.querySelectorAll("[data-ptab]").forEach((b) => b.classList.toggle("on", b.dataset.ptab === tab)); };
  const repaint = () => { paintCanvas(); paintList(); };
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><div class="grow"><h1 style="margin:0">Letras</h1><div class="tiny muted">Simulador ProPresenter</div></div></div>
    <button class="li ppsong" id="psongs" type="button"><span class="cover">${icon("lyrics")}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(song.title)}</span><span class="s">${esc(song.artist || "Toque para trocar de música")}</span></span>${icon("chevronRight", "chev")}</button>
    <div class="row gap-s wrap ppbar"><button class="btn ghost sm" id="ppresets">${icon("layers")} Presets</button><a class="btn ghost sm" href="#/times/${teamId}/letras/${songId}">${icon("edit")} Editar letra</a><a class="btn ghost sm" href="#/times/${teamId}/letras/biblioteca">${icon("lyrics")} Biblioteca</a></div>
    <div class="pp"><div class="ppsl-col"><div id="sl"></div></div>
      <div class="ppmid"><div id="cv"></div>
        <div class="row gap mt wrap"><button class="btn primary grow" id="psave">${icon("check")} Salvar</button><button class="btn ghost grow" id="ppptx">${icon("download")} PowerPoint</button></div>
        <p class="tiny muted" style="margin:8px 0 0">Arraste a caixa para mover, os pontos para redimensionar e toque duas vezes no texto para editar.</p></div>
      <div class="ppside"><div class="segs ppscope"><button type="button" class="seg on" data-pscope="all">Todos os slides</button><button type="button" class="seg" data-pscope="one">Só este slide</button></div>
        <div class="pptabs"><button type="button" class="on" data-ptab="forma">Forma</button><button type="button" data-ptab="texto">Texto</button><button type="button" data-ptab="comp">Compilação</button></div><div id="insp" class="ppinsp"></div></div></div>`;
  repaint(); paintInsp();

  // ---- interação
  on(el, "click", "[data-sl]", (e, b) => { sel = Number(b.dataset.sl); repaint(); paintInsp(); });
  on(el, "click", "[data-ptab]", (e, b) => { tab = b.dataset.ptab; paintInsp(); });
  on(el, "click", "[data-pscope]", (e, b) => { scope = b.dataset.pscope; el.querySelectorAll("[data-pscope]").forEach((x) => x.classList.toggle("on", x === b)); paintInsp(); });
  on(el, "click", "[data-pseg]", (e, b) => { const [path, v] = b.dataset.pseg.split(":"); set(path, v); repaint(); paintInsp(); });
  on(el, "click", "[data-ptog]", (e, b) => { const p = b.dataset.ptog; set(p, p === "tx.bold" ? get(p) === false : !get(p)); repaint(); paintInsp(); });
  on(el, "click", "[data-pclear]", (e, b) => { set(b.dataset.pclear, null); repaint(); paintInsp(); });
  on(el, "click", "#boxreset", () => { for (const k of ["x", "y", "w", "h"]) set(`shape.${k}`, null); set("shape.rot", 0); repaint(); paintInsp(); });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.pcaps !== undefined) { set("tx.caps", t.value || null); repaint(); }
    else if (t.dataset.ptrans !== undefined) { st.pp.trans = t.value; dirty = true; }
    else if (t.dataset.p && (t.type === "checkbox")) { set(t.dataset.p, t.checked); repaint(); paintInsp(); }
    else if (t.dataset.p && t.tagName === "SELECT") { set(t.dataset.p, t.value); repaint(); }
  });
  el.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.st) { const v = t.type === "number" ? Number(t.value) / Number(t.dataset.scale || 1) : t.value; if (t.type === "number" && (t.value === "" || Number.isNaN(v))) return; st[t.dataset.st] = Math.min(1, Math.max(0, v)) === v || t.type !== "number" ? v : Math.min(1, Math.max(0, v)); dirty = true; repaint(); return; }
    const path = t.dataset?.p; if (!path || t.type === "checkbox" || t.tagName === "SELECT") return;
    let v = t.type === "number" || t.type === "range" ? Number(t.value) : t.value;
    if (t.type !== "color" && (t.value === "" || Number.isNaN(v))) return;
    if (t.dataset.ax) v = v / (t.dataset.ax === "W" ? resW : resH);
    else if (t.dataset.scale) v = v / Number(t.dataset.scale);
    else if (t.dataset.px) v = (v * 960) / resW;
    set(path, v); repaint();
  });
  // arrastar e redimensionar a caixa
  el.addEventListener("pointerdown", (e) => {
    const ov = e.target.closest("#psel"); if (!ov || editing) return;
    const stg = el.querySelector("#stage").getBoundingClientRect(), b0 = boxesOf(slides()[sel])[0], h = e.target.dataset.h || "move";
    const start = { x: e.clientX, y: e.clientY }, g = { x: b0.x, y: b0.y, w: b0.w, h: b0.h };
    ov.setPointerCapture(e.pointerId); e.preventDefault();
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / stg.width, dy = (ev.clientY - start.y) / stg.height; let { x, y, w, h: hh } = g;
      if (h === "move") { x = g.x + dx; y = g.y + dy; }
      else { if (h.includes("e")) w = g.w + dx; if (h.includes("s")) hh = g.h + dy; if (h.includes("w")) { x = g.x + dx; w = g.w - dx; } if (h.includes("n")) { y = g.y + dy; hh = g.h - dy; } }
      w = Math.max(0.05, w); hh = Math.max(0.05, hh);
      if (h === "move") { x = Math.min(1 - w, Math.max(0, x)); y = Math.min(1 - hh, Math.max(0, y)); }
      Object.entries({ x, y, w, h: hh }).forEach(([k, v]) => set(`shape.${k}`, Math.round(v * 10000) / 10000));
      paintCanvas();
    };
    const up = () => { ov.removeEventListener("pointermove", move); ov.removeEventListener("pointerup", up); ov.removeEventListener("pointercancel", up); paintInsp(); paintList(); };
    ov.addEventListener("pointermove", move); ov.addEventListener("pointerup", up); ov.addEventListener("pointercancel", up);
  });
  // editar o texto do slide na própria tela
  el.addEventListener("dblclick", (e) => {
    const ov = e.target.closest("#psel"); if (!ov || editing) return;
    const sl = slides()[sel]; editing = true;
    const ta = document.createElement("textarea"); ta.className = "ppedit"; ta.value = sl.text;
    ta.style.cssText = ov.style.cssText.replace(/transform:[^;]*/, ""); ov.parentElement.appendChild(ta); ta.focus(); ta.select();
    const done = () => {
      if (!editing) return; editing = false;
      const lines = ta.value.split(/\n+/).map((l) => l.trim()).filter(Boolean); ta.remove();
      const bl = blocks(), b = bl[sl.bi]; if (!b) return;
      const all = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
      all.splice(sl.from, sl.n, ...lines); b.text = all.join("\n"); text = lyricsToText(bl); dirty = true;
      repaint(); paintInsp();
    };
    ta.addEventListener("blur", done); ta.addEventListener("keydown", (k) => { if (k.key === "Escape") { ta.value = sl.text; ta.blur(); } });
  });
  // ---- presets: edições já definidas da igreja + os salvos pelo time
  const PKEYS = ["font", "size", "color", "bg", "bgAlpha", "per", "caps", "showLabel"];
  const snapshot = () => { const c = {}; for (const k of PKEYS) c[k] = st[k]; c.pp = JSON.parse(JSON.stringify({ shape: st.pp.shape, tx: st.pp.tx, trans: st.pp.trans || "none" })); return c; };
  const applyPreset = async (cfg) => {
    if (cfg.ratio && cfg.ratio !== st.ratio && canManageTeam(teamId) && (await confirmDialog(`Este preset usa a tela ${cfg.ratio}. Mudar a tela da projeção do time?`, "Mudar a tela"))) {
      const r = await sb.from("teams").update({ slide_ratio: cfg.ratio }).eq("id", teamId); if (r.error) toast(errMsg(r.error), "err"); else { team.slide_ratio = cfg.ratio; st.ratio = cfg.ratio; calcRes(); }
    }
    for (const k of PKEYS) if (cfg[k] !== undefined) st[k] = cfg[k]; st.pp = { shape: {}, tx: {}, over: {}, trans: "none", ...JSON.parse(JSON.stringify(cfg.pp || {})) }; st.pp.over = {}; dirty = true; repaint(); paintInsp(); };
  const loadPresets = async () => { const r = await sb.from("lyric_presets").select("id,name,config").eq("team_id", teamId).order("sort").order("created_at"); return r.error ? null : r.data || []; };
  const presetCard = (name, cfg, extra = "") => { const s2 = { ...st, ...cfg, pp: { shape: {}, tx: {}, over: {}, ...(cfg.pp || {}) } };
    return `<div class="ppreset">${thumbOf(letraBoxes({ label: "", text: "Line one of text\nLine two of text", footer: "", idx: 0 }, s2), { bg: s2.bg, bgAlpha: s2.bgAlpha, color: s2.color, font: s2.font, ratio: cfg.ratio || st.ratio })}<div class="row gap-s"><span class="grow t">${esc(name)}</span>${extra}</div></div>`; };
  on(el, "click", "#ppresets", async () => {
    const saved2 = await loadPresets();
    const sh = sheet(`<h3>Presets</h3><p class="small muted">Edições já definidas. Toque para aplicar à música (você ainda pode ajustar e salvar).</p>
      <div class="sec"><h3>Da igreja</h3></div><div class="ppresets">${BUILTIN_PRESETS.map(([n, c], i) => `<button type="button" class="ppbtn" data-bp="${i}">${presetCard(n, c)}</button>`).join("")}</div>
      <div class="sec"><h3>Salvos pelo time</h3></div><div class="ppresets" id="spl">${saved2 === null ? `<p class="tiny muted">Para salvar presets, falta rodar a atualização do banco.</p>` : saved2.length ? saved2.map((x) => `<div class="ppwrap"><button type="button" class="ppbtn" data-sp="${x.id}">${presetCard(x.name, x.config || {})}</button><button type="button" class="iconbtn ppdel" data-spd="${x.id}" aria-label="Excluir preset">${icon("trash")}</button></div>`).join("") : `<p class="tiny muted">Nenhum ainda. Ajuste a letra e salve abaixo.</p>`}</div>
      ${saved2 === null ? "" : `<label class="field mt"><span>Salvar os ajustes atuais como preset</span><input id="spname" maxlength="60" placeholder="Ex.: Louvor domingo"></label><button class="btn primary block" id="spsave">${icon("check")} Salvar preset</button>`}`, { wide: true });
    sh.el.addEventListener("click", async (e) => {
      const bp = e.target.closest("[data-bp]"), sp = e.target.closest("[data-sp]"), del = e.target.closest("[data-spd]");
      if (bp) { sh.close(); await applyPreset(BUILTIN_PRESETS[Number(bp.dataset.bp)][1]); toast("Preset aplicado"); }
      else if (sp) { sh.close(); await applyPreset(saved2.find((x) => x.id === sp.dataset.sp).config || {}); toast("Preset aplicado"); }
      else if (del) { if (!(await confirmDialog("Excluir este preset?", "Excluir", true))) return; const r = await sb.from("lyric_presets").delete().eq("id", del.dataset.spd); if (r.error) return toast(errMsg(r.error), "err"); sh.close(); toast("Preset excluído"); }
    });
    sh.el.querySelector("#spsave")?.addEventListener("click", async (e) => {
      const name = sh.el.querySelector("#spname").value.trim(); if (!name) return toast("Dê um nome ao preset.", "err");
      busy(e.currentTarget);
      const r = await sb.from("lyric_presets").upsert({ org_id: team.org_id, team_id: teamId, name, config: snapshot(), created_by: state.user.id }, { onConflict: "team_id,name" });
      busy(e.currentTarget, false); if (r.error) return toast(errMsg(r.error), "err");
      sh.close(); toast("Preset salvo");
    });
  });
  on(el, "click", "#psongs", () => {
    const sh = sheet(`<h3>Escolher música</h3><label class="search srch" style="display:block">${icon("search")}<input class="input" id="psq" placeholder="Procurar música"></label><div class="list mt" id="psl" style="max-height:55vh;overflow:auto"></div><a class="btn ghost block mt" href="#/times/${teamId}/letras/biblioteca">${icon("plus")} Nova letra e ajustes da tela</a>`, { wide: true });
    const draw = (q = "") => { sh.el.querySelector("#psl").innerHTML = lib.filter((x) => !q || norm(x.title + " " + (x.artist || "")).includes(norm(q))).map((x) => `<a class="li" href="#/times/${teamId}/letras/${x.id}/simulador"><span class="cover">${icon("lyrics")}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(x.title)}</span><span class="s">${esc(x.artist || "")}</span></span>${x.id === songId ? icon("check") : ""}</a>`).join("") || `<p class="small muted" style="padding:10px">Nenhuma música encontrada.</p>`; };
    draw(); sh.el.querySelector("#psq").oninput = (e) => draw(e.target.value);
    sh.el.querySelector("#psl").addEventListener("click", () => setTimeout(() => sh.close(), 50));
  });
  const persist = async (b) => {
    busy(b);
    const bl = blocks(), style = { ...st }; delete style.ratio; if (!custom) delete style.layout;
    let err;
    if (song.own) err = (await sb.from("media_lyrics").update({ blocks: bl.length ? bl : null, style, updated_by: state.user.id, updated_at: new Date().toISOString() }).eq("id", songId)).error;
    else err = (await sb.from("lyric_slides").upsert({ team_id: teamId, song_id: songId, org_id: team.org_id, blocks: bl.length ? bl : null, style, updated_by: state.user.id, updated_at: new Date().toISOString() }, { onConflict: "team_id,song_id" })).error;
    busy(b, false);
    if (err) { toast(errMsg(err), "err"); return false; }
    dirty = false; toast("Versão salva"); return true;
  };
  on(el, "click", "#psave", (e, b) => persist(b));
  on(el, "click", "#ppptx", () => {
    const sl = slides(); if (!sl.length) return toast("Escreva a letra primeiro.", "err");
    download(buildPptx(pptxSlides(song.title, song.artist, sl, st, footer()), st), `${slug(song.title)}.pptx`); toast("PowerPoint gerado");
  });
  void original;
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
    const saved = mine.get(m.id), blocks = saved?.blocks?.length ? saved.blocks : m.blocks, st = { ...DEFAULT_STYLE, ...(saved?.style || {}), ratio: team.slide_ratio || "16:9", layout: layoutFor(team, saved?.style) };
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
  const slider = (key, label, min, max, step = 1, unit = "%") => `<div class="field"><span>${label} (${unit})</span><div class="numrow"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${L[key]}" aria-label="${label}"><input type="number" class="num" inputmode="decimal" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${L[key]}" aria-label="${label} em número"></div></div>`;
  const draw = () => {
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/letras/biblioteca">${icon("chevronLeft")}</a><h1>Padrão da letra</h1></div>
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
  el.addEventListener("input", (e) => {
    const k = e.target.dataset?.k; if (!k || e.target.value === "") return;
    const v = Math.min(+e.target.max, Math.max(+e.target.min, +e.target.value)); L[k] = v;
    el.querySelectorAll(`[data-k="${k}"]`).forEach((n) => { if (n !== e.target) n.value = v; }); repaint();
  });
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
