// Estúdio de mídia: apresentações de slides (música, pregação, aviso, contagem, imagem), biblioteca de fundos
// e exportação para PowerPoint. O que o programa de projeção da igreja abre (ProPresenter, Holyrics, PowerPoint).
import { sb, state, must, esc, attr, icon, sheet, toast, errMsg, busy, on, go, empty, spinner, teamHas, canManageTeam, pickFile, fDate, fTime, confirmDialog } from "../core.js";
import { buildPptx, RATIOS, ratioOf } from "../lib/pptx.js";
import { slidesOf, DEFAULT_STYLE, FONTS, loadLibrary } from "./letras.js";

export function register(route) {
  route("/times/:id/estudio", (p, el, a) => home(p.id, el, a));
  route("/times/:id/estudio/fundos", (p, el, a) => backgrounds(p.id, el, a));
  route("/times/:id/estudio/:deck", (p, el, a) => deckEditor(p.id, p.deck, el, a));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-06-estudio.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST|function/i.test(String(e?.message || e?.code || e));
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "apresentacao";
const BG_COLORS = ["#000000", "#0B1F3A", "#1B1B1B", "#12301F", "#3A1020", "#FFFFFF"], TEXT_COLORS = ["#FFFFFF", "#FFE066", "#9BD1FF", "#000000"];

// tipos de slide e o que cada um pede
export const KINDS = {
  letra: { nome: "Letra de música", icone: "lyrics" },
  titulo: { nome: "Título da pregação", icone: "file", campos: ["title", "text"], t: { title: "Título", text: "Pregador ou subtítulo" } },
  versiculo: { nome: "Versículo", icone: "lyrics", campos: ["text", "ref"], t: { text: "Texto do versículo", ref: "Referência (ex.: João 3.16)" } },
  topicos: { nome: "Tópicos", icone: "list", campos: ["title", "bullets"], t: { title: "Título", bullets: "Um tópico por linha" } },
  aviso: { nome: "Aviso", icone: "megaphone", campos: ["title", "text", "when"], t: { title: "Título do aviso", text: "Detalhes", when: "Quando / onde" } },
  contagem: { nome: "Contagem do culto", icone: "clock", campos: ["title", "when"], t: { title: "Texto de cima", when: "Horário (ex.: 19:00)" } },
  imagem: { nome: "Só imagem", icone: "image", campos: [] },
  branco: { nome: "Slide em branco", icone: "file", campos: [] },
};
const DEF = {
  titulo: { title: "Título da mensagem", text: "Pregador" },
  versiculo: { text: "Digite o texto do versículo.", ref: "Livro 0.0" },
  topicos: { title: "Pontos principais", bullets: "Primeiro ponto\nSegundo ponto\nTerceiro ponto" },
  aviso: { title: "Aviso", text: "Detalhes do aviso", when: "" },
  contagem: { title: "O culto começa em breve", when: "19:00" },
  imagem: {}, branco: {},
};

// caixas de texto de cada tipo. Medidas em fração do slide, tamanhos em pt (para uma tela de 13,33 pol. de largura)
export function boxesOf(s, st) {
  const k = s.kind || "letra", big = s.size || st.size || 54, cap = !!st.caps;
  const B = (o) => ({ caps: cap && o.caps !== false, ...o });
  if (k === "letra") {
    const out = [B({ text: s.text, size: big, y: 0.1, h: 0.8 })];
    if (st.showLabel && s.label) out.push({ text: s.label, size: 18, x: 0.04, y: 0.03, w: 0.5, h: 0.08, align: "l", anchor: "t", alpha: 0.6, bold: false, caps: cap });
    if (s.footer) out.push({ text: s.footer, size: 16, y: 0.92, h: 0.07, alpha: 0.65, bold: false, caps: false });
    return out;
  }
  if (k === "titulo") return [B({ text: s.title, size: Math.min(big + 12, 72), y: 0.25, h: 0.3, anchor: "b" }), B({ text: s.text, size: 34, y: 0.58, h: 0.2, anchor: "t", alpha: 0.85, bold: false, caps: false })];
  if (k === "versiculo") return [B({ text: s.text, size: Math.min(big - 6, 46), y: 0.1, h: 0.68, caps: false }), B({ text: s.ref, size: 28, x: 0.04, y: 0.8, w: 0.92, h: 0.12, align: "r", anchor: "t", alpha: 0.85, caps: false })];
  if (k === "topicos") return [B({ text: s.title, size: 46, y: 0.06, h: 0.16 }), B({ text: String(s.bullets || "").split("\n").filter((l) => l.trim()).map((l) => "• " + l.trim()).join("\n"), size: 36, x: 0.08, y: 0.25, w: 0.84, h: 0.68, align: "l", anchor: "t", bold: false, caps: false })];
  if (k === "aviso") return [B({ text: s.title, size: 54, y: 0.08, h: 0.2 }), B({ text: s.text, size: 34, y: 0.3, h: 0.45, bold: false, caps: false }), B({ text: s.when, size: 28, y: 0.78, h: 0.14, alpha: 0.85, caps: false })];
  if (k === "contagem") return [B({ text: s.title, size: 44, y: 0.18, h: 0.2 }), B({ text: s.when, size: 120, y: 0.4, h: 0.4, caps: false })];
  return [];
}

export const styleOf = (deck) => ({ ...DEFAULT_STYLE, ...(deck.style || {}) });
const dimOf = (s) => (s.bg?.asset ? (s.dim ?? 0.35) : 0);

// miniatura/visualização do slide, na mesma proporção da tela da projeção
export function thumb(s, st, ratio, { big = false } = {}) {
  const [a, b] = ratioOf(ratio), bgc = s.bg?.color || st.bg, img = s.bg?.asset;
  const boxes = boxesOf(s, st).map((x) => {
    const sz = (x.size || 54) / 9.6, al = { l: "left", r: "right" }[x.align] || "center", jc = { t: "flex-start", b: "flex-end" }[x.anchor] || "center";
    return `<div class="tb" style="left:${(x.x ?? 0.04) * 100}%;top:${(x.y ?? 0.06) * 100}%;width:${(x.w ?? 0.92) * 100}%;height:${(x.h ?? 0.88) * 100}%;font-size:${sz}cqw;text-align:${al};justify-content:${jc};font-weight:${x.bold === false ? 400 : 700};opacity:${x.alpha ?? 1}"><span>${esc(x.caps ? String(x.text || "").toUpperCase() : x.text || "")}</span></div>`;
  }).join("");
  return `<div class="thumb st" style="aspect-ratio:${a} / ${b};background:${attr(bgc)};color:${attr(s.color || st.color)};font-family:'${attr(st.font)}',sans-serif${big ? ";width:100%" : ""}">
    ${img ? `<img src="${attr(img)}" alt="" loading="lazy">` : ""}${dimOf(s) ? `<i class="dim" style="opacity:${dimOf(s)}"></i>` : ""}${boxes}</div>`;
}

// ---------------------------------------------------------------- dados
const teamOf = async (id) => state.orgTeams.find((t) => t.id === id) || (await must(sb.from("teams").select("*").eq("id", id).maybeSingle()));
export const ratioFor = (team) => team?.slide_ratio || "16:9";

// baixa a imagem do fundo e entrega em JPEG (1920 px no máximo) para entrar no PowerPoint
const imgCache = new Map();
async function imageBytes(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1920 / bmp.width), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  const v = { bytes: new Uint8Array(await out.arrayBuffer()), ext: "jpg" };
  imgCache.set(url, v); return v;
}

export async function deckToPptx(deck, ratio) {
  const st = { ...styleOf(deck), ratio };
  const slides = [];
  for (const s of deck.slides || []) {
    const out = { boxes: boxesOf(s, st), bg: s.bg?.color || st.bg, color: s.color, dim: dimOf(s) || 0 };
    out.boxes = out.boxes.map((b) => ({ ...b, color: s.color || b.color }));
    if (s.bg?.asset) { try { out.bgImage = await imageBytes(s.bg.asset); } catch { /* fica com a cor */ } }
    slides.push(out);
  }
  return buildPptx(slides, st);
}

function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
export const deckToText = (deck) => (deck.slides || []).map((s, i) => `--- Slide ${i + 1} (${KINDS[s.kind || "letra"]?.nome}) ---\n${[s.label && `[${s.label}]`, s.title, s.text, s.bullets, s.ref, s.when].filter(Boolean).join("\n")}`).join("\n\n") + "\n";

// letras da música como slides, com o estilo e as partes que a mídia já salvou
async function songSlides(team, song, per) {
  const saved = song.own ? { blocks: song.lyrics?.blocks, style: song.style } : (await sb.from("lyric_slides").select("blocks,style").eq("team_id", team.id).eq("song_id", song.id).maybeSingle()).data;
  const blocks = saved?.blocks?.length ? saved.blocks : song.lyrics?.blocks || [];
  const footer = [song.title, song.artist].filter(Boolean).join(" · ");
  return slidesOf(blocks, saved?.style?.per || per).map((x) => ({ id: uid(), kind: "letra", label: x.label, text: x.text, footer, song: song.id }));
}
const loadLib = async (teamId) => loadLibrary(teamId).catch(() => []);

// monta a apresentação do culto a partir da escala: músicas com letra, avisos e pregação do roteiro
async function deckFromSchedule(team, s) {
  const lib = new Map((await loadLib(team.id)).map((x) => [x.id, x]));
  let songs = (await sb.from("schedule_songs").select("song_id,position").eq("schedule_id", s.id).order("position")).data || [];
  if (!songs.length) songs = ((await sb.rpc("service_songs", { p_schedule: s.id })).data || []).map((x) => ({ song_id: x.song_id }));
  const cues = (await sb.from("schedule_cues").select("at_time,title,responsible,kind,position").eq("schedule_id", s.id).order("position")).data || [];
  const slides = [{ id: uid(), kind: "contagem", title: s.title, when: fTime(s.starts_at) }];
  const song = async () => { const sg = songs.shift(); const m = sg && lib.get(sg.song_id); if (m) slides.push(...(await songSlides(team, m, 2))); };
  for (const c of cues) {
    if (c.kind === "louvor") { const before = slides.length; await song(); if (slides.length === before) slides.push({ id: uid(), kind: "titulo", title: c.title, text: c.responsible || "" }); }
    else if (c.kind === "pregacao") slides.push({ id: uid(), kind: "titulo", title: c.title, text: c.responsible || "" });
    else if (c.kind === "avisos") slides.push({ id: uid(), kind: "aviso", title: "Avisos", text: "", when: "" });
    else if (c.kind === "oferta") slides.push({ id: uid(), kind: "titulo", title: "Ofertas e dízimos", text: c.responsible || "" });
    else if (!["abertura", "encerramento"].includes(c.kind)) slides.push({ id: uid(), kind: "titulo", title: c.title, text: c.responsible || "" });
  }
  while (songs.length) { const before = slides.length; await song(); if (slides.length === before) break; }
  return slides;
}

// ---------------------------------------------------------------- início do estúdio
async function home(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!team || !teamHas(team, "estudio")) { el.innerHTML = empty("sparkle", "Este time não usa o estúdio de mídia."); return; }
  let decks;
  const r = await sb.from("studio_decks").select("id,title,slides,updated_at,schedule_id").eq("team_id", teamId).order("updated_at", { ascending: false });
  if (r.error) { el.innerHTML = missing(r.error) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(r.error)); return; }
  decks = r.data || [];
  if (!alive()) return;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Estúdio de mídia</h1><button class="btn primary sm" id="new">${icon("plus")} Nova</button></div>
    <p class="muted small">Monte as apresentações do culto aqui e baixe em PowerPoint para abrir no programa de projeção. Tela atual: <b>${esc(RATIOS[ratioFor(team)] || ratioFor(team))}</b>. Para mudar, vá em Letras.</p>
    <div class="sec"><h2>Apresentações</h2></div>
    ${decks.length ? `<div class="list">${decks.map((d) => `<a class="li" href="#/times/${teamId}/estudio/${d.id}"><span class="cover">${icon("layers")}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(d.title)}</span><span class="s">${d.slides?.length || 0} slides · ${fDate(d.updated_at)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`
      : `<div class="card">${empty("layers", "Nenhuma apresentação ainda", "Toque em Nova para criar a primeira, em branco ou a partir de uma escala.")}</div>`}
    <div class="sec"><h2>Ferramentas</h2></div>
    <div class="list">
      <a class="li" href="#/times/${teamId}/estudio/fundos"><span class="cover">${icon("image")}</span><span class="grow"><span class="t">Fundos</span><span class="s">Imagens do time para usar nos slides</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/times/${teamId}/letras"><span class="cover">${icon("lyrics")}</span><span class="grow"><span class="t">Letras das músicas</span><span class="s">Partes, estilo e tela da projeção</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/times/${teamId}/estudio/imagem"><span class="cover">${icon("camera")}</span><span class="grow"><span class="t">Editor de imagem</span><span class="s">Cortar, texto sobre foto, filtros</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/times/${teamId}/estudio/video"><span class="cover">${icon("play")}</span><span class="grow"><span class="t">Vídeos prontos</span><span class="s">Abertura, encerramento e contagem regressiva</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/times/${teamId}/estudio/legendas"><span class="cover">${icon("file")}</span><span class="grow"><span class="t">Legendas</span><span class="s">Legenda de vídeo gravado (arquivo .srt)</span></span>${icon("chevronRight", "chev")}</a>
    </div>`;
  el.querySelector("#new").onclick = () => newDeck(team, decks);
}

function newDeck(team) {
  const s = sheet(`<h3>Nova apresentação</h3>
    <label class="field"><span>Nome</span><input id="dt" maxlength="120" placeholder="Ex.: Culto de domingo"></label>
    <div class="list">
      <button class="li" data-mode="blank"><span class="cover">${icon("file")}</span><span class="grow"><span class="t">Em branco</span><span class="s">Você adiciona os slides</span></span>${icon("chevronRight", "chev")}</button>
      <button class="li" data-mode="sched"><span class="cover">${icon("calendar")}</span><span class="grow"><span class="t">A partir de uma escala</span><span class="s">Músicas com letra e a ordem do roteiro</span></span>${icon("chevronRight", "chev")}</button>
      <button class="li" data-mode="preg"><span class="cover">${icon("megaphone")}</span><span class="grow"><span class="t">Pregação</span><span class="s">Título, versículo e tópicos prontos para editar</span></span>${icon("chevronRight", "chev")}</button>
    </div><div id="pick"></div>`);
  const create = async (title, slides, schedule_id = null) => {
    const r = await sb.from("studio_decks").insert({ team_id: team.id, org_id: team.org_id, title: title.trim() || "Apresentação", slides, style: {}, schedule_id, created_by: state.user.id, updated_by: state.user.id }).select("id").single();
    if (r.error) return toast(missing(r.error) ? "Falta rodar a atualização do banco." : errMsg(r.error), "err");
    s.close(); go(`/times/${team.id}/estudio/${r.data.id}`);
  };
  on(s.el, "click", "[data-mode]", async (e, b) => {
    const title = s.el.querySelector("#dt").value;
    if (b.dataset.mode === "blank") return create(title, []);
    if (b.dataset.mode === "preg") return create(title || "Pregação", ["titulo", "versiculo", "topicos"].map((k) => ({ id: uid(), kind: k, ...DEF[k] })));
    const from = new Date(Date.now() - 86400e3).toISOString();
    const ss = (await sb.from("schedules").select("id,title,starts_at,team_id").eq("team_id", team.id).gte("starts_at", from).order("starts_at").limit(12)).data || [];
    const all = ss.length ? ss : ((await sb.from("schedules").select("id,title,starts_at,team_id").eq("org_id", team.org_id).gte("starts_at", from).order("starts_at").limit(12)).data || []);
    s.el.querySelector("#pick").innerHTML = all.length ? `<div class="sec"><h2>Escolha a escala</h2></div><div class="list">${all.map((x) => `<button class="li" data-sch="${x.id}"><span class="grow"><span class="t">${esc(x.title)}</span><span class="s">${fDate(x.starts_at)} às ${fTime(x.starts_at)}</span></span>${icon("chevronRight", "chev")}</button>`).join("")}</div>` : `<p class="small muted">Nenhuma escala próxima.</p>`;
    s.el.querySelectorAll("[data-sch]").forEach((x) => x.addEventListener("click", async () => {
      busy(x); const sc = all.find((q) => q.id === x.dataset.sch);
      try { const sl = await deckFromSchedule(team, sc); await create(s.el.querySelector("#dt").value || sc.title, sl, sc.id); } catch (err) { toast(errMsg(err), "err"); busy(x, false); }
    }));
  });
}

// ---------------------------------------------------------------- fundos
export async function loadAssets(teamId) {
  const r = await sb.from("studio_assets").select("*").eq("team_id", teamId).order("created_at", { ascending: false });
  return r.error ? [] : r.data || [];
}
async function uploadBackground(team, file) {
  const f = await shrink(file, 1920);
  const path = `studio/${team.org_id}/${team.id}/${Date.now()}-${uid()}.jpg`;
  const up = await sb.storage.from("media").upload(path, f, { upsert: false });
  if (up.error) throw up.error;
  const url = sb.storage.from("media").publicUrl(path);
  const r = await sb.from("studio_assets").insert({ team_id: team.id, org_id: team.org_id, name: (file.name || "Imagem").replace(/\.\w+$/, "").slice(0, 100), kind: "imagem", path, url, created_by: state.user.id }).select("*").single();
  if (r.error) throw r.error;
  return r.data;
}
async function shrink(file, max) {
  const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  return new File([blob], "fundo.jpg", { type: "image/jpeg" });
}

async function backgrounds(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!team || !teamHas(team, "estudio")) { el.innerHTML = empty("sparkle", "Este time não usa o estúdio de mídia."); return; }
  const draw = async () => {
    const list = await loadAssets(teamId); if (!alive()) return;
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/estudio">${icon("chevronLeft")}</a><h1>Fundos</h1><button class="btn primary sm" id="up">${icon("plus")} Imagem</button></div>
      <p class="muted small">Imagens do time para usar como fundo nos slides. Fotos grandes são reduzidas para 1920 px.</p>
      ${list.length ? `<div class="bggrid">${list.map((a) => `<div class="bgi"><img src="${attr(a.url)}" alt="${attr(a.name)}" loading="lazy"><span class="ellipsis">${esc(a.name)}</span><button class="x" data-del="${a.id}" aria-label="Excluir">${icon("trash")}</button></div>`).join("")}</div>` : `<div class="card">${empty("image", "Nenhum fundo ainda", "Envie fotos e artes que a igreja usa nos slides.")}</div>`}`;
    el.querySelector("#up").onclick = async (e) => {
      const f = await pickFile("image/*"); if (!f) return; busy(e.currentTarget);
      try { await uploadBackground(team, f); toast("Fundo adicionado"); } catch (err) { toast(missing(err) ? "Falta rodar a atualização do banco." : errMsg(err), "err"); }
      draw();
    };
    on(el, "click", "[data-del]", async (e, b) => {
      if (!(await confirmDialog("Excluir este fundo? Slides que o usam ficam só com a cor.", "Excluir", true))) return;
      const a = list.find((x) => x.id === b.dataset.del);
      await sb.storage.from("media").remove([a.path]).catch(() => {});
      const r = await sb.from("studio_assets").delete().eq("id", a.id); if (r.error) toast(errMsg(r.error), "err"); draw();
    });
  };
  draw();
}

// ---------------------------------------------------------------- editor da apresentação
async function deckEditor(teamId, deckId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  const r = await sb.from("studio_decks").select("*").eq("id", deckId).eq("team_id", teamId).maybeSingle();
  if (r.error) { el.innerHTML = missing(r.error) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(r.error)); return; }
  const deck = r.data;
  if (!deck || !team) { el.innerHTML = empty("layers", "Apresentação não encontrada"); return; }
  if (!alive()) return;
  const ratio = ratioFor(team);
  let dirty = false, timer = null;
  const save = async (msg) => {
    clearTimeout(timer); dirty = false;
    const u = await sb.from("studio_decks").update({ title: deck.title, slides: deck.slides, style: deck.style, updated_by: state.user.id, updated_at: new Date().toISOString() }).eq("id", deck.id);
    if (u.error) return toast(errMsg(u.error), "err");
    if (msg) toast(msg);
  };
  const later = () => { dirty = true; clearTimeout(timer); timer = setTimeout(() => save(), 900); };
  const st = () => styleOf(deck);

  const draw = () => {
    const slides = deck.slides || [];
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/estudio">${icon("chevronLeft")}</a><div class="grow" style="min-width:0"><input class="input dtitle2" id="dtitle" value="${attr(deck.title)}" maxlength="120" aria-label="Nome da apresentação"></div></div>
      <div class="row gap wrap"><button class="btn primary grow" id="add">${icon("plus")} Slide</button><button class="btn ghost grow" id="sty">${icon("sliders")} Estilo</button></div>
      <div class="sec"><h2>Slides <small class="muted">${slides.length}</small></h2></div>
      ${slides.length ? `<div class="deck">${slides.map((s, i) => `<div class="dslide" data-i="${i}">
        <button class="dthumb" data-edit="${i}" aria-label="Editar slide ${i + 1}">${thumb(s, st(), ratio)}</button>
        <div class="dbar"><span class="n">${i + 1}</span><span class="k ellipsis">${esc(KINDS[s.kind || "letra"]?.nome || "")}</span>
          <button data-up="${i}" ${i ? "" : "disabled"} aria-label="Subir">↑</button><button data-dn="${i}" ${i < slides.length - 1 ? "" : "disabled"} aria-label="Descer">↓</button>
          <button data-dup="${i}" aria-label="Duplicar">${icon("copy")}</button><button data-rm="${i}" aria-label="Excluir">${icon("trash")}</button></div></div>`).join("")}</div>`
        : `<div class="card">${empty("layers", "Sem slides", "Toque em + Slide para adicionar música, título, versículo, aviso ou contagem.")}</div>`}
      <div class="row gap mt wrap"><button class="btn primary grow" id="pptx">${icon("download")} PowerPoint (.pptx)</button><button class="btn ghost grow" id="txt">${icon("file")} Texto (.txt)</button></div>
      <p class="tiny muted" style="margin-top:8px">Tela: ${esc(RATIOS[ratio] || ratio)}. Salva sozinho. A fonte precisa estar instalada no computador onde o arquivo for aberto.</p>
      <button class="btn ghost danger block mt" id="del">${icon("trash")} Excluir apresentação</button>`;
  };
  draw();

  const move = (i, d) => { const a = deck.slides; [a[i], a[i + d]] = [a[i + d], a[i]]; draw(); later(); };
  on(el, "click", "[data-edit]", (e, b) => editSlide(+b.dataset.edit));
  on(el, "click", "[data-up]", (e, b) => move(+b.dataset.up, -1));
  on(el, "click", "[data-dn]", (e, b) => move(+b.dataset.dn, 1));
  on(el, "click", "[data-dup]", (e, b) => { const i = +b.dataset.dup; deck.slides.splice(i + 1, 0, { ...structuredClone(deck.slides[i]), id: uid() }); draw(); later(); });
  on(el, "click", "[data-rm]", async (e, b) => { if (!(await confirmDialog("Excluir este slide?", "Excluir", true))) return; deck.slides.splice(+b.dataset.rm, 1); draw(); later(); });
  el.addEventListener("input", (e) => { if (e.target.id === "dtitle") { deck.title = e.target.value.trim() || "Apresentação"; later(); } });
  on(el, "click", "#add", () => addSheet());
  on(el, "click", "#sty", () => styleSheet());
  on(el, "click", "#txt", () => download(new Blob([deckToText(deck)], { type: "text/plain;charset=utf-8" }), `${slug(deck.title)}.txt`));
  on(el, "click", "#pptx", async (e, b) => {
    if (!deck.slides.length) return toast("Adicione ao menos um slide.", "err");
    busy(b);
    try { download(await deckToPptx(deck, ratio), `${slug(deck.title)}.pptx`); toast("PowerPoint gerado"); } catch (err) { toast(errMsg(err), "err"); }
    busy(b, false);
  });
  on(el, "click", "#del", async () => {
    if (!(await confirmDialog("Excluir esta apresentação inteira?", "Excluir", true))) return;
    const d = await sb.from("studio_decks").delete().eq("id", deck.id); if (d.error) return toast(errMsg(d.error), "err");
    toast("Apresentação excluída"); go(`/times/${teamId}/estudio`);
  });
  window.addEventListener("hashchange", () => { if (dirty) save(); }, { once: true });

  function addSheet() {
    const s = sheet(`<h3>Adicionar slide</h3><div class="list">${["letra", "titulo", "versiculo", "topicos", "aviso", "contagem", "imagem", "branco"].map((k) => `<button class="li" data-k="${k}"><span class="cover">${icon(KINDS[k].icone)}</span><span class="grow"><span class="t">${KINDS[k].nome}</span></span>${icon("chevronRight", "chev")}</button>`).join("")}</div>`);
    on(s.el, "click", "[data-k]", async (e, b) => {
      const k = b.dataset.k;
      if (k === "letra") { s.close(); return songSheet(); }
      s.close(); deck.slides.push({ id: uid(), kind: k, ...DEF[k] }); draw(); later(); editSlide(deck.slides.length - 1);
    });
  }
  async function songSheet() {
    const lib = await loadLib(teamId);
    const s = sheet(`<h3>Música do repertório</h3><label class="search srch" style="display:block">${icon("search")}<input class="input" id="sq" placeholder="Procurar música"></label><div class="list mt" id="sl"></div>`, { wide: true });
    const paint = (q = "") => { s.el.querySelector("#sl").innerHTML = lib.filter((x) => !q || (x.title + " " + (x.artist || "")).toLowerCase().includes(q.toLowerCase())).map((x) => `<button class="li" data-s="${x.id}"><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(x.title)}</span><span class="s">${esc(x.artist || "")}</span></span>${icon("plus")}</button>`).join("") || `<p class="small muted" style="padding:10px">Nenhuma música com letra.</p>`; };
    paint(); s.el.querySelector("#sq").oninput = (e) => paint(e.target.value);
    on(s.el, "click", "[data-s]", async (e, b) => {
      busy(b); const m = lib.find((x) => x.id === b.dataset.s);
      deck.slides.push({ id: uid(), kind: "titulo", title: m.title, text: m.artist || "" });
      deck.slides.push(...(await songSlides(team, m, st().per)));
      s.close(); draw(); later(); toast("Música adicionada");
    });
  }
  function styleSheet() {
    const cur = st();
    const sw = (key, list) => `<div class="swatches">${list.map((c) => `<button type="button" class="sw${String(cur[key]).toLowerCase() === c.toLowerCase() ? " on" : ""}" data-sw="${key}:${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}<label class="sw custom"><input type="color" data-color="${key}" value="${attr(cur[key])}">${icon("plus")}</label></div>`;
    const s = sheet(`<h3>Estilo da apresentação</h3>
      <div class="two"><label class="field"><span>Fonte</span><select id="f">${FONTS.map((f) => `<option ${cur.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
        <label class="field"><span>Tamanho da letra (<b id="szv">${cur.size}</b> pt)</span><input type="range" id="sz" min="28" max="90" step="2" value="${cur.size}"></label></div>
      <div class="field"><span>Cor do texto</span>${sw("color", TEXT_COLORS)}</div><div class="field"><span>Cor do fundo</span>${sw("bg", BG_COLORS)}</div>
      <label class="check"><input type="checkbox" id="cp" ${cur.caps ? "checked" : ""}> Letras maiúsculas</label>
      <label class="check"><input type="checkbox" id="lb" ${cur.showLabel ? "checked" : ""}> Mostrar nome da parte (Verso, Refrão)</label>
      <p class="tiny muted">Vale para todos os slides. Cada slide pode ter fundo e cor próprios.</p><button class="btn primary block" id="ok">Pronto</button>`);
    const set = (k, v) => { deck.style = { ...(deck.style || {}), [k]: v }; draw(); later(); };
    s.el.querySelector("#f").onchange = (e) => set("font", e.target.value);
    s.el.querySelector("#sz").oninput = (e) => { s.el.querySelector("#szv").textContent = e.target.value; deck.style = { ...(deck.style || {}), size: +e.target.value }; draw(); later(); };
    s.el.querySelector("#cp").onchange = (e) => set("caps", e.target.checked);
    s.el.querySelector("#lb").onchange = (e) => set("showLabel", e.target.checked);
    on(s.el, "click", "[data-sw]", (e, b) => { const [k, v] = b.dataset.sw.split(":"); set(k, v); s.close(); styleSheet(); });
    s.el.querySelectorAll("[data-color]").forEach((i) => i.addEventListener("change", (e) => { set(i.dataset.color, e.target.value); }));
    s.el.querySelector("#ok").onclick = () => s.close();
  }
  async function editSlide(i) {
    const slide = deck.slides[i], k = slide.kind || "letra", kd = KINDS[k], assets = await loadAssets(teamId);
    const fields = k === "letra" ? ["label", "text", "footer"] : kd.campos || [];
    const names = { label: "Nome da parte", text: k === "letra" ? "Letra" : kd.t?.text, footer: "Rodapé (música e autor)", ...(kd.t || {}) };
    const area = new Set(["text", "bullets"]);
    const bgSw = BG_COLORS.map((c) => `<button type="button" class="sw${(slide.bg?.color || "").toLowerCase() === c.toLowerCase() && !slide.bg?.asset ? " on" : ""}" data-bgc="${c}" style="background:${c}" aria-label="${c}"></button>`).join("");
    const s = sheet(`<h3>${esc(kd.nome)}</h3><div id="prev">${thumb(slide, st(), ratio, { big: true })}</div>
      ${fields.map((f) => `<label class="field"><span>${esc(names[f])}</span>${area.has(f) ? `<textarea data-f="${f}" rows="${f === "text" && k === "letra" ? 5 : 4}">${esc(slide[f] || "")}</textarea>` : `<input data-f="${f}" value="${attr(slide[f] || "")}" maxlength="200">`}</label>`).join("")}
      <div class="field"><span>Fundo</span><div class="swatches"><button type="button" class="sw${!slide.bg ? " on" : ""}" data-bgc="" style="background:var(--raised)" title="Padrão da apresentação">${icon("check")}</button>${bgSw}</div></div>
      ${assets.length ? `<div class="bgpick">${assets.map((a) => `<button type="button" class="bgp${slide.bg?.asset === a.url ? " on" : ""}" data-bga="${attr(a.url)}"><img src="${attr(a.url)}" alt="${attr(a.name)}" loading="lazy"></button>`).join("")}</div>` : `<p class="tiny muted">Envie imagens em Fundos para usar aqui.</p>`}
      ${slide.bg?.asset ? `<label class="field"><span>Escurecer a imagem (<b id="dv">${Math.round((slide.dim ?? 0.35) * 100)}</b>%)</span><input type="range" id="dim" min="0" max="80" step="5" value="${Math.round((slide.dim ?? 0.35) * 100)}"></label>` : ""}
      <div class="field"><span>Cor do texto deste slide</span><div class="swatches"><button type="button" class="sw${!slide.color ? " on" : ""}" data-tc="" style="background:var(--raised)" title="Padrão">${icon("check")}</button>${TEXT_COLORS.map((c) => `<button type="button" class="sw${(slide.color || "").toLowerCase() === c.toLowerCase() ? " on" : ""}" data-tc="${c}" style="background:${c}"></button>`).join("")}</div></div>
      <button class="btn primary block" id="ok">Pronto</button>`, { wide: true });
    const refresh = () => { s.el.querySelector("#prev").innerHTML = thumb(slide, st(), ratio, { big: true }); draw(); later(); };
    s.el.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener("input", () => { slide[inp.dataset.f] = inp.value; s.el.querySelector("#prev").innerHTML = thumb(slide, st(), ratio, { big: true }); later(); }));
    on(s.el, "click", "[data-bgc]", (e, b) => { slide.bg = b.dataset.bgc ? { color: b.dataset.bgc } : undefined; if (!slide.bg) delete slide.bg; refresh(); s.close(); editSlide(i); });
    on(s.el, "click", "[data-bga]", (e, b) => { slide.bg = { ...(slide.bg || {}), asset: b.dataset.bga }; refresh(); s.close(); editSlide(i); });
    on(s.el, "click", "[data-tc]", (e, b) => { if (b.dataset.tc) slide.color = b.dataset.tc; else delete slide.color; refresh(); s.close(); editSlide(i); });
    s.el.querySelector("#dim")?.addEventListener("input", (e) => { slide.dim = +e.target.value / 100; s.el.querySelector("#dv").textContent = e.target.value; s.el.querySelector("#prev").innerHTML = thumb(slide, st(), ratio, { big: true }); later(); });
    s.el.querySelector("#ok").onclick = () => { s.close(); draw(); };
  }
}
