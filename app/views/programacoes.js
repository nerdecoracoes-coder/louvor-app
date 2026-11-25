// Programações (SOMOS Chamados → Programações): cultos, reuniões e atividades com recorrência, exceções e ordem de atividades.
// Cancelar uma data ou alterar um horário nunca apaga o histórico; a ordem do culto é livre (cada igreja monta a sua).
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, modCan } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtDay, hhmm, WEEKDAYS, iso, pickPerson, fmtWhen } from "../lib/mod-ui.js";

export function register(route) {
  route("/programacoes", (p, el, a) => home(el, a, "agenda"));
  route("/programacoes/lista", (p, el, a) => home(el, a, "lista"));
  route("/programacoes/:id", (p, el, a) => detail(el, a, p.id));
}

export const CATS = { culto: "Culto", reuniao: "Reunião", estudo: "Estudo bíblico", vigilia: "Vigília", oracao: "Encontro de oração", especial: "Programação especial", conferencia: "Conferência", institucional: "Atividade institucional" };
export const VIS = { public: "Pública (qualquer pessoa)", members: "Membros da igreja", leaders: "Só liderança" };
const STATUS = { draft: "Rascunho", published: "Publicada", cancelled: "Cancelada" };
const REC = { none: "Não repete", daily: "Todos os dias", weekly: "Toda semana", biweekly: "A cada 15 dias", monthly: "Todo mês", weekdays: "Em dias da semana específicos", dates: "Em datas escolhidas" };
export const recText = (r) => {
  const f = r?.freq || "none";
  if (f === "weekdays") return `${(r.weekdays || []).map((d) => WEEKDAYS[d].slice(0, 3)).join(", ")}${r.until ? ` até ${fmtDay(r.until)}` : ""}`;
  if (f === "dates") return `Em ${(r.dates || []).length} datas`;
  return `${REC[f]}${r?.until ? ` até ${fmtDay(r.until)}` : ""}`;
};
const tabs = (t) => `<nav class="tabs"><a href="#/programacoes" class="${t === "agenda" ? "on" : ""}">Agenda</a><a href="#/programacoes/lista" class="${t === "lista" ? "on" : ""}">Programações</a></nav>`;
const occInner = (o) => `<span class="t">${o.status === "cancelled" ? "<s>" : ""}${esc(o.name)}${o.status === "cancelled" ? "</s> · Cancelada" : ""}</span>
  <span class="s">${fmtDay(o.date)} · ${hhmm(o.starts_time)}${o.ends_time ? `–${hhmm(o.ends_time)}` : ""}${o.location ? ` · ${esc(o.location)}` : ""}${o.modified ? " · alterada" : ""}${o.program_status === "draft" ? " · rascunho" : ""}</span>${o.note ? `<span class="s">${esc(o.note)}</span>` : ""}`;
const occRow = (o) => `<div class="li${o.status === "cancelled" ? " muted" : ""}"><span class="grow">${occInner(o)}</span></div>`;

async function home(el, alive, tab) {
  const title = "Programações";
  el.innerHTML = `${head(title)}${tabs(tab)}${spinner()}`;
  const org = state.org.id; let month = new Date(); month.setDate(1);
  const paint = async () => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1), last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [o, l] = await Promise.all([sb.rpc("prog_occurrences", { p_org: org, p_from: iso(first), p_to: iso(last) }), tab === "lista" ? sb.rpc("prog_list", { p_org: org }) : Promise.resolve({ data: [] })]);
    if (!alive()) return; if (o.error) return fail(el, title, o.error); if (l.error) return fail(el, title, l.error);
    const mname = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    let body;
    if (tab === "lista") body = `<div class="list">${l.data.map((p) => `<a class="li" href="#/programacoes/${p.id}"><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${CATS[p.category]} · ${recText(p.recurrence)} · ${hhmm(p.starts_time)}${p.location ? ` · ${esc(p.location)}` : ""}</span></span><span class="ptag ${p.status === "published" ? "member" : "none"}">${STATUS[p.status]}</span></a>`).join("") || empty("calendar", "Nenhuma programação ainda.", modCan("prog_manage") ? "Toque em Nova programação para cadastrar cultos e reuniões." : "")}</div>`;
    else {
      const groups = new Map(); for (const x of o.data) { if (!groups.has(x.date)) groups.set(x.date, []); groups.get(x.date).push(x); }
      body = [...groups].map(([d, xs]) => `<h3 class="mt">${new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" })}</h3><div class="list">${xs.map((x) => `<a href="#/programacoes/${x.prog_id}" class="li-link">${occRow(x)}</a>`).join("")}</div>`).join("") || empty("calendar", "Nada programado neste mês.");
    }
    el.innerHTML = `${head(title, undefined, modCan("prog_manage") ? `<button class="btn primary sm" id="new">${icon("plus")} Nova programação</button>` : "")}${tabs(tab)}
      <div class="row between mb"><button class="iconbtn" data-m="-1" aria-label="Mês anterior">${icon("chevronLeft")}</button><b style="text-transform:capitalize">${esc(mname)}</b><button class="iconbtn" data-m="1" aria-label="Próximo mês">${icon("chevronRight")}</button></div>${body}`;
    el.querySelectorAll("[data-m]").forEach((b) => { b.onclick = () => { month.setMonth(month.getMonth() + Number(b.dataset.m)); paint(); }; });
    const nw = el.querySelector("#new"); if (nw) nw.onclick = () => progForm(null, (id) => (location.hash = `#/programacoes/${id}`));
  };
  paint();
}

// ---------------------------------------------------------------- formulário
export function progForm(p, done) {
  const v = p || { category: "culto", visibility: "members", recurrence: { freq: "none" }, starts_time: "19:00" };
  const rec = v.recurrence || { freq: "none" }; let resp = { id: v.responsible_person_id || "", name: v.responsible || "" }; const dates = [...(rec.dates || [])];
  const s = sheet(`<h3>${p ? "Editar programação" : "Nova programação"}</h3>
    <label class="fld">Nome<input id="n" maxlength="120" value="${attr(v.name || "")}"></label>
    <div class="row gap"><label class="fld grow">Categoria<select id="c">${Object.entries(CATS).map(([k, l]) => `<option value="${k}"${v.category === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld grow">Quem vê<select id="vi">${Object.entries(VIS).map(([k, l]) => `<option value="${k}"${v.visibility === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <label class="fld">Descrição (opcional)<textarea id="d" rows="2" maxlength="1000">${esc(v.description || "")}</textarea></label>
    <label class="fld">Local<input id="l" maxlength="160" value="${attr(v.location || "")}"></label>
    <div class="row gap"><label class="fld grow">Repetição<select id="r">${Object.entries(REC).map(([k, l]) => `<option value="${k}"${rec.freq === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <div class="row gap"><label class="fld grow" id="sdw">Data${rec.freq === "none" ? "" : " de início"}<input id="sd" type="date" value="${v.start_date || ""}"></label><label class="fld grow">Início<input id="st" type="time" value="${hhmm(v.starts_time)}"></label><label class="fld grow">Fim<input id="en" type="time" value="${hhmm(v.ends_time)}"></label></div>
    <div id="wk" class="mc-chips" hidden>${WEEKDAYS.map((w, i) => `<label class="chip"><input type="checkbox" data-wd="${i}"${(rec.weekdays || []).includes(i) ? " checked" : ""}> ${w.slice(0, 3)}</label>`).join("")}</div>
    <label class="fld" id="unw" hidden>Repete até (opcional)<input id="un" type="date" value="${rec.until || ""}"></label>
    <div id="dts" hidden><div class="row gap"><input id="dn" type="date" class="grow" aria-label="Nova data"><button class="btn ghost sm" id="da">${icon("plus")}</button></div><div id="dl" class="mc-chips mt"></div></div>
    <div class="fld"><span>Responsável (opcional)</span><div class="row gap"><span class="grow" id="rn">${esc(resp.name || "Ninguém")}</span><button class="btn ghost sm" id="rp">Escolher</button></div></div>
    <label class="fld">Observações (opcional)<textarea id="o" rows="2" maxlength="1000">${esc(v.notes || "")}</textarea></label>
    <button class="btn block mt" id="ok">Salvar</button>`);
  const q = (x) => s.el.querySelector(x);
  const sync = () => { const f = q("#r").value; q("#wk").hidden = f !== "weekdays"; q("#unw").hidden = ["none", "dates"].includes(f); q("#dts").hidden = f !== "dates"; q("#sdw").hidden = f === "dates"; };
  const drawD = () => { q("#dl").innerHTML = dates.sort().map((d, i) => `<span class="chip">${fmtDay(d)} <button data-rd="${i}" aria-label="Remover data" class="iconbtn">${icon("x")}</button></span>`).join(""); };
  q("#r").onchange = sync; sync(); drawD();
  q("#da").onclick = () => { const d = q("#dn").value; if (d && !dates.includes(d)) { dates.push(d); drawD(); } q("#dn").value = ""; };
  q("#dl").onclick = (e) => { const b = e.target.closest("[data-rd]"); if (!b) return; dates.splice(Number(b.dataset.rd), 1); drawD(); };
  q("#rp").onclick = () => pickPerson("Responsável", (x) => { resp = x; q("#rn").textContent = x.name; });
  q("#ok").onclick = async (e) => {
    const b = e.currentTarget; busy(b);
    try {
      const f = q("#r").value;
      const recurrence = f === "dates" ? { freq: f, dates } : { freq: f, weekdays: f === "weekdays" ? [...s.el.querySelectorAll("[data-wd]")].filter((i) => i.checked).map((i) => Number(i.dataset.wd)) : undefined, until: ["none", "dates"].includes(f) ? undefined : q("#un").value || undefined };
      const body = { name: q("#n").value, category: q("#c").value, visibility: q("#vi").value, description: q("#d").value, location: q("#l").value, start_date: q("#sd").value, starts_time: q("#st").value, ends_time: q("#en").value, responsible_person_id: resp.id || null, notes: q("#o").value, recurrence };
      const r = await sb.rpc("prog_save", { p_org: state.org.id, p_id: p?.id || null, p: body });
      if (r.error) return toast(errText(r.error)); toast("Programação salva."); s.close(); done(r.data);
    } finally { busy(b, false); }
  };
}

// ---------------------------------------------------------------- detalhe
async function detail(el, alive, id) {
  el.innerHTML = `${head("Programação", ["#/programacoes/lista", "Programações"])}${spinner()}`;
  const r = await sb.rpc("prog_get", { p_id: id });
  if (!alive()) return; if (r.error) return fail(el, "Programação", r.error, ["#/programacoes/lista", "Programações"]);
  const g = r.data, p = g.program, can = g.can;
  const from = new Date(); const to = new Date(Date.now() + 120 * 864e5);
  const o = await sb.rpc("prog_occurrences", { p_org: state.org.id, p_from: iso(from), p_to: iso(to) });
  const next = (o.data || []).filter((x) => x.prog_id === id).slice(0, 12);
  const reload = () => detail(el, alive, id);
  const act = async (fn, args, ok) => { const x = await sb.rpc(fn, args); if (x.error) { toast(errText(x.error)); return false; } toast(ok); reload(); return true; };
  const reason = (title, label, cb) => {
    const z = sheet(`<h3>${esc(title)}</h3><label class="fld">${esc(label)}<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Confirmar</button>`);
    z.el.querySelector("#ok").onclick = async (ev) => { const b = ev.currentTarget; busy(b); try { if (await cb(z.el.querySelector("#rs").value)) z.close(); } finally { busy(b, false); } };
  };
  el.innerHTML = `${head(p.name, ["#/programacoes/lista", "Programações"])}
    <div class="card"><span class="ptag ${p.status === "published" ? "member" : "none"}">${STATUS[p.status]}</span> <span class="small muted">${CATS[p.category]} · ${VIS[p.visibility]}</span>
      <p class="row gap-s mt">${icon("clock")} ${hhmm(p.starts_time)}${p.ends_time ? `–${hhmm(p.ends_time)}` : ""} · ${esc(recText(p.recurrence))}</p>${p.location ? `<p class="row gap-s muted">${icon("pin")} ${esc(p.location)}</p>` : ""}
      ${p.responsible ? `<p class="small muted">Responsável: ${esc(p.responsible)}</p>` : ""}${p.description ? `<p>${esc(p.description)}</p>` : ""}${p.notes ? `<p class="small muted">${esc(p.notes)}</p>` : ""}
      <div class="row gap" style="flex-wrap:wrap">${can.manage && p.status !== "cancelled" ? `<button class="btn ghost sm" id="edit">${icon("edit")} Editar</button>` : ""}
        ${can.publish && p.status === "draft" ? `<button class="btn primary sm" id="pub">Publicar</button>` : ""}${can.publish && p.status === "published" ? `<button class="btn ghost sm" id="unp">Despublicar</button>` : ""}
        ${(can.publish || can.manage) && p.status !== "cancelled" ? `<button class="btn ghost sm" id="can">Cancelar programação</button>` : ""}</div></div>
    ${p.status !== "cancelled" ? `<div class="row between mt"><h3>Próximas datas</h3>${can.run ? `<button class="btn ghost sm" id="std">Ordem padrão</button>` : ""}</div>
      <div class="list">${next.map((x) => `<div class="li stack${x.status === "cancelled" ? " muted" : ""}">${occInner(x)}<div class="row gap" style="flex-wrap:wrap">
        ${can.run ? `<button class="btn ghost sm" data-ag="${x.date}">Ordem do dia</button>` : ""}${can.manage ? (x.status === "cancelled" ? `<button class="btn ghost sm" data-rs="${x.date}">Restaurar</button>` : `<button class="btn ghost sm" data-md="${x.date}" data-st="${x.starts_time}" data-en="${x.ends_time || ""}" data-lc="${attr(x.location || "")}">Alterar</button><button class="btn ghost sm" data-cx="${x.date}">Cancelar esta data</button>`) : ""}</div></div>`).join("") || `<div class="li muted small">Sem datas nos próximos 4 meses${p.status === "draft" ? " (publique para aparecer para todos)" : ""}.</div>`}</div>` : ""}
    ${g.exceptions.length ? `<h3 class="mt">Alterações e cancelamentos</h3><div class="list">${g.exceptions.map((e) => `<div class="li stack"><span class="t">${fmtDay(e.date)} · ${e.kind === "cancel" ? "Cancelada" : "Alterada"}${e.voided_at ? " (desfeita)" : ""}</span><span class="s">${e.kind === "modify" ? `${e.starts_time ? hhmm(e.starts_time) : ""}${e.ends_time ? `–${hhmm(e.ends_time)}` : ""}${e.location ? ` · ${esc(e.location)}` : ""} ` : ""}${e.reason ? esc(e.reason) : ""}</span></div>`).join("")}</div>` : ""}
    <h3 class="mt">Histórico</h3><div class="list">${g.history.map((h) => `<div class="li stack"><span class="t">${esc(HIST[h.action] || h.action)}${h.detail?.date ? ` · ${fmtDay(h.detail.date)}` : ""}</span><span class="s">${fmtWhen(h.at)}${h.by ? ` · ${esc(h.by)}` : ""}${h.reason ? ` · ${esc(h.reason)}` : ""}</span></div>`).join("")}</div>`;
  const on = (id2, fn) => { const b = el.querySelector(id2); if (b) b.onclick = fn; };
  on("#edit", () => progForm(p, reload));
  on("#pub", () => act("prog_set_status", { p_id: id, p_status: "published" }, "Programação publicada."));
  on("#unp", () => act("prog_set_status", { p_id: id, p_status: "draft" }, "Programação despublicada."));
  on("#can", () => reason("Cancelar a programação inteira?", "Motivo", (rs) => act("prog_set_status", { p_id: id, p_status: "cancelled", p_reason: rs }, "Programação cancelada.")));
  on("#std", () => agendaEditor(id, null, p.name));
  el.onclick = (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.ag) agendaEditor(id, t.dataset.ag, p.name);
    if (t.dataset.cx) reason(`Cancelar ${fmtDay(t.dataset.cx)}?`, "Motivo", (rs) => act("prog_exception_set", { p_id: id, p_date: t.dataset.cx, p_kind: "cancel", p: {}, p_reason: rs }, "Data cancelada."));
    if (t.dataset.rs) act("prog_exception_clear", { p_id: id, p_date: t.dataset.rs, p_reason: "Data restaurada" }, "Data restaurada.");
    if (t.dataset.md) {
      const d = t.dataset;
      const z = sheet(`<h3>Alterar ${fmtDay(d.md)}</h3><div class="row gap"><label class="fld grow">Início<input id="a" type="time" value="${hhmm(d.st)}"></label><label class="fld grow">Fim<input id="b" type="time" value="${hhmm(d.en)}"></label></div>
        <label class="fld">Local<input id="l" maxlength="160" value="${attr(d.lc)}"></label><label class="fld">Aviso (opcional)<input id="n" maxlength="300" placeholder="Ex.: culto no salão"></label><button class="btn block mt" id="ok">Salvar alteração</button>`);
      z.el.querySelector("#ok").onclick = async (ev) => { const b = ev.currentTarget; busy(b); try { if (await act("prog_exception_set", { p_id: id, p_date: d.md, p_kind: "modify", p: { starts_time: z.el.querySelector("#a").value, ends_time: z.el.querySelector("#b").value, location: z.el.querySelector("#l").value, note: z.el.querySelector("#n").value }, p_reason: null }, "Data alterada.")) z.close(); } finally { busy(b, false); } };
    }
  };
}
const HIST = { create: "Programação criada", edit: "Cadastro alterado", publish: "Publicada", unpublish: "Despublicada", cancel: "Programação cancelada", exception_cancel: "Data cancelada", exception_modify: "Data alterada", exception_clear: "Data restaurada", agenda_save: "Ordem de atividades alterada" };

// ordem de atividades: lista livre (título, horário previsto, duração, responsável, observações)
async function agendaEditor(id, date, name) {
  const r = await sb.rpc("prog_agenda_get", { p_id: id, p_date: date });
  if (r.error) return toast(errText(r.error));
  const items = r.data.items.map((i) => ({ title: i.title, planned_time: hhmm(i.planned_time), duration_min: i.duration_min ?? "", responsible_person_id: i.responsible_person_id || "", responsible: i.responsible || "", notes: i.notes || "" }));
  const s = sheet(`<h3>Ordem ${date ? `de ${fmtDay(date)}` : "padrão"} — ${esc(name)}</h3><p class="muted small">${date ? (r.data.specific ? "Esta data tem uma ordem própria." : "Esta data usa a ordem padrão. Ao salvar, ela passa a ter uma ordem própria.") : "Vale para todas as datas que não tiverem ordem própria."} Monte do jeito que sua igreja faz.</p><div id="rows"></div>
    <button class="btn ghost sm mt" id="add">${icon("plus")} Adicionar atividade</button><button class="btn block mt" id="ok">Salvar ordem</button>${date && r.data.specific ? `<button class="btn ghost block mt" id="clr">Voltar a usar a ordem padrão</button>` : ""}`);
  const rows = s.el.querySelector("#rows");
  const draw = () => {
    rows.innerHTML = items.map((i, n) => `<div class="card mb" data-i="${n}"><div class="row gap"><input data-f="title" class="grow" maxlength="120" placeholder="Atividade" value="${attr(i.title)}" aria-label="Atividade"><button class="iconbtn" data-up aria-label="Subir">${icon("chevronUp")}</button><button class="iconbtn" data-dn aria-label="Descer">${icon("chevronDown")}</button><button class="iconbtn" data-rm aria-label="Remover">${icon("trash")}</button></div>
      <div class="row gap mt"><input data-f="planned_time" type="time" value="${i.planned_time}" aria-label="Horário previsto"><input data-f="duration_min" type="number" min="0" inputmode="numeric" placeholder="min" value="${i.duration_min}" style="width:80px" aria-label="Duração em minutos"><button class="btn ghost sm grow" data-who>${esc(i.responsible || "Responsável")}</button></div>
      <input data-f="notes" class="mt" maxlength="500" placeholder="Observações" value="${attr(i.notes)}" aria-label="Observações"></div>`).join("") || `<div class="muted small">Nenhuma atividade. Adicione a primeira.</div>`;
  };
  draw();
  const grab = () => rows.querySelectorAll("[data-i]").forEach((c) => { const i = items[Number(c.dataset.i)]; c.querySelectorAll("[data-f]").forEach((f) => { i[f.dataset.f] = f.value; }); });
  rows.onclick = (e) => {
    const c = e.target.closest("[data-i]"); if (!c) return; const n = Number(c.dataset.i); grab();
    if (e.target.closest("[data-rm]")) { items.splice(n, 1); draw(); }
    else if (e.target.closest("[data-up]") && n > 0) { [items[n - 1], items[n]] = [items[n], items[n - 1]]; draw(); }
    else if (e.target.closest("[data-dn]") && n < items.length - 1) { [items[n + 1], items[n]] = [items[n], items[n + 1]]; draw(); }
    else if (e.target.closest("[data-who]")) pickPerson("Responsável pela atividade", (x) => { items[n].responsible_person_id = x.id; items[n].responsible = x.name; draw(); });
  };
  s.el.querySelector("#add").onclick = () => { grab(); items.push({ title: "", planned_time: "", duration_min: "", responsible_person_id: "", responsible: "", notes: "" }); draw(); };
  const save = async (list, btn) => {
    busy(btn);
    try {
      const x = await sb.rpc("prog_agenda_save", { p_id: id, p_date: date, p_items: list.map((i) => ({ title: i.title, planned_time: i.planned_time || null, duration_min: i.duration_min === "" ? null : Number(i.duration_min), responsible_person_id: i.responsible_person_id || null, notes: i.notes })) });
      if (x.error) return toast(errText(x.error)); toast("Ordem salva."); s.close();
    } finally { busy(btn, false); }
  };
  s.el.querySelector("#ok").onclick = (e) => { grab(); save(items, e.currentTarget); };
  const cl = s.el.querySelector("#clr"); if (cl) cl.onclick = (e) => save([], e.currentTarget);
}
