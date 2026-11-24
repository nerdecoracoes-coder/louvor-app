// Cadastro de pessoas e membresia (SOMOS Chamados): base central separada das contas de acesso.
// Quem pode ver/editar/aprovar/importar é decidido no servidor (people_* e RLS); aqui só se mostra o que ele libera.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, on, empty, spinner, confirmDialog, isDeveloper, isAdmin, peopleCan, canPeople, uploadPublic, pickFile, fDate, go } from "../core.js";
import { CLASSES, CLASSES_FORM, CLASS_LABEL, STATUS_LABEL, MARITAL, MARITAL_LABEL, FORM_FIELDS, errText, templateXlsx, mapRows } from "../lib/pessoas-import.js";
import { readSpreadsheet } from "../lib/xlsx.js";
import { qrSvg } from "../lib/qr.js";

export function register(route) {
  route("/pessoas", (p, el, a) => listView(el, a));
  route("/pessoas/nova", (p, el, a) => formView(el, a, null));
  route("/pessoas/formulario", (p, el, a) => formsView(el, a));
  route("/pessoas/vincular", (p, el, a) => linkView(el, a));
  route("/pessoas/importar", (p, el, a) => importView(el, a));
  route("/pessoas/:id/editar", (p, el, a) => formView(el, a, p.id));
  route("/pessoas/:id", (p, el, a) => detailView(el, a, p.id));
  route("/cadastro/:token", (p) => publicForm(p.token), { public: true, noOrg: true });
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-24-pessoas.sql</b> no SQL Editor do Supabase.</div>`;
const PAGE = 25;
const ymdToBr = (d) => (d ? d.split("-").reverse().join("/") : "");
const cpfMask = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || "");
const zipMask = (z) => (z && z.length === 8 ? `${z.slice(0, 5)}-${z.slice(5)}` : z || "");
const head = (title, sub = "", back = "#/pessoas") => `<div class="pagehead"><a class="back" href="${back}" aria-label="Voltar">${icon("chevronLeft")}</a><h1>${esc(title)}</h1></div>${sub ? `<p class="muted small" style="margin:-8px 0 14px">${sub}</p>` : ""}`;
const clsTag = (c) => `<span class="ptag ${c}">${esc(CLASS_LABEL[c] || c)}</span>`;
const guard = (el, back = "#/") => {
  if (!state.access) { el.innerHTML = `<div class="pagehead"><h1>Pessoas</h1></div>${SETUP}`; return false; }
  if (!canPeople() && !isDeveloper()) { el.innerHTML = empty("shield", "Você não tem acesso ao cadastro de pessoas.", `<a class="link" href="${back}">Voltar</a>`); return false; }
  return true;
};
const auditNote = () => `<div class="card small">${icon("shield")} Modo auditoria: você vê as telas e as regras do módulo, mas os dados pessoais das pessoas ficam ocultos para o desenvolvedor.</div>`;

// ------------------------------------------------------------------ lista
async function listView(el, alive) {
  if (!guard(el)) return;
  const org = state.org.id;
  const st = { q: "", cls: null, status: null, order: "name", page: 0 };
  const canEdit = peopleCan("people_edit"), canImport = peopleCan("people_import");
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/chamados" aria-label="Voltar">${icon("chevronLeft")}</a><h1>Pessoas</h1>${canEdit || canImport ? `<button class="btn primary sm" id="add">${icon("plus")} Adicionar</button>` : ""}</div>
    ${peopleCan("people_view") ? `<div id="stats" class="pstats"></div>
    <div class="row gap-s mb"><label class="psearch grow" style="margin:0">${icon("search")}<input id="q" type="search" placeholder="Nome, e-mail, telefone ou CPF" autocomplete="off"></label><select id="ord" class="pord" aria-label="Ordenar"><option value="name">Nome</option><option value="recent">Recentes</option><option value="class">Tipo</option></select></div>
    <div class="chips mb" id="fil"></div>
    <div id="rows">${spinner()}</div><div id="pg" class="row between mt"></div>` : (isDeveloper() ? auditNote() : empty("lock", "Seu acesso não inclui a lista de pessoas."))}`;
  el.querySelector("#add")?.addEventListener("click", () => {
    const s = sheet(`<h3>Adicionar pessoas</h3><div class="list menu">
      ${canEdit ? `<a class="li" href="#/pessoas/nova">${icon("userPlus")}<span class="grow"><span class="t">Cadastro manual</span><span class="s">Uma pessoa por vez</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/pessoas/formulario">${icon("link")}<span class="grow"><span class="t">Formulário por link ou QR Code</span><span class="s">A própria pessoa se cadastra</span></span>${icon("chevronRight", "chev")}</a>` : ""}
      ${canImport ? `<a class="li" href="#/pessoas/vincular">${icon("users")}<span class="grow"><span class="t">Vincular usuários do app</span><span class="s">Quem já tem conta no SOMOS</span></span>${icon("chevronRight", "chev")}</a>
      <a class="li" href="#/pessoas/importar">${icon("file")}<span class="grow"><span class="t">Importar planilha</span><span class="s">Vários cadastros de uma vez (.xlsx ou .csv)</span></span>${icon("chevronRight", "chev")}</a>` : ""}</div>`);
    s.el.addEventListener("click", (e) => { if (e.target.closest("a")) s.close(); });
  });
  if (!peopleCan("people_view")) return;
  const rowsEl = el.querySelector("#rows");
  const load = async () => {
    rowsEl.innerHTML = spinner();
    const r = await sb.rpc("people_list", { p_org: org, p_q: st.q || null, p_class: st.cls, p_status: st.status, p_order: st.order, p_limit: PAGE, p_offset: st.page * PAGE });
    if (!alive()) return;
    if (r.error) { rowsEl.innerHTML = /people_list/.test(r.error.message || "") ? SETUP : empty("alert", "Não foi possível carregar.", esc(r.error.message || "")); return; }
    const { total, counts, rows } = r.data;
    const stat = (k, label, n, active) => `<button class="pstat${active ? " on" : ""}" data-k="${k}"><b>${n}</b><span>${label}</span></button>`;
    el.querySelector("#stats").innerHTML = stat("all", "Pessoas", counts.all - counts.pending < 0 ? counts.all : counts.all - counts.pending, !st.cls && !st.status) + stat("member", "Membros", counts.member, st.cls === "member") +
      stat("attender", "Frequentadores", counts.attender, st.cls === "attender") + stat("visitor", "Visitantes", counts.visitor, st.cls === "visitor") + stat("pending", "Pendentes", counts.pending, st.status === "pending");
    el.querySelector("#fil").innerHTML = [["", "Todos"], ...CLASSES, ["pending", "Pendentes"]].map(([k, l]) => `<button class="chip ${(k === "" && !st.cls && !st.status) || st.cls === k || (k === "pending" && st.status === "pending") ? "on" : ""}" data-k="${k || "all"}">${l}</button>`).join("");
    rowsEl.innerHTML = rows.length ? `<div class="list">${rows.map((p) => `<a class="li" href="#/pessoas/${p.id}">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 44, false)}
      <span class="grow"><span class="t ellipsis">${esc(p.social_name ? `${p.social_name} (${p.full_name})` : p.full_name)}</span>
        <span class="s ellipsis">${[p.phone, p.email].filter(Boolean).map(esc).join(" · ") || "Sem contato"}</span>
        <span class="row gap-s wrap" style="margin-top:6px">${clsTag(p.classification)}${p.status !== "active" ? `<span class="ptag st-${p.status}">${STATUS_LABEL[p.status]}</span>` : ""}${p.flagged_duplicate ? `<span class="ptag warn">Possível duplicidade</span>` : ""}${p.user_id ? `<span class="ptag acct">Tem conta</span>` : ""}<span class="tiny muted">desde ${esc(ymdToBr(p.registered_at))}</span></span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`
      : empty("users", st.q || st.cls || st.status ? "Ninguém encontrado" : "Nenhuma pessoa cadastrada ainda", st.q || st.cls || st.status ? "Tente outra busca ou outro filtro." : (canEdit ? `<a class="link" href="#/pessoas/nova">Cadastrar a primeira pessoa</a>` : ""));
    const pages = Math.max(1, Math.ceil(total / PAGE));
    el.querySelector("#pg").innerHTML = total > PAGE ? `<button class="btn ghost sm" id="prev" ${st.page ? "" : "disabled"}>${icon("chevronLeft")} Anterior</button><span class="small muted">${st.page + 1} de ${pages} · ${total} pessoas</span><button class="btn ghost sm" id="next" ${st.page + 1 >= pages ? "disabled" : ""}>Próxima ${icon("chevronRight")}</button>` : `<span class="small muted">${total} ${total === 1 ? "pessoa" : "pessoas"}</span>`;
  };
  const pick = (k) => { st.page = 0; st.cls = ["member", "attender", "visitor"].includes(k) ? k : null; st.status = k === "pending" ? "pending" : null; load(); };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (b) return pick(b.dataset.k);
    if (e.target.closest("#prev")) { st.page--; load(); } else if (e.target.closest("#next")) { st.page++; load(); }
  });
  let t; el.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 0; load(); }, 300); });
  el.querySelector("#ord").addEventListener("change", (e) => { st.order = e.target.value; st.page = 0; load(); });
  await load();
}

// ------------------------------------------------------------------ campos (usados no cadastro manual e em "meus dados")
const opt = (list, v, blank = "—") => `<option value="">${blank}</option>${list.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const fld = (name, label, v = "", extra = "") => `<label class="field"><span>${label}</span><input name="${name}" value="${attr(v ?? "")}" ${extra}></label>`;
export function personFields(p = {}, { admin = true, photo = true } = {}) {
  return `${photo ? `<div class="row gap mb"><span id="phimg">${avatar({ display_name: p.full_name || "?", avatar_url: p.photo_url }, 64, false)}</span><button type="button" class="btn ghost sm" id="phbtn">${icon("camera")} ${p.photo_url ? "Trocar foto" : "Adicionar foto"}</button><input type="hidden" name="photo_url" value="${attr(p.photo_url || "")}"></div>` : ""}
  <h3>Identificação</h3>
  ${fld("full_name", "Nome completo *", p.full_name, 'maxlength="160" required autocomplete="off"')}
  ${fld("social_name", "Nome de preferência / nome social", p.social_name, 'maxlength="160"')}
  <div class="grid2">${fld("birth_date", "Data de nascimento", p.birth_date, 'type="date"')}<label class="field"><span>Sexo</span><select name="sex">${opt([["F", "Feminino"], ["M", "Masculino"]], p.sex)}</select></label></div>
  <div class="grid2">${fld("cpf", "CPF", cpfMask(p.cpf), 'inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"')}<label class="field"><span>Estado civil</span><select name="marital_status">${opt(MARITAL, p.marital_status)}</select></label></div>
  <h3 class="mt">Contatos</h3>
  <div class="grid2">${fld("phone", "Telefone principal", p.phone, 'type="tel" maxlength="30"')}${fld("phone2", "Telefone secundário", p.phone2, 'type="tel" maxlength="30"')}</div>
  <div class="grid2">${fld("whatsapp", "WhatsApp", p.whatsapp, 'type="tel" maxlength="30"')}${fld("email", "E-mail", p.email, 'type="email" maxlength="200" autocomplete="off"')}</div>
  <h3 class="mt">Endereço</h3>
  ${fld("zip", "CEP", zipMask(p.zip), 'inputmode="numeric" maxlength="9" placeholder="00000-000"')}
  <div class="grid2" style="grid-template-columns:3fr 1fr">${fld("address", "Logradouro", p.address, 'maxlength="240"')}${fld("address_number", "Número", p.address_number, 'maxlength="20"')}</div>
  <div class="grid2">${fld("address_complement", "Complemento", p.address_complement, 'maxlength="120"')}${fld("neighborhood", "Bairro", p.neighborhood, 'maxlength="120"')}</div>
  <div class="grid3">${fld("city", "Cidade", p.city, 'maxlength="120"')}${fld("state", "UF", p.state, 'maxlength="2" style="text-transform:uppercase"')}${fld("country", "País", p.country, 'maxlength="80" placeholder="Brasil"')}</div>
  ${admin ? `<h3 class="mt">Dados eclesiásticos</h3>
  <div class="grid2"><label class="field"><span>Classificação</span><select name="classification">${opt(CLASSES_FORM, p.classification || "visitor", "").replace('<option value="">', '<option value="" hidden>')}</select></label>
    ${fld("joined_at", "Ingresso na membresia", p.joined_at, 'type="date"')}</div>
  ${p.id ? `<label class="field"><span>Situação</span><select name="status" ${["active", "inactive"].includes(p.status) ? "" : "disabled"}>${opt([["active", "Ativo"], ["inactive", "Inativo"]], p.status, "").replace('<option value="">', '<option value="" hidden>')}</select></label>` : ""}
  <label class="field"><span>Observações administrativas</span><textarea name="admin_notes" rows="3" maxlength="2000">${esc(p.admin_notes || "")}</textarea></label>` : ""}`;
}
export function readFields(form, { admin = true } = {}) {
  const d = Object.fromEntries(new FormData(form).entries());
  const out = {};
  for (const k of ["full_name", "social_name", "birth_date", "sex", "cpf", "marital_status", "phone", "phone2", "whatsapp", "email", "address", "address_number", "address_complement", "neighborhood", "country", "city", "state", "zip", "photo_url"]) if (k in d) out[k] = String(d[k] ?? "").trim();
  if (admin) for (const k of ["classification", "joined_at", "status", "admin_notes"]) if (k in d) out[k] = String(d[k] ?? "").trim();
  return out;
}
export function wirePhoto(root, org) {
  const b = root.querySelector("#phbtn"); if (!b) return;
  b.onclick = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    busy(b);
    try { const url = await uploadPublic(`people/${org}`, f); root.querySelector("[name=photo_url]").value = url; root.querySelector("#phimg").innerHTML = avatar({ display_name: "?", avatar_url: url }, 64, false); }
    catch (e) { toast("Não foi possível enviar a foto."); } finally { busy(b, false); }
  };
}

// ------------------------------------------------------------------ cadastro / edição
async function formView(el, alive, id) {
  if (!guard(el)) return;
  if (!peopleCan("people_edit")) { el.innerHTML = head("Pessoa") + empty("lock", "Você não pode cadastrar ou editar pessoas."); return; }
  let p = {};
  if (id) {
    el.innerHTML = spinner();
    const r = await sb.from("people").select("*").eq("id", id).maybeSingle();
    if (!alive()) return;
    if (!r.data) { el.innerHTML = head("Pessoa") + empty("userOff", "Cadastro não encontrado."); return; }
    p = r.data;
  }
  el.innerHTML = `${head(id ? "Editar cadastro" : "Nova pessoa", "", id ? `#/pessoas/${id}` : "#/pessoas")}
    <form id="f" novalidate>${personFields(p)}<div class="row gap mt"><a class="btn ghost" href="${id ? `#/pessoas/${id}` : "#/pessoas"}">Cancelar</a><button class="btn primary grow" id="ok">Salvar</button></div></form>
    ${id ? "" : `<p class="tiny muted mt">Cadastrar uma pessoa não cria conta de acesso. Só o nome é obrigatório.</p>`}`;
  wirePhoto(el, state.org.id);
  const form = el.querySelector("#f");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = readFields(form);
    if (!data.full_name) return toast("Informe o nome completo.");
    const btn = el.querySelector("#ok"); busy(btn);
    try {
      const save = (force) => sb.rpc("person_save", { p_org: state.org.id, p_id: id, p: data, p_force: !!force });
      let r = await save(false);
      if (r.error) { toast(errText(r.error)); return; }
      if (r.data && r.data.saved === false) {
        const why = r.data.duplicates.map((d) => `${d.full_name} (${CLASS_LABEL[d.classification]}, mesmo ${d.reason})`).join("; ");
        if (!(await confirmDialog(`Já existe cadastro parecido: ${why}. Salvar mesmo assim?`, "Salvar mesmo assim"))) return;
        r = await save(true);
        if (r.error) { toast(errText(r.error)); return; }
      }
      toast("Cadastro salvo"); go(`/pessoas/${r.data.id}`);
    } finally { busy(btn, false); }
  });
}

// ------------------------------------------------------------------ ficha
const FIELD_LABEL = { full_name: "Nome", social_name: "Nome de preferência", phone2: "Telefone secundário", address_number: "Número", address_complement: "Complemento", neighborhood: "Bairro", country: "País", birth_date: "Nascimento", sex: "Sexo", cpf: "CPF", marital_status: "Estado civil", phone: "Telefone", whatsapp: "WhatsApp", email: "E-mail", address: "Endereço", city: "Cidade", state: "UF", zip: "CEP", photo_url: "Foto", joined_at: "Ingresso", admin_notes: "Observações", status: "Situação", classification: "Classificação", user_id: "Conta", baptized: "Batizado", baptism_date: "Data do batismo", relation: "Vínculo" };
const KIND_LABEL = { family: "Família", guardian: "Responsável legal", team_join: "Entrou em um time", team_leave: "Saiu de um time", team_role: "Função em time", visit: "Visita", consent: "Contato", journey: "Acolhimento", create: "Cadastro criado", field: "Alteração", classification: "Classificação", approve: "Cadastro aprovado", reject: "Cadastro rejeitado", link: "Conta vinculada", self_update: "Alterado pela própria pessoa" };
const showVal = (f, v) => (v == null || v === "" ? "vazio" : f === "classification" ? CLASS_LABEL[v] || v : f === "status" ? STATUS_LABEL[v] || v : f === "marital_status" ? MARITAL_LABEL[v] || v : f === "cpf" ? cpfMask(v) : f === "zip" ? zipMask(v) : f === "sex" ? (v === "F" ? "Feminino" : "Masculino") : /date|joined/.test(f) ? ymdToBr(v) : f === "baptized" ? (v === "true" ? "sim" : "não") : f === "photo_url" ? "foto" : f === "admin_notes" ? "texto" : v);

let lastTab = { id: null, k: "resumo" };
async function detailView(el, alive, id) {
  if (!guard(el)) return;
  el.innerHTML = spinner();
  const [r, h] = await Promise.all([sb.from("people").select("*").eq("id", id).maybeSingle(), sb.from("person_history").select("*").eq("person_id", id).order("id", { ascending: false }).limit(60)]);
  if (!alive()) return;
  const p = r.data;
  if (!p) { el.innerHTML = head("Pessoa") + (isDeveloper() ? auditNote() : empty("userOff", "Cadastro não encontrado ou fora do seu alcance.")); return; }
  const canEdit = peopleCan("people_edit"), canApprove = peopleCan("people_approve");
  const tabsList = () => [["resumo", "Resumo"], ["familia", "Família"], ["igreja", "Igreja"], ["hist", "Histórico"], ...(peopleCan("people_care") ? [["pastoral", "Pastoral"]] : [])];
  if (lastTab.id !== id || !tabsList().some(([k]) => k === lastTab.k)) lastTab = { id, k: "resumo" };
  const row = (k, v) => (v ? `<div class="drow"><span>${k}</span><b>${esc(v)}</b></div>` : "");
  el.innerHTML = `${head(p.social_name || p.full_name)}
    <section class="card perscard"><div class="row gap">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 72, false)}<div class="grow"><b class="ptitle">${esc(p.full_name)}</b>${p.social_name ? `<div class="small muted">Nome social: ${esc(p.social_name)}</div>` : ""}
      <div class="row gap-s wrap" style="margin-top:8px">${clsTag(p.classification)}<span class="ptag st-${p.status}">${STATUS_LABEL[p.status]}</span>${p.user_id ? `<span class="ptag acct">Tem conta no app</span>` : `<span class="ptag">Sem conta</span>`}${p.flagged_duplicate ? `<span class="ptag warn">Possível duplicidade</span>` : ""}</div></div></div>
      ${p.status === "pending" && canApprove ? `<div class="row gap mt"><button class="btn primary grow" id="appr">Aprovar</button><button class="btn ghost" id="fix">Corrigir e aprovar</button><button class="btn danger" id="rej">Rejeitar</button></div>` : ""}
      ${canEdit ? `<div class="row gap mt"><a class="btn ghost grow" href="#/pessoas/${p.id}/editar">${icon("edit")} Editar</a>${p.status === "pending" ? "" : `<button class="btn ghost" id="cls">Mudar classificação</button>`}</div>
        <div class="row gap mt">${["active", "inactive"].includes(p.status) ? `<button class="btn ghost grow" id="tog">${p.status === "active" ? "Marcar como inativo" : "Reativar"}</button>` : ""}<button class="btn danger grow" id="del">${icon("trash")} Excluir cadastro</button></div>` : ""}</section>
    <div class="tabs" id="tabs" role="tablist">${tabsList().map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === lastTab.k ? "on" : ""}">${l}</button>`).join("")}</div><div id="pane"></div>`;
  const pane = el.querySelector("#pane"), refresh = () => detailView(el, alive, id);
  const paintTabs = () => el.querySelectorAll("#tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === lastTab.k));
  const histLine = (x) => {
    const when = esc(new Date(x.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
    let txt = `<b>${KIND_LABEL[x.kind] || x.kind}</b>`;
    if (x.kind === "family") txt += ` · ${x.new_value ? `${esc(x.new_value)}: ${esc(x.note || "")}` : `vínculo desfeito: ${esc(x.note || "")}`}`;
    else if (x.kind.startsWith("team_")) txt += ` · ${esc(x.note || "")}`;
    else { if (x.field && x.kind !== "link") txt += ` · ${FIELD_LABEL[x.field] || x.field}: <span class="muted">${esc(showVal(x.field, x.old_value))}</span> → ${esc(showVal(x.field, x.new_value))}`; if (x.note) txt += ` <span class="muted">· ${esc(x.note)}</span>`; }
    return `<div class="li col" style="align-items:flex-start"><span class="small">${txt}</span><span class="tiny muted">${when}</span></div>`;
  };
  const RESETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-26-ficha-pessoa.sql</b> no SQL Editor do Supabase.</div>`;
  const missing = (e) => /not exist|schema cache|Could not find/i.test(e?.message || "");
  let relTypes = [["spouse", "Cônjuge"], ["child", "Filho(a)"], ["father", "Pai"], ["mother", "Mãe"], ["sibling", "Irmão(ã)"], ["grandparent", "Avô/Avó"], ["grandchild", "Neto(a)"], ["other", "Outro vínculo"]];
  const ageOf = (d) => { if (!d) return null; const n = new Date(), b = new Date(d + "T00:00:00"); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };
  const age = ageOf(p.birth_date), isMinor = age != null && age < 18;
  const addr = [p.address && `${p.address}${p.address_number ? ", " + p.address_number : ""}`, p.address_complement, p.neighborhood].filter(Boolean).join(" · ");
  const GK = { parental: "Pai/mãe (poder familiar)", guardian: "Guardião(ã) legal", curator: "Curador(a)", other: "Outro responsável" };
  const stTag = (x) => (x === "inactive" ? ` · Inativo` : "");
  const panes = {
    resumo: async () => `<h3>Identificação</h3><div class="card">${row("Nome completo", p.full_name)}${row("Nome de preferência", p.social_name)}${row("Nascimento", p.birth_date ? `${ymdToBr(p.birth_date)} (${age} ${age === 1 ? "ano" : "anos"})` : "")}${row("Sexo", p.sex === "F" ? "Feminino" : p.sex === "M" ? "Masculino" : "")}${row("Estado civil", MARITAL_LABEL[p.marital_status])}${row("CPF", cpfMask(p.cpf))}${!p.social_name && !p.birth_date && !p.sex && !p.cpf && !p.marital_status ? `<span class="muted small">Só o nome foi informado.</span>` : ""}</div>
      <h3 class="mt">Contatos</h3><div class="card">${row("Telefone principal", p.phone)}${row("Telefone secundário", p.phone2)}${row("WhatsApp", p.whatsapp)}${row("E-mail", p.email)}${!p.phone && !p.phone2 && !p.whatsapp && !p.email ? `<span class="muted small">Sem contato registrado.</span>` : ""}</div>
      <h3 class="mt">Endereço</h3><div class="card">${row("CEP", zipMask(p.zip))}${row("Logradouro", addr)}${row("Cidade", p.city && `${p.city}${p.state ? "/" + p.state : ""}`)}${row("País", p.country)}${!p.zip && !addr && !p.city && !p.country ? `<span class="muted small">Sem endereço registrado.</span>` : ""}</div>
      <p class="tiny muted mt">Cadastro criado em ${ymdToBr(p.registered_at)}.</p>`,
    familia: async () => {
      const [r, tr, gr] = await Promise.all([sb.rpc("person_family", { p_person: id }), sb.rpc("relation_types_list"), sb.rpc("person_guardians", { p_person: id })]);
      if (r.error) return missing(r.error) ? RESETUP : empty("alert", "Não foi possível carregar a família.", `<button class="btn ghost sm" id="famretry">Tentar de novo</button>`);
      relTypes = (tr.data || []).map((t) => [t.key, t.label]);
      const fam = r.data || [], g = gr.error ? null : gr.data;
      const gBlock = gr.error
        ? (missing(gr.error) ? "" : `<h3 class="mt">Responsáveis legais</h3><div class="card small muted">${icon("lock")} Você não tem permissão para ver os responsáveis legais.</div>`)
        : `<div class="row between mb mt"><h3>Responsáveis legais</h3>${canEdit ? `<button class="btn ghost sm" id="gadd">${icon("plus")} Adicionar</button>` : ""}</div>
          <div class="list">${g.guardians.map((x) => `<div class="li"><a class="row gap grow" href="#/pessoas/${x.person_id}" style="min-width:0">${avatar({ display_name: x.name, avatar_url: x.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(x.name)}</span><span class="s">${GK[x.kind]}${x.note ? " · " + esc(x.note) : ""}</span></span></a>${canEdit ? `<button class="btn ghost sm" data-gedit="${x.id}" data-gk="${x.kind}" data-gn="${attr(x.note || "")}" aria-label="Alterar responsável">${icon("edit")}</button><button class="btn ghost sm" data-gdel="${x.id}" aria-label="Remover responsável">${icon("trash")}</button>` : ""}</div>`).join("") || `<div class="li muted small">${isMinor ? "Nenhum responsável legal informado." : "Nenhum responsável legal. Só é necessário para menores de idade ou pessoas sob tutela."}</div>`}</div>
          ${g.wards.length ? `<h3 class="mt">É responsável por</h3><div class="list">${g.wards.map((x) => `<div class="li"><a class="row gap grow" href="#/pessoas/${x.person_id}" style="min-width:0">${avatar({ display_name: x.name, avatar_url: x.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(x.name)}</span><span class="s">${GK[x.kind]}</span></span></a></div>`).join("")}</div>` : ""}
          <p class="tiny muted mt">Responsável legal é diferente de parentesco e não aparece para líderes de times. Cada consulta a esta parte fica registrada.</p>`;
      return `<div class="row between mb"><h3>Família</h3>${canEdit ? `<div class="row gap-s"><button class="btn ghost sm" id="famadd">${icon("plus")} Relacionar</button><button class="btn ghost sm" id="famnew">${icon("userPlus")} Novo familiar</button></div>` : ""}</div>
        <div class="list">${fam.map((f) => `<div class="li"><a class="row gap grow" href="#/pessoas/${f.relative_id}" style="min-width:0">${avatar({ display_name: f.name, avatar_url: f.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(f.name)}</span><span class="s">${esc(f.label)} · ${esc(CLASS_LABEL[f.classification] || "")}${stTag(f.status)}${f.minor ? " · Menor" : ""}</span></span></a>${canEdit ? `<button class="btn ghost sm" data-famedit="${f.id}" data-rel="${f.relation}" data-name="${attr(f.name)}" aria-label="Alterar parentesco">${icon("edit")}</button><button class="btn ghost sm" data-famdel="${f.id}" aria-label="Encerrar vínculo">${icon("trash")}</button>` : ""}</div>`).join("") || `<div class="li muted small">Nenhum familiar relacionado. Relacione quem já está cadastrado ou cadastre um familiar novo, mesmo sem conta no app.</div>`}</div>
        ${gBlock}${isAdmin() && (isMinor || (g && g.guardians.length)) ? `<button class="btn ghost sm mt" id="sacc">Quem consultou estes dados</button>` : ""}`;
    },
    igreja: async () => {
      const [lr, tr] = await Promise.all([sb.rpc("person_church_life", { p_person: id }), sb.rpc("person_teams", { p_person: id })]);
      if (lr.error) return missing(lr.error) ? RESETUP : empty("alert", "Não foi possível carregar.", esc(errText(lr.error)));
      const l = lr.data, teams = tr.data || [];
      const STAGE = { first_visit: "Primeira visita", returning: "Retorno", approach: "Aproximação", integration: "Integração" };
      return `<div class="row between mb"><h3>Vida na igreja</h3>${canEdit ? `<button class="btn ghost sm" id="bapt">${icon("edit")} Batismo</button>` : ""}</div>
        <div class="card">${row("Classificação", CLASS_LABEL[p.classification])}${row("Ingresso na membresia", ymdToBr(p.joined_at))}${row("Primeira visita", ymdToBr(l.first_visit_on))}${row("Batismo", l.baptized ? (l.baptism_date ? ymdToBr(l.baptism_date) : "Batizado(a), data não informada") : "Não informado")}${l.visits.length ? row("Visitas registradas", String(l.visits.length)) : ""}${l.visits.length ? row("Etapa do acolhimento", STAGE[l.stage]) : ""}${row("Origem do cadastro", { manual: "Cadastro manual", form: "Formulário", user: "Conta do app", import: "Planilha", self: "Própria pessoa" }[p.source])}
        ${p.admin_notes ? `<div class="drow col"><span>Observações</span><b style="font-weight:400;white-space:pre-wrap">${esc(p.admin_notes)}</b></div>` : ""}</div>
        ${l.classification_changes.length ? `<h3 class="mt">Mudanças de classificação</h3><div class="list">${l.classification_changes.map((c) => `<div class="li col" style="align-items:flex-start"><span class="small">${esc(CLASS_LABEL[c.from] || "—")} → <b>${esc(CLASS_LABEL[c.to] || "—")}</b></span><span class="tiny muted">${esc(new Date(c.at).toLocaleDateString("pt-BR"))}</span></div>`).join("")}</div>` : ""}
        ${l.visits.length ? `<h3 class="mt">Visitas</h3><div class="list">${l.visits.map((v) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${v.kind === "first" ? "Primeira visita" : "Retorno"}</b>${v.welcomed_by_name ? ` · acolhido por ${esc(v.welcomed_by_name)}` : ""}</span><span class="tiny muted">${ymdToBr(v.visited_on)}</span></div>`).join("")}</div>` : ""}
        <h3 class="mt">Times e ministérios</h3>
        <div class="list">${teams.map((t) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${esc(t.name)}</b> · ${t.role === "leader" ? "Líder" : "Integrante"}</span><span class="tiny muted">Ativo · desde ${esc(new Date(t.joined_at).toLocaleDateString("pt-BR"))}</span></div>`).join("") || `<div class="li muted small">${p.user_id ? "Não participa de nenhum time no momento." : "Sem conta no app, sem vínculos de time. Eles aparecem quando a pessoa tiver conta."}</div>`}</div>
        <p class="tiny muted mt">Participar de um time não dá permissão administrativa. As saídas ficam no Histórico.</p>`;
    },
    hist: async () => `<h3>Histórico</h3><div class="list">${(h.data || []).map(histLine).join("") || `<div class="li muted small">Sem registros.</div>`}</div>`,
    pastoral: async () => {
      const r = await sb.rpc("care_list", { p_person: id });
      if (r.error) return missing(r.error) ? RESETUP : empty("lock", "Sem acesso aos registros pastorais.", esc(errText(r.error)));
      const K = { visit: "Visita", prayer: "Oração", counsel: "Aconselhamento", other: "Outro" };
      return `<div class="card small" style="margin-bottom:12px">${icon("lock")} Acesso restrito. Cada leitura e cada registro desta aba ficam anotados. Não aparece para líderes de times nem no histórico geral.</div>
        <div class="row between mb"><h3>Acompanhamento</h3><div class="row gap-s"><button class="btn primary sm" id="careadd">${icon("plus")} Registrar</button>${isAdmin() ? `<button class="btn ghost sm" id="carelog">Quem acessou</button>` : ""}</div></div>
        <div class="list">${r.data.map((c) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${K[c.kind]}</b> · <span class="muted">${esc(c.by || "")}</span></span><span class="small" style="white-space:pre-wrap">${esc(c.note)}</span><span class="tiny muted">${esc(new Date(c.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}</span></div>`).join("") || `<div class="li muted small">Nenhum registro.</div>`}</div>`;
    },
  };
  const paint = async () => { pane.innerHTML = spinner(); const k = lastTab.k; const html = await panes[k](); if (!alive() || lastTab.k !== k) return; pane.innerHTML = html; wirePane(); };
  const wirePane = () => {
    pane.querySelector("#famretry")?.addEventListener("click", paint);
    const relSel = (cur) => `<select id="rel">${relTypes.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const first = esc((p.social_name || p.full_name).split(" ")[0]);
    const searchBox = (root, onPick) => {
      const fr = root.querySelector("#fr"); let t;
      root.querySelector("#fq").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(async () => {
        const q = e.target.value.trim(); if (q.length < 2) { fr.innerHTML = ""; return; }
        fr.innerHTML = spinner();
        const r = await sb.from("people").select("id,full_name,classification,photo_url").eq("org_id", state.org.id).neq("id", id).in("status", ["active", "inactive"]).ilike("full_name", `%${q.replace(/[%_]/g, "")}%`).order("full_name").limit(8);
        fr.innerHTML = r.error ? `<div class="li muted small">Não foi possível buscar. Tente de novo.</div>` : (r.data || []).map((x) => `<button type="button" class="li" data-pick="${x.id}" data-nm="${attr(x.full_name)}">${avatar({ display_name: x.full_name, avatar_url: x.photo_url }, 36, false)}<span class="grow"><span class="t">${esc(x.full_name)}</span><span class="s">${esc(CLASS_LABEL[x.classification] || "")}</span></span></button>`).join("") || `<div class="li muted small">Ninguém encontrado. Use "Novo familiar" para cadastrar.</div>`;
      }, 250); });
      root.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) onPick(b.dataset.pick, b.dataset.nm); });
    };
    pane.querySelector("#famadd")?.addEventListener("click", () => {
      const s = sheet(`<h3>Relacionar pessoa</h3><p class="small muted">Busque quem já está cadastrado, escolha o parentesco e confirme. Nenhum cadastro novo é criado.</p>
        <label class="field"><span>A pessoa escolhida é ... de ${first}</span>${relSel("other")}</label>
        <label class="psearch">${icon("search")}<input id="fq" type="search" placeholder="Buscar pelo nome" autocomplete="off"></label><div id="fr" class="list mt"></div>`);
      searchBox(s.el, async (rid, nm) => {
        const rel = s.el.querySelector("#rel"), lbl = rel.options[rel.selectedIndex].text;
        if (!(await confirmDialog(`Confirmar: ${nm} é ${lbl} de ${p.social_name || p.full_name}? O vínculo aparece nas duas fichas.`, "Confirmar"))) return;
        const r = await sb.rpc("person_relation_add", { p_person: id, p_relative: rid, p_relation: rel.value });
        if (r.error) return toast(errText(r.error)); toast("Familiar relacionado"); s.close(); paint();
      });
    });
    pane.querySelector("#famnew")?.addEventListener("click", () => {
      const s = sheet(`<h3>Novo familiar</h3><p class="small muted">Cria a ficha de quem não tem conta no app. Ela não vira membro automaticamente.</p>
        <form id="f" novalidate>${fld("full_name", "Nome completo *", "", 'maxlength="160" required autocomplete="off"')}
        <label class="field"><span>A pessoa nova é ... de ${first}</span>${relSel("other")}</label>
        <div class="grid2">${fld("birth_date", "Data de nascimento", "", 'type="date"')}<label class="field"><span>Sexo</span><select name="sex">${opt([["F", "Feminino"], ["M", "Masculino"]], "")}</select></label></div>
        <div class="grid2">${fld("phone", "Telefone", "", 'type="tel" maxlength="30"')}<label class="field"><span>Classificação</span><select name="classification">${opt(CLASSES_FORM, "none", "").replace('<option value="">', '<option value="" hidden>')}</select></label></div>
        <div id="dup"></div><button class="btn primary block mt" id="ok">Cadastrar e relacionar</button></form>`, { wide: true });
      const go2 = async (force) => {
        const form = s.el.querySelector("#f"), d = readFields(form, { admin: true }); delete d.photo_url;
        if (!d.full_name) return toast("Falta o nome completo.");
        const b = s.el.querySelector("#ok"); busy(b);
        try {
          const r = await sb.rpc("person_relation_create", { p_person: id, p_relation: s.el.querySelector("#rel").value, p: d, p_force: force });
          if (r.error) return toast(errText(r.error));
          if (!r.data.saved) {
            s.el.querySelector("#dup").innerHTML = `<div class="card small mt"><b>Já existe alguém parecido:</b>${r.data.duplicates.map((x) => `<div class="row between mt"><span>${esc(x.full_name)} · ${esc(CLASS_LABEL[x.classification] || "")} <span class="muted">(mesmo ${esc(x.reason)})</span></span><button type="button" class="btn ghost sm" data-use="${x.id}">É esta pessoa</button></div>`).join("")}<button type="button" class="btn ghost sm mt" id="force">É outra pessoa, cadastrar mesmo assim</button></div>`;
            s.el.querySelectorAll("[data-use]").forEach((u) => u.addEventListener("click", async () => {
              const r2 = await sb.rpc("person_relation_add", { p_person: id, p_relative: u.dataset.use, p_relation: s.el.querySelector("#rel").value });
              if (r2.error) return toast(errText(r2.error)); toast("Familiar relacionado"); s.close(); paint();
            }));
            s.el.querySelector("#force").addEventListener("click", () => go2(true)); return;
          }
          toast("Familiar cadastrado e relacionado"); s.close(); paint();
        } finally { busy(b, false); }
      };
      s.el.querySelector("#ok").addEventListener("click", (e) => { e.preventDefault(); go2(false); });
    });
    pane.querySelectorAll("[data-famedit]").forEach((b) => b.addEventListener("click", () => {
      const s = sheet(`<h3>Alterar parentesco</h3><p class="small muted">${esc(b.dataset.name)} é ... de ${first}. A mudança vale para as duas fichas.</p><label class="field"><span>Parentesco</span>${relSel(b.dataset.rel)}</label><button class="btn primary block" id="ok">Salvar</button>`);
      s.el.querySelector("#ok").onclick = async (e) => {
        const bb = e.currentTarget; busy(bb);
        try { const r = await sb.rpc("person_relation_update", { p_id: Number(b.dataset.famedit), p_relation: s.el.querySelector("#rel").value, p_from: id }); if (r.error) return toast(errText(r.error)); toast("Parentesco atualizado"); s.close(); paint(); } finally { busy(bb, false); }
      };
    }));
    pane.querySelectorAll("[data-famdel]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await confirmDialog("Encerrar este vínculo familiar? As duas pessoas continuam cadastradas e a mudança fica no histórico.", "Encerrar vínculo", true))) return;
      const r = await sb.rpc("person_relation_remove", { p_id: Number(b.dataset.famdel) }); if (r.error) return toast(errText(r.error)); toast("Vínculo encerrado"); paint();
    }));
    pane.querySelector("#gadd")?.addEventListener("click", () => {
      const s = sheet(`<h3>Adicionar responsável legal</h3><p class="small muted">Escolha quem já está cadastrado. Não é o mesmo que parentesco.</p>
        <label class="field"><span>Tipo de responsabilidade</span><select id="gk">${Object.entries(GK).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="field"><span>Observação (opcional)</span><input id="gn" maxlength="500"></label>
        <label class="psearch">${icon("search")}<input id="fq" type="search" placeholder="Buscar pelo nome" autocomplete="off"></label><div id="fr" class="list mt"></div>`);
      searchBox(s.el, async (rid, nm) => {
        if (!(await confirmDialog(`Confirmar ${nm} como responsável legal de ${p.social_name || p.full_name}?`, "Confirmar"))) return;
        const r = await sb.rpc("guardian_add", { p_ward: id, p_guardian: rid, p_kind: s.el.querySelector("#gk").value, p_note: s.el.querySelector("#gn").value });
        if (r.error) return toast(errText(r.error)); toast("Responsável adicionado"); s.close(); paint();
      });
    });
    pane.querySelectorAll("[data-gedit]").forEach((b) => b.addEventListener("click", () => {
      const s = sheet(`<h3>Alterar responsabilidade</h3><label class="field"><span>Tipo</span><select id="gk">${Object.entries(GK).map(([k, l]) => `<option value="${k}" ${k === b.dataset.gk ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Observação</span><input id="gn" maxlength="500" value="${attr(b.dataset.gn)}"></label><button class="btn primary block" id="ok">Salvar</button>`);
      s.el.querySelector("#ok").onclick = async (e) => {
        const bb = e.currentTarget; busy(bb);
        try { const r = await sb.rpc("guardian_update", { p_id: Number(b.dataset.gedit), p_kind: s.el.querySelector("#gk").value, p_note: s.el.querySelector("#gn").value }); if (r.error) return toast(errText(r.error)); toast("Atualizado"); s.close(); paint(); } finally { busy(bb, false); }
      };
    }));
    pane.querySelectorAll("[data-gdel]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await confirmDialog("Remover este responsável legal? As duas pessoas continuam cadastradas e a mudança fica no histórico.", "Remover", true))) return;
      const r = await sb.rpc("guardian_remove", { p_id: Number(b.dataset.gdel) }); if (r.error) return toast(errText(r.error)); toast("Responsável removido"); paint();
    }));
    pane.querySelector("#sacc")?.addEventListener("click", async () => {
      const r = await sb.rpc("person_access_history", { p_person: id });
      sheet(`<h3>Quem consultou</h3><div class="list">${(r.data || []).map((x) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${esc(x.by || "—")}</b> · ${x.area === "guardians" ? "responsáveis legais" : "família de menor"}</span><span class="tiny muted">${esc(new Date(x.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}</span></div>`).join("") || `<div class="li muted small">Nenhuma consulta registrada.</div>`}</div>`);
    });
    pane.querySelector("#bapt")?.addEventListener("click", async () => {
      const cur = (await sb.rpc("person_church_life", { p_person: id })).data || {};
      const s = sheet(`<h3>Batismo</h3><label class="li" style="border:0;min-height:0;padding:0 0 14px"><input type="checkbox" id="bz" ${cur.baptized ? "checked" : ""}><span class="grow s">Batizado(a)</span></label>
        <label class="field"><span>Data do batismo (se souber)</span><input type="date" id="bd" value="${attr(cur.baptism_date || "")}" max="${new Date().toISOString().slice(0, 10)}"></label><button class="btn primary block" id="ok">Salvar</button>`);
      s.el.querySelector("#ok").onclick = async (e) => {
        const b = e.currentTarget; busy(b);
        try { const r = await sb.rpc("person_church_life_save", { p_person: id, p: { baptized: s.el.querySelector("#bz").checked, baptism_date: s.el.querySelector("#bd").value || null } });
          if (r.error) return toast(/invalid_date/.test(r.error.message) ? "Data inválida." : errText(r.error)); toast("Batismo atualizado"); s.close(); refresh(); } finally { busy(b, false); }
      };
    });
    pane.querySelector("#careadd")?.addEventListener("click", () => {
      const s = sheet(`<h3>Registrar acompanhamento</h3><p class="small muted">Acesso restrito e registrado.</p>
        <label class="field"><span>Tipo</span><select id="k"><option value="visit">Visita</option><option value="prayer">Oração</option><option value="counsel">Aconselhamento</option><option value="other">Outro</option></select></label>
        <label class="field"><span>Registro</span><textarea id="n" rows="4" maxlength="4000"></textarea></label><button class="btn primary block" id="ok">Salvar</button>`);
      s.el.querySelector("#ok").onclick = async (e) => {
        const b = e.currentTarget; busy(b);
        try { const r = await sb.rpc("care_add", { p_person: id, p_kind: s.el.querySelector("#k").value, p_note: s.el.querySelector("#n").value });
          if (r.error) return toast(/note_required/.test(r.error.message) ? "Escreva o registro." : errText(r.error)); toast("Registrado"); s.close(); paint(); } finally { busy(b, false); }
      };
    });
    pane.querySelector("#carelog")?.addEventListener("click", async () => {
      const r = await sb.rpc("care_access_log", { p_person: id });
      sheet(`<h3>Quem acessou</h3><div class="list">${(r.data || []).map((x) => `<div class="li col" style="align-items:flex-start"><span class="small"><b>${esc(x.by || "—")}</b> · ${x.action === "read" ? "leu" : "registrou"}</span><span class="tiny muted">${esc(new Date(x.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}</span></div>`).join("") || `<div class="li muted small">Nenhum acesso.</div>`}</div>`);
    });
  };
  el.querySelector("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b || b.dataset.tab === lastTab.k) return; lastTab = { id, k: b.dataset.tab }; paintTabs(); paint(); });
  paint();
  const review = async (decision, extra = {}) => {
    const r2 = await sb.rpc("person_review", { p_id: id, p_decision: decision, p: extra });
    if (r2.error) return toast(errText(r2.error));
    toast(decision === "approve" ? "Cadastro aprovado" : "Cadastro rejeitado"); detailView(el, alive, id);
  };
  el.querySelector("#appr")?.addEventListener("click", () => review("approve"));
  el.querySelector("#rej")?.addEventListener("click", async () => { if (await confirmDialog("Rejeitar este cadastro? Ele sai da lista de pendentes e o histórico é mantido.", "Rejeitar", true)) review("reject"); });
  el.querySelector("#fix")?.addEventListener("click", () => {
    const s = sheet(`<h3>Corrigir e aprovar</h3><form id="f" novalidate>${fld("full_name", "Nome completo", p.full_name, 'maxlength="160"')}${fld("phone", "Telefone", p.phone, 'type="tel"')}${fld("email", "E-mail", p.email, 'type="email"')}${fld("cpf", "CPF", cpfMask(p.cpf), 'inputmode="numeric"')}
      <label class="field"><span>Classificação</span><select name="classification">${opt(CLASSES, p.classification, "").replace('<option value="">', '<option value="" hidden>')}</select></label><button class="btn primary block" id="ok">Aprovar com correções</button></form>`);
    s.el.querySelector("#ok").onclick = async (e) => { e.preventDefault(); const b = e.currentTarget; busy(b); try { const d = readFields(s.el.querySelector("#f")); await review("approve", d); s.close(); } finally { busy(b, false); } };
  });
  el.querySelector("#tog")?.addEventListener("click", async () => {
    const to = p.status === "active" ? "inactive" : "active";
    if (to === "inactive" && !(await confirmDialog("Marcar como inativo? A pessoa deixa de contar nos totais, mas o cadastro e o histórico ficam guardados.", "Marcar como inativo"))) return;
    const r2 = await sb.rpc("person_save", { p_org: state.org.id, p_id: id, p: { status: to } });
    if (r2.error) return toast(errText(r2.error)); toast(to === "inactive" ? "Marcado como inativo" : "Cadastro reativado"); detailView(el, alive, id);
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Excluir o cadastro de ${p.full_name}? Os dados e o histórico dele são apagados e isso não pode ser desfeito.${p.user_id ? " A conta no app continua existindo." : ""} Se a pessoa só saiu da igreja, prefira marcar como inativo.`, "Excluir", true))) return;
    const r2 = await sb.rpc("person_delete", { p_id: id });
    if (r2.error) return toast(/person_delete/.test(r2.error.message || "") ? "Falta rodar a atualização do banco (atualizacao-2026-11-24-pessoas-excluir.sql)." : errText(r2.error));
    toast("Cadastro excluído"); go("/pessoas");
  });
  el.querySelector("#cls")?.addEventListener("click", () => {
    const s = sheet(`<h3>Mudar classificação</h3><p class="small muted">O histórico guarda quem mudou e quando.</p><div class="seg2" style="grid-template-columns:1fr">${CLASSES.map(([k, l]) => `<label><input type="radio" name="c" value="${k}" ${k === p.classification ? "checked" : ""}><span><b>${l}</b></span></label>`).join("")}</div><button class="btn primary block mt" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => {
      const v = s.el.querySelector("[name=c]:checked")?.value; if (!v || v === p.classification) return s.close();
      const b = e.currentTarget; busy(b);
      try { const r2 = await sb.rpc("person_save", { p_org: state.org.id, p_id: id, p: { classification: v } }); if (r2.error) return toast(errText(r2.error)); toast("Classificação atualizada"); s.close(); detailView(el, alive, id); } finally { busy(b, false); }
    };
  });
}

// ------------------------------------------------------------------ formulário compartilhável
const formUrl = (token) => `${location.origin}${location.pathname.replace(/index\.html$/, "")}#/cadastro/${token}`;
async function formsView(el, alive) {
  if (!guard(el)) return;
  if (!peopleCan("people_edit")) { el.innerHTML = head("Formulário") + empty("lock", "Você não pode gerenciar formulários."); return; }
  el.innerHTML = spinner();
  const r = await sb.from("people_forms").select("*").eq("org_id", state.org.id).order("created_at", { ascending: false });
  if (!alive()) return;
  if (r.error) { el.innerHTML = head("Formulário") + SETUP; return; }
  const forms = r.data || [];
  el.innerHTML = `${head("Formulário de cadastro", "A pessoa abre o link, preenche e o cadastro chega aqui. O formulário nunca dá acesso ao app nem a ministérios.")}
    <div class="row between mb"><h3>Seus formulários</h3><button class="btn primary sm" id="new">${icon("plus")} Novo formulário</button></div>
    <div class="list">${forms.map((f) => `<div class="li col" style="align-items:stretch"><div class="row between"><b>${esc(f.title)}</b><span class="ptag ${f.active ? "st-active" : "st-inactive"}">${f.active ? "Recebendo" : "Desativado"}</span></div>
      <span class="small muted">Entram como ${esc(CLASS_LABEL[f.initial_classification])} · ${f.requires_approval ? "precisam de aprovação" : "entram direto na base"} · ${f.fields.length} campos além do nome</span>
      <div class="row gap-s wrap" style="margin-top:8px"><button class="btn ghost sm" data-share="${f.id}">${icon("share")} Compartilhar</button><button class="btn ghost sm" data-edit="${f.id}">Editar</button></div></div>`).join("") || `<div class="li muted small">Nenhum formulário criado ainda.</div>`}</div>`;
  const byId = (id) => forms.find((f) => f.id === id);
  const editor = (f) => {
    const has = new Set(f?.fields || ["phone", "whatsapp", "email", "birth_date"]);
    const s = sheet(`<h3>${f ? "Editar formulário" : "Novo formulário"}</h3><form id="f" novalidate>
      <label class="field"><span>Título</span><input name="title" maxlength="120" value="${attr(f?.title || "Cadastro de pessoas")}"></label>
      <div class="field"><span>Campos pedidos (além do nome, sempre pedido)</span><div class="chips" style="flex-wrap:wrap">${FORM_FIELDS.map(([k, l]) => `<label class="chip"><input type="checkbox" value="${k}" ${has.has(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
      <label class="field"><span>Classificação inicial</span><select name="cls">${opt(CLASSES, f?.initial_classification || "visitor", "").replace('<option value="">', '<option value="" hidden>')}</select></label>
      <label class="chip" style="margin-bottom:14px"><input type="checkbox" name="appr" ${f?.requires_approval === false ? "" : "checked"}> Exigir aprovação antes de entrar na base</label>
      ${f ? `<label class="chip" style="margin-bottom:14px"><input type="checkbox" name="act" ${f.active ? "checked" : ""}> Formulário ativo (recebendo cadastros)</label>` : ""}
      <button class="btn primary block" id="ok">Salvar</button></form>`);
    s.el.querySelector("#ok").onclick = async (e) => {
      e.preventDefault(); const b = e.currentTarget, q = s.el; busy(b);
      try {
        const rr = await sb.rpc("people_form_save", { p_org: state.org.id, p_id: f?.id || null, p: { title: q.querySelector("[name=title]").value.trim(), fields: [...q.querySelectorAll(".chips input:checked")].map((i) => i.value), initial_classification: q.querySelector("[name=cls]").value, requires_approval: q.querySelector("[name=appr]").checked, ...(f ? { active: q.querySelector("[name=act]").checked } : {}) } });
        if (rr.error) return toast(errText(rr.error));
        s.close(); toast("Formulário salvo"); await formsView(el, alive);
        if (!f) { const nf = (await sb.from("people_forms").select("*").eq("id", rr.data).maybeSingle()).data; if (nf) share(nf); }
      } finally { busy(b, false); }
    };
  };
  const share = (f) => {
    const url = formUrl(f.token);
    const s = sheet(`<h3>${esc(f.title)}</h3><div class="qrbox">${qrSvg(url, { size: 220 })}</div>
      <input class="input" id="u" readonly value="${attr(url)}" style="margin-top:12px"><div class="row gap mt"><button class="btn ghost grow" id="cp">${icon("copy")} Copiar link</button>${navigator.share ? `<button class="btn primary grow" id="sh">${icon("share")} Compartilhar</button>` : ""}</div>
      <button class="btn ghost block mt-s" id="dl">Baixar QR Code</button>${f.active ? "" : `<p class="small warn mt-s">Este formulário está desativado e não recebe cadastros.</p>`}`);
    s.el.querySelector("#u").addEventListener("focus", (e) => e.target.select());
    s.el.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copiado"); } catch { s.el.querySelector("#u").select(); toast("Selecione e copie o link"); } };
    s.el.querySelector("#sh")?.addEventListener("click", () => navigator.share({ title: f.title, text: `${f.title} — ${state.org.name}`, url }).catch(() => {}));
    s.el.querySelector("#dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([qrSvg(url, { size: 600 })], { type: "image/svg+xml" })); a.download = "qrcode-cadastro.svg"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  };
  el.querySelector("#new").onclick = () => editor(null);
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-share],[data-edit]"); if (!b) return; if (b.dataset.share) share(byId(b.dataset.share)); else editor(byId(b.dataset.edit)); });
}

// ------------------------------------------------------------------ página pública (sem login)
async function publicForm(token) {
  const root = document.getElementById("app");
  const shell = (inner) => `<div class="backdrop"></div><div class="auth"><div class="box">${inner}</div></div>`;
  root.innerHTML = shell(spinner());
  const r = await sb.rpc("people_form_get", { p_token: token });
  const f = r.data;
  if (!f) { root.innerHTML = shell(`<h1>Formulário indisponível</h1><p class="sub">Este link não está recebendo cadastros. Peça um novo link à igreja.</p>`); return; }
  const T = Object.fromEntries(FORM_FIELDS);
  const input = (k) => k === "sex" ? `<label class="field"><span>${T[k]}</span><select name="sex">${opt([["F", "Feminino"], ["M", "Masculino"]], "")}</select></label>`
    : k === "marital_status" ? `<label class="field"><span>${T[k]}</span><select name="marital_status">${opt(MARITAL, "")}</select></label>`
    : fld(k, T[k], "", k === "birth_date" ? 'type="date"' : k === "email" ? 'type="email" maxlength="200"' : k === "phone" || k === "whatsapp" ? 'type="tel" maxlength="30"' : k === "cpf" ? 'inputmode="numeric" maxlength="14" placeholder="000.000.000-00"' : k === "zip" ? 'inputmode="numeric" maxlength="9" placeholder="00000-000"' : k === "state" ? 'maxlength="2" style="text-transform:uppercase"' : 'maxlength="240"');
  root.innerHTML = shell(`<div class="logo">${f.logo_url ? `<img src="${attr(f.logo_url)}" alt="${attr(f.org_name)}" style="max-height:64px">` : ""}</div><h1>${esc(f.title)}</h1><p class="sub">${esc(f.org_name)}${f.org_subtitle ? ` · ${esc(f.org_subtitle)}` : ""}</p>
    <form id="f" novalidate>${fld("full_name", "Nome completo *", "", 'maxlength="160" required autocomplete="name"')}${f.fields.map(input).join("")}
      <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0">
      <p class="tiny muted">Seus dados são usados apenas pela igreja para o seu cadastro e ficam protegidos.</p>
      <button class="btn primary block" id="ok">Enviar cadastro</button></form>`);
  const form = root.querySelector("#f");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    if (!String(d.full_name || "").trim()) return toast("Informe seu nome completo.");
    const btn = root.querySelector("#ok"); busy(btn);
    try {
      const rr = await sb.rpc("people_form_submit", { p_token: token, p: d });
      if (rr.error) return toast(errText(rr.error));
      root.innerHTML = shell(`<h1>Cadastro enviado</h1><p class="sub">Obrigado! A igreja recebeu seus dados.</p>`);
    } finally { busy(btn, false); }
  });
}

// ------------------------------------------------------------------ vincular usuários existentes
async function linkView(el, alive) {
  if (!guard(el)) return;
  if (!peopleCan("people_import")) { el.innerHTML = head("Vincular usuários") + empty("lock", "Você não pode vincular usuários."); return; }
  const org = state.org.id, sel = new Set(); let cls = "member", q = "", users = [];
  el.innerHTML = `${head("Vincular usuários", "Traz para a base de pessoas quem já tem conta no app. Nenhuma conta, time, função ou dado é alterado.")}
    <label class="psearch">${icon("search")}<input id="q" type="search" placeholder="Buscar por nome ou e-mail" autocomplete="off"></label>
    <label class="field"><span>Classificar os selecionados como</span><select id="cls">${opt(CLASSES, cls, "").replace('<option value="">', '<option value="" hidden>')}</select></label>
    <div id="rows">${spinner()}</div><div class="fabbar"><button class="btn primary block" id="go" disabled>Vincular selecionados</button></div>`;
  const paint = () => {
    el.querySelector("#rows").innerHTML = users.length ? `<div class="row between mb"><span class="small muted">${users.length} sem cadastro</span><button class="btn ghost sm" id="all">${users.every((u) => sel.has(u.user_id)) ? "Limpar seleção" : "Selecionar todos"}</button></div>
      <div class="list">${users.map((u) => `<label class="li"><input type="checkbox" data-u="${u.user_id}" ${sel.has(u.user_id) ? "checked" : ""}>${avatar({ display_name: u.name, avatar_url: u.avatar_url }, 40, false)}<span class="grow"><span class="t ellipsis">${esc(u.name)}</span><span class="s ellipsis">${esc(u.email || "")}</span>${u.candidate ? `<span class="ptag warn" style="margin-top:6px;display:inline-block">Já existe cadastro com este e-mail: ${esc(u.candidate.full_name)}</span>` : ""}</span></label>`).join("")}</div>`
      : empty("users", q ? "Ninguém encontrado" : "Todos já estão na base de pessoas");
    el.querySelector("#go").disabled = !sel.size; el.querySelector("#go").textContent = sel.size ? `Vincular ${sel.size} ${sel.size === 1 ? "pessoa" : "pessoas"}` : "Vincular selecionados";
  };
  const load = async () => { const r = await sb.rpc("people_linkable_users", { p_org: org, p_q: q || null }); if (!alive()) return; if (r.error) { el.querySelector("#rows").innerHTML = empty("alert", errText(r.error)); return; } users = r.data || []; paint(); };
  let t; el.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load(); }, 300); });
  el.querySelector("#cls").addEventListener("change", (e) => { cls = e.target.value; });
  el.addEventListener("change", (e) => { const c = e.target.closest("[data-u]"); if (!c) return; c.checked ? sel.add(c.dataset.u) : sel.delete(c.dataset.u); paint(); });
  el.addEventListener("click", (e) => { if (e.target.closest("#all")) { const all = users.every((u) => sel.has(u.user_id)); users.forEach((u) => (all ? sel.delete(u.user_id) : sel.add(u.user_id))); paint(); } });
  const run = async (resolve = {}) => {
    const btn = el.querySelector("#go"); busy(btn);
    try {
      const r = await sb.rpc("people_link_users", { p_org: org, p_user_ids: [...sel], p_classification: cls, p_resolve: resolve });
      if (r.error) return toast(errText(r.error));
      const { linked, created, conflicts } = r.data;
      if (conflicts.length) {
        const s = sheet(`<h3>Revise antes de vincular</h3><p class="small muted">Já existe um cadastro com o mesmo e-mail. Escolha o que fazer; nada é sobrescrito, só campos vazios são completados.</p>
          ${conflicts.map((c) => `<div class="card mb"><b>${esc(c.name)}</b><div class="small muted">Cadastro existente: ${esc(c.person_name)}</div><select data-c="${c.user_id}" class="mt-s"><option value="${c.person_id}">Vincular a este cadastro</option><option value="new">Criar um cadastro novo</option></select></div>`).join("")}
          <button class="btn primary block" id="ok">Confirmar</button>`);
        s.el.querySelector("#ok").onclick = async () => { const map = {}; s.el.querySelectorAll("[data-c]").forEach((x) => (map[x.dataset.c] = x.value)); s.close(); await run({ ...resolve, ...map }); };
        if (linked + created) { toast(`${linked + created} vinculados`); }
        return;
      }
      toast(`${linked + created} ${linked + created === 1 ? "pessoa vinculada" : "pessoas vinculadas"}`); sel.clear(); await load();
    } finally { busy(btn, false); }
  };
  el.querySelector("#go").onclick = () => run();
  await load();
}

// ------------------------------------------------------------------ importação de planilha
async function importView(el, alive) {
  if (!guard(el)) return;
  if (!peopleCan("people_import")) { el.innerHTML = head("Importar planilha") + empty("lock", "Você não pode importar planilhas."); return; }
  const org = state.org.id; let records = [];
  el.innerHTML = `${head("Importar planilha", "Baixe o modelo, preencha e envie. Antes de importar você revisa tudo; cadastros que já existem não são substituídos.")}
    <div class="card"><div class="row gap"><span class="ico-lg">${icon("file")}</span><div class="grow"><b>1. Baixe a planilha modelo</b><div class="small muted">Colunas: nome, nascimento, e-mail, telefone, CPF, estado civil, endereço, cidade, estado, CEP, classificação e ingresso.</div></div></div><button class="btn ghost block mt" id="tpl">${icon("download")} Baixar modelo (.xlsx)</button></div>
    <div class="card mt"><b>2. Envie a planilha preenchida</b><div class="small muted">Aceita .xlsx e .csv.</div><button class="btn primary block mt" id="pick">${icon("upload")} Escolher arquivo</button></div>
    <div id="prev"></div>`;
  el.querySelector("#tpl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([templateXlsx()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = "modelo-importacao-pessoas.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const prev = el.querySelector("#prev");
  el.querySelector("#pick").onclick = async () => {
    const f = await pickFile(".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); if (!f) return;
    prev.innerHTML = spinner();
    try {
      const rows = await readSpreadsheet(f), m = mapRows(rows);
      if (m.missing.length) { prev.innerHTML = `<div class="card mt warn">A planilha precisa ter a coluna <b>${m.missing[0]}</b> na primeira linha. Use o modelo para conferir.</div>`; return; }
      records = m.records;
      if (!records.length) { prev.innerHTML = `<div class="card mt">Nenhuma linha com dados foi encontrada.</div>`; return; }
      if (records.length > 5000) { prev.innerHTML = `<div class="card mt warn">A planilha tem ${records.length} linhas. O limite é 5.000 por vez; divida o arquivo.</div>`; return; }
      const r = await sb.rpc("people_import", { p_org: org, p_rows: records, p_allow_dupes: false, p_dry_run: true });
      if (!alive()) return;
      if (r.error) { prev.innerHTML = `<div class="card mt warn">${esc(errText(r.error))}</div>`; return; }
      showPreview(r.data, m.ignored, f.name);
    } catch (e) { prev.innerHTML = `<div class="card mt warn">${esc(errText(e))}</div>`; }
  };
  const showPreview = (d, ignored, name) => {
    const nm = (i) => records[i - 1]?.full_name || "(sem nome)";
    prev.innerHTML = `<h3 class="mt">3. Revise</h3><p class="small muted">${esc(name)}</p>
      <div class="pstats"><div class="pstat"><b>${d.total}</b><span>Registros</span></div><div class="pstat ok"><b>${d.inserted}</b><span>Válidos</span></div><div class="pstat ${d.errors.length ? "bad" : ""}"><b>${d.errors.length}</b><span>Com erro</span></div><div class="pstat ${d.duplicates.length ? "warn" : ""}"><b>${d.duplicates.length}</b><span>Possíveis duplicidades</span></div></div>
      ${ignored.length ? `<p class="small muted">Colunas ignoradas: ${ignored.map(esc).join(", ")}.</p>` : ""}
      ${d.errors.length ? `<h4 class="mt">Problemas (não serão importados)</h4><div class="list">${d.errors.slice(0, 50).map((e) => `<div class="li"><span class="grow"><span class="t">Linha ${e.row + 1} · ${esc(nm(e.row))}</span><span class="s">${esc(errText(e.error))}</span></span></div>`).join("")}</div>${d.errors.length > 50 ? `<p class="tiny muted">E mais ${d.errors.length - 50}.</p>` : ""}` : ""}
      ${d.duplicates.length ? `<h4 class="mt">Possíveis duplicidades (ficam de fora)</h4><div class="list">${d.duplicates.slice(0, 50).map((e) => `<div class="li"><span class="grow"><span class="t">Linha ${e.row + 1} · ${esc(e.name)}</span><span class="s">Já existe cadastro com o mesmo CPF, e-mail ou nome e nascimento</span></span></div>`).join("")}</div>
        <label class="chip mt"><input type="checkbox" id="dup"> Importar mesmo assim (marcar como possível duplicidade)</label>` : ""}
      <button class="btn primary block mt" id="run" ${d.inserted || d.duplicates.length ? "" : "disabled"}>Importar ${d.inserted} ${d.inserted === 1 ? "cadastro" : "cadastros"}</button>`;
    prev.querySelector("#dup")?.addEventListener("change", (e) => { const n = d.inserted + (e.target.checked ? d.duplicates.length : 0); prev.querySelector("#run").textContent = `Importar ${n} ${n === 1 ? "cadastro" : "cadastros"}`; });
    prev.querySelector("#run").onclick = async (e) => {
      const b = e.currentTarget, allow = !!prev.querySelector("#dup")?.checked;
      if (!(await confirmDialog(`Importar ${d.inserted + (allow ? d.duplicates.length : 0)} cadastros agora? Se algo der errado, nada é gravado pela metade.`, "Importar"))) return;
      busy(b);
      try {
        const r = await sb.rpc("people_import", { p_org: org, p_rows: records, p_allow_dupes: allow, p_dry_run: false });
        if (r.error) return toast(errText(r.error) + " Nada foi importado.");
        const x = r.data;
        prev.innerHTML = `<div class="card mt"><b>${x.inserted} ${x.inserted === 1 ? "pessoa importada" : "pessoas importadas"}</b><div class="small muted">${x.skipped_duplicates} ignoradas por duplicidade · ${x.errors.length} com erro</div>
          <div class="row gap mt"><a class="btn primary grow" href="#/pessoas">Ver pessoas</a><button class="btn ghost" id="undo">Desfazer importação</button></div></div>`;
        prev.querySelector("#undo").onclick = async () => {
          if (!(await confirmDialog("Remover os cadastros desta importação? Os que já foram editados depois ficam.", "Desfazer", true))) return;
          const u = await sb.rpc("people_import_undo", { p_org: org, p_batch: x.batch });
          if (u.error) return toast(errText(u.error));
          toast(`${u.data} cadastros removidos`); prev.innerHTML = "";
        };
      } finally { busy(b, false); }
    };
  };
}

// ------------------------------------------------------------------ meus dados cadastrais (usado no Perfil)
export async function myRegistrationCard(host) {
  const org = state.org?.id; if (!org) return;
  const r = await sb.rpc("my_person", { p_org: org });
  if (r.error) return; // banco ainda sem a atualização: não mostra nada
  const p = r.data;
  host.innerHTML = `<section class="card"><div class="row between"><h3>Meus dados cadastrais</h3>${p ? `<span class="ptag ${p.classification}">${esc(CLASS_LABEL[p.classification])}</span>` : ""}</div>
    <p class="small muted">${p ? "Estes dados ficam no cadastro da igreja. Só a secretaria altera sua classificação." : "A igreja ainda não tem seus dados cadastrais. Preencha se quiser."}</p>
    <button class="btn ghost block mt" id="mydata">${p ? "Ver e editar meus dados" : "Preencher meus dados"}</button></section>`;
  host.querySelector("#mydata").onclick = () => {
    const s = sheet(`<h3>Meus dados</h3><form id="f" novalidate>${personFields(p || { full_name: state.profile?.full_name || "" }, { admin: false, photo: false })}<button class="btn primary block mt" id="ok">Salvar</button></form>`, { wide: true });
    s.el.querySelector("#ok").onclick = async (e) => {
      e.preventDefault(); const b = e.currentTarget; busy(b);
      try {
        const rr = await sb.rpc("my_person_update", { p_org: org, p: readFields(s.el.querySelector("#f"), { admin: false }) });
        if (rr.error) return toast(errText(rr.error));
        toast("Dados salvos"); s.close(); myRegistrationCard(host);
      } finally { busy(b, false); }
    };
  };
}
