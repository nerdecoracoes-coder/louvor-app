// Biblioteca geral (uma por organização): lista, filtros, cadastro manual, detalhe, anexos e letra.
import { sb, state, must, esc, attr, icon, headerActions, isRepertoireStaff as isStaff, hasRepertoire, isAdmin, sheet, toast, errMsg, busy, on, go, empty, spinner, fDate, fDur, safeUrl, confirmDialog, uploadPublic, pickFile, people } from "../core.js";

const onlyRep = (fn) => (p, el, a) => hasRepertoire() ? fn(p, el, a)
  : (el.innerHTML = empty("music", "Repertório disponível para times de Louvor", "Você não participa de nenhum time que usa o repertório."));
export function register(route) {
  route("/musicas", onlyRep(library));
  route("/musicas/nova", onlyRep((p, el) => songForm(el, null)));
  route("/musicas/tocadas", onlyRep(playedPage));
  route("/musica/:id", onlyRep((p, el) => songDetail(el, p.id)));
  route("/musica/:id/editar", onlyRep((p, el) => songForm(el, p.id)));
  route("/musica/:id/letra", onlyRep((p, el) => lyricsEditor(el, p.id)));
}

const STATUS = {
  processing: ["Processando", "soft"], waiting_files: ["Aguardando arquivos", "warn"], error: ["Erro na importação", "err"], removed: ["Fora do repertório", "gray"],
};

export function songRow(s, { selectable = false, selected = false } = {}) {
  const vs = !!s.current_project_id;
  const playable = vs && s.status === "ready";
  const st = STATUS[s.status];
  return `<div class="song" data-song="${s.id}">
    ${selectable ? `<span class="selbox ${selected ? "on" : ""}" data-sel="${s.id}">${icon("check")}</span>` : ""}
    <a class="cover" href="#/musica/${s.id}">${s.cover_url ? `<img src="${attr(s.cover_url)}" alt="" loading="lazy">` : icon("music")}</a>
    <a href="#/musica/${s.id}" style="color:inherit;min-width:0" class="grow">
      <div class="t ellipsis">${esc(s.title)}</div>
      <div class="s">${s.artist ? `<span>${esc(s.artist)}</span>` : ""}${s.song_key ? `<span>Tom ${esc(s.song_key)}</span>` : ""}${s.bpm ? `<span>${Number(s.bpm)} BPM</span>` : ""}${s.duration_sec ? `<span>${fDur(s.duration_sec)}</span>` : ""}</div>
      <div class="ind">${vs ? `<span class="tag soft">VS</span>` : ""}${s.youtube_url ? `<span class="tag gray">YouTube</span>` : ""}${s.chords_url ? `<span class="tag gray">Cifra</span>` : ""}
        ${s.lyrics?.blocks?.length ? `<span class="tag gray">Letra</span>` : ""}${s.files_count ? `<span class="tag gray">${s.files_count} arquivo(s)</span>` : ""}${(s.links || []).length ? `<span class="tag gray">Links</span>` : ""}
        ${st ? `<span class="tag ${st[1]}">${st[0]}</span>` : ""}${s.duplicate_of ? `<span class="tag warn">Possível duplicada</span>` : ""}</div></a>
    ${playable ? `<a class="playbtn" href="#/player/${s.id}" aria-label="Tocar ${attr(s.title)}">${icon("play")}</a>`
      : s.youtube_url && safeUrl(s.youtube_url) ? `<a class="playbtn" href="${attr(s.youtube_url)}" target="_blank" rel="noopener" aria-label="YouTube">${icon("youtube")}</a>` : `<span class="playbtn dis">${icon("play")}</span>`}
  </div>`;
}

async function library(_, el, alive) {
  el.innerHTML = spinner();
  const [rows, files] = await Promise.all([
    must(sb.from("songs").select("id,title,artist,song_key,bpm,duration_sec,cover_url,youtube_url,chords_url,links,lyrics,source,status,current_project_id,duplicate_of").eq("org_id", state.org.id).order("title")),
    must(sb.from("song_files").select("song_id").eq("org_id", state.org.id)),
  ]);
  if (!alive()) return;
  const fc = new Map(); for (const f of files) fc.set(f.song_id, (fc.get(f.song_id) || 0) + 1);
  rows.forEach((r) => (r.files_count = fc.get(r.id) || 0));
  const NOART = "Sem artista";
  let q = "", tab = "musicas", artist = null, searching = false;
  headerActions(`<button class="iconbtn" id="lupa" aria-label="Pesquisar">${icon("search")}</button>`);
  const draw = () => {
    const ql = q.toLowerCase();
    let list = rows.filter((r) => r.status !== "removed")
      .filter((r) => !ql || r.title.toLowerCase().includes(ql) || (r.artist || "").toLowerCase().includes(ql));
    if (tab === "vs") list = list.filter((r) => r.current_project_id);
    const box = el.querySelector("#list");
    let count;
    if (tab === "artistas" && artist === null) {
      const g = new Map();
      for (const r of list) { const k = r.artist || NOART; if (!g.has(k)) g.set(k, { n: 0, cover: null }); const x = g.get(k); x.n++; x.cover ||= r.cover_url; }
      const names = [...g.keys()].sort((a, b) => (a === NOART) - (b === NOART) || a.localeCompare(b));
      box.innerHTML = names.length ? names.map((n) => `<button class="li" data-art="${attr(n)}"><span class="cover" style="width:48px;height:48px">${g.get(n).cover ? `<img src="${attr(g.get(n).cover)}" alt="" loading="lazy">` : icon("mic")}</span>
        <span class="grow" style="min-width:0"><span class="t ellipsis" style="display:block">${esc(n)}</span><span class="s">${g.get(n).n} música${g.get(n).n === 1 ? "" : "s"}</span></span>${icon("chevronRight", "chev")}</button>`).join("")
        : `<div style="padding:10px">${empty("mic", "Nenhum artista encontrado")}</div>`;
      count = `${names.length} artista${names.length === 1 ? "" : "s"}`;
    } else {
      if (tab === "artistas") list = list.filter((r) => (r.artist || NOART) === artist);
      box.innerHTML = (tab === "artistas" ? `<div class="row gap" style="padding:4px 0 10px"><button class="chip" id="allart">${icon("chevronLeft")} Artistas</button><b class="ellipsis">${esc(artist)}</b></div>` : "")
        + (list.length ? list.map((r) => songRow(r)).join("")
          : `<div style="padding:10px">${empty("music", rows.length ? "Nenhuma música encontrada" : "Repertório vazio", rows.length ? "" : isStaff() ? `Cadastre músicas manualmente ou <a class="link" href="#/org/drive">conecte a pasta do Google Drive</a>.` : "")}</div>`);
      count = `${list.length} música${list.length === 1 ? "" : "s"}`;
    }
    el.querySelector("#count").textContent = count;
  };
  const processing = rows.filter((r) => ["processing", "waiting_files"].includes(r.status)).length;
  el.innerHTML = `<div class="pagehead"><h1>Músicas</h1>${isStaff() ? `<a class="iconbtn" href="#/org/drive" aria-label="Google Drive">${icon("cloud")}</a><a class="iconbtn add" href="#/musicas/nova" aria-label="Adicionar música">${icon("plus")}</a>` : ""}</div>
    ${processing ? `<div class="card mb row gap small">${icon("refresh", "accent")}<span>${processing} música(s) ainda sendo processada(s) a partir do Google Drive.</span></div>` : ""}
    <div class="tabsbar" role="tablist"><button class="on" data-tab="musicas">Músicas</button><button data-tab="artistas">Artistas</button><button data-tab="vs">Com VS</button></div>
    <label class="search srch hidden" id="sbox" style="display:block">${icon("search")}<input class="input" id="q" placeholder="Pesquisar por título ou artista"></label>
    <div class="small muted" id="count"></div>
    <div class="list mt-s" id="list"></div>`;
  draw();
  const sbox = el.querySelector("#sbox");
  document.getElementById("lupa")?.addEventListener("click", () => {
    searching = !searching; sbox.classList.toggle("hidden", !searching);
    if (searching) el.querySelector("#q").focus(); else { q = ""; el.querySelector("#q").value = ""; draw(); }
  });
  el.querySelector("#q").oninput = (e) => { q = e.target.value.trim(); draw(); };
  on(el, "click", "[data-tab]", (e, b) => { tab = b.dataset.tab; artist = null; el.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  on(el, "click", "[data-art]", (e, b) => { artist = b.dataset.art; draw(); });
  on(el, "click", "#allart", () => { artist = null; draw(); });
}

// ---------------------------------------------------------------- músicas tocadas (histórico das escalas publicadas)
async function playedPage(_, el, alive) {
  el.innerHTML = spinner();
  let q = sb.from("schedule_songs").select("song_id,schedules!inner(starts_at,status,team_id)").eq("org_id", state.org.id)
    .eq("schedules.status", "published").lt("schedules.starts_at", new Date().toISOString()).limit(5000);
  if (state.space) q = q.eq("schedules.team_id", state.space.id);
  const [rows, songs] = await Promise.all([must(q), must(sb.from("songs").select("id,title,artist,cover_url").eq("org_id", state.org.id).eq("status", "ready").order("title"))]);
  if (!alive()) return;
  const by = new Map();
  for (const r of rows) {
    if (!r.song_id) continue;
    const x = by.get(r.song_id) || { n: 0, last: "" };
    x.n++; if (r.schedules.starts_at > x.last) x.last = r.schedules.starts_at; by.set(r.song_id, x);
  }
  let tab = "mais";
  const row = (sg) => { const x = by.get(sg.id); return `<a class="song" href="#/musica/${sg.id}"><span class="cover">${sg.cover_url ? `<img src="${attr(sg.cover_url)}" alt="" loading="lazy">` : icon("music")}</span>
    <span class="grow" style="min-width:0"><div class="t ellipsis">${esc(sg.title)}</div><div class="s">${sg.artist ? `<span>${esc(sg.artist)}</span>` : ""}<span>${x ? `${x.n} ${x.n === 1 ? "vez" : "vezes"} · última em ${fDate(x.last)}` : "Nunca tocada"}</span></div></span>${icon("chevronRight", "chev")}</a>`; };
  const draw = () => {
    let list = songs.filter((sg) => (tab === "nunca" ? !by.has(sg.id) : by.has(sg.id)));
    if (tab === "mais") list.sort((a, b) => by.get(b.id).n - by.get(a.id).n || by.get(b.id).last.localeCompare(by.get(a.id).last));
    if (tab === "antigas") list.sort((a, b) => by.get(a.id).last.localeCompare(by.get(b.id).last));
    el.querySelector("#list").innerHTML = list.length ? list.map(row).join("") : `<div style="padding:10px">${empty("music", tab === "nunca" ? "Todas as músicas já foram tocadas" : "Nenhuma música tocada ainda", tab === "nunca" ? "" : "Quando houver escalas publicadas com músicas, o histórico aparece aqui.")}</div>`;
    el.querySelector("#count").textContent = `${list.length} música${list.length === 1 ? "" : "s"}`;
  };
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()" aria-label="Voltar">${icon("chevronLeft")}</a><h1>Músicas tocadas</h1></div>
    <p class="subhead">${state.space ? esc(state.space.name) : esc(state.org.name)}, só escalas publicadas que já aconteceram.</p>
    <div class="tabsbar"><button class="on" data-tab="mais">Mais tocadas</button><button data-tab="antigas">Há mais tempo</button><button data-tab="nunca">Nunca tocadas</button></div>
    <div class="small muted" id="count"></div><div class="list mt-s" id="list"></div>`;
  draw();
  on(el, "click", "[data-tab]", (e, b) => { tab = b.dataset.tab; el.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
}

// ---------------------------------------------------------------- busca de informações (iTunes, sem chave)
function itunesSearch(term) {
  return new Promise((resolve) => {
    const cb = "it" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const done = (v) => { delete window[cb]; s.remove(); resolve(v); };
    window[cb] = (j) => done(j?.results || []);
    s.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8&country=BR&callback=${cb}`;
    s.onerror = () => done([]);
    setTimeout(() => done([]), 8000);
    document.head.appendChild(s);
  });
}

async function songForm(el, id) {
  if (!isStaff()) { el.innerHTML = empty("lock", "Somente administradores e líderes de times de Louvor cadastram músicas."); return; }
  const s = id ? await must(sb.from("songs").select("*").eq("id", id).maybeSingle()) : null;
  if (id && !s) { el.innerHTML = empty("alert", "Música não encontrada"); return; }
  const drive = s?.source === "drive";
  const links = [...(s?.links || [])];
  let cover = s?.cover_url || null;
  el.innerHTML = `<div class="pagehead"><a class="back" href="${id ? `#/musica/${id}` : "#/musicas"}">${icon("chevronLeft")}</a><h1>${id ? "Editar música" : "Nova música"}</h1></div>
  ${drive ? `<div class="card small muted mb row gap">${icon("cloud", "accent")}<span>Música importada do Google Drive. Título, artista, tom e BPM vêm do nome do projeto e são atualizados automaticamente.</span></div>` : ""}
  <form class="card" id="f">
    <div class="row gap mb"><span class="cover" style="width:84px;height:84px" id="cv">${cover ? `<img src="${attr(cover)}" alt="">` : icon("music")}</span>
      <div class="col gap-s"><button type="button" class="btn ghost sm" id="upc">${icon("image")} Capa</button>${!drive ? `<button type="button" class="btn ghost sm" id="find">${icon("search")} Buscar informações</button>` : ""}</div></div>
    <label class="field"><span>Título *</span><input name="title" required maxlength="200" value="${attr(s?.title || "")}" ${drive ? "disabled" : ""}></label>
    <label class="field"><span>Artista</span><input name="artist" maxlength="120" value="${attr(s?.artist || "")}" ${drive ? "disabled" : ""}></label>
    <label class="field"><span>Álbum</span><input name="album" maxlength="160" value="${attr(s?.album || "")}" placeholder="Ex.: Diante do Trono (Ao Vivo)"></label>
    <div class="three"><label class="field"><span>Tom</span><input name="song_key" maxlength="8" value="${attr(s?.song_key || "")}" placeholder="Ex.: B" ${drive ? "disabled" : ""}></label>
      <label class="field"><span>BPM</span><input name="bpm" type="number" min="20" max="400" step="0.01" value="${s?.bpm ?? ""}" ${drive ? "disabled" : ""}></label>
      <label class="field"><span>Duração</span><input name="duration" placeholder="4:35" value="${s?.duration_sec ? fDur(s.duration_sec) : ""}" ${drive ? "disabled" : ""}></label></div>
    <label class="field"><span>Classificações</span><input name="classification" maxlength="120" value="${attr(s?.classification || "")}" placeholder="Ex.: Louvor"></label>
    <label class="field"><span>Observações gerais</span><textarea name="notes" maxlength="1000" placeholder="Ex.: Rafael tom D · Douglas tom B">${esc(s?.notes || "")}</textarea></label>
    <label class="field"><span>Link do YouTube</span><input name="youtube_url" type="url" value="${attr(s?.youtube_url || "")}" placeholder="https://youtube.com/..."></label>
    <label class="field"><span>Link da cifra</span><input name="chords_url" type="url" value="${attr(s?.chords_url || "")}" placeholder="https://www.cifraclub.com.br/..."></label>
    <div class="row gap-s small mb" id="helpers"></div>
    <div class="field"><span>Outros links</span><div id="links"></div><button type="button" class="btn ghost sm mt-s" id="addlink">${icon("plus")} Adicionar link</button></div>
    <button class="btn primary block" id="save">${id ? "Salvar" : "Cadastrar música"}</button>
  </form>`;
  const form = el.querySelector("#f");
  const drawLinks = () => {
    el.querySelector("#links").innerHTML = links.map((l, i) => `<div class="row gap-s mt-s"><input class="input" data-ll="${i}" value="${attr(l.label || "")}" placeholder="Nome" style="max-width:130px"><input class="input grow" data-lu="${i}" value="${attr(l.url || "")}" placeholder="https://"><button type="button" class="iconbtn" data-lr="${i}">${icon("x")}</button></div>`).join("");
  };
  const drawHelpers = () => {
    const t = [form.title.value, form.artist.value].filter(Boolean).join(" ");
    el.querySelector("#helpers").innerHTML = t ? `<a class="chip" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(t)}">${icon("youtube")} Procurar no YouTube</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.cifraclub.com.br/?q=${encodeURIComponent(t)}">${icon("search")} Procurar cifra</a>` : "";
  };
  drawLinks(); drawHelpers();
  form.addEventListener("input", (e) => {
    if (e.target.dataset.ll) links[e.target.dataset.ll].label = e.target.value;
    if (e.target.dataset.lu) links[e.target.dataset.lu].url = e.target.value;
    if (["title", "artist"].includes(e.target.name)) drawHelpers();
  });
  on(form, "click", "[data-lr]", (e, b) => { links.splice(Number(b.dataset.lr), 1); drawLinks(); });
  el.querySelector("#addlink").onclick = () => { links.push({ label: "", url: "" }); drawLinks(); };
  el.querySelector("#upc").onclick = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    try { cover = await uploadPublic(`songs/${state.org.id}`, f); el.querySelector("#cv").innerHTML = `<img src="${attr(cover)}" alt="">`; } catch (e) { toast(errMsg(e), "err"); }
  };
  el.querySelector("#find")?.addEventListener("click", async () => {
    const term = [form.title.value, form.artist.value].filter(Boolean).join(" ");
    if (!term) return toast("Digite o título primeiro.");
    const sh = sheet(`<h3>Resultados para "${esc(term)}"</h3>${spinner()}`);
    const res = await itunesSearch(term);
    sh.el.innerHTML = `<div class="grab"></div><h3>Resultados</h3><p class="tiny muted">Fonte: iTunes. Confira antes de salvar.</p><div class="list">${res.map((r, i) => `<button class="li" data-r="${i}"><span class="cover" style="width:44px;height:44px"><img src="${attr(r.artworkUrl100)}" alt=""></span>
      <span class="grow"><span class="t">${esc(r.trackName)}</span><span class="s">${esc(r.artistName)} · ${fDur((r.trackTimeMillis || 0) / 1000)}</span></span></button>`).join("") || `<div class="li muted">Nada encontrado.</div>`}</div>`;
    on(sh.el, "click", "[data-r]", (e, b) => {
      const r = res[Number(b.dataset.r)];
      form.title.value = r.trackName; form.artist.value = r.artistName;
      if (r.trackTimeMillis) form.duration.value = fDur(r.trackTimeMillis / 1000);
      cover = r.artworkUrl100?.replace("100x100", "600x600") || cover;
      if (cover) el.querySelector("#cv").innerHTML = `<img src="${attr(cover)}" alt="">`;
      drawHelpers(); sh.close();
    });
  });
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    try {
      for (const u of [form.youtube_url.value, form.chords_url.value, ...links.map((l) => l.url)]) if (u && !safeUrl(u)) throw new Error(`Link inválido: ${u}`);
      const row = { album: form.album.value.trim() || null, notes: form.notes.value.trim() || null, classification: form.classification.value.trim() || null, youtube_url: form.youtube_url.value || null, chords_url: form.chords_url.value || null, cover_url: cover, links: links.filter((l) => l.url).map((l) => ({ label: l.label || "Link", url: l.url })) };
      if (!drive) {
        const dur = form.duration.value.trim();
        const m = dur.match(/^(\d+):(\d{1,2})$/);
        Object.assign(row, { title: form.title.value.trim(), artist: form.artist.value.trim() || null, song_key: form.song_key.value.trim() || null,
          bpm: form.bpm.value ? Number(form.bpm.value) : null, duration_sec: m ? Number(m[1]) * 60 + Number(m[2]) : dur && /^\d+$/.test(dur) ? Number(dur) : null });
      }
      let sid = id;
      if (id) await must(sb.from("songs").update(row).eq("id", id));
      else sid = (await must(sb.from("songs").insert({ ...row, org_id: state.org.id, source: "manual", created_by: state.user.id }).select("id").single())).id;
      toast(id ? "Música atualizada" : "Música cadastrada");
      go(`/musica/${sid}`);
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  };
}

// Referências da música (YouTube, cifra e links extras) com nome e cor da fonte
const BRANDS = [[/spotify\./, "Spotify", "#1db954", "♫"], [/letras\.mus\.br/, "Letras", "#b5c812", "★"], [/cifraclub/, "Cifra Club", "#f26b21", "♪"], [/youtu/, "YouTube", "#e53935", "▶"],
  [/deezer\./, "Deezer", "#8a5cf6", "♫"], [/music\.apple|itunes\./, "Apple Music", "#fa2d48", "♫"], [/palcomp3/, "Palco MP3", "#ff7a00", "♪"]];
function songRefs(s) {
  const raw = [s.youtube_url && { url: s.youtube_url }, s.chords_url && { url: s.chords_url }, ...(s.links || [])].filter((l) => l && safeUrl(l.url));
  const seen = new Set();
  return raw.filter((l) => !seen.has(l.url) && seen.add(l.url)).map((l) => {
    const b = BRANDS.find((x) => x[0].test(l.url));
    return { url: l.url, name: b ? b[1] : l.label || new URL(l.url).hostname.replace(/^www\./, ""), color: b ? b[2] : "#5b6478", mark: b ? b[3] : "↗" };
  });
}

const verPick = new Map(); // versão aberta por música

async function songDetail(el, id) {
  el.innerHTML = spinner();
  const s = await must(sb.from("songs").select("*").eq("id", id).maybeSingle());
  if (!s) { el.innerHTML = empty("alert", "Música não encontrada"); return; }
  const [files, project, versions, history, sv] = await Promise.all([
    must(sb.from("song_files").select("*").eq("song_id", id).order("created_at")),
    s.current_project_id ? must(sb.from("multitrack_projects").select("id,version,tempo,time_sig_num,time_sig_den,sample_rate,length_sec,warnings,lyrics_raw,rpp_name,created_at").eq("id", s.current_project_id).maybeSingle()) : null,
    s.source === "drive" ? must(sb.from("multitrack_projects").select("id,version,created_at,is_current").eq("song_id", id).order("version", { ascending: false })) : [],
    must(sb.from("schedule_songs").select("schedule_id,schedules(title,starts_at,status)").eq("song_id", id).limit(30)),
    sb.from("song_versions").select("*").eq("song_id", id).order("position").order("created_at").then((r) => (r.error ? [] : r.data || [])), // tabela nova
  ]);
  const vSel = Math.max(0, sv.findIndex((v) => v.id === (verPick.get(id) || "")));
  const cur = sv[vSel] || null;
  const tracks = project ? await must(sb.from("project_tracks").select("name,kind,warnings").eq("project_id", project.id).order("idx")) : [];
  const staff = isStaff();
  const st = STATUS[s.status];
  const canPlay = !!(s.current_project_id && s.status === "ready");
  const refs = songRefs(s);
  const vrefs = cur?.links?.length ? songRefs({ links: cur.links }) : refs;
  const warnings = project ? [...(project.warnings || []), ...tracks.flatMap((t) => (t.warnings || []).map((w) => `${t.name}: ${w}`))] : [];
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/musicas">${icon("chevronLeft")}</a><h1 class="grow ellipsis" style="font-size:22px">Música</h1>
      ${staff ? `<a class="iconbtn" href="#/musica/${id}/editar" aria-label="Editar">${icon("edit")}</a>` : ""}</div>
    <div class="sd-head">
      <span class="cover sd-cover">${s.cover_url ? `<img src="${attr(s.cover_url)}" alt="">` : icon("music")}</span>
      <div class="grow" style="min-width:0"><h2 class="sd-title">${esc(s.title)}</h2>
        ${s.album ? `<div class="sd-album">Álbum: ${esc(s.album)}</div>` : ""}
        ${s.artist ? `<div class="sd-artist"><span class="sd-av">${esc(s.artist.trim().slice(0, 1).toUpperCase())}</span><span class="ellipsis">${esc(s.artist)}</span></div>` : `<div class="muted small">Artista não informado</div>`}</div></div>
    ${canPlay ? `<a class="btn primary block mt" href="#/player/${id}">${icon("play")} Abrir no player</a>` : ""}
    <div class="chiprow">${refs.map((r) => `<a class="refchip" href="${attr(r.url)}" target="_blank" rel="noopener"><span class="rico" style="background:${r.color}">${r.mark}</span>${esc(r.name)}${icon("link")}</a>`).join("")}
      <button class="refchip" id="share">${icon("chat")} Enviar no chat</button></div>

    ${s.notes ? `<div class="sec"><h2>Observações gerais</h2></div><p class="sd-notes">${esc(s.notes)}</p>` : ""}

    <div class="sec"><h2>Versões</h2>${sv.length ? `<span class="count">${sv.length}</span>` : ""}${staff ? `<button class="more" id="addver">${icon("plus")} Versão</button>` : ""}</div>
    ${sv.length ? `<div class="vtabs" role="tablist">${sv.map((v, i) => `<button role="tab" class="${i === vSel ? "on" : ""}" data-ver="${v.id}">${esc(v.name)}</button>`).join("")}</div>` : ""}
    <div class="card sd-card">
      <div class="tiles"><div class="tile"><small>Tom</small><b>${esc((cur?.song_key ?? s.song_key) || "—")}</b></div><div class="tile hi"><small>BPM</small><b>${(cur?.bpm ?? s.bpm) ? Number(cur?.bpm ?? s.bpm) : "—"}</b></div><div class="tile"><small>Duração</small><b>${(cur?.duration_sec ?? s.duration_sec) ? fDur(cur?.duration_sec ?? s.duration_sec) : "—"}</b></div></div>
      ${project?.time_sig_num ? `<div class="sd-lbl">Compasso: <b class="sd-inl">${project.time_sig_num}/${project.time_sig_den}</b></div>` : ""}
      ${(cur?.classification || s.classification) ? `<div class="sd-lbl">Classificações</div><div class="sd-val">${esc(cur?.classification || s.classification)}</div>` : ""}
      ${cur?.notes ? `<div class="sd-lbl">Observações</div><div class="sd-note">${esc(cur.notes)}</div>` : ""}
      ${vrefs.length ? `<div class="sd-lbl accent row gap-s">${icon("link")} Referências</div>${vrefs.map((r) => `<a class="refrow" href="${attr(r.url)}" target="_blank" rel="noopener"><span class="rico big" style="background:${r.color}">${r.mark}</span><span class="grow" style="min-width:0"><span class="t">${esc(r.name)}</span><span class="s ellipsis">${esc(r.url)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}` : ""}
      ${cur && staff ? `<div class="row gap mt"><button class="btn ghost sm" id="editver">${icon("edit")} Editar versão</button><button class="btn danger sm" id="delver">${icon("trash")} Excluir</button></div>` : ""}
    </div>
    ${!sv.length && staff ? `<p class="small muted mt-s">Registre aqui o tom e os detalhes que cada cantor usa. Toque em <b>+ Versão</b>.</p>` : ""}

    ${st ? `<div class="card mt row gap"><span class="tag ${st[1]}">${st[0]}</span><span class="small grow">${esc(s.status_message || "")}</span>
      ${isAdmin() && s.source === "drive" && ["error", "waiting_files"].includes(s.status) ? `<button class="btn ghost sm" id="retry">${icon("refresh")} Tentar de novo</button>` : ""}</div>` : ""}
    ${s.duplicate_of ? `<div class="card mt small warn row gap">${icon("alert")}<span>Esta música parece duplicada de <a class="link" href="#/musica/${s.duplicate_of}">outra do repertório</a> (mesmo título e artista em outra pasta do Drive).</span></div>` : ""}


    <div class="sec">${icon("lyrics")}<h2>Letra</h2>${staff ? `<a href="#/musica/${id}/letra">${s.lyrics?.blocks?.length ? "Editar" : "Adicionar"} ${icon("chevronRight")}</a>` : ""}</div>
    ${s.lyrics?.blocks?.length ? `<div class="card">${s.lyrics.blocks.slice(0, 3).map((b) => `${b.label ? `<div class="tiny accent" style="letter-spacing:.12em;text-transform:uppercase">${esc(b.label)}</div>` : ""}<p style="white-space:pre-line;margin:4px 0 12px">${esc(b.text)}</p>`).join("")}${s.lyrics.blocks.length > 3 ? `<p class="small muted">+${s.lyrics.blocks.length - 3} bloco(s)…</p>` : ""}</div>`
      : `<p class="small muted">Sem letra cadastrada.</p>`}
    ${project?.lyrics_raw ? `<div class="card mt-s small row gap">${icon("lyrics", "accent")}<span>O projeto tem uma track de letra ("${esc(project.lyrics_raw.trackName)}"). Os dados foram guardados e a leitura automática será ativada depois da validação do formato com um projeto real.</span></div>` : ""}

    <div class="sec">${icon("clip")}<h2>Arquivos</h2>${staff ? `<button class="more" id="addfile">${icon("plus")} Anexar</button>` : ""}</div>
    ${files.length ? `<div class="list">${files.map((f) => `<div class="li"><button class="grow row gap" style="text-align:left" data-open="${f.id}">${icon(f.url ? "link" : "file", "accent")}<span class="t">${esc(f.name)}</span></button>${staff ? `<button class="iconbtn" data-delf="${f.id}">${icon("trash")}</button>` : ""}</div>`).join("")}</div>` : `<p class="small muted">Nenhum arquivo anexado.</p>`}

    ${project ? `<div class="sec">${icon("layers")}<h2>Projeto multitrack</h2></div>
      <div class="card small"><div class="row between"><span class="muted">Arquivo</span><span class="ellipsis" style="max-width:60%">${esc(project.rpp_name)}</span></div>
        <div class="row between mt-s"><span class="muted">Versão</span><span>v${project.version} · ${fDate(project.created_at)}</span></div>
        <div class="row between mt-s"><span class="muted">Faixas</span><span>${tracks.filter((t) => t.kind === "audio").length} de áudio${tracks.some((t) => t.kind === "folder") ? ` · ${tracks.filter((t) => t.kind === "folder").length} pasta(s)` : ""}</span></div>
        ${project.sample_rate ? `<div class="row between mt-s"><span class="muted">Áudio</span><span>${project.sample_rate} Hz</span></div>` : ""}
        <div class="row between mt-s"><span class="muted">Fonte</span><span>Google Drive · pasta "${esc(s.drive_folder_name || "")}"</span></div>
        ${versions.length > 1 ? `<div class="row between mt-s"><span class="muted">Histórico</span><span>${versions.length} versões</span></div>` : ""}</div>
      ${warnings.length ? `<details class="card mt-s small"><summary class="warn" style="cursor:pointer">${warnings.length} aviso(s) da importação</summary><ul style="margin:8px 0 0;padding-left:18px">${warnings.map((w) => `<li class="muted" style="margin:4px 0">${esc(w)}</li>`).join("")}</ul></details>` : ""}` : ""}

    ${history.length ? `<div class="sec">${icon("calendar")}<h2>Usada em</h2></div><div class="list">${history.filter((h) => h.schedules).sort((a, b) => b.schedules.starts_at.localeCompare(a.schedules.starts_at)).map((h) => `<a class="li" href="#/escala/${h.schedule_id}"><span class="grow"><span class="t">${esc(h.schedules.title)}</span><span class="s">${fDate(h.schedules.starts_at)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>` : ""}
    ${staff && s.source === "manual" ? `<button class="btn danger sm mt" id="del">${icon("trash")} Excluir música</button>` : ""}`;

  el.querySelector("#share").onclick = async () => { const { shareSongsToChat } = await import("./chat.js"); shareSongsToChat([id]); };
  on(el, "click", "[data-ver]", (e, b) => { verPick.set(id, b.dataset.ver); songDetail(el, id); });
  el.querySelector("#addver")?.addEventListener("click", () => versionForm(null, s, () => songDetail(el, id)));
  el.querySelector("#editver")?.addEventListener("click", () => versionForm(cur, s, () => songDetail(el, id)));
  el.querySelector("#delver")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Excluir a versão de ${cur.name}?`, "Excluir", true))) return;
    const r = await sb.from("song_versions").delete().eq("id", cur.id);
    if (r.error) return toast(errMsg(r.error), "err");
    verPick.delete(id); toast("Versão excluída"); songDetail(el, id);
  });
  el.querySelector("#retry")?.addEventListener("click", async (e) => {
    busy(e.target);
    const r = await sb.functions.invoke("drive-sync", { action: "retry", org_id: state.org.id, song_id: id });
    busy(e.target, false);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Sincronização executada"); songDetail(el, id);
  });
  el.querySelector("#addfile")?.addEventListener("click", () => {
    const sh = sheet(`<h3>Anexar à música</h3><div class="attgrid"><button data-k="upload">${icon("file")}Arquivo</button><button data-k="link">${icon("link")}Link</button></div>`);
    sh.el.addEventListener("click", async (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k; if (!k) return;
      if (k === "upload") {
        const f = await pickFile("*/*"); if (!f) return;
        sh.close(); toast("Enviando…");
        const path = `songs/${state.org.id}/${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
        const up = await sb.storage.from("private").upload(path, f);
        if (up.error) return toast(errMsg(up.error), "err");
        const kind = /pdf|image/.test(f.type) ? "sheet" : f.type.startsWith("audio") ? "audio" : "other";
        const r = await sb.from("song_files").insert({ song_id: id, org_id: state.org.id, name: f.name, kind, storage_path: path, size: f.size, mime: f.type, created_by: state.user.id });
        if (r.error) return toast(errMsg(r.error), "err");
        songDetail(el, id);
      } else {
        sh.el.innerHTML = `<div class="grab"></div><h3>Link</h3><form id="lf"><label class="field"><span>Nome</span><input name="name" required></label><label class="field"><span>Endereço</span><input type="url" name="url" required></label><button class="btn primary block">Adicionar</button></form>`;
        sh.el.querySelector("#lf").onsubmit = async (ev) => {
          ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
          if (!safeUrl(d.url)) return toast("Endereço inválido", "err");
          const r = await sb.from("song_files").insert({ song_id: id, org_id: state.org.id, name: d.name, url: d.url, created_by: state.user.id });
          if (r.error) return toast(errMsg(r.error), "err");
          sh.close(); songDetail(el, id);
        };
      }
    });
  });
  on(el, "click", "[data-open]", async (e, b) => {
    const f = files.find((x) => x.id === b.dataset.open);
    if (f.url) return window.open(f.url, "_blank", "noopener");
    const r = await sb.storage.from("private").signedUrl(f.storage_path, 600);
    if (r.error) return toast(errMsg(r.error), "err");
    window.open(r.data.url, "_blank", "noopener");
  });
  on(el, "click", "[data-delf]", async (e, b) => {
    if (!(await confirmDialog("Remover este anexo?", "Remover", true))) return;
    const f = files.find((x) => x.id === b.dataset.delf);
    if (f.storage_path) await sb.storage.from("private").remove([f.storage_path]);
    await sb.from("song_files").delete().eq("id", f.id); songDetail(el, id);
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir esta música? As escalas antigas mantêm o nome no histórico.", "Excluir", true))) return;
    const r = await sb.from("songs").delete().eq("id", id);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Música excluída"); go("/musicas");
  });
}

// Versão por cantor: tom, BPM, duração, classificações, observações e referências próprias
async function versionForm(v, song, done) {
  const ppl = [...(await people()).values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const links = [...(v?.links || [])];
  const sh = sheet(`<h3>${v ? "Editar versão" : "Nova versão"}</h3><form id="vf">
    <label class="field"><span>Quem canta *</span><input name="name" required maxlength="80" list="vppl" value="${attr(v?.name || "")}" placeholder="Ex.: Rafael"><datalist id="vppl">${ppl.map((p) => `<option value="${attr(p.display_name)}"></option>`).join("")}</datalist></label>
    <div class="three"><label class="field"><span>Tom</span><input name="song_key" maxlength="8" value="${attr(v?.song_key || "")}" placeholder="${attr(song.song_key || "Ex.: D")}"></label>
      <label class="field"><span>BPM</span><input name="bpm" type="number" min="20" max="400" step="0.01" value="${v?.bpm ?? ""}" placeholder="${song.bpm ? Number(song.bpm) : ""}"></label>
      <label class="field"><span>Duração</span><input name="duration" placeholder="${song.duration_sec ? fDur(song.duration_sec) : "4:35"}" value="${v?.duration_sec ? fDur(v.duration_sec) : ""}"></label></div>
    <label class="field"><span>Classificações</span><input name="classification" maxlength="120" value="${attr(v?.classification || "")}" placeholder="Ex.: Louvor"></label>
    <label class="field"><span>Observações</span><textarea name="notes" maxlength="600">${esc(v?.notes || "")}</textarea></label>
    <div class="field"><span>Referências desta versão</span><div id="vl"></div><button type="button" class="btn ghost sm mt-s" id="vadd">${icon("plus")} Adicionar link</button></div>
    <button class="btn primary block mt" id="vsave">Salvar versão</button></form>`);
  const draw = () => { sh.el.querySelector("#vl").innerHTML = links.map((l, i) => `<div class="row gap-s mb"><input data-ll="${i}" placeholder="Nome" value="${attr(l.label || "")}" style="flex:1"><input data-lu="${i}" type="url" placeholder="https://" value="${attr(l.url || "")}" style="flex:2"><button type="button" class="iconbtn" data-lr="${i}">${icon("trash")}</button></div>`).join(""); };
  draw();
  sh.el.addEventListener("input", (e) => { if (e.target.dataset.ll) links[e.target.dataset.ll].label = e.target.value; if (e.target.dataset.lu) links[e.target.dataset.lu].url = e.target.value; });
  on(sh.el, "click", "[data-lr]", (e, b) => { links.splice(Number(b.dataset.lr), 1); draw(); });
  sh.el.querySelector("#vadd").onclick = () => { links.push({ label: "", url: "" }); draw(); };
  sh.el.querySelector("#vf").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, btn = sh.el.querySelector("#vsave"); busy(btn);
    try {
      for (const l of links) if (l.url && !safeUrl(l.url)) throw new Error(`Link inválido: ${l.url}`);
      const dur = f.duration.value.trim(), m = dur.match(/^(\d+):(\d{1,2})$/), name = f.name.value.trim();
      const row = { name, singer_id: ppl.find((p) => p.display_name === name)?.id || null, song_key: f.song_key.value.trim() || null, bpm: f.bpm.value ? Number(f.bpm.value) : null,
        duration_sec: m ? Number(m[1]) * 60 + Number(m[2]) : /^\d+$/.test(dur) ? Number(dur) : null, classification: f.classification.value.trim() || null, notes: f.notes.value.trim() || null,
        links: links.filter((l) => l.url).map((l) => ({ label: l.label || "Link", url: l.url })) };
      const r = v ? await sb.from("song_versions").update(row).eq("id", v.id).select("id").single()
        : await sb.from("song_versions").insert({ ...row, song_id: song.id, org_id: state.org.id, created_by: state.user.id }).select("id").single();
      if (r.error) throw new Error(r.error.code === "23505" ? "Já existe uma versão com esse nome." : errMsg(r.error));
      verPick.set(song.id, r.data.id); sh.close(); toast("Versão salva"); done();
    } catch (err) { toast(errMsg(err), "err"); busy(btn, false); }
  };
}

// ---------------------------------------------------------------- letra (blocos)
export function parseLyricsText(text) {
  return text.replace(/\r/g, "").split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk, i) => {
    const lines = chunk.split("\n");
    const m = lines[0].match(/^\s*\[(.+?)\]\s*$/) || lines[0].match(/^\s*((?:intro|verso|pré-refrão|pre-refrão|refrão|ponte|final|coro|tag|interlúdio|estrofe)[^:]*):\s*$/i);
    return { id: `b${i}`, label: m ? m[1].trim() : null, text: (m ? lines.slice(1) : lines).join("\n").trim(), start: null };
  });
}
export function lyricsToText(blocks) { return (blocks || []).map((b) => (b.label ? `[${b.label}]\n` : "") + b.text).join("\n\n"); }

async function lyricsEditor(el, id) {
  const s = await must(sb.from("songs").select("id,title,lyrics").eq("id", id).maybeSingle());
  if (!s || !isStaff()) { el.innerHTML = empty("lock", "Sem permissão."); return; }
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/musica/${id}">${icon("chevronLeft")}</a><h1>Letra</h1></div>
    <p class="small muted">Separe os blocos com uma linha em branco. Para dar nome a um bloco, escreva na primeira linha entre colchetes, por exemplo <b>[Refrão]</b>.
    Os tempos de cada bloco podem ser marcados no player, na aba Letra, enquanto a música toca.</p>
    <form class="card mt" id="f"><label class="field"><textarea name="t" style="min-height:50vh;font-size:16px;line-height:1.5" placeholder="[Verso 1]\nPrimeira linha...\n\n[Refrão]\n...">${esc(lyricsToText(s.lyrics?.blocks))}</textarea></label>
    <button class="btn primary block" id="save">Salvar letra</button></form>`;
  el.querySelector("#f").onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    const blocks = parseLyricsText(e.target.t.value);
    // mantém os tempos já marcados quando o bloco continua igual
    const old = s.lyrics?.blocks || [];
    blocks.forEach((b, i) => { const o = old.find((x) => x.text === b.text && x.label === b.label) || (old[i]?.text === b.text ? old[i] : null); if (o) b.start = o.start ?? null; });
    const r = await sb.from("songs").update({ lyrics: blocks.length ? { blocks, source: "manual", synced: blocks.some((b) => b.start != null) } : null }).eq("id", id);
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Letra salva"); go(`/musica/${id}`);
  };
}
