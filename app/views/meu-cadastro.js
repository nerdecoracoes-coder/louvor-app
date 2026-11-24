// Meu Cadastro (SOMOS Um) e painel de Atualizações cadastrais (SOMOS Chamados).
// A pessoa só vê e pede alteração do próprio cadastro (ou de dependente sob sua responsabilidade); o servidor decide o que muda na hora e o que passa por aprovação.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog, canAdminOrg, peopleCan } from "../core.js";
import { personFields, readFields, wirePhoto } from "./pessoas.js";
import { CLASS_LABEL, errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/meu-cadastro", (p, el, a) => mine(el, a));
  route("/atualizacoes-cadastrais", (p, el, a) => panel(el, a));
}

const STATUS = { draft: "Rascunho", pending: "Aguardando análise", in_review: "Em análise", approved: "Aprovada", partial: "Parcialmente aprovada", refused: "Recusada", cancelled: "Cancelada" };
const MODE = { direct: "Atualiza na hora", approval: "Passa por aprovação", locked: "Só a secretaria altera" };
const DEC = { approved: "Aprovado", refused: "Recusado", pending: "Aguardando" };
const MARITAL = { solteiro: "Solteiro(a)", casado: "Casado(a)", divorciado: "Divorciado(a)", viuvo: "Viúvo(a)", uniao: "União estável", outro: "Outro" };
const LBL = { full_name: "Nome completo", social_name: "Nome de preferência", birth_date: "Nascimento", sex: "Sexo", marital_status: "Estado civil", cpf: "CPF", phone: "Telefone principal", phone2: "Telefone secundário", whatsapp: "WhatsApp", email: "E-mail", zip: "CEP", address: "Logradouro", address_number: "Número", address_complement: "Complemento", neighborhood: "Bairro", city: "Cidade", state: "UF", country: "País", photo_url: "Foto" };
const SECTIONS = [["Dados pessoais", ["full_name", "social_name", "birth_date", "sex", "marital_status", "cpf"]], ["Contatos", ["phone", "phone2", "whatsapp", "email"]], ["Endereço", ["zip", "address", "address_number", "address_complement", "neighborhood", "city", "state", "country"]]];
const fmtD = (t) => (t ? new Date(t).toLocaleDateString("pt-BR") : "");
const show = (f, v) => {
  if (v == null || v === "") return "—";
  if (f === "birth_date") return String(v).split("-").reverse().join("/");
  if (f === "sex") return v === "F" ? "Feminino" : v === "M" ? "Masculino" : v;
  if (f === "marital_status") return MARITAL[v] || v;
  if (f === "photo_url") return "nova foto";
  return v;
};
const norm = (f, v) => { let s = v == null ? "" : String(v).trim(); if (f === "cpf" || f === "zip") s = s.replace(/\D/g, ""); return s === "" ? null : s; };
const tag = (st) => `<span class="ptag st-${st}">${STATUS[st] || st}</span>`;

// ------------------------------------------------------------------ Meu Cadastro
let who = null;   // null = eu; id = dependente
async function mine(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("user", "Entre em uma igreja para ver o seu cadastro."); return; }
  el.innerHTML = spinner();
  const r = await sb.rpc("my_registration", { p_org: org, p_person: who });
  if (!alive()) return;
  if (r.error) {
    if (who) { who = null; return mine(el, alive); }
    const miss = /function|does not exist|schema cache/i.test(r.error.message || "");
    el.innerHTML = `<div class="pagehead"><h1>Meu cadastro</h1></div>${miss ? `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-29-atualizacao-cadastral.sql</b> no SQL Editor do Supabase.</div>` : empty("alert", "Não foi possível carregar o seu cadastro.", `<button class="btn ghost sm" id="retry">Tentar de novo</button>`)}`;
    el.querySelector("#retry")?.addEventListener("click", () => mine(el, alive));
    return;
  }
  const m = r.data, p = m.person;
  const deps = m.dependents || [];
  const chips = deps.length ? `<div class="mc-chips mb"><button class="chip ${!who ? "on" : ""}" data-who="">Eu</button>${deps.map((d) => `<button class="chip ${who === d.id ? "on" : ""}" data-who="${d.id}">${esc(d.name.split(" ")[0])}</button>`).join("")}</div>` : "";
  if (!p) {
    el.innerHTML = `<div class="pagehead"><h1>Meu cadastro</h1></div>${chips}<section class="card"><h3>Seu cadastro ainda não existe</h3><p class="small muted">A igreja ainda não tem seus dados. Preencha o que quiser; a secretaria cuida da sua classificação.</p><button class="btn primary block mt" id="first">Preencher meus dados</button></section>`;
    bindWho(el, alive);
    el.querySelector("#first").onclick = () => {
      const s = sheet(`<h3>Meus dados</h3><form id="f" novalidate>${personFields({ full_name: state.profile?.full_name || "" }, { admin: false, photo: false })}<button class="btn primary block mt" id="ok">Salvar</button></form>`, { wide: true });
      s.el.querySelector("#ok").onclick = async (e) => {
        e.preventDefault(); const b = e.currentTarget; busy(b);
        try { const rr = await sb.rpc("my_person_update", { p_org: org, p: readFields(s.el.querySelector("#f"), { admin: false }) }); if (rr.error) return toast(errText(rr.error)); toast("Cadastro criado"); s.close(); mine(el, alive); } finally { busy(b, false); }
      };
    };
    return;
  }
  const pend = new Set(m.pending_fields || []);
  const guardian = m.role === "guardian";
  const row = (f) => `<div class="mc-kv"><span class="mc-k">${LBL[f]}</span><span class="mc-v">${esc(show(f, p[f]))}${pend.has(f) ? ` <span class="ptag st-pending">em análise</span>` : ""}</span></div>`;
  el.innerHTML = `<div class="pagehead"><h1>Meu cadastro</h1></div>${chips}
    <section class="card"><div class="row gap">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 56, false)}<div class="grow"><b>${esc(p.social_name || p.full_name)}</b><div class="small muted">${guardian ? "Você administra este cadastro como responsável legal." : "Estes dados ficam na ficha da igreja."}</div></div></div>
      ${pend.size ? `<div class="mc-note mt">${icon("clock")} ${pend.size} ${pend.size === 1 ? "informação aguarda" : "informações aguardam"} análise da secretaria. Enquanto isso, a ficha continua com os dados atuais.</div>` : ""}
      ${m.draft ? `<div class="mc-note mt">${icon("edit")} Você tem alterações que ainda não enviou. <button class="btn ghost sm" id="draft">Continuar</button></div>` : ""}
      <button class="btn primary block mt" id="edit">${icon("edit")} Editar dados</button></section>
    ${SECTIONS.map(([t, fs]) => `<h3 class="mt">${t}</h3><div class="card">${fs.map(row).join("")}</div>`).join("")}
    <h3 class="mt">Família</h3><div class="card">${(m.family || []).map((f) => `<div class="mc-kv"><span class="mc-k">${esc(f.label)}</span><span class="mc-v">${esc(f.name)}</span></div>`).join("") || `<span class="small muted">Nenhum vínculo familiar cadastrado.</span>`}
      <p class="tiny muted mt">Para incluir ou corrigir vínculos familiares, fale com a secretaria.</p></div>
    <h3 class="mt">Minhas solicitações</h3>
    <div class="list">${(m.requests || []).map((q) => `<details class="li col rq" style="align-items:stretch"><summary class="row between"><span><b>${fmtD(q.submitted_at)}</b> · ${q.items.length} ${q.items.length === 1 ? "campo" : "campos"}${q.on_behalf ? " · pelo responsável" : ""}</span>${tag(q.status)}</summary>
      <div class="mt">${q.items.map((i) => `<div class="small" style="padding:4px 0"><b>${esc(i.label)}</b>: ${i.old || i.new ? `<span class="muted">${esc(show(i.field, i.old))}</span> → ${esc(show(i.field, i.new))}` : "alterado"} · <i>${DEC[i.decision]}</i>${i.reason ? `<div class="mc-note mt">Motivo da recusa: ${esc(i.reason)}</div>` : ""}</div>`).join("")}
      ${q.status === "pending" ? `<button class="btn ghost sm mt" data-cancel="${q.id}">Cancelar solicitação</button>` : ""}</div></details>`).join("") || `<div class="li muted small">Nenhuma solicitação enviada.</div>`}</div>
    <h3 class="mt">Precisa corrigir algo?</h3>
    <div class="card small muted">Alguns dados passam por conferência da secretaria antes de mudar. Dados como classificação na igreja e situação do cadastro só a secretaria altera. Se algo estiver errado e não puder ser editado aqui, fale com a secretaria.</div>`;
  bindWho(el, alive);
  el.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmDialog("Cancelar esta solicitação? Nada será alterado no seu cadastro.", "Cancelar solicitação", true))) return;
    const c = await sb.rpc("registration_cancel", { p_id: b.dataset.cancel }); if (c.error) return toast(errText(c.error)); toast("Solicitação cancelada"); mine(el, alive);
  }));
  const open = (init) => editSheet(m, init, () => mine(el, alive));
  el.querySelector("#edit").onclick = () => open(null);
  el.querySelector("#draft")?.addEventListener("click", () => open(m.draft));
}
function bindWho(el, alive) { el.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => { who = b.dataset.who || null; mine(el, alive); })); }

function editSheet(m, init, done) {
  const p = { ...m.person, ...(init || {}) }, pend = new Set(m.pending_fields || []);
  const s = sheet(`<h3>Editar dados</h3><p class="small muted">Dados marcados como <b>aprovação</b> só mudam na ficha depois da conferência da secretaria.</p><form id="f" novalidate>${personFields(p, { admin: false, photo: true })}</form>
    <div id="sum"></div><button class="btn primary block mt" id="rev">Revisar alterações</button>`, { wide: true });
  const form = s.el.querySelector("#f");
  wirePhoto(s.el, state.org.id);
  for (const f of Object.keys(LBL)) {
    const inp = form.querySelector(`[name=${f}]`); if (!inp) continue;
    const mode = m.policy[f], lock = mode === "locked" || pend.has(f);
    if (lock) inp.disabled = true;
    const lab = inp.closest("label.field"), span = lab?.querySelector("span");
    if (span) span.insertAdjacentHTML("beforeend", ` <em class="tiny muted">${pend.has(f) ? "(em análise)" : "(" + MODE[mode].toLowerCase() + ")"}</em>`);
  }
  if (m.policy.photo_url === "locked") s.el.querySelector("#phbtn")?.setAttribute("disabled", "");
  const diff = () => {
    const d = readFields(form, { admin: false }), out = {};
    for (const [k, v] of Object.entries(d)) { if (form.querySelector(`[name=${k}]`)?.disabled) continue; if (norm(k, v) !== norm(k, m.person[k])) out[k] = norm(k, v); }
    return out;
  };
  s.el.querySelector("#rev").onclick = () => {
    const ch = diff(), ks = Object.keys(ch);
    if (!ks.length) return toast("Nenhuma alteração para enviar.");
    if (ks.includes("full_name") && !ch.full_name) return toast("O nome completo não pode ficar vazio.");
    const direct = ks.filter((k) => m.policy[k] === "direct"), appr = ks.filter((k) => m.policy[k] === "approval");
    const line = (k) => `<div class="small" style="padding:3px 0"><b>${LBL[k]}</b>: <span class="muted">${esc(show(k, m.person[k]))}</span> → ${esc(show(k, ch[k]))}</div>`;
    const s2 = sheet(`<h3>Confirmar alterações</h3>
      ${direct.length ? `<h4 class="mt">Serão salvas agora</h4>${direct.map(line).join("")}` : ""}
      ${appr.length ? `<h4 class="mt">Serão enviadas para análise</h4>${appr.map(line).join("")}<p class="tiny muted">Seu cadastro continua com os dados atuais até a aprovação.</p>` : ""}
      <button class="btn primary block mt" id="send">Enviar</button><button class="btn ghost block mt" id="save">Guardar rascunho</button><button class="btn ghost block mt" data-close>Voltar e editar</button>`);
    const go = async (send, btn) => {
      busy(btn);
      try {
        const r = await sb.rpc("registration_submit", { p_person: m.person.id, p: ch, p_send: send });
        if (r.error) return toast(errText(r.error));
        const x = r.data;
        toast(!send ? "Rascunho guardado" : x.pending?.length ? (x.applied?.length ? "Dados salvos e solicitação enviada" : "Solicitação enviada para análise") : "Dados salvos");
        s2.close(); s.close(); done();
      } finally { busy(btn, false); }
    };
    s2.el.querySelector("#send").onclick = (e) => go(true, e.currentTarget);
    s2.el.querySelector("#save").onclick = (e) => go(false, e.currentTarget);
  };
}

// ------------------------------------------------------------------ painel das solicitações
const pf = { status: "", from: "", to: "", person: "", reviewer: "" };
async function panel(el, alive) {
  const org = state.org?.id;
  if (!org || !(canAdminOrg() || peopleCan("people_approve"))) { el.innerHTML = empty("shield", "Você não tem acesso às atualizações cadastrais."); return; }
  el.innerHTML = spinner();
  let offset = 0, items = [], more = false, counts = {};
  const load = async (reset) => {
    if (reset) { offset = 0; items = []; }
    const r = await sb.rpc("registration_requests", { p_org: org, p_status: pf.status || null, p_person: null, p_from: pf.from || null, p_to: pf.to || null, p_reviewer: null, p_limit: 20, p_offset: offset });
    if (r.error) return r;
    items = items.concat(r.data.items); offset = items.length; more = r.data.has_more; counts = r.data.counts || {};
    return r;
  };
  const r0 = await load(true);
  if (!alive()) return;
  if (r0.error) {
    const forb = /forbidden/.test(r0.error.message || ""), miss = /function|does not exist|schema cache/i.test(r0.error.message || "");
    el.innerHTML = `<div class="pagehead"><h1>Atualizações cadastrais</h1></div>${miss ? `<div class="card small">Rode o arquivo <b>atualizacao-2026-11-29-atualizacao-cadastral.sql</b> no SQL Editor do Supabase.</div>` : empty(forb ? "lock" : "alert", forb ? "Você não tem permissão para analisar solicitações." : "Não foi possível carregar as solicitações.", forb ? "" : `<button class="btn ghost sm" id="retry">Tentar de novo</button>`)}`;
    el.querySelector("#retry")?.addEventListener("click", () => panel(el, alive));
    return;
  }
  const match = (q) => (!pf.person || q.person.name.toLowerCase().includes(pf.person.toLowerCase())) && (!pf.reviewer || (q.reviewer || "").toLowerCase().includes(pf.reviewer.toLowerCase()));
  const paint = () => {
    const vis = items.filter(match), active = !!(pf.from || pf.to || pf.person || pf.reviewer);
    el.innerHTML = `<div class="pagehead"><h1>Atualizações cadastrais</h1></div>
      <div class="mc-chips mb">${[["", "Todas"], ["pending", "Pendentes"], ["in_review", "Em análise"], ["approved", "Aprovadas"], ["partial", "Parciais"], ["refused", "Recusadas"]].map(([k, l]) => `<button class="chip ${pf.status === k ? "on" : ""}" data-st="${k}">${l}${k && counts[k] ? ` (${counts[k]})` : ""}</button>`).join("")}</div>
      <div class="row gap-s mb"><button class="btn ghost sm" id="flt">Filtrar${active ? " (ativo)" : ""}</button>${canAdminOrg() ? `<button class="btn ghost sm" id="pol">Regras por campo</button>` : ""}</div>
      <div class="list">${vis.map(card).join("") || `<div class="li muted small">${items.length ? "Nada com esses filtros." : "Nenhuma solicitação por aqui."}</div>`}</div>
      ${more ? `<button class="btn ghost block mt" id="more">Carregar mais</button>` : ""}`;
    el.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", async () => { pf.status = b.dataset.st; await load(true); paint(); }));
    el.querySelector("#more")?.addEventListener("click", async (e) => { busy(e.currentTarget); await load(false); paint(); });
    el.querySelector("#flt").onclick = () => {
      const s = sheet(`<h3>Filtrar</h3><label class="field"><span>Pessoa</span><input id="p" value="${attr(pf.person)}" placeholder="Parte do nome"></label><label class="field"><span>Analisado por</span><input id="r" value="${attr(pf.reviewer)}" placeholder="Parte do nome"></label>
        <div class="grid2"><label class="field"><span>De</span><input id="f" type="date" value="${pf.from}"></label><label class="field"><span>Até</span><input id="t" type="date" value="${pf.to}"></label></div>
        <button class="btn primary block" id="ok">Aplicar</button><button class="btn ghost block mt" id="clr">Limpar</button>`);
      const q = (i) => s.el.querySelector(i);
      q("#ok").onclick = async () => { Object.assign(pf, { person: q("#p").value.trim(), reviewer: q("#r").value.trim(), from: q("#f").value, to: q("#t").value }); s.close(); await load(true); paint(); };
      q("#clr").onclick = async () => { Object.assign(pf, { person: "", reviewer: "", from: "", to: "" }); s.close(); await load(true); paint(); };
    };
    el.querySelector("#pol")?.addEventListener("click", policySheet);
    el.querySelectorAll("details.rq").forEach(wire);
  };
  const card = (q) => {
    const rows = q.items.map((i) => {
      const dec = i.decision !== "pending";
      return `<div class="rqi" data-item="${i.id}" style="padding:8px 0;border-top:1px solid rgba(var(--w),.08)"><div class="small"><b>${esc(i.label)}</b></div>
        <div class="small"><span class="muted">${esc(show(i.field, i.old))}</span> → <b>${esc(show(i.field, i.new))}</b></div>
        ${i.conflict ? `<div class="mc-note mt">${icon("alert")} O dado oficial mudou para <b>${esc(show(i.field, i.current))}</b> depois do pedido. Aprovar vai sobrescrever. <label class="chip"><input type="checkbox" data-force> Aprovar mesmo assim</label></div>` : ""}
        ${dec ? `<div class="small mt"><i>${DEC[i.decision]}</i> por ${esc(i.decided_by || "—")} em ${fmtD(i.decided_at)}${i.overridden ? " (conflito resolvido)" : ""}${i.reason ? `<div class="muted">Motivo: ${esc(i.reason)}</div>` : ""}</div>`
          : `<div class="row gap-s mt"><button class="btn ghost sm" data-d="approve">Aprovar</button><button class="btn ghost sm" data-d="refuse">Recusar</button></div><input class="mt" data-reason hidden maxlength="500" placeholder="Motivo da recusa (obrigatório)">`}</div>`;
    }).join("");
    const open = ["pending", "in_review"].includes(q.status);
    return `<details class="li col rq" data-id="${q.id}" style="align-items:stretch" ${open && items.length < 4 ? "open" : ""}><summary class="row gap">${avatar({ display_name: q.person.name, avatar_url: q.person.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(q.person.name)}</span><span class="s">${fmtD(q.submitted_at)} · ${q.items.length} ${q.items.length === 1 ? "campo" : "campos"}${q.on_behalf ? " · pelo responsável" : ""}</span></span>${tag(q.status)}</summary>
      <div class="tiny muted mt">Enviado por ${esc(q.requested_by)}${q.reviewer ? ` · analisado por ${esc(q.reviewer)} em ${fmtD(q.reviewed_at)}` : ""}</div>${rows}
      ${open ? `<div class="row gap-s mt">${q.status === "pending" ? `<button class="btn ghost sm" data-start>Começar análise</button>` : ""}<button class="btn ghost sm" data-all>Aprovar todos</button><button class="btn primary sm" data-save>Salvar decisões</button></div>` : ""}</details>`;
  };
  const wire = (d) => {
    const q = items.find((x) => x.id === d.dataset.id); if (!q) return;
    const dec = {};
    d.querySelectorAll(".rqi").forEach((row) => row.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
      dec[row.dataset.item] = b.dataset.d;
      row.querySelectorAll("[data-d]").forEach((x) => x.classList.toggle("primary", x === b));
      const rs = row.querySelector("[data-reason]"); if (rs) rs.hidden = b.dataset.d !== "refuse";
    })));
    d.querySelector("[data-all]")?.addEventListener("click", () => d.querySelectorAll(".rqi [data-d=approve]").forEach((b) => b.click()));
    d.querySelector("[data-start]")?.addEventListener("click", async (e) => { busy(e.currentTarget); const r = await sb.rpc("registration_start", { p_id: q.id }); if (r.error) return toast(errText(r.error)); await load(true); paint(); });
    d.querySelector("[data-save]")?.addEventListener("click", async (e) => {
      const ds = [];
      for (const row of d.querySelectorAll(".rqi")) {
        const id = Number(row.dataset.item), k = dec[row.dataset.item]; if (!k) continue;
        const reason = row.querySelector("[data-reason]")?.value.trim() || "";
        if (k === "refuse" && reason.length < 3) return toast("Informe o motivo de cada recusa.");
        ds.push({ item_id: id, decision: k, reason, force: !!row.querySelector("[data-force]")?.checked });
      }
      if (!ds.length) return toast("Escolha aprovar ou recusar em pelo menos um campo.");
      const b = e.currentTarget; busy(b);
      try {
        const r = await sb.rpc("registration_decide", { p_id: q.id, p_decisions: ds });
        if (r.error) return toast(errText(r.error));
        if (!r.data.ok) return toast("O dado oficial mudou depois do pedido. Marque “Aprovar mesmo assim” para confirmar.");
        toast(r.data.status === "in_review" ? "Decisões salvas" : "Solicitação concluída"); await load(true); paint();
      } finally { busy(b, false); }
    });
  };
  const policySheet = async () => {
    const r = await sb.rpc("registration_policy_list", { p_org: org });
    if (r.error) return toast(errText(r.error));
    const s = sheet(`<h3>Regras por campo</h3><p class="small muted">Define o que a pessoa pode mudar sozinha, o que passa por aprovação e o que só a secretaria altera.</p>
      ${r.data.map((x) => `<label class="field"><span>${esc(x.label)}</span><select data-f="${x.field}">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${k === x.mode ? "selected" : ""}>${l}</option>`).join("")}</select></label>`).join("")}`, { wide: true });
    s.el.querySelectorAll("[data-f]").forEach((sel) => sel.addEventListener("change", async () => { const rr = await sb.rpc("registration_policy_save", { p_org: org, p_field: sel.dataset.f, p_mode: sel.value }); toast(rr.error ? errText(rr.error) : "Regra salva"); }));
  };
  paint();
}

// selo de pendências para o card do Perfil e do Chamados
export async function pendingCount() {
  const org = state.org?.id; if (!org || !(canAdminOrg() || peopleCan("people_approve"))) return 0;
  const r = await sb.rpc("registration_pending_count", { p_org: org }); return r.error ? 0 : r.data || 0;
}
