// Início: perfil, atalhos, avisos, próximas escalas, aniversariantes e bloqueio de datas.
import { sb, state, must, esc, attr, icon, avatar, fDow, fDay, fMon, fTime, fDate, fDateLong, ymd, people, personName, myName, isStaff, isAdmin, canEditAgenda,
  canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner, linkify, safeUrl, roleIcon, uploadPublic, pickFile, TZ, confirmDialog, fMonthYear, cap, hasRepertoire, invalidatePeople,
  teamBadge, teamHasRepertoire, teamTypeLabel, teamHas } from "../core.js";
import { openRequestsCard } from "./multimidia.js";
import { churchHome, pendingScalesCard } from "./igreja.js";
import { teamExtras } from "./eventos.js";
import { maybeService } from "./servico.js";

export function register(route) {
  const start = async (p, el, a) => { if (await maybeService()) return; return state.space ? teamHome(state.space, el, a) : churchHome(el, a); };
  route("/", start);
  route("/inicio", start);
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

export function schedRow(s, { showTeam = true, feature = false } = {}) {
  const roles = s.roles || [];
  const where = [s.location, showTeam && s.teams ? s.teams.name : null].filter(Boolean).join(" · ");
  const status = s.status === "draft" ? `<span class="tag gray">Rascunho</span>` : s.ask_confirmation === false ? "" : s.seen_at === null ? `<span class="tag soft">Nova</span>` : s.seen_at ? `<span class="seen">${icon("check")} Visto</span>` : "";
  return `<a class="sched${feature ? " feature" : ""}${s.status === "draft" ? " draft" : ""}" href="#/escala/${s.id}">
    <div class="date"><span>${fDow(s.starts_at)}</span><b>${fDay(s.starts_at)}</b><span>${fMon(s.starts_at)}</span></div>
    <div class="info"><h3>${esc(s.title)}</h3><div class="meta">${fTime(s.starts_at)}${where ? ` · ${esc(where)}` : ""}</div>
      ${roles.length || status ? `<div class="side">${roles.map((r) => `<span class="pill">${esc(r)}</span>`).join("")}${status}</div>` : ""}</div>
    ${icon("chevronRight", "chev")}</a>`;
}

// Cartão de escala para o carrossel do Início (arraste para o lado: em ordem de data)
const relDay = (iso) => {
  const d = ymd(iso), today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
  return d === today ? "Hoje" : d === tomorrow ? "Amanhã" : cap(fDow(iso)).replace(/\.$/, "");
};
// Junta a cada escala: quem está escalado (fotos), confirmações e quantidade de músicas
export async function enrichSchedules(list) {
  const ids = [...new Set(list.map((s) => s.id))];
  if (!ids.length) return list;
  const [as, ss] = await Promise.all([
    must(sb.from("schedule_assignments").select("schedule_id,user_id,seen_at").in("schedule_id", ids)),
    must(sb.from("schedule_songs").select("schedule_id").in("schedule_id", ids)),
  ]);
  for (const s of list) {
    const mine = as.filter((a) => a.schedule_id === s.id);
    s.people = [...new Set(mine.map((a) => a.user_id))];
    s.seenCount = new Set(mine.filter((a) => a.seen_at).map((a) => a.user_id)).size;
    s.songCount = ss.filter((x) => x.schedule_id === s.id).length;
  }
  return list;
}
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export function schedCard(s, { showTeam = true, ppl } = {}) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date(s.starts_at)));
  const day = Number(fDay(s.starts_at)), month = MONTHS[Number(ymd(s.starts_at).slice(5, 7)) - 1];
  const dow = cap(fDow(s.starts_at)).replace(/\.$/, "");
  const ids = s.people || [], total = ids.length;
  const asks = s.ask_confirmation !== false && total > 0;
  const status = !asks ? "" : s.seenCount >= total ? `<span class="tag ok">${icon("check")} Confirmada</span>` : `<span class="tag warn">${icon("clock")} Pendente</span>`;
  const faces = ids.slice(0, 5).map((id) => `<span class="ov">${avatar(ppl?.get(id) || { id, display_name: "?" }, 30, false)}</span>`).join("");
  const rel = relDay(s.starts_at);
  const today = rel === "Hoje" || rel === "Amanhã";
  return `<a class="scard" href="#/escala/${s.id}">
    <div class="sc-top"><span class="sc-when">${icon(hour >= 18 || hour < 5 ? "moon" : "sun")} ${esc(dow)}, ${fTime(s.starts_at)}</span><span class="sc-date">${day} ${month}</span></div>
    <h3>${esc(s.title)}</h3>
    <div class="sc-sub">${today ? `<span class="tag soft">${esc(rel.toLowerCase())}</span>` : ""}${showTeam && s.teams ? `<span class="muted small ellipsis">${esc(s.teams.name)}</span>` : ""}</div>
    <div class="sc-faces">${faces}${total > 5 ? `<span class="more">+${total - 5}</span>` : ""}${total ? "" : `<span class="muted small">Ninguém escalado</span>`}</div>
    <div class="sc-foot">${status || `<span></span>`}<span class="sc-counts">${total ? `<span>${icon("users")}${total}</span>` : ""}<span>${icon("music")}${s.songCount || 0}</span></span></div></a>`;
}

// Aniversariantes do mês (todos os dias do mês corrente, em ordem)
export function monthBirthdays(list) {
  const m = Number(ymd(new Date()).slice(5, 7));
  return list.filter((p) => p.birth_date && Number(p.birth_date.slice(5, 7)) === m)
    .map((p) => ({ p, day: Number(p.birth_date.slice(8, 10)) })).sort((a, b) => a.day - b.day || a.p.display_name.localeCompare(b.p.display_name));
}
export function birthdaySection(list, who) {
  const items = monthBirthdays(list), today = Number(ymd(new Date()).slice(8, 10));
  if (!items.length) return "";
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  return `<div class="sec"><h2>Aniversariantes de ${esc(month)}</h2></div>
  <div class="bdays bdaymonth">${items.map(({ p, day }) => `<div class="bday">${avatar(p, 56, day === today)}
    <b>${esc(p.display_name.split(" ")[0])}</b><span class="when">${day === today ? "Hoje" : `${String(day).padStart(2, "0")}/${ymd(new Date()).slice(5, 7)}`}</span></div>`).join("")}</div>`;
}

// Parabéns do dia: na primeira abertura do dia, uma janela avisa quem faz aniversário hoje
export async function birthdayPopup() {
  if (!state.user || !state.org) return;
  const key = `somos.bday:${state.user.id}:${ymd(new Date())}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* sem armazenamento: mostra */ }
  const md = ymd(new Date()).slice(5);
  const list = [...(await people()).values()].filter((p) => p.birth_date && p.birth_date.slice(5) === md);
  if (!list.length) return;
  const me = list.find((p) => p.id === state.user.id), others = list.filter((p) => p.id !== state.user.id);
  const first = (p) => p.display_name.split(" ")[0];
  const title = me && !others.length ? `Feliz aniversário, ${esc(first(me))}!` : list.length === 1 ? `Hoje é aniversário de ${esc(first(list[0]))}!` : "Hoje tem aniversariantes!";
  const text = me && !others.length ? "Que Deus abençoe o seu novo ano de vida. A equipe toda deseja um dia especial para você." : "Aproveite para mandar uma mensagem de parabéns.";
  const chatTeam = state.space?.id || state.myTeams[0]?.id;
  const s = sheet(`<div class="bdaypop"><div class="faces">${list.slice(0, 4).map((p) => avatar(p, list.length === 1 ? 96 : 68, true)).join("")}</div>
    <h3>${title}</h3><p class="muted">${text}</p>
    ${list.length > 1 || (!me && list.length) ? `<p class="names">${list.map((p) => esc(p.display_name)).join(", ")}</p>` : ""}
    ${chatTeam && others.length ? `<button class="btn primary block" id="bchat">${icon("chat")} Dar os parabéns no chat</button>` : ""}
    <button class="btn ghost block mt-s" data-close>Fechar</button></div>`);
  s.el.querySelector("#bchat")?.addEventListener("click", () => { s.close(); go(`/chat/${chatTeam}`); });
}

async function homeView(_, el, alive) {
  el.innerHTML = spinner();
  const [roles, notices, ups, ppl] = await Promise.all([
    myRoles(),
    must(sb.from("announcements").select("*").eq("org_id", state.org.id).is("team_id", null).order("created_at", { ascending: false }).limit(5)),
    upcomingAssignments(),
    people(),
  ]);
  if (!alive()) return;
  await enrichSchedules(ups).catch((e) => console.warn(e));
  if (!alive()) return;
  const name = myName().split(" ")[0] || "você";

  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const noPhoto = !state.profile?.avatar_url;
  const teamsLine = state.myTeams.map((t) => t.name).join(", ");
  el.innerHTML = `
  <section class="hero">
    <div class="grow"><p class="hello">${hello},</p><h1>${esc(name)}</h1>
      <p class="roles">${[roles.length > 3 ? `${roles.slice(0, 3).join(", ")} +${roles.length - 3}` : roles.join(", "), teamsLine].filter(Boolean).map(esc).join(" — ") || esc(state.org.name)}</p></div>
    <button class="hero-av" id="heroav" aria-label="${noPhoto ? "Adicionar foto" : "Meu perfil"}">${avatar({ ...state.profile, display_name: myName() }, 56)}${noPhoto ? `<span class="cam">${icon("camera")}</span>` : ""}</button>
  </section>
  ${noPhoto ? `<button class="photo-hint" id="addphoto">${icon("camera")}<span><b>Adicione sua foto</b><small>Ajuda a equipe a reconhecer você nas escalas e no chat.</small></span></button>` : ""}

  <div id="pend"></div>
  <div class="sec"><h2>Minhas próximas escalas</h2><a href="#/calendario/meu">Agenda ${icon("chevronRight")}</a></div>
  <div id="ups">${ups.length ? `<div class="scards">${ups.map((s) => schedCard(s, { ppl })).join("")}</div>` : empty("calendar", "Nenhuma escala por enquanto", "Quando um líder publicar uma escala com você, ela aparece aqui.")}</div>

  <div class="sec"><h2>Avisos</h2><a href="#/avisos">Todos ${icon("chevronRight")}</a></div>
  ${notices.length ? `<div class="carousel" id="notices">${notices.map(noticeCard).join("")}</div>
    ${notices.length > 1 ? `<div class="dots" id="ndots">${notices.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}`
    : empty("megaphone", "Nenhum aviso publicado", canPostNotice() ? `<a class="link" href="#/avisos/novo">Publicar o primeiro aviso</a>` : "Os comunicados da igreja aparecem aqui.")}

  ${birthdaySection([...ppl.values()])}
  ${canPostNotice() ? `<div class="sec"><h2>Ações da igreja</h2></div><div class="chips" style="flex-wrap:wrap">
    ${isStaff() ? `<a class="chip" href="#/escala/nova">${icon("calendar")} Nova escala</a>` : ""}<a class="chip" href="#/avisos/novo">${icon("megaphone")} Novo aviso</a>
    ${state.myTeams.some((x) => canManageTeam(x.id)) || isAdmin() ? `<a class="chip" href="#/convidar">${icon("link")} Convidar para um time</a>` : ""}
    ${isAdmin() ? `<a class="chip" href="#/times/novo">${icon("users")} Novo time</a><a class="chip" href="#/convidar-membro">${icon("org")} Convidar membro da igreja</a>` : ""}</div>` : ""}`;
  const pickPhoto = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    try {
      const url = await uploadPublic(`avatars/${state.user.id}`, f);
      await must(sb.from("profiles").update({ avatar_url: url }).eq("id", state.user.id));
      state.profile.avatar_url = url; invalidatePeople(); document.dispatchEvent(new Event("profile-changed"));
      toast("Foto adicionada"); homeView(_, el, alive);
    } catch (e) { toast(errMsg(e), "err"); }
  };
  el.querySelector("#addphoto")?.addEventListener("click", pickPhoto);
  el.querySelector("#heroav").onclick = () => (noPhoto ? pickPhoto() : go("/perfil"));
  pendingScalesCard().then((h) => { const b = el.querySelector("#pend"); if (b) b.innerHTML = h; }).catch(() => {});
  const car = el.querySelector("#notices");
  if (car) car.addEventListener("scroll", () => {
    const i = Math.round(car.scrollLeft / car.clientWidth);
    el.querySelectorAll("#ndots i").forEach((d, k) => d.classList.toggle("on", k === i));
  }, { passive: true });
  on(el, "click", "[data-notice]", (e, b) => openNotice(notices.find((n) => n.id === b.dataset.notice), ppl));
}

// ---------------------------------------------------------------- início do time
async function teamHome(team, el, alive) {
  el.innerHTML = spinner();
  const now = new Date(Date.now() - 3 * 3600e3).toISOString();
  const [roles, mine, next, notices, members, ppl] = await Promise.all([
    must(sb.from("team_member_roles").select("music_roles(name,sort)").eq("user_id", state.user.id).eq("team_id", team.id)),
    upcomingAssignments(20),
    must(sb.from("schedules").select("*").eq("team_id", team.id).eq("status", "published").gte("starts_at", now).order("starts_at").limit(4)),
    must(sb.from("announcements").select("*").eq("team_id", team.id).order("created_at", { ascending: false }).limit(5)),
    must(sb.from("team_members").select("user_id").eq("team_id", team.id)),
    people(),
  ]);
  if (!alive()) return;
  const myUps = mine.filter((s) => s.team_id === team.id).slice(0, 12);
  const mineIds = new Set(myUps.map((s) => s.id));
  const others = next.filter((s) => !mineIds.has(s.id)).slice(0, 3);
  await enrichSchedules([...myUps, ...others]).catch((e) => console.warn(e));
  if (!alive()) return;
  const roleNames = roles.map((r) => r.music_roles).filter(Boolean).sort((a, b) => a.sort - b.sort).map((r) => r.name);
  const memberIds = new Set(members.map((m) => m.user_id));
  const name = myName().split(" ")[0] || "você";
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const noPhoto = !state.profile?.avatar_url;
  const manage = canManageTeam(team.id);
  el.innerHTML = `
  <section class="hero">
    <div class="grow"><p class="hello">${hello},</p><h1>${esc(name)}</h1>
      <p class="roles">${esc([roleNames.length > 3 ? `${roleNames.slice(0, 3).join(", ")} +${roleNames.length - 3}` : roleNames.join(", "), team.is_leader ? "Líder" : ""].filter(Boolean).join(" · ") || teamTypeLabel(team))}</p></div>
    <button class="hero-av" id="heroav" aria-label="${noPhoto ? "Adicionar foto" : "Meu perfil"}">${avatar({ ...state.profile, display_name: myName() }, 56)}${noPhoto ? `<span class="cam">${icon("camera")}</span>` : ""}</button>
  </section>
  ${noPhoto ? `<button class="photo-hint" id="addphoto">${icon("camera")}<span><b>Adicione sua foto</b><small>Ajuda a equipe a reconhecer você nas escalas e no chat.</small></span></button>` : ""}

  <div id="pend"></div>
  <div class="sec"><h2>Minhas próximas escalas</h2><a href="#/times/${team.id}/escalas">Ver todas ${icon("chevronRight")}</a></div>
  <div id="ups">${myUps.length ? `<div class="scards">${myUps.map((s) => schedCard(s, { showTeam: false, ppl })).join("")}</div>` : empty("calendar", "Você não está em nenhuma escala por enquanto", manage ? `<a class="link" href="#/escala/nova/${team.id}">Criar uma escala</a>` : "Quando o líder publicar uma escala com você, ela aparece aqui.")}</div>
  ${manage ? `<div class="chips" style="flex-wrap:wrap;margin-top:10px"><a class="chip" href="#/times/${team.id}/servico">${icon("heart")} Hora de servir</a></div>` : ""}
  ${others.length ? `<div class="sec"><h2>Próximas do time</h2></div><div class="scards">${others.map((s) => schedCard(s, { showTeam: false, ppl })).join("")}</div>` : ""}

  <div id="extras"></div>
  <div id="reqs"></div>
  <div class="sec"><h2>Avisos do time</h2>${manage ? `<a href="#/times/${team.id}/aviso">Novo ${icon("plus")}</a>` : `<a href="#/times/${team.id}/avisos">Todos ${icon("chevronRight")}</a>`}</div>
  ${notices.length ? `<div class="carousel" id="notices">${notices.map(noticeCard).join("")}</div>
    ${notices.length > 1 ? `<div class="dots" id="ndots">${notices.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}`
    : `<div class="card small muted">Nenhum aviso do time. Os comunicados gerais ficam na <a class="link" href="#/igreja" data-church>área da igreja</a>.</div>`}

  ${birthdaySection([...ppl.values()].filter((p) => memberIds.has(p.id)))}`;
  const pickPhoto = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    try {
      const url = await uploadPublic(`avatars/${state.user.id}`, f);
      await must(sb.from("profiles").update({ avatar_url: url }).eq("id", state.user.id));
      state.profile.avatar_url = url; invalidatePeople(); document.dispatchEvent(new Event("profile-changed"));
      toast("Foto adicionada"); teamHome(team, el, alive);
    } catch (e) { toast(errMsg(e), "err"); }
  };
  el.querySelector("#addphoto")?.addEventListener("click", pickPhoto);
  el.querySelector("#heroav").onclick = () => (noPhoto ? pickPhoto() : go("/perfil"));
  const car = el.querySelector("#notices");
  if (car) car.addEventListener("scroll", () => {
    const i = Math.round(car.scrollLeft / car.clientWidth);
    el.querySelectorAll("#ndots i").forEach((d, k) => d.classList.toggle("on", k === i));
  }, { passive: true });
  on(el, "click", "[data-notice]", (e, b) => openNotice(notices.find((n) => n.id === b.dataset.notice), ppl));
  pendingScalesCard(team.id).then((h) => { const b = el.querySelector("#pend"); if (b) b.innerHTML = h; }).catch(() => {});
  teamExtras(team).then((h) => { const b = el.querySelector("#extras"); if (b) b.innerHTML = h; }).catch(() => {});
  if (teamHas(team, "pedidos")) openRequestsCard(team).then((h) => { const b = el.querySelector("#reqs"); if (b) b.innerHTML = h; }).catch(() => {});
}

export function noticeCard(n) {
  const img = safeUrl(n.image_url);
  return `<button class="notice" data-notice="${n.id}">
    <div class="art" ${img ? `style="background-image:url('${attr(img)}')"` : ""}>${img ? "" : icon("megaphone")}</div>
    <div style="padding:14px 0;min-width:0">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ""}<h3 class="ellipsis">${esc(n.title)}</h3>
      <div class="meta">${n.event_at ? `${icon("calendar")}${esc(fDateLong(n.event_at).replace(/-feira/, ""))} • ${fTime(n.event_at)}` : esc(fDate(n.created_at))}</div></div>
    <span class="go">${icon("chevronRight")}</span></button>`;
}

export function openNotice(n, ppl) {
  if (!n) return;
  const link = safeUrl(n.link_url);
  const img = safeUrl(n.image_url);
  const canDel = n.created_by === state.user.id || isAdmin() || (n.team_id && canManageTeam(n.team_id)) || (!n.team_id && canEditAgenda());
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
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Avisos</h1>${canPostNotice() ? `<a class="btn primary sm" href="#/avisos/novo">${icon("plus")} Novo</a>` : ""}</div>
    ${rows.length ? `<div class="list">${rows.map((n) => `<button class="li" data-notice="${n.id}"><span class="cover" style="width:48px;height:48px">${safeUrl(n.image_url) ? `<img src="${attr(n.image_url)}" alt="">` : icon("megaphone")}</span>
      <span class="grow"><span class="t">${esc(n.title)}</span><span class="s">${n.teams ? esc(n.teams.name) + " · " : ""}${esc(personName(ppl, n.created_by))} · ${fDate(n.created_at)}</span></span>${n.tag ? `<span class="tag soft">${esc(n.tag)}</span>` : ""}</button>`).join("")}</div>`
      : `<div class="card">${empty("megaphone", "Nenhum aviso publicado")}</div>`}`;
  on(el, "click", "[data-notice]", (e, b) => openNotice(rows.find((n) => n.id === b.dataset.notice), ppl));
}

const canPostNotice = () => isStaff() || canEditAgenda();

export async function noticeForm(el, teamId) {
  const teamsManaged = state.myTeams.filter((t) => canManageTeam(t.id));
  if (!canPostNotice()) { el.innerHTML = empty("lock", "Somente administradores, coordenadores de agenda e líderes publicam avisos."); return; }
  const allTeams = isAdmin() ? await must(sb.from("teams").select("id,name").eq("org_id", state.org.id).order("name")) : teamsManaged;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/avisos">${icon("chevronLeft")}</a><h1>Novo aviso</h1></div>
  <form class="card" id="f">
    <label class="field"><span>Para quem</span><select name="team_id">
      ${canEditAgenda() ? `<option value="">Toda a igreja</option>` : ""}${allTeams.map((t) => `<option value="${t.id}" ${t.id === teamId ? "selected" : ""}>Time: ${esc(t.name)}</option>`).join("")}</select></label>
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
