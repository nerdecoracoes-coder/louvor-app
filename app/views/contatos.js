// Solicitações de contato: formulário acolhedor (SOMOS Um e link público), central de atendimento (SOMOS Chamados) e configuração de categorias.
// A solicitação não é atendimento pastoral. Tudo é conferido no servidor; aqui só se desenha.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog } from "../core.js";
import { errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/contato", (p, el, a) => selfForm(el, a));
  route("/contatos", (p, el, a) => central(el, a));
  route("/contatos/:id", (p, el, a) => detail(el, a, p.id));
  route("/contatos-config", (p, el, a) => config(el, a));
  route("/fale-conosco/:token", (p) => publicForm(p.token), { public: true, noOrg: true });
}

const STATUS = { received: "Recebida", review: "Em análise", forwarded: "Encaminhada", in_progress: "Em atendimento", waiting: "Aguardando retorno", completed: "Concluída", cancelled: "Cancelada" };
const PREF = { whatsapp: "WhatsApp", call: "Ligação telefônica", email: "E-mail", other: "Outro canal" };
const KINDS = { call: "Ligação realizada", message: "Mensagem enviada", in_person: "Conversa presencial", email: "E-mail enviado", attempt: "Tentativa de contato", reply: "Retorno recebido", other: "Outro tipo de interação" };
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-02-solicitacoes-contato.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const when = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const day = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
const tag = (s) => `<span class="ptag ${s === "completed" ? "attender" : s === "cancelled" ? "none" : s === "received" ? "member" : "st-pending"}">${STATUS[s] || s}</span>`;
const head = (t, back) => `<div class="pagehead"><h1>${esc(t)}</h1></div>${back ? `<div class="mb"><a class="btn ghost sm" href="${back[0]}">${icon("chevronLeft")} ${esc(back[1])}</a></div>` : ""}`;
const fail = (el, title, e, back) => { el.innerHTML = `${head(title, back)}${missing(e) ? SETUP : empty("lock", /forbidden|not_found/.test(e?.message || "") ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(e)))}`; };
const digits = (s) => String(s || "").replace(/\D/g, "");
const wa = (s) => { const d = digits(s); return d.length <= 11 ? "55" + d : d; };
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const opts = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("");

// ------------------------------------------------------------------ formulário (usado no app e no link público)
function formHtml(c, me) {
  const cats = c.categories;
  return `<form id="f" novalidate>
    <label class="field"><span>Nome *</span><input name="name" maxlength="160" autocomplete="name" value="${attr(me?.name || "")}"></label>
    <div class="row gap"><label class="field grow"><span>Telefone</span><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${attr(me?.phone || "")}"></label>
      <label class="field grow"><span>E-mail</span><input name="email" type="email" maxlength="200" autocomplete="email" value="${attr(me?.email || "")}"></label></div>
    <label class="field"><span>Assunto *</span><select name="category_id"><option value="">Escolha um assunto</option>${cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label>
    <label class="field"><span>Mensagem *</span><textarea name="message" rows="4" maxlength="2000" placeholder="Conte em poucas palavras como podemos ajudar"></textarea></label>
    <div class="field"><span>Como prefere receber o retorno?</span>
      ${[["whatsapp", "WhatsApp"], ["call", "Ligação telefônica"], ["email", "E-mail"], ...(c.other_channel ? [["other", c.other_channel]] : [])].map(([k, l], i) => `<label class="mc-radio"><input type="radio" name="pref" value="${k}" ${i === 0 ? "checked" : ""}> ${esc(l)}</label>`).join("")}
      ${c.other_channel ? `<input name="pref_other" maxlength="60" placeholder="Seu contato nesse canal" style="display:none">` : ""}</div>
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0">
    <label class="mc-radio mt"><input type="checkbox" name="consent"> ${esc(c.consent_text)}</label>
    <button class="btn primary block mt" id="ok">Enviar solicitação</button></form>`;
}
function wireForm(root, send) {
  const f = root.querySelector("#f"); let key = newKey(), busyNow = false;
  const other = f.querySelector("[name=pref_other]");
  f.querySelectorAll("[name=pref]").forEach((r) => r.addEventListener("change", () => { if (other) other.style.display = f.pref.value === "other" ? "" : "none"; }));
  f.onsubmit = async (e) => {
    e.preventDefault(); if (busyNow) return;
    const d = Object.fromEntries(new FormData(f).entries());
    if (!String(d.name || "").trim()) return toast("Informe o seu nome.");
    if (!String(d.phone || "").trim() && !String(d.email || "").trim() && !String(d.pref_other || "").trim()) return toast("Informe um telefone ou e-mail para recebermos o retorno.");
    if (!d.category_id) return toast("Escolha um assunto.");
    if (!String(d.message || "").trim()) return toast("Escreva a sua mensagem.");
    if (!f.consent.checked) return toast("Marque a autorização para podermos responder.");
    const b = root.querySelector("#ok"); busyNow = true; busy(b);
    try { const ok = await send({ ...d, consent: true, key }); if (!ok) busyNow = false; } finally { busy(b, false); }
  };
}
const THANKS = (code) => `<h2>Recebemos sua solicitação!</h2><p>Nossa equipe irá analisar seu pedido e entrará em contato pelo canal informado. Conte conosco.</p><p class="small muted">Código do pedido: <b>${esc(code)}</b></p>`;

async function selfForm(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("chat", "Entre em uma igreja para enviar uma solicitação."); return; }
  el.innerHTML = spinner();
  const [r, m] = await Promise.all([sb.rpc("contact_self_get", { p_org: org }), sb.rpc("contact_mine", { p_org: org })]);
  if (!alive()) return;
  if (r.error) return fail(el, "Como podemos ajudar você?", r.error);
  const c = r.data, mine = m.data || [];
  el.innerHTML = `${head("Como podemos ajudar você?")}${c.staff ? `<a class="btn ghost sm mb" href="#/contatos">${icon("inbox")} Central de solicitações</a>` : ""}
    <p class="small">${esc(c.intro)}</p><div class="card" id="box">${formHtml(c, c)}</div>
    ${mine.length ? `<h3 class="mt">Meus pedidos</h3><div class="list">${mine.map((x) => `<div class="li col" style="align-items:flex-start"><div class="row between" style="width:100%"><b class="small">${esc(x.category)}</b>${tag(x.status)}</div><span class="tiny muted">${esc(x.code)} · enviado em ${day(x.created_at)}${x.completed_at ? " · concluído em " + day(x.completed_at) : ""}</span></div>`).join("")}</div>` : ""}
    <p class="tiny muted mt">Usamos os seus dados só para responder a esta solicitação.</p>`;
  wireForm(el, async (d) => {
    const x = await sb.rpc("contact_submit", { p_org: org, p: d }); if (x.error) { toast(errText(x.error)); return false; }
    el.querySelector("#box").innerHTML = THANKS(x.data.code); el.querySelector("#box").scrollIntoView({ block: "center" }); return true;
  });
}
async function publicForm(token) {
  const root = document.getElementById("app");
  const shell = (inner) => `<div class="backdrop"></div><div class="auth"><div class="box">${inner}</div></div>`;
  root.innerHTML = shell(spinner());
  const r = await sb.rpc("contact_public_get", { p_token: token }); const c = r.data;
  if (!c) { root.innerHTML = shell(`<h1>Formulário indisponível</h1><p class="sub">Este link não está recebendo solicitações. Fale com a igreja por outro canal.</p>`); return; }
  root.innerHTML = shell(`<div class="logo">${c.logo_url ? `<img src="${attr(c.logo_url)}" alt="${attr(c.org_name)}" style="max-height:64px">` : ""}</div><h1>Como podemos ajudar você?</h1><p class="sub">${esc(c.org_name)}${c.org_subtitle ? ` · ${esc(c.org_subtitle)}` : ""}</p><p class="small">${esc(c.intro)}</p><div id="box">${formHtml(c, null)}</div>`);
  wireForm(root, async (d) => {
    const x = await sb.rpc("contact_public_submit", { p_token: token, p: d }); if (x.error) { toast(errText(x.error)); return false; }
    root.querySelector("#box").innerHTML = THANKS(x.data.code); return true;
  });
}

// ------------------------------------------------------------------ central (SOMOS Chamados)
const F = { q: "", category: "", status: "", responsible: "", from: "", to: "", order: "desc" };
async function central(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("inbox", "Entre em uma igreja."); return; }
  let offset = 0; const LIM = 25;
  el.innerHTML = spinner();
  const first = await sb.rpc("contact_list", { p_org: org, p: { ...clean(F), limit: LIM } });
  if (!alive()) return;
  if (first.error) return fail(el, "Solicitações de contato", first.error, ["#/chamados", "Chamados"]);
  const L = first.data;
  const resp = (await sb.rpc("contact_responsibles", { p_org: org })).data || { users: [] };
  const I = L.indicators, item = (x) => `<a class="li col" href="#/contatos/${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.name)}</b>${tag(x.status)}</div>
    <span class="small muted">${esc(x.category)}</span><span class="tiny muted">${esc(x.code)} · ${when(x.created_at)} · ${x.responsible_name ? esc(x.responsible_name) : "Sem responsável"}${x.team_name ? " · " + esc(x.team_name) : ""} · atualizada ${when(x.updated_at)}</span></a>`;
  el.innerHTML = `${head("Solicitações de contato", ["#/chamados", "Chamados"])}
    <div class="row gap-s mb" style="flex-wrap:wrap">${L.can_create ? `<button class="btn primary sm" id="new">${icon("plus")} Registrar pedido</button>` : ""}${L.can_categories ? `<a class="btn ghost sm" href="#/contatos-config">${icon("settings")} Categorias e textos</a>` : ""}</div>
    <div class="mc-tiles" id="ind">${[["total", "total"], ["received", "novas"], ["review", "em análise"], ["forwarded", "encaminhadas"], ["in_progress", "em atendimento"], ["waiting", "aguardando retorno"], ["completed", "concluídas"]].map(([k, l]) => `<div class="mc-tile"><b>${I[k]}</b><span>${l}</span></div>`).join("")}</div>
    ${!L.view_all ? `<p class="tiny muted">Você vê só as solicitações atribuídas a você.</p>` : ""}
    <label class="psearch mt">${icon("search")}<input id="q" type="search" placeholder="Buscar por nome ou código" value="${attr(F.q)}"></label>
    <div class="row gap-s mb"><button class="btn ghost sm" id="flt">Filtrar${hasFilter() ? " (ativo)" : ""}</button>${hasFilter() ? `<button class="btn ghost sm" id="clr">Limpar</button>` : ""}<button class="btn ghost sm" id="ord">${F.order === "desc" ? "Mais recentes primeiro" : "Mais antigas primeiro"}</button></div>
    <div class="list" id="list">${L.items.map(item).join("") || empty("inbox", hasFilter() || F.q ? "Nenhuma solicitação com esses filtros." : "Nenhuma solicitação recebida ainda.")}</div>
    <button class="btn ghost block mt" id="more" ${L.total > L.items.length ? "" : "hidden"}>Carregar mais</button>`;
  offset = L.items.length; const again = () => central(el, alive);
  let t; el.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value.trim(); again(); }, 350); });
  el.querySelector("#ord").onclick = () => { F.order = F.order === "desc" ? "asc" : "desc"; again(); };
  el.querySelector("#clr")?.addEventListener("click", () => { Object.assign(F, { category: "", status: "", responsible: "", from: "", to: "" }); again(); });
  el.querySelector("#more").onclick = async (e) => { const b = e.currentTarget; busy(b); try { const x = await sb.rpc("contact_list", { p_org: org, p: { ...clean(F), limit: LIM, offset } }); if (x.error) return toast(errText(x.error)); el.querySelector("#list").insertAdjacentHTML("beforeend", x.data.items.map(item).join("")); offset += x.data.items.length; if (offset >= x.data.total) b.hidden = true; } finally { busy(b, false); } };
  el.querySelector("#flt").onclick = () => {
    const s = sheet(`<h3>Filtrar solicitações</h3><label class="field"><span>Assunto</span><select name="category"><option value="">Todos</option>${L.categories.map((c) => `<option value="${c.id}" ${F.category === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Situação</span><select name="status"><option value="">Todas</option>${opts(Object.entries(STATUS), F.status)}</select></label>
      <label class="field"><span>Responsável</span><select name="responsible"><option value="">Todos</option><option value="none" ${F.responsible === "none" ? "selected" : ""}>Sem responsável</option><option value="me" ${F.responsible === "me" ? "selected" : ""}>Comigo</option>${resp.users.map((u) => `<option value="${u.user_id}" ${F.responsible === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <div class="row gap"><label class="field grow"><span>De</span><input type="date" name="from" value="${F.from}"></label><label class="field grow"><span>Até</span><input type="date" name="to" value="${F.to}"></label></div><button class="btn primary block" id="ok">Aplicar</button>`);
    s.el.querySelector("#ok").onclick = () => { for (const n of ["category", "status", "responsible", "from", "to"]) F[n] = s.el.querySelector(`[name=${n}]`).value; s.close(); again(); };
  };
  el.querySelector("#new")?.addEventListener("click", async () => {
    const c = (await sb.rpc("contact_self_get", { p_org: org })).data; if (!c) return;
    const s = sheet(`<h3>Registrar pedido recebido por outro canal</h3><p class="small muted">Use quando a pessoa pediu contato por telefone ou pessoalmente. Marque a autorização só se ela concordou.</p>${formHtml(c, null)}`, { wide: true });
    const f = s.el.querySelector("#f"); f.querySelector("[name=website]")?.remove(); const k = newKey();
    f.onsubmit = async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(f).entries()); const b = s.el.querySelector("#ok"); busy(b);
      try { const x = await sb.rpc("contact_create", { p_org: org, p: { ...d, consent: f.consent.checked, key: k } }); if (x.error) return toast(errText(x.error)); s.close(); toast("Pedido registrado: " + x.data.code); location.hash = "#/contatos/" + x.data.id; } finally { busy(b, false); }
    };
  });
}
const clean = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));
const hasFilter = () => ["category", "status", "responsible", "from", "to"].some((k) => F[k]);

// ------------------------------------------------------------------ uma solicitação
const LOG = { create: "Solicitação recebida", route_default: "Encaminhada pela categoria", reopen: "Reaberta", link: "Associada a uma ficha", note: "Observação confidencial adicionada", notes_read: "Observações confidenciais consultadas", to_care: "Acompanhamento pastoral iniciado", unassign: "Responsável retirado" };
const logText = (l) => {
  const d = l.detail || {};
  if (l.action === "status") return `Situação: ${STATUS[l.from] || "—"} → ${STATUS[l.to] || "—"}${d.auto ? " (ao encaminhar)" : ""}${d.reason ? ` · ${d.reason}` : ""}`;
  if (l.action === "reopen") return `Reaberta (${STATUS[l.from]} → ${STATUS[l.to]}) · ${d.reason || ""}`;
  if (l.action === "assign") return `Responsável definido: ${d.to_name || ""}${d.note ? ` · ${d.note}` : ""}`;
  if (l.action === "transfer") return `Transferida de ${d.from_name || "—"} para ${d.to_name || "—"}${d.note ? ` · ${d.note}` : ""}`;
  if (l.action === "team") return `Equipe: ${d.from_name || "—"} → ${d.to_name || "nenhuma"}${d.note ? ` · ${d.note}` : ""}`;
  if (l.action === "interaction") return `Registro de contato: ${KINDS[d.kind] || ""}`;
  if (l.action === "edit") return `Dados corrigidos: ${(d.fields || []).join(", ")}`;
  return LOG[l.action] || l.action;
};
async function detail(el, alive, id) {
  el.innerHTML = spinner();
  const r = await sb.rpc("contact_get", { p_id: id });
  if (!alive()) return;
  if (r.error) return fail(el, "Solicitação", r.error, ["#/contatos", "Solicitações"]);
  const g = r.data, again = () => detail(el, alive, id);
  const kv = (k, v) => `<div class="mc-kv"><span class="mc-k">${k}</span><span class="mc-v">${v || "—"}</span></div>`;
  const prefTxt = g.pref === "other" ? esc(g.pref_other || "Outro canal") : PREF[g.pref];
  el.innerHTML = `${head(g.code, ["#/contatos", "Solicitações"])}
    <section class="card"><div class="row between"><b>${esc(g.category)}</b>${tag(g.status)}</div>
      <p class="mt" style="white-space:pre-wrap">${esc(g.message)}</p><div class="tiny muted">Enviada em ${when(g.created_at)} · ${g.source === "admin" ? "registrada pela equipe" : g.source === "public_form" ? "pelo link público" : "pelo aplicativo"}</div></section>
    <h3 class="mt">Pessoa</h3><div class="card">${kv("Nome", esc(g.name))}${kv("Telefone", g.phone ? `${esc(g.phone)} <a class="small" href="tel:${digits(g.phone)}">ligar</a> · <a class="small" href="https://wa.me/${wa(g.phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : "")}${kv("E-mail", g.email ? `${esc(g.email)} <a class="small" href="mailto:${attr(g.email)}">escrever</a>` : "")}${kv("Prefere", prefTxt)}
      ${kv("Ficha", g.person ? `<a href="#/pessoas/${g.person.id}">${esc(g.person.name)}</a>` : "Ainda sem ficha" + (g.has_account ? " (tem conta no app)" : ""))}
      <p class="tiny muted mt">Autorização registrada em ${when(g.consent_at)} (texto v${g.consent_version}): ${esc(g.consent_purpose)}. Contato por WhatsApp, ligação ou e-mail é feito por você, manualmente.</p>
      <div class="row gap-s mt" style="flex-wrap:wrap">${g.can_manage && !["completed", "cancelled"].includes(g.status) ? `<button class="btn ghost sm" id="edit">${icon("edit")} Corrigir dados</button>` : ""}${g.can_link ? `<button class="btn ghost sm" id="link">Associar à ficha</button>` : ""}${g.can_care ? `<button class="btn ghost sm" id="care">Iniciar acompanhamento pastoral</button>` : ""}</div></div>
    <h3 class="mt">Atendimento</h3><div class="card">${kv("Responsável", g.responsible_name ? esc(g.responsible_name) : "")}${kv("Equipe", g.team_name ? esc(g.team_name) : "")}${g.cancel_reason ? kv("Motivo do cancelamento", esc(g.cancel_reason)) : ""}${g.completed_at ? kv("Concluída em", when(g.completed_at)) : ""}
      <div class="row gap-s mt" style="flex-wrap:wrap">${g.next.map((s) => `<button class="btn ${s === "cancelled" ? "ghost" : s === "completed" ? "primary" : "ghost"} sm" data-st="${s}">${s === "completed" ? "Concluir" : s === "cancelled" ? "Cancelar" : STATUS[s]}</button>`).join("")}${g.can_reopen ? `<button class="btn primary sm" id="reopen">Reabrir</button>` : ""}${g.can_assign ? `<button class="btn ghost sm" id="assign">Encaminhar / responsável</button>` : ""}</div></div>
    <div class="row between mt"><h3>Registros de contato</h3>${g.can_manage && !["completed", "cancelled"].includes(g.status) ? `<button class="btn primary sm" id="int">${icon("plus")} Registrar</button>` : ""}</div>
    <div class="list">${g.interactions.map((i) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${KINDS[i.kind]}</b> · ${when(i.at)} · <span class="muted">${esc(i.by)}</span></span><span class="small" style="white-space:pre-wrap">${esc(i.description)}</span>${i.result ? `<span class="tiny muted">Resultado: ${esc(i.result)}</span>` : ""}</div>`).join("") || `<div class="li muted small">Nenhum registro ainda.</div>`}</div>
    ${g.can_confidential ? `<div class="row between mt"><h3>Observações confidenciais</h3><button class="btn ghost sm" id="note">${icon("plus")} Adicionar</button></div><div class="mc-note mb">${icon("lock")} Só quem tem esta permissão vê. Cada consulta fica registrada e nada aqui vai para a ficha.</div>
      <div class="list">${g.notes.map((n) => `<div class="li col" style="align-items:flex-start"><span class="small" style="white-space:pre-wrap">${esc(n.body)}</span><span class="tiny muted">${esc(n.by)} · ${when(n.at)}</span></div>`).join("") || `<div class="li muted small">Nenhuma observação.</div>`}</div>` : ""}
    <details class="card mt" open><summary class="small"><b>Histórico administrativo</b></summary><div class="mt">${g.log.map((l) => `<div class="small" style="padding:4px 0">${when(l.at)} · ${esc(logText(l))} · <span class="muted">${esc(l.by)}</span></div>`).join("")}</div></details>`;
  const call = async (b, fn, args, ok) => { busy(b); try { const x = await sb.rpc(fn, args); if (x.error) { toast(errText(x.error)); return null; } if (ok) toast(ok); again(); return x.data; } finally { busy(b, false); } };
  const reason = (title, label, need, go) => { const s = sheet(`<h3>${title}</h3><label class="field"><span>${label}${need ? " *" : " (opcional)"}</span><textarea id="tx" rows="3" maxlength="500"></textarea></label><button class="btn primary block" id="ok">Confirmar</button>`); s.el.querySelector("#ok").onclick = async (e) => { const v = s.el.querySelector("#tx").value.trim(); if (need && v.length < 3) return toast("Explique o motivo."); const x = await go(e.currentTarget, v); if (x) s.close(); }; };
  el.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => {
    const s = b.dataset.st;
    if (s === "cancelled") return reason("Cancelar solicitação", "Motivo do cancelamento", true, (btn, v) => call(btn, "contact_status", { p_id: id, p_status: s, p_reason: v }, "Solicitação cancelada"));
    if (s === "completed") return reason("Concluir solicitação", "Observação final", false, (btn, v) => call(btn, "contact_status", { p_id: id, p_status: s, p_reason: v || null }, "Solicitação concluída"));
    call(b, "contact_status", { p_id: id, p_status: s, p_reason: null }, "Situação atualizada");
  }));
  el.querySelector("#reopen")?.addEventListener("click", () => reason("Reabrir solicitação", "Por que reabrir?", true, (btn, v) => call(btn, "contact_status", { p_id: id, p_status: "review", p_reason: v }, "Solicitação reaberta")));
  el.querySelector("#assign")?.addEventListener("click", async () => {
    const rr = (await sb.rpc("contact_responsibles", { p_org: g.org_id })).data || { users: [], teams: [] };
    const s = sheet(`<h3>Encaminhar</h3><label class="field"><span>Responsável</span><select id="u"><option value="">Sem responsável</option>${rr.users.map((u) => `<option value="${u.user_id}" ${u.user_id === g.responsible_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Equipe</span><select id="t"><option value="">Nenhuma</option>${rr.teams.map((t) => `<option value="${t.id}" ${t.id === g.team_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Observação (opcional)</span><input id="n" maxlength="500"></label><p class="tiny muted">Encaminhar a uma equipe não dá acesso a todos os integrantes. Só quem tem permissão e o responsável veem a solicitação.</p><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const x = await call(e.currentTarget, "contact_assign", { p_id: id, p: { user_id: s.el.querySelector("#u").value || null, team_id: s.el.querySelector("#t").value || null, note: s.el.querySelector("#n").value || null } }, "Encaminhamento salvo"); if (x) s.close(); };
  });
  el.querySelector("#int")?.addEventListener("click", () => {
    const s = sheet(`<h3>Registrar contato</h3><label class="field"><span>Tipo</span><select id="k">${opts(Object.entries(KINDS), "call")}</select></label><label class="field"><span>O que aconteceu *</span><textarea id="d" rows="3" maxlength="2000"></textarea></label><label class="field"><span>Resultado</span><input id="r" maxlength="500"></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const x = await call(e.currentTarget, "contact_interaction_add", { p_id: id, p: { kind: s.el.querySelector("#k").value, description: s.el.querySelector("#d").value, result: s.el.querySelector("#r").value || null } }, "Contato registrado"); if (x) s.close(); };
  });
  el.querySelector("#note")?.addEventListener("click", () => {
    const s = sheet(`<h3>Observação confidencial</h3><label class="field"><textarea id="d" rows="4" maxlength="4000"></textarea></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const x = await call(e.currentTarget, "contact_note_add", { p_id: id, p_body: s.el.querySelector("#d").value }, "Observação salva"); if (x) s.close(); };
  });
  el.querySelector("#edit")?.addEventListener("click", () => {
    const s = sheet(`<h3>Corrigir dados de contato</h3><p class="tiny muted">A mensagem original não muda.</p><label class="field"><span>Nome</span><input name="name" maxlength="160" value="${attr(g.name)}"></label><label class="field"><span>Telefone</span><input name="phone" type="tel" maxlength="30" value="${attr(g.phone || "")}"></label>
      <label class="field"><span>E-mail</span><input name="email" type="email" maxlength="200" value="${attr(g.email || "")}"></label><label class="field"><span>Preferência</span><select name="pref">${opts(Object.entries(PREF).filter(([k]) => k !== "other" || g.pref === "other"), g.pref)}</select></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const q = (n) => s.el.querySelector(`[name=${n}]`).value; const x = await call(e.currentTarget, "contact_update", { p_id: id, p: { name: q("name"), phone: q("phone"), email: q("email"), pref: q("pref") } }, "Dados corrigidos"); if (x) s.close(); };
  });
  el.querySelector("#care")?.addEventListener("click", async (e) => { if (await confirmDialog("Registrar no acompanhamento pastoral desta pessoa? Só o vínculo com esta solicitação é gravado, a mensagem não é copiada.", "Iniciar")) call(e.currentTarget, "contact_to_care", { p_id: id }, "Acompanhamento iniciado"); });
  el.querySelector("#link")?.addEventListener("click", () => {
    const s = sheet(`<h3>Associar à ficha</h3><p class="small muted">Escolha uma pessoa que já tem ficha. O histórico original da solicitação é mantido.</p><label class="psearch">${icon("search")}<input id="iq" type="search" placeholder="Buscar pelo nome" autocomplete="off"></label><div id="ir"></div>${g.can_create_person ? `<button class="btn ghost block mt" id="mk">Criar nova ficha com estes dados</button>` : ""}`);
    let tt; s.el.querySelector("#iq").addEventListener("input", (e) => { clearTimeout(tt); tt = setTimeout(async () => { const q = e.target.value.trim(); if (q.length < 2) { s.el.querySelector("#ir").innerHTML = ""; return; } const rr = await sb.rpc("contact_people_search", { p_org: g.org_id, p_q: q }); s.el.querySelector("#ir").innerHTML = (rr.data || []).map((p) => `<button class="li" data-p="${p.id}">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 36, false)}<span class="grow"><span class="t">${esc(p.full_name)}</span></span></button>`).join("") || `<div class="li muted small">Ninguém encontrado.</div>`; }, 250); });
    s.el.addEventListener("click", async (e) => { const b = e.target.closest("[data-p]"); if (b) { const x = await call(b, "contact_link", { p_id: id, p_person: b.dataset.p, p_create: false, p_force: false }, "Associada à ficha"); if (x) s.close(); } });
    s.el.querySelector("#mk")?.addEventListener("click", async (e) => {
      const b = e.currentTarget; busy(b); try { let x = await sb.rpc("contact_link", { p_id: id, p_person: null, p_create: true, p_force: false }); if (x.error) return toast(errText(x.error));
        if (x.data.saved === false) { if (!(await confirmDialog(`Já existe ficha com o mesmo telefone ou e-mail: ${x.data.candidates.map((c) => c.full_name).join(", ")}. Criar mesmo assim?`, "Criar mesmo assim"))) return; x = await sb.rpc("contact_link", { p_id: id, p_person: null, p_create: true, p_force: true }); if (x.error) return toast(errText(x.error)); }
        s.close(); toast("Ficha criada e associada"); again(); } finally { busy(b, false); }
    });
  });
}

// ------------------------------------------------------------------ categorias, textos e link público
async function config(el, alive) {
  const org = state.org?.id;
  el.innerHTML = spinner();
  const r = await sb.rpc("contact_settings_get", { p_org: org });
  if (!alive()) return;
  if (r.error) return fail(el, "Categorias e textos", r.error, ["#/contatos", "Solicitações"]);
  const c = r.data, again = () => config(el, alive), rr = (await sb.rpc("contact_responsibles", { p_org: org })).data || { users: [], teams: [] };
  const link = `${location.origin}${location.pathname.replace(/index\.html$/, "")}#/fale-conosco/${c.form_token}`;
  el.innerHTML = `${head("Categorias e textos", ["#/contatos", "Solicitações"])}
    <div class="row between"><h3>Assuntos do formulário</h3><button class="btn primary sm" id="addc">${icon("plus")} Novo assunto</button></div>
    <div class="list">${c.categories.map((x, i) => `<div class="li col" style="align-items:stretch"><div class="row between"><b>${esc(x.name)}</b>${x.active ? `<span class="ptag attender">Ativo</span>` : `<span class="ptag none">Desativado</span>`}</div>
      <span class="tiny muted">${x.default_user_name ? "Responsável padrão: " + esc(x.default_user_name) : "Sem responsável padrão"}${x.default_team_name ? " · Equipe: " + esc(x.default_team_name) : ""} · ${x.total} ${x.total === 1 ? "solicitação" : "solicitações"}</span>
      <div class="row gap-s mt"><button class="btn ghost sm" data-mv="${x.id}:-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button><button class="btn ghost sm" data-mv="${x.id}:1" ${i === c.categories.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button><button class="btn ghost sm" data-ec="${x.id}">Editar</button></div></div>`).join("")}</div>
    <h3 class="mt">Textos e consentimento</h3><form id="f" class="card" novalidate><label class="field"><span>Apresentação do formulário</span><textarea name="intro" rows="3" maxlength="1000">${esc(c.intro)}</textarea></label>
      <label class="field"><span>Texto de consentimento (versão atual: ${c.consent_version})</span><textarea name="consent_text" rows="3" maxlength="600">${esc(c.consent_text)}</textarea></label><p class="tiny muted">Ao mudar o texto, uma nova versão é criada. Cada solicitação guarda a versão que a pessoa aceitou.</p>
      <label class="field"><span>Outro canal de retorno (opcional)</span><input name="other_channel" maxlength="60" value="${attr(c.other_channel || "")}" placeholder="Ex.: Instagram"></label><button class="btn primary block" id="ok">Salvar textos</button></form>
    <h3 class="mt">Link público</h3><div class="card"><label class="mc-radio"><input type="checkbox" id="act" ${c.form_active ? "checked" : ""}> Aceitar solicitações por link, sem entrar no app</label>
      ${c.form_active ? `<div class="mc-note mt" style="word-break:break-all">${esc(link)}</div><div class="row gap-s mt"><button class="btn ghost sm" id="copy">${icon("copy")} Copiar link</button><button class="btn ghost sm" id="rot">Gerar novo link</button></div>` : ""}</div>`;
  const save = async (b, p, ok) => { busy(b); try { const x = await sb.rpc("contact_settings_save", { p_org: org, p }); if (x.error) return toast(errText(x.error)); toast(ok); again(); } finally { busy(b, false); } };
  const f = el.querySelector("#f"); f.onsubmit = (e) => { e.preventDefault(); save(el.querySelector("#ok"), { intro: f.intro.value, consent_text: f.consent_text.value, other_channel: f.other_channel.value || null }, "Textos salvos"); };
  el.querySelector("#act").onchange = (e) => save(e.target, { form_active: e.target.checked }, e.target.checked ? "Link ativado" : "Link desativado");
  el.querySelector("#copy")?.addEventListener("click", () => navigator.clipboard?.writeText(link).then(() => toast("Link copiado")));
  el.querySelector("#rot")?.addEventListener("click", async (e) => { if (await confirmDialog("O link antigo deixará de funcionar. Gerar um novo?", "Gerar novo")) save(e.target, { rotate: true }, "Novo link gerado"); });
  el.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", async () => { const [id, d] = b.dataset.mv.split(":"); busy(b); try { const x = await sb.rpc("contact_category_move", { p_id: id, p_dir: Number(d) }); if (x.error) return toast(errText(x.error)); again(); } finally { busy(b, false); } }));
  const catForm = (x) => {
    const s = sheet(`<h3>${x ? "Editar assunto" : "Novo assunto"}</h3><form id="cf" novalidate><label class="field"><span>Nome *</span><input name="name" maxlength="80" value="${attr(x?.name || "")}"></label><label class="field"><span>Descrição</span><input name="description" maxlength="300" value="${attr(x?.description || "")}"></label>
      <label class="field"><span>Responsável padrão</span><select name="default_user_id"><option value="">Nenhum</option>${rr.users.map((u) => `<option value="${u.user_id}" ${x?.default_user_id === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Equipe padrão</span><select name="default_team_id"><option value="">Nenhuma</option>${rr.teams.map((t) => `<option value="${t.id}" ${x?.default_team_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label class="mc-radio"><input type="checkbox" name="active" ${x && !x.active ? "" : "checked"}> Aparece no formulário</label><p class="tiny muted">O responsável e a equipe padrão recebem o pedido já encaminhado, mas a situação continua "Recebida" até alguém analisar.</p><button class="btn primary block mt" id="ok">Salvar</button></form>`);
    const cf = s.el.querySelector("#cf");
    cf.onsubmit = async (e) => { e.preventDefault(); const b = s.el.querySelector("#ok"); busy(b); try { const x2 = await sb.rpc("contact_category_save", { p_org: org, p_id: x?.id || null, p: { name: cf.name.value, description: cf.description.value, default_user_id: cf.default_user_id.value || null, default_team_id: cf.default_team_id.value || null, active: cf.active.checked } }); if (x2.error) return toast(errText(x2.error)); s.close(); again(); } finally { busy(b, false); } };
  };
  el.querySelector("#addc").onclick = () => catForm(null);
  el.querySelectorAll("[data-ec]").forEach((b) => b.addEventListener("click", () => catForm(c.categories.find((x) => x.id === b.dataset.ec))));
}
