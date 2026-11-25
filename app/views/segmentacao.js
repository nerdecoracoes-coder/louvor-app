// Segmentação de Pessoas (SOMOS Chamados → Pessoas): segmentos dinâmicos (construtor de critérios), grupos manuais e histórico.
// Os critérios são avaliados no servidor sobre a Ficha; aqui só se monta o formulário e se mostra a prévia.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog, peopleCan, canAdminOrg } from "../core.js";
import { errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/segmentacao", (p, el, a) => home(el, a, "segmentos"));
  route("/segmentacao/grupos", (p, el, a) => home(el, a, "grupos"));
  route("/segmentacao/novo", (p, el, a) => segEditor(el, a, null));
  route("/segmentacao/s/:id", (p, el, a) => segDetail(el, a, p.id));
  route("/segmentacao/g/:id", (p, el, a) => groupDetail(el, a, p.id));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-04-segmentacao-carteira.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const CLS = { member: "Membro", attender: "Frequentador", visitor: "Visitante" };
const day = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
const when = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const head = (t, back = ["#/chamados", "SOMOS Chamados"]) => `<div class="pagehead"><h1>${esc(t)}</h1></div>${back ? `<div class="mb"><a class="btn ghost sm" href="${back[0]}">${icon("chevronLeft")} ${esc(back[1])}</a></div>` : ""}`;
const fail = (el, title, e, back) => { el.innerHTML = `${head(title, back)}${missing(e) ? SETUP : empty("lock", /forbidden|not_found/.test(e?.message || "") ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(e)))}`; };
const tag = (c) => `<span class="ptag ${c === "member" ? "member" : c === "attender" ? "attender" : "none"}">${CLS[c] || c}</span>`;
let OPT = null, OPT_ORG = "";
async function options() { const org = state.org?.id; if (OPT && OPT_ORG === org) return { data: OPT }; const r = await sb.rpc("segment_options", { p_org: org }); if (!r.error) { OPT = r.data; OPT_ORG = org; } return r; }
const personRow = (i, extra = "") => `<div class="li">${avatar({ display_name: i.name, avatar_url: i.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(i.name)}</span><span class="s">${tag(i.classification)}${i.status === "inactive" ? " · inativo" : ""}${i.age != null ? ` · ${i.age} anos` : ""}${(i.links || []).length ? ` · ${esc(i.links.join(", "))}` : ""}</span></span>${extra}</div>`;

// ---------------------------------------------------------------- início: segmentos e grupos
async function home(el, alive, tab) {
  const org = state.org?.id; el.innerHTML = `${head("Segmentação de Pessoas")}${spinner()}`;
  const o = await options(); if (!alive()) return; if (o.error) return fail(el, "Segmentação de Pessoas", o.error);
  const can = o.data.can;
  el.innerHTML = `${head("Segmentação de Pessoas")}
    <nav class="tabs"><a href="#/segmentacao" class="${tab === "segmentos" ? "on" : ""}">Segmentos</a><a href="#/segmentacao/grupos" class="${tab === "grupos" ? "on" : ""}">Grupos manuais</a></nav>
    <div class="row gap mb"><input class="psearch grow" id="q" type="search" placeholder="Pesquisar por nome" aria-label="Pesquisar"><select id="ord" aria-label="Ordenar">${tab === "segmentos" ? `<option value="name">Nome</option><option value="count">Mais pessoas</option><option value="recent">Atualizados</option>` : `<option value="name">Nome</option>`}</select>
      <select id="st" aria-label="Situação"><option value="">Todos</option>${tab === "segmentos" ? `<option value="active">Ativos</option><option value="inactive">Desativados</option>` : `<option value="active">Ativos</option><option value="inactive">Inativos</option><option value="closed">Encerrados</option>`}</select>
      ${tab === "segmentos" ? (can.people_segments_create ? `<a class="btn sm" href="#/segmentacao/novo">${icon("plus")} Novo</a>` : "") : (can.people_groups_create ? `<button class="btn sm" id="newg">${icon("plus")} Novo</button>` : "")}</div>
    <div id="list">${spinner()}</div>`;
  const list = el.querySelector("#list");
  const load = async () => {
    const p = { q: el.querySelector("#q").value, status: el.querySelector("#st").value, order: el.querySelector("#ord").value };
    const r = await sb.rpc(tab === "segmentos" ? "segment_list" : "group_list", { p_org: org, p }); if (!alive()) return;
    if (r.error) { list.innerHTML = missing(r.error) ? SETUP : empty("alert", "Não foi possível carregar.", esc(errText(r.error))); return; }
    list.innerHTML = r.data.length ? `<div class="list">${r.data.map((s) => tab === "segmentos"
      ? `<a class="li" href="#/segmentacao/s/${s.id}">${icon("users")}<span class="grow"><span class="t">${esc(s.name)}${s.active ? "" : " (desativado)"}</span><span class="s">${s.count} ${s.count === 1 ? "pessoa" : "pessoas"} · ${esc(s.kind === "roles" ? "Funções" : s.kind === "links" ? "Vínculos" : "Dinâmico")}${s.description ? " · " + esc(s.description) : ""}</span></span>${icon("chevronRight", "chev")}</a>`
      : `<a class="li" href="#/segmentacao/g/${s.id}">${icon("users")}<span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${s.count} ${s.count === 1 ? "participante" : "participantes"} · ${s.kind === "temporary" ? "Temporário" : "Permanente"}${s.category ? " · " + esc(s.category) : ""}${s.status !== "active" ? " · " + (s.status === "closed" ? "encerrado" : "inativo") : ""}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`
      : empty("users", tab === "segmentos" ? "Nenhum segmento ainda." : "Nenhum grupo ainda.", tab === "segmentos" ? "Crie um segmento para reunir pessoas por critérios que se atualizam sozinhos." : "Crie um grupo para reunir pessoas manualmente.");
  };
  let t; el.querySelector("#q").oninput = () => { clearTimeout(t); t = setTimeout(load, 250); }; el.querySelector("#st").onchange = load; el.querySelector("#ord").onchange = load; load();
  const ng = el.querySelector("#newg"); if (ng) ng.onclick = () => groupForm(o.data, null, (id) => (location.hash = `#/segmentacao/g/${id}`));
}

// ---------------------------------------------------------------- construtor de critérios
const OPS = { eq: "é igual a", neq: "é diferente de", contains: "contém", not_contains: "não contém", gt: "é maior que", lt: "é menor que", filled: "está preenchido", empty: "não está preenchido", in: "pertence a", not_in: "não pertence a", between: "está entre", not_between: "não está entre" };
const ENUM_OPS = ["eq", "neq", "in", "not_in"], TXT_OPS = ["eq", "neq", "contains", "not_contains", "filled", "empty"], NUM_OPS = ["eq", "neq", "gt", "lt", "between", "not_between", "filled", "empty"], REF_OPS = ["in", "not_in", "filled", "empty"], BOOL_OPS = ["eq"];
function fields(o) {
  const L = (arr, k = "id", n = "name") => arr.map((x) => [x[k], x[n]]);
  const F = [
    ["Classificação e situação", [["classification", "Classificação", "enum", ENUM_OPS, [["member", "Membro"], ["attender", "Frequentador"], ["visitor", "Visitante"]]], ["status", "Situação", "enum", ENUM_OPS, [["active", "Ativo"], ["inactive", "Inativo"], ["pending", "Pendente de aprovação"]]]]],
    ["Dados pessoais", [["age", "Idade", "num", NUM_OPS], ["band", "Faixa etária", "enum", ["in", "not_in", "eq", "neq"], [...L(o.bands, "i", "label"), ["none", "Não informado"]]], ["sex", "Sexo", "enum", ["eq", "neq", "in", "not_in", "filled", "empty"], [["F", "Feminino"], ["M", "Masculino"]]],
      ["marital", "Estado civil", "text", TXT_OPS, null, ["solteiro", "casado", "divorciado", "viuvo", "uniao_estavel", "outro"]], ["neighborhood", "Bairro", "text", TXT_OPS, null, o.neighborhoods], ["city", "Cidade", "text", TXT_OPS, null, o.cities]]],
    ["Vínculos", [["network", "Ministério (rede)", "ref", REF_OPS, L(o.networks)], ["team", "Time", "ref", REF_OPS, L(o.teams)], ["group", "Grupo manual", "ref", REF_OPS, L(o.groups)], ["journey", "Participa da jornada", "ref", REF_OPS, L(o.journeys)],
      ["journey_active", "Jornada em andamento", "ref", REF_OPS, L(o.journeys)], ["journey_paused", "Jornada pausada", "ref", REF_OPS, L(o.journeys)], ["journey_completed", "Jornada concluída", "ref", REF_OPS, L(o.journeys)]]],
    ...(o.can.people_segments_functions ? [["Funções", [["function", "Função", "enum", ["in", "not_in", "filled", "empty"], [["team_leader", "Líder de time"], ["network_supervisor", "Supervisor de rede"], ["general_leader", "Liderança geral"], ["secretary", "Secretaria"]]], ["title", "Cargo ou responsabilidade", "text", ["contains", "not_contains", "filled", "empty"]]]]] : []),
    ["Histórico", [["registered_at", "Data de cadastro", "date", NUM_OPS.filter((x) => !["neq"].includes(x))], ["joined_at", "Data de entrada na igreja", "date", NUM_OPS.filter((x) => !["neq"].includes(x))], ["class_changed", "Última mudança de classificação", "date", NUM_OPS.filter((x) => !["neq"].includes(x))], ["convert", "Conversão registrada", "bool", BOOL_OPS]]],
    ["Carteira digital", [["wallet", "Situação da carteira", "enum", ["in", "not_in", "eq", "neq"], [["none", "Sem carteira"], ["active", "Válida"], ["suspended", "Suspensa"], ["revoked", "Revogada"]]], ["wallet_eligible", "Elegível à carteira (membro ativo)", "bool", BOOL_OPS]]],
  ];
  const map = {}; for (const [, items] of F) for (const f of items) map[f[0]] = { key: f[0], label: f[1], type: f[2], ops: f[3], opts: f[4] || null, hints: f[5] || null };
  return { groups: F, map };
}
const blankLeaf = () => ({ field: "classification", cmp: "eq", value: "member" });
const blankGroup = () => ({ op: "and", items: [blankLeaf()] });
function defaultFor(f, cmp) { if (["filled", "empty"].includes(cmp)) return undefined; if (f.type === "bool") return true; if (["between", "not_between"].includes(cmp)) return f.type === "date" ? ["", ""] : [0, 0]; if (["in", "not_in"].includes(cmp)) return []; if (f.opts) return f.opts[0][0]; return ""; }

function builder(box, F, crit, onChange) {
  let seq = 0; const paths = new Map();
  const drawNode = (n, path, depth) => {
    if (n.items) {
      const id = "n" + seq++; paths.set(id, path);
      return `<div class="card sg-group" style="margin:8px 0;${depth ? "border-left:3px solid var(--accent)" : ""}"><div class="row gap" style="align-items:center"><span class="small muted">Combinar com</span>
        <select data-op="${id}" aria-label="E ou OU"><option value="and" ${n.op === "and" ? "selected" : ""}>E (todas as condições)</option><option value="or" ${n.op === "or" ? "selected" : ""}>OU (qualquer uma)</option></select>
        ${depth ? `<button class="btn ghost sm" data-del="${id}" aria-label="Remover grupo">${icon("trash")}</button>` : ""}</div>
        ${n.items.map((c, i) => drawNode(c, [...path, i], depth + 1)).join("")}
        <div class="row gap" style="margin-top:8px"><button class="btn ghost sm" data-add="${id}">${icon("plus")} Condição</button>${depth < 3 ? `<button class="btn ghost sm" data-addg="${id}">${icon("plus")} Grupo de condições</button>` : ""}</div></div>`;
    }
    const id = "n" + seq++; paths.set(id, path); const f = F.map[n.field] || F.map.classification; const v = n.value;
    const multi = ["in", "not_in"].includes(n.cmp), two = ["between", "not_between"].includes(n.cmp), none = ["filled", "empty"].includes(n.cmp);
    let val = "";
    if (none) val = "";
    else if (f.type === "bool") val = `<select data-val="${id}"><option value="true" ${v !== false ? "selected" : ""}>Sim</option><option value="false" ${v === false ? "selected" : ""}>Não</option></select>`;
    else if (two) val = `<div class="row gap"><input data-v0="${id}" type="${f.type === "date" ? "date" : "number"}" value="${attr(v?.[0] ?? "")}" aria-label="De"><span class="muted">e</span><input data-v1="${id}" type="${f.type === "date" ? "date" : "number"}" value="${attr(v?.[1] ?? "")}" aria-label="Até"></div>`;
    else if (multi && f.opts) val = `<div class="mc-chips" style="flex-wrap:wrap">${f.opts.map(([k, l]) => `<button type="button" class="chip ${(v || []).includes(k) ? "on" : ""}" data-chip="${id}" data-k="${attr(k)}" aria-pressed="${(v || []).includes(k)}">${esc(l)}</button>`).join("")}</div>${f.opts.length ? "" : `<span class="tiny muted">Nada cadastrado ainda.</span>`}`;
    else if (f.opts) val = `<select data-val="${id}">${f.opts.map(([k, l]) => `<option value="${attr(k)}" ${v === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else if (f.type === "num" || f.type === "date") val = `<input data-val="${id}" type="${f.type === "date" ? "date" : "number"}" value="${attr(v ?? "")}">`;
    else if (multi) val = `<input data-valm="${id}" placeholder="Valores separados por vírgula" value="${attr((v || []).join(", "))}">`;
    else val = `<input data-val="${id}" list="dl-${f.key}" maxlength="120" value="${attr(v ?? "")}">${f.hints ? `<datalist id="dl-${f.key}">${f.hints.map((h) => `<option value="${attr(h)}">`).join("")}</datalist>` : ""}`;
    return `<div class="sg-leaf" style="padding:8px 0;border-top:1px solid var(--line)"><div class="row gap" style="flex-wrap:wrap;align-items:center">
      <select data-field="${id}" aria-label="Campo">${F.groups.map(([g, items]) => `<optgroup label="${attr(g)}">${items.map((x) => `<option value="${x[0]}" ${x[0] === n.field ? "selected" : ""}>${esc(x[1])}</option>`).join("")}</optgroup>`).join("")}</select>
      <select data-cmp="${id}" aria-label="Operador">${f.ops.map((c) => `<option value="${c}" ${c === n.cmp ? "selected" : ""}>${OPS[c]}</option>`).join("")}</select>
      <button class="btn ghost sm" data-del="${id}" aria-label="Remover condição">${icon("trash")}</button></div>${val ? `<div style="margin-top:6px">${val}</div>` : ""}</div>`;
  };
  const at = (path) => { let n = crit; for (const i of path) n = n.items[i]; return n; };
  const draw = () => { seq = 0; paths.clear(); box.innerHTML = drawNode(crit, [], 0); };
  box.onchange = (e) => {
    const t = e.target, g = (a) => t.dataset[a]; let id;
    if ((id = g("op"))) at(paths.get(id)).op = t.value;
    else if ((id = g("field"))) { const n = at(paths.get(id)), f = F.map[t.value]; n.field = t.value; n.cmp = f.ops[0]; n.value = defaultFor(f, n.cmp); draw(); }
    else if ((id = g("cmp"))) { const n = at(paths.get(id)), f = F.map[n.field]; n.cmp = t.value; n.value = defaultFor(f, n.cmp); draw(); }
    else if ((id = g("val"))) { const n = at(paths.get(id)), f = F.map[n.field]; n.value = f.type === "bool" ? t.value === "true" : f.type === "num" ? (t.value === "" ? "" : +t.value) : t.value; }
    else if ((id = g("valm"))) at(paths.get(id)).value = t.value.split(",").map((x) => x.trim()).filter(Boolean);
    else if ((id = g("v0"))) { const n = at(paths.get(id)); n.value = [t.type === "number" ? +t.value : t.value, n.value?.[1] ?? ""]; }
    else if ((id = g("v1"))) { const n = at(paths.get(id)); n.value = [n.value?.[0] ?? "", t.type === "number" ? +t.value : t.value]; }
    else return;
    onChange();
  };
  box.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return; const d = b.dataset;
    if (d.chip) { const n = at(paths.get(d.chip)); n.value = (n.value || []).includes(d.k) ? n.value.filter((x) => x !== d.k) : [...(n.value || []), d.k]; draw(); onChange(); }
    else if (d.add) { at(paths.get(d.add)).items.push(blankLeaf()); draw(); onChange(); }
    else if (d.addg) { at(paths.get(d.addg)).items.push(blankGroup()); draw(); onChange(); }
    else if (d.del) { const p = paths.get(d.del); const par = at(p.slice(0, -1)); par.items.splice(p[p.length - 1], 1); if (!par.items.length && p.length > 1) { const pp = p.slice(0, -1); at(pp.slice(0, -1)).items.splice(pp[pp.length - 1], 1); } draw(); onChange(); }
  };
  draw();
}
const clean = (n) => (n.items ? { op: n.op, items: n.items.map(clean) } : { field: n.field, cmp: n.cmp, ...(n.value === undefined ? {} : { value: n.value }) });

async function segEditor(el, alive, existing) {
  const org = state.org?.id, o = await options(); if (!alive()) return; if (o.error) return fail(el, "Novo segmento", o.error, ["#/segmentacao", "Segmentação"]);
  const F = fields(o.data), seg = existing?.segment, crit = seg ? JSON.parse(JSON.stringify(seg.criteria)) : { op: "and", items: [blankLeaf()] };
  if (!crit.items) Object.assign(crit, { op: "and", items: [{ ...crit }] });
  el.innerHTML = `${head(seg ? "Editar segmento" : "Novo segmento", ["#/segmentacao" + (seg ? "/s/" + seg.id : ""), seg ? seg.name : "Segmentação"])}
    <label class="field"><span>Nome *</span><input id="nm" maxlength="80" value="${attr(seg?.name || "")}"></label>
    <label class="field"><span>Descrição</span><input id="ds" maxlength="500" value="${attr(seg?.description || "")}"></label>
    <div class="field"><span>Tipo</span><select id="kd"><option value="dynamic">Dinâmico (critérios combinados)</option><option value="links">Por vínculos (ministério, time, grupo, jornada)</option>${o.data.can.people_segments_functions ? `<option value="roles">Por funções</option>` : ""}</select></div>
    <h3>Critérios</h3><p class="small muted">A pessoa entra e sai do segmento sozinha quando a Ficha muda. Participar de um segmento não dá permissão nem direito à carteira.</p>
    <div id="bld"></div><h3 class="mt">Prévia</h3><div id="prev" class="card">${spinner()}</div>
    <div class="row gap" style="margin-top:16px"><a class="btn ghost grow" href="#/segmentacao${seg ? "/s/" + seg.id : ""}">Cancelar</a><button class="btn grow" id="save">Salvar segmento</button></div>`;
  el.querySelector("#kd").value = seg?.kind || "dynamic";
  let t, seq = 0;
  const preview = async () => {
    const my = ++seq, box = el.querySelector("#prev"); box.innerHTML = spinner();
    const r = await sb.rpc("segment_preview", { p_org: org, p_criteria: clean(crit), p_limit: 12 }); if (my !== seq || !alive()) return;
    if (r.error) { box.innerHTML = `<p class="small">${esc(/invalid_|criteria/.test(r.error.message) ? "Confira os critérios: algum valor está vazio ou inválido." : errText(r.error))}</p>`; return; }
    box.innerHTML = `<b>${r.data.total} ${r.data.total === 1 ? "pessoa encontrada" : "pessoas encontradas"}</b>${r.data.items.length ? `<div class="list" style="margin-top:8px">${r.data.items.map((i) => personRow(i)).join("")}</div>${r.data.total > r.data.items.length ? `<p class="tiny muted">Mostrando as primeiras ${r.data.items.length}.</p>` : ""}` : `<p class="small muted">Ninguém atende a estes critérios agora.</p>`}`;
  };
  const changed = () => { clearTimeout(t); t = setTimeout(preview, 350); };
  builder(el.querySelector("#bld"), F, crit, changed); preview();
  el.querySelector("#save").onclick = async (e) => {
    const name = el.querySelector("#nm").value.trim(); if (!name) return toast("Informe o nome do segmento");
    busy(e.currentTarget); const r = await sb.rpc("segment_save", { p_org: org, p_id: seg?.id || null, p: { name, description: el.querySelector("#ds").value, kind: el.querySelector("#kd").value, criteria: clean(crit) } }); busy(e.currentTarget, false);
    if (r.error) return toast(errText(r.error)); toast("Segmento salvo"); location.hash = `#/segmentacao/s/${r.data.id}`;
  };
}

async function segDetail(el, alive, id) {
  el.innerHTML = `${head("Segmento", ["#/segmentacao", "Segmentação"])}${spinner()}`;
  const [o, r] = await Promise.all([options(), sb.rpc("segment_get", { p_id: id, p_limit: 200, p_offset: 0 })]); if (!alive()) return; if (r.error) return fail(el, "Segmento", r.error, ["#/segmentacao", "Segmentação"]);
  const s = r.data.segment, can = o.data?.can || {};
  const draw = () => {
    el.innerHTML = `${head(s.name, ["#/segmentacao", "Segmentação"])}
      <p class="muted">${esc(s.description || "")}</p>
      <div class="mc-tiles"><div class="mc-tile"><b>${r.data.total}</b><span>${r.data.total === 1 ? "pessoa agora" : "pessoas agora"}</span></div><div class="mc-tile"><b>${s.active ? "Ativo" : "Desativado"}</b><span>Situação</span></div></div>
      <p class="tiny muted" style="margin-top:8px">Responsável: ${esc(s.owner || "—")} · criado em ${day(s.created_at)} · atualizado em ${day(s.updated_at)}</p>
      <div class="row gap" style="flex-wrap:wrap;margin:12px 0">${can.people_segments_edit ? `<a class="btn ghost sm" href="#" id="ed">${icon("edit")} Editar critérios</a>` : ""}
        ${can.people_segments_delete ? `<button class="btn ghost sm" id="tg">${s.active ? "Desativar" : "Ativar"}</button>` : ""}${can.people_segments_export ? `<button class="btn ghost sm" id="ex">${icon("download")} Exportar CSV</button>` : ""}</div>
      <h3>Participantes</h3>${r.data.items.length ? `<div class="list">${r.data.items.map((i) => personRow(i)).join("")}</div>` : `<p class="muted small">Ninguém atende aos critérios agora.</p>`}
      <h3 class="mt">Histórico</h3>${r.data.history.length ? `<div class="list">${r.data.history.map((h) => `<div class="li"><span class="grow"><span class="t">${{ entered: "Entrou", left: "Saiu", created: "Segmento criado", updated: "Segmento alterado", activated: "Ativado", deactivated: "Desativado", exported: "Participantes exportados" }[h.kind] || esc(h.kind)}${h.person ? ": " + esc(h.person) : ""}</span><span class="s">${when(h.at)}${h.by ? " · " + esc(h.by) : ""}</span></span></div>`).join("")}</div>` : `<p class="muted small">Sem registros.</p>`}`;
    const tg = el.querySelector("#tg"); if (tg) tg.onclick = async () => { const x = await sb.rpc("segment_set_active", { p_id: id, p_active: !s.active }); if (x.error) return toast(errText(x.error)); s.active = !s.active; draw(); };
    const ex = el.querySelector("#ex"); if (ex) ex.onclick = async () => { const x = await sb.rpc("segment_export", { p_id: id }); if (x.error) return toast(errText(x.error)); const csv = "﻿Nome;Classificação;Situação\r\n" + x.data.items.map((i) => [i.name, CLS[i.classification] || i.classification, i.status === "active" ? "Ativo" : "Inativo"].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `segmento-${x.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`; document.body.appendChild(a); a.click(); a.remove(); toast("Arquivo gerado"); };
    const ed = el.querySelector("#ed"); if (ed) ed.onclick = (e) => { e.preventDefault(); segEditor(el, alive, r.data); };
  };
  draw();
}

// ---------------------------------------------------------------- grupos manuais
function groupForm(opt, g, done) {
  const org = state.org?.id;
  const sh = sheet(`<h2>${g ? "Editar grupo" : "Novo grupo"}</h2>
    <label class="field"><span>Nome *</span><input id="nm" maxlength="80" value="${attr(g?.name || "")}"></label>
    <label class="field"><span>Descrição</span><input id="ds" maxlength="500" value="${attr(g?.description || "")}"></label>
    <div class="row gap"><label class="field grow"><span>Categoria</span><input id="ct" maxlength="40" placeholder="Ex.: Evento, Projeto" value="${attr(g?.category || "")}"></label>
      <label class="field grow"><span>Tipo</span><select id="kd"><option value="permanent" ${g?.kind !== "temporary" ? "selected" : ""}>Permanente</option><option value="temporary" ${g?.kind === "temporary" ? "selected" : ""}>Temporário</option></select></label></div>
    <div class="row gap"><label class="field grow"><span>Responsável</span><select id="ow">${opt.users.map((u) => `<option value="${u.id}" ${u.id === (g?.owner_id || state.user?.id) ? "selected" : ""}>${esc(u.name || "Usuário")}</option>`).join("")}</select></label>
      <label class="field grow"><span>Quem vê o grupo</span><select id="vs"><option value="all" ${g?.visibility !== "restricted" ? "selected" : ""}>Quem tem acesso a grupos</option><option value="restricted" ${g?.visibility === "restricted" ? "selected" : ""}>Só criador, responsável e administração</option></select></label></div>
    <label class="field"><span>Previsão de término (opcional)</span><input id="en" type="date" value="${attr(g?.ends_on || "")}"></label>
    <button class="btn block" id="ok">Salvar grupo</button>`);
  sh.el.querySelector("#ok").onclick = async (e) => {
    const name = sh.el.querySelector("#nm").value.trim(); if (!name) return toast("Informe o nome do grupo");
    busy(e.currentTarget); const r = await sb.rpc("group_save", { p_org: org, p_id: g?.id || null, p: { name, description: sh.el.querySelector("#ds").value, category: sh.el.querySelector("#ct").value, kind: sh.el.querySelector("#kd").value, owner_id: sh.el.querySelector("#ow").value, visibility: sh.el.querySelector("#vs").value, ends_on: sh.el.querySelector("#en").value || null } }); busy(e.currentTarget, false);
    if (r.error) return toast(errText(r.error)); sh.close(); toast("Grupo salvo"); done(r.data.id);
  };
}
async function groupDetail(el, alive, id) {
  const org = state.org?.id; el.innerHTML = `${head("Grupo", ["#/segmentacao/grupos", "Grupos"])}${spinner()}`;
  const [o, r] = await Promise.all([options(), sb.rpc("group_get", { p_id: id })]); if (!alive()) return; if (r.error) return fail(el, "Grupo", r.error, ["#/segmentacao/grupos", "Grupos"]);
  const can = o.data.can; let G = r.data;
  const draw = () => {
    const g = G.group, open = g.status === "active";
    el.innerHTML = `${head(g.name, ["#/segmentacao/grupos", "Grupos"])}
      <p class="muted">${esc(g.description || "")}</p>
      <p class="tiny muted">${g.kind === "temporary" ? "Temporário" : "Permanente"}${g.category ? " · " + esc(g.category) : ""} · responsável: ${esc(g.owner || "—")} · criado por ${esc(g.creator || "—")} em ${day(g.created_at)}${g.ends_on ? " · até " + day(g.ends_on) : ""}${open ? "" : " · " + (g.status === "closed" ? "encerrado" : "inativo")}</p>
      ${can.people_groups_members ? `<div class="row gap" style="flex-wrap:wrap;margin:12px 0">${open ? `<button class="btn sm" id="add">${icon("plus")} Adicionar pessoas</button>` : ""}<button class="btn ghost sm" id="edg">${icon("edit")} Editar</button>
        <select id="gst" aria-label="Situação do grupo"><option value="active" ${g.status === "active" ? "selected" : ""}>Ativo</option><option value="inactive" ${g.status === "inactive" ? "selected" : ""}>Inativo</option><option value="closed" ${g.status === "closed" ? "selected" : ""}>Encerrado</option></select></div>` : ""}
      <h3>Participantes (${G.members.length})</h3>${G.members.length ? `<div class="list">${G.members.map((m) => personRow(m, can.people_groups_members ? `<button class="btn ghost sm" data-rm="${m.id}" aria-label="Remover ${attr(m.name)}">${icon("minus")}</button>` : "")).join("")}</div>` : `<p class="muted small">Nenhum participante ainda.</p>`}
      <h3 class="mt">Histórico de participação</h3>${G.history.length ? `<div class="list">${G.history.map((h) => `<div class="li"><span class="grow"><span class="t">${esc(h.person)} ${h.status === "removed" ? "saiu" : "participa"}</span><span class="s">Entrou em ${day(h.added_at)}${h.added_by ? " por " + esc(h.added_by) : ""}${h.removed_at ? ` · saiu em ${day(h.removed_at)}${h.removed_by ? " por " + esc(h.removed_by) : ""}${h.reason ? " (" + esc(h.reason) + ")" : ""}` : ""}</span></span></div>`).join("")}</div>` : `<p class="muted small">Sem registros.</p>`}
      <p class="tiny muted" style="margin-top:12px">Participar de um grupo não concede permissões.</p>`;
    const reload = async () => { const x = await sb.rpc("group_get", { p_id: id }); if (x.error) return toast(errText(x.error)); G = x.data; draw(); };
    el.onclick = async (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; const x = await sb.rpc("group_member_remove", { p_id: id, p_person: b.dataset.rm, p_reason: null }); if (x.error) return toast(errText(x.error)); toast("Removido. O histórico foi mantido."); reload(); };
    const gs = el.querySelector("#gst"); if (gs) gs.onchange = async () => { const x = await sb.rpc("group_set_status", { p_id: id, p_status: gs.value }); if (x.error) { toast(errText(x.error)); return reload(); } toast("Situação atualizada"); reload(); };
    const ed = el.querySelector("#edg"); if (ed) ed.onclick = () => groupForm(o.data, { ...g, id }, reload);
    const ad = el.querySelector("#add"); if (ad) ad.onclick = () => {
      const have = new Set(G.members.map((m) => m.id)); const pool = o.data.people.filter((p) => !have.has(p.id)); const sel = new Set();
      const sh = sheet(`<h2>Adicionar pessoas</h2><input class="psearch" id="s" type="search" placeholder="Pesquisar por nome" aria-label="Pesquisar"><div class="list" id="pl" style="max-height:50vh;overflow:auto;margin:10px 0"></div><button class="btn block" id="ok">Adicionar selecionadas</button>`);
      const paint = () => { const q = sh.el.querySelector("#s").value.toLowerCase(); sh.el.querySelector("#pl").innerHTML = pool.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 200).map((p) => `<label class="li"><input type="checkbox" data-p="${p.id}" ${sel.has(p.id) ? "checked" : ""}><span class="grow"><span class="t">${esc(p.name)}</span></span></label>`).join("") || `<p class="muted small" style="padding:10px">Ninguém encontrado.</p>`; };
      sh.el.querySelector("#s").oninput = paint; sh.el.querySelector("#pl").onchange = (e) => { e.target.checked ? sel.add(e.target.dataset.p) : sel.delete(e.target.dataset.p); }; paint();
      sh.el.querySelector("#ok").onclick = async (e) => { if (!sel.size) return toast("Escolha ao menos uma pessoa"); busy(e.currentTarget); const x = await sb.rpc("group_members_add", { p_id: id, p_people: [...sel] }); busy(e.currentTarget, false); if (x.error) return toast(errText(x.error)); sh.close(); toast(`${x.data.added} adicionada(s)${x.data.already ? `, ${x.data.already} já participava(m)` : ""}${x.data.failed.length ? `, ${x.data.failed.length} fora do seu alcance` : ""}`); reload(); };
    };
  };
  draw();
}
