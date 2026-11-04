// Início: perfil, atalhos, avisos, próximas escalas, aniversariantes e bloqueio de datas.
import { sb, state, must, esc, attr, icon, avatar, fDow, fDay, fMon, fTime, fDate, fDateLong, ymd, people, personName, myName, isStaff, isAdmin,
  canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner, linkify, safeUrl, roleIcon, uploadPublic, pickFile, TZ, confirmDialog, fMonthYear, cap, hasRepertoire } from "../core.js";

export function register(route) {
  route("/", homeView);
  route("/inicio", homeView);
  route("/avisos", noticesView);
  route("/avisos/novo", (p, el) => noticeForm(el, null));
  route("/bloqueios", blocksView);
}

async function myRoles() {
  const r = await must(sb.from("team_member_roles").select("role_id,music_roles(name,sort)").eq("user_id", state.user.id).eq("org_id", state.org.id));
  const seen = new Map();
  for (const x of r) if (x.music_roles) seen.set(x.music_roles.name, x.music_roles.sort);
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

export async function upcomingAssignments(limit = 6) {
  const now = new Date(Date.now() - 3 * 3600e3).toISOString();
  const rows = await must(sb.from("schedule_assignments")
    .select("id,role_name,seen_at,schedule_id,schedules!inner(id,title,event_type,starts_at,location,status,team_id,teams(name,accent_color,logo_url))")
    .eq("user_id", state.user.id).eq("org_id", state.org.id).eq("schedules.status", "published").gte("schedules.starts_at", now));
  const by = new Map();
  for (const r of rows) {
    const k = r.schedule_id;
    if (!by.has(k)) by.set(k, { ...r.schedules, roles: [], seen_at: r.seen_at });
    if (r.role_name) by.get(k).roles.push(r.role_name);
    if (!r.seen_at) by.get(k).seen_at = null;
  }
  return [...by.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, limit);
}

export function schedRow(s, { showTeam = true } = {}) {
  const role = s.roles?.[0];
  return `<a class="sched${s.status === "draft" ? " draft" : ""}" href="#/escala/${s.id}">
    <div class="date">${fDow(s.starts_at)}<b>${fDay(s.starts_at)}</b>${fMon(s.starts_at)}</div>
    <div class="info"><h3>${esc(s.title)}</h3><div class="meta"><span>${icon("clock")}${fTime(s.starts_at)}</span>${s.location ? `<span>${icon("pin")}${esc(s.location)}</span>` : showTeam && s.teams ? `<span>${icon("users")}${esc(s.teams.name)}</span>` : ""}</div></div>
    <div class="side">${role ? `<span class="pill">${icon(roleIcon(role))}${esc(role)}${s.roles.length > 1 ? ` +${s.roles.length - 1}` : ""}</span>` : ""}
      ${s.status === "draft" ? `<span class="tag gray">Rascunho</span>` : s.seen_at === null ? `<span class="tag soft">Nova</span>` : s.seen_at ? `<span class="tiny ok">${icon("check")} Visto</span>` : ""}</div></a>`;
}

function nextBirthday(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const today = new Date(ymd(new Date()) + "T00:00:00");
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const days = Math.round((next - today) / 864e5);
  return { days, age: y > 1900 ? next.getFullYear() - y : null, date: next };
}

async function homeView(_, el, alive) {
  el.innerHTML = spinner();
  const [roles, notices, ups, ppl] = await Promise.all([
    myRoles(),
    must(sb.from("announcements").select("*").eq("org_id", state.org.id).order("created_at", { ascending: false }).limit(5)),
    upcomingAssignments(),
    people(),
  ]);
  if (!alive()) return;
  const name = myName().split(" ")[0] || "você";
  const bdays = [...ppl.values()].map((p) => ({ p, b: nextBirthday(p.birth_date) })).filter((x) => x.b && x.b.days <= 30).sort((a, b) => a.b.days - b.b.days).slice(0, 6);

  el.innerHTML = `
  <section class="hero">
    <a href="#/perfil">${avatar({ ...state.profile, display_name: myName() }, 96)}</a>
    <div class="grow"><h1>Olá, <b>${esc(name)}</b></h1>
      <div class="roles">${roles.length ? roles.map(esc).join(" &nbsp;•&nbsp; ") : `<a href="#/perfil">${esc(state.org.name)}</a>`}</div><div class="bar"></div></div>
  </section>
  <nav class="shortcuts">
    <a href="#/calendario/meu">${icon("music")}<span>Escalas</span></a>
    <a href="#/times">${icon("users")}<span>Times</span></a>
    ${hasRepertoire() ? `<a href="#/musicas">${icon("file")}<span>Músicas</span></a>` : `<a href="#/calendario">${icon("calendar")}<span>Agenda</span></a>`}
    <a href="#/chat">${icon("chat")}<span>Chat</span></a>
  </nav>

  <div class="sec">${icon("megaphone")}<h2>Avisos</h2><a href="#/avisos">Ver todos ${icon("chevronRight")}</a></div>
  ${notices.length ? `<div class="carousel" id="notices">${notices.map(noticeCard).join("")}</div>
    ${notices.length > 1 ? `<div class="dots" id="ndots">${notices.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}`
    : `<div class="card">${empty("megaphone", "Nenhum aviso por enquanto", isStaff() ? `<a class="link" href="#/avisos/novo">Publicar um aviso</a>` : "Os comunicados da igreja aparecem aqui.")}</div>`}

  <div class="sec">${icon("calendar")}<h2>Minhas próximas escalas</h2><a href="#/calendario/meu">Ver agenda ${icon("chevronRight")}</a></div>
  <div id="ups">${ups.length ? ups.map((s) => schedRow(s)).join("") : `<div class="card">${empty("calendar", "Você não tem escalas futuras", "Quando um líder publicar uma escala com você, ela aparece aqui.")}</div>`}</div>

  <div class="sec">${icon("gift")}<h2>Aniversariantes</h2></div>
  <div>${bdays.length ? bdays.map(({ p, b }) => `<div class="bday"><span style="position:relative">${avatar(p, 64)}<span class="cake">${icon("gift")}</span></span>
      <div class="grow"><b>${esc(p.display_name)}</b><br><span class="when">${b.days === 0 ? "Hoje" : b.days === 1 ? "Amanhã" : `Em ${b.days} dias`}, ${fDateLong(b.date).replace(/^[^,]+, /, "")}${b.age ? ` · ${b.age} anos` : ""}</span></div></div>`).join("")
    : `<p class="muted small">Nenhum aniversário nos próximos 30 dias.</p>`}</div>

  <div class="sec">${icon("lock")}<h2>Bloqueio de datas</h2><a href="#/bloqueios">Abrir ${icon("chevronRight")}</a></div>
  <div class="card" id="blocks"></div>`;

  const car = el.querySelector("#notices");
  if (car) car.addEventListener("scroll", () => {
    const i = Math.round(car.scrollLeft / car.clientWidth);
    el.querySelectorAll("#ndots i").forEach((d, k) => d.classList.toggle("on", k === i));
  }, { passive: true });
  on(el, "click", "[data-notice]", (e, b) => openNotice(notices.find((n) => n.id === b.dataset.notice), ppl));
  await blocksWidget(el.querySelector("#blocks"), { compact: true });
}

function noticeCard(n) {
  const img = safeUrl(n.image_url);
  return `<button class="notice" data-notice="${n.id}">
    <div class="art" ${img ? `style="background-image:url('${attr(img)}')"` : ""}>${img ? "" : icon("megaphone")}</div>
    <div style="padding:14px 0;min-width:0">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ""}<h3 class="ellipsis">${esc(n.title)}</h3>
      <div class="meta">${n.event_at ? `${icon("calendar")}${esc(fDateLong(n.event_at).replace(/-feira/, ""))} • ${fTime(n.event_at)}` : esc(fDate(n.created_at))}</div></div>
    <span class="go">${icon("chevronRight")}</span></button>`;
}

function openNotice(n, ppl) {
  if (!n) return;
  const link = safeUrl(n.link_url);
  const img = safeUrl(n.image_url);
  const canDel = n.created_by === state.user.id || isAdmin() || (n.team_id && canManageTeam(n.team_id));
  const s = sheet(`${img ? `<img src="${attr(img)}" alt="" style="border-radius:16px;margin-bottom:14px;max-height:260px;width:100%;object-fit:cover">` : ""}
    ${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ""}<h3 style="margin-top:8px">${esc(n.title)}</h3>
    ${n.event_at ? `<p class="row gap-s muted">${icon("calendar")}${esc(fDateLong(n.event_at))} às ${fTime(n.event_at)}</p>` : ""}
    ${n.body ? `<p>${linkify(n.body)}</p>` : ""}
    ${link ? `<a class="btn ghost block mt" href="${attr(link)}" target="_blank" rel="noopener">${icon("link")} Abrir link</a>` : ""}
    <p class="tiny muted mt">Publicado por ${esc(personName(ppl, n.created_by))} em ${fDate(n.created_at)}</p>
    ${canDel ? `<button class="btn danger sm mt" data-del>${icon("trash")} Excluir aviso</button>` : ""}`);
  s.el.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este aviso?", "Excluir", true))) return;
    const r = await sb.from("announcements").delete().eq("id", n.id);
    if (r.error) return toast(errMsg(r.error), "err");
    s.close(); toast("Aviso excluído"); go(location.hash.slice(1));
  });
}

async function noticesView(_, el) {
  el.innerHTML = spinner();
  const [rows, ppl] = await Promise.all([
    must(sb.from("announcements").select("*,teams(name)").eq("org_id", state.org.id).order("created_at", { ascending: false }).limit(100)),
    people(),
  ]);
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Avisos</h1>${isStaff() ? `<a class="btn primary sm" href="#/avisos/novo">${icon("plus")} Novo</a>` : ""}</div>
    ${rows.length ? `<div class="list">${rows.map((n) => `<button class="li" data-notice="${n.id}"><span class="cover" style="width:48px;height:48px">${safeUrl(n.image_url) ? `<img src="${attr(n.image_url)}" alt="">` : icon("megaphone")}</span>
      <span class="grow"><span class="t">${esc(n.title)}</span><span class="s">${n.teams ? esc(n.teams.name) + " · " : ""}${esc(personName(ppl, n.created_by))} · ${fDate(n.created_at)}</span></span>${n.tag ? `<span class="tag soft">${esc(n.tag)}</span>` : ""}</button>`).join("")}</div>`
      : `<div class="card">${empty("megaphone", "Nenhum aviso publicado")}</div>`}`;
  on(el, "click", "[data-notice]", (e, b) => openNotice(rows.find((n) => n.id === b.dataset.notice), ppl));
}

export async function noticeForm(el, teamId) {
  const teamsManaged = state.myTeams.filter((t) => canManageTeam(t.id));
  if (!isStaff()) { el.innerHTML = empty("lock", "Somente administradores e líderes publicam avisos."); return; }
  const allTeams = isAdmin() ? await must(sb.from("teams").select("id,name").eq("org_id", state.org.id).order("name")) : teamsManaged;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/avisos">${icon("chevronLeft")}</a><h1>Novo aviso</h1></div>
  <form class="card" id="f">
    <label class="field"><span>Para quem</span><select name="team_id">
      ${isStaff() ? `<option value="">Toda a igreja</option>` : ""}${allTeams.map((t) => `<option value="${t.id}" ${t.id === teamId ? "selected" : ""}>Time: ${esc(t.name)}</option>`).join("")}</select></label>
    <label class="field"><span>Título *</span><input name="title" required maxlength="140" placeholder="Ex.: Ensaio Geral"></label>
    <label class="field"><span>Mensagem</span><textarea name="body" maxlength="4000" placeholder="Detalhes do comunicado"></textarea></label>
    <div class="two"><label class="field"><span>Etiqueta</span><input name="tag" maxlength="24" placeholder="Ex.: Reunião"></label>
      <label class="field"><span>Link</span><input name="link_url" type="url" placeholder="https://"></label></div>
    <div class="two"><label class="field"><span>Data do evento (opcional)</span><input name="date" type="date"></label>
      <label class="field"><span>Horário</span><input name="time" type="time"></label></div>
    <div class="field"><span>Imagem (opcional)</span><button type="button" class="btn ghost" id="img">${icon("image")} Escolher imagem</button> <span class="small muted" id="imgname"></span></div>
    <button class="btn primary block" id="save">Publicar aviso</button>
  </form>`;
  let image = null;
  el.querySelector("#img").onclick = async () => { image = await pickFile("image/*"); el.querySelector("#imgname").textContent = image?.name || ""; };
  el.querySelector("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = el.querySelector("#save"); busy(btn);
    try {
      if (f.link_url && !safeUrl(f.link_url)) throw new Error("Link inválido.");
      const image_url = image ? await uploadPublic(`announcements/${state.org.id}`, image) : null;
      const { error } = await sb.from("announcements").insert({ org_id: state.org.id, team_id: f.team_id || null, title: f.title.trim(), body: f.body || null,
        tag: f.tag || null, link_url: f.link_url || null, image_url, created_by: state.user.id,
        event_at: f.date ? new Date(`${f.date}T${f.time || "00:00"}:00-03:00`).toISOString() : null });
      if (error) throw error;
      toast("Aviso publicado");
      go(f.team_id ? `/times/${f.team_id}/avisos` : "/avisos");
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  };
}

// ---------------------------------------------------------------- bloqueio de datas
async function blocksView(_, el) {
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Bloqueio de datas</h1></div>
    <p class="muted small">Toque em um dia para informar que você não poderá servir. Os líderes veem isso ao montar as escalas.</p><div class="card" id="blocks"></div>`;
  await blocksWidget(el.querySelector("#blocks"), { compact: false });
}

export async function blocksWidget(box, { compact }) {
  let month = new Date(ymd(new Date()) + "T12:00:00"); month.setDate(1);
  let filter = "me";
  const ppl = await people();
  // funções do usuário e quem compartilha alguma delas
  const roleRows = await must(sb.from("team_member_roles").select("user_id,role_id").eq("org_id", state.org.id));
  const mine = new Set(roleRows.filter((r) => r.user_id === state.user.id).map((r) => r.role_id));
  const sameRole = new Set(roleRows.filter((r) => mine.has(r.role_id)).map((r) => r.user_id));

  async function draw() {
    const first = new Date(month); const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const rows = await must(sb.from("unavailability").select("*").eq("org_id", state.org.id).lte("start_date", ymd(last)).gte("end_date", ymd(first)));
    const visible = rows.filter((r) => filter === "all" || r.user_id === state.user.id || (filter === "role" && sameRole.has(r.user_id)));
    const startDow = first.getDay();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(`<div class="d out"></div>`);
    const today = ymd(new Date());
    for (let d = 1; d <= last.getDate(); d++) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hits = visible.filter((r) => r.start_date <= key && r.end_date >= key);
      const mineHit = hits.some((r) => r.user_id === state.user.id);
      const others = hits.filter((r) => r.user_id !== state.user.id).length;
      cells.push(`<button class="d${mineHit ? " blk" : ""}${key === today ? " today" : ""}" data-day="${key}">${d}<span class="marks">${others ? `<i class="u"></i>`.repeat(Math.min(3, others)) : ""}</span></button>`);
    }
    box.innerHTML = `<div class="calhead"><button class="iconbtn" data-m="-1" aria-label="Mês anterior">${icon("chevronLeft")}</button>
      <b>${fMonthYear(month)}</b>
      <button class="iconbtn" data-m="1" aria-label="Próximo mês">${icon("chevronRight")}</button></div>
      <div class="chips mb">${[["me", "Somente eu"], ["role", "Minha função"], ["all", "Todos"]].map(([k, l]) => `<button class="chip${filter === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
      <div class="cal">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells.join("")}</div>
      <div class="row gap mt small muted"><span class="row gap-s"><span style="width:12px;height:12px;border-radius:4px;background:rgba(248,113,113,.3)"></span>Meus bloqueios</span>
        ${filter !== "me" ? `<span class="row gap-s"><span style="width:6px;height:6px;border-radius:6px;background:var(--danger)"></span>Outros indisponíveis</span>` : ""}</div>
      ${compact ? "" : `<div class="sec"><h2>Meus bloqueios</h2></div><div class="list">${rows.filter((r) => r.user_id === state.user.id).map((r) => blockLi(r, ppl)).join("") || `<div class="li muted">Nenhum bloqueio neste mês.</div>`}</div>
        ${filter !== "me" ? `<div class="sec"><h2>${filter === "role" ? "Mesma função" : "Todos"}</h2></div><div class="list">${visible.filter((r) => r.user_id !== state.user.id).map((r) => blockLi(r, ppl)).join("") || `<div class="li muted">Ninguém indisponível neste mês.</div>`}</div>` : ""}`}`;
    box._rows = rows;
  }
  function blockLi(r, ppl) {
    const range = r.start_date === r.end_date ? fmtD(r.start_date) : `${fmtD(r.start_date)} a ${fmtD(r.end_date)}`;
    return `<div class="li">${avatar(ppl.get(r.user_id), 36, false)}<span class="grow"><span class="t">${esc(personName(ppl, r.user_id))}</span><span class="s">${range}${r.all_day ? " · dia todo" : ` · ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`}${r.note ? " · " + esc(r.note) : ""}</span></span>
      ${r.user_id === state.user.id ? `<button class="iconbtn" data-delblk="${r.id}" aria-label="Remover">${icon("trash")}</button>` : ""}</div>`;
  }
  const fmtD = (s) => s.split("-").reverse().slice(0, 2).join("/");

  box.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]"); if (m) { month.setMonth(month.getMonth() + Number(m.dataset.m)); return draw(); }
    const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; return draw(); }
    const del = e.target.closest("[data-delblk]");
    if (del) { await sb.from("unavailability").delete().eq("id", del.dataset.delblk); toast("Bloqueio removido"); return draw(); }
    const d = e.target.closest("[data-day]"); if (d) dayDialog(d.dataset.day);
  });

  function dayDialog(day) {
    const existing = (box._rows || []).filter((r) => r.start_date <= day && r.end_date >= day);
    const mineHere = existing.filter((r) => r.user_id === state.user.id);
    const others = existing.filter((r) => r.user_id !== state.user.id && (filter === "all" || (filter === "role" && sameRole.has(r.user_id))));
    const s = sheet(`<h3>${fmtD(day)}</h3>
      ${mineHere.length ? `<div class="list mb">${mineHere.map((r) => blockLi(r, ppl)).join("")}</div>` : ""}
      ${others.length ? `<p class="small muted">Indisponíveis: ${others.map((r) => esc(personName(ppl, r.user_id))).join(", ")}</p>` : ""}
      <form id="bf"><div class="two"><label class="field"><span>De</span><input type="date" name="start" value="${day}" required></label>
        <label class="field"><span>Até</span><input type="date" name="end" value="${day}" required></label></div>
        <label class="check"><input type="checkbox" name="allday" checked> Dia inteiro</label>
        <div class="two hidden" id="hrs"><label class="field"><span>Das</span><input type="time" name="st" value="18:00"></label><label class="field"><span>Até</span><input type="time" name="et" value="22:00"></label></div>
        <label class="field"><span>Motivo (opcional)</span><input name="note" maxlength="120" placeholder="Ex.: viagem"></label>
        <button class="btn primary block">Bloquear</button></form>`);
    const form = s.el.querySelector("#bf");
    form.allday.onchange = () => s.el.querySelector("#hrs").classList.toggle("hidden", form.allday.checked);
    s.el.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-delblk]");
      if (del) { await sb.from("unavailability").delete().eq("id", del.dataset.delblk); s.close(); toast("Bloqueio removido"); draw(); }
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const all = form.allday.checked;
      if (form.end.value < form.start.value) return toast("A data final precisa ser depois da inicial.", "err");
      const { error } = await sb.from("unavailability").insert({ org_id: state.org.id, user_id: state.user.id, start_date: form.start.value, end_date: form.end.value,
        all_day: all, start_time: all ? null : form.st.value, end_time: all ? null : form.et.value, note: form.note.value || null });
      if (error) return toast(errMsg(error), "err");
      s.close(); toast("Data bloqueada"); draw();
    };
  }
  await draw();
}
