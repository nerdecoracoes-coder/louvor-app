// Escalas: criação/edição com sugestão automática, detalhe e calendários (geral, do time e pessoal).
import { sb, state, must, esc, attr, icon, avatar, teamBadge, people, personName, isAdmin, canManageTeam, isStaff, sheet, toast, errMsg, busy, on, go,
  empty, spinner, fDate, fDateLong, fTime, fDow, fDay, fMon, ymd, fromLocal, confirmDialog, roleIcon, linkify, fDur, fMonthYear, cap, teamHasRepertoire, teamHas } from "../core.js";
import { schedRow } from "./home.js";
import { scheduleExtras, cueEditor } from "./multimidia.js";

export function register(route) {
  route("/escala/nova", (p, el) => editor(el, null, null));
  route("/escala/nova/:team", (p, el) => editor(el, null, p.team));
  route("/escala/:id", (p, el) => detail(el, p.id));
  route("/escala/:id/editar", (p, el) => editor(el, p.id, null));
  route("/times/:id/escalas", (p, el) => calendar(el, "time:" + p.id));
  route("/panorama", (p, el, a) => panorama(p, el, a));
  route("/calendario", (p, el) => calendar(el, "geral"));
  route("/calendario/:scope", (p, el) => calendar(el, p.scope));
}

const EVENT_TYPES = ["Culto de Celebração", "Culto da Família", "Culto de Domingo", "Culto de Jovens", "Ensaio", "Santa Ceia", "Evento especial", "Conferência"];

async function managedTeams() {
  if (isAdmin()) return must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name"));
  return state.myTeams.filter((t) => canManageTeam(t.id));
}

// ---------------------------------------------------------------- editor
async function editor(el, scheduleId, teamId) {
  el.innerHTML = spinner();
  const teams = await managedTeams();
  let sched = null, assigns = [], songsSel = [];
  if (scheduleId) {
    sched = await must(sb.from("schedules").select("*").eq("id", scheduleId).maybeSingle());
    if (!sched || !canManageTeam(sched.team_id)) { el.innerHTML = empty("lock", "Você não pode editar esta escala."); return; }
    teamId = sched.team_id;
    assigns = await must(sb.from("schedule_assignments").select("*").eq("schedule_id", scheduleId));
    songsSel = (await must(sb.from("schedule_songs").select("*,songs(id,title,artist,song_key,bpm,status,source,current_project_id,cover_url)").eq("schedule_id", scheduleId).order("position")))
      .map((s) => ({ song_id: s.song_id, title: s.songs?.title || s.title_snapshot, artist: s.songs?.artist || s.artist_snapshot, song_key: s.song_key, notes: s.notes, removed: !s.song_id || s.songs?.status === "removed" }));
  }
  if (!teams.length) { el.innerHTML = empty("lock", "Somente líderes e administradores criam escalas."); return; }
  // a escala é criada dentro de um time: usa o time da rota ou o time em que a pessoa está; só pergunta quando não há nenhum
  if (!teamId && state.space && teams.some((t) => t.id === state.space.id)) teamId = state.space.id;
  const askTeam = !scheduleId && !teamId && teams.length > 1;
  teamId = teamId || teams[0].id;
  const ppl = await people();

  // estado do formulário
  const f = {
    team: teamId,
    title: sched?.title || "", type: sched?.event_type || "",
    date: sched ? ymd(sched.starts_at) : (/[?&]data=(\d{4}-\d{2}-\d{2})/.exec(location.hash)?.[1] || ymd(new Date(Date.now() + 864e5))),
    time: sched ? fTime(sched.starts_at) : "19:00",
    end: sched?.ends_at ? fTime(sched.ends_at) : "",
    location: sched?.location || "", notes: sched?.notes || "",
    // por função: [{user_id}]
    picks: new Map(), slots: new Map(), songs: songsSel,
    tab: "detalhes", publish: sched ? sched.status === "published" : true,
    ask: sched?.ask_confirmation !== false, palettes: (sched?.palettes || []).map((x) => ({ desc: x.desc || "", colors: [...(x.colors || [])] })), view: "main", repeat: "none", until: "",
  };
  // "pedir confirmação" e "paleta de cores" dependem de colunas novas; sem elas (SQL ainda não aplicado) as opções ficam escondidas
  const hasExt = !(await sb.from("schedules").select("ask_confirmation,palettes").limit(1)).error;
  let cueCount = 0;
  if (scheduleId) cueCount = (await sb.from("schedule_cues").select("id").eq("schedule_id", scheduleId)).data?.length || 0;
  for (const a of assigns) { const k = a.role_id || "none"; if (!f.picks.has(k)) f.picks.set(k, []); f.picks.get(k).push(a.user_id); }

  let teamRoles = [], teamMembers = [], memberRoles = [], candidates = null;
  async function loadTeam() {
    [teamMembers, memberRoles] = await Promise.all([
      must(sb.from("team_members").select("*").eq("team_id", f.team)),
      must(sb.from("team_member_roles").select("user_id,role_id,music_roles(id,name,sort)").eq("team_id", f.team)),
    ]);
    const m = new Map();
    for (const r of memberRoles) if (r.music_roles) m.set(r.role_id, r.music_roles);
    teamRoles = [...m.values()].sort((a, b) => a.sort - b.sort);
    candidates = null;
  }
  async function loadCandidates() {
    if (!f.date || !f.time) return null;
    const starts = fromLocal(f.date, f.time);
    const ends = f.end ? fromLocal(f.date, f.end) : null;
    const r = await sb.rpc("schedule_candidates", { p_team: f.team, p_starts: starts, p_ends: ends && ends > starts ? ends : null, p_exclude_schedule: scheduleId });
    candidates = r.error ? [] : r.data;
    return candidates;
  }
  await loadTeam();
  await loadCandidates();

  // funções em que a pessoa já está escalada nesta escala
  const rolesOf = (uid) => [...f.picks].filter(([, users]) => users.includes(uid)).map(([rid]) => rid);
  const candInfo = (uid, roleId) => candidates?.find((c) => c.user_id === uid && c.role_id === roleId) || candidates?.find((c) => c.user_id === uid);
  const warnFor = (uid, roleId) => {
    const c = candInfo(uid, roleId); const w = [];
    if (c && !c.available) w.push(`Indisponível${c.unavailable_note ? ": " + c.unavailable_note : ""}`);
    if (c && c.monthly_limit != null && c.month_count >= c.monthly_limit) w.push(`Limite do mês (${c.month_count}/${c.monthly_limit})`);
    if (c && c.same_day_count > 0) w.push("Já escalado(a) neste dia");
    const also = rolesOf(uid).filter((rid) => rid !== roleId).map((rid) => teamRoles.find((r) => r.id === rid)?.name).filter(Boolean);
    if (also.length) w.push(`Também escalado(a) como ${also.join(", ")}`);
    const others = [...f.picks.values()].flat().filter((x) => x !== uid);
    const tm = teamMembers.find((m) => m.user_id === uid);
    const clash = others.filter((o) => (tm?.avoid_with || []).includes(o) || (teamMembers.find((m) => m.user_id === o)?.avoid_with || []).includes(uid));
    if (clash.length) w.push(`Preferência: evitar com ${clash.map((x) => personName(ppl, x)).join(", ")}`);
    return w;
  };

  const REPEATS = [["none", "Não se repete"], ["weekly", "Toda semana"], ["biweekly", "A cada 2 semanas"], ["monthly", "Todo mês"]];
    const switchRow = (name, on_, title, sub, ic) => `<label class="switchrow">${icon(ic)}<span class="grow"><b>${title}</b><small>${sub}</small></span><span class="switch"><input type="checkbox" name="${name}" ${on_ ? "checked" : ""}><i></i></span></label>`;

  const sw = (c) => `<span class="pcol" style="background:${attr(c)}" title="${attr(c)}"></span>`;
  function palettePage() {
    return `<div class="pagehead"><button class="back" data-pback aria-label="Voltar">${icon("chevronLeft")}</button><h1>Paleta de cores</h1></div>
      <div class="sec"><h2>Vestimentas</h2><span class="cnt2">${f.palettes.length}</span><button class="more" id="padd">${icon("plus")} Adicionar</button></div>
      ${f.palettes.length ? f.palettes.map((p, i) => `<div class="card pal"><div class="row gap"><input class="input grow" data-pdesc="${i}" maxlength="80" placeholder="Descrição (ex.: Tons terrosos)" value="${attr(p.desc)}">
          <button class="iconbtn" data-pdel="${i}" aria-label="Excluir paleta">${icon("trash")}</button></div>
        <div class="sec"><h3>Cores</h3><span class="cnt2">${p.colors.length}</span><button class="more" data-pcolor="${i}">${icon("plus")} Adicionar</button></div>
        <div class="pcolors">${p.colors.length ? p.colors.map((c, j) => `<span class="pcol big" style="background:${attr(c)}"><button data-prm="${i}:${j}" aria-label="Tirar cor">${icon("x")}</button></span>`).join("") : `<span class="small muted">Nenhuma cor escolhida.</span>`}</div></div>`).join("")
        : `<div class="card">${empty("shirt", "Nenhuma paleta ainda", "Escolha as cores das roupas desse dia: monte a sua ou comece por uma sugestão.")}</div>`}
      <button class="btn ghost block mt" id="psuggest">${icon("sparkle")} Sugestões de paletas</button>
      <div style="height:84px"></div>
      <button class="fabsave" id="savebtn" data-save="${f.publish ? "published" : "draft"}">${icon("check")} Salvar</button>`;
  }
  function colorSheet(i) {
    const sel = new Set(f.palettes[i].colors.map((c) => c.toLowerCase()));
    const known = new Set(CATALOG.map(([, h]) => h));
    const extra = [...sel].filter((c) => !known.has(c));
    const sh = sheet(`<h3>Escolha as cores</h3><p class="small muted" style="margin-top:-6px">Toque para escolher ou tirar uma cor.</p>
      <div class="catalog" id="cat">${[...CATALOG, ...extra.map((h) => ["Personalizada", h])].map(([n, h]) => `<button type="button" class="cat ${sel.has(h) ? "on" : ""}" data-h="${h}" aria-label="${n}"><i style="background:${h}"></i><small>${n}</small></button>`).join("")}</div>
      <label class="row gap mt small muted">Outra cor <input type="color" id="cpick" value="#3e63dd" style="width:48px;height:36px;border:0;background:none"><button type="button" class="chip" id="cadd">${icon("plus")} Usar</button></label>
      <button class="btn primary block mt" id="cok">Concluir</button>`, { wide: true });
    const toggle = (h) => { sel.has(h) ? sel.delete(h) : sel.add(h); sh.el.querySelectorAll(".cat").forEach((b) => b.classList.toggle("on", sel.has(b.dataset.h))); };
    on(sh.el, "click", ".cat", (e, b) => toggle(b.dataset.h));
    sh.el.querySelector("#cadd").onclick = () => { const h = sh.el.querySelector("#cpick").value.toLowerCase(); if (!known.has(h) && !sel.has(h)) { const b = document.createElement("button"); b.type = "button"; b.className = "cat on"; b.dataset.h = h; b.innerHTML = `<i style="background:${h}"></i><small>Personalizada</small>`; sh.el.querySelector("#cat").appendChild(b); } sel.add(h); sh.el.querySelectorAll(".cat").forEach((b) => b.classList.toggle("on", sel.has(b.dataset.h))); };
    sh.el.querySelector("#cok").onclick = () => { const order = [...f.palettes[i].colors.filter((c) => sel.has(c.toLowerCase())), ...[...sel].filter((c) => !f.palettes[i].colors.map((x) => x.toLowerCase()).includes(c))]; f.palettes[i].colors = order; sh.close(); draw(); };
  }
  function suggestSheet() {
    const sh = sheet(`<h3>Sugestões de paletas</h3><div class="list" style="max-height:62vh;overflow:auto">${SUGGESTED.map(([n, cs], k) => `<button class="li" data-sg="${k}"><span class="grow" style="min-width:0"><span class="t">${n}</span></span><span class="pcolors">${cs.map(sw).join("")}</span></button>`).join("")}</div>`, { wide: true });
    on(sh.el, "click", "[data-sg]", (e, b) => { const [n, cs] = SUGGESTED[Number(b.dataset.sg)]; f.palettes.push({ desc: n, colors: [...cs] }); sh.close(); draw(); });
  }

  function tabDetails(team) {
    return `<form class="card" id="f">
      ${askTeam ? `<fieldset class="of"><legend>Time</legend><select name="team">${teams.map((t) => `<option value="${t.id}" ${t.id === f.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></fieldset>` : ""}
      <fieldset class="of"><legend>Nome ou tipo do evento *</legend><input name="title" list="types" required maxlength="140" value="${attr(f.title)}" placeholder="Ex.: Culto de Celebração"><datalist id="types">${EVENT_TYPES.map((t) => `<option value="${t}">`).join("")}</datalist></fieldset>
      <div class="dt3"><fieldset class="of"><legend>Data *</legend><input type="date" name="date" required value="${f.date}"></fieldset>
        <fieldset class="of"><legend>Início *</legend><input type="time" name="time" required value="${f.time}"></fieldset>
        <fieldset class="of"><legend>Término</legend><input type="time" name="end" value="${f.end}"></fieldset></div>
      ${scheduleId ? "" : `<div class="two"><fieldset class="of"><legend>Repetir</legend><select name="repeat">${REPEATS.map(([k, l]) => `<option value="${k}" ${f.repeat === k ? "selected" : ""}>${l}</option>`).join("")}</select></fieldset>
        ${f.repeat !== "none" ? `<fieldset class="of"><legend>Até</legend><input type="date" name="until" value="${f.until}" min="${f.date}"></fieldset>` : ""}</div>
        ${f.repeat !== "none" ? `<p class="tiny muted" style="margin:-4px 0 12px">${icon("calendar")} Cria uma escala para cada data, com os mesmos participantes e músicas (no máximo ${MAX_REPEAT}).</p>` : ""}`}
      <fieldset class="of"><legend>Observações</legend><textarea name="notes" rows="1" maxlength="500" placeholder="Roupa, passagem de som…">${esc(f.notes)}</textarea><small class="ncount" id="ncount">${(f.notes || "").length}/500</small></fieldset>
      <div class="switchlist">
        ${switchRow("publish", f.publish, "Publicar escala", "Visível para todos os membros", "eye")}
        ${hasExt ? switchRow("ask", f.ask, "Pedir confirmação", "Participantes confirmam que viram a escala", "check") : ""}
      </div>
      ${hasExt ? `<button type="button" class="menurow" id="openpal">${icon("shirt")}<span class="grow"><b>Paleta de cores</b><small>Cores das roupas para este dia</small></span><span class="muted small">${f.palettes.length ? `${f.palettes.length} ${f.palettes.length === 1 ? "paleta" : "paletas"}` : "Nenhuma"}</span>${icon("chevronRight", "chev")}</button>` : ""}
    </form>`;
  }
  function tabPeople() {
    const cards = (r) => {
      const picked = f.picks.get(r.id) || [], n = Math.max(f.slots.get(r.id) ?? 1, picked.length);
      const ic = icon(roleIcon(r.name), "roleic");
      const filled = picked.map((u) => { const w = warnFor(u, r.id); return `<div class="pcard${w.length ? " warned" : ""}">${avatar(ppl.get(u), 46, false)}
          <span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(personName(ppl, u))}</b><small>${esc(r.name)}</small>
            ${w.map((x) => `<small class="${/Indispon/.test(x) ? "danger-t" : "warn"}" style="display:block">${icon("alert")} ${esc(x)}</small>`).join("")}</span>
          <span class="roleic-w" title="${attr(r.name)}">${ic}</span>
          <button type="button" class="iconbtn" data-unpick="${r.id}:${u}" aria-label="Tirar ${attr(personName(ppl, u))} da função ${attr(r.name)}">${icon("x")}</button></div>`; });
      const empties = Array.from({ length: n - picked.length }, () => `<div class="pcard pslot" data-pick="${r.id}" role="button" tabindex="0"><span class="cover" style="width:46px;height:46px">${icon(roleIcon(r.name))}</span>
          <span class="grow"><b style="display:block">${esc(r.name)}</b><small>Toque para escolher</small></span>
          ${n > 1 ? `<button type="button" class="iconbtn" data-slot="${r.id}" data-d="-1" aria-label="Tirar uma vaga de ${attr(r.name)}">${icon("minus")}</button>` : ""}${icon("chevronRight", "chev")}</div>`);
      return `<div class="rolegrp">${filled.join("")}${empties.join("")}</div>`;
    };
    return `<div class="sec">${icon("users")}<h2>Participantes</h2><button class="more" id="addrole" title="Acrescentar função" aria-label="Acrescentar função">${icon("plus")} Função</button><button class="more" id="suggest">${icon("sparkle")} Sugerir escala</button></div>
    ${teamRoles.length ? `<div class="rolelist">${teamRoles.map(cards).join("")}</div>` : `<div class="card">${empty("users", "Nenhum integrante com função neste time", `Defina as funções musicais dos integrantes em <a class="link" href="#/times/${f.team}/integrantes">Integrantes</a>.`)}</div>`}`;
  }
  function tabSongs() {
    return `<div class="sec">${icon("music")}<h2>Músicas</h2><button class="more" id="addsong">${icon("plus")} Adicionar</button></div>
    <div class="list" id="songs">${f.songs.length ? f.songs.map((s, i) => `<div class="li"><span class="dim small" style="width:18px">${i + 1}</span>
      <span class="grow" style="min-width:0"><span class="t ellipsis" style="display:block">${esc(s.title)}${s.removed ? ` <span class="tag gray">fora do repertório</span>` : ""}</span><span class="s">${esc(s.artist || "")}</span></span>
      <input class="input" style="width:66px;height:38px;padding:0 8px;text-align:center" data-key="${i}" value="${attr(s.song_key || "")}" placeholder="Tom" aria-label="Tom">
      <button class="iconbtn" data-up="${i}" aria-label="Subir" ${i === 0 ? "disabled" : ""}>${icon("chevronUp")}</button>
      <button class="iconbtn" data-rm="${i}" aria-label="Remover">${icon("x")}</button></div>`).join("") : `<div class="li muted small">Nenhuma música selecionada.</div>`}</div>`;
  }
  function tabCues() {
    return `<div class="sec">${icon("list")}<h2>Roteiro do culto</h2></div>
      <div class="card">${scheduleId ? `<p class="small muted" style="margin:0 0 10px">${cueCount ? `${cueCount} item(ns) no roteiro.` : "Ainda não há itens no roteiro."}</p><button class="btn ghost block" id="cues">${icon("edit")} ${cueCount ? "Editar roteiro" : "Montar roteiro"}</button>`
        : `<p class="small muted" style="margin:0">Salve a escala primeiro; em seguida abra "Editar" para montar a ordem do culto.</p>`}</div>`;
  }

  function draw() {
    const team = teams.find((t) => t.id === f.team);
    if (f.view === "palette") { el.innerHTML = palettePage(); return; }
    const showSongs = teamHasRepertoire(team), showCues = team && teamHas(team, "roteiro");
    if (f.tab === "musicas" && !showSongs) f.tab = "detalhes";
    if (f.tab === "roteiro" && !showCues) f.tab = "detalhes";
    const nPeople = [...f.picks.values()].flat().length;
    const tabs = [["detalhes", "Detalhes", null], ["participantes", "Participantes", nPeople], ...(showSongs ? [["musicas", "Músicas", f.songs.length]] : []), ...(showCues ? [["roteiro", "Roteiro", cueCount]] : [])];
    el.innerHTML = `<div class="pagehead"><a class="back" href="${scheduleId ? `#/escala/${scheduleId}` : `#/times/${f.team}`}">${icon("chevronLeft")}</a><h1>${scheduleId ? "Editar escala" : "Nova escala"}</h1>
      ${sched ? `<span class="tag ${sched.status === "published" ? "ok" : "gray"}">${sched.status === "published" ? "Publicada" : "Rascunho"}</span>` : ""}</div>
    <div class="tabsbar etabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" data-etab="${k}" class="${f.tab === k ? "on" : ""}">${l}${n != null ? ` <i class="cnt">${n}</i>` : ""}</button>`).join("")}</div>
    ${f.tab === "detalhes" ? tabDetails(team) : f.tab === "participantes" ? tabPeople() : f.tab === "musicas" ? tabSongs() : tabCues()}
    <div style="height:84px"></div>
    <button class="fabsave" id="savebtn" data-save="${f.publish ? "published" : "draft"}">${icon("check")} Salvar</button>`;
  }
  draw();

  const readForm = () => { const form = el.querySelector("#f"); if (!form) return; const d = Object.fromEntries(new FormData(form)); Object.assign(f, { title: d.title ?? f.title, date: d.date ?? f.date, time: d.time ?? f.time, end: d.end ?? f.end, location: d.location ?? f.location, notes: d.notes ?? f.notes, publish: d.publish === "on", repeat: d.repeat ?? f.repeat, until: d.until ?? f.until }); if (hasExt) f.ask = d.ask === "on"; if (d.team) f.team = d.team; };
  el.addEventListener("change", async (e) => {
    if (e.target.name === "team") { readForm(); f.picks.clear(); if (!teamHasRepertoire(teams.find((t) => t.id === e.target.value))) f.songs = []; await loadTeam(); await loadCandidates(); draw(); return; }
    if (["date", "time", "end"].includes(e.target.name)) { readForm(); await loadCandidates(); draw(); }
    if (e.target.name === "repeat") { readForm(); if (f.repeat !== "none" && !f.until) f.until = addDays(f.date, f.repeat === "monthly" ? 90 : 28); draw(); }
    if (["publish", "ask", "until"].includes(e.target.name)) readForm();
    if (e.target.dataset.key !== undefined) f.songs[Number(e.target.dataset.key)].song_key = e.target.value.trim() || null;
  });
  el.addEventListener("input", (e) => { if (["title", "location", "notes"].includes(e.target.name)) readForm(); if (e.target.name === "notes") { autosize(e.target); const c = el.querySelector("#ncount"); if (c) c.textContent = `${e.target.value.length}/500`; } if (e.target.dataset.pdesc !== undefined) f.palettes[Number(e.target.dataset.pdesc)].desc = e.target.value; });
  el.addEventListener("click", async (e) => {
    const t = e.target.closest("button, .pcard.pslot"); if (!t) return;
    if (t.dataset.etab) { readForm(); f.tab = t.dataset.etab; return draw(); }
    if (t.id === "openpal") { readForm(); f.view = "palette"; draw(); return window.scrollTo(0, 0); }
    if (t.dataset.pback !== undefined) { f.view = "main"; return draw(); }
    if (t.id === "padd") { f.palettes.push({ desc: "", colors: [] }); return draw(); }
    if (t.dataset.pdel !== undefined) { f.palettes.splice(Number(t.dataset.pdel), 1); return draw(); }
    if (t.dataset.pcolor !== undefined) return colorSheet(Number(t.dataset.pcolor));
    if (t.dataset.prm) { const [i, j] = t.dataset.prm.split(":").map(Number); f.palettes[i].colors.splice(j, 1); return draw(); }
    if (t.id === "psuggest") return suggestSheet();
    if (t.id === "cues") { const team = teams.find((x) => x.id === f.team); const cues = await must(sb.from("schedule_cues").select("*").eq("schedule_id", scheduleId).order("position")); return cueEditor(sched, team, cues, async () => { cueCount = (await sb.from("schedule_cues").select("id").eq("schedule_id", scheduleId)).data?.length || 0; draw(); }); }
    if (t.id === "addsong") { readForm(); return songPicker(f.songs, () => draw()); }
    if (t.dataset.up) { const i = Number(t.dataset.up); [f.songs[i - 1], f.songs[i]] = [f.songs[i], f.songs[i - 1]]; return draw(); }
    if (t.dataset.rm) { f.songs.splice(Number(t.dataset.rm), 1); return draw(); }
    if (t.dataset.slot) { e.stopPropagation(); const v = Math.max(1, Math.min(8, (f.slots.get(t.dataset.slot) ?? 1) + Number(t.dataset.d))); f.slots.set(t.dataset.slot, v); return draw(); }
    if (t.dataset.unpick) { const [rid, uid] = t.dataset.unpick.split(":"); f.picks.set(rid, (f.picks.get(rid) || []).filter((x) => x !== uid)); return draw(); }
    if (t.dataset.pick) { readForm(); return memberPicker(t.dataset.pick); }
    if (t.id === "addrole") return roleSheet();
    if (t.id === "suggest") { readForm(); if (!f.date || !f.time) return toast("Informe data e horário primeiro.", "err"); await loadCandidates(); suggest(); return draw(); }
    if (t.dataset.save) { readForm(); return save(f.publish ? "published" : "draft", t); }
  });

  // acrescenta mais uma vaga de uma função (ou repete uma que já existe)
  function roleSheet() {
    const sh = sheet(`<h3>Acrescentar função</h3><p class="small muted" style="margin-top:-6px">Escolha a função. Se ela já existir, é criada mais uma vaga igual.</p>
      <div class="list" style="max-height:60vh;overflow:auto">${teamRoles.map((r) => `<button class="li" data-ar="${r.id}"><span class="cover" style="width:40px;height:40px">${icon(roleIcon(r.name))}</span>
        <span class="grow"><span class="t">${esc(r.name)}</span></span>${icon("plus", "chev")}</button>`).join("")}</div>`, { wide: true });
    on(sh.el, "click", "[data-ar]", (e, b) => { const id = b.dataset.ar; f.slots.set(id, Math.min(8, Math.max(f.slots.get(id) ?? 1, (f.picks.get(id) || []).length) + 1)); sh.close(); draw(); });
  }

  function memberPicker(roleId) {
    const role = teamRoles.find((r) => r.id === roleId);
    const withRole = memberRoles.filter((r) => r.role_id === roleId).map((r) => r.user_id);
    const sel = new Set(f.picks.get(roleId) || []);
    const s = sheet(`<h3>${esc(role.name)}</h3><p class="small muted">Integrantes do time com esta função.</p><div class="list" style="max-height:60vh;overflow:auto">
      ${withRole.map((u) => { const w = warnFor(u, roleId); const c = candInfo(u, roleId); return `<button class="li" data-u="${u}">${avatar(ppl.get(u), 40, false)}
        <span class="grow"><span class="t">${esc(personName(ppl, u))}</span><span class="s">${c ? `${c.month_count} escala(s) no mês${c.monthly_limit != null ? ` · limite ${c.monthly_limit}` : ""}` : ""}</span>
        ${w.map((x) => `<span class="tiny ${/Indispon/.test(x) ? "danger-t" : "warn"}" style="display:block">${esc(x)}</span>`).join("")}</span>
        <span class="selbox ${sel.has(u) ? "on" : ""}">${icon("check")}</span></button>`; }).join("")}</div>
      <button class="btn primary block mt" id="ok">Confirmar</button>`);
    on(s.el, "click", "[data-u]", async (e, b) => {
      const u = b.dataset.u;
      if (!sel.has(u)) {
        // regra: a mesma pessoa em mais de uma função precisa de confirmação de quem está escalando
        const other = rolesOf(u).filter((rid) => rid !== roleId).map((rid) => teamRoles.find((r) => r.id === rid)?.name).filter(Boolean);
        if (other.length && !(await confirmDialog(`${personName(ppl, u)} já está escalado(a) como ${other.join(" e ")}. Escalar também como ${role.name}?`, "Escalar nas duas funções"))) return;
        sel.add(u);
      } else sel.delete(u);
      b.querySelector(".selbox").classList.toggle("on", sel.has(u));
    });
    s.el.querySelector("#ok").onclick = () => { f.picks.set(roleId, [...sel]); s.close(); draw(); };
  }

  // Sugestão: preenche as vagas vazias com quem tem a função, priorizando disponibilidade,
  // limite mensal, menos escalas no mês e respeitando as preferências "evitar escalar junto".
  function suggest() {
    const chosen = new Set([...f.picks.values()].flat());
    let filled = 0;
    for (const r of teamRoles) {
      const cur = f.picks.get(r.id) || [];
      const need = (f.slots.get(r.id) ?? 1) - cur.length;
      for (let k = 0; k < need; k++) {
        const pool = (candidates || []).filter((c) => c.role_id === r.id && !cur.includes(c.user_id) && !chosen.has(c.user_id));   // a sugestão não escala a mesma pessoa em duas funções
        if (!pool.length) break;
        const score = (c) => {
          let s = 0;
          if (!c.available) s += 10000;
          if (c.monthly_limit != null && c.month_count >= c.monthly_limit) s += 5000;
          if (chosen.has(c.user_id)) s += 800;
          s += (c.same_day_count || 0) * 300;
          const avoid = [...chosen].some((o) => (c.avoid_with || []).includes(o) || (teamMembers.find((m) => m.user_id === o)?.avoid_with || []).includes(c.user_id));
          if (avoid) s += 400;
          return s + c.month_count * 10 + Math.random();
        };
        const best = pool.sort((a, b) => score(a) - score(b))[0];
        if (score(best) >= 10000 && pool.every((c) => !c.available)) { /* ninguém disponível: ainda assim não escala automaticamente */ break; }
        cur.push(best.user_id); chosen.add(best.user_id); filled++;
      }
      f.picks.set(r.id, cur);
    }
    toast(filled ? `${filled} sugestão(ões) adicionada(s). Revise antes de publicar.` : "Nenhuma vaga para preencher.");
  }

  async function save(status, btn) {
    if (!f.title.trim()) { f.tab = "detalhes"; draw(); return toast("Informe o nome do evento.", "err"); }
    if (!f.date || !f.time) { f.tab = "detalhes"; draw(); return toast("Informe data e horário.", "err"); }
    // datas: uma só, ou todas as repetições
    let dates = [f.date];
    if (!scheduleId && f.repeat !== "none") {
      const step = f.repeat === "weekly" ? 7 : f.repeat === "biweekly" ? 14 : 0;
      const until = f.until && f.until >= f.date ? f.until : addDays(f.date, step ? 28 : 90);
      for (let i = 1; dates.length < MAX_REPEAT; i++) { const d = step ? addDays(f.date, step * i) : addMonths(f.date, i); if (d > until) break; dates.push(d); }
      if (dates.length > 1 && !(await confirmDialog(`Criar ${dates.length} escalas, de ${fDate(dates[0] + "T12:00:00")} a ${fDate(dates[dates.length - 1] + "T12:00:00")}?`, "Criar"))) return;
    }
    busy(btn);
    try {
      const want = [];
      for (const [rid, users] of f.picks) for (const u of users) want.push({ role_id: rid === "none" ? null : rid, user_id: u });
      const created = [];
      for (const date of dates) {
        const starts_at = fromLocal(date, f.time);
        let ends_at = f.end ? fromLocal(date, f.end) : null;
        if (ends_at && ends_at <= starts_at) ends_at = new Date(new Date(ends_at).getTime() + 864e5).toISOString();
        const row = { org_id: state.org.id, team_id: f.team, title: f.title.trim(), event_type: f.type || null, starts_at, ends_at, location: f.location || null, notes: f.notes || null };
        if (hasExt) { row.ask_confirmation = f.ask; row.palettes = f.palettes.filter((p) => p.colors.length).map((p) => ({ desc: p.desc.trim(), colors: p.colors })); }
        let id = scheduleId;
        // grava como rascunho primeiro e só publica no fim (as notificações saem com a escala completa)
        if (!id) id = (await must(sb.from("schedules").insert({ ...row, status: "draft", created_by: state.user.id }).select("id").single())).id;
        else await must(sb.from("schedules").update(row).eq("id", id));
        const cur = scheduleId ? await must(sb.from("schedule_assignments").select("id,user_id,role_id").eq("schedule_id", id)) : [];
        const key = (a) => `${a.user_id}:${a.role_id}`;
        const wantKeys = new Set(want.map(key));
        const del = cur.filter((a) => !wantKeys.has(key(a)));
        const add = want.filter((a) => !cur.some((c) => key(c) === key(a)));
        if (del.length) await must(sb.from("schedule_assignments").delete().in("id", del.map((d) => d.id)));
        if (add.length) await must(sb.from("schedule_assignments").insert(add.map((a) => ({ schedule_id: id, org_id: state.org.id, team_id: f.team, user_id: a.user_id, role_id: a.role_id,
          role_name: teamRoles.find((r) => r.id === a.role_id)?.name || null }))));
        await must(sb.from("schedule_songs").delete().eq("schedule_id", id));
        if (f.songs.length) await must(sb.from("schedule_songs").insert(f.songs.map((s, i) => ({ schedule_id: id, org_id: state.org.id, team_id: f.team, song_id: s.removed ? null : s.song_id,
          position: i, title_snapshot: s.title, artist_snapshot: s.artist || null, song_key: s.song_key || null, notes: s.notes || null }))));
        await must(sb.from("schedules").update({ status }).eq("id", id));
        created.push(id);
      }
      toast(created.length > 1 ? `${created.length} escalas ${status === "published" ? "publicadas" : "salvas como rascunho"}` : status === "published" ? "Escala publicada" : "Rascunho salvo");
      go(created.length > 1 ? `/times/${f.team}/escalas` : `/escala/${created[0]}`);
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  }
}

const MAX_REPEAT = 26;
const autosize = (t) => { if (!t) return; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; };
const CATALOG = [["Branco", "#ffffff"], ["Off-white", "#f5efe6"], ["Bege", "#d9c3a0"], ["Areia", "#c8ad7f"], ["Caramelo", "#b7773e"], ["Marrom", "#6b4226"], ["Terracota", "#c4673d"], ["Mostarda", "#d9a521"],
  ["Amarelo", "#f2d03b"], ["Laranja", "#f08a24"], ["Vermelho", "#d1343b"], ["Vinho", "#7a1f35"], ["Rosé", "#e8b4b8"], ["Rosa", "#e0629b"], ["Lilás", "#b79ad6"], ["Roxo", "#6b3fa0"],
  ["Azul claro", "#9cc9f2"], ["Azul", "#2f6fd6"], ["Azul marinho", "#1b2a5c"], ["Turquesa", "#25a6a0"], ["Verde claro", "#a8cf6a"], ["Verde", "#3f9b5a"], ["Verde oliva", "#6b7a3a"], ["Verde escuro", "#1f4d3a"],
  ["Cinza claro", "#cfd3d8"], ["Cinza", "#8b9099"], ["Grafite", "#3c4048"], ["Preto", "#111111"]].map(([n, h]) => [n, h]);
const SUGGESTED = [["Branco e azul", ["#ffffff", "#9cc9f2", "#1b2a5c"]], ["Tons terrosos", ["#6b4226", "#b7773e", "#d9c3a0", "#6b7a3a"]], ["Preto e branco", ["#111111", "#ffffff", "#8b9099"]],
  ["Vinho e rosé", ["#7a1f35", "#e8b4b8", "#f5efe6"]], ["Verde e creme", ["#1f4d3a", "#a8cf6a", "#f5efe6"]], ["Pastel", ["#e8b4b8", "#9cc9f2", "#a8cf6a", "#f2d03b"]],
  ["Azul e dourado", ["#1b2a5c", "#2f6fd6", "#d9a521"]], ["Neutros", ["#f5efe6", "#d9c3a0", "#8b9099", "#3c4048"]]];
const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
const addMonths = (d, n) => { const x = new Date(d + "T12:00:00"); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return ymd(x); };

export function songPicker(selected, done, { title = "Adicionar músicas", multi = true } = {}) {
  const s = sheet(`<h3>${title}</h3><label class="search mb" style="display:block">${icon("search")}<input class="input" id="q" placeholder="Buscar no repertório"></label>
    <div class="list" id="res" style="max-height:58vh;overflow:auto">${spinner()}</div>${multi ? `<button class="btn primary block mt" id="ok">Concluir</button>` : ""}`, { wide: true });
  let rows = [];
  const draw = (q = "") => {
    const ql = q.toLowerCase();
    const list = rows.filter((r) => !ql || r.title.toLowerCase().includes(ql) || (r.artist || "").toLowerCase().includes(ql));
    s.el.querySelector("#res").innerHTML = list.map((r) => {
      const on = selected.some((x) => x.song_id === r.id);
      return `<button class="li" data-s="${r.id}"><span class="cover" style="width:42px;height:42px">${r.cover_url ? `<img src="${attr(r.cover_url)}" alt="">` : icon("music")}</span>
        <span class="grow" style="min-width:0"><span class="t ellipsis" style="display:block">${esc(r.title)}</span><span class="s">${esc(r.artist || "")}${r.song_key ? " · " + esc(r.song_key) : ""}${r.bpm ? " · " + Number(r.bpm) + " BPM" : ""}${r.current_project_id ? " · VS" : ""}</span></span>
        ${multi ? `<span class="selbox ${on ? "on" : ""}">${icon("check")}</span>` : icon("chevronRight", "chev")}</button>`;
    }).join("") || `<div class="li muted">Nenhuma música encontrada.</div>`;
  };
  sb.from("songs").select("id,title,artist,song_key,bpm,cover_url,current_project_id,status").eq("org_id", state.org.id).eq("status", "ready").order("title").then((r) => { rows = r.data || []; draw(); });
  s.el.querySelector("#q").oninput = (e) => draw(e.target.value);
  on(s.el, "click", "[data-s]", (e, b) => {
    const r = rows.find((x) => x.id === b.dataset.s);
    if (!multi) { s.close(); return done(r); }
    const i = selected.findIndex((x) => x.song_id === r.id);
    if (i >= 0) selected.splice(i, 1); else selected.push({ song_id: r.id, title: r.title, artist: r.artist, song_key: r.song_key });
    b.querySelector(".selbox").classList.toggle("on", i < 0);
  });
  s.el.querySelector("#ok")?.addEventListener("click", () => { s.close(); done(); });
}

// ---------------------------------------------------------------- detalhe
async function detail(el, id, tab = "det") {
  el.innerHTML = spinner();
  const s = await must(sb.from("schedules").select("*,teams(*)").eq("id", id).maybeSingle());
  if (!s) { el.innerHTML = empty("alert", "Escala não encontrada", "Ela pode ter sido excluída ou ainda é um rascunho."); return; }
  const showCues = !!(s.teams && teamHas(s.teams, "roteiro"));
  const [assigns, songs, ppl, cues] = await Promise.all([
    must(sb.from("schedule_assignments").select("*").eq("schedule_id", id)),
    must(sb.from("schedule_songs").select("*,songs(id,status,current_project_id,cover_url,youtube_url,chords_url,bpm,duration_sec)").eq("schedule_id", id).order("position")),
    people(),
    showCues ? sb.from("schedule_cues").select("id").eq("schedule_id", id).then((r) => r.data || []) : Promise.resolve([]),
  ]);
  const manage = canManageTeam(s.team_id);
  const mine = assigns.filter((a) => a.user_id === state.user.id);
  const askConf = s.ask_confirmation !== false;
  const unseen = askConf && s.status === "published" && mine.some((a) => !a.seen_at);
  const uniq = [...new Set(assigns.map((a) => a.user_id))];
  const seenN = new Set(assigns.filter((a) => a.seen_at).map((a) => a.user_id)).size;
  const byRole = new Map();
  for (const a of assigns) { const k = a.role_name || "Sem função"; if (!byRole.has(k)) byRole.set(k, []); byRole.get(k).push(a); }
  const showSongs = teamHasRepertoire(s.teams) || songs.length;
  const tabs = [["det", "Detalhes", null], ...(showSongs ? [["mus", "Músicas", songs.length]] : []),
    ["par", "Participantes", askConf && s.status === "published" ? `${seenN}/${uniq.length}` : uniq.length], ...(showCues ? [["rot", "Roteiro", cues.length]] : [])];
  if (!tabs.some((t) => t[0] === tab)) tab = "det";
  const today = ymd(s.starts_at) === ymd(new Date());
  const pending = askConf && s.status === "published" && uniq.length > 0 && seenN < uniq.length;
  const row = (ic, label, value, go2) => `<${go2 ? `button type="button" data-goto="${go2}"` : "div"} class="menurow">${icon(ic)}<span class="grow">${label}</span><span class="muted small">${value}</span>${go2 ? icon("chevronRight") : ""}</${go2 ? "button" : "div"}>`;
  const panes = {
    det: () => `<div class="list">${askConf && s.status === "published" ? row("check", "Confirmados", `${seenN} de ${uniq.length}`, "par") : ""}
        ${showCues ? row("list", "Roteiro", `${cues.length} ${cues.length === 1 ? "item" : "itens"}`, "rot") : ""}${row("users", "Participantes", String(uniq.length), "par")}</div>
      ${unseen ? `<button class="btn primary block mt" id="seen">${icon("eye")} Tomei conhecimento da escala</button>` : mine.length && askConf ? `<p class="small ok row gap-s mt">${icon("check")} Você confirmou que viu esta escala.</p>` : ""}
      ${s.notes ? `<div class="sec">${icon("edit")}<h2>Observações</h2></div><div class="card"><p style="margin:0">${linkify(s.notes)}</p></div>` : ""}
      ${(s.palettes || []).length ? `<div class="sec">${icon("shirt")}<h2>Vestimentas</h2></div><div class="card">${s.palettes.map((p) => `<div class="palview">${p.desc ? `<b class="small">${esc(p.desc)}</b>` : ""}<div class="pcolors">${(p.colors || []).map((c) => `<span class="pcol big" style="background:${attr(c)}" title="${attr(c)}"></span>`).join("")}</div></div>`).join("")}</div>` : ""}
      ${manage ? `<div class="row gap mt wrap"><a class="btn ghost grow" href="#/escala/${id}/editar">${icon("edit")} Editar</a>
        ${s.status === "draft" ? `<button class="btn primary grow" id="pub">${icon("check")} Publicar</button>` : ""}<button class="btn danger" id="del">${icon("trash")}</button></div>` : ""}`,
    mus: () => `<div class="list">${songs.length ? songs.map((x, i) => {
      const live = x.songs && x.songs.status !== "removed";
      return `<div class="song"><span class="cover">${x.songs?.cover_url ? `<img src="${attr(x.songs.cover_url)}" alt="">` : `<b style="font-size:18px">${i + 1}</b>`}</span>
        <a class="grow" style="color:inherit;min-width:0" ${live ? `href="#/musica/${x.song_id}"` : ""}><div class="t ellipsis">${esc(x.title_snapshot)}</div>
          <div class="s">${esc(x.artist_snapshot || "")}${x.song_key ? `<span>Tom ${esc(x.song_key)}</span>` : ""}${x.songs?.bpm ? `<span>${Number(x.songs.bpm)} BPM</span>` : ""}${!live ? `<span class="tag gray">fora do repertório</span>` : ""}</div></a>
        ${live && x.songs.current_project_id ? `<a class="playbtn" href="#/player/${x.song_id}" aria-label="Tocar">${icon("play")}</a>` : live && x.songs.youtube_url ? `<a class="playbtn" href="${attr(x.songs.youtube_url)}" target="_blank" rel="noopener" aria-label="YouTube">${icon("youtube")}</a>` : ""}</div>`;
    }).join("") : `<div class="li muted small">Nenhuma música definida.</div>`}</div>`,
    par: () => `<div class="list">${[...byRole.entries()].map(([role, list]) => list.map((a) => `<div class="li">${avatar(ppl.get(a.user_id), 40, false)}<span class="grow"><span class="t">${esc(personName(ppl, a.user_id))}</span><span class="s">${esc(role)}</span></span>
      ${s.status === "published" && askConf ? (a.seen_at ? `<span class="tiny ok row gap-s">${icon("check")} Visto</span>` : `<span class="tiny muted">Não visto</span>`) : ""}</div>`).join("")).join("") || `<div class="li muted small">Ninguém escalado ainda.</div>`}</div>`,
    rot: () => `<div id="extras"></div>`,
  };
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><div class="grow"><h1 class="dtitle">${esc(s.title)}</h1>
      <span class="small muted">${esc(s.teams?.name || "")}</span></div>${s.status === "draft" ? `<span class="tag gray">Rascunho</span>` : ""}</div>
    <p class="dwhen">${fTime(s.starts_at)}${s.ends_at ? "–" + fTime(s.ends_at) : ""} · ${esc(cap(fDow(s.starts_at)).replace(/\.$/, ""))} · ${esc(new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(s.starts_at)))}${today ? ` <span class="tag soft">Hoje</span>` : ""}</p>
    <div class="chips dchips">${pending ? `<span class="chip warnchip">${icon("clock")} Confirmação pendente</span>` : ""}<button class="chip" id="share" type="button">${icon("share")} Compartilhar</button></div>
    <div class="tabsbar etabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" data-dtab="${k}" class="${tab === k ? "on" : ""}">${l}${n != null ? ` <i class="cnt">${n}</i>` : ""}</button>`).join("")}</div>
    <div id="pane">${panes[tab]()}</div>`;
  if (tab === "rot") scheduleExtras(el.querySelector("#extras"), s).catch((e) => console.warn(e));
  el.querySelectorAll("[data-dtab]").forEach((b) => b.addEventListener("click", () => detail(el, id, b.dataset.dtab)));
  el.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => detail(el, id, b.dataset.goto)));
  el.querySelector("#share")?.addEventListener("click", async () => {
    const data = { title: s.title, text: `${s.title} — ${fDateLong(s.starts_at)} às ${fTime(s.starts_at)}`, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast("Link copiado"); } } catch { /* cancelado */ }
  });
  el.querySelector("#seen")?.addEventListener("click", async (e) => {
    busy(e.target); const r = await sb.rpc("mark_schedule_seen", { p_schedule: id });
    if (r.error) { busy(e.target, false); return toast(errMsg(r.error), "err"); }
    toast("Confirmado"); detail(el, id, tab);
  });
  el.querySelector("#pub")?.addEventListener("click", async () => {
    const r = await sb.from("schedules").update({ status: "published" }).eq("id", id);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Escala publicada"); detail(el, id, tab);
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir esta escala?", "Excluir", true))) return;
    const r = await sb.from("schedules").delete().eq("id", id);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Escala excluída"); go(`/times/${s.team_id}`);
  });
}

// ---------------------------------------------------------------- calendários
async function calendar(el, scope) {
  const inTeam = scope.startsWith("time:") && state.space?.id === scope.slice(5);
  let month = new Date(ymd(new Date()) + "T12:00:00"); month.setDate(1);
  let selDay = ymd(new Date());
  const MODE_KEY = "somos.sched.mode";
  let mode = "calendar"; try { mode = localStorage.getItem(MODE_KEY) === "timeline" ? "timeline" : "calendar"; } catch {}
  const ppl = await people();
  const allTeams = await must(sb.from("teams").select("id,name,accent_color,logo_url").eq("org_id", state.org.id).order("name"));
  async function load() {
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
    if (scope === "meu") {
      const rows = await must(sb.from("schedule_assignments").select("role_name,seen_at,schedules!inner(*,teams(name,accent_color))").eq("user_id", state.user.id).eq("org_id", state.org.id)
        .eq("schedules.status", "published").gte("schedules.starts_at", from).lt("schedules.starts_at", to));
      const m = new Map();
      for (const r of rows) { const s = r.schedules; if (!m.has(s.id)) m.set(s.id, { ...s, roles: [], seen_at: r.seen_at }); if (r.role_name) m.get(s.id).roles.push(r.role_name); }
      return [...m.values()];
    }
    let q = sb.from("schedules").select("*,teams(name,accent_color)").eq("org_id", state.org.id).gte("starts_at", from).lt("starts_at", to).order("starts_at");
    if (scope.startsWith("time:")) q = q.eq("team_id", scope.slice(5));
    return must(q);
  }
  async function draw() {
    el.innerHTML = spinner();
    const evs = (await load()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    let extra = { who: new Map(), songs: new Map() };
    if (mode === "timeline" && evs.length) extra = await loadExtra(evs.map((e) => e.id));
    const first = new Date(month); const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const today = ymd(new Date());
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(`<div class="d out"></div>`);
    for (let d = 1; d <= last.getDate(); d++) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const n = evs.filter((e) => ymd(e.starts_at) === key);
      cells.push(`<button class="d${key === today ? " today" : ""}${key === selDay ? " sel" : ""}" data-day="${key}">${d}<span class="marks">${n.slice(0, 3).map((e) => `<i style="background:${attr(e.teams?.accent_color || "var(--accent)")}"></i>`).join("")}</span></button>`);
    }
    const dayEvs = evs.filter((e) => ymd(e.starts_at) === selDay);
    const myTeamIds = new Set(state.myTeams.map((t) => t.id));
    const teamChips = (isAdmin() ? allTeams : allTeams.filter((t) => myTeamIds.has(t.id)));
    el.innerHTML = `<div class="pagehead">${inTeam ? "" : `<a class="back" href="#/">${icon("chevronLeft")}</a>`}<h1>${inTeam ? "Escalas" : scope === "meu" ? "Minhas escalas" : "Calendário"}</h1><button class="iconbtn" id="modebtn" aria-label="${mode === "timeline" ? "Ver em calendário" : "Ver em linha do tempo"}" title="${mode === "timeline" ? "Modo calendário" : "Modo linha do tempo"}">${icon(mode === "timeline" ? "calendar" : "list")}</button>${inTeam && canManageTeam(scope.slice(5)) ? `<a class="iconbtn add" id="addsched" href="#/escala/nova/${scope.slice(5)}?data=${selDay}" aria-label="Nova escala em ${fDate(selDay + "T12:00:00")}">${icon("plus")}</a>` : ""}</div>
      ${inTeam ? "" : `<div class="chips mb"><a class="chip ${scope === "geral" ? "on" : ""}" href="#/calendario/geral">${icon("org")} Geral</a><a class="chip ${scope === "meu" ? "on" : ""}" href="#/calendario/meu">${icon("calendar")} Minhas escalas</a>
        ${teamChips.map((t) => `<a class="chip ${scope === "time:" + t.id ? "on" : ""}" href="#/calendario/time:${t.id}"><i style="width:8px;height:8px;border-radius:8px;background:${attr(t.accent_color || "var(--accent)")}"></i>${esc(t.name)}</a>`).join("")}</div>`}
      ${mode === "timeline" ? timeline(evs, extra) : `<div class="card"><div class="calhead"><button class="iconbtn" data-m="-1">${icon("chevronLeft")}</button><b>${fMonthYear(month)}</b><button class="iconbtn" data-m="1">${icon("chevronRight")}</button></div>
        <div class="cal">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells.join("")}</div></div>`}
      ${inTeam ? `<div class="menulist"><a href="#/panorama">${icon("bars")}<span class="grow">Panorama de escalas<small>Quantas vezes cada pessoa serve no mês</small></span>${icon("chevronRight", "chev")}</a></div>` : ""}
      ${mode === "timeline" ? "" : `<div class="sec"><h2>${esc(cap(fDateLong(selDay + "T15:00:00Z")))}</h2></div>
      ${dayEvs.length ? dayEvs.map((s) => schedRow(s)).join("") : `<p class="muted small">Nada neste dia.</p>`}
      <div class="sec"><h2>Todos do mês</h2><span class="muted small">${evs.length}</span></div>
      ${evs.length ? evs.map((s) => schedRow(s)).join("") : `<div class="card">${empty("calendar", "Nenhuma escala neste mês")}</div>`}`}`;
  }
  async function loadExtra(ids) {
    const [as, ss] = await Promise.all([
      sb.from("schedule_assignments").select("schedule_id,user_id,seen_at").in("schedule_id", ids),
      sb.from("schedule_songs").select("schedule_id").in("schedule_id", ids)]);
    const who = new Map(), songs = new Map();
    for (const r of as.data || []) { if (!who.has(r.schedule_id)) who.set(r.schedule_id, new Map()); who.get(r.schedule_id).set(r.user_id, r.seen_at); }
    for (const r of ss.data || []) songs.set(r.schedule_id, (songs.get(r.schedule_id) || 0) + 1);
    return { who, songs };
  }
  // Linha do tempo: escalas do mês uma embaixo da outra, agrupadas por dia
  function timeline(evs, { who, songs }) {
    const month_ = fMonthYear(month);
    const nav = `<div class="card"><div class="calhead"><button class="iconbtn" data-m="-1">${icon("chevronLeft")}</button><b>${month_}</b><button class="iconbtn" data-m="1">${icon("chevronRight")}</button></div></div>`;
    if (!evs.length) return nav + `<div class="card mt">${empty("calendar", "Nenhuma escala neste mês")}</div>`;
    const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
    const byDay = new Map();
    for (const e of evs) { const k = ymd(e.starts_at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    return nav + [...byDay].map(([k, list]) => {
      const iso = k + "T15:00:00Z";
      const rel = k === today ? " • Hoje" : k === tomorrow ? " • Amanhã" : "";
      return `<div class="tl-day${k === today ? " today" : ""}"><h2>${Number(k.slice(8))} ${esc(cap(fMon(iso)).replace(/\.$/, ""))} • ${esc(cap(new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(new Date(iso))))}${rel}</h2>
        ${list.map((e) => {
          const m = who.get(e.id) || new Map(), ids = [...m.keys()];
          const mine = m.has(state.user.id) ? m.get(state.user.id) : undefined;
          const st = e.status === "draft" ? `<span class="tag gray">Rascunho</span>` : mine === undefined || e.ask_confirmation === false ? "" : mine ? `<span class="tag soft">${icon("check")} Visto</span>` : `<span class="tag warn">Pendente</span>`;
          const n = songs.get(e.id) || 0;
          return `<a class="tlcard${e.status === "draft" ? " draft" : ""}" href="#/escala/${e.id}" style="--tc:${attr(e.teams?.accent_color || "var(--accent)")}">
            <div class="top"><h3>${esc(e.title)}</h3>${st}</div>
            <div class="meta">${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ""}</div>
            <div class="foot"><span class="avs">${ids.slice(0, 6).map((u) => avatar(ppl.get(u) || { display_name: "?" }, 28, false)).join("")}${ids.length > 6 ? `<span class="more">+${ids.length - 6}</span>` : ""}</span>
              <span class="muted small">${icon("music")} ${n} ${n === 1 ? "música" : "músicas"}</span></div></a>`;
        }).join("")}</div>`;
    }).join("");
  }
  el.addEventListener("click", (e) => {
    const m = e.target.closest("[data-m]"); if (m) { month.setMonth(month.getMonth() + Number(m.dataset.m)); selDay = ymd(month); return draw(); }
    const d = e.target.closest("[data-day]"); if (d) { selDay = d.dataset.day; draw(); }
    if (e.target.closest("#modebtn")) { mode = mode === "timeline" ? "calendar" : "timeline"; try { localStorage.setItem(MODE_KEY, mode); } catch {} draw(); }
  });
  await draw();
}

// ---------------------------------------------------------------- panorama de escalas
const DOWS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const tzParts = (iso) => {
  const f = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, weekday: "short", timeZone: TZ_SP }).formatToParts(new Date(iso));
  const h = Number(f.find((x) => x.type === "hour").value) % 24, w = f.find((x) => x.type === "weekday").value;
  return { h, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w) };
};
const TZ_SP = "America/Sao_Paulo";

async function panorama(_, el, alive) {
  const teamIds = state.space ? [state.space.id] : (isAdmin() ? null : state.myTeams.map((t) => t.id));
  const ppl = await people();
  const flt = { month: new Date(ymd(new Date()) + "T12:00:00"), h0: 0, h1: 24, user: "all", dows: [true, true, true, true, true, true, true] };
  flt.month.setDate(1);
  const ui = { compact: false, onlyFilled: false };
  const cache = new Map(); // mês -> dados, para trocar de mês sem piscar
  const mkey = () => `${flt.month.getFullYear()}-${flt.month.getMonth()}`;
  const roleOrder = new Map();
  try { for (const r of await must(sb.from("music_roles").select("name,sort").eq("org_id", state.org.id))) roleOrder.set(r.name, r.sort); } catch { /* sem ordem */ }

  async function load() {
    const k = mkey();
    if (cache.has(k)) return cache.get(k);
    const from = new Date(flt.month.getFullYear(), flt.month.getMonth(), 1).toISOString();
    const to = new Date(flt.month.getFullYear(), flt.month.getMonth() + 1, 1).toISOString();
    const none = ["00000000-0000-0000-0000-000000000000"];
    let q1 = sb.from("schedules").select("id,title,team_id,starts_at,ask_confirmation").eq("org_id", state.org.id).eq("status", "published").gte("starts_at", from).lt("starts_at", to).order("starts_at");
    if (teamIds) q1 = q1.in("team_id", teamIds.length ? teamIds : none);
    const scheds = await must(q1);
    const ids = scheds.map((x) => x.id);
    const as = ids.length ? await must(sb.from("schedule_assignments").select("schedule_id,user_id,role_name,seen_at").in("schedule_id", ids)) : [];
    const d = { scheds: scheds.map((x) => ({ ...x, ...tzParts(x.starts_at) })), as };
    cache.set(k, d); return d;
  }

  const visible = (d) => {
    const scheds = d.scheds.filter((s) => s.h >= flt.h0 && (s.h < flt.h1 || flt.h1 === 24) && flt.dows[s.dow]
      && (flt.user === "all" || d.as.some((a) => a.schedule_id === s.id && a.user_id === flt.user)));
    const keep = new Set(scheds.map((s) => s.id));
    const as = d.as.filter((a) => keep.has(a.schedule_id) && (flt.user === "all" || a.user_id === flt.user));
    return { scheds, as };
  };

  async function draw() {
    if (!cache.has(mkey())) el.innerHTML = spinner();
    const d0 = await load();
    if (alive && !alive()) return;
    const { scheds, as } = visible(d0);
    const used = new Set(as.map((a) => a.role_name || "Sem função"));
    let roles = [...new Set([...roleOrder.keys(), ...used])].filter((r) => used.has(r) || !ui.onlyFilled && roleOrder.has(r));
    if (ui.onlyFilled) roles = roles.filter((r) => used.has(r));
    roles.sort((a, b) => (roleOrder.get(a) ?? 999) - (roleOrder.get(b) ?? 999) || a.localeCompare(b));
    const people_ = new Map();
    for (const a of as) { if (!people_.has(a.user_id)) people_.set(a.user_id, new Set()); people_.get(a.user_id).add(a.schedule_id); }
    const today = ymd(new Date());
    const cw = ui.compact ? 58 : 84, rw = ui.compact ? 70 : 96, rh = ui.compact ? 58 : 84;
    const dot = (s, a) => s.ask_confirmation === false ? "" : `<i class="pdot ${a.seen_at ? "ok" : "wait"}"></i>`;
    const cell = (r, s) => {
      const list = as.filter((a) => a.schedule_id === s.id && (a.role_name || "Sem função") === r);
      if (!list.length) return `<button class="pcell empty" data-cell="${s.id}|${attr(r)}" aria-label="Vaga livre">${canManageTeam(s.team_id) ? icon("plus") : ""}</button>`;
      const sz = list.length > 1 ? (ui.compact ? 26 : 32) : (ui.compact ? 36 : 44);
      return `<button class="pcell" data-cell="${s.id}|${attr(r)}">${list.map((a) => `<span class="pav">${avatar(ppl.get(a.user_id), sz, false)}${dot(s, a)}</span>`).join("")}</button>`;
    };
    const grid = scheds.length ? `<div class="pgrid-wrap"><div class="pgrid" style="grid-template-columns:${rw}px repeat(${scheds.length},${cw}px);grid-auto-rows:${rh}px">
        <div class="ph corner">${icon("calendar")}</div>
        ${scheds.map((s) => `<button class="ph day${ymd(s.starts_at) === today ? " today" : ""}" data-open="${s.id}"><b>${fDay(s.starts_at)}</b><span>${esc(fDow(s.starts_at).replace(/\.$/, ""))}</span><small>${fTime(s.starts_at)}</small></button>`).join("")}
        ${roles.map((r) => `<div class="ph role">${icon(roleIcon(r))}<span>${esc(r)}</span></div>${scheds.map((s) => cell(r, s)).join("")}`).join("")}</div></div>`
      : `<div class="card">${empty("bars", "Nenhuma escala neste período", "Troque o mês ou ajuste os filtros para ver as escalas publicadas.")}</div>`;
    const filtered = flt.h0 > 0 || flt.h1 < 24 || flt.user !== "all" || flt.dows.some((x) => !x);
    el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><div class="grow"><h1 style="font-size:22px">Panorama de escalas</h1>
        ${state.space ? `<span class="small muted">${esc(state.space.name)}</span>` : ""}</div><button class="iconbtn${filtered ? " on" : ""}" id="pfilter" aria-label="Filtros">${icon("filter")}</button></div>
      <div class="calhead"><button class="iconbtn" data-m="-1" aria-label="Mês anterior">${icon("chevronLeft")}</button><b>${fMonthYear(flt.month)}</b><button class="iconbtn" data-m="1" aria-label="Próximo mês">${icon("chevronRight")}</button></div>
      <div class="chips pchips"><button class="chip" id="ppeople">${icon("users")} ${people_.size}</button>
        <button class="chip" id="pview">${icon(ui.compact ? "list" : "calendar")} ${ui.compact ? "Compacta" : "Extensa"}</button>
        <button class="chip" id="proles">${icon("eye")} ${ui.onlyFilled ? "Só preenchidas" : "Todas funções"}</button></div>
      <p class="tiny muted" style="margin:6px 0 10px">${icon("hand")} Toque em uma célula para ver as opções</p>${grid}`;
  }

  const filterPage = () => {
    const f = { ...flt, dows: [...flt.dows] };
    const members = [...new Set([...cache.values()].flatMap((d) => d.as.map((a) => a.user_id)))].sort((a, b) => personName(ppl, a).localeCompare(personName(ppl, b)));
    const allUsers = [...(state.space ? [] : [])];
    const opts = (members.length ? members : [...ppl.keys()]).map((u) => `<option value="${u}" ${f.user === u ? "selected" : ""}>${esc(personName(ppl, u))}</option>`).join("");
    const paint = () => {
      el.innerHTML = `<div class="pagehead"><button class="back" id="fback" aria-label="Voltar">${icon("chevronLeft")}</button><h1 style="font-size:22px">Filtros</h1></div>
        <div class="calhead"><button class="iconbtn" data-fm="-1">${icon("chevronLeft")}</button><b class="accent">${fMonthYear(f.month)}</b><button class="iconbtn" data-fm="1">${icon("chevronRight")}</button></div>
        <div class="card"><div class="rng"><input type="range" id="h0" min="0" max="24" step="1" value="${f.h0}"><input type="range" id="h1" min="0" max="24" step="1" value="${f.h1}"></div>
          <p class="small muted" style="text-align:center;margin:8px 0 0" id="hlab">${f.h0}h / ${f.h1}h</p></div>
        <div class="sec"><h2>Membros</h2></div>
        <fieldset class="of"><select id="fuser"><option value="all">Todos</option>${opts}</select></fieldset>
        <div class="list"><label class="switchrow"><span class="grow">Dias da semana</span><span class="switch"><input type="checkbox" id="alld" ${f.dows.every(Boolean) ? "checked" : ""}><i></i></span></label>
          ${DOWS.map((n, i) => `<label class="switchrow"><span class="grow">${n}</span><span class="switch"><input type="checkbox" data-dow="${i}" ${f.dows[i] ? "checked" : ""}><i></i></span></label>`).join("")}</div>
        <button class="fabsave" id="fapply">${icon("check")} Aplicar</button>`;
      const lab = () => (el.querySelector("#hlab").textContent = `${f.h0}h / ${f.h1}h`);
      el.querySelector("#h0").oninput = (e) => { f.h0 = Math.min(Number(e.target.value), f.h1 - 1 < 0 ? 0 : f.h1); if (f.h0 > f.h1) f.h0 = f.h1; e.target.value = f.h0; lab(); };
      el.querySelector("#h1").oninput = (e) => { f.h1 = Math.max(Number(e.target.value), f.h0); e.target.value = f.h1; lab(); };
      el.querySelector("#fuser").onchange = (e) => (f.user = e.target.value);
      el.querySelector("#alld").onchange = (e) => { f.dows = f.dows.map(() => e.target.checked); paint(); };
      el.querySelectorAll("[data-dow]").forEach((c) => (c.onchange = () => { f.dows[Number(c.dataset.dow)] = c.checked; paint(); }));
      el.querySelectorAll("[data-fm]").forEach((b) => (b.onclick = () => { f.month = new Date(f.month.getFullYear(), f.month.getMonth() + Number(b.dataset.fm), 1, 12); paint(); }));
      el.querySelector("#fback").onclick = () => draw();
      el.querySelector("#fapply").onclick = () => { Object.assign(flt, f); draw(); };
    };
    void allUsers; paint();
  };

  el.addEventListener("click", (e) => {
    const t = e.target;
    const m = t.closest("[data-m]"); if (m) { flt.month = new Date(flt.month.getFullYear(), flt.month.getMonth() + Number(m.dataset.m), 1, 12); draw(); return; }
    if (t.closest("#pfilter")) return filterPage();
    if (t.closest("#pview")) { ui.compact = !ui.compact; return draw(); }
    if (t.closest("#proles")) { ui.onlyFilled = !ui.onlyFilled; return draw(); }
    const o = t.closest("[data-open]"); if (o) return go(`/escala/${o.dataset.open}`);
    if (t.closest("#ppeople")) {
      const { as } = visible(cache.get(mkey()) || { scheds: [], as: [] });
      const by = new Map();
      for (const a of as) { if (!by.has(a.user_id)) by.set(a.user_id, new Set()); by.get(a.user_id).add(a.schedule_id); }
      const list = [...by.entries()].map(([u, set]) => ({ u, n: set.size })).sort((a, b) => b.n - a.n || personName(ppl, a.u).localeCompare(personName(ppl, b.u)));
      const max = Math.max(1, ...list.map((x) => x.n));
      sheet(`<h3>Quem serviu em ${esc(fMonthYear(flt.month))}</h3><div class="pano">${list.map((x) => `<div><div class="row1">${avatar(ppl.get(x.u), 40, false)}<div class="who"><b class="ellipsis">${esc(personName(ppl, x.u))}</b>
        <small>${x.n} ${x.n === 1 ? "escala" : "escalas"} no mês</small></div><span class="n">${x.n}</span></div><div class="bar" style="margin-top:8px"><i style="width:${Math.round((x.n / max) * 100)}%"></i></div></div>`).join("") || `<p class="muted small">Ninguém escalado neste período.</p>`}</div>`, { wide: true });
      return;
    }
    const c = t.closest("[data-cell]");
    if (c) {
      const [sid, role] = c.dataset.cell.split("|");
      const d = visible(cache.get(mkey())), s = d.scheds.find((x) => x.id === sid);
      const list = d.as.filter((a) => a.schedule_id === sid && (a.role_name || "Sem função") === role);
      const sh = sheet(`<h3>${esc(role)}</h3><p class="small muted" style="margin-top:-6px">${esc(s.title)} · ${esc(cap(fDateLong(s.starts_at)))} às ${fTime(s.starts_at)}</p>
        <div class="list">${list.map((a) => `<div class="li">${avatar(ppl.get(a.user_id), 40, false)}<span class="grow"><span class="t">${esc(personName(ppl, a.user_id))}</span>
          <span class="s">${s.ask_confirmation === false ? "" : a.seen_at ? "Viu a escala" : "Ainda não viu"}</span></span></div>`).join("") || `<div class="li muted small">Vaga livre.</div>`}</div>
        <a class="btn primary block mt" href="#/escala/${sid}" data-close>${icon("calendar")} Abrir escala</a>
        ${!list.length && canManageTeam(s.team_id) ? `<a class="btn ghost block mt-s" href="#/escala/${sid}/editar" data-close>${icon("edit")} Escalar alguém</a>` : ""}`);
      sh.el.querySelectorAll("[data-close]").forEach((x) => x.addEventListener("click", () => sh.close()));
    }
  });
  await draw();
}
