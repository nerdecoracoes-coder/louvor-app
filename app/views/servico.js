// Ambiente de serviço ("Hora de servir"): abre sozinho no dia da escala, perto do horário do evento.
import { sb, state, must, esc, attr, icon, avatar, fTime, fDate, fDow, ymd, people, personName, myName, canManageTeam, isAdmin, sheet, toast, errMsg, busy, on, go, empty, spinner, confirmDialog, linkify, cap, roleIcon } from "../core.js";

export function register(route) {
  route("/servico/teste", (p, el, a) => previewView(el, a));
  route("/servico/:id", (p, el, a) => serviceView(p.id, el, a));
  route("/times/:id/servico", (p, el, a) => configView(p.id, el, a));
}

const seenKey = (id) => `svc_seen_${id}`;
const safeGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ok */ } };

// O ambiente de teste vale por 3 dias (até 11/11/2026, 23:59 de Brasília) e some sozinho depois.
export const PREVIEW_UNTIL = new Date("2026-11-12T02:59:59Z").getTime();
export const previewOn = () => Date.now() < PREVIEW_UNTIL;
export const DEFAULT_LEAD = 60;
export const LEAD_OPTIONS = [[0, "Desligado"], [15, "15 minutos"], [30, "30 minutos"], [45, "45 minutos"], [60, "1 hora"], [90, "1 h 30"], [120, "2 horas"], [180, "3 horas"]];

// A escala de hoje em que estou escalado e cuja janela de serviço (início − antecedência até o fim) está aberta.
export async function activeService(ignoreSeen = false) {
  if (!state.user || !state.org) return null;
  const now = Date.now();
  const rows = await must(sb.from("schedule_assignments")
    .select("schedule_id,role_name,role_id,schedules!inner(id,title,starts_at,ends_at,status,team_id,location)")
    .eq("user_id", state.user.id).eq("org_id", state.org.id).eq("schedules.status", "published")
    .gte("schedules.starts_at", new Date(now - 14 * 3600e3).toISOString()).lte("schedules.starts_at", new Date(now + 24 * 3600e3).toISOString()));
  if (!rows.length) return null;
  const teamIds = [...new Set(rows.map((r) => r.schedules.team_id))];
  const lead = new Map();
  const t = await sb.from("teams").select("id,service_lead_min").in("id", teamIds);
  for (const x of t.data || []) lead.set(x.id, x.service_lead_min);
  const open = [];
  for (const r of rows) {
    const s = r.schedules, start = new Date(s.starts_at).getTime();
    const min = lead.has(s.team_id) ? lead.get(s.team_id) : DEFAULT_LEAD;
    if (!min) continue;
    const end = s.ends_at ? new Date(s.ends_at).getTime() : start + 2.5 * 3600e3;
    if (now >= start - min * 60e3 && now <= end + 30 * 60e3 && (ignoreSeen || !safeGet(seenKey(s.id)))) open.push(s);
  }
  open.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return open[0] || null;
}

// Usado pelas rotas de início: true quando já mandou para a página de serviço.
export async function maybeService() {
  try { const s = await activeService(); if (s) { go(`/servico/${s.id}`); return true; } } catch (e) { console.warn(e); }
  return false;
}

const GREETING = "Você está pronto para servir a Deus com o melhor que tem? Então siga os passos abaixo, e que o seu serviço seja com excelência, para a glória de Deus.";

// Dicas por tipo de função (o que ajuda a servir com excelência)
const TIPS = [
  [/bater|percuss|bateria/, ["Afine e confira caixa, tons e pedal antes de todo mundo chegar", "Tenha baquetas reserva e o metrônomo/click testado", "Combine com o líder as entradas e finais de cada música"]],
  [/baix/, ["Afine e teste o instrumento e os cabos", "Confira bateria/pilhas e o volume no retorno", "Ouça o tom de cada música para não se perder na passagem"]],
  [/guitarra|violão|viol|cavaq|ukul/, ["Troque cordas velhas e afine com calma", "Leve palheta, capotraste e cabo reserva", "Confira o seu timbre e o volume no retorno"]],
  [/teclad|piano|keys/, ["Confira sons e timbres de cada música", "Teste cabos, pedal de sustain e fonte de energia", "Combine com a banda os pads e as pontes"]],
  [/vocal|voz|cantor|backing|ministr/, ["Aqueça a voz e beba água em temperatura ambiente", "Reveja as letras e os tons das músicas", "Confira o retorno e o seu microfone antes de começar"]],
  [/som|áudio|audio|mesa/, ["Ligue os equipamentos na ordem certa e confira todos os canais", "Faça a passagem de som com cada instrumento e voz", "Deixe a mesa salva e o volume ambiente confortável"]],
  [/mídia|midia|projeç|slide|letra|propres|holyrics/, ["Abra o programa e confira as letras e os slides da escala", "Teste projetor/TV e o fundo de cada música", "Combine com o louvor a ordem e os avisos"]],
  [/câmera|camera|vídeo|video|live|stream|foto/, ["Carregue baterias e confira cartão e armazenamento", "Posicione câmeras e teste enquadramento e áudio", "Combine os momentos principais com a equipe"]],
  [/recep|diac|acolh|welcome/, ["Chegue cedo e esteja com um sorriso", "Conheça o fluxo do culto e onde ficam as pessoas", "Tenha em mãos as informações que visitantes costumam pedir"]],
];
const tipsFor = (names) => {
  const out = [];
  for (const n of names) for (const [re, list] of TIPS) if (re.test(n.toLowerCase())) out.push(...list);
  return [...new Set(out)];
};
const PREPARE = ["Respire fundo e entregue este momento a Deus", "Ore pelas pessoas que vão chegar e pela equipe com quem você serve", "Lembre-se: o serviço é para Deus, antes de ser para qualquer pessoa", "Chegue com o coração leve. Se algo estiver pesando, converse com o líder"];
const mins = (ms) => Math.round(ms / 60000);
const until = (iso) => {
  const d = mins(new Date(iso).getTime() - Date.now());
  if (d > 90) return `começa em ${Math.floor(d / 60)} h ${d % 60 ? `${d % 60} min` : ""}`.trim();
  if (d > 1) return `começa em ${d} min`;
  if (d >= -1) return "começa agora";
  return "em andamento";
};
export const targetOf = (item, startsAt) => (item.offset_min == null ? null : new Date(new Date(startsAt).getTime() + item.offset_min * 60e3).toISOString());
// Atraso em minutos (positivo = marcou depois do horário-alvo; tolerância de 5 min)
export const lateness = (checkedAt, targetAt) => (targetAt ? mins(new Date(checkedAt).getTime() - new Date(targetAt).getTime()) : 0);

async function serviceView(id, el, alive) {
  el.innerHTML = spinner();
  const s = (await must(sb.from("schedules").select("*").eq("id", id).limit(1)))[0];
  if (!s) { el.innerHTML = empty("calendar", "Escala não encontrada"); return; }
  safeSet(seenKey(s.id), "1");
  const [mine, items, checks, rehs, leaders] = await Promise.all([
    must(sb.from("schedule_assignments").select("role_id,role_name").eq("schedule_id", id).eq("user_id", state.user.id)),
    sb.from("role_checklist_items").select("*").eq("team_id", s.team_id).order("position").then((r) => r.data || []),
    sb.from("service_checks").select("*").eq("schedule_id", id).eq("user_id", state.user.id).then((r) => r.data || []),
    sb.from("schedule_rehearsals").select("starts_at,notes").eq("schedule_id", id).order("starts_at").then((r) => r.data || []),
    must(sb.from("team_members").select("user_id").eq("team_id", s.team_id).eq("is_leader", true)),
  ]);
  if (!alive()) return;
  const ppl = await people();
  paintService(el, {
    s, items, rehs, mine, leaders: leaders.map((l) => ppl.get(l.user_id)).filter(Boolean),
    done: new Map(checks.map((c) => [c.item_id, c])), manage: canManageTeam(s.team_id),
    save: async (it, on_) => {
      if (!on_) { await must(sb.from("service_checks").delete().eq("schedule_id", s.id).eq("item_id", it.id).eq("user_id", state.user.id)); return null; }
      const row = { schedule_id: s.id, item_id: it.id, user_id: state.user.id, org_id: s.org_id, team_id: s.team_id, target_at: targetOf(it, s.starts_at) };
      return (await must(sb.from("service_checks").insert(row).select()))[0] || { ...row, checked_at: new Date().toISOString() };
    },
  });
}

// Desenha a página de serviço. Serve à escala de verdade e à pré-visualização (que não grava nada).
function paintService(el, c) {
  const { s, items, rehs, mine, leaders, done, manage, save, preview } = c;
  const myRoleIds = new Set(mine.map((m) => m.role_id).filter(Boolean));
  const myItems = items.filter((i) => !i.role_id || myRoleIds.has(i.role_id));
  const first = (myName().split(" ")[0]) || "você";
  const roleNames = [...new Set(mine.map((m) => m.role_name).filter(Boolean))];
  const tips = tipsFor(roleNames);
  let tab = "check";

  const checkRow = (it) => {
    const ck = done.get(it.id), target = targetOf(it, s.starts_at);
    let note = "";
    if (target && !ck) note = `<small class="muted">até ${fTime(target)}</small>`;
    if (ck) {
      const tg = ck.target_at || target, late = lateness(ck.checked_at, tg);
      note = `<small class="${late > 5 ? "svc-late" : "svc-ok"}">Marcado às ${fTime(ck.checked_at)}${tg ? (late > 5 ? ` · ${late} min depois de ${fTime(tg)}` : ` · no horário (${fTime(tg)})`) : ""}</small>`;
    }
    return `<button class="li check${ck ? " on" : ""}" data-it="${it.id}"><span class="cb">${ck ? icon("check") : ""}</span><span class="grow" style="min-width:0"><span class="t">${esc(it.label)}</span>${note ? `<br>${note}` : ""}</span></button>`;
  };
  // linha do tempo do dia: chegada, ensaios, início e fim
  const timeline = () => {
    const ev = [];
    for (const it of myItems) { const t = targetOf(it, s.starts_at); if (t) ev.push({ at: t, label: it.label }); }
    for (const r of rehs) ev.push({ at: r.starts_at, label: `Ensaio${r.notes ? ` · ${r.notes}` : ""}` });
    ev.push({ at: s.starts_at, label: s.title, main: true });
    if (s.ends_at) ev.push({ at: s.ends_at, label: "Encerramento" });
    ev.sort((a, b) => a.at.localeCompare(b.at));
    const nextIdx = ev.findIndex((e) => new Date(e.at).getTime() >= Date.now() - 60e3);
    return `<div class="svc-tl">${ev.map((e, i) => `<div class="svc-step${new Date(e.at).getTime() < Date.now() - 60e3 ? " past" : ""}${i === nextIdx ? " next" : ""}${e.main ? " main" : ""}"><b>${fTime(e.at)}</b><span>${esc(e.label)}</span></div>`).join("")}</div>`;
  };
  const draw = () => {
    const n = myItems.filter((i) => done.has(i.id)).length, pct = myItems.length ? Math.round(n / myItems.length * 100) : 0;
    const pane = {
      check: myItems.length
        ? `<div class="svc-prog"><div><i style="width:${pct}%"></i></div><span>${n} de ${myItems.length}</span></div><div class="list">${myItems.map(checkRow).join("")}</div>
           <p class="tiny muted" style="margin:10px 2px 0">O horário registrado é o do relógio no momento em que você marca.</p>`
        : empty("check", "Nenhum item para a sua função", manage ? `<a class="link" href="#/times/${s.team_id}/servico">Montar o checklist</a>` : "Quando o líder montar o checklist da sua função, ele aparece aqui."),
      agora: `<div class="card svc-count"><span>${esc(until(s.starts_at))}</span><b>${fTime(s.starts_at)}</b></div>${timeline()}
        ${preview ? "" : `<a class="btn ghost" style="margin-top:12px" href="#/escala/${s.id}">${icon("calendar")} Ver a escala completa</a>`}`,
      preparar: `<div class="sec"><h2>Prepare o coração</h2></div><div class="list">${PREPARE.map((t) => `<div class="li"><span class="grow">${esc(t)}</span></div>`).join("")}</div>
        ${tips.length ? `<div class="sec"><h2>Para servir com excelência${roleNames.length ? ` · ${esc(roleNames.join(", "))}` : ""}</h2></div><div class="list">${tips.map((t) => `<div class="li"><span class="grow">${esc(t)}</span></div>`).join("")}</div>` : ""}`,
      ajuda: leaders.length
        ? `<p class="muted small" style="margin:0 0 10px">Precisou de ajuda ou vai se atrasar? Fale com a liderança.</p><div class="list">${leaders.map((p) => {
          const ph = String(p.phone || "").replace(/\D/g, "");
          return `<div class="li">${avatar(p, 36)}<span class="grow"><b>${esc(p.display_name)}</b><br><small class="muted">Líder</small></span>${ph ? `<a class="iconbtn" href="tel:+${ph.startsWith("55") ? ph : "55" + ph}" aria-label="Ligar">${icon("phone")}</a><a class="iconbtn" target="_blank" rel="noopener" href="https://wa.me/${ph.startsWith("55") ? ph : "55" + ph}" aria-label="WhatsApp">${icon("whatsapp")}</a>` : ""}</div>`; }).join("")}</div>`
        : empty("users", "Nenhum líder cadastrado neste time"),
    }[tab];
    el.querySelector("#pane").innerHTML = pane;
    el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const pb = el.querySelector("#pbadge"); if (pb) pb.textContent = myItems.length ? `${n}/${myItems.length}` : "";
  };
  const host = el.querySelector("#svcbox") || el;
  host.innerHTML = `
  <section class="svc-hero">
    <p class="svc-kicker">Hora de servir</p>
    <h1>${esc(first)}, que bom ter você aqui!</h1>
    <p class="svc-verse">${esc(GREETING)}</p>
    <div class="svc-ev"><b>${esc(s.title)}</b><span>${fTime(s.starts_at)} · ${until(s.starts_at)}</span></div>
    <div class="svc-roles">${roleNames.map((r) => `<span class="pill">${icon(roleIcon(r) || "star")} ${esc(r)}</span>`).join("")}</div>
  </section>
  <div class="etabs" role="tablist">
    <button data-tab="check" class="on"><span class="tl">${icon("check")}<em id="pbadge"></em></span><span class="tn">Checklist</span></button>
    <button data-tab="agora"><span class="tl">${icon("clock")}</span><span class="tn">Agora</span></button>
    <button data-tab="preparar"><span class="tl">${icon("heart")}</span><span class="tn">Preparar</span></button>
    <button data-tab="ajuda"><span class="tl">${icon("phone")}</span><span class="tn">Ajuda</span></button>
  </div>
  <div id="pane"></div>
  <p class="tiny muted" style="margin:18px 2px 6px;text-align:center">Pode explorar o app à vontade: um aviso “Hora de servir” fica no alto para você voltar aqui.</p>
  <div class="row gap" style="margin:6px 0;justify-content:space-between"><a class="link" href="#/inicio">Explorar o app</a>${manage && !preview ? `<a class="link" href="#/times/${s.team_id}/servico">Configurar o serviço</a>` : ""}</div>`;
  draw();
  if (host.__svc) host.removeEventListener("click", host.__svc);
  host.__svc = async (e) => {
    const tb = e.target.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; draw(); return; }
    const b = e.target.closest("[data-it]"); if (!b) return;
    const it = myItems.find((i) => i.id === b.dataset.it); if (!it) return;
    try {
      if (done.has(it.id)) { await save(it, false); done.delete(it.id); }
      else done.set(it.id, await save(it, true));
      draw();
    } catch (err) { toast(errMsg(err), "err"); }
  };
  host.addEventListener("click", host.__svc);
}

// ---------------------------------------------------------------- pré-visualização para líderes e administradores
async function previewView(el, alive) {
  if (!previewOn()) { el.innerHTML = empty("clock", "O ambiente de teste da Hora de servir terminou."); return; }
  el.innerHTML = spinner();
  const teams = isAdmin() ? state.orgTeams : state.myTeams.filter((t) => canManageTeam(t.id));
  const list = teams?.length ? teams : state.myTeams;
  const roles = await must(sb.from("music_roles").select("id,name,sort").eq("org_id", state.org.id).order("sort"));
  if (!alive()) return;
  if (!list.length) { el.innerHTML = empty("lock", "Somente líderes e administradores testam a Hora de servir."); return; }
  let q = { team: state.space?.id && list.some((t) => t.id === state.space.id) ? state.space.id : list[0].id, role: roles[0]?.id || "", min: 30 };
  const MINS = [[120, "Começa em 2 horas"], [45, "Começa em 45 min"], [30, "Começa em 30 min"], [10, "Começa em 10 min"], [0, "Começa agora"], [-30, "Já começou (30 min atrás)"]];
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/inicio">${icon("chevronLeft")}</a><h1>Testar Hora de servir</h1></div>
  <div class="card svc-prev"><p class="muted small" style="margin:0 0 8px">Veja a página como a pessoa escalada veria. Nada é salvo e ninguém é avisado.</p>
    <label class="field"><span>Time</span><select id="pt">${list.map((t) => `<option value="${t.id}" ${t.id === q.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
    <label class="field"><span>Função</span><select id="pr">${roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}<option value="">Sem função</option></select></label>
    <label class="field"><span>Horário</span><select id="pm">${MINS.map(([v, l]) => `<option value="${v}" ${v === q.min ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="row gap"><button class="btn" id="preset">Marcar tudo de novo</button></div></div>
  <div id="svcbox"></div>`;
  const run = async () => {
    const now = Date.now(), team = list.find((t) => t.id === q.team), role = roles.find((r) => r.id === q.role);
    const items = await must(sb.from("role_checklist_items").select("*").eq("team_id", q.team).order("position"));
    const s = { id: "preview", org_id: state.org.id, team_id: q.team, title: "Culto de teste", starts_at: new Date(now + q.min * 60e3).toISOString(), ends_at: new Date(now + (q.min + 120) * 60e3).toISOString() };
    paintService(el, {
      s, items, preview: true, manage: false, done: new Map(), mine: [{ role_id: role?.id || null, role_name: role?.name || null }],
      rehs: [{ starts_at: new Date(now + (q.min - 90) * 60e3).toISOString(), notes: "exemplo" }],
      leaders: [{ id: "x", display_name: "Líder de exemplo", phone: "" }],
      save: async (it, on_) => (on_ ? { item_id: it.id, checked_at: new Date().toISOString(), target_at: targetOf(it, s.starts_at) } : null),
    });
    if (!items.length) el.querySelector("#pane").insertAdjacentHTML("afterbegin", `<p class="tiny muted">${esc(team?.name || "")} ainda não tem itens. Monte em <a class="link" href="#/times/${q.team}/servico">Hora de servir</a>.</p>`);
  };
  on(el, "change", "#pt", (e, b) => { q.team = b.value; run(); });
  on(el, "change", "#pr", (e, b) => { q.role = b.value; run(); });
  on(el, "change", "#pm", (e, b) => { q.min = Number(b.value); run(); });
  on(el, "click", "#preset", () => run());
  run();
}

// aviso fixo "Hora de servir" para voltar à página de serviço enquanto a janela está aberta
let bannerAt = 0, bannerSched = null;
export async function updateBanner(path) {
  const old = document.getElementById("svcbar");
  if (path.startsWith("/servico") || !state.user) { old?.remove(); bannerAt = 0; return; }
  try {
    if (Date.now() - bannerAt > 60e3) { bannerAt = Date.now(); bannerSched = await activeService(true); }
  } catch { bannerSched = null; }
  if (!bannerSched) { old?.remove(); return; }
  const bar = old || Object.assign(document.createElement("a"), { id: "svcbar", className: "svc-bar" });
  bar.href = `#/servico/${bannerSched.id}`;
  bar.innerHTML = `${icon("heart")}<span><b>Hora de servir</b> · ${esc(bannerSched.title)}</span>${icon("chevronRight")}`;
  if (!old) document.body.appendChild(bar);
}

// ---------------------------------------------------------------- configuração dos líderes
export const SUGGESTIONS = [["Chegar ao local", 30], ["Conferir o seu equipamento", 20], ["Participar da oração da equipe", 10], ["Tudo pronto para começar", 5]];

async function configView(teamId, el, alive) {
  if (!canManageTeam(teamId)) { el.innerHTML = empty("lock", "Somente líderes configuram o serviço."); return; }
  el.innerHTML = spinner();
  const team = state.orgTeams?.find((t) => t.id === teamId) || state.myTeams.find((t) => t.id === teamId);
  let items;
  const [roles, items0, trow] = await Promise.all([
    must(sb.from("music_roles").select("id,name,sort").eq("org_id", state.org.id).order("sort")),
    must(sb.from("role_checklist_items").select("*").eq("team_id", teamId).order("position")),
    sb.from("teams").select("service_lead_min").eq("id", teamId).limit(1).then((r) => r.data?.[0]),
  ]);
  items = items0;
  if (!alive()) return;
  const lead = trow?.service_lead_min ?? DEFAULT_LEAD;
  const groups = [{ id: null, name: "Todos os escalados" }, ...roles];
  const offTxt = (o) => (o == null ? "" : String(-o));
  const paint = () => { el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Hora de servir</h1></div>
  <p class="muted small" style="margin:0 0 12px">No dia da escala, quem está escalado abre o app direto na página de serviço, com o checklist da sua função.</p>
  ${previewOn() ? `<a class="btn primary" href="#/servico/teste" style="margin-bottom:12px">${icon("eye")} Testar como uma função (até ${fDate(PREVIEW_UNTIL - 3600e3)})</a>` : ""}
  <label class="field"><span>Abrir a página de serviço</span><select id="lead">${LEAD_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === lead ? "selected" : ""}>${v ? `${l} antes do início` : l}</option>`).join("")}</select></label>
  ${groups.map((g) => { const list = items.filter((i) => (i.role_id || null) === g.id); return `<div class="sec"><h2>${esc(g.name)}</h2><span class="cnt2">${list.length}</span></div>
    <div class="card" data-g="${g.id || ""}">
      ${list.map((i) => `<div class="row gap svc-cfg" data-id="${i.id}"><input class="input grow" data-lbl maxlength="140" value="${attr(i.label)}"><input class="input" data-off type="number" min="-720" max="720" placeholder="min antes" value="${offTxt(i.offset_min)}" title="Minutos antes do início (vazio = sem horário)"><button class="iconbtn" data-del aria-label="Remover">${icon("trash")}</button></div>`).join("") || `<p class="tiny muted" style="margin:0 0 8px">Nenhum item.</p>`}
      <div class="row gap"><input class="input grow" data-new maxlength="140" placeholder="Novo item (ex.: Chegar ao local)"><input class="input" data-newoff type="number" min="-720" max="720" placeholder="min antes"><button class="btn" data-add>${icon("plus")}</button></div>
      ${!g.id && !list.length ? `<button class="chip" data-sug style="margin-top:10px">Usar sugestões</button>` : ""}
    </div>`; }).join("")}`; };
  paint();
  const num = (v) => { const n = v === "" || v == null ? null : -Number(v); return Number.isFinite(n) ? n : null; };
  const reload = async () => { items = await must(sb.from("role_checklist_items").select("*").eq("team_id", teamId).order("position")); paint(); };
  const base = (g) => ({ org_id: state.org.id, team_id: teamId, role_id: g || null });
  on(el, "change", "#lead", async (e) => {
    try { await must(sb.from("teams").update({ service_lead_min: Number(e.target.value) }).eq("id", teamId)); toast("Salvo"); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-add]", async (e, b) => {
    const box = b.closest("[data-g]"), lbl = box.querySelector("[data-new]").value.trim(); if (!lbl) return;
    const n = items.filter((i) => (i.role_id || "") === box.dataset.g).length;
    try { await must(sb.from("role_checklist_items").insert({ ...base(box.dataset.g), label: lbl, offset_min: num(box.querySelector("[data-newoff]").value), position: n + 1 })); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-sug]", async (e, b) => {
    const g = b.closest("[data-g]").dataset.g;
    try { await must(sb.from("role_checklist_items").insert(SUGGESTIONS.map(([label, m], i) => ({ ...base(g), label, offset_min: -m, position: i + 1 })))); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-del]", async (e, b) => {
    try { await must(sb.from("role_checklist_items").delete().eq("id", b.closest("[data-id]").dataset.id)); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  const upd = async (e) => {
    const r = e.target.closest("[data-id]"); if (!r) return;
    const label = r.querySelector("[data-lbl]").value.trim(); if (!label) return;
    try { await must(sb.from("role_checklist_items").update({ label, offset_min: num(r.querySelector("[data-off]").value) }).eq("id", r.dataset.id)); toast("Salvo"); }
    catch (err) { toast(errMsg(err), "err"); }
  };
  on(el, "change", "[data-lbl],[data-off]", upd);
}
