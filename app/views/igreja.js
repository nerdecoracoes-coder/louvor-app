// Página da igreja: avisos gerais, agenda da igreja, liderança, ministérios e aniversariantes.
// Nada aqui vem das escalas dos times; cada time tem o seu próprio início.
import { sb, state, must, esc, attr, icon, avatar, fDateLong, fDay, fMon, fTime, fDate, people, personName, myName, isStaff, isAdmin, sheet, toast, errMsg, busy, on, go, empty, spinner,
  confirmDialog, fromLocal, ymd, teamBadge, teamTypeLabel, invalidatePeople } from "../core.js";
import { noticeCard, openNotice, birthdaySection } from "./home.js";

export function register(route) {
  route("/igreja", (p, el, a) => churchHome(el, a));
  route("/agenda", (p, el, a) => agenda(el, a));
}

const upcoming = (days) => {
  const from = new Date(Date.now() - 3 * 3600e3).toISOString(), to = new Date(Date.now() + days * 86400e3).toISOString();
  // se a atualização do banco ainda não foi aplicada, a agenda fica vazia em vez de quebrar a página
  return sb.from("church_events").select("*").eq("org_id", state.org.id).gte("starts_at", from).lte("starts_at", to).order("starts_at").limit(60).then((r) => (r.error ? [] : r.data || []));
};
const titles = () => sb.from("org_members").select("user_id,church_title").eq("org_id", state.org.id).then((r) => new Map((r.error ? [] : r.data || []).map((m) => [m.user_id, m.church_title])));

const eventRow = (e) => `<button class="li evt" data-ev="${e.id}"><span class="evdate"><b>${fDay(e.starts_at)}</b><small>${esc(fMon(e.starts_at))}</small></span>
  <span class="grow" style="min-width:0"><span class="t ellipsis">${esc(e.title)}</span><span class="s">${esc(fDateLong(e.starts_at).split(",")[0])} · ${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ""}</span></span>${icon("chevronRight")}</button>`;

function openEvent(e, ppl, again) {
  const s = sheet(`<h3>${esc(e.title)}</h3>
    <p class="row gap-s muted">${icon("calendar")}${esc(fDateLong(e.starts_at))} às ${fTime(e.starts_at)}${e.ends_at ? ` até ${fTime(e.ends_at)}` : ""}</p>
    ${e.location ? `<p class="row gap-s muted">${icon("pin")}${esc(e.location)}</p>` : ""}
    ${e.description ? `<p>${esc(e.description)}</p>` : ""}
    ${isStaff() ? `<button class="btn danger sm mt" data-del>${icon("trash")} Excluir evento</button>` : ""}`);
  s.el.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este evento da agenda?", "Excluir", true))) return;
    const r = await sb.from("church_events").delete().eq("id", e.id);
    if (r.error) return toast(errMsg(r.error), "err");
    s.close(); toast("Evento excluído"); again();
  });
}

function eventForm(again) {
  const s = sheet(`<h3>Novo evento da igreja</h3><form id="ef">
    <label class="field"><span>Título *</span><input name="title" required maxlength="120" placeholder="Ex.: Culto de celebração"></label>
    <div class="dt3"><fieldset class="of"><legend>Data *</legend><input type="date" name="date" required value="${ymd(new Date())}"></fieldset>
      <fieldset class="of"><legend>Início *</legend><input type="time" name="start" required value="19:00"></fieldset>
      <fieldset class="of"><legend>Fim</legend><input type="time" name="end"></fieldset></div>
    <label class="field"><span>Local</span><input name="location" maxlength="160" placeholder="Ex.: Templo principal"></label>
    <label class="field"><span>Detalhes</span><textarea name="description" maxlength="1000"></textarea></label>
    <button class="btn primary block" id="esave">Salvar evento</button></form>`);
  s.el.querySelector("#ef").onsubmit = async (ev) => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const b = s.el.querySelector("#esave"); busy(b);
    try {
      await must(sb.from("church_events").insert({ org_id: state.org.id, title: f.title.trim(), description: f.description.trim() || null, location: f.location.trim() || null,
        starts_at: fromLocal(f.date, f.start), ends_at: f.end ? fromLocal(f.date, f.end) : null, created_by: state.user.id }));
      s.close(); toast("Evento na agenda"); again();
    } catch (err) { toast(errMsg(err), "err"); busy(b, false); }
  };
}

async function agenda(el, alive) {
  el.innerHTML = spinner();
  const [evs, ppl] = await Promise.all([upcoming(180), people()]);
  if (!alive()) return;
  el.innerHTML = `<div class="pagehead"><h1>Agenda da igreja</h1>${isStaff() ? `<button class="btn primary sm" id="newev">${icon("plus")} Novo evento</button>` : ""}</div>
    <p class="muted small">Cultos, reuniões e eventos de toda a igreja nos próximos meses.</p>
    ${evs.length ? `<div class="list mt">${evs.map(eventRow).join("")}</div>` : `<div class="card">${empty("calendar", "Nada na agenda ainda", isStaff() ? "Toque em Novo evento para marcar o primeiro." : "Os eventos da igreja aparecem aqui.")}</div>`}`;
  const again = () => agenda(el, alive);
  el.querySelector("#newev")?.addEventListener("click", () => eventForm(again));
  on(el, "click", "[data-ev]", (e, b) => openEvent(evs.find((x) => x.id === b.dataset.ev), ppl, again));
}

export async function churchHome(el, alive) {
  el.innerHTML = spinner();
  const [notices, evs, ppl, teams, ttl] = await Promise.all([
    must(sb.from("announcements").select("*").eq("org_id", state.org.id).is("team_id", null).order("created_at", { ascending: false }).limit(5)),
    upcoming(60), people(),
    must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name")),
    titles(),
  ]);
  if (!alive()) return;
  const o = state.org;
  for (const [id, t] of ttl) if (ppl.get(id)) ppl.get(id).church_title = t;
  const leaders = [...ppl.values()].filter((p) => p.church_title).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const mine = new Set(state.myTeams.map((t) => t.id));
  el.innerHTML = `
  <section class="hero"><div class="grow"><p class="hello">Igreja</p><h1>${esc(o.name)}</h1>${o.subtitle ? `<p class="roles">${esc(o.subtitle)}</p>` : ""}</div></section>

  <div class="sec"><h2>Avisos da igreja</h2><a href="#/avisos">Todos ${icon("chevronRight")}</a></div>
  ${notices.length ? `<div class="carousel" id="notices">${notices.map(noticeCard).join("")}</div>`
    : empty("megaphone", "Nenhum aviso publicado", isStaff() ? `<a class="link" href="#/avisos/novo">Publicar o primeiro aviso</a>` : "Os comunicados da igreja aparecem aqui.")}

  <div class="sec"><h2>Agenda da igreja</h2><a href="#/agenda">Ver tudo ${icon("chevronRight")}</a></div>
  ${evs.length ? `<div class="list">${evs.slice(0, 4).map(eventRow).join("")}</div>` : `<div class="card">${empty("calendar", "Nada na agenda", isStaff() ? `<button class="link" id="newev">Marcar o primeiro evento</button>` : "Os eventos da igreja aparecem aqui.")}</div>`}

  <div class="sec"><h2>Liderança</h2>${isAdmin() ? `<button class="more" id="edlead">${icon("edit")} Cargos</button>` : ""}</div>
  ${leaders.length ? `<div class="list">${leaders.map((p) => `<div class="li">${avatar(p, 40, false)}<span class="grow"><span class="t">${esc(p.display_name)}</span><span class="s">${esc(p.church_title)}</span></span></div>`).join("")}</div>`
    : `<div class="card">${empty("crown", "Pastores e líderes", isAdmin() ? "Toque em Cargos para informar quem são os pastores e líderes da igreja." : "Em breve aparecem aqui.")}</div>`}

  <div class="sec"><h2>Ministérios e times</h2><a href="#/times">Todos ${icon("chevronRight")}</a></div>
  <div class="list">${teams.map((t) => `<button class="li" data-team="${t.id}">${teamBadge(t, 40)}<span class="grow"><span class="t">${esc(t.name)}</span><span class="s">${esc(teamTypeLabel(t))}${mine.has(t.id) ? " · Você participa" : ""}</span></span>${icon("chevronRight")}</button>`).join("") || `<div class="li muted small">Nenhum time criado ainda.</div>`}</div>

  ${birthdaySection([...ppl.values()])}
  ${isStaff() ? `<div class="sec"><h2>Ações da igreja</h2></div><div class="chips" style="flex-wrap:wrap">
    <button class="chip" id="newev2">${icon("calendar")} Novo evento</button><a class="chip" href="#/avisos/novo">${icon("megaphone")} Novo aviso</a>
    ${isAdmin() ? `<a class="chip" href="#/times/novo">${icon("users")} Novo time</a><a class="chip" href="#/convidar-membro">${icon("org")} Convidar membro da igreja</a>` : ""}</div>` : ""}`;
  const again = () => churchHome(el, alive);
  el.querySelector("#newev")?.addEventListener("click", () => eventForm(again));
  el.querySelector("#newev2")?.addEventListener("click", () => eventForm(again));
  on(el, "click", "[data-ev]", (e, b) => openEvent(evs.find((x) => x.id === b.dataset.ev), ppl, again));
  on(el, "click", "[data-notice]", (e, b) => openNotice(notices.find((n) => n.id === b.dataset.notice), ppl));
  on(el, "click", "[data-team]", (e, b) => go(`/times/${b.dataset.team}`));
  el.querySelector("#edlead")?.addEventListener("click", () => leadersSheet(ppl, again));
}

function leadersSheet(ppl, again) {
  const all = [...ppl.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const s = sheet(`<h3>Cargos da liderança</h3><p class="small muted">Escreva o cargo de quem lidera a igreja (ex.: Pastor presidente, Pastora, Diácono chefe). Deixe em branco para tirar da lista.</p>
    <div class="list">${all.map((p) => `<div class="li">${avatar(p, 36, false)}<span class="grow" style="min-width:0"><span class="t ellipsis">${esc(p.display_name)}</span>
      <input class="input" data-title="${p.id}" maxlength="60" placeholder="Sem cargo" value="${attr(p.church_title || "")}" style="margin-top:6px"></span></div>`).join("")}</div>
    <button class="btn primary block mt" id="lsave">Salvar cargos</button>`);
  s.el.querySelector("#lsave").onclick = async (ev) => {
    busy(ev.currentTarget);
    try {
      for (const i of s.el.querySelectorAll("[data-title]")) {
        const v = i.value.trim() || null, p = ppl.get(i.dataset.title);
        if ((p.church_title || null) !== v) await must(sb.from("org_members").update({ church_title: v }).eq("org_id", state.org.id).eq("user_id", i.dataset.title));
      }
      invalidatePeople(); s.close(); toast("Cargos salvos"); again();
    } catch (err) { toast(errMsg(err), "err"); busy(ev.currentTarget, false); }
  };
}
