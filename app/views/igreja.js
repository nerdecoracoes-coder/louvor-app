// Página da igreja: avisos gerais, agenda da igreja, liderança, ministérios e aniversariantes.
// Nada aqui vem das escalas dos times; cada time tem o seu próprio início.
import { quickRow, hasRepertoire, sb, state, must, esc, attr, icon, avatar, fDateLong, fMonthYear, cap, fDay, fMon, fTime, fDate, people, personName, myName, isStaff, isAdmin, canEditAgenda, canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner,
  confirmDialog, fromLocal, ymd, teamBadge, teamTypeLabel, invalidatePeople } from "../core.js";
import { noticeCard, openNotice, birthdaySection } from "./home.js";
import { menuShow } from "../core.js";
import { hasTutorials } from "./ajuda.js";
import { discoverSection, wireImages } from "../lib/cards.js";
import { churchShortcuts } from "../lib/shortcuts.js";

export function register(route) {
  route("/igreja", (p, el, a) => churchHome(el, a));
  route("/agenda", (p, el, a) => agenda(el, a));
}

const upcoming = (days) => {
  const from = new Date(Date.now() - 3 * 3600e3).toISOString(), to = new Date(Date.now() + days * 86400e3).toISOString();
  // se a atualização do banco ainda não foi aplicada, a agenda fica vazia em vez de quebrar a página
  return sb.from("church_events").select("*").eq("org_id", state.org.id).gte("starts_at", from).lte("starts_at", to).order("starts_at").limit(60).then((r) => (r.error ? [] : r.data || []));
};
const titles = async () => {
  let r = await sb.from("org_members").select("user_id,church_title,church_rank").eq("org_id", state.org.id);
  if (r.error) r = await sb.from("org_members").select("user_id,church_title").eq("org_id", state.org.id);   // atualização da ordem ainda não aplicada
  return new Map((r.error ? [] : r.data || []).map((m) => [m.user_id, { title: m.church_title, rank: m.church_rank ?? null }]));
};

const eventRow = (e) => `<button class="li evt" data-ev="${e.id}"><span class="evdate"><b>${fDay(e.starts_at)}</b><small>${esc(fMon(e.starts_at))}</small></span>
  <span class="grow" style="min-width:0"><span class="t ellipsis">${esc(e.title)}</span><span class="s">${e.kind ? `${esc(kindLabel(e.kind))} · ` : ""}${esc(fDateLong(e.starts_at).split(",")[0])} · ${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ""}</span></span>${icon("chevronRight")}</button>`;

export const EVENT_KINDS = { culto: "Culto", reuniao: "Reunião", cafe: "Café / confraternização", ensaio: "Ensaio", conferencia: "Conferência", outro: "Outro" };
const kindLabel = (k) => EVENT_KINDS[k] || "";

// ministérios de serviço (a tabela é nova: sem a atualização do banco a lista vem vazia)
const eventTeams = (eventId) => sb.from("church_event_teams").select("team_id,teams(name)").eq("event_id", eventId).then((r) => (r.error ? [] : r.data || []));

async function openEvent(e, ppl, again) {
  if (!e) return;
  const [serv, pend] = await Promise.all([eventTeams(e.id), sb.rpc("my_pending_scales").then((r) => (r.error ? [] : r.data || []))]);
  const todo = pend.filter((p) => p.event_id === e.id);
  const s = sheet(`<h3>${esc(e.title)}</h3>
    ${e.kind ? `<p><span class="tag soft">${esc(kindLabel(e.kind))}</span></p>` : ""}
    <p class="row gap-s muted">${icon("calendar")}${esc(fDateLong(e.starts_at))} às ${fTime(e.starts_at)}${e.ends_at ? ` até ${fTime(e.ends_at)}` : ""}</p>
    ${e.location ? `<p class="row gap-s muted">${icon("pin")}${esc(e.location)}</p>` : ""}
    ${e.description ? `<p>${esc(e.description)}</p>` : ""}
    ${serv.length ? `<p class="small muted mt">Ministérios de serviço</p><div class="chips" style="flex-wrap:wrap">${serv.map((x) => `<span class="chip">${esc(x.teams?.name || "")}</span>`).join("")}</div>` : ""}
    ${todo.map((p) => `<a class="btn primary block mt" href="#/escala/nova/${p.team_id}?evento=${e.id}" data-close>${icon("plus")} Criar a escala de ${esc(p.team_name)}</a>`).join("")}
    ${canEditAgenda() ? `<div class="row gap mt"><button class="btn ghost sm" data-edit>${icon("edit")} Editar</button><button class="btn danger sm" data-del>${icon("trash")} Excluir</button></div>` : ""}`);
  s.el.querySelector("[data-edit]")?.addEventListener("click", () => { s.close(); eventForm(again, e, serv.map((x) => x.team_id)); });
  s.el.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este evento da agenda?", "Excluir", true))) return;
    const r = await sb.from("church_events").delete().eq("id", e.id);
    if (r.error) return toast(errMsg(r.error), "err");
    s.close(); toast("Evento excluído"); again();
  });
}

// Novo evento / editar. O coordenador (ou o administrador) escolhe o tipo e os ministérios que ficam de serviço.
async function eventForm(again, ev = null, picked = [], day = null) {
  const teams = await sb.from("teams").select("id,name").eq("org_id", state.org.id).order("name").then((r) => (r.error ? [] : r.data || []));
  const sel = new Set(picked);
  const s = sheet(`<h3>${ev ? "Editar evento" : "Novo evento da igreja"}</h3><form id="ef">
    <label class="field"><span>Nome *</span><input name="title" required maxlength="120" placeholder="Ex.: Culto dos jovens" value="${attr(ev?.title || "")}"></label>
    <label class="field"><span>Tipo *</span><select name="kind" required><option value="">Escolha…</option>${Object.entries(EVENT_KINDS).map(([k, v]) => `<option value="${k}" ${ev?.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <div class="dt3"><fieldset class="of"><legend>Data *</legend><input type="date" name="date" required value="${ev ? ymd(ev.starts_at) : day || ymd(new Date())}"></fieldset>
      <fieldset class="of"><legend>Início *</legend><input type="time" name="start" required value="${ev ? fTime(ev.starts_at) : "19:00"}"></fieldset>
      <fieldset class="of"><legend>Fim</legend><input type="time" name="end" value="${ev?.ends_at ? fTime(ev.ends_at) : ""}"></fieldset></div>
    <label class="field"><span>Local</span><input name="location" maxlength="160" placeholder="Ex.: Templo principal" value="${attr(ev?.location || "")}"></label>
    <label class="field"><span>Detalhes</span><textarea name="description" maxlength="1000">${esc(ev?.description || "")}</textarea></label>
    ${teams.length ? `<div class="field"><span>Ministérios de serviço</span><p class="small muted">Os líderes dos ministérios marcados recebem o aviso para criar a escala deste evento, e são lembrados todos os dias na última semana até criarem.</p>
      <div class="list">${teams.map((t) => `<label class="li"><input type="checkbox" data-team="${t.id}" ${sel.has(t.id) ? "checked" : ""}><span class="grow"><span class="t">${esc(t.name)}</span></span></label>`).join("")}</div></div>` : ""}
    <button class="btn primary block" id="esave">${ev ? "Salvar alterações" : "Salvar evento"}</button></form>`);
  s.el.querySelector("#ef").onsubmit = async (e2) => {
    e2.preventDefault(); const f = Object.fromEntries(new FormData(e2.target)); const b = s.el.querySelector("#esave"); busy(b);
    try {
      const row = { title: f.title.trim(), kind: f.kind || null, description: f.description.trim() || null, location: f.location.trim() || null,
        starts_at: fromLocal(f.date, f.start), ends_at: f.end ? fromLocal(f.date, f.end) : null };
      let id = ev?.id;
      if (id) await must(sb.from("church_events").update(row).eq("id", id));
      else id = (await must(sb.from("church_events").insert({ ...row, org_id: state.org.id, created_by: state.user.id }).select("id").single())).id;
      const now = new Set([...s.el.querySelectorAll("[data-team]")].filter((c) => c.checked).map((c) => c.dataset.team));
      const add = [...now].filter((t) => !sel.has(t)), del = [...sel].filter((t) => !now.has(t));
      if (del.length) await must(sb.from("church_event_teams").delete().eq("event_id", id).in("team_id", del));
      if (add.length) await must(sb.from("church_event_teams").insert(add.map((t) => ({ event_id: id, team_id: t, org_id: state.org.id }))));
      s.close(); toast(add.length ? `Evento salvo. ${add.length === 1 ? "O líder foi avisado" : "Os líderes foram avisados"}.` : ev ? "Evento atualizado" : "Evento na agenda"); again();
    } catch (err) { toast(errMsg(err), "err"); busy(b, false); }
  };
}

// Cartão vermelho, fixo no início: escalas que o líder ainda precisa criar para eventos da agenda.
export async function pendingScalesCard(teamId = null) {
  const r = await sb.rpc("my_pending_scales");
  const rows = (r.error ? [] : r.data || []).filter((p) => !teamId || p.team_id === teamId);
  if (!rows.length) return "";
  return `<div class="pending" role="alert"><div class="pt">${icon("bell")}<b>${rows.length === 1 ? "Falta criar 1 escala" : `Faltam criar ${rows.length} escalas`}</b></div>
    ${rows.map((p) => `<a class="prow" href="#/escala/nova/${p.team_id}?evento=${p.event_id}"><span class="grow"><b>${esc(p.title)}</b><small>${esc(fDateLong(p.starts_at))} · ${fTime(p.starts_at)}${teamId ? "" : ` · ${esc(p.team_name)}`}</small></span><span class="go">Criar escala ${icon("chevronRight")}</span></a>`).join("")}</div>`;
}

// Agenda da igreja: calendário do mês (ou lista), botão de adicionar, como nas escalas dos times
async function agenda(el, alive) {
  const MODE_KEY = "somos.agenda.mode";
  let mode = "calendar"; try { mode = localStorage.getItem(MODE_KEY) === "list" ? "list" : "calendar"; } catch { /* ok */ }
  const ppl = await people();
  let month = new Date(ymd(new Date()) + "T12:00:00"); month.setDate(1);
  let selDay = ymd(new Date());
  async function draw() {
    el.innerHTML = spinner();
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString(), to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
    const evs = await must(sb.from("church_events").select("*").eq("org_id", state.org.id).gte("starts_at", from).lt("starts_at", to).order("starts_at"));
    if (!alive()) return;
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0), today = ymd(new Date());
    const cells = [];
    for (let i = 0; i < month.getDay(); i++) cells.push(`<div class="d out"></div>`);
    for (let d = 1; d <= last.getDate(); d++) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const n = evs.filter((e) => ymd(e.starts_at) === key).length;
      cells.push(`<button class="d${key === today ? " today" : ""}${key === selDay ? " sel" : ""}" data-day="${key}">${d}<span class="marks">${"<i></i>".repeat(Math.min(3, n))}</span></button>`);
    }
    const nav = `<div class="calhead"><button class="iconbtn" data-m="-1">${icon("chevronLeft")}</button><b>${fMonthYear(month)}</b><button class="iconbtn" data-m="1">${icon("chevronRight")}</button></div>`;
    const dayEvs = evs.filter((e) => ymd(e.starts_at) === selDay);
    el.innerHTML = `<div class="pagehead"><h1>Agenda da igreja</h1>
        <button class="iconbtn" id="modebtn" aria-label="${mode === "list" ? "Ver em calendário" : "Ver em lista"}" title="${mode === "list" ? "Ver em calendário" : "Ver em lista"}">${icon(mode === "list" ? "calendar" : "list")}</button>
        ${canEditAgenda() ? `<button class="btn primary sm" id="newev">${icon("plus")} Novo evento</button>` : ""}</div>
      <div class="card">${nav}${mode === "list" ? "" : `<div class="cal">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells.join("")}</div>`}</div>
      ${mode === "list" ? "" : `<div class="sec"><h2>${esc(cap(fDateLong(selDay + "T15:00:00Z")))}</h2></div>
        ${dayEvs.length ? `<div class="list">${dayEvs.map(eventRow).join("")}</div>` : `<p class="muted small">Nada neste dia.</p>`}`}
      <div class="sec"><h2>${mode === "list" ? "Eventos do mês" : "Todos do mês"}</h2><span class="muted small">${evs.length}</span></div>
      ${evs.length ? `<div class="list">${evs.map(eventRow).join("")}</div>` : `<div class="card">${empty("calendar", "Nada na agenda neste mês", canEditAgenda() ? "Toque em Novo evento para marcar." : "Os eventos da igreja aparecem aqui.")}</div>`}`;
    const again = () => draw();
    el.querySelector("#newev")?.addEventListener("click", () => eventForm(again, null, [], selDay));
    el.querySelector("#modebtn").onclick = () => { mode = mode === "list" ? "calendar" : "list"; try { localStorage.setItem(MODE_KEY, mode); } catch { /* ok */ } draw(); };
    el.querySelectorAll("[data-m]").forEach((b) => { b.onclick = () => { month.setMonth(month.getMonth() + Number(b.dataset.m)); selDay = ymd(month); draw(); }; });
    el.querySelectorAll("[data-day]").forEach((b) => { b.onclick = () => { selDay = b.dataset.day; draw(); }; });
    on(el, "click", "[data-ev]", (e, b) => openEvent(evs.find((x) => x.id === b.dataset.ev), ppl, again));
  }
  await draw();
}

export async function churchHome(el, alive) {
  el.innerHTML = spinner();
  const [notices, evs, ppl, teams, ttl] = await Promise.all([
    must(sb.from("announcements").select("*").eq("org_id", state.org.id).is("team_id", null).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(5)),
    upcoming(60), people(),
    must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name")),
    titles(),
  ]);
  if (!alive()) return;
  const o = state.org;
  for (const [id, t] of ttl) if (ppl.get(id)) { ppl.get(id).church_title = t.title; ppl.get(id).church_rank = t.rank; }
  const leaders = orderedLeaders(ppl);
  const mine = new Set(state.myTeams.map((t) => t.id));
  el.innerHTML = `
  <section class="hero"><div class="grow"><p class="hello">Igreja</p><h1>${esc(o.name)}</h1>${o.subtitle ? `<p class="roles">${esc(o.subtitle)}</p>` : ""}</div></section>
  ${leadersBlock(leaders)}
  ${quickRow(churchShortcuts())}
  <div id="dsc"></div>
  <div id="disc"></div>

  <div id="pend"></div>
  <div class="sec"><h2>Avisos da igreja</h2><a href="#/avisos">Todos ${icon("chevronRight")}</a></div>
  ${notices.length ? `<div class="carousel" id="notices">${notices.map(noticeCard).join("")}</div>`
    : empty("megaphone", "Nenhum aviso publicado", canEditAgenda() ? `<a class="link" href="#/avisos/novo">Publicar o primeiro aviso</a>` : "Os comunicados da igreja aparecem aqui.")}

  <div class="sec"><h2>Agenda da igreja</h2><a href="#/agenda">Ver tudo ${icon("chevronRight")}</a></div>
  ${evs.length ? `<div class="list">${evs.slice(0, 4).map(eventRow).join("")}</div>` : `<div class="card">${empty("calendar", "Nada na agenda", canEditAgenda() ? `<button class="link" id="newev">Marcar o primeiro evento</button>` : "Os eventos da igreja aparecem aqui.")}</div>`}

  <div class="sec"><h2>Ministérios e times</h2><a href="#/times">Todos ${icon("chevronRight")}</a></div>
  <div class="list">${teams.map((t) => `<button class="li" data-team="${t.id}">${teamBadge(t, 40)}<span class="grow"><span class="t">${esc(t.name)}</span><span class="s">${esc(teamTypeLabel(t))}${mine.has(t.id) ? " · Você participa" : ""}</span></span>${icon("chevronRight")}</button>`).join("") || `<div class="li muted small">Nenhum time criado ainda.</div>`}</div>

  ${birthdaySection([...ppl.values()])}
  ${canEditAgenda() || isAdmin() ? `<div class="sec"><h2>Ações da igreja</h2></div><div class="chips" style="flex-wrap:wrap">
    ${canEditAgenda() ? `<button class="chip" id="newev2">${icon("calendar")} Novo evento</button><a class="chip" href="#/avisos/novo">${icon("megaphone")} Novo aviso</a>` : ""}
    ${isAdmin() ? `<a class="chip" href="#/times/novo">${icon("users")} Novo time</a><a class="chip" href="#/convidar-membro">${icon("org")} Convidar membro da igreja</a><button class="chip" id="edcoord">${icon("calendar")} Coordenadores da agenda</button>` : ""}</div>` : ""}`;
  const again = () => churchHome(el, alive);
  // "Para você": cards escolhidos pelo servidor (só com conteúdo real, público e destino funcionais); se a atualização do banco faltar, a seção some
  sb.rpc("home_discover", { p_org: state.org.id }).then((r) => {
    const box = el.querySelector("#disc"); if (!box || !alive() || r.error || !r.data?.cards?.length) return;
    box.innerHTML = discoverSection(r.data.cards); wireImages(box);
  }).catch(() => {});
  sb.rpc("shortcuts_for_me", { p_org: state.org.id }).then((r) => { const b = el.querySelector("#dsc"); if (b && alive() && !r.error && r.data?.length) b.innerHTML = quickRow(r.data.map((x) => [x.icon, x.label, x.route])); }).catch(() => {});
  pendingScalesCard().then((h) => { const b = el.querySelector("#pend"); if (b) b.innerHTML = h; }).catch(() => {});
  el.querySelector("#newev")?.addEventListener("click", () => eventForm(again));
  el.querySelector("#newev2")?.addEventListener("click", () => eventForm(again));
  on(el, "click", "[data-ev]", (e, b) => openEvent(evs.find((x) => x.id === b.dataset.ev), ppl, again));
  on(el, "click", "[data-notice]", (e, b) => openNotice(notices.find((n) => n.id === b.dataset.notice), ppl));
  on(el, "click", "[data-team]", (e, b) => go(`/times/${b.dataset.team}`));
  el.querySelector("#addlead")?.addEventListener("click", () => pickLeaderSheet(ppl, leaders, again));
  on(el, "click", "[data-lead]", (e, b) => leaderSheet(ppl, leaders, ppl.get(b.dataset.lead), again));
  el.querySelector("#edcoord")?.addEventListener("click", () => coordinatorsSheet(ppl, again));
}

// O administrador escolhe quem coordena a agenda (quantas pessoas quiser).
async function coordinatorsSheet(ppl, again) {
  const r = await sb.from("org_members").select("user_id,agenda_coordinator").eq("org_id", state.org.id);
  if (r.error) return toast("Aplique a atualização do banco (coordenador de agenda) para usar esta opção.", "err");
  const on0 = new Set((r.data || []).filter((m) => m.agenda_coordinator).map((m) => m.user_id));
  const all = [...ppl.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const s = sheet(`<h3>Coordenadores de agenda</h3><p class="small muted">Quem for marcado monta a agenda da igreja e publica os avisos gerais: cria, edita e apaga eventos. Não mexe em escalas, times nem membros. Pode ser alguém só da igreja ou de qualquer time, e pode haver mais de um.</p>
    <div class="list">${all.map((p) => `<label class="li"><input type="checkbox" data-co="${p.id}" ${on0.has(p.id) ? "checked" : ""}>${avatar(p, 36, false)}<span class="grow" style="min-width:0"><span class="t ellipsis">${esc(p.display_name)}</span></span></label>`).join("")}</div>
    <button class="btn primary block mt" id="csave">Salvar</button>`);
  s.el.querySelector("#csave").onclick = async (ev) => {
    busy(ev.currentTarget);
    try {
      for (const c of s.el.querySelectorAll("[data-co]")) {
        if (c.checked === on0.has(c.dataset.co)) continue;
        await must(sb.from("org_members").update({ agenda_coordinator: c.checked }).eq("org_id", state.org.id).eq("user_id", c.dataset.co));
      }
      s.close(); toast("Coordenadores salvos"); again();
    } catch (err) { toast(errMsg(err), "err"); busy(ev.currentTarget, false); }
  };
}

// Liderança em ordem hierárquica: posição 1 é o líder principal (ex.: bispo), depois os demais. Sem posição, vai para o fim, por nome.
function orderedLeaders(ppl) {
  return [...ppl.values()].filter((p) => p.church_title)
    .sort((a, b) => (a.church_rank ?? 1e9) - (b.church_rank ?? 1e9) || a.display_name.localeCompare(b.display_name));
}
// Fotos redondas, maiores que os demais círculos do Início; o líder principal em destaque. Só o administrador vê o "+" (e toca nas fotos para editar).
function leadersBlock(leaders) {
  const adm = isAdmin();
  if (!leaders.length && !adm) return "";
  const card = (p, main) => `<${adm ? "button" : "div"} class="leader${main ? " main" : ""}"${adm ? ` data-lead="${p.id}"` : ""}>${avatar(p, main ? 128 : 100, main)}<b class="ellipsis">${esc(p.display_name)}</b><span class="ellipsis">${esc(p.church_title)}</span></${adm ? "button" : "div"}>`;
  const [first, ...rest] = leaders;
  const add = adm ? `<button class="leader add" id="addlead" aria-label="Adicionar líder à liderança"><span class="plus" style="--s:100px">${icon("plus")}</span></button>` : "";
  return `<div class="sec"><h2>Nossa liderança</h2></div><section class="leaders" aria-label="Nossa liderança">${first ? `<div class="lead-main">${card(first, true)}</div>` : ""}<div class="lead-rest">${rest.map((p) => card(p, false)).join("")}${add}</div></section>`;
}

// Grava cargo e posição de quem está na liderança (ordem = posição na lista). Sem a atualização do banco, grava só o cargo.
async function saveLeaders(ppl, order, titleOf, again, removed = []) {
  let rankOk = true;
  const write = async (id, row) => {
    let r = await sb.from("org_members").update(rankOk ? row : { church_title: row.church_title }).eq("org_id", state.org.id).eq("user_id", id);
    if (r.error && rankOk && /church_rank/i.test(r.error.message || "")) { rankOk = false; r = await sb.from("org_members").update({ church_title: row.church_title }).eq("org_id", state.org.id).eq("user_id", id); }
    if (r.error) throw r.error;
  };
  for (const [i, id] of order.entries()) {
    const p = ppl.get(id), title = titleOf(id), rank = i + 1;
    if ((p?.church_title || null) !== title || (p?.church_rank ?? null) !== rank) await write(id, { church_title: title, church_rank: rank });
  }
  for (const id of removed) await write(id, { church_title: null, church_rank: null });
  invalidatePeople(); again();
  if (!rankOk) toast("Para guardar a ordem, aplique a atualização do banco (liderança em ordem).", "err");
}

// "+": escolhe a pessoa e depois informa o cargo
function pickLeaderSheet(ppl, leaders, again) {
  const have = new Set(leaders.map((p) => p.id));
  const all = [...ppl.values()].filter((p) => !have.has(p.id)).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const s = sheet(`<h3>Adicionar à liderança</h3><p class="small muted">Escolha a pessoa. Depois você informa o cargo (ex.: Bispo, Pastor, Pastora, Diácono).</p>
    <input class="input" id="lq" placeholder="Buscar pelo nome" autocomplete="off">
    <div class="list mt" id="llist">${all.map((p) => `<button class="li" data-pick="${p.id}" data-n="${attr(p.display_name.toLowerCase())}">${avatar(p, 40, false)}<span class="grow" style="min-width:0"><span class="t ellipsis">${esc(p.display_name)}</span></span>${icon("chevronRight")}</button>`).join("") || `<div class="li muted small">Todas as pessoas da igreja já estão na liderança.</div>`}</div>`);
  s.el.querySelector("#lq").addEventListener("input", (e) => { const q = e.target.value.trim().toLowerCase(); s.el.querySelectorAll("[data-pick]").forEach((b) => { b.hidden = !!q && !b.dataset.n.includes(q); }); });
  on(s.el, "click", "[data-pick]", (e, b) => { s.close(); leaderSheet(ppl, leaders, ppl.get(b.dataset.pick), again); });
}

// Cargo, posição (subir/descer) e remover
function leaderSheet(ppl, leaders, p, again) {
  if (!p) return;
  const isNew = !leaders.some((x) => x.id === p.id);
  const ids = leaders.map((x) => x.id); if (isNew) ids.push(p.id);
  const idx = ids.indexOf(p.id);
  const s = sheet(`<div class="row gap">${avatar(p, 56, false)}<div class="grow" style="min-width:0"><h3 style="margin:0" class="ellipsis">${esc(p.display_name)}</h3><span class="small muted">${isNew ? "Entrando na liderança" : `Posição ${idx + 1} de ${ids.length}${idx === 0 ? " · líder principal" : ""}`}</span></div></div>
    <label class="field mt"><span>Cargo *</span><input id="ltitle" maxlength="60" placeholder="Ex.: Bispo, Pastor, Pastora" value="${attr(p.church_title || "")}"></label>
    ${isNew ? `<p class="small muted">Entra no fim da lista. Depois você pode subir de posição.</p>` : `<div class="row gap-s"><button class="btn ghost sm grow" id="lup" ${idx === 0 ? "disabled" : ""}>${icon("chevronUp")} Subir</button><button class="btn ghost sm grow" id="ldown" ${idx === ids.length - 1 ? "disabled" : ""}>${icon("chevronDown")} Descer</button></div>`}
    <button class="btn primary block mt" id="lsave">${isNew ? "Adicionar" : "Salvar"}</button>
    ${isNew ? "" : `<button class="btn danger block mt-s" id="ldel">${icon("trash")} Tirar da liderança</button>`}`);
  const titleNow = () => s.el.querySelector("#ltitle").value.trim();
  const run = async (btn, fn) => { busy(btn); try { await fn(); s.close(); } catch (err) { toast(errMsg(err), "err"); busy(btn, false); } };
  s.el.querySelector("#lsave").onclick = (ev) => { if (!titleNow()) return toast("Informe o cargo.", "err"); run(ev.currentTarget, () => saveLeaders(ppl, ids, (id) => (id === p.id ? titleNow() : ppl.get(id).church_title), again)); };
  const move = (d) => (ev) => run(ev.currentTarget, () => { const o = [...ids]; [o[idx], o[idx + d]] = [o[idx + d], o[idx]]; return saveLeaders(ppl, o, (id) => (id === p.id ? (titleNow() || p.church_title) : ppl.get(id).church_title), again); });
  s.el.querySelector("#lup")?.addEventListener("click", move(-1));
  s.el.querySelector("#ldown")?.addEventListener("click", move(1));
  s.el.querySelector("#ldel")?.addEventListener("click", async (ev) => {
    if (!(await confirmDialog(`Tirar ${p.display_name} da liderança? A pessoa continua na igreja.`, "Tirar", true))) return;
    run(ev.currentTarget, () => saveLeaders(ppl, ids.filter((x) => x !== p.id), (id) => ppl.get(id).church_title, again, [p.id]));
  });
}
