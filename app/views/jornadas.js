// Jornadas: percursos de desenvolvimento criados pela igreja (Jornada > Etapas > Atividades).
// Participante: "Minhas jornadas" (SOMOS Um). Liderança: gestão, construtor e acompanhamento (SOMOS Chamados). Tudo é conferido no servidor.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog } from "../core.js";
import { CLASS_LABEL, errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/jornadas", (p, el, a) => mine(el, a));
  route("/jornadas/:pid", (p, el, a) => participant(el, a, p.pid));
  route("/gestao-jornadas", (p, el, a) => panel(el, a));
  route("/gestao-jornadas/:id", (p, el, a) => builder(el, a, p.id));
}

const JSTATUS = { draft: "Rascunho", active: "Ativa", paused: "Pausada", archived: "Arquivada" };
const PSTATUS = { waiting: "Aguardando início", active: "Em andamento", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada" };
const KINDS = { text: "Conteúdo textual", video: "Vídeo", file: "Arquivo para download", link: "Link externo", reading: "Leitura orientada", quiz: "Questionário", task: "Tarefa individual", meeting: "Encontro presencial", event: "Evento", accompanied: "Atividade acompanhada" };
const MODES = { self: "Pelo participante", responsible: "Pelo responsável", auto: "Automática (evento realizado)", approval: "Com aprovação do responsável" };
const NOTIFY = { invite: "Convite para participar", enroll: "Inclusão na jornada", step_open: "Nova etapa disponível", assign: "Atribuição de acompanhamento", approve: "Aprovação de atividade", step_done: "Conclusão de etapa", done: "Conclusão da jornada", responsible: "Alteração de responsável" };
const CLASSES = [["member", "Membro"], ["attender", "Frequentador"], ["visitor", "Visitante"], ["none", "Sem classificação"]];
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-01-jornadas.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const br = (d) => (d ? String(d).split("-").reverse().join("/") : "");
const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
const pTag = (s) => `<span class="ptag ${s === "active" || s === "completed" ? "attender" : s === "cancelled" ? "st-rejected" : "st-pending"}">${PSTATUS[s] || s}</span>`;
const jTag = (s) => `<span class="ptag ${s === "active" ? "attender" : s === "archived" ? "none" : "st-pending"}">${JSTATUS[s] || s}</span>`;
const bar = (pct) => `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;
const head = (t, back) => `<div class="pagehead"><h1>${esc(t)}</h1></div>${back ? `<div class="mb"><a class="btn ghost sm" href="${back[0]}">${icon("chevronLeft")} ${esc(back[1])}</a></div>` : ""}`;
const fail = (el, title, e, back) => { el.innerHTML = `${head(title, back)}${missing(e) ? SETUP : empty("lock", /forbidden|not_found/.test(e?.message || "") ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(e)))}`; };

// ------------------------------------------------------------------ Minhas jornadas (participante)
async function mine(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("route", "Entre em uma igreja para ver as suas jornadas."); return; }
  el.innerHTML = spinner();
  const r = await sb.rpc("journey_mine", { p_org: org });
  if (!alive()) return;
  if (r.error) return fail(el, "Minhas jornadas", r.error);
  const m = r.data, open = m.mine.filter((x) => !["completed", "cancelled"].includes(x.status)), done = m.mine.filter((x) => ["completed", "cancelled"].includes(x.status));
  const card = (x) => `<a class="li col jr-card" href="#/jornadas/${x.id}" style="align-items:stretch"><div class="row between"><b>${esc(x.name)}</b>${pTag(x.status)}</div>
    ${x.status === "waiting" ? `<span class="small muted">Você foi convidado(a). Toque para ver e decidir se quer participar.</span>` : `${bar(x.pct)}<div class="row between small muted"><span>${x.pct}% das atividades obrigatórias</span><span>${x.step ? "Agora: " + esc(x.step) : ""}</span></div>`}</a>`;
  el.innerHTML = `${head("Minhas jornadas")}
    ${m.staff ? `<a class="btn ghost sm mb" href="#/gestao-jornadas">${icon("settings")} Gerenciar jornadas</a>` : ""}
    ${!m.has_person ? `<div class="mc-note mb">${icon("user")} Você ainda não tem ficha na igreja. Fale com a secretaria para poder participar de jornadas.</div>` : ""}
    <h3>Em andamento</h3><div class="list">${open.map(card).join("") || `<div class="li muted small">Você não tem jornadas em andamento.</div>`}</div>
    ${m.available.length ? `<h3 class="mt">Jornadas disponíveis</h3><div class="list">${m.available.map((x) => `<button class="li col" data-av="${x.id}" style="align-items:flex-start"><b>${esc(x.name)}</b><span class="small muted">${esc(x.description || x.objective || "")}</span></button>`).join("")}</div>` : ""}
    ${done.length ? `<details class="mt"><summary class="small"><b>Concluídas e encerradas (${done.length})</b></summary><div class="list mt">${done.map(card).join("")}</div></details>` : ""}
    <p class="tiny muted mt">O percentual mostra só o que você já fez nas atividades obrigatórias. Não é uma avaliação da sua fé. Você pode pausar ou sair quando quiser.</p>`;
  el.querySelectorAll("[data-av]").forEach((b) => b.addEventListener("click", async () => {
    const g = await sb.rpc("journey_public_get", { p_journey: b.dataset.av }); if (g.error) return toast(errText(g.error));
    const j = g.data;
    const s = sheet(`<h3>${esc(j.name)}</h3><p class="small">${esc(j.description || "")}</p>${j.objective ? `<p class="small muted"><b>Objetivo:</b> ${esc(j.objective)}</p>` : ""}${j.audience ? `<p class="small muted"><b>Para quem:</b> ${esc(j.audience)}</p>` : ""}
      <div class="list">${j.steps.map((st, i) => `<div class="li col" style="align-items:flex-start"><b>${i + 1}. ${esc(st.name)}</b><span class="small muted">${esc(st.description || "")}</span></div>`).join("")}</div>
      ${j.can_enroll ? `<button class="btn primary block mt" id="go">Quero participar</button>` : ""}`);
    s.el.querySelector("#go")?.addEventListener("click", async (e) => { const btn = e.currentTarget; busy(btn); try { const x = await sb.rpc("journey_self_enroll", { p_journey: j.id }); if (x.error) return toast(errText(x.error)); s.close(); location.hash = "#/jornadas/" + x.data.id; } finally { busy(btn, false); } });
  }));
}

// ------------------------------------------------------------------ uma participação (a própria pessoa ou quem acompanha)
async function participant(el, alive, pid) {
  el.innerHTML = spinner();
  const r = await sb.rpc("journey_participant_get", { p_pid: pid });
  if (!alive()) return;
  if (r.error) return fail(el, "Jornada", r.error, ["#/jornadas", "Minhas jornadas"]);
  const d = r.data, staff = d.can_manage, again = () => participant(el, alive, pid);
  const back = d.self ? ["#/jornadas", "Minhas jornadas"] : ["#/gestao-jornadas/" + d.journey.id, "Jornada"];
  const stIcon = (a) => a.state === "done" ? icon("check") : a.state === "pending" ? icon("clock") : a.state === "locked" ? icon("lock") : icon("circle");
  const actRow = (a) => `<div class="jr-act ${a.state}"><div class="row gap"><span class="jr-ic">${stIcon(a)}</span><div class="grow"><b>${esc(a.title)}</b> ${a.required ? "" : `<span class="ptag">Opcional</span>`}
      <div class="tiny muted">${KINDS[a.kind]}${a.responsible_name ? " · " + esc(a.responsible_name) : ""}${a.state === "pending" ? " · aguardando aprovação" : ""}${a.done_source === "auto" ? " · concluída automaticamente" : ""}</div></div></div>
      ${a.state !== "locked" ? `<div class="jr-body">${a.description ? `<p class="small">${esc(a.description)}</p>` : ""}${a.instructions ? `<p class="small muted">${esc(a.instructions)}</p>` : ""}${a.content_text ? `<div class="mc-note" style="white-space:pre-wrap">${esc(a.content_text)}</div>` : ""}
      ${a.content_url ? `<a class="btn ghost sm mt" href="${attr(a.content_url)}" target="_blank" rel="noopener noreferrer">${icon("link")} Abrir material</a>` : ""}
      ${a.event ? `<div class="small mt">${icon("calendar")} ${esc(a.event.title)} · ${new Date(a.event.starts_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${a.event.location ? " · " + esc(a.event.location) : ""}</div>` : ""}
      ${a.answer ? `<div class="mc-note mt"><b>Resposta:</b> ${esc(a.answer)}</div>` : ""}
      <div class="row gap-s mt" style="flex-wrap:wrap">${a.can_complete ? `<button class="btn primary sm" data-do="${a.id}" data-mode="${a.mode}" data-kind="${a.kind}">${a.mode === "approval" ? "Enviar para aprovação" : "Marcar como feito"}</button>` : ""}
      ${a.can_approve ? `<button class="btn primary sm" data-ap="${a.id}">Aprovar</button><button class="btn ghost sm" data-rj="${a.id}">Pedir para refazer</button>` : ""}${a.can_reopen ? `<button class="btn ghost sm" data-ro="${a.id}">Desfazer</button>` : ""}</div></div>` : `<div class="tiny muted jr-body">Disponível quando a etapa anterior for concluída.</div>`}</div>`;
  el.innerHTML = `${head(d.journey.name, back)}
    <section class="card"><div class="row between"><div>${d.self ? "" : `<b>${esc(d.person.name)}</b><div class="small muted">Participante</div>`}${pTag(d.status)}</div>${!d.self && d.person.can_open ? `<a class="btn ghost sm" href="#/pessoas/${d.person.id}">Abrir ficha</a>` : ""}</div>
      ${d.journey.objective ? `<p class="small mt"><b>Objetivo:</b> ${esc(d.journey.objective)}</p>` : d.journey.description ? `<p class="small mt">${esc(d.journey.description)}</p>` : ""}
      ${d.status === "waiting" ? "" : `<div class="mt">${bar(d.pct)}<div class="row between small muted"><span><b>${d.pct}%</b> das atividades obrigatórias</span><span>${d.started_on ? "Início: " + br(d.started_on) : ""}</span></div><div class="small muted">${d.pending_total ? `${d.pending_total} ${d.pending_total === 1 ? "atividade obrigatória pendente" : "atividades obrigatórias pendentes"}` : "Nenhuma obrigatória pendente"}${d.responsible_name ? ` · Acompanhamento: ${esc(d.responsible_name)}` : ""}</div></div>`}
      ${d.self && d.status === "waiting" ? `<div class="row gap mt"><button class="btn primary grow" id="acc">Quero participar</button><button class="btn ghost grow" id="dec">Agora não</button></div><p class="tiny muted">Recusar não altera o seu cadastro.</p>` : ""}
      ${d.journey.status !== "active" ? `<div class="mc-note mt">${icon("clock")} Esta jornada está ${JSTATUS[d.journey.status].toLowerCase()}.</div>` : ""}</section>
    ${d.steps.map((s) => `<h3 class="mt">${s.complete && s.req_total ? icon("check") + " " : s.unlocked ? "" : icon("lock") + " "}${s.position}. ${esc(s.name)} ${s.current && d.status === "active" ? `<span class="ptag member">Etapa atual</span>` : ""}</h3>
      ${s.description ? `<p class="small muted">${esc(s.description)}</p>` : ""}<div class="list jr-list">${s.activities.map(actRow).join("") || `<div class="li muted small">Sem atividades.</div>`}</div>
      ${s.can_confirm ? `<button class="btn ghost sm mt" data-conf="${s.id}">Confirmar conclusão da etapa</button>` : ""}`).join("")}
    <div class="row gap-s mt" style="flex-wrap:wrap">${d.status === "active" && (d.self || staff) ? `<button class="btn ghost sm" data-st="pause">Pausar</button>` : ""}${d.status === "paused" && (d.self || staff) ? `<button class="btn primary sm" data-st="resume">Retomar</button>` : ""}
      ${staff && d.status === "waiting" ? `<button class="btn primary sm" data-st="start">Iniciar</button>` : ""}${staff && ["active", "paused"].includes(d.status) ? `<button class="btn ghost sm" data-st="complete">Concluir jornada</button>` : ""}
      ${["waiting", "active", "paused"].includes(d.status) && (d.self || staff) ? `<button class="btn ghost sm" data-st="cancel">${d.self ? "Sair da jornada" : "Cancelar participação"}</button>` : ""}${d.can_force && ["completed", "cancelled"].includes(d.status) ? `<button class="btn ghost sm" data-st="reopen">Reabrir</button>` : ""}
      ${d.can_assign ? `<button class="btn ghost sm" id="assign">${d.responsible_id ? "Trocar responsável" : "Definir responsável"}</button>` : ""}</div>
    ${d.self ? `<label class="mc-radio mt"><input type="checkbox" id="ntf" ${d.notify ? "checked" : ""}> Receber avisos desta jornada</label>` : ""}
    ${d.level ? `<div class="row between mt"><h3>Observações administrativas</h3><button class="btn ghost sm" id="note">${icon("plus")} Adicionar</button></div><div class="list">${d.notes.map((n) => `<div class="li col" style="align-items:flex-start"><span class="small">${esc(n.text)}</span><span class="tiny muted">${esc(n.by)} · ${new Date(n.at).toLocaleDateString("pt-BR")}</span></div>`).join("") || `<div class="li muted small">Nenhuma observação.</div>`}</div>
      <details class="card mt"><summary class="small"><b>Histórico da participação</b></summary><div class="mt">${d.log.map((l) => `<div class="small" style="padding:3px 0">${new Date(l.at).toLocaleString("pt-BR")} · ${esc(logLabel(l))} · <span class="muted">${esc(l.by)}</span></div>`).join("")}</div></details>` : ""}`;
  const call = async (b, fn, args, ok) => { busy(b); try { const x = await sb.rpc(fn, args); if (x.error) return toast(errText(x.error)); if (ok) toast(ok); again(); } finally { busy(b, false); } };
  el.querySelector("#acc")?.addEventListener("click", (e) => call(e.currentTarget, "journey_respond", { p_pid: pid, p_accept: true }, "Que bom! Sua jornada começou"));
  el.querySelector("#dec")?.addEventListener("click", async (e) => { if (await confirmDialog("Recusar o convite? Seu cadastro não muda.", "Agora não")) { await sb.rpc("journey_respond", { p_pid: pid, p_accept: false }); location.hash = "#/jornadas"; } });
  el.querySelectorAll("[data-do]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode === "approval" || b.dataset.kind === "quiz" || b.dataset.kind === "task") {
      const s = sheet(`<h3>Registrar atividade</h3><label class="field"><span>Sua resposta ou observação ${b.dataset.mode === "approval" ? "" : "(opcional)"}</span><textarea id="tx" rows="4" maxlength="2000"></textarea></label><button class="btn primary block" id="ok">${b.dataset.mode === "approval" ? "Enviar para aprovação" : "Marcar como feito"}</button>`);
      s.el.querySelector("#ok").onclick = async (e) => { const btn = e.currentTarget; busy(btn); try { const x = await sb.rpc("journey_record", { p_pid: pid, p_activity: b.dataset.do, p_action: "complete", p_text: s.el.querySelector("#tx").value || null }); if (x.error) return toast(errText(x.error)); s.close(); toast(b.dataset.mode === "approval" ? "Enviado para aprovação" : "Atividade registrada"); again(); } finally { busy(btn, false); } };
    } else call(b, "journey_record", { p_pid: pid, p_activity: b.dataset.do, p_action: "complete", p_text: null }, "Atividade registrada");
  }));
  el.querySelectorAll("[data-ap]").forEach((b) => b.addEventListener("click", () => call(b, "journey_record", { p_pid: pid, p_activity: b.dataset.ap, p_action: "approve", p_text: null }, "Atividade aprovada")));
  el.querySelectorAll("[data-rj]").forEach((b) => b.addEventListener("click", () => call(b, "journey_record", { p_pid: pid, p_activity: b.dataset.rj, p_action: "reject", p_text: null }, "Devolvida para refazer")));
  el.querySelectorAll("[data-ro]").forEach((b) => b.addEventListener("click", () => call(b, "journey_record", { p_pid: pid, p_activity: b.dataset.ro, p_action: "reopen", p_text: null }, "Atividade reaberta")));
  el.querySelectorAll("[data-conf]").forEach((b) => b.addEventListener("click", () => call(b, "journey_step_confirm", { p_pid: pid, p_step: b.dataset.conf }, "Etapa confirmada")));
  el.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.st;
    if (a === "cancel" && !(await confirmDialog(d.self ? "Sair desta jornada? O que você já fez fica registrado." : "Cancelar esta participação?", "Confirmar", true))) return;
    if (a === "complete") { busy(b); const x = await sb.rpc("journey_participant_status", { p_pid: pid, p_action: a, p_force: false }); busy(b, false); if (x.error) { if (/required_pending/.test(x.error.message) && d.can_force && await confirmDialog("Ainda há atividades obrigatórias pendentes. Concluir mesmo assim?", "Concluir mesmo assim")) return call(b, "journey_participant_status", { p_pid: pid, p_action: a, p_force: true }, "Jornada concluída"); return toast(errText(x.error)); } toast("Jornada concluída"); return again(); }
    call(b, "journey_participant_status", { p_pid: pid, p_action: a, p_force: false }, "Situação atualizada");
  }));
  el.querySelector("#ntf")?.addEventListener("change", (e) => sb.rpc("journey_notify_pref", { p_pid: pid, p_on: e.target.checked }).then((x) => toast(x.error ? errText(x.error) : e.target.checked ? "Avisos ativados" : "Avisos silenciados")));
  el.querySelector("#note")?.addEventListener("click", () => {
    const s = sheet(`<h3>Observação administrativa</h3><p class="small muted">Registre só o necessário. Anotações pastorais ficam na aba Pastoral da ficha.</p><label class="field"><textarea id="tx" rows="3" maxlength="500"></textarea></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const btn = e.currentTarget; busy(btn); try { const x = await sb.rpc("journey_note_add", { p_pid: pid, p_text: s.el.querySelector("#tx").value }); if (x.error) return toast(errText(x.error)); s.close(); again(); } finally { busy(btn, false); } };
  });
  el.querySelector("#assign")?.addEventListener("click", async () => {
    const rr = await sb.rpc("journey_responsibles", { p_org: state.org.id });
    const s = sheet(`<h3>Responsável pelo acompanhamento</h3><label class="field"><select id="u"><option value="">Sem responsável</option>${(rr.data || []).map((u) => `<option value="${u.user_id}" ${u.user_id === d.responsible_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label><button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const btn = e.currentTarget; busy(btn); try { const x = await sb.rpc("journey_assign", { p_pid: pid, p_user: s.el.querySelector("#u").value || null }); if (x.error) return toast(errText(x.error)); s.close(); toast("Responsável salvo"); again(); } finally { busy(btn, false); } };
  });
}
const LOGS = { enroll: "Entrou na jornada", accept: "Aceitou o convite", decline: "Recusou o convite", offer: "Convite enviado", status: "Situação alterada", assign: "Responsável alterado", step_done: "Etapa concluída", step_open: "Etapa liberada", step_reopen: "Etapa reaberta", step_confirm: "Etapa confirmada", activity_done: "Atividade registrada", activity_reopen: "Atividade reaberta", approve: "Atividade aprovada", reject: "Atividade devolvida", complete: "Jornada concluída" };
const logLabel = (l) => (LOGS[l.action] || l.action) + (l.detail?.name ? `: ${l.detail.name}` : l.detail?.activity ? `: ${l.detail.activity}` : l.action === "status" ? `: ${PSTATUS[l.detail?.from] || ""} → ${PSTATUS[l.detail?.to] || ""}` : "");

// ------------------------------------------------------------------ painel de gestão (SOMOS Chamados)
async function panel(el, alive) {
  const org = state.org?.id;
  if (!org) { el.innerHTML = empty("route", "Entre em uma igreja."); return; }
  el.innerHTML = spinner();
  const [r, ind] = await Promise.all([sb.rpc("journey_list", { p_org: org, p: {} }), sb.rpc("journey_indicators", { p_org: org, p_journey: null, p_from: null, p_to: null })]);
  if (!alive()) return;
  if (r.error) return fail(el, "Jornadas", r.error, ["#/chamados", "Chamados"]);
  const L = r.data, I = ind.error ? null : ind.data, by = (s) => (I?.by_status.find((x) => x.status === s)?.n || 0);
  el.innerHTML = `${head("Jornadas", ["#/chamados", "Chamados"])}
    ${L.can_admin ? `<button class="btn primary sm mb" id="new">${icon("plus")} Nova jornada</button>` : ""}
    ${I ? `<div class="mc-tiles"><div class="mc-tile"><b>${I.participants}</b><span>participações</span></div><div class="mc-tile"><b>${by("active")}</b><span>em andamento</span></div><div class="mc-tile"><b>${by("paused")}</b><span>pausadas</span></div><div class="mc-tile"><b>${by("completed")}</b><span>concluídas</span></div></div>
      <p class="tiny muted">${I.pending_approvals ? `${I.pending_approvals} ${I.pending_approvals === 1 ? "atividade aguarda" : "atividades aguardam"} aprovação. ` : ""}Números de participação, nunca de maturidade espiritual.</p>` : ""}
    <div class="list mt">${L.items.map((j) => `<a class="li col" href="#/gestao-jornadas/${j.id}" style="align-items:stretch"><div class="row between"><b>${esc(j.name)}</b>${jTag(j.status)}</div><span class="small muted">${j.steps} ${j.steps === 1 ? "etapa" : "etapas"} · ${j.participants} ${j.participants === 1 ? "participante" : "participantes"} · ${j.completed} concluídas${j.visibility === "private" ? " · privada" : ""}${j.for_converts ? " · para novos convertidos" : ""}</span></a>`).join("") || empty("route", "Nenhuma jornada criada ainda.", L.can_admin ? `<span class="small muted">Crie as jornadas da sua igreja. Nada vem pronto.</span>` : "")}</div>`;
  el.querySelector("#new")?.addEventListener("click", () => {
    const s = sheet(`<h3>Nova jornada</h3><label class="field"><span>Nome *</span><input id="nm" maxlength="120" placeholder="Ex.: Discipulado"></label><label class="field"><span>Descrição</span><textarea id="ds" rows="2" maxlength="1000"></textarea></label><button class="btn primary block" id="ok">Criar jornada</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const btn = e.currentTarget, nm = s.el.querySelector("#nm").value.trim(); if (!nm) return toast("Dê um nome à jornada."); busy(btn); try { const x = await sb.rpc("journey_save", { p_org: org, p_id: null, p: { name: nm, description: s.el.querySelector("#ds").value }, p_version: null }); if (x.error) return toast(errText(x.error)); s.close(); location.hash = "#/gestao-jornadas/" + x.data.id; } finally { busy(btn, false); } };
  });
}

// ------------------------------------------------------------------ construtor e acompanhamento de uma jornada
let tab = { id: null, k: "estrutura" };
async function builder(el, alive, id) {
  el.innerHTML = spinner();
  const r = await sb.rpc("journey_get", { p_id: id });
  if (!alive()) return;
  if (r.error) return fail(el, "Jornada", r.error, ["#/gestao-jornadas", "Jornadas"]);
  const g = r.data; if (tab.id !== id) tab = { id, k: "estrutura" };
  const edit = g.can_edit, again = () => builder(el, alive, id);
  const act = async (b, fn, args, ok) => { busy(b); try { const x = await sb.rpc(fn, args); if (x.error) { toast(/version_conflict/.test(x.error.message) ? "Outra pessoa alterou esta jornada. Atualizando…" : errText(x.error)); if (/version_conflict/.test(x.error.message)) again(); return null; } if (ok) toast(ok); return x.data; } finally { busy(b, false); } };
  const tabs = [["estrutura", "Estrutura"], ["participantes", "Participantes"], ["ajustes", "Ajustes"]];
  el.innerHTML = `${head(g.name, ["#/gestao-jornadas", "Jornadas"])}
    <div class="row between mb"><span>${jTag(g.status)} <span class="small muted">${g.visibility === "public" ? "Pública" : "Privada"} · ${{ sequential: "etapas em sequência", free: "etapas livres", conditional: "etapas condicionadas" }[g.step_mode]}</span></span><button class="btn ghost sm" id="prev">Prévia</button></div>
    ${g.can_admin ? `<div class="row gap-s mb" style="flex-wrap:wrap">${g.status !== "active" && g.status !== "archived" ? `<button class="btn primary sm" data-js="active">${g.status === "paused" ? "Reativar" : "Ativar"}</button>` : ""}${g.status === "active" ? `<button class="btn ghost sm" data-js="paused">Pausar</button>` : ""}${g.status === "archived" ? `<button class="btn ghost sm" data-js="paused">Restaurar</button>` : `<button class="btn ghost sm" data-js="archived">Arquivar</button>`}<button class="btn ghost sm" id="dup">Duplicar</button></div>` : ""}
    <div class="tabs mb" id="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === tab.k ? "on" : ""}">${l}</button>`).join("")}</div><div id="pane"></div>`;
  const pane = el.querySelector("#pane");
  const paintEst = () => {
    pane.innerHTML = `${edit ? `<button class="btn primary sm mb" id="addstep">${icon("plus")} Nova etapa</button>` : ""}${g.steps.map((s, i) => `<section class="card jr-step mb"><div class="row between"><b>${i + 1}. ${esc(s.name)}</b>${edit ? `<span class="row gap-s"><button class="btn ghost sm" data-mv="step:${s.id}:-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button><button class="btn ghost sm" data-mv="step:${s.id}:1" ${i === g.steps.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button><button class="btn ghost sm" data-es="${s.id}">Editar</button></span>` : ""}</div>
      ${s.description ? `<p class="small muted">${esc(s.description)}</p>` : ""}<div class="tiny muted">${s.responsible_name ? "Responsável: " + esc(s.responsible_name) + " · " : ""}${s.completion_rule === "manual" ? "conclusão confirmada pelo responsável" : "conclui com as obrigatórias"}</div>
      <div class="list mt">${s.activities.map((a, k) => `<div class="li"><div class="grow"><b class="small">${esc(a.title)}</b> ${a.required ? "" : `<span class="ptag">Opcional</span>`}<div class="tiny muted">${KINDS[a.kind]} · ${MODES[a.completion_mode]}</div></div>${edit ? `<span class="row gap-s"><button class="btn ghost sm" data-mv="act:${s.id}:${a.id}:-1" ${k === 0 ? "disabled" : ""} aria-label="Subir">↑</button><button class="btn ghost sm" data-mv="act:${s.id}:${a.id}:1" ${k === s.activities.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button><button class="btn ghost sm" data-ea="${s.id}:${a.id}">Editar</button></span>` : ""}</div>`).join("") || `<div class="li muted small">Sem atividades.</div>`}</div>
      ${edit ? `<button class="btn ghost sm mt" data-aa="${s.id}">${icon("plus")} Atividade</button>` : ""}</section>`).join("") || empty("route", "Adicione a primeira etapa.")}`;
  };
  const stepForm = (s) => {
    const prev = g.steps.filter((x) => !s || x.position < s.position);
    const sh = sheet(`<h3>${s ? "Editar etapa" : "Nova etapa"}</h3><form id="f" novalidate><label class="field"><span>Nome *</span><input name="name" maxlength="120" value="${attr(s?.name || "")}"></label><label class="field"><span>Descrição</span><textarea name="description" rows="2" maxlength="500">${esc(s?.description || "")}</textarea></label>
      <label class="field"><span>Responsável pela etapa</span><select name="responsible_id"><option value="">Nenhum</option>${(window.__jrResp || []).map((u) => `<option value="${u.user_id}" ${s?.responsible_id === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Regra de conclusão</span><select name="completion_rule"><option value="all_required" ${s?.completion_rule !== "manual" ? "selected" : ""}>Conclui quando as obrigatórias forem feitas</option><option value="manual" ${s?.completion_rule === "manual" ? "selected" : ""}>Também exige confirmação do responsável</option></select></label>
      ${g.step_mode === "conditional" && s ? `<div class="field"><span>Só libera depois de concluir</span>${prev.filter((x) => x.id !== s.id).map((x) => `<label class="mc-radio"><input type="checkbox" name="req" value="${x.id}" ${s.requires.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("") || `<span class="tiny muted">Não há etapas anteriores.</span>`}</div>` : ""}
      <button class="btn primary block mt" id="ok">Salvar</button>${s ? `<button type="button" class="btn ghost block mt" id="del">Excluir etapa vazia</button>` : ""}</form>`);
    const f = sh.el.querySelector("#f");
    f.onsubmit = async (e) => { e.preventDefault(); const p = { name: f.name.value, description: f.description.value, responsible_id: f.responsible_id.value || null, completion_rule: f.completion_rule.value }; if (g.step_mode === "conditional" && s) p.requires = [...f.querySelectorAll("[name=req]:checked")].map((c) => c.value); const x = await act(sh.el.querySelector("#ok"), "journey_step_save", { p_journey: id, p_id: s?.id || null, p, p_version: null }, "Etapa salva"); if (x) { sh.close(); again(); } };
    f.querySelector("#del")?.addEventListener("click", async (e) => { if (!(await confirmDialog("Excluir esta etapa? Só funciona se ela não tiver atividades.", "Excluir", true))) return; const x = await act(e.currentTarget, "journey_step_remove", { p_id: s.id, p_version: null }, "Etapa excluída"); if (x) { sh.close(); again(); } });
  };
  const actForm = (s, a) => {
    const sh = sheet(`<h3>${a ? "Editar atividade" : "Nova atividade"}</h3><form id="f" novalidate><label class="field"><span>Título *</span><input name="title" maxlength="160" value="${attr(a?.title || "")}"></label>
      <label class="field"><span>Tipo</span><select name="kind">${opt(Object.entries(KINDS), a?.kind || "text")}</select></label><label class="field"><span>Descrição</span><textarea name="description" rows="2" maxlength="1000">${esc(a?.description || "")}</textarea></label>
      <label class="field"><span>Instruções</span><textarea name="instructions" rows="2" maxlength="1000">${esc(a?.instructions || "")}</textarea></label><label class="field"><span>Conteúdo em texto</span><textarea name="content_text" rows="3" maxlength="4000">${esc(a?.content_text || "")}</textarea></label>
      <label class="field"><span>Link do material (https)</span><input name="content_url" type="url" maxlength="600" value="${attr(a?.content_url || "")}"></label>
      <label class="field"><span>Evento da agenda da igreja</span><select name="event_id"><option value="">Nenhum</option>${(window.__jrEvents || []).map((e) => `<option value="${e.id}" ${a?.event_id === e.id ? "selected" : ""}>${esc(e.title)} · ${new Date(e.starts_at).toLocaleDateString("pt-BR")}</option>`).join("")}</select></label>
      <label class="field"><span>Quem conclui</span><select name="completion_mode">${opt(Object.entries(MODES), a?.completion_mode || "self")}</select></label>
      <label class="field"><span>Responsável</span><select name="responsible_id"><option value="">Nenhum</option>${(window.__jrResp || []).map((u) => `<option value="${u.user_id}" ${a?.responsible_id === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="mc-radio"><input type="checkbox" name="required" ${a?.required === false ? "" : "checked"}> Atividade obrigatória</label>
      <button class="btn primary block mt" id="ok">Salvar</button>${a ? `<button type="button" class="btn ghost block mt" id="del">Remover atividade</button>` : ""}</form>`, { wide: true });
    const f = sh.el.querySelector("#f");
    f.onsubmit = async (e) => { e.preventDefault(); const p = { title: f.title.value, kind: f.kind.value, description: f.description.value, instructions: f.instructions.value, content_text: f.content_text.value, content_url: f.content_url.value, event_id: f.event_id.value || null, completion_mode: f.completion_mode.value, responsible_id: f.responsible_id.value || null, required: f.required.checked }; const x = await act(sh.el.querySelector("#ok"), "journey_activity_save", { p_step: s, p_id: a?.id || null, p, p_version: null }, "Atividade salva"); if (x) { sh.close(); again(); } };
    f.querySelector("#del")?.addEventListener("click", async (e) => { if (!(await confirmDialog("Remover a atividade? Quem já a fez mantém o registro.", "Remover", true))) return; const x = await act(e.currentTarget, "journey_activity_remove", { p_id: a.id, p_version: null }, "Atividade removida"); if (x) { sh.close(); again(); } });
  };
  const paintPart = async () => {
    pane.innerHTML = spinner();
    const f = paintPart.f || (paintPart.f = { q: "", status: "" });
    const x = await sb.rpc("journey_participants_list", { p_journey: id, p: { q: f.q || undefined, status: f.status || undefined } });
    if (x.error) { pane.innerHTML = empty("lock", errText(x.error)); return; }
    pane.innerHTML = `${g.can_participants && g.status === "active" ? `<button class="btn primary sm mb" id="inc">${icon("plus")} Incluir pessoa</button>` : ""}
      <label class="psearch">${icon("search")}<input id="pq" type="search" placeholder="Buscar participante" value="${attr(f.q)}"></label>
      <div class="mc-chips mb">${[["", "Todos"], ...Object.entries(PSTATUS)].map(([k, l]) => `<button class="chip ${f.status === k ? "on" : ""}" data-fs="${k}">${l}</button>`).join("")}</div>
      <div class="list">${x.data.items.map((p) => `<a class="li col" href="#/jornadas/${p.id}" style="align-items:stretch"><div class="row between"><span class="row gap">${avatar({ display_name: p.name, avatar_url: p.photo_url }, 36, false)}<b>${esc(p.name)}</b></span>${pTag(p.status)}</div>${["active", "paused", "completed"].includes(p.status) ? bar(p.pct) : ""}<span class="tiny muted">${p.pct}% · ${p.step ? "Etapa: " + esc(p.step) + " · " : ""}${p.responsible_name ? "Acompanha: " + esc(p.responsible_name) + " · " : ""}${p.started_on ? "início " + br(p.started_on) : ""}${p.pending_approvals ? ` · ${p.pending_approvals} aguardando aprovação` : ""}</span></a>`).join("") || empty("users", "Nenhum participante com esses filtros.")}</div>`;
    let t; pane.querySelector("#pq").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); paintPart(); }, 300); });
    pane.querySelectorAll("[data-fs]").forEach((b) => b.addEventListener("click", () => { f.status = b.dataset.fs; paintPart(); }));
    pane.querySelector("#inc")?.addEventListener("click", () => {
      const sh = sheet(`<h3>Incluir pessoa</h3><p class="small muted">Escolha alguém que já tem ficha. Nenhum cadastro ou conta é criado e a classificação não muda.</p><label class="psearch">${icon("search")}<input id="iq" type="search" placeholder="Buscar pelo nome" autocomplete="off"></label><div id="ir"></div>`);
      let tt; sh.el.querySelector("#iq").addEventListener("input", (e) => { clearTimeout(tt); tt = setTimeout(async () => {
        const q = e.target.value.trim(); if (q.length < 2) { sh.el.querySelector("#ir").innerHTML = ""; return; }
        const rr = await sb.rpc("journey_people_search", { p_org: g.org_id, p_q: q });
        sh.el.querySelector("#ir").innerHTML = (rr.data || []).map((p) => `<button class="li" data-p="${p.id}">${avatar({ display_name: p.full_name, avatar_url: p.photo_url }, 36, false)}<span class="grow"><span class="t">${esc(p.full_name)}</span><span class="s">${esc(CLASS_LABEL[p.classification] || "")}</span></span></button>`).join("") || `<div class="li muted small">Ninguém encontrado.</div>`;
      }, 250); });
      sh.el.addEventListener("click", async (e) => { const b = e.target.closest("[data-p]"); if (!b) return; const x2 = await act(b, "journey_enroll", { p_journey: id, p_person: b.dataset.p, p_responsible: g.owner_id || null, p_start: true }, "Pessoa incluída"); if (x2) { sh.close(); paintPart(); } });
    });
  };
  const paintSet = () => {
    pane.innerHTML = `<form id="f" class="card" novalidate><fieldset ${edit ? "" : "disabled"} style="border:0;padding:0;margin:0"><label class="field"><span>Nome *</span><input name="name" maxlength="120" value="${attr(g.name)}"></label>
      <label class="field"><span>Descrição</span><textarea name="description" rows="2" maxlength="1000">${esc(g.description || "")}</textarea></label><label class="field"><span>Objetivo</span><input name="objective" maxlength="500" value="${attr(g.objective || "")}"></label><label class="field"><span>Público-alvo</span><input name="audience" maxlength="300" value="${attr(g.audience || "")}"></label>
      <label class="field"><span>Imagem (link https, opcional)</span><input name="image_url" type="url" maxlength="600" value="${attr(g.image_url || "")}"></label>
      <label class="field"><span>Responsável geral</span><select name="owner_id"><option value="">Nenhum</option>${(window.__jrResp || []).map((u) => `<option value="${u.user_id}" ${g.owner_id === u.user_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Equipe responsável (só identificação)</span><select name="team_id"><option value="">Nenhuma</option>${(state.orgTeams || []).map((t) => `<option value="${t.id}" ${g.team_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Visibilidade</span><select name="visibility"><option value="private" ${g.visibility === "private" ? "selected" : ""}>Privada: só participantes e quem acompanha</option><option value="public" ${g.visibility === "public" ? "selected" : ""}>Pública: aparece para pessoas elegíveis</option></select></label>
      <label class="field"><span>Sequência das etapas</span><select name="step_mode"><option value="sequential" ${g.step_mode === "sequential" ? "selected" : ""}>Em sequência</option><option value="free" ${g.step_mode === "free" ? "selected" : ""}>Livres</option><option value="conditional" ${g.step_mode === "conditional" ? "selected" : ""}>Condicionadas por etapa</option></select></label>
      <label class="mc-radio"><input type="checkbox" name="enroll_voluntary" ${g.enroll_voluntary ? "checked" : ""}> Permitir inscrição voluntária (jornada pública)</label>
      <div class="field mt"><span>Elegíveis (vazio = qualquer pessoa)</span>${CLASSES.map(([k, l]) => `<label class="mc-radio"><input type="checkbox" name="cls" value="${k}" ${(g.eligible_classes || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <label class="mc-radio"><input type="checkbox" name="auto_finish" ${g.auto_finish ? "checked" : ""}> Concluir automaticamente quando as obrigatórias forem feitas</label>
      <label class="mc-radio"><input type="checkbox" name="for_converts" ${g.for_converts ? "checked" : ""}> Pode ser oferecida a novos convertidos</label>
      <div class="field mt"><span>Convidar por critério (cria só convites; a pessoa decide)</span>${CLASSES.map(([k, l]) => `<label class="mc-radio"><input type="checkbox" name="rule" value="${k}" ${(g.auto_rule?.classes || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <div class="field mt"><span>Avisos (sem lembretes automáticos)</span>${Object.entries(NOTIFY).map(([k, l]) => `<label class="mc-radio"><input type="checkbox" name="nt" value="${k}" ${g.notify?.[k] ? "checked" : ""}> ${l}</label>`).join("")}</div></fieldset>
      ${edit ? `<button class="btn primary block mt" id="ok">Salvar ajustes</button>${g.status === "active" && g.auto_rule ? `<button type="button" class="btn ghost block mt" id="rule">Convidar pessoas pelo critério agora</button>` : ""}` : ""}</form>
      ${g.log.length ? `<details class="card mt"><summary class="small"><b>Histórico da jornada</b></summary><div class="mt">${g.log.map((l) => `<div class="small" style="padding:3px 0">${new Date(l.at).toLocaleString("pt-BR")} · ${esc(l.action)} · <span class="muted">${esc(l.by)}</span></div>`).join("")}</div></details>` : ""}`;
    const f = pane.querySelector("#f");
    f.onsubmit = async (e) => {
      e.preventDefault(); const rule = [...f.querySelectorAll("[name=rule]:checked")].map((c) => c.value); const nt = {}; Object.keys(NOTIFY).forEach((k) => (nt[k] = !!f.querySelector(`[name=nt][value=${k}]`)?.checked));
      const p = { name: f.name.value, description: f.description.value, objective: f.objective.value, audience: f.audience.value, image_url: f.image_url.value, owner_id: f.owner_id.value || null, team_id: f.team_id.value || null, visibility: f.visibility.value, step_mode: f.step_mode.value,
        enroll_voluntary: f.enroll_voluntary.checked, eligible_classes: [...f.querySelectorAll("[name=cls]:checked")].map((c) => c.value), auto_finish: f.auto_finish.checked, for_converts: f.for_converts.checked, auto_rule: rule.length ? { classes: rule } : null, notify: nt };
      const x = await act(pane.querySelector("#ok"), "journey_save", { p_org: g.org_id, p_id: id, p, p_version: g.version }, "Ajustes salvos"); if (x) again();
    };
    pane.querySelector("#rule")?.addEventListener("click", async (e) => { if (!(await confirmDialog("Enviar convites às pessoas que se encaixam no critério? Elas decidem se aceitam.", "Convidar"))) return; const x = await act(e.currentTarget, "journey_apply_rule", { p_journey: id }); if (x) toast(`${x.invited} ${x.invited === 1 ? "convite enviado" : "convites enviados"}`); });
  };
  const show = () => { el.querySelectorAll("#tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab.k)); tab.k === "estrutura" ? paintEst() : tab.k === "participantes" ? paintPart() : paintSet(); };
  const [rs, evs] = await Promise.all([sb.rpc("journey_responsibles", { p_org: g.org_id }), sb.from("church_events").select("id,title,starts_at").eq("org_id", g.org_id).order("starts_at", { ascending: false }).limit(60)]);
  window.__jrResp = rs.data || []; window.__jrEvents = evs.data || [];
  if (!alive()) return;
  show();
  el.querySelector("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab.k = b.dataset.tab; show(); } });
  el.onclick = async (e) => {
    const t = e.target.closest("[data-mv],[data-es],[data-ea],[data-aa],#addstep,[data-js],#dup,#prev"); if (!t) return;
    if (t.id === "addstep") return stepForm(null);
    if (t.dataset.es) return stepForm(g.steps.find((s) => s.id === t.dataset.es));
    if (t.dataset.aa) return actForm(t.dataset.aa, null);
    if (t.dataset.ea) { const [sid, aid] = t.dataset.ea.split(":"); return actForm(sid, g.steps.find((s) => s.id === sid).activities.find((a) => a.id === aid)); }
    if (t.dataset.mv) {
      const p = t.dataset.mv.split(":");
      if (p[0] === "step") { const ids = g.steps.map((s) => s.id), i = ids.indexOf(p[1]), j = i + Number(p[2]); [ids[i], ids[j]] = [ids[j], ids[i]]; const x = await act(t, "journey_reorder", { p_kind: "step", p_parent: id, p_ids: ids, p_version: null }); if (x) again(); }
      else { const st = g.steps.find((s) => s.id === p[1]), ids = st.activities.map((a) => a.id), i = ids.indexOf(p[2]), j = i + Number(p[3]); [ids[i], ids[j]] = [ids[j], ids[i]]; const x = await act(t, "journey_reorder", { p_kind: "activity", p_parent: st.id, p_ids: ids, p_version: null }); if (x) again(); }
      return;
    }
    if (t.dataset.js) { if (t.dataset.js === "archived" && !(await confirmDialog("Arquivar a jornada? Participantes e histórico são preservados, mas ninguém novo entra.", "Arquivar", true))) return; const x = await act(t, "journey_set_status", { p_id: id, p_status: t.dataset.js, p_version: null }, "Situação atualizada"); if (x) again(); return; }
    if (t.id === "dup") { const x = await act(t, "journey_duplicate", { p_id: id }, "Jornada duplicada"); if (x) location.hash = "#/gestao-jornadas/" + x.id; return; }
    if (t.id === "prev") {
      const sh = sheet(`<h3>Prévia: ${esc(g.name)}</h3><p class="tiny muted">Como a pessoa verá a jornada.</p>${g.steps.map((s, i) => `<h4 class="mt">${i + 1}. ${esc(s.name)} ${g.step_mode === "sequential" && i > 0 ? icon("lock") : ""}</h4><div class="list">${s.activities.map((a) => `<div class="li col" style="align-items:flex-start"><b class="small">${esc(a.title)}</b><span class="tiny muted">${KINDS[a.kind]} · ${a.required ? "obrigatória" : "opcional"}</span></div>`).join("") || `<div class="li muted small">Sem atividades.</div>`}</div>`).join("")}`, { wide: true });
      void sh;
    }
  };
}
