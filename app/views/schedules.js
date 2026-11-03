// Escalas: criação/edição com sugestão automática, detalhe e calendários (geral, do time e pessoal).
import { sb, state, must, esc, attr, icon, avatar, teamBadge, people, personName, isAdmin, canManageTeam, isStaff, sheet, toast, errMsg, busy, on, go,
  empty, spinner, fDate, fDateLong, fTime, fDow, fDay, fMon, ymd, fromLocal, confirmDialog, roleIcon, linkify, fDur, fMonthYear, cap } from "../core.js";
import { schedRow } from "./home.js";

export function register(route) {
  route("/escala/nova", (p, el) => editor(el, null, null));
  route("/escala/nova/:team", (p, el) => editor(el, null, p.team));
  route("/escala/:id", (p, el) => detail(el, p.id));
  route("/escala/:id/editar", (p, el) => editor(el, p.id, null));
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
  teamId = teamId || teams[0].id;
  const ppl = await people();

  // estado do formulário
  const f = {
    team: teamId,
    title: sched?.title || "", type: sched?.event_type || "",
    date: sched ? ymd(sched.starts_at) : ymd(new Date(Date.now() + 864e5)),
    time: sched ? fTime(sched.starts_at) : "19:00",
    end: sched?.ends_at ? fTime(sched.ends_at) : "",
    location: sched?.location || "", notes: sched?.notes || "",
    // por função: [{user_id}]
    picks: new Map(), slots: new Map(), songs: songsSel,
  };
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

  const candInfo = (uid, roleId) => candidates?.find((c) => c.user_id === uid && c.role_id === roleId) || candidates?.find((c) => c.user_id === uid);
  const warnFor = (uid, roleId) => {
    const c = candInfo(uid, roleId); const w = [];
    if (c && !c.available) w.push(`Indisponível${c.unavailable_note ? ": " + c.unavailable_note : ""}`);
    if (c && c.monthly_limit != null && c.month_count >= c.monthly_limit) w.push(`Limite do mês (${c.month_count}/${c.monthly_limit})`);
    if (c && c.same_day_count > 0) w.push("Já escalado(a) neste dia");
    const others = [...f.picks.values()].flat().filter((x) => x !== uid);
    const tm = teamMembers.find((m) => m.user_id === uid);
    const clash = others.filter((o) => (tm?.avoid_with || []).includes(o) || (teamMembers.find((m) => m.user_id === o)?.avoid_with || []).includes(uid));
    if (clash.length) w.push(`Preferência: evitar com ${clash.map((x) => personName(ppl, x)).join(", ")}`);
    return w;
  };

  function draw() {
    const team = teams.find((t) => t.id === f.team);
    el.innerHTML = `<div class="pagehead"><a class="back" href="${scheduleId ? `#/escala/${scheduleId}` : `#/times/${f.team}`}">${icon("chevronLeft")}</a><h1>${scheduleId ? "Editar escala" : "Nova escala"}</h1>
      ${sched ? `<span class="tag ${sched.status === "published" ? "ok" : "gray"}">${sched.status === "published" ? "Publicada" : "Rascunho"}</span>` : ""}</div>
    <form class="card" id="f">
      <label class="field"><span>Time</span><select name="team" ${scheduleId ? "disabled" : ""}>${teams.map((t) => `<option value="${t.id}" ${t.id === f.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Nome ou tipo do evento *</span><input name="title" list="types" required maxlength="140" value="${attr(f.title)}" placeholder="Ex.: Culto de Celebração"><datalist id="types">${EVENT_TYPES.map((t) => `<option value="${t}">`).join("")}</datalist></label>
      <div class="three"><label class="field"><span>Data *</span><input type="date" name="date" required value="${f.date}"></label>
        <label class="field"><span>Início *</span><input type="time" name="time" required value="${f.time}"></label>
        <label class="field"><span>Término</span><input type="time" name="end" value="${f.end}"></label></div>
      <label class="field"><span>Local</span><input name="location" maxlength="140" value="${attr(f.location)}" placeholder="Ex.: Templo principal"></label>
      <label class="field"><span>Observações</span><textarea name="notes" maxlength="2000" placeholder="Roupa, horário de passagem de som, etc.">${esc(f.notes)}</textarea></label>
    </form>

    <div class="sec">${icon("music")}<h2>Músicas</h2><button class="more" id="addsong">${icon("plus")} Adicionar</button></div>
    <div class="list" id="songs">${f.songs.length ? f.songs.map((s, i) => `<div class="li"><span class="dim small" style="width:18px">${i + 1}</span>
      <span class="grow" style="min-width:0"><span class="t ellipsis" style="display:block">${esc(s.title)}${s.removed ? ` <span class="tag gray">fora do repertório</span>` : ""}</span><span class="s">${esc(s.artist || "")}</span></span>
      <input class="input" style="width:66px;height:38px;padding:0 8px;text-align:center" data-key="${i}" value="${attr(s.song_key || "")}" placeholder="Tom" aria-label="Tom">
      <button class="iconbtn" data-up="${i}" aria-label="Subir" ${i === 0 ? "disabled" : ""}>${icon("chevronUp")}</button>
      <button class="iconbtn" data-rm="${i}" aria-label="Remover">${icon("x")}</button></div>`).join("") : `<div class="li muted small">Nenhuma música selecionada.</div>`}</div>

    <div class="sec">${icon("users")}<h2>Integrantes</h2><button class="more" id="suggest">${icon("sparkle")} Sugerir escala</button></div>
    ${teamRoles.length ? `<div class="list">${teamRoles.map((r) => {
      const picked = f.picks.get(r.id) || [];
      return `<div class="li" style="align-items:flex-start"><span class="cover" style="width:40px;height:40px">${icon(roleIcon(r.name))}</span>
        <div class="grow" style="min-width:0"><div class="row between"><span class="t">${esc(r.name)}</span>
          <span class="row gap-s small muted">vagas <button class="chip" style="height:28px;padding:0 9px" data-slot="${r.id}" data-d="-1">−</button><b>${f.slots.get(r.id) ?? 1}</b><button class="chip" style="height:28px;padding:0 9px" data-slot="${r.id}" data-d="1">+</button></span></div>
          <div class="row wrap gap-s mt-s">${picked.map((u) => { const w = warnFor(u, r.id); return `<button class="chip on" data-unpick="${r.id}:${u}" title="${attr(w.join(" · "))}">${w.length ? `<span class="warn">${icon("alert")}</span>` : ""}${esc(personName(ppl, u))} ${icon("x")}</button>`; }).join("")}
            <button class="chip" data-pick="${r.id}">${icon("plus")} Escolher</button></div>
          ${picked.flatMap((u) => warnFor(u, r.id).map((w) => `<div class="tiny warn mt-s">${esc(personName(ppl, u))}: ${esc(w)}</div>`)).join("")}</div></div>`;
    }).join("")}</div>` : `<div class="card">${empty("users", "Nenhum integrante com função neste time", `Defina as funções musicais dos integrantes em <a class="link" href="#/times/${f.team}/integrantes">Integrantes</a>.`)}</div>`}

    <div class="row gap mt" style="flex-wrap:wrap">
      ${!sched || sched.status === "draft" ? `<button class="btn ghost grow" data-save="draft">Salvar rascunho</button><button class="btn primary grow" data-save="published">${icon("check")} Publicar escala</button>`
        : `<button class="btn primary grow" data-save="published">${icon("check")} Salvar alterações</button><button class="btn ghost" data-save="draft">Voltar para rascunho</button>`}
    </div><p class="tiny muted center mt-s">${team ? esc(team.name) : ""} · Publicar notifica os integrantes escalados.</p>`;
  }
  draw();

  const readForm = () => { const form = el.querySelector("#f"); if (!form) return; const d = Object.fromEntries(new FormData(form)); Object.assign(f, { title: d.title ?? f.title, date: d.date, time: d.time, end: d.end, location: d.location, notes: d.notes }); if (d.team) f.team = d.team; };
  el.addEventListener("change", async (e) => {
    if (e.target.name === "team") { readForm(); f.picks.clear(); await loadTeam(); await loadCandidates(); draw(); return; }
    if (["date", "time", "end"].includes(e.target.name)) { readForm(); await loadCandidates(); draw(); }
    if (e.target.dataset.key !== undefined) f.songs[Number(e.target.dataset.key)].song_key = e.target.value.trim() || null;
  });
  el.addEventListener("input", (e) => { if (["title", "location", "notes"].includes(e.target.name)) readForm(); });
  el.addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.id === "addsong") { readForm(); return songPicker(f.songs, () => draw()); }
    if (t.dataset.up) { const i = Number(t.dataset.up); [f.songs[i - 1], f.songs[i]] = [f.songs[i], f.songs[i - 1]]; return draw(); }
    if (t.dataset.rm) { f.songs.splice(Number(t.dataset.rm), 1); return draw(); }
    if (t.dataset.slot) { const v = Math.max(1, Math.min(8, (f.slots.get(t.dataset.slot) ?? 1) + Number(t.dataset.d))); f.slots.set(t.dataset.slot, v); return draw(); }
    if (t.dataset.unpick) { const [rid, uid] = t.dataset.unpick.split(":"); f.picks.set(rid, (f.picks.get(rid) || []).filter((x) => x !== uid)); return draw(); }
    if (t.dataset.pick) { readForm(); return memberPicker(t.dataset.pick); }
    if (t.id === "suggest") { readForm(); if (!f.date || !f.time) return toast("Informe data e horário primeiro.", "err"); await loadCandidates(); suggest(); return draw(); }
    if (t.dataset.save) { readForm(); return save(t.dataset.save, t); }
  });

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
    on(s.el, "click", "[data-u]", (e, b) => { const u = b.dataset.u; sel.has(u) ? sel.delete(u) : sel.add(u); b.querySelector(".selbox").classList.toggle("on", sel.has(u)); });
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
        const pool = (candidates || []).filter((c) => c.role_id === r.id && !cur.includes(c.user_id));
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
    if (!f.title.trim()) return toast("Informe o nome do evento.", "err");
    if (!f.date || !f.time) return toast("Informe data e horário.", "err");
    const starts_at = fromLocal(f.date, f.time);
    let ends_at = f.end ? fromLocal(f.date, f.end) : null;
    if (ends_at && ends_at <= starts_at) ends_at = new Date(new Date(ends_at).getTime() + 864e5).toISOString();
    busy(btn);
    try {
      const row = { org_id: state.org.id, team_id: f.team, title: f.title.trim(), event_type: f.type || null, starts_at, ends_at, location: f.location || null, notes: f.notes || null };
      let id = scheduleId;
      // grava como rascunho primeiro e só publica no fim (as notificações saem com a escala completa)
      if (!id) id = (await must(sb.from("schedules").insert({ ...row, status: "draft", created_by: state.user.id }).select("id").single())).id;
      else await must(sb.from("schedules").update(row).eq("id", id));
      // integrantes
      const want = [];
      for (const [rid, users] of f.picks) for (const u of users) want.push({ role_id: rid === "none" ? null : rid, user_id: u });
      const cur = scheduleId ? await must(sb.from("schedule_assignments").select("id,user_id,role_id").eq("schedule_id", id)) : [];
      const key = (a) => `${a.user_id}:${a.role_id}`;
      const wantKeys = new Set(want.map(key));
      const del = cur.filter((a) => !wantKeys.has(key(a)));
      const add = want.filter((a) => !cur.some((c) => key(c) === key(a)));
      if (del.length) await must(sb.from("schedule_assignments").delete().in("id", del.map((d) => d.id)));
      if (add.length) await must(sb.from("schedule_assignments").insert(add.map((a) => ({ schedule_id: id, org_id: state.org.id, team_id: f.team, user_id: a.user_id, role_id: a.role_id,
        role_name: teamRoles.find((r) => r.id === a.role_id)?.name || null }))));
      // músicas
      await must(sb.from("schedule_songs").delete().eq("schedule_id", id));
      if (f.songs.length) await must(sb.from("schedule_songs").insert(f.songs.map((s, i) => ({ schedule_id: id, org_id: state.org.id, team_id: f.team, song_id: s.removed ? null : s.song_id,
        position: i, title_snapshot: s.title, artist_snapshot: s.artist || null, song_key: s.song_key || null, notes: s.notes || null }))));
      if (status === "published" || (sched?.status === "published" && status === "published")) await must(sb.from("schedules").update({ status: "published" }).eq("id", id));
      else if (status === "draft") await must(sb.from("schedules").update({ status: "draft" }).eq("id", id));
      toast(status === "published" ? "Escala publicada" : "Rascunho salvo");
      go(`/escala/${id}`);
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  }
}

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
async function detail(el, id) {
  el.innerHTML = spinner();
  const s = await must(sb.from("schedules").select("*,teams(*)").eq("id", id).maybeSingle());
  if (!s) { el.innerHTML = empty("alert", "Escala não encontrada", "Ela pode ter sido excluída ou ainda é um rascunho."); return; }
  const [assigns, songs, ppl] = await Promise.all([
    must(sb.from("schedule_assignments").select("*").eq("schedule_id", id)),
    must(sb.from("schedule_songs").select("*,songs(id,status,current_project_id,cover_url,youtube_url,chords_url,bpm,duration_sec)").eq("schedule_id", id).order("position")),
    people(),
  ]);
  const manage = canManageTeam(s.team_id);
  const mine = assigns.filter((a) => a.user_id === state.user.id);
  const unseen = s.status === "published" && mine.some((a) => !a.seen_at);
  const byRole = new Map();
  for (const a of assigns) { const k = a.role_name || "Sem função"; if (!byRole.has(k)) byRole.set(k, []); byRole.get(k).push(a); }
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><div class="grow"><h1 style="font-size:24px">${esc(s.title)}</h1>
      <span class="small muted">${esc(s.teams?.name || "")}</span></div>${s.status === "draft" ? `<span class="tag gray">Rascunho</span>` : ""}</div>
    <div class="sched" style="pointer-events:none"><div class="date">${fDow(s.starts_at)}<b>${fDay(s.starts_at)}</b>${fMon(s.starts_at)}</div>
      <div class="info"><h3>${esc(cap(fDateLong(s.starts_at)))}</h3><div class="meta"><span>${icon("clock")}${fTime(s.starts_at)}${s.ends_at ? "–" + fTime(s.ends_at) : ""}</span>${s.location ? `<span>${icon("pin")}${esc(s.location)}</span>` : ""}</div></div><div></div></div>
    ${unseen ? `<button class="btn primary block" id="seen">${icon("eye")} Tomei conhecimento da escala</button>` : mine.length ? `<p class="small ok row gap-s">${icon("check")} Você confirmou que viu esta escala.</p>` : ""}
    ${s.notes ? `<div class="card mt"><p style="margin:0">${linkify(s.notes)}</p></div>` : ""}
    <div class="sec">${icon("music")}<h2>Repertório</h2></div>
    <div class="list">${songs.length ? songs.map((x, i) => {
      const live = x.songs && x.songs.status !== "removed";
      return `<div class="song"><span class="cover">${x.songs?.cover_url ? `<img src="${attr(x.songs.cover_url)}" alt="">` : `<b style="font-size:18px">${i + 1}</b>`}</span>
        <a class="grow" style="color:inherit;min-width:0" ${live ? `href="#/musica/${x.song_id}"` : ""}><div class="t ellipsis">${esc(x.title_snapshot)}</div>
          <div class="s">${esc(x.artist_snapshot || "")}${x.song_key ? `<span>Tom ${esc(x.song_key)}</span>` : ""}${x.songs?.bpm ? `<span>${Number(x.songs.bpm)} BPM</span>` : ""}${!live ? `<span class="tag gray">fora do repertório</span>` : ""}</div></a>
        ${live && x.songs.current_project_id ? `<a class="playbtn" href="#/player/${x.song_id}" aria-label="Tocar">${icon("play")}</a>` : live && x.songs.youtube_url ? `<a class="playbtn" href="${attr(x.songs.youtube_url)}" target="_blank" rel="noopener" aria-label="YouTube">${icon("youtube")}</a>` : ""}</div>`;
    }).join("") : `<div class="li muted small">Nenhuma música definida.</div>`}</div>
    <div class="sec">${icon("users")}<h2>Escalados</h2></div>
    <div class="list">${[...byRole.entries()].map(([role, list]) => list.map((a) => `<div class="li">${avatar(ppl.get(a.user_id), 40, false)}<span class="grow"><span class="t">${esc(personName(ppl, a.user_id))}</span><span class="s">${esc(role)}</span></span>
      ${s.status === "published" ? (a.seen_at ? `<span class="tiny ok row gap-s">${icon("check")} Visto</span>` : `<span class="tiny muted">Não visto</span>`) : ""}</div>`).join("")).join("") || `<div class="li muted small">Ninguém escalado ainda.</div>`}</div>
    ${manage ? `<div class="row gap mt wrap"><a class="btn ghost grow" href="#/escala/${id}/editar">${icon("edit")} Editar</a>
      ${s.status === "draft" ? `<button class="btn primary grow" id="pub">${icon("check")} Publicar</button>` : ""}<button class="btn danger" id="del">${icon("trash")}</button></div>` : ""}`;
  el.querySelector("#seen")?.addEventListener("click", async (e) => {
    busy(e.target); const r = await sb.rpc("mark_schedule_seen", { p_schedule: id });
    if (r.error) { busy(e.target, false); return toast(errMsg(r.error), "err"); }
    toast("Confirmado"); detail(el, id);
  });
  el.querySelector("#pub")?.addEventListener("click", async () => {
    const r = await sb.from("schedules").update({ status: "published" }).eq("id", id);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Escala publicada"); detail(el, id);
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
  let month = new Date(ymd(new Date()) + "T12:00:00"); month.setDate(1);
  let selDay = ymd(new Date());
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
    el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Calendário</h1></div>
      <div class="chips mb"><a class="chip ${scope === "geral" ? "on" : ""}" href="#/calendario/geral">${icon("org")} Geral</a><a class="chip ${scope === "meu" ? "on" : ""}" href="#/calendario/meu">${icon("calendar")} Minhas escalas</a>
        ${teamChips.map((t) => `<a class="chip ${scope === "time:" + t.id ? "on" : ""}" href="#/calendario/time:${t.id}"><i style="width:8px;height:8px;border-radius:8px;background:${attr(t.accent_color || "var(--accent)")}"></i>${esc(t.name)}</a>`).join("")}</div>
      <div class="card"><div class="calhead"><button class="iconbtn" data-m="-1">${icon("chevronLeft")}</button><b>${fMonthYear(month)}</b><button class="iconbtn" data-m="1">${icon("chevronRight")}</button></div>
        <div class="cal">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells.join("")}</div></div>
      <div class="sec"><h2>${esc(cap(fDateLong(selDay + "T15:00:00Z")))}</h2></div>
      ${dayEvs.length ? dayEvs.map((s) => schedRow(s)).join("") : `<p class="muted small">Nada neste dia.</p>`}
      <div class="sec"><h2>Todos do mês</h2><span class="muted small">${evs.length}</span></div>
      ${evs.length ? evs.map((s) => schedRow(s)).join("") : `<div class="card">${empty("calendar", "Nenhuma escala neste mês")}</div>`}`;
  }
  el.addEventListener("click", (e) => {
    const m = e.target.closest("[data-m]"); if (m) { month.setMonth(month.getMonth() + Number(m.dataset.m)); selDay = ymd(month); return draw(); }
    const d = e.target.closest("[data-day]"); if (d) { selDay = d.dataset.day; draw(); }
  });
  await draw();
}
