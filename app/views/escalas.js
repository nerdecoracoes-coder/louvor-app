// Escalas gerais (SOMOS Chamados → Escalas) e "Minhas escalas" (SOMOS Um).
// Servem a qualquer atividade da igreja. O Ministério de Louvor continua com as escalas próprias; aqui elas só aparecem como aviso de conflito.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, modCan, modAny, cellScope } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen, iso, toLocalInput, pickPerson } from "../lib/mod-ui.js";

export function register(route) {
  route("/escalas", (p, el, a) => list(el, a, "prox"));
  route("/escalas/anteriores", (p, el, a) => list(el, a, "ant"));
  route("/escalas/:id", (p, el, a) => detail(el, a, p.id));
  route("/minhas-escalas", (p, el, a) => mine(el, a));
}

const ST = { draft: "Rascunho", published: "Publicada", awaiting: "Aguardando confirmação", partial: "Parcialmente confirmada", confirmed: "Confirmada", completed: "Concluída", cancelled: "Cancelada" };
const AST = { invited: "Aguardando", confirmed: "Confirmou", declined: "Recusou", sub_requested: "Pediu substituição" };
const KIND = { overlap: "Já escalado", unavailable: "Indisponível", louvor: "Escalado no Louvor" };
const tone = (s) => (["confirmed", "completed"].includes(s) ? "member" : s === "partial" ? "attender" : "none");
const conflictsHtml = (c) => (c || []).length ? `<div class="card"><b>Atenção a horários</b><div class="list mt">${c.map((x) => `<div class="li stack"><span class="t">${esc(x.name)} — ${KIND[x.kind] || x.kind}</span><span class="s">${esc(x.detail || "")}</span></div>`).join("")}</div></div>` : "";
const days = (n) => iso(new Date(Date.now() + n * 864e5));

// ---------------------------------------------------------------- lista (gestão)
async function list(el, alive, tab) {
  const title = "Escalas";
  el.innerHTML = `${head(title)}${spinner()}`;
  const from = tab === "prox" ? days(-1) : days(-120), to = tab === "prox" ? days(120) : days(-1);
  const r = await sb.rpc("roster_list", { p_org: state.org.id, p_from: from, p_to: to, p_mine: false });
  if (!alive()) return; if (r.error) return fail(el, title, r.error);
  const rows = tab === "prox" ? r.data : [...r.data].reverse();
  el.innerHTML = `${head(title, undefined, modCan("roster_manage") ? `<button class="btn primary sm" id="new">${icon("plus")} Nova escala</button>` : "")}
    <nav class="tabs"><a href="#/escalas" class="${tab === "prox" ? "on" : ""}">Próximas</a><a href="#/escalas/anteriores" class="${tab === "ant" ? "on" : ""}">Anteriores</a></nav>
    <div class="list">${rows.map((x) => `<a class="li" href="#/escalas/${x.id}"><span class="grow"><span class="t">${esc(x.title)}</span><span class="s">${fmtWhen(x.starts_at)}${x.activity ? ` · ${esc(x.activity)}` : ""} · ${x.confirmed}/${x.total} confirmados</span></span><span class="ptag ${tone(x.status)}">${ST[x.status]}</span></a>`).join("") || empty("calendar", tab === "prox" ? "Nenhuma escala por vir." : "Nenhuma escala anterior.", modCan("roster_manage") && tab === "prox" ? "Toque em Nova escala para organizar quem serve em cada atividade." : "")}</div>`;
  const nw = el.querySelector("#new"); if (nw) nw.onclick = () => rosterForm(null, (id) => (location.hash = `#/escalas/${id}`));
}

// ---------------------------------------------------------------- formulário
async function rosterForm(g, done) {
  const x = g?.roster || {};
  const people = (g?.assignments || []).map((a) => ({ id: a.person_id, name: a.name, fn: a.function || "" }));
  const progs = modAny("prog_view", "prog_manage") ? ((await sb.rpc("prog_list", { p_org: state.org.id })).data || []).filter((p) => p.status !== "cancelled") : [];
  const st = x.starts_at ? toLocalInput(x.starts_at) : `${days(7)}T19:00`;
  const s = sheet(`<h3>${g ? "Editar escala" : "Nova escala"}</h3>
    <label class="fld">Nome<input id="n" maxlength="120" value="${attr(x.title || "")}" placeholder="Ex.: Recepção do culto de domingo"></label>
    <label class="fld">Atividade (opcional)<input id="a" maxlength="80" value="${attr(x.activity || "")}" placeholder="Ex.: Recepção, Som, Infantil"></label>
    ${progs.length ? `<label class="fld">Programação (opcional)<select id="pg"><option value="">Nenhuma</option>${progs.map((p) => `<option value="${p.id}"${x.prog_id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
    <div class="row gap"><label class="fld grow">Início<input id="s" type="datetime-local" value="${st}"></label><label class="fld grow">Fim (opcional)<input id="e" type="datetime-local" value="${x.ends_at ? toLocalInput(x.ends_at) : ""}"></label></div>
    <h4 class="mt">Quem serve</h4><div id="pp"></div><button class="btn ghost sm mt" id="add">${icon("plus")} Adicionar pessoa</button>
    <div id="cf" class="mt"></div>
    <label class="fld">Observações (opcional)<textarea id="o" rows="2" maxlength="1000">${esc(x.notes || "")}</textarea></label>
    <div class="row gap mt"><button class="btn ghost grow" id="chk">Verificar horários</button><button class="btn grow" id="ok">Salvar</button></div>
    <p class="muted small mt">${g && x.status !== "draft" ? "Quem entrar será avisado; quem sair fica registrado no histórico." : "A escala fica como rascunho até você publicar; só então as pessoas são avisadas."}</p>`);
  const q = (k) => s.el.querySelector(k);
  const draw = () => { q("#pp").innerHTML = people.map((p, i) => `<div class="row gap mb"><span class="grow">${esc(p.name)}</span><input data-fn="${i}" maxlength="60" placeholder="Função" value="${attr(p.fn)}" style="width:42%" aria-label="Função de ${attr(p.name)}"><button class="iconbtn" data-rm="${i}" aria-label="Remover ${attr(p.name)}">${icon("trash")}</button></div>`).join("") || `<p class="muted small">Ninguém ainda.</p>`; };
  const grab = () => q("#pp").querySelectorAll("[data-fn]").forEach((i) => { people[Number(i.dataset.fn)].fn = i.value; });
  draw();
  q("#pp").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; grab(); people.splice(Number(b.dataset.rm), 1); draw(); };
  q("#add").onclick = () => { grab(); pickPerson("Adicionar à escala", (p) => { people.push({ id: p.id, name: p.name, fn: "" }); draw(); }, { exclude: people.map((p) => p.id) }); };
  const toIso = (v) => (v ? new Date(v).toISOString() : null);
  q("#chk").onclick = async () => {
    grab(); if (!people.length) return toast("Adicione pessoas primeiro.");
    const r = await sb.rpc("roster_check", { p_org: state.org.id, p_starts: toIso(q("#s").value), p_ends: toIso(q("#e").value), p_persons: people.map((p) => p.id), p_exclude: g?.roster?.id || null });
    q("#cf").innerHTML = r.error ? `<p class="muted small">${esc(errText(r.error))}</p>` : (conflictsHtml(r.data) || `<p class="small">Nenhum conflito de horário encontrado.</p>`);
  };
  q("#ok").onclick = async (ev) => {
    const b = ev.currentTarget; grab(); busy(b);
    try {
      const p = { title: q("#n").value, activity: q("#a").value, prog_id: q("#pg")?.value || null, starts_at: toIso(q("#s").value), ends_at: toIso(q("#e").value), notes: q("#o").value, assignments: people.map((p) => ({ person_id: p.id, function: p.fn })) };
      const r = await sb.rpc("roster_save", { p_org: state.org.id, p_id: g?.roster?.id || null, p });
      if (r.error) return toast(errText(r.error)); toast("Escala salva."); s.close(); done(r.data);
    } finally { busy(b, false); }
  };
}

// ---------------------------------------------------------------- detalhe
async function detail(el, alive, id) {
  el.innerHTML = `${head("Escala", ["#/escalas", "Escalas"])}${spinner()}`;
  const r = await sb.rpc("roster_get", { p_id: id });
  if (!alive()) return; if (r.error) return fail(el, "Escala", r.error, ["#/escalas", "Escalas"]);
  const g = r.data, x = g.roster, can = g.can, open = !["completed", "cancelled"].includes(x.status);
  const reload = () => detail(el, alive, id);
  const run = async (fn, args, ok) => { const z = await sb.rpc(fn, args); if (z.error) { toast(errText(z.error)); return null; } if (ok) toast(ok); return z.data; };
  const reason = (title, cb) => {
    const z = sheet(`<h3>${esc(title)}</h3><label class="fld">Motivo<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Confirmar</button>`);
    z.el.querySelector("#ok").onclick = async (ev) => { const b = ev.currentTarget; busy(b); try { if (await cb(z.el.querySelector("#rs").value)) { z.close(); reload(); } } finally { busy(b, false); } };
  };
  const pending = (g.subs || []).filter((s) => s.status === "pending");
  el.innerHTML = `${head(x.title, ["#/escalas", "Escalas"])}
    <div class="card"><span class="ptag ${tone(x.status)}">${ST[x.status]}</span><p class="row gap-s mt">${icon("clock")} ${fmtWhen(x.starts_at)}${x.ends_at ? ` até ${new Date(x.ends_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      ${x.activity ? `<p class="small muted">${esc(x.activity)}</p>` : ""}${x.notes ? `<p>${esc(x.notes)}</p>` : ""}${x.cancel_reason ? `<p class="small muted">Motivo do cancelamento: ${esc(x.cancel_reason)}</p>` : ""}
      ${can.manage && open ? `<div class="row gap" style="flex-wrap:wrap"><button class="btn ghost sm" id="edit">${icon("edit")} Editar</button>${x.status === "draft" ? `<button class="btn primary sm" id="pub">Publicar e avisar</button>` : `<button class="btn ghost sm" id="done">Marcar como concluída</button>`}<button class="btn ghost sm" id="can">Cancelar escala</button></div>` : ""}</div>
    ${conflictsHtml(g.conflicts)}
    ${pending.length ? `<h3 class="mt">Pedidos de substituição</h3><div class="list">${pending.map((s) => `<div class="li stack"><span class="t">${esc(s.person)} pediu para sair${s.substitute ? ` — sugere ${esc(s.substitute)}` : ""}</span><span class="s">${esc(s.reason || "Sem motivo informado")}</span>${can.approve ? `<div class="row gap"><button class="btn primary sm" data-ap="${s.id}" data-sub="${s.substitute_person_id || ""}">Aprovar</button><button class="btn ghost sm" data-rj="${s.id}">Recusar</button></div>` : ""}</div>`).join("")}</div>` : ""}
    <h3 class="mt">Quem serve (${g.assignments.length})</h3>
    <div class="list">${g.assignments.map((a) => `<div class="li"><span class="grow"><span class="t">${esc(a.name)}</span><span class="s">${esc(a.function || "Sem função definida")}${a.reason ? ` · ${esc(a.reason)}` : ""}</span></span>${x.status === "draft" ? "" : `<span class="ptag ${tone(a.status)}">${AST[a.status]}</span>`}</div>`).join("") || `<div class="li muted small">Ninguém na escala.</div>`}</div>
    ${g.history ? `<h3 class="mt">Histórico</h3><div class="list">${g.history.map((h) => `<div class="li stack"><span class="t">${esc(HIST[h.action] || h.action)}${h.detail?.name ? ` — ${esc(h.detail.name)}` : ""}</span><span class="s">${fmtWhen(h.at)}${h.by ? ` · ${esc(h.by)}` : ""}${h.reason ? ` · ${esc(h.reason)}` : ""}</span></div>`).join("")}</div>` : ""}`;
  const on = (k, fn) => { const b = el.querySelector(k); if (b) b.onclick = fn; };
  on("#edit", () => rosterForm(g, reload));
  on("#pub", async () => {
    const z = await run("roster_publish", { p_id: id, p_force: false }); if (!z) return;
    if (z.ok) { toast("Escala publicada. As pessoas foram avisadas."); return reload(); }
    const s = sheet(`<h3>Há conflitos de horário</h3>${conflictsHtml(z.conflicts)}<p class="muted small mt">Você pode ajustar a escala ou publicar mesmo assim. A decisão fica registrada.</p><button class="btn block mt" id="go">Publicar mesmo assim</button><button class="btn ghost block mt" id="no">Voltar e ajustar</button>`);
    s.el.querySelector("#no").onclick = () => s.close();
    s.el.querySelector("#go").onclick = async (ev) => { const b = ev.currentTarget; busy(b); try { if (await run("roster_publish", { p_id: id, p_force: true }, "Escala publicada.")) { s.close(); reload(); } } finally { busy(b, false); } };
  });
  on("#done", async () => { if (await run("roster_complete", { p_id: id }, "Escala concluída.") !== null) reload(); });
  on("#can", () => reason("Cancelar esta escala?", (rs) => run("roster_cancel", { p_id: id, p_reason: rs }, "Escala cancelada.").then((z) => z !== null)));
  el.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ap !== undefined) {
      const decide = async (sub, force) => {
        const z = await run("roster_sub_decide", { p_sub: b.dataset.ap, p_approve: true, p_substitute: sub || null, p_note: null, p_force: !!force }); if (!z) return;
        if (z.ok) { toast("Substituição aprovada."); return reload(); }
        const s = sheet(`<h3>Conflito com o substituto</h3>${conflictsHtml(z.conflicts)}<button class="btn block mt" id="go">Aprovar mesmo assim</button>`);
        s.el.querySelector("#go").onclick = () => { s.close(); decide(sub, true); };
      };
      if (b.dataset.sub) decide(b.dataset.sub); else pickPerson("Quem vai substituir?", (p) => decide(p.id), { exclude: g.assignments.map((a) => a.person_id) });
    }
    if (b.dataset.rj) reason("Recusar o pedido?", (rs) => run("roster_sub_decide", { p_sub: b.dataset.rj, p_approve: false, p_substitute: null, p_note: rs, p_force: false }, "Pedido recusado.").then((z) => z !== null));
  };
}
const HIST = { create: "Escala criada", edit: "Escala alterada", publish: "Publicada", confirmed: "Confirmou presença", declined: "Recusou", person_added: "Pessoa adicionada", person_removed: "Pessoa removida", sub_requested: "Pediu substituição", sub_approved: "Substituição aprovada", sub_rejected: "Substituição recusada", cancel: "Escala cancelada", complete: "Escala concluída" };

// ---------------------------------------------------------------- Minhas escalas (SOMOS Um): cada pessoa responde só pelas suas
async function mine(el, alive) {
  const title = "Minhas escalas";
  el.innerHTML = `${head(title, ["#/perfil", "Meu perfil"])}${spinner()}`;
  const r = await sb.rpc("roster_list", { p_org: state.org.id, p_from: days(-1), p_to: days(120), p_mine: true });
  if (!alive()) return; if (r.error) return fail(el, title, r.error, ["#/perfil", "Meu perfil"]);
  const answer = async (id, a, reason) => { const z = await sb.rpc("roster_respond", { p_assignment: id, p_answer: a, p_reason: reason || null }); if (z.error) return toast(errText(z.error)); toast(a === "confirm" ? "Presença confirmada." : "Resposta enviada."); mine(el, alive); };
  el.innerHTML = `${head(title, ["#/perfil", "Meu perfil"])}
    <div class="list">${r.data.map((x) => `<div class="li stack"><div class="row between"><span class="t">${esc(x.title)}</span><span class="ptag ${tone(x.my_status === "invited" ? "awaiting" : x.my_status)}">${AST[x.my_status] || ST[x.status]}</span></div>
      <span class="s">${fmtWhen(x.starts_at)}${x.my_function ? ` · ${esc(x.my_function)}` : ""}${x.status === "cancelled" ? " · escala cancelada" : ""}</span>
      ${["invited", "confirmed", "declined"].includes(x.my_status) && !["cancelled", "completed"].includes(x.status) ? `<div class="row gap" style="flex-wrap:wrap">${x.my_status !== "confirmed" ? `<button class="btn primary sm" data-c="${x.mine}">Confirmar</button>` : ""}${x.my_status !== "declined" ? `<button class="btn ghost sm" data-d="${x.mine}">Não posso</button>` : ""}${x.my_status !== "declined" ? `<button class="btn ghost sm" data-s="${x.mine}">Pedir substituição</button>` : ""}</div>` : ""}</div>`).join("") || empty("calendar", "Você não está em nenhuma escala por enquanto.")}</div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.c) answer(b.dataset.c, "confirm");
    if (b.dataset.d) { const z = sheet(`<h3>Não poderei servir</h3><label class="fld">Motivo (opcional)<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Enviar</button>`); z.el.querySelector("#ok").onclick = () => { z.close(); answer(b.dataset.d, "decline", z.el.querySelector("#rs").value); }; }
    if (b.dataset.s) {
      let sub = null; const canPick = (state.mods?.actions || []).length > 0 || cellScope();
      const z = sheet(`<h3>Pedir substituição</h3><p class="muted small">A liderança decide. Se você já tem alguém em mente, indique.</p>${canPick ? `<div class="row gap"><span class="grow" id="sn">Sem indicação</span><button class="btn ghost sm" id="sp">Indicar pessoa</button></div>` : ""}<label class="fld">Motivo<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Enviar pedido</button>`);
      const sp = z.el.querySelector("#sp"); if (sp) sp.onclick = () => pickPerson("Quem pode substituir?", (p) => { sub = p; z.el.querySelector("#sn").textContent = p.name; });
      z.el.querySelector("#ok").onclick = async (ev) => {
        const bb = ev.currentTarget; busy(bb);
        try { const x = await sb.rpc("roster_sub_request", { p_assignment: b.dataset.s, p_substitute: sub?.id || null, p_reason: z.el.querySelector("#rs").value }); if (x.error) return toast(errText(x.error)); toast("Pedido enviado."); z.close(); mine(el, alive); } finally { busy(bb, false); }
      };
    }
  };
}
