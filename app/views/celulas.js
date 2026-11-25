// Células (SOMOS Chamados → Células): cadastro, liderança, participantes com histórico, reuniões e frequência, supervisão e relatórios.
// Quem participa de uma célula não ganha acesso administrativo: o servidor confere permissão e escopo em cada operação.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, modCan, modAny, cellScope } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtDay, hhmm, WEEKDAYS, iso, pickPerson } from "../lib/mod-ui.js";

export function register(route) {
  route("/celulas", (p, el, a) => home(el, a, "celulas"));
  route("/celulas/supervisao", (p, el, a) => home(el, a, "supervisao"));
  route("/celulas/relatorios", (p, el, a) => home(el, a, "relatorios"));
  route("/celulas/:id", (p, el, a) => detail(el, a, p.id));
}

const ROLES = { leader: "Líder", co_leader: "Colíder", host: "Anfitrião", aux: "Auxiliar", member: "Participante" };
const MODAL = { in_person: "Presencial", online: "Online", hybrid: "Híbrida" };
const FREQ = { weekly: "Toda semana", biweekly: "Quinzenal", monthly: "Mensal", custom: "Personalizada" };
const when = (c) => [c.weekday != null ? WEEKDAYS[c.weekday] : "", c.meet_time ? hhmm(c.meet_time) : "", FREQ[c.frequency] || ""].filter(Boolean).join(" · ");
const leadersTxt = (c) => (c.leaders || []).map((l) => `${esc(l.name)}${l.role === "co_leader" ? " (colíder)" : ""}`).join(", ") || "Sem líder definido";
const tabsNav = (tab) => {
  const t = [["celulas", "Células", "#/celulas"]];
  if (modCan("cells_supervision") || modCan("cells_view") || modCan("cells_manage")) t.push(["supervisao", "Supervisão", "#/celulas/supervisao"]);
  if (modCan("cells_reports") || cellScope()) t.push(["relatorios", "Relatórios", "#/celulas/relatorios"]);
  return `<nav class="tabs">${t.map(([k, l, h]) => `<a href="${h}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>`;
};

// ---------------------------------------------------------------- início
async function home(el, alive, tab) {
  const title = "Células";
  if (state.mods && !(modAny("cells_view", "cells_manage", "cells_members", "cells_meetings", "cells_supervision", "cells_reports") || cellScope())) { el.innerHTML = `${head(title)}${empty("lock", "Você não tem acesso a esta área.")}`; return; }
  el.innerHTML = `${head(title)}${tabsNav(tab)}${spinner()}`;
  if (tab === "supervisao") return supTab(el, alive);
  if (tab === "relatorios") return reportTab(el, alive);
  const org = state.org.id;
  const r = await sb.rpc("cell_list", { p_org: org });
  if (!alive()) return; if (r.error) return fail(el, title, r.error);
  const sups = modCan("cells_manage") ? (await sb.rpc("cell_sup_list", { p_org: org })).data || [] : [];
  let q = "", st = "";
  const paint = () => {
    const list = r.data.filter((c) => (!q || c.name.toLowerCase().includes(q.toLowerCase())) && (!st || c.status === st));
    el.querySelector("#list").innerHTML = list.length ? `<div class="list">${list.map((c) => `<a class="li" href="#/celulas/${c.id}">${icon("users")}<span class="grow"><span class="t">${esc(c.name)}${c.status === "inactive" ? " (inativa)" : ""}</span>
      <span class="s">${esc(when(c)) || "Sem horário definido"} · ${c.members} ${c.members === 1 ? "pessoa" : "pessoas"}</span><span class="s">${leadersTxt(c)}${c.supervisor_name ? ` · Supervisão: ${esc(c.supervisor_name)}` : ""}${c.last_meeting ? ` · Última reunião: ${fmtDay(c.last_meeting)}` : " · Sem reunião registrada"}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`
      : empty("users", r.data.length ? "Nenhuma célula com esse filtro." : "Nenhuma célula ainda.", modCan("cells_manage") ? "Toque em Nova célula para começar." : "");
  };
  el.innerHTML = `${head(title)}${tabsNav(tab)}
    <div class="row gap mb"><input class="psearch grow" id="q" type="search" placeholder="Pesquisar célula" aria-label="Pesquisar célula"><select id="st" aria-label="Situação"><option value="">Todas</option><option value="active">Ativas</option><option value="inactive">Inativas</option></select>
      ${modCan("cells_manage") ? `<button class="btn primary sm" id="new">${icon("plus")} Nova célula</button>` : ""}</div>
    ${modCan("cells_view") || modCan("cells_members") ? `<button class="btn ghost sm mb" id="unl">${icon("users")} Pessoas sem célula</button>` : ""}
    <div id="list"></div>`;
  paint();
  el.querySelector("#q").oninput = (e) => { q = e.target.value; paint(); };
  el.querySelector("#st").onchange = (e) => { st = e.target.value; paint(); };
  const nw = el.querySelector("#new"); if (nw) nw.onclick = () => cellForm(null, sups, (id) => (location.hash = `#/celulas/${id}`));
  const un = el.querySelector("#unl"); if (un) un.onclick = () => unlinked(r.data.filter((c) => c.status === "active"));
}

async function unlinked(cells) {
  const r = await sb.rpc("cell_unlinked", { p_org: state.org.id });
  if (r.error) return toast(errText(r.error));
  const s = sheet(`<h3>Pessoas sem célula</h3><p class="muted small">Membros e frequentadores ativos que não estão em nenhuma célula (${r.data.length}).</p>
    <div class="list">${r.data.map((p) => `<div class="li"><span class="grow"><span class="t">${esc(p.name)}</span></span>${modCan("cells_members") ? `<select data-p="${p.id}" aria-label="Célula"><option value="">Adicionar a…</option>${cells.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>` : ""}</div>`).join("") || `<div class="li muted small">Todos têm célula.</div>`}</div>`);
  s.el.onchange = async (e) => {
    const sel = e.target.closest("[data-p]"); if (!sel || !sel.value) return;
    const x = await sb.rpc("cell_member_add", { p_cell: sel.value, p_person: sel.dataset.p, p_role: "member" });
    if (x.error) { toast(errText(x.error)); sel.value = ""; return; }
    toast("Pessoa adicionada."); sel.closest(".li").remove();
  };
}

function cellForm(c, sups, done) {
  const v = c || { frequency: "weekly", modality: "in_person" };
  const s = sheet(`<h3>${c ? "Editar célula" : "Nova célula"}</h3>
    <label class="fld">Nome<input id="n" maxlength="100" value="${attr(v.name || "")}"></label>
    <label class="fld">Categoria (opcional)<input id="cat" maxlength="40" value="${attr(v.category || "")}" placeholder="Ex.: Jovens, Casais"></label>
    <label class="fld">Descrição (opcional)<textarea id="d" rows="2" maxlength="600">${esc(v.description || "")}</textarea></label>
    <div class="row gap"><label class="fld grow">Modalidade<select id="mo">${Object.entries(MODAL).map(([k, l]) => `<option value="${k}"${v.modality === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld grow">Capacidade<input id="cap" type="number" min="1" inputmode="numeric" value="${v.capacity || ""}" placeholder="Sem limite"></label></div>
    <label class="fld">Endereço ou local<input id="ad" maxlength="200" value="${attr(v.address || "")}"></label>
    <label class="fld">Link da reunião online (opcional)<input id="ln" maxlength="300" value="${attr(v.meeting_link || "")}" placeholder="https://"></label>
    <div class="row gap"><label class="fld grow">Dia<select id="wd"><option value="">—</option>${WEEKDAYS.map((w, i) => `<option value="${i}"${v.weekday === i ? " selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="fld grow">Horário<input id="tm" type="time" value="${hhmm(v.meet_time)}"></label>
      <label class="fld grow">Frequência<select id="fr">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}"${v.frequency === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
    ${sups.length ? `<label class="fld">Supervisão<select id="sp"><option value="">Sem supervisor</option>${sups.filter((x) => x.active).map((x) => `<option value="${x.id}"${v.supervisor_id === x.id ? " selected" : ""}>${esc(x.name)}${x.title ? ` · ${esc(x.title)}` : ""}</option>`).join("")}</select></label>` : ""}
    <button class="btn block mt" id="ok">Salvar</button>`);
  const g = (id) => s.el.querySelector(id);
  g("#ok").onclick = async (e) => {
    const b = e.currentTarget; busy(b);
    try {
      const p = { name: g("#n").value, category: g("#cat").value, description: g("#d").value, modality: g("#mo").value, capacity: g("#cap").value, address: g("#ad").value, meeting_link: g("#ln").value, weekday: g("#wd").value, meet_time: g("#tm").value, frequency: g("#fr").value, supervisor_id: g("#sp")?.value ?? v.supervisor_id ?? "" };
      const r = await sb.rpc("cell_save", { p_org: state.org.id, p_id: c?.id || null, p });
      if (r.error) return toast(errText(r.error));
      toast(c ? "Célula atualizada." : "Célula criada."); s.close(); done(r.data);
    } finally { busy(b, false); }
  };
}

// ---------------------------------------------------------------- detalhe
async function detail(el, alive, id, keep) {
  el.innerHTML = `${head("Célula", ["#/celulas", "Células"])}${spinner()}`;
  const r = await sb.rpc("cell_get", { p_cell: id });
  if (!alive()) return; if (r.error) return fail(el, "Célula", r.error, ["#/celulas", "Células"]);
  const g = r.data, c = g.cell, can = g.can;
  let tab = keep || "pessoas";
  const sups = can.manage ? (await sb.rpc("cell_sup_list", { p_org: state.org.id })).data || [] : [];
  const reload = () => detail(el, alive, id, tab);
  const body = () => {
    if (tab === "pessoas") return `${can.members && c.status === "active" ? `<button class="btn primary sm mb" id="add">${icon("plus")} Adicionar pessoa</button>` : ""}
      <div class="list">${g.members.map((m) => `<div class="li"><span class="grow"><span class="t">${esc(m.name)}</span><span class="s">${ROLES[m.role]} · desde ${fmtDay(m.joined_at)}</span></span>
        ${can.manage ? `<select data-role="${m.id}" aria-label="Função"><option value="">Função</option>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${m.role === k ? " selected" : ""}>${l}</option>`).join("")}</select>` : ""}
        ${can.members && (m.role === "member" || can.manage) ? `<button class="btn ghost sm" data-out="${m.id}" data-n="${attr(m.name)}">Remover</button>` : ""}</div>`).join("") || `<div class="li muted small">Ninguém na célula ainda.</div>`}</div>
      ${g.past.length ? `<h3 class="mt">Quem já passou por aqui</h3><div class="list">${g.past.map((m) => `<div class="li"><span class="grow"><span class="t">${esc(m.name)}</span><span class="s">${fmtDay(m.joined_at)} a ${fmtDay(m.left_at)}${m.reason ? ` · ${esc(m.reason)}` : ""}</span></span></div>`).join("")}</div>` : ""}`;
    if (tab === "reunioes") return `${can.meetings && c.status === "active" ? `<button class="btn primary sm mb" id="meet">${icon("plus")} Registrar reunião</button>` : ""}
      <div class="list">${g.meetings.map((m) => `<button class="li" data-m="${m.id}"><span class="grow"><span class="t">${fmtDay(m.date)}${m.status === "cancelled" ? " · não aconteceu" : ""}</span><span class="s">${m.status === "held" ? `${m.present} ${m.present === 1 ? "presente" : "presentes"} · ${m.visitors} ${m.visitors === 1 ? "visitante" : "visitantes"}${m.responsible ? ` · ${esc(m.responsible)}` : ""}` : "Cancelada"}</span></span>${icon("chevronRight", "chev")}</button>`).join("") || `<div class="li muted small">Nenhuma reunião registrada.</div>`}</div>`;
    return `<div class="list">${g.history.map((h) => `<div class="li stack"><span class="t">${esc(HIST[h.action] || h.action)}${h.detail?.name ? ` — ${esc(h.detail.name)}` : ""}</span><span class="s">${new Date(h.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${h.by ? ` · ${esc(h.by)}` : ""}${h.reason ? ` · ${esc(h.reason)}` : ""}</span></div>`).join("") || `<div class="li muted small">Sem alterações registradas.</div>`}</div>`;
  };
  const paint = () => {
    el.innerHTML = `${head(c.name, ["#/celulas", "Células"])}
      <div class="card"><div class="mc-kv"><span>${MODAL[c.modality]}${c.status === "inactive" ? " · Inativa" : ""}</span></div>
        ${when(c) ? `<p class="row gap-s">${icon("clock")} ${esc(when(c))}</p>` : ""}${c.address ? `<p class="row gap-s muted">${icon("pin")} ${esc(c.address)}</p>` : ""}${c.meeting_link ? `<p class="small"><a href="${attr(c.meeting_link)}" target="_blank" rel="noopener">Entrar na reunião online</a></p>` : ""}
        ${c.description ? `<p>${esc(c.description)}</p>` : ""}<p class="small muted">${leadersTxt(c)}${c.supervisor_name ? ` · Supervisão: ${esc(c.supervisor_name)}` : ""}${c.capacity ? ` · ${c.members}/${c.capacity} vagas` : ""}</p>
        ${can.manage ? `<div class="row gap"><button class="btn ghost sm" id="edit">${icon("edit")} Editar</button><button class="btn ghost sm" id="tog">${c.status === "active" ? "Desativar" : "Reativar"}</button></div>` : ""}</div>
      <nav class="tabs"><a data-t="pessoas" class="${tab === "pessoas" ? "on" : ""}">Participantes</a><a data-t="reunioes" class="${tab === "reunioes" ? "on" : ""}">Reuniões</a><a data-t="hist" class="${tab === "hist" ? "on" : ""}">Histórico</a></nav>
      <div id="body">${body()}</div>`;
    el.querySelectorAll("[data-t]").forEach((a) => { a.onclick = () => { tab = a.dataset.t; paint(); }; });
    const ed = el.querySelector("#edit"); if (ed) ed.onclick = () => cellForm(c, sups, reload);
    const tg = el.querySelector("#tog"); if (tg) tg.onclick = async () => {
      if (c.status === "active") {
        const z = sheet(`<h3>Desativar ${esc(c.name)}?</h3><p class="muted small">Os participantes e o histórico são mantidos. Você pode reativar depois.</p><label class="fld">Motivo<input id="rs" maxlength="200"></label><button class="btn block mt" id="ok">Desativar</button>`);
        z.el.querySelector("#ok").onclick = async (ev) => {
          const b = ev.currentTarget; busy(b);
          try { const x = await sb.rpc("cell_set_status", { p_cell: id, p_active: false, p_reason: z.el.querySelector("#rs").value }); if (x.error) return toast(errText(x.error)); toast("Célula desativada."); z.close(); reload(); } finally { busy(b, false); }
        };
        return;
      } else {
        const x = await sb.rpc("cell_set_status", { p_cell: id, p_active: true }); if (x.error) return toast(errText(x.error));
      }
      toast("Célula reativada."); reload();
    };
    const ad = el.querySelector("#add"); if (ad) ad.onclick = () => pickPerson("Adicionar à célula", async (p) => {
      const x = await sb.rpc("cell_member_add", { p_cell: id, p_person: p.id, p_role: "member" }); if (x.error) return toast(errText(x.error)); toast("Pessoa adicionada."); reload();
    }, { exclude: g.members.map((m) => m.person_id) });
    el.querySelectorAll("[data-role]").forEach((s) => { s.onchange = async () => { if (!s.value) return; const x = await sb.rpc("cell_member_set_role", { p_member: s.dataset.role, p_role: s.value }); if (x.error) return toast(errText(x.error)); toast("Função atualizada."); reload(); }; });
    el.querySelectorAll("[data-out]").forEach((b) => { b.onclick = () => leave(b.dataset.out, b.dataset.n, c, reload); });
    const mt = el.querySelector("#meet"); if (mt) mt.onclick = () => meetingForm(c, g, null, reload);
    el.querySelectorAll("[data-m]").forEach((b) => { b.onclick = async () => { const x = await sb.rpc("cell_meeting_get", { p_meeting: b.dataset.m }); if (x.error) return toast(errText(x.error)); meetingForm(c, g, x.data, reload); }; });
  };
  paint();
}
const HIST = { create: "Célula criada", edit: "Cadastro alterado", activate: "Célula reativada", deactivate: "Célula desativada", member_add: "Pessoa adicionada", member_remove: "Pessoa removida", member_role: "Função alterada", transfer_in: "Chegou por transferência", transfer_out: "Saiu por transferência", meeting_create: "Reunião registrada", meeting_edit: "Reunião corrigida" };

async function leave(memberId, name, c, done) {
  const s = sheet(`<h3>Remover ${esc(name)}?</h3><p class="muted small">O histórico de participação é mantido. Você pode transferir a pessoa para outra célula.</p>
    <label class="fld">Motivo (opcional)<input id="rs" maxlength="200" placeholder="Ex.: mudou de cidade"></label>
    <button class="btn block mt" id="ok">Remover da célula</button>`);
  s.el.querySelector("#ok").onclick = async (e) => {
    const b = e.currentTarget; busy(b);
    try { const x = await sb.rpc("cell_member_remove", { p_member: memberId, p_reason: s.el.querySelector("#rs").value }); if (x.error) return toast(errText(x.error)); toast("Pessoa removida."); s.close(); done(); } finally { busy(b, false); }
  };
}

// reunião: presença dos participantes, visitantes e observações; reuniões antigas podem ser corrigidas (a correção fica no histórico)
function meetingForm(c, g, m, done) {
  const att = new Map((m?.attendance || []).map((a) => [a.person_id, a.present]));
  const people = [...g.members.map((x) => ({ id: x.person_id, name: x.name })), ...(m?.attendance || []).filter((a) => !g.members.some((x) => x.person_id === a.person_id)).map((a) => ({ id: a.person_id, name: a.name }))];
  const vis = (m?.visitors || []).map((v) => ({ ...v }));
  const s = sheet(`<h3>${m ? "Reunião de " + fmtDay(m.date) : "Registrar reunião"}</h3>
    <label class="fld">Data<input id="dt" type="date" max="${iso(new Date())}" value="${m?.date || iso(new Date())}"></label>
    <label class="fld">Responsável<select id="rs"><option value="">—</option>${g.members.filter((x) => ["leader", "co_leader", "host", "aux"].includes(x.role)).map((x) => `<option value="${x.person_id}"${m?.responsible_person_id === x.person_id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <label class="chip"><input type="checkbox" id="can"${m?.status === "cancelled" ? " checked" : ""}> A reunião não aconteceu</label>
    <label class="fld" id="cr" hidden>Motivo<input id="crv" maxlength="200" value="${attr(m?.cancel_reason || "")}"></label>
    <div id="held"><h4 class="mt">Presença</h4><div class="list">${people.map((p) => `<label class="li"><input type="checkbox" data-pp="${p.id}"${m ? (att.get(p.id) ? " checked" : "") : " checked"}> <span class="grow">${esc(p.name)}</span></label>`).join("") || `<div class="li muted small">Sem participantes.</div>`}</div>
      <h4 class="mt">Visitantes</h4><div id="vl"></div><div class="row gap"><input id="vn" maxlength="120" placeholder="Nome do visitante" class="grow"><button class="btn ghost sm" id="va">${icon("plus")}</button></div>
      ${people.length === 0 ? `<label class="fld">Quantidade de presentes<input id="pc" type="number" min="0" inputmode="numeric" value="${m?.present ?? ""}"></label>` : ""}</div>
    <label class="fld">Observações<textarea id="ob" rows="2" maxlength="1000">${esc(m?.notes || "")}</textarea></label>
    <button class="btn block mt" id="ok">Salvar</button>`);
  const q = (x) => s.el.querySelector(x);
  const drawV = () => { q("#vl").innerHTML = vis.map((v, i) => `<div class="li"><span class="grow">${esc(v.name)}</span><button class="btn ghost sm" data-rv="${i}">Remover</button></div>`).join(""); };
  drawV();
  q("#va").onclick = () => { const n = q("#vn").value.trim(); if (!n) return; vis.push({ name: n }); q("#vn").value = ""; drawV(); };
  q("#vl").onclick = (e) => { const b = e.target.closest("[data-rv]"); if (!b) return; vis.splice(Number(b.dataset.rv), 1); drawV(); };
  const sync = () => { q("#cr").hidden = !q("#can").checked; q("#held").hidden = q("#can").checked; }; q("#can").onchange = sync; sync();
  q("#ok").onclick = async (e) => {
    const b = e.currentTarget; busy(b);
    try {
      const cancelled = q("#can").checked;
      const p = { id: m?.id || null, meeting_date: q("#dt").value, responsible_person_id: q("#rs").value || null, status: cancelled ? "cancelled" : "held", cancel_reason: q("#crv").value, notes: q("#ob").value,
        attendance: cancelled ? [] : [...s.el.querySelectorAll("[data-pp]")].map((i) => ({ person_id: i.dataset.pp, present: i.checked })), visitors: cancelled ? [] : vis };
      if (!cancelled && q("#pc")) p.present_count = Number(q("#pc").value || 0);
      const r = await sb.rpc("cell_meeting_save", { p_cell: c.id, p });
      if (r.error) return toast(errText(r.error));
      toast("Reunião salva."); s.close(); done();
    } finally { busy(b, false); }
  };
}

// ---------------------------------------------------------------- supervisão
async function supTab(el, alive) {
  const r = await sb.rpc("cell_sup_list", { p_org: state.org.id });
  if (!alive()) return; if (r.error) return fail(el, "Células", r.error);
  const byId = new Map(r.data.map((x) => [x.id, x]));
  const paint = () => {
    el.innerHTML = `${head("Células")}${tabsNav("supervisao")}
      <p class="muted small">A estrutura é livre: cada responsável tem um título e pode estar abaixo de outro (por exemplo, supervisor abaixo de coordenador de área).</p>
      ${modCan("cells_supervision") ? `<button class="btn primary sm mb" id="new">${icon("plus")} Adicionar responsável</button>` : ""}
      <div class="list">${r.data.map((x) => `<div class="li"><span class="grow"><span class="t">${esc(x.name)}${x.active ? "" : " (inativo)"}</span><span class="s">${esc(x.title || "Supervisor")}${x.parent_id ? ` · abaixo de ${esc(byId.get(x.parent_id)?.name || "")}` : ""} · ${x.cells} ${x.cells === 1 ? "célula" : "células"}</span></span>${modCan("cells_supervision") ? `<button class="btn ghost sm" data-e="${x.id}">Editar</button>` : ""}</div>`).join("") || `<div class="li muted small">Nenhum responsável cadastrado.</div>`}</div>`;
    const nw = el.querySelector("#new"); if (nw) nw.onclick = () => supForm(null);
    el.querySelectorAll("[data-e]").forEach((b) => { b.onclick = () => supForm(byId.get(b.dataset.e)); });
  };
  const reload = async () => { const x = await sb.rpc("cell_sup_list", { p_org: state.org.id }); r.data = x.data || []; byId.clear(); r.data.forEach((i) => byId.set(i.id, i)); paint(); };
  const supForm = (x) => {
    const go = (person) => {
      const s = sheet(`<h3>${x ? "Editar responsável" : "Novo responsável"}</h3><p><b>${esc(person.name)}</b></p>
        <label class="fld">Título<input id="ti" maxlength="60" value="${attr(x?.title || "")}" placeholder="Ex.: Supervisor, Coordenador de área"></label>
        <label class="fld">Abaixo de<select id="pa"><option value="">Ninguém (topo)</option>${r.data.filter((o) => o.id !== x?.id).map((o) => `<option value="${o.id}"${x?.parent_id === o.id ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
        <label class="chip"><input type="checkbox" id="ac"${x?.active === false ? "" : " checked"}> Ativo</label><button class="btn block mt" id="ok">Salvar</button>`);
      s.el.querySelector("#ok").onclick = async (e) => {
        const b = e.currentTarget; busy(b);
        try {
          const y = await sb.rpc("cell_sup_save", { p_org: state.org.id, p_id: x?.id || null, p_person: person.id, p_title: s.el.querySelector("#ti").value, p_parent: s.el.querySelector("#pa").value || null, p_active: s.el.querySelector("#ac").checked });
          if (y.error) return toast(errText(y.error)); toast("Salvo."); s.close(); reload();
        } finally { busy(b, false); }
      };
    };
    if (x) go({ id: x.person_id, name: x.name }); else pickPerson("Escolher a pessoa", go);
  };
  paint();
}

// ---------------------------------------------------------------- relatórios (só números descritivos)
async function reportTab(el, alive) {
  let from = iso(new Date(Date.now() - 90 * 864e5)), to = iso(new Date());
  const run = async () => {
    el.innerHTML = `${head("Células")}${tabsNav("relatorios")}${spinner()}`;
    const r = await sb.rpc("cell_report", { p_org: state.org.id, p_from: from, p_to: to });
    if (!alive()) return; if (r.error) return fail(el, "Células", r.error);
    const d = r.data, max = Math.max(1, ...d.series.map((x) => x.present));
    const tile = (n, l) => `<div class="mc-tile"><b>${n ?? "—"}</b><span>${l}</span></div>`;
    el.innerHTML = `${head("Células")}${tabsNav("relatorios")}
      <div class="row gap mb"><label class="fld grow">De<input id="f" type="date" value="${from}"></label><label class="fld grow">Até<input id="t" type="date" value="${to}"></label><button class="btn primary sm" id="go">Atualizar</button></div>
      <div class="mc-tiles">${tile(d.cells_total, "Células")}${tile(d.cells_active, "Ativas")}${tile(d.cells_inactive, "Inativas")}${tile(d.participants, "Participantes")}${tile(d.meetings_held, "Reuniões realizadas")}${tile(d.attendance_avg, "Média de presentes")}${tile(d.attendance_rate != null ? d.attendance_rate + "%" : null, "Presença sobre participantes")}${tile(d.visitors_total, "Visitantes")}${tile(d.new_members, "Novos participantes")}${d.unlinked != null ? tile(d.unlinked, "Pessoas sem célula") : ""}</div>
      <p class="muted small mt">Os números descrevem a participação; não medem a vida espiritual de uma célula.</p>
      <h3 class="mt">Evolução por mês</h3>
      <div class="list">${d.series.map((x) => `<div class="li stack"><div class="row between"><b>${x.month}</b><span class="small muted">${x.meetings} reuniões · ${x.present} presenças · ${x.visitors} visitantes · ${x.new_members} novos</span></div><div style="height:8px;border-radius:4px;background:rgba(var(--w),.08)"><div style="height:8px;border-radius:4px;background:var(--accent);width:${Math.round((x.present / max) * 100)}%"></div></div></div>`).join("")}</div>
      <h3 class="mt">Células sem reunião registrada no período</h3>
      <div class="list">${d.without_meetings.map((c) => `<a class="li" href="#/celulas/${c.id}"><span class="grow">${esc(c.name)}</span>${icon("chevronRight", "chev")}</a>`).join("") || `<div class="li muted small">Todas as células ativas registraram reunião.</div>`}</div>
      ${d.per_supervisor.length ? `<h3 class="mt">Por supervisor</h3><div class="list">${d.per_supervisor.map((x) => `<div class="li stack"><b>${esc(x.name)}${x.title ? ` · ${esc(x.title)}` : ""}</b><span class="small muted">${x.cells} células · ${x.members} participantes · ${x.meetings} reuniões · média ${x.avg_present ?? "—"} presentes · ${x.visitors} visitantes · ${x.without_meetings} sem reunião</span></div>`).join("")}</div>` : ""}
      <div class="row between mt"><h3>Por célula</h3><button class="btn ghost sm" id="csv">${icon("download")} Exportar CSV</button></div>
      <div class="list">${d.per_cell.map((x) => `<a class="li stack" href="#/celulas/${x.id}"><b>${esc(x.name)}${x.status === "inactive" ? " (inativa)" : ""}</b><span class="small muted">${x.members} participantes · ${x.meetings} reuniões · média ${x.avg_present ?? "—"} presentes · ${x.visitors} visitantes · última reunião ${x.last_meeting ? fmtDay(x.last_meeting) : "—"}</span></a>`).join("")}</div>`;
    el.querySelector("#go").onclick = () => { from = el.querySelector("#f").value; to = el.querySelector("#t").value; run(); };
    el.querySelector("#csv").onclick = () => {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [["Célula", "Situação", "Participantes", "Reuniões", "Média de presentes", "Visitantes", "Última reunião"], ...d.per_cell.map((x) => [x.name, x.status === "active" ? "Ativa" : "Inativa", x.members, x.meetings, x.avg_present ?? "", x.visitors, x.last_meeting || ""])];
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8" })); a.download = `celulas-${from}-a-${to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  };
  run();
}
