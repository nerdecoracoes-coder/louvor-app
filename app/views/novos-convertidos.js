// Novos Convertidos (SOMOS Chamados): decisões de fé como acontecimento na trajetória da pessoa.
// Não muda classificação, não cria conta nem vínculo com times. Contato só com autorização explícita. Acompanhamento flexível (sem metas, prazos ou alertas).
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog, canAdminOrg, peopleCan } from "../core.js";
import { CLASS_LABEL, errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/novos-convertidos", (p, el, a) => panel(el, a));
  route("/novos-convertidos/:id", (p, el, a) => detail(el, a, p.id));
  route("/decisao", (p, el, a) => selfForm(el, a));
  route("/decidi/:token", (p) => publicForm(p.token), { public: true, noOrg: true });
}

const ORIGINS = [["culto", "Culto"], ["celula", "Célula"], ["evento", "Evento"], ["transmissao", "Transmissão ao vivo"], ["evangelismo", "Evangelismo"], ["acao_externa", "Ação externa"], ["atendimento", "Atendimento pessoal"], ["outro", "Outro"]];
const SELF_ORIGINS = ORIGINS.filter(([k]) => ["culto", "celula", "evento", "transmissao", "outro"].includes(k));
const STATUS = { registered: "Registrado", offered: "Acompanhamento oferecido", in_progress: "Em andamento", suspended: "Suspenso", ended: "Encerrado", declined: "Não deseja acompanhamento" };
const CONSENT = { authorized: "Autorizo contato", declined: "Não desejo receber contato", unknown: "Não informado" };
const ENTRY = { contact: "Contato", note: "Anotação", interest: "Interesse", referral: "Encaminhamento" };
const CHANNEL = { whatsapp: "WhatsApp", phone: "Telefone", email: "E-mail", presencial: "Presencial", outro: "Outro" };
const LOG = { register: "Decisão registrada", link: "Associada a uma ficha", update: "Informações corrigidas", void: "Registro anulado", assign: "Responsável designado", unassign: "Responsável removido", status: "Situação do acompanhamento", entry: "Registro de acompanhamento", settings: "Configurações" };
const today = () => new Date().toLocaleDateString("sv");
const br = (d) => (d ? String(d).split("-").reverse().join("/") : "");
const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("");
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-30-novos-convertidos.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const consentRadios = (cur = "unknown", name = "consent") => `<fieldset class="mc-fs"><legend class="small muted">Contato com a pessoa</legend>${Object.entries(CONSENT).map(([k, l]) => `<label class="mc-radio"><input type="radio" name="${name}" value="${k}" ${k === cur ? "checked" : ""}> ${l}</label>`).join("")}<span class="tiny muted">Sem autorização, ninguém deve entrar em contato. “Não informado” nunca vale como autorização.</span></fieldset>`;
const stTag = (d) => d.awaiting_link ? `<span class="ptag st-pending">Aguardando associação</span>` : `<span class="ptag st-${d.fu_status === "declined" || d.fu_status === "ended" ? "refused" : d.fu_status === "in_progress" ? "approved" : "pending"}">${STATUS[d.fu_status]}</span>`;

// ------------------------------------------------------------------ painel
let F = { q: "", from: "", to: "", origin: "", place: "", status: "", consent: "", responsible: "", no_contact: false };
async function panel(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("heart", "Entre em uma igreja para ver os novos convertidos."); return; }
  el.innerHTML = spinner();
  let offset = 0, items = [], meta = null;
  const load = async (more = false) => {
    const p = { ...F, no_contact: F.no_contact || undefined, limit: 30, offset: more ? offset : 0 };
    Object.keys(p).forEach((k) => (p[k] === "" || p[k] === undefined) && delete p[k]);
    const r = await sb.rpc("convert_list", { p_org: org, p });
    if (!alive()) return null;
    if (r.error) return r;
    meta = r.data; items = more ? items.concat(r.data.items) : r.data.items; offset = items.length;
    return r;
  };
  const r0 = await load();
  if (!r0) return;
  if (r0.error) { el.innerHTML = `<div class="pagehead"><h1>Novos convertidos</h1></div>${missing(r0.error) ? SETUP : empty("lock", /forbidden/.test(r0.error.message) ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(r0.error)))}`; return; }
  let ind = null;
  const loadInd = async () => { if (!meta.can_indicators) return; const r = await sb.rpc("convert_indicators", { p_org: org, p_from: F.from || null, p_to: F.to || null }); ind = r.error ? null : r.data; };
  await loadInd();
  const filtered = () => !!(F.from || F.to || F.origin || F.place || F.status || F.consent || F.responsible || F.no_contact);
  const paintList = () => {
    el.querySelector("#list").innerHTML = items.map((d) => `<a class="li" href="#/novos-convertidos/${d.id}">${avatar({ display_name: d.name, avatar_url: d.photo_url }, 40, false)}<span class="grow"><span class="t ellipsis">${esc(d.name)}${d.highlight ? ` <span class="ptag member">Novo</span>` : ""}</span><span class="s ellipsis">${br(d.decided_on)} · ${esc(d.origin_label)}${d.place ? ` · ${esc(d.place)}` : ""}</span><span class="s ellipsis">${stTag(d)}${d.responsible_name ? ` · ${esc(d.responsible_name)}` : ""} · ${d.consent === "authorized" ? "Contato autorizado" : d.consent === "declined" ? "Sem contato" : "Contato não informado"}</span></span>${icon("chevronRight", "chev")}</a>`).join("")
      || empty("heart", filtered() || F.q ? "Nenhuma decisão com esses filtros." : "Nenhuma decisão registrada ainda.", meta.can_register && !filtered() && !F.q ? `<button class="btn primary sm" data-new>Registrar decisão</button>` : "");
    el.querySelector("#count").textContent = `${meta.total} ${meta.total === 1 ? "decisão" : "decisões"}`;
    el.querySelector("#more").hidden = items.length >= meta.total;
  };
  const bars = () => {
    if (!ind) return "";
    const max = Math.max(1, ...ind.by_origin.map((x) => x.n));
    const months = ind.by_month.slice(-6);
    return `<div class="mc-tiles"><div class="mc-tile"><b>${ind.total}</b><span>${F.from || F.to ? "no período" : "decisões"}</span></div><div class="mc-tile"><b>${ind.people}</b><span>pessoas com ficha</span></div><div class="mc-tile"><b>${ind.awaiting_link}</b><span>aguardando associação</span></div><div class="mc-tile"><b>${ind.followup_accepted}</b><span>aceitaram acompanhamento</span></div></div>
      ${ind.by_origin.length ? `<details class="card mt"><summary class="small"><b>Por origem e por mês</b></summary><div class="mt">${ind.by_origin.map((x) => `<div class="small row between"><span>${esc(x.label)}</span><b>${x.n}</b></div><div class="bar mb"><i style="width:${Math.round((x.n / max) * 100)}%"></i></div>`).join("")}
      ${months.length ? `<div class="small muted mt">Últimos meses</div>${months.map((m) => `<div class="small row between"><span>${m.month.split("-").reverse().join("/")}</span><b>${m.n}</b></div>`).join("")}` : ""}</div></details>` : ""}`;
  };
  el.innerHTML = `<div class="pagehead"><h1>Novos convertidos</h1></div>
    <div class="row gap-s mb">${meta.can_register ? `<button class="btn primary sm" data-new>${icon("plus")} Registrar decisão</button>` : ""}${meta.can_admin ? `<button class="btn ghost sm" id="cfg">${icon("settings")} Configurações</button>` : ""}</div>
    <p class="tiny muted">${meta.scope === "mine" ? "Você vê as decisões em que é responsável pelo acompanhamento. " : ""}A decisão de fé é um acontecimento da trajetória: não muda a classificação nem cria vínculo com times.</p>
    <div id="ind">${bars()}</div>
    <label class="psearch mt">${icon("search")}<input id="q" type="search" placeholder="Buscar por nome" value="${attr(F.q)}" autocomplete="off"></label>
    <div class="row between mb"><span class="small muted" id="count"></span><button class="btn ghost sm" id="flt">Filtros${filtered() ? " (ativos)" : ""}</button></div>
    <div class="list" id="list"></div><button class="btn ghost block mt" id="more" hidden>Carregar mais</button>`;
  paintList();
  const refresh = async () => { await load(); await loadInd(); if (!alive()) return; el.querySelector("#ind").innerHTML = bars(); el.querySelector("#flt").textContent = `Filtros${filtered() ? " (ativos)" : ""}`; paintList(); };
  let t; el.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value.trim(); refresh(); }, 300); });
  el.querySelector("#more").onclick = async () => { await load(true); paintList(); };
  el.addEventListener("click", (e) => { if (e.target.closest("[data-new]")) registerSheet(org, () => refresh()); });
  el.querySelector("#cfg")?.addEventListener("click", () => settingsSheet(org));
  el.querySelector("#flt").onclick = async () => {
    const resp = await sb.rpc("convert_responsibles", { p_org: org });
    const s = sheet(`<h3>Filtros</h3><form id="f" novalidate><div class="row gap"><label class="field grow"><span>De</span><input type="date" name="from" value="${attr(F.from)}"></label><label class="field grow"><span>Até</span><input type="date" name="to" value="${attr(F.to)}"></label></div>
      <label class="field"><span>Origem</span><select name="origin"><option value="">Todas</option>${opt(ORIGINS, F.origin)}</select></label>
      <label class="field"><span>Local ou contexto</span><input name="place" value="${attr(F.place)}" maxlength="120"></label>
      <label class="field"><span>Situação</span><select name="status"><option value="">Todas</option><option value="awaiting" ${F.status === "awaiting" ? "selected" : ""}>Aguardando associação</option>${opt(Object.entries(STATUS), F.status)}</select></label>
      <label class="field"><span>Contato</span><select name="consent"><option value="">Todos</option>${opt(Object.entries(CONSENT), F.consent)}</select></label>
      <label class="field"><span>Responsável</span><select name="responsible"><option value="">Todos</option>${(resp.data || []).map((u) => `<option value="${u.user_id}" ${F.responsible === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="mc-radio"><input type="checkbox" name="no_contact" ${F.no_contact ? "checked" : ""}> Só quem não deixou telefone nem e-mail</label>
      <div class="row gap mt"><button type="button" class="btn ghost grow" id="clr">Limpar</button><button class="btn primary grow" id="ok">Aplicar</button></div></form>`);
    const form = s.el.querySelector("#f");
    s.el.querySelector("#clr").onclick = () => { F = { ...F, from: "", to: "", origin: "", place: "", status: "", consent: "", responsible: "", no_contact: false }; s.close(); refresh(); };
    form.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(form).entries()); F = { ...F, from: d.from || "", to: d.to || "", origin: d.origin || "", place: (d.place || "").trim(), status: d.status || "", consent: d.consent || "", responsible: d.responsible || "", no_contact: !!d.no_contact }; s.close(); refresh(); };
  };
}

// ------------------------------------------------------------------ registrar decisão (administrativo)
function registerSheet(org, done) {
  let mode = "await", pid = null, cands = [];
  const s = sheet(`<h3>Registrar decisão de fé</h3><form id="f" novalidate>
    <label class="field"><span>Nome *</span><input name="name" maxlength="160" required autocomplete="off"></label>
    <div class="row gap"><label class="field grow"><span>Data *</span><input type="date" name="decided_on" value="${today()}" max="${today()}"></label><label class="field grow"><span>Horário (opcional)</span><input type="time" name="time"></label></div>
    <label class="field"><span>Local ou contexto</span><input name="place" maxlength="120" placeholder="Ex.: Culto de domingo, célula do João"></label>
    <label class="field"><span>Origem *</span><select name="origin">${opt(ORIGINS, "culto")}</select></label>
    <div class="row gap"><label class="field grow"><span>Telefone (opcional)</span><input name="phone" type="tel" maxlength="30"></label><label class="field grow"><span>E-mail (opcional)</span><input name="email" type="email" maxlength="200"></label></div>
    ${consentRadios("unknown")}
    <label class="field mt"><span>Observação administrativa (opcional)</span><textarea name="note" maxlength="500" rows="2" placeholder="Evite informações sensíveis ou avaliações espirituais"></textarea></label>
    <div class="card mt"><b class="small">Ficha da pessoa</b><p class="tiny muted">Nada é associado automaticamente. Procure e escolha a ficha certa, crie uma nova ou deixe aguardando.</p>
      <button type="button" class="btn ghost sm" id="find">${icon("search")} Procurar ficha</button><div id="cands" class="mt"></div></div>
    <button class="btn primary block mt" id="ok">Registrar</button></form>`, { wide: true });
  const form = s.el.querySelector("#f");
  const read = () => { const d = Object.fromEntries(new FormData(form).entries()); return { name: (d.name || "").trim(), decided_on: d.decided_on, time: d.time || null, place: d.place || null, origin: d.origin, phone: d.phone || null, email: d.email || null, consent: d.consent || "unknown", note: d.note || null }; };
  const paintC = () => {
    s.el.querySelector("#cands").innerHTML = `${cands.map((c) => `<label class="mc-radio"><input type="radio" name="pick" value="${c.id}" ${mode === "link" && pid === c.id ? "checked" : ""}> <b>${esc(c.full_name)}</b> <span class="muted small">· ${esc(CLASS_LABEL[c.classification] || "")} · ${esc(c.reason)}${c.has_account ? " · tem conta" : ""}</span></label>`).join("")}
      <label class="mc-radio"><input type="radio" name="pick" value="create" ${mode === "create" ? "checked" : ""}> Criar uma nova ficha (sem classificação)</label>
      <label class="mc-radio"><input type="radio" name="pick" value="await" ${mode === "await" ? "checked" : ""}> Deixar aguardando associação</label>`;
    s.el.querySelectorAll("[name=pick]").forEach((r) => r.addEventListener("change", () => { if (r.value === "create" || r.value === "await") { mode = r.value; pid = null; } else { mode = "link"; pid = r.value; } }));
  };
  paintC();
  s.el.querySelector("#find").onclick = async () => {
    const d = read(); if (!d.name) return toast("Escreva o nome primeiro.");
    const r = await sb.rpc("convert_candidates", { p_org: org, p_name: d.name, p_phone: d.phone, p_email: d.email });
    if (r.error) return toast(errText(r.error));
    cands = r.data || []; if (!cands.length) toast("Nenhuma ficha parecida encontrada."); paintC();
  };
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = s.el.querySelector("#ok"); const d = read();
    if (!d.name) return toast("Informe o nome.");
    busy(btn);
    try {
      const key = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
      let r = await sb.rpc("convert_register", { p_org: org, p: { ...d, mode, person_id: pid, key }, p_force: false });
      if (r.error) return toast(errText(r.error));
      if (r.data && r.data.saved === false) {
        const names = (r.data.candidates || []).map((c) => c.full_name).join(", ");
        if (!(await confirmDialog(`Já existe cadastro parecido (${names}). Use “Procurar ficha” para escolher o correto, ou crie uma nova ficha mesmo assim?`, "Criar nova ficha"))) { cands = r.data.candidates || cands; paintC(); return; }
        r = await sb.rpc("convert_register", { p_org: org, p: { ...d, mode, person_id: pid, key }, p_force: true });
        if (r.error) return toast(errText(r.error));
      }
      toast("Decisão registrada"); s.close(); done?.(r.data);
    } finally { busy(btn, false); }
  };
}

// ------------------------------------------------------------------ detalhe (ficha do convertido)
async function detail(el, alive, id) {
  el.innerHTML = spinner();
  const r = await sb.rpc("convert_get", { p_id: id });
  if (!alive()) return;
  const back = `<a class="btn ghost sm" href="#/novos-convertidos">${icon("chevronLeft")} Novos convertidos</a>`;
  if (r.error) { el.innerHTML = `${back}${missing(r.error) ? SETUP : empty("lock", /forbidden|not_found/.test(r.error.message) ? "Você não tem acesso a esta decisão." : "Não foi possível carregar.", esc(errText(r.error)))}`; return; }
  const jr = await sb.rpc("convert_journeys", { p_decision: id }); const J = jr.error ? null : jr.data;
  const d = r.data, p = d.person, kv = (k, v) => `<div class="mc-kv"><span class="mc-k">${k}</span><span class="mc-v">${v || "—"}</span></div>`;
  const contact = d.consent !== "authorized" ? (d.has_contact ? "Informado, mas sem autorização para uso" : "Não informado") : [d.phone, d.email].filter(Boolean).map(esc).join(" · ") || "Não informado";
  const act = (a, l, cls = "ghost") => `<button class="btn ${cls} sm" data-fu="${a}">${l}</button>`;
  el.innerHTML = `<div class="mb">${back}</div>
    <section class="card"><div class="row gap">${avatar({ display_name: d.name, avatar_url: p?.photo_url }, 56, false)}<div class="grow"><b>${esc(d.name)}</b><div class="small muted">Decisão em ${br(d.decided_on)}${d.time ? ` às ${d.time}` : ""}</div><div class="mt">${stTag(d)}</div></div></div>
      ${d.others ? `<div class="mc-note mt">${icon("clock")} Esta pessoa tem outras ${d.others} ${d.others === 1 ? "decisão registrada" : "decisões registradas"}. Todas são preservadas.</div>` : ""}</section>
    <h3 class="mt">Decisão</h3><div class="card">${kv("Data", br(d.decided_on))}${kv("Local ou contexto", esc(d.place || ""))}${kv("Origem", esc(d.origin_label))}${kv("Registrada por", esc(d.registered_by || (d.source === "public_form" ? "Formulário público" : "A própria pessoa")))}${kv("Observação", esc(d.admin_note || ""))}</div>
    <h3 class="mt">Contato</h3><div class="card">${kv("Autorização", CONSENT[d.consent])}${kv("Contato", contact)}<p class="tiny muted mt">Só entre em contato se a pessoa autorizou. Dados de contato não autorizados ficam ocultos.</p></div>
    <h3 class="mt">Ficha</h3><div class="card">${p ? `<div class="row gap">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 40, false)}<div class="grow"><b>${esc(p.full_name)}</b><div class="small muted">${esc(CLASS_LABEL[p.classification] || "")}${p.has_account ? " · tem conta no app" : " · sem conta no app"}</div></div>${p.can_open ? `<a class="btn ghost sm" href="#/pessoas/${p.id}">Abrir ficha</a>` : ""}</div>`
      : `<div class="mc-note">${icon("clock")} Aguardando associação a uma ficha. Nenhuma ficha é criada ou escolhida sozinha.</div>${d.can_link ? `<button class="btn primary block mt" id="link">Associar à ficha</button>` : ""}`}</div>
    <div class="row between mt"><h3>Acompanhamento</h3></div>
    <div class="card"><div class="small">${esc(STATUS[d.fu_status])}${d.wants_followup === true ? " · a pessoa pediu acompanhamento" : ""}</div>
      ${kv("Responsável", d.responsible_name ? esc(d.responsible_name) + (d.assigned_at ? ` <span class="tiny muted">desde ${new Date(d.assigned_at).toLocaleDateString("pt-BR")}</span>` : "") : "")}
      ${d.can_assign ? `<button class="btn ghost sm mt" id="assign">${d.responsible_id ? "Trocar responsável" : "Designar responsável"}</button>` : ""}
      ${d.can_followup ? `<div class="row gap-s mt" style="flex-wrap:wrap">${d.fu_status === "registered" || d.fu_status === "declined" ? act("offer", "Oferecer acompanhamento") : ""}${["registered", "offered", "suspended", "ended", "declined"].includes(d.fu_status) ? act("start", d.fu_status === "suspended" || d.fu_status === "ended" ? "Retomar" : "Iniciar", "primary") : ""}${d.fu_status === "in_progress" ? act("suspend", "Suspender") : ""}${["in_progress", "suspended", "offered"].includes(d.fu_status) ? act("end", "Encerrar") : ""}${d.fu_status !== "declined" ? act("decline", "Não deseja acompanhamento") : ""}</div>
      <p class="tiny muted mt">Sem etapas, prazos ou metas. Encerrar ou suspender nunca apaga a decisão.</p>` : ""}</div>
    ${J && (J.participations.length || (J.can_offer && J.offerable.length)) ? `<h3 class="mt">Jornada</h3><div class="card">${J.participations.map((x) => `<a class="li" href="#/jornadas/${x.id}"><span class="grow"><span class="t">${esc(x.name)}</span><span class="s">${({ waiting: "Convite enviado, aguardando resposta", active: "Em andamento", paused: "Pausada", completed: "Concluída", cancelled: x.cancel_reason === "declined" ? "Convite recusado" : "Encerrada" })[x.status]}${["active", "paused", "completed"].includes(x.status) ? " · " + x.pct + "%" : ""}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}${J.can_offer && J.offerable.length ? `<label class="field mt"><span>Oferecer uma jornada</span><select id="joff"><option value="">Escolher</option>${J.offerable.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></label><button class="btn ghost sm" id="joffgo">Enviar convite</button>` : ""}<p class="tiny muted mt">A pessoa decide se aceita. Recusar ou parar não altera a decisão de fé nem o cadastro.</p></div>` : ""}
    <div class="row between mt"><h3>Registros</h3>${d.can_followup ? `<button class="btn primary sm" id="entry">${icon("plus")} Registrar</button>` : ""}</div>
    <div class="list">${d.entries.map((e) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${ENTRY[e.kind]}</b>${e.channel ? ` · ${CHANNEL[e.channel]}` : ""} · ${br(e.occurred_on)} · <span class="muted">${esc(e.by)}</span></span><span class="small" style="white-space:pre-wrap">${esc(e.body)}</span></div>`).join("") || `<div class="li muted small">Nenhum registro de acompanhamento.</div>`}</div>
    ${d.can_edit || d.can_void ? `<div class="row gap-s mt">${d.can_edit ? `<button class="btn ghost sm" id="edit">${icon("edit")} Corrigir informações</button>` : ""}${d.can_void ? `<button class="btn ghost sm" id="void">Anular registro</button>` : ""}</div>` : ""}
    ${d.log.length ? `<details class="card mt"><summary class="small"><b>Auditoria</b></summary><div class="mt">${d.log.map((l) => `<div class="small" style="padding:3px 0">${new Date(l.at).toLocaleString("pt-BR")} · ${esc(LOG[l.action] || l.action)} · <span class="muted">${esc(l.by)}</span>${l.detail?.reason ? ` · ${esc(l.detail.reason)}` : ""}</div>`).join("")}</div></details>` : ""}`;
  const again = () => detail(el, alive, id);
  el.querySelector("#joffgo")?.addEventListener("click", async (e) => { const v = el.querySelector("#joff").value; if (!v) return toast("Escolha uma jornada."); const b = e.currentTarget; busy(b); try { const x = await sb.rpc("journey_offer", { p_decision: id, p_journey: v }); if (x.error) return toast(errText(x.error)); toast("Convite enviado"); again(); } finally { busy(b, false); } });
  el.querySelectorAll("[data-fu]").forEach((b) => b.addEventListener("click", async () => { busy(b); const rr = await sb.rpc("convert_followup_status", { p_id: id, p_action: b.dataset.fu, p_note: null }); busy(b, false); if (rr.error) return toast(errText(rr.error)); toast("Situação atualizada"); again(); }));
  el.querySelector("#assign")?.addEventListener("click", async () => {
    const rr = await sb.rpc("convert_responsibles", { p_org: d.org_id }); const list = rr.data || [];
    const s = sheet(`<h3>Responsável pelo acompanhamento</h3><p class="small muted">Só aparecem pessoas autorizadas a acompanhar.</p><label class="field"><span>Responsável</span><select id="u"><option value="">Sem responsável</option>${list.map((u) => `<option value="${u.user_id}" ${u.user_id === d.responsible_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const b = e.currentTarget; busy(b); try { const x = await sb.rpc("convert_assign", { p_id: id, p_user: s.el.querySelector("#u").value || null }); if (x.error) return toast(errText(x.error)); toast("Responsável salvo"); s.close(); again(); } finally { busy(b, false); } };
  });
  el.querySelector("#entry")?.addEventListener("click", () => {
    const s = sheet(`<h3>Registrar acompanhamento</h3><form id="f" novalidate><label class="field"><span>Tipo</span><select name="kind"><option value="note">Anotação</option><option value="contact">Contato feito</option><option value="interest">Interesse em atividades</option><option value="referral">Encaminhamento (estudo, célula)</option></select></label>
      <div id="ch" hidden><label class="field"><span>Canal</span><select name="channel">${opt(Object.entries(CHANNEL), "whatsapp")}</select></label>${d.consent !== "authorized" ? `<div class="mc-note">${icon("lock")} A pessoa não autorizou contato: este tipo será recusado.</div>` : ""}</div>
      <label class="field"><span>Data</span><input type="date" name="on" value="${today()}" min="${d.decided_on}" max="${today()}"></label>
      <label class="field"><span>Texto *</span><textarea name="body" rows="3" maxlength="1000" placeholder="Registre só o necessário. Sem avaliação espiritual."></textarea></label><button class="btn primary block" id="ok">Salvar</button></form>`);
    const f = s.el.querySelector("#f"); f.kind.onchange = () => (s.el.querySelector("#ch").hidden = f.kind.value !== "contact");
    f.onsubmit = async (e) => { e.preventDefault(); const b = s.el.querySelector("#ok"); busy(b); try { const x = await sb.rpc("convert_entry_add", { p_id: id, p_kind: f.kind.value, p_body: f.body.value, p_on: f.on.value || null, p_channel: f.kind.value === "contact" ? f.channel.value : null }); if (x.error) return toast(errText(x.error)); toast("Registro salvo"); s.close(); again(); } finally { busy(b, false); } };
  });
  el.querySelector("#link")?.addEventListener("click", async () => {
    const c = await sb.rpc("convert_candidates", { p_org: d.org_id, p_name: d.name, p_phone: d.has_contact && d.consent === "authorized" ? d.phone : null, p_email: d.has_contact && d.consent === "authorized" ? d.email : null });
    const cands = c.data || []; let pick = null;
    const s = sheet(`<h3>Associar à ficha</h3><p class="small muted">Escolha a ficha da pessoa. Nada é associado por nome parecido.</p><div id="c">${cands.map((x) => `<label class="mc-radio"><input type="radio" name="pk" value="${x.id}"> <b>${esc(x.full_name)}</b> <span class="muted small">· ${esc(CLASS_LABEL[x.classification] || "")} · ${esc(x.reason)}</span></label>`).join("") || `<div class="small muted">Nenhuma ficha parecida.</div>`}
      <label class="mc-radio"><input type="radio" name="pk" value="create"> Criar uma nova ficha (sem classificação)</label></div><button class="btn primary block mt" id="ok" disabled>Associar</button>`);
    s.el.querySelectorAll("[name=pk]").forEach((x) => x.addEventListener("change", () => { pick = x.value; s.el.querySelector("#ok").disabled = false; }));
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; busy(b);
      try {
        const make = (force) => sb.rpc("convert_link", { p_id: id, p_person: pick === "create" ? null : pick, p_create: pick === "create", p_force: force });
        let x = await make(false);
        if (!x.error && x.data?.saved === false) { if (!(await confirmDialog("Existem fichas parecidas. Criar uma nova mesmo assim?", "Criar nova ficha"))) return; x = await make(true); }
        if (x.error) return toast(errText(x.error));
        toast("Decisão associada"); s.close(); again();
      } finally { busy(b, false); }
    };
  });
  el.querySelector("#edit")?.addEventListener("click", () => {
    const s = sheet(`<h3>Corrigir informações</h3><form id="f" novalidate><label class="field"><span>Nome</span><input name="name" value="${attr(d.name)}" maxlength="160"></label>
      <div class="row gap"><label class="field grow"><span>Data</span><input type="date" name="decided_on" value="${d.decided_on}" max="${today()}"></label><label class="field grow"><span>Horário</span><input type="time" name="time" value="${attr(d.time || "")}"></label></div>
      <label class="field"><span>Local ou contexto</span><input name="place" value="${attr(d.place || "")}" maxlength="120"></label><label class="field"><span>Origem</span><select name="origin">${opt(ORIGINS, d.origin)}</select></label>
      <div class="row gap"><label class="field grow"><span>Telefone</span><input name="phone" type="tel" value="${attr(d.phone || "")}" ${d.consent === "authorized" ? "" : "disabled"}></label><label class="field grow"><span>E-mail</span><input name="email" type="email" value="${attr(d.email || "")}" ${d.consent === "authorized" ? "" : "disabled"}></label></div>
      ${consentRadios(d.consent)}<label class="field mt"><span>Observação</span><textarea name="note" maxlength="500" rows="2">${esc(d.admin_note || "")}</textarea></label>
      <label class="field"><span>Motivo (obrigatório se mudar nome ou data)</span><input name="reason" maxlength="300"></label><button class="btn primary block" id="ok">Salvar correção</button></form>`, { wide: true });
    const f = s.el.querySelector("#f");
    f.onsubmit = async (e) => {
      e.preventDefault(); const b = s.el.querySelector("#ok"); busy(b);
      try {
        const q = { name: f.name.value.trim(), decided_on: f.decided_on.value, time: f.time.value || null, place: f.place.value || null, origin: f.origin.value, consent: f.consent.value, note: f.note.value || null };
        if (!f.phone.disabled) { q.phone = f.phone.value || null; q.email = f.email.value || null; }
        const x = await sb.rpc("convert_update", { p_id: id, p: q, p_reason: f.reason.value || null });
        if (x.error) return toast(errText(x.error));
        toast(x.data?.changed ? "Correção salva" : "Nada mudou"); s.close(); again();
      } finally { busy(b, false); }
    };
  });
  el.querySelector("#void")?.addEventListener("click", () => {
    const s = sheet(`<h3>Anular registro</h3><p class="small muted">Prefira corrigir as informações. A anulação some das listas e indicadores, mas fica na auditoria com o motivo.</p><label class="field"><span>Motivo *</span><input id="rs" maxlength="500"></label><button class="btn danger block" id="ok">Anular registro</button>`);
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; const reason = s.el.querySelector("#rs").value.trim();
      if (reason.length < 5) return toast("Explique o motivo (mínimo 5 letras).");
      if (!(await confirmDialog("Anular este registro? Ele sai das listas e dos indicadores.", "Anular", true))) return;
      busy(b); try { const x = await sb.rpc("convert_void", { p_id: id, p_reason: reason }); if (x.error) return toast(errText(x.error)); toast("Registro anulado"); s.close(); location.hash = "#/novos-convertidos"; } finally { busy(b, false); }
    };
  });
}

// ------------------------------------------------------------------ configurações
async function settingsSheet(org) {
  const r = await sb.rpc("convert_settings_get", { p_org: org });
  if (r.error) return toast(errText(r.error));
  let c = r.data;
  const url = () => `${location.origin}${location.pathname.replace(/index\.html$/, "")}#/decidi/${c.form_token}`;
  const s = sheet(`<h3>Configurações</h3><div id="b"></div>`, { wide: true });
  const paint = () => {
    s.el.querySelector("#b").innerHTML = `<div class="card"><b>Formulário por link</b><p class="tiny muted">Qualquer pessoa com o link pode registrar a própria decisão, sem login. O registro entra “aguardando associação” e nada é vinculado sozinho.</p>
      <label class="mc-radio"><input type="checkbox" id="act" ${c.form_active ? "checked" : ""}> Receber decisões por este link</label>
      <label class="field mt"><span>Título</span><input id="ti" maxlength="120" value="${attr(c.form_title)}"></label>
      ${c.form_active ? `<div class="mc-note">${esc(url())}</div><div class="row gap-s mt"><button class="btn ghost sm" id="copy">Copiar link</button><button class="btn ghost sm" id="rot">Gerar novo link</button></div>` : ""}</div>
      <div class="card mt"><b>Destaque de “Novo”</b><p class="tiny muted">Opcional. Só marca visualmente; ninguém sai da lista pelo tempo.</p><label class="field"><span>Dias em destaque (vazio = sem destaque)</span><input id="hl" type="number" min="1" max="365" value="${c.highlight_days ?? ""}"></label></div>
      <button class="btn primary block mt" id="ok">Salvar</button>`;
    s.el.querySelector("#copy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(url()); toast("Link copiado"); } catch { toast(url()); } });
    s.el.querySelector("#rot")?.addEventListener("click", async () => { if (!(await confirmDialog("O link antigo deixa de funcionar. Gerar um novo?", "Gerar novo link"))) return; const x = await sb.rpc("convert_settings_save", { p_org: org, p: { rotate: true } }); if (x.error) return toast(errText(x.error)); c = x.data; toast("Novo link gerado"); paint(); });
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; busy(b);
      try { const x = await sb.rpc("convert_settings_save", { p_org: org, p: { form_active: s.el.querySelector("#act").checked, form_title: s.el.querySelector("#ti").value, highlight_days: s.el.querySelector("#hl").value || null } }); if (x.error) return toast(errText(x.error)); c = x.data; toast("Configurações salvas"); paint(); } finally { busy(b, false); }
    };
  };
  paint();
}

// ------------------------------------------------------------------ formulário dentro do app (qualquer integrante, uma decisão própria)
async function selfForm(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("heart", "Entre em uma igreja."); return; }
  el.innerHTML = spinner();
  const r = await sb.rpc("convert_self_get", { p_org: org });
  if (!alive()) return;
  if (r.error) { el.innerHTML = `<div class="pagehead"><h1>Decidi seguir a Jesus</h1></div>${missing(r.error) ? SETUP : empty("alert", errText(r.error))}`; return; }
  const me = r.data;
  el.innerHTML = `<div class="pagehead"><h1>Decidi seguir a Jesus</h1></div>
    <p class="small muted">Conte para a igreja. Só preencha o que quiser: telefone e e-mail são opcionais e só serão usados se você autorizar.</p>
    <form id="f" class="card" novalidate>
      ${me.person ? `<div class="mc-note mb">${icon("user")} Vamos registrar em nome de <b>${esc(me.person.full_name)}</b>. <label class="mc-radio"><input type="checkbox" name="confirm_identity"> Sim, este sou eu</label></div>` : `<label class="field"><span>Seu nome *</span><input name="name" value="${attr(me.name || "")}" maxlength="160"></label><p class="tiny muted">Você ainda não tem ficha: a igreja vai associar o seu registro à ficha certa.</p>`}
      <div class="row gap"><label class="field grow"><span>Data</span><input type="date" name="decided_on" value="${today()}" max="${today()}"></label><label class="field grow"><span>Onde foi</span><select name="origin">${opt(SELF_ORIGINS, "culto")}</select></label></div>
      <label class="field"><span>Local (opcional)</span><input name="place" maxlength="120"></label>
      <div class="row gap"><label class="field grow"><span>Telefone (opcional)</span><input name="phone" type="tel" maxlength="30"></label><label class="field grow"><span>E-mail (opcional)</span><input name="email" type="email" maxlength="200"></label></div>
      ${consentRadios("unknown")}
      <label class="mc-radio mt"><input type="checkbox" name="wants_followup"> Gostaria de ser acompanhado(a) por alguém da igreja</label>
      <button class="btn primary block mt" id="ok">Enviar</button></form>`;
  const f = el.querySelector("#f");
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = el.querySelector("#ok");
    if (me.person && !f.confirm_identity.checked) return toast("Confirme que este é o seu cadastro.");
    busy(b);
    try {
      const x = await sb.rpc("convert_self_submit", { p_org: org, p: { name: f.name?.value, decided_on: f.decided_on.value, origin: f.origin.value, place: f.place.value || null, phone: f.phone.value || null, email: f.email.value || null, consent: f.consent.value, wants_followup: f.wants_followup.checked, confirm_identity: !!me.person } });
      if (x.error) return toast(errText(x.error));
      el.innerHTML = `<div class="pagehead"><h1>Recebemos o seu registro</h1></div><section class="card"><p>Que alegria! A igreja foi avisada e ${f.consent.value === "authorized" ? "poderá falar com você" : "só falará com você se você autorizar"}.</p><a class="btn primary block mt" href="#/">Voltar ao início</a></section>`;
    } finally { busy(b, false); }
  };
}

// ------------------------------------------------------------------ formulário público por link (sem login)
async function publicForm(token) {
  const root = document.getElementById("app");
  const shell = (inner) => `<div class="backdrop"></div><div class="auth"><div class="box">${inner}</div></div>`;
  root.innerHTML = shell(spinner());
  const r = await sb.rpc("convert_public_get", { p_token: token });
  const c = r.data;
  if (!c) { root.innerHTML = shell(`<h1>Formulário indisponível</h1><p class="sub">Este link não está recebendo registros. Peça um novo link à igreja.</p>`); return; }
  root.innerHTML = shell(`<div class="logo">${c.logo_url ? `<img src="${attr(c.logo_url)}" alt="${attr(c.org_name)}" style="max-height:64px">` : ""}</div><h1>${esc(c.title)}</h1><p class="sub">${esc(c.org_name)}${c.org_subtitle ? ` · ${esc(c.org_subtitle)}` : ""}</p>
    <form id="f" novalidate><label class="field"><span>Seu nome *</span><input name="name" maxlength="160" autocomplete="name"></label>
      <div class="row gap"><label class="field grow"><span>Data</span><input type="date" name="decided_on" value="${today()}" max="${today()}"></label><label class="field grow"><span>Onde foi</span><select name="origin">${opt(SELF_ORIGINS, "transmissao")}</select></label></div>
      <label class="field"><span>Local (opcional)</span><input name="place" maxlength="120"></label>
      <label class="field"><span>Telefone (opcional)</span><input name="phone" type="tel" maxlength="30"></label><label class="field"><span>E-mail (opcional)</span><input name="email" type="email" maxlength="200"></label>
      ${consentRadios("unknown")}
      <label class="mc-radio"><input type="checkbox" name="wants_followup"> Gostaria de ser acompanhado(a) por alguém da igreja</label>
      <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0">
      <p class="tiny muted">Seus dados ficam protegidos e só a equipe autorizada da igreja os vê. Telefone e e-mail são opcionais.</p>
      <button class="btn primary block" id="ok">Enviar</button></form>`);
  const f = root.querySelector("#f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    if (!String(d.name || "").trim()) return toast("Informe o seu nome.");
    const b = root.querySelector("#ok"); busy(b);
    try {
      const x = await sb.rpc("convert_public_submit", { p_token: token, p: { ...d, wants_followup: !!d.wants_followup } });
      if (x.error) return toast(errText(x.error));
      root.innerHTML = shell(`<h1>Recebemos o seu registro</h1><p class="sub">Que alegria! A igreja foi avisada.</p>`);
    } finally { busy(b, false); }
  };
}
