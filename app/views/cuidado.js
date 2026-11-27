// Cuidado com Pessoas: pedidos de oração, intercessão e atendimento pastoral.
// Toda regra de acesso está no banco; esta tela nunca guarda nem repete o conteúdo dos pedidos fora do que o banco devolveu.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen, toLocalInput, iso, pickPerson } from "../lib/mod-ui.js";

export function register(route) {
  route("/cuidado", (p, el, a) => member(el, a));
  route("/cuidado-gestao", (p, el, a) => manage(el, a));
  route("/intercessao", (p, el, a) => groupInbox(el, a));
}

const tag = (t, c = "none") => `<span class="ptag ${c}">${esc(t)}</span>`;
const PST = { received: ["Recebido", "st-pending"], in_prayer: ["Em oração", "st-approved"], followup: ["Em acompanhamento", "st-approved"], closed: ["Encerrado", "none"] };
const AST = { requested: ["Solicitado", "st-pending"], scheduled: ["Agendado", "st-approved"], done: ["Realizado", "none"], cancelled: ["Cancelado", "none"], referred: ["Encaminhado", "none"] };
const TOPIC = { counsel: "Aconselhamento", visit: "Visita", family: "Família", grief: "Luto", spiritual: "Vida espiritual", other: "Outro assunto" };
const CATS = ["Saúde", "Família", "Trabalho e finanças", "Vida espiritual", "Gratidão", "Outro"];
const NOTE = `<p class="small muted">Seus pedidos ficam protegidos: só quem você escolher aqui, ou a liderança autorizada, pode ler. Nada é mostrado para toda a igreja.</p>`;
const org = () => state.org?.id;

// ---------------------------------------------------------------- membro
async function member(el, alive) {
  el.innerHTML = `${head("Cuidado com Pessoas", ["#/chamados", "SOMOS Chamados"])}${spinner()}`;
  const [ov, pr, pa] = await Promise.all([sb.rpc("care_overview", { p_org: org() }), sb.rpc("prayer_my_requests", { p_org: org() }), sb.rpc("pastoral_my_requests", { p_org: org() })]); if (!alive()) return;
  if (ov.error) return fail(el, "Cuidado com Pessoas", ov.error, ["#/chamados", "SOMOS Chamados"]);
  const o = ov.data, prayers = pr.data || [], pastoral = pa.data || [];
  const staff = o.can.prayer || o.can.pastoral || o.can.manage;
  el.innerHTML = `${head("Cuidado com Pessoas", ["#/chamados", "SOMOS Chamados"])}
    <div class="mc-tiles mb"><button class="mc-tile" id="np">${icon("heart")}<span>Pedir oração</span></button><button class="mc-tile" id="na">${icon("user")}<span>Pedir atendimento</span></button></div>
    ${staff ? `<a class="li mb" href="#/cuidado-gestao">${icon("lock")}<span class="grow"><span class="t">Área de cuidado</span><span class="s">Pedidos, atendimentos e grupos (acesso autorizado)</span></span>${icon("chevronRight", "chev")}</a>` : ""}
    ${o.in_group ? `<a class="li mb" href="#/intercessao">${icon("heart")}<span class="grow"><span class="t">Pedidos do meu grupo</span><span class="s">Pedidos compartilhados com você para orar</span></span>${icon("chevronRight", "chev")}</a>` : ""}
    <h3>Meus pedidos de oração</h3>
    <div class="list">${prayers.map((r) => `<button class="li col stack" data-p="${r.id}" style="align-items:stretch"><div class="row between"><b>${esc(r.category || "Pedido de oração")}</b>${tag(PST[r.status][0], PST[r.status][1])}</div>
      <span class="small muted">${fmtWhen(r.created_at)} · ${r.privacy === "group" ? `Grupo: ${esc(r.group || "")}` : "Só liderança autorizada"}${r.anonymous ? " · Anônimo" : ""}</span></button>`).join("") || empty("heart", "Você ainda não fez pedidos")}</div>
    <h3 class="mt">Meus pedidos de atendimento</h3>
    <div class="list">${pastoral.map((r) => `<button class="li col stack" data-a="${r.id}" style="align-items:stretch"><div class="row between"><b>${esc(TOPIC[r.topic])}</b>${tag(AST[r.status][0], AST[r.status][1])}</div>
      <span class="small muted">${fmtWhen(r.created_at)}${r.scheduled_at ? ` · marcado para ${fmtWhen(r.scheduled_at)}` : ""}</span></button>`).join("") || empty("user", "Nenhuma solicitação")}</div>`;
  el.querySelector("#np").onclick = () => prayerForm(o, () => member(el, alive));
  el.querySelector("#na").onclick = () => pastoralForm(() => member(el, alive));
  el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
    const r = prayers.find((x) => x.id === b.dataset.p);
    const s = sheet(`<h3>${esc(r.category || "Pedido de oração")}</h3><p class="row gap-s">${tag(PST[r.status][0], PST[r.status][1])}</p><p class="small" style="white-space:pre-wrap">${esc(r.body)}</p>
      <p class="small muted">${r.privacy === "group" ? `Compartilhado com o grupo ${esc(r.group || "")}.` : "Visível só para a liderança autorizada."}${r.anonymous ? " Enviado como anônimo." : ""}${r.wants_followup ? " Você pediu acompanhamento." : ""}</p>
      ${r.status !== "closed" ? `<button class="btn ghost sm" id="close">Encerrar pedido</button>` : ""}`);
    const c = s.el.querySelector("#close");
    if (c) c.onclick = async (ev) => { if (!(await confirmDialog("Encerrar este pedido? Quem ora por ele deixará de vê-lo.", "Encerrar", true))) return; busy(ev.currentTarget); const x = await sb.rpc("prayer_my_close", { p_id: r.id }); if (x.error) { busy(ev.currentTarget, false); return toast(errText(x.error)); } s.close(); toast("Pedido encerrado."); member(el, alive); };
  }));
  el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
    const r = pastoral.find((x) => x.id === b.dataset.a);
    const s = sheet(`<h3>${esc(TOPIC[r.topic])}</h3><p class="row gap-s">${tag(AST[r.status][0], AST[r.status][1])}</p>${r.body ? `<p class="small" style="white-space:pre-wrap">${esc(r.body)}</p>` : ""}
      ${r.scheduled_at ? `<div class="card small">Marcado para <b>${fmtWhen(r.scheduled_at)}</b>${r.responsible ? ` com ${esc(r.responsible)}` : ""}.</div>` : ""}
      ${["requested", "scheduled"].includes(r.status) ? `<button class="btn ghost danger sm mt" id="cancel">Cancelar solicitação</button>` : ""}`);
    const c = s.el.querySelector("#cancel");
    if (c) c.onclick = async (ev) => { if (!(await confirmDialog("Cancelar esta solicitação?", "Cancelar", true))) return; busy(ev.currentTarget); const x = await sb.rpc("pastoral_my_cancel", { p_id: r.id }); if (x.error) { busy(ev.currentTarget, false); return toast(errText(x.error)); } s.close(); toast("Solicitação cancelada."); member(el, alive); };
  }));
}

function prayerForm(o, done) {
  const s = sheet(`<h3>Pedir oração</h3>${NOTE}
    <label class="field"><span>Seu pedido</span><textarea id="body" rows="5" maxlength="2000" placeholder="Escreva com liberdade"></textarea></label>
    <label class="field"><span>Assunto (opcional)</span><select id="cat"><option value="">—</option>${CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>
    <label class="field"><span>Quem pode ler</span><select id="priv"><option value="leadership">Só a liderança autorizada</option>${o.groups.length ? `<option value="group">Um grupo de intercessão</option>` : ""}</select></label>
    <label class="field" id="gw" hidden><span>Grupo</span><select id="grp">${o.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label>
    ${o.allow_anonymous ? `<label class="check"><input type="checkbox" id="anon"> Enviar sem meu nome</label>` : ""}
    <label class="check"><input type="checkbox" id="fu"> Quero que alguém acompanhe meu pedido</label>
    <button class="btn primary mt" id="go">Enviar pedido</button>`);
  const q = (k) => s.el.querySelector(k);
  q("#priv").onchange = () => (q("#gw").hidden = q("#priv").value !== "group");
  q("#go").onclick = async (ev) => {
    const body = q("#body").value.trim(); if (!body) return toast("Escreva o seu pedido.");
    busy(ev.currentTarget);
    const r = await sb.rpc("prayer_request_create", { p_org: org(), p: { body, category: q("#cat").value || null, privacy: q("#priv").value, group_id: q("#priv").value === "group" ? q("#grp").value : null, anonymous: !!q("#anon")?.checked, wants_followup: q("#fu").checked } });
    if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); }
    s.close(); toast("Pedido enviado. Estamos com você."); done();
  };
}
function pastoralForm(done) {
  const s = sheet(`<h3>Pedir atendimento pastoral</h3><p class="small muted">Somente a equipe pastoral autorizada vê a sua solicitação.</p>
    <label class="field"><span>Assunto</span><select id="topic">${Object.entries(TOPIC).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="field"><span>Quer contar mais? (opcional)</span><textarea id="body" rows="4" maxlength="1000"></textarea></label>
    <label class="field"><span>Melhores dias e horários (opcional)</span><input id="pref" maxlength="200"></label>
    <button class="btn primary mt" id="go">Enviar solicitação</button>`);
  const q = (k) => s.el.querySelector(k);
  q("#go").onclick = async (ev) => {
    busy(ev.currentTarget);
    const r = await sb.rpc("pastoral_request_create", { p_org: org(), p: { topic: q("#topic").value, body: q("#body").value, preferred: q("#pref").value } });
    if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); }
    s.close(); toast("Solicitação enviada."); done();
  };
}

// ---------------------------------------------------------------- grupo de intercessão
async function groupInbox(el, alive) {
  const back = ["#/cuidado", "Cuidado com Pessoas"]; el.innerHTML = `${head("Pedidos do meu grupo", back)}${spinner()}`;
  const r = await sb.rpc("prayer_group_inbox", { p_org: org() }); if (!alive()) return;
  if (r.error) return fail(el, "Pedidos do meu grupo", r.error, back);
  el.innerHTML = `${head("Pedidos do meu grupo", back)}<p class="small muted">Estes pedidos foram compartilhados com o seu grupo. Trate com sigilo: não repasse fora do grupo.</p>
    <div class="list">${r.data.map((x) => `<div class="li col stack" style="align-items:stretch"><div class="row between"><b>${esc(x.category || "Pedido")}</b>${tag(x.group)}</div>
      <p class="small" style="white-space:pre-wrap;margin:4px 0">${esc(x.body)}</p><div class="row between small muted"><span>${x.requester ? esc(x.requester) : "Anônimo"} · ${fmtWhen(x.created_at)}</span>
      <button class="btn ghost sm" data-pray="${x.id}" ${x.prayed_by_me ? "disabled" : ""}>${x.prayed_by_me ? "Você orou" : "Orei"}${x.prayers ? ` · ${x.prayers}` : ""}</button></div></div>`).join("") || empty("heart", "Nenhum pedido compartilhado agora")}</div>`;
  el.querySelectorAll("[data-pray]").forEach((b) => (b.onclick = async () => { busy(b); const x = await sb.rpc("prayer_request_pray", { p_id: b.dataset.pray }); if (x.error) { busy(b, false); return toast(errText(x.error)); } groupInbox(el, alive); }));
}

// ---------------------------------------------------------------- gestão (acesso autorizado)
async function manage(el, alive) {
  const back = ["#/cuidado", "Cuidado com Pessoas"]; el.innerHTML = `${head("Área de cuidado", back)}${spinner()}`;
  const ov = await sb.rpc("care_overview", { p_org: org() }); if (!alive()) return;
  if (ov.error) return fail(el, "Área de cuidado", ov.error, back);
  const can = ov.data.can; if (!(can.prayer || can.pastoral || can.manage)) return fail(el, "Área de cuidado", { message: "forbidden" }, back);
  const TABS = [[can.prayer, "pray", "Pedidos de oração"], [can.pastoral, "req", "Atendimentos"], [can.pastoral, "ses", "Registros"], [can.manage, "grp", "Grupos"], [can.manage, "rep", "Resumo e acessos"]].filter((t) => t[0]);
  let tab = TABS[0][1], filt = "open";
  const draw = async () => {
    el.innerHTML = `${head("Área de cuidado", back)}<p class="small muted">Conteúdo confidencial. Cada abertura de pedido ou registro fica anotada.</p><nav class="tabs">${TABS.map((t) => `<button class="${tab === t[1] ? "on" : ""}" data-t="${t[1]}">${t[2]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const body = el.querySelector("#body"); await ({ pray: prayerTab, req: requestTab, ses: sessionTab, grp: groupTab, rep: reportTab }[tab])(body);
  };
  const err = (body, e) => (body.innerHTML = `<div class="card small">${esc(errText(e))}</div>`);

  async function prayerTab(body) {
    const r = await sb.rpc("prayer_inbox", { p_org: org(), p_filter: filt === "open" ? { open: true } : filt === "none" ? { open: true, assigned: "none" } : filt === "me" ? { open: true, assigned: "me" } : {} }); if (!alive()) return;
    if (r.error) return err(body, r.error);
    body.innerHTML = `<div class="chips mb">${[["open", "Abertos"], ["none", "Sem responsável"], ["me", "Comigo"], ["all", "Todos"]].map(([k, l]) => `<button class="chip ${filt === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
      <div class="list">${r.data.map((x) => `<button class="li col stack" data-id="${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.category || "Pedido de oração")}</b>${tag(PST[x.status][0], PST[x.status][1])}</div>
        <span class="small muted">${x.anonymous ? "Anônimo" : esc(x.requester || "")} · ${fmtWhen(x.created_at)} · ${x.privacy === "group" ? `Grupo: ${esc(x.group || "")}` : "Liderança"}${x.assigned ? ` · ${esc(x.assigned)}` : " · sem responsável"}${x.wants_followup ? " · pede acompanhamento" : ""}</span></button>`).join("") || empty("heart", "Nenhum pedido aqui")}</div>`;
    body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filt = b.dataset.f; draw(); }));
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => prayerDetail(b.dataset.id)));
  }
  async function prayerDetail(id) {
    const r = await sb.rpc("prayer_request_get", { p_id: id }); if (r.error) return toast(errText(r.error));
    const { request: x, events, authorized, prayers } = r.data;
    const s = sheet(`<h3>${esc(x.category || "Pedido de oração")}</h3><p class="row gap-s">${tag(PST[x.status][0], PST[x.status][1])}${x.anonymous ? tag("Anônimo") : ""}</p>
      <p class="small" style="white-space:pre-wrap">${esc(x.body)}</p>
      <p class="small muted">${x.anonymous ? "Anônimo" : esc(x.requester || "")} · ${fmtWhen(x.created_at)} · ${x.privacy === "group" ? `Compartilhado com ${esc(x.group || "grupo")}` : "Só liderança autorizada"}${x.wants_followup ? " · pediu acompanhamento" : ""}${prayers ? ` · ${prayers} oraram` : ""}</p>
      <label class="field"><span>Situação</span><select id="st">${Object.entries(PST).map(([k, v]) => `<option value="${k}" ${k === x.status ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
      <label class="field"><span>Responsável</span><select id="as"><option value="">Sem responsável</option>${(authorized || []).map((a) => `<option value="${a.user_id}" ${a.user_id === x.assigned_to ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Anotação interna (não vai para quem pediu)</span><input id="note" maxlength="300"></label>
      <button class="btn primary mt" id="save">Salvar</button> <button class="btn ghost mt" id="pray">Orei por este pedido</button>
      ${events?.length ? `<h4 class="mt">Histórico</h4><div class="list">${events.map((e) => `<div class="li small col stack"><span>${{ created: "Pedido recebido", status: "Situação alterada", assigned: "Responsável alterado", note: "Anotação", shared: "Compartilhado", praying: "Alguém orou", closed_by_requester: "Encerrado por quem pediu" }[e.action] || e.action}${e.note ? `: ${esc(e.note)}` : ""}</span><span class="muted">${fmtWhen(e.at)}${e.by ? ` · ${esc(e.by)}` : ""}</span></div>`).join("")}</div>` : ""}`);
    const q = (k) => s.el.querySelector(k);
    q("#save").onclick = async (ev) => { busy(ev.currentTarget); const p = { status: q("#st").value, assigned_to: q("#as").value || null, note: q("#note").value || null }; const u = await sb.rpc("prayer_request_update", { p_id: id, p }); if (u.error) { busy(ev.currentTarget, false); return toast(errText(u.error)); } s.close(); toast("Pedido atualizado."); draw(); };
    q("#pray").onclick = async (ev) => { busy(ev.currentTarget); const u = await sb.rpc("prayer_request_pray", { p_id: id }); busy(ev.currentTarget, false); toast(u.error ? errText(u.error) : "Registrado. Obrigado por orar."); };
  }

  async function requestTab(body) {
    const r = await sb.rpc("pastoral_inbox", { p_org: org(), p_filter: {} }); if (!alive()) return;
    if (r.error) return err(body, r.error);
    const { items, authorized } = r.data;
    body.innerHTML = `<div class="list">${items.map((x) => `<button class="li col stack" data-id="${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.requester)}</b>${tag(AST[x.status][0], AST[x.status][1])}</div>
      <span class="small muted">${esc(TOPIC[x.topic])} · ${fmtWhen(x.created_at)}${x.responsible ? ` · ${esc(x.responsible)}` : ""}${x.scheduled_at ? ` · ${fmtWhen(x.scheduled_at)}` : ""}</span></button>`).join("") || empty("user", "Nenhuma solicitação")}</div>`;
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => requestDetail(b.dataset.id, authorized)));
  }
  async function requestDetail(id, authorized) {
    const r = await sb.rpc("pastoral_request_get", { p_id: id }); if (r.error) return toast(errText(r.error));
    const x = r.data.request, open = ["requested", "scheduled"].includes(x.status);
    const s = sheet(`<h3>${esc(x.requester)}</h3><p class="row gap-s">${tag(AST[x.status][0], AST[x.status][1])}${tag(TOPIC[x.topic])}</p>${x.body ? `<p class="small" style="white-space:pre-wrap">${esc(x.body)}</p>` : ""}
      ${x.preferred ? `<p class="small muted">Preferência: ${esc(x.preferred)}</p>` : ""}${x.referral_note ? `<p class="small muted">Encaminhamento: ${esc(x.referral_note)}</p>` : ""}
      ${open ? `<label class="field"><span>Responsável</span><select id="rs"><option value="">—</option>${authorized.map((a) => `<option value="${a.user_id}" ${a.user_id === x.responsible_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Data e hora</span><input type="datetime-local" id="when" value="${x.scheduled_at ? toLocalInput(x.scheduled_at) : ""}"></label>
        <label class="field"><span>Encaminhamento (se for o caso)</span><input id="ref" maxlength="300" placeholder="Ex.: encaminhado a profissional de apoio"></label>
        <div class="row gap-s" style="flex-wrap:wrap"><button class="btn primary sm" id="sch">Agendar</button><button class="btn ghost sm" id="rfr">Encaminhar</button><button class="btn ghost sm" id="reg">Registrar atendimento realizado</button></div>` : ""}
      ${r.data.history?.length ? `<h4 class="mt">Histórico</h4><div class="list">${r.data.history.map((h) => `<div class="li small col stack"><span>${esc(h.action)}</span><span class="muted">${fmtWhen(h.at)}${h.by ? ` · ${esc(h.by)}` : ""}</span></div>`).join("")}</div>` : ""}`);
    const q = (k) => s.el.querySelector(k);
    const send = async (ev, p, msg) => { busy(ev.currentTarget); const u = await sb.rpc("pastoral_request_update", { p_id: id, p }); if (u.error) { busy(ev.currentTarget, false); return toast(errText(u.error)); } s.close(); toast(msg); draw(); };
    if (q("#sch")) q("#sch").onclick = (ev) => send(ev, { status: "scheduled", responsible: q("#rs").value || null, scheduled_at: q("#when").value ? new Date(q("#when").value).toISOString() : null }, "Atendimento agendado.");
    if (q("#rfr")) q("#rfr").onclick = (ev) => send(ev, { status: "referred", referral_note: q("#ref").value }, "Solicitação encaminhada.");
    if (q("#reg")) q("#reg").onclick = () => { s.close(); sessionForm(null, id); };
  }

  async function sessionTab(body) {
    const r = await sb.rpc("pastoral_session_list", { p_org: org(), p_filter: {} }); if (!alive()) return;
    if (r.error) return err(body, r.error);
    body.innerHTML = `<button class="btn primary sm mb" id="new">${icon("plus")} Registrar atendimento</button><div class="list">${r.data.map((x) => `<button class="li col stack" data-id="${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.person || "Sem pessoa vinculada")}</b>${x.has_restricted ? tag("Obs. restrita") : ""}</div>
      <span class="small muted">${fmtWhen(x.held_at)} · ${esc(x.held_by)}${x.followup_on ? ` · retorno em ${new Date(x.followup_on + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}</span></button>`).join("") || empty("user", "Nenhum atendimento registrado")}</div>`;
    body.querySelector("#new").onclick = () => sessionForm(null, null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => {
      const x = r.data.find((y) => y.id === b.dataset.id);
      const s = sheet(`<h3>${esc(x.person || "Atendimento")}</h3><p class="small muted">${fmtWhen(x.held_at)} · ${esc(x.held_by)}</p>${x.summary ? `<p class="small" style="white-space:pre-wrap">${esc(x.summary)}</p>` : ""}
        ${x.mine ? (x.restricted_note ? `<div class="card small"><b>Observação restrita (só você vê)</b><p style="white-space:pre-wrap">${esc(x.restricted_note)}</p></div>` : "") : x.has_restricted ? `<p class="small muted">Há observação restrita, visível apenas a quem registrou.</p>` : ""}
        ${x.mine ? `<button class="btn ghost sm" id="ed">Editar</button>` : ""}`);
      const e = s.el.querySelector("#ed"); if (e) e.onclick = () => { s.close(); sessionForm(x, x.request_id); };
    }));
  }
  function sessionForm(x, reqId) {
    let person = x?.person_id ? { id: x.person_id, name: x.person } : null;
    const s = sheet(`<h3>${x ? "Editar registro" : "Registrar atendimento realizado"}</h3>
      <div class="field"><span>Pessoa atendida (opcional)</span><button class="btn ghost sm" id="pp">${person ? esc(person.name) : "Escolher pessoa"}</button></div>
      <label class="field"><span>Data e hora</span><input type="datetime-local" id="at" value="${toLocalInput(x?.held_at || new Date())}"></label>
      <label class="field"><span>Resumo (visível à equipe pastoral)</span><textarea id="sum" rows="3" maxlength="2000">${esc(x?.summary || "")}</textarea></label>
      <label class="field"><span>Observação restrita (só você lê)</span><textarea id="rn" rows="3" maxlength="4000">${esc(x?.restricted_note || "")}</textarea></label>
      <label class="field"><span>Retorno em (opcional)</span><input type="date" id="fu" value="${attr(x?.followup_on || "")}"></label>
      <button class="btn primary mt" id="go">Salvar registro</button>`);
    const q = (k) => s.el.querySelector(k);
    q("#pp").onclick = () => pickPerson("Pessoa atendida", (p) => { person = p; q("#pp").textContent = p.name; });
    q("#go").onclick = async (ev) => {
      busy(ev.currentTarget);
      const r = await sb.rpc("pastoral_session_save", { p_org: org(), p_id: x?.id || null, p: { request_id: reqId || null, person_id: person?.id || null, held_at: new Date(q("#at").value).toISOString(), summary: q("#sum").value, restricted_note: q("#rn").value, followup_on: q("#fu").value || null } });
      if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); }
      s.close(); toast("Registro salvo."); tab = "ses"; draw();
    };
  }

  async function groupTab(body) {
    const [g, ovr] = await Promise.all([sb.rpc("care_group_list", { p_org: org() }), sb.rpc("care_overview", { p_org: org() })]); if (!alive()) return;
    if (g.error) return err(body, g.error);
    const { groups, candidates, authorized } = g.data, anon = ovr.data.allow_anonymous;
    body.innerHTML = `<label class="check mb"><input type="checkbox" id="anon" ${anon ? "checked" : ""}> Permitir pedidos de oração anônimos</label>
      <button class="btn primary sm mb" id="new">${icon("plus")} Novo grupo de intercessão</button>
      <div class="list">${groups.map((x) => `<button class="li col stack" data-id="${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.name)}</b>${x.active ? "" : tag("Inativo")}</div><span class="small muted">${x.members.length} pessoa(s)</span></button>`).join("") || empty("heart", "Nenhum grupo ainda")}</div>
      <h4 class="mt">Pessoas com acesso aos pedidos</h4><p class="small muted">${authorized.map((a) => esc(a.name)).join(", ") || "—"}</p>`;
    body.querySelector("#anon").onchange = async (e) => { const r = await sb.rpc("care_settings_save", { p_org: org(), p: { allow_anonymous: e.target.checked } }); if (r.error) { e.target.checked = !e.target.checked; toast(errText(r.error)); } else toast(e.target.checked ? "Pedidos anônimos permitidos." : "Pedidos anônimos desativados."); };
    body.querySelector("#new").onclick = () => groupForm(null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => groupDetail(groups.find((x) => x.id === b.dataset.id), candidates)));
  }
  function groupForm(x) {
    const s = sheet(`<h3>${x ? "Editar grupo" : "Novo grupo de intercessão"}</h3><label class="field"><span>Nome</span><input id="n" maxlength="80" value="${attr(x?.name || "")}"></label>
      <label class="field"><span>Descrição (opcional)</span><input id="d" maxlength="300" value="${attr(x?.description || "")}"></label>${x ? `<label class="check"><input type="checkbox" id="a" ${x.active ? "checked" : ""}> Grupo ativo</label>` : ""}<button class="btn primary mt" id="go">Salvar</button>`);
    const q = (k) => s.el.querySelector(k);
    q("#go").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("care_group_save", { p_org: org(), p_id: x?.id || null, p: { name: q("#n").value, description: q("#d").value, active: x ? q("#a").checked : true } }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Grupo salvo."); draw(); };
  }
  function groupDetail(x, candidates) {
    const ids = new Set(x.members.map((m) => m.user_id));
    const s = sheet(`<h3>${esc(x.name)}</h3>${x.description ? `<p class="small muted">${esc(x.description)}</p>` : ""}
      <div class="list">${x.members.map((m) => `<div class="li row between"><span>${esc(m.name)}</span><button class="btn ghost danger sm" data-rm="${m.user_id}">Remover</button></div>`).join("") || `<div class="li muted small">Sem integrantes</div>`}</div>
      <label class="field mt"><span>Adicionar integrante</span><select id="add"><option value="">Escolher…</option>${candidates.filter((c) => !ids.has(c.user_id)).map((c) => `<option value="${c.user_id}">${esc(c.name)}</option>`).join("")}</select></label>
      <button class="btn ghost sm" id="ed">Editar grupo</button>`);
    const q = (k) => s.el.querySelector(k), set = async (u, on) => { const r = await sb.rpc("care_group_member_set", { p_group: x.id, p_user: u, p_in: on }); if (r.error) return toast(errText(r.error)); s.close(); draw(); };
    q("#add").onchange = (e) => e.target.value && set(e.target.value, true);
    s.el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => set(b.dataset.rm, false)));
    q("#ed").onclick = () => { s.close(); groupForm(x); };
  }

  async function reportTab(body) {
    const [r, l] = await Promise.all([sb.rpc("care_report", { p_org: org() }), sb.rpc("care_access_log", { p_org: org(), p_limit: 60 })]); if (!alive()) return;
    if (r.error) return err(body, r.error);
    const d = r.data, n = (v) => `<div class="card"><b style="font-size:1.4em">${v[0]}</b><div class="small muted">${v[1]}</div></div>`;
    body.innerHTML = `<p class="small muted">Só números. Nenhum pedido ou registro aparece em relatórios gerais ou segmentações.</p>
      <div class="grid2 mb">${[[d.prayer.received, "Pedidos novos"], [d.prayer.in_prayer + d.prayer.followup, "Em oração/acompanhamento"], [d.prayer.unassigned_open, "Abertos sem responsável"], [d.prayer.last_30_days, "Pedidos em 30 dias"], [d.pastoral.requested, "Atendimentos solicitados"], [d.pastoral.scheduled, "Atendimentos agendados"], [d.sessions.last_30_days, "Atendimentos realizados em 30 dias"], [d.groups, "Grupos de intercessão"]].map(n).join("")}</div>
      <h4>Últimos acessos</h4><div class="list">${(l.data || []).map((a) => `<div class="li small col stack"><span>${esc(a.actor || "—")} · ${a.action === "read" ? "abriu" : "listou"} ${{ prayer: "pedido de oração", pastoral_request: "solicitação de atendimento", pastoral_session: "registro de atendimento" }[a.entity]}</span><span class="muted">${fmtWhen(a.at)}</span></div>`).join("") || empty("lock", "Sem acessos registrados")}</div>`;
  }
  draw();
}
