// Eventos com inscrição: o participante vê os eventos, se inscreve e guarda o ingresso (QR); a equipe cadastra, publica e faz o check-in.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, modCan, pickFile, uploadPublic } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen, toLocalInput } from "../lib/mod-ui.js";
import { qrSvg } from "../lib/qr.js";

export function register(route) {
  route("/eventos", (p, el, a) => list(el, a));
  route("/meus-ingressos", (p, el, a) => tickets(el, a));
  route("/gestao-eventos", (p, el, a) => manage(el, a));
  route("/gestao-eventos/:id", (p, el, a) => detail(el, a, p.id));
}

const EVT_ACTIONS = ["ev_view", "ev_manage", "ev_publish", "ev_checkin"];
const AUD = { all: "Todos", visitor: "Visitantes", attender: "Frequentadores", member: "Membros" };
const STATUS = { draft: ["Rascunho", "st-pending"], published: ["Publicado", "attender"], cancelled: ["Cancelado", "st-rejected"], finished: ["Encerrado", "none"] };
const STATE = { open: "Inscrições abertas", full: "Vagas esgotadas (lista de espera)", not_yet: "Inscrições ainda não abriram", closed: "Inscrições encerradas", ended: "Evento encerrado", none: "Sem inscrição" };
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-07-eventos.sql</b> no SQL Editor do Supabase.</div>`;
const when = (e) => `${fmtWhen(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ""}`;
const miss = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const tag = (t, c) => `<span class="ptag ${c}">${esc(t)}</span>`;
const cover = (e) => (e.image_url ? `<img src="${attr(e.image_url)}" alt="${attr(e.title)}" style="width:100%;border-radius:10px;margin-bottom:10px;max-height:200px;object-fit:cover">` : "");

// ------------------------------------------------------------------ participante
async function list(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Eventos", ["#/", "Início"])}${spinner()}`;
  const r = await sb.rpc("events_for_me", { p_org: org }); if (!alive()) return;
  if (r.error) { el.innerHTML = `${head("Eventos", ["#/", "Início"])}${miss(r.error) ? SETUP : empty("lock", "Não foi possível carregar.", errText(r.error))}`; return; }
  const ev = r.data;
  el.innerHTML = `${head("Eventos", ["#/", "Início"], `<a class="btn ghost sm" href="#/meus-ingressos">${icon("badge")} Meus ingressos</a>`)}
    <div class="list">${ev.map((e) => `<button class="li col stack" data-e="${e.id}" style="align-items:stretch"><div class="row between"><b>${esc(e.title)}</b>${e.mine ? tag(e.mine.status === "confirmed" ? "Inscrito" : "Na espera", "attender") : e.status === "cancelled" ? tag("Cancelado", "st-rejected") : ""}</div>
      <span class="small muted">${when(e)}</span><span class="small muted">${esc(STATE[e.state] || "")}${e.spots != null && ["open", "full"].includes(e.state) ? ` · ${e.spots} vaga${e.spots === 1 ? "" : "s"}` : ""}</span></button>`).join("") || empty("calendar", "Nenhum evento no momento", "Quando a igreja publicar um evento, ele aparece aqui.")}</div>`;
  el.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => open(ev.find((x) => x.id === b.dataset.e), () => list(el, alive))));
}
function open(e, again) {
  const m = e.mine, canReg = !m && ["open", "full"].includes(e.state);
  const s = sheet(`${cover(e)}<h3>${esc(e.title)}</h3><p class="small muted">${when(e)}</p>${e.description ? `<p>${esc(e.description).replace(/\n/g, "<br>")}</p>` : ""}
    ${e.status === "cancelled" ? `<div class="card small"><b>Evento cancelado.</b>${e.cancel_reason ? ` ${esc(e.cancel_reason)}` : ""}</div>` : ""}
    <p class="small muted">${esc(STATE[e.state] || "")}${e.spots != null && ["open", "full"].includes(e.state) ? ` · ${e.spots} vaga${e.spots === 1 ? "" : "s"}` : ""}${e.state === "not_yet" && e.reg_opens_at ? ` (a partir de ${fmtWhen(e.reg_opens_at)})` : ""}</p>
    ${m ? `<div class="card small"><b>${m.status === "confirmed" ? "Você está inscrito(a)." : "Você está na lista de espera."}</b>${m.guests ? ` Com ${m.guests} acompanhante${m.guests > 1 ? "s" : ""}.` : ""}</div><a class="btn block mt" href="#/meus-ingressos">${icon("badge")} Ver meu ingresso</a><button class="btn ghost block mt" id="un">Cancelar minha inscrição</button>` : ""}
    ${canReg ? `${e.max_guests ? `<label class="fld">Acompanhantes<select id="g">${Array.from({ length: e.max_guests + 1 }, (_, i) => `<option value="${i}">${i === 0 ? "Só eu" : i}</option>`).join("")}</select></label>` : ""}<button class="btn block mt" id="go">${e.state === "full" ? "Entrar na lista de espera" : "Inscrever-me"}</button>` : ""}`);
  const q = (x) => s.el.querySelector(x);
  if (q("#go")) q("#go").onclick = async (ev) => { const b = ev.currentTarget; busy(b); const r = await sb.rpc("event_register", { p_event: e.id, p_guests: Number(q("#g")?.value || 0) }); busy(b, false); if (r.error) return toast(errText(r.error)); s.close(); toast(r.data.status === "confirmed" ? "Inscrição confirmada!" : "Você entrou na lista de espera."); again(); };
  if (q("#un")) q("#un").onclick = async () => { if (!(await confirmDialog("Cancelar a sua inscrição? A vaga será liberada para outra pessoa.", "Cancelar inscrição"))) return; const r = await sb.rpc("event_unregister", { p_reg: m.id, p_reason: null }); if (r.error) return toast(errText(r.error)); s.close(); toast("Inscrição cancelada."); again(); };
}
async function tickets(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Meus ingressos", ["#/eventos", "Eventos"])}${spinner()}`;
  const r = await sb.rpc("event_my_tickets", { p_org: org }); if (!alive()) return;
  if (r.error) { el.innerHTML = `${head("Meus ingressos", ["#/eventos", "Eventos"])}${miss(r.error) ? SETUP : empty("lock", "Não foi possível carregar.", errText(r.error))}`; return; }
  el.innerHTML = `${head("Meus ingressos", ["#/eventos", "Eventos"])}${r.data.map((t) => {
    const dead = t.event_status === "cancelled", wait = t.status === "waitlist";
    return `<div class="card mb" style="text-align:center"><b>${esc(t.title)}</b><p class="small muted" style="margin:4px 0 10px">${fmtWhen(t.starts_at)}${t.location ? ` · ${esc(t.location)}` : ""}</p>
      ${dead ? `<p><b>Evento cancelado.</b> ${esc(t.cancel_reason || "")}</p>` : wait ? `<p><b>Lista de espera:</b> você é o ${t.position}º da fila. Avisaremos se uma vaga abrir.</p>`
        : `<div class="qr" aria-label="QR do ingresso" style="display:inline-block;background:#fff;padding:8px;border-radius:10px">${qrSvg("EV-" + t.code, { size: 190 })}</div><p class="mono" style="letter-spacing:.12em;margin:8px 0 2px"><b>${esc(t.code)}</b></p>
        <p class="small muted">${t.guests ? `Vale para você e ${t.guests} acompanhante${t.guests > 1 ? "s" : ""}.` : "Vale para uma pessoa."}${t.checked_in_at ? ` · Entrada registrada às ${fmtWhen(t.checked_in_at)}` : ""}</p>`}</div>`;
  }).join("") || empty("badge", "Você ainda não tem ingressos", `<a class="link" href="#/eventos">Ver eventos</a>`)}`;
}

// ------------------------------------------------------------------ gestão
async function manage(el, alive) {
  const org = state.org?.id;
  if (!org || !modCan_()) { el.innerHTML = `${head("Eventos da igreja")}${empty("lock", "Você não tem acesso a esta área.")}`; return; }
  el.innerHTML = `${head("Eventos da igreja")}${spinner()}`;
  const r = await sb.rpc("event_list", { p_org: org }); if (!alive()) return;
  if (r.error) { if (miss(r.error)) el.innerHTML = `${head("Eventos da igreja")}${SETUP}`; else fail(el, "Eventos da igreja", r.error); return; }
  const d = r.data;
  el.innerHTML = `${head("Eventos da igreja", undefined, d.can.manage ? `<button class="btn primary sm" id="new">${icon("plus")} Novo evento</button>` : "")}
    <div class="list">${d.events.map((e) => { const [t, c] = STATUS[e.status]; return `<a class="li col stack" href="#/gestao-eventos/${e.id}" style="align-items:stretch"><div class="row between"><b>${esc(e.title)}</b>${tag(t, c)}</div>
      <span class="small muted">${when(e)}</span><span class="small muted">${e.counts.seats} vaga${e.counts.seats === 1 ? "" : "s"} confirmada${e.counts.seats === 1 ? "" : "s"}${e.capacity ? ` de ${e.capacity}` : ""}${e.counts.waitlist ? ` · ${e.counts.waitlist} na espera` : ""}${e.counts.present ? ` · ${e.counts.present} presente${e.counts.present === 1 ? "" : "s"}` : ""}</span></a>`; }).join("") || empty("calendar", "Nenhum evento cadastrado", d.can.manage ? "Crie o primeiro evento." : "")}</div>`;
  if (el.querySelector("#new")) el.querySelector("#new").onclick = () => form(null, org, () => manage(el, alive));
}
const modCan_ = () => EVT_ACTIONS.some(modCan);

function form(e, org, done) {
  const v = e || { audience: "all", registration: "open", max_guests: 0 };
  const s = sheet(`<h3>${e ? "Editar evento" : "Novo evento"}</h3>
    <label class="fld">Título<input id="title" maxlength="120" value="${attr(v.title || "")}"></label>
    <label class="fld">Descrição<textarea id="desc" maxlength="2000" rows="3">${esc(v.description || "")}</textarea></label>
    <label class="fld">Local<input id="loc" maxlength="160" value="${attr(v.location || "")}"></label>
    <div class="row gap-s"><label class="fld grow">Começa em<input id="st" type="datetime-local" value="${v.starts_at ? toLocalInput(v.starts_at) : ""}"></label><label class="fld grow">Termina em<input id="en" type="datetime-local" value="${v.ends_at ? toLocalInput(v.ends_at) : ""}"></label></div>
    <label class="fld">Para quem<select id="aud">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="fld">Inscrição<select id="reg"><option value="none" ${v.registration === "none" ? "selected" : ""}>Sem inscrição (só divulgação)</option><option value="open" ${v.registration === "open" ? "selected" : ""}>Aberta</option><option value="closed" ${v.registration === "closed" ? "selected" : ""}>Fechada</option></select></label>
    <div class="row gap-s"><label class="fld grow">Vagas (vazio = sem limite)<input id="cap" type="number" min="1" value="${v.capacity ?? ""}"></label><label class="fld grow">Acompanhantes por inscrição<input id="gst" type="number" min="0" max="10" value="${v.max_guests ?? 0}"></label></div>
    <div class="row gap-s"><label class="fld grow">Inscrições abrem em<input id="ro" type="datetime-local" value="${v.reg_opens_at ? toLocalInput(v.reg_opens_at) : ""}"></label><label class="fld grow">Inscrições fecham em<input id="rc" type="datetime-local" value="${v.reg_closes_at ? toLocalInput(v.reg_closes_at) : ""}"></label></div>
    <div class="fld">Imagem (opcional)<div class="row gap-s"><button class="btn ghost sm" id="pic" type="button">${icon("camera")} Escolher imagem</button></div><img id="prev" alt="" style="max-width:100%;border-radius:10px;margin-top:8px" ${v.image_url ? `src="${attr(v.image_url)}"` : "hidden"}></div>
    <button class="btn block mt" id="ok">Salvar</button>`);
  const q = (x) => s.el.querySelector(x); let image = v.image_url || null; const iso = (x) => (x ? new Date(x).toISOString() : null);
  q("#pic").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { image = await uploadPublic(`events/${org}`, f); q("#prev").src = image; q("#prev").hidden = false; } catch (er) { toast(errText(er)); } };
  q("#ok").onclick = async (ev) => {
    const b = ev.currentTarget; if (!q("#title").value.trim()) return toast("Informe o título."); if (!q("#st").value) return toast("Informe a data e a hora de início.");
    busy(b); const r = await sb.rpc("event_save", { p_org: org, p_id: e?.id || null, p: { title: q("#title").value, description: q("#desc").value, location: q("#loc").value, starts_at: iso(q("#st").value), ends_at: iso(q("#en").value), audience: q("#aud").value, registration: q("#reg").value,
      capacity: q("#cap").value || null, max_guests: Number(q("#gst").value || 0), reg_opens_at: iso(q("#ro").value), reg_closes_at: iso(q("#rc").value), image_url: image } }); busy(b, false);
    if (r.error) return toast(errText(r.error)); s.close(); toast("Evento salvo."); done(r.data.id);
  };
}

async function detail(el, alive, id) {
  const back = ["#/gestao-eventos", "Eventos da igreja"]; el.innerHTML = `${head("Evento", back)}${spinner()}`;
  const r = await sb.rpc("event_get", { p_id: id }); if (!alive()) return;
  if (r.error) return fail(el, "Evento", r.error, back);
  const { event: e, counts: c, regs, can } = r.data, org = e.org_id; let tab = can.checkin && !can.view && !can.manage ? "checkin" : "regs", q = "";
  const [stT, stC] = STATUS[e.status];
  const act = async (action, reason) => { const rr = await sb.rpc("event_set_status", { p_id: id, p_action: action, p_reason: reason || null }); if (rr.error) return toast(errText(rr.error)); toast("Pronto."); detail(el, alive, id); };
  const csv = () => {
    const rows = [["Nome", "Acompanhantes", "Situação", "Entrada"], ...regs.map((g) => [g.name, g.guests, { confirmed: "Confirmada", waitlist: "Espera", cancelled: "Cancelada" }[g.status], g.checked_in_at ? fmtWhen(g.checked_in_at) : ""])];
    const blob = new Blob(["﻿" + rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n")], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `inscritos-${e.title.replace(/\W+/g, "-")}.csv`; a.click();
  };
  const paint = () => {
    const live = e.status === "published";
    const list = regs.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()));
    el.innerHTML = `${head(e.title, back)}<div class="row between"><span>${tag(stT, stC)} <span class="small muted">${esc(STATE[r.data.state] || "")}</span></span></div>
      <p class="small muted">${when(e)} · ${esc(AUD[e.audience])}${e.capacity ? ` · ${e.capacity} vagas` : ""}</p>${e.cancel_reason ? `<div class="card small"><b>Cancelado:</b> ${esc(e.cancel_reason)}</div>` : ""}
      <div class="row gap-s mb" style="flex-wrap:wrap">${can.manage && !["cancelled", "finished"].includes(e.status) ? `<button class="btn ghost sm" id="ed">Editar</button>` : ""}${can.publish && e.status === "draft" ? `<button class="btn sm" id="pub">Publicar</button>` : ""}
        ${can.publish && e.status === "published" && !c.confirmed && !c.waitlist ? `<button class="btn ghost sm" id="dr">Voltar a rascunho</button>` : ""}${can.publish && live && new Date(e.starts_at) <= new Date() ? `<button class="btn ghost sm" id="fin">Encerrar</button>` : ""}
        ${can.publish && ["draft", "published"].includes(e.status) ? `<button class="btn ghost sm" id="cx">Cancelar evento</button>` : ""}</div>
      <div class="mc-tiles"><div class="mc-tile"><b>${c.seats}</b><span>Vagas confirmadas</span></div><div class="mc-tile"><b>${c.waitlist}</b><span>Na espera</span></div><div class="mc-tile"><b>${c.present}</b><span>Presentes</span></div><div class="mc-tile"><b>${Math.max(c.confirmed - c.checked, 0)}</b><span>Ainda não entraram</span></div></div>
      <nav class="tabs">${can.view || can.manage ? `<button class="${tab === "regs" ? "on" : ""}" data-t="regs">Inscritos</button>` : ""}${can.checkin ? `<button class="${tab === "checkin" ? "on" : ""}" data-t="checkin">Check-in</button>` : ""}</nav>
      ${tab === "regs" ? `<div class="row gap-s mb"><input class="psearch grow" id="q" type="search" placeholder="Buscar pelo nome" value="${attr(q)}" aria-label="Buscar">${can.manage && live ? `<button class="btn ghost sm" id="add">${icon("plus")} Adicionar</button>` : ""}<button class="btn ghost sm" id="csv">CSV</button></div>
        <div class="list">${list.map((g) => `<div class="li col stack" style="align-items:stretch"><div class="row between"><b>${esc(g.name)}${g.guests ? ` + ${g.guests}` : ""}</b>${tag({ confirmed: "Confirmada", waitlist: "Espera", cancelled: "Cancelada" }[g.status], g.status === "confirmed" ? "attender" : g.status === "waitlist" ? "st-pending" : "none")}</div>
          <span class="small muted">${g.checked_in_at ? `Entrou às ${fmtWhen(g.checked_in_at)} (${g.checked_in_count})` : "Não entrou"}${g.source === "admin" ? " · cadastrada pela equipe" : ""}</span>
          ${can.manage && g.status !== "cancelled" && !g.checked_in_at ? `<div class="row gap-s mt"><button class="btn ghost sm" data-cx="${g.id}">Cancelar inscrição</button></div>` : ""}</div>`).join("") || empty("users", "Nenhuma inscrição ainda")}</div>`
      : `<div id="cin"></div>`}`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; paint(); }));
    const on = (id_, fn) => { const n = el.querySelector(id_); if (n) n.onclick = fn; };
    on("#ed", () => form(e, org, () => detail(el, alive, id))); on("#pub", () => act("publish")); on("#dr", () => act("draft")); on("#fin", () => act("finish"));
    on("#cx", () => { const s = sheet(`<h3>Cancelar evento</h3><p class="small muted">Quem se inscreveu será avisado.</p><label class="fld">Motivo<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Cancelar evento</button>`); s.el.querySelector("#ok").onclick = () => { const v = s.el.querySelector("#rs").value.trim(); if (!v) return toast("Informe o motivo."); s.close(); act("cancel", v); }; });
    on("#csv", csv);
    on("#add", () => { const s = sheet(`<h3>Adicionar pessoa</h3><label class="fld">Nome<input id="n" maxlength="160"></label><label class="fld">Acompanhantes<input id="g" type="number" min="0" max="10" value="0"></label><label class="switchrow"><span class="grow"><b>Ultrapassar o limite de vagas</b></span><span class="switch"><input type="checkbox" id="f"><i></i></span></label><button class="btn block mt" id="ok">Adicionar</button>`);
      s.el.querySelector("#ok").onclick = async (ev) => { const b = ev.currentTarget; busy(b); const rr = await sb.rpc("event_register_admin", { p_event: id, p_person: null, p_name: s.el.querySelector("#n").value, p_guests: Number(s.el.querySelector("#g").value || 0), p_force: s.el.querySelector("#f").checked }); busy(b, false); if (rr.error) return toast(errText(rr.error)); s.close(); toast(rr.data.status === "confirmed" ? "Pessoa adicionada." : "Sem vaga: entrou na lista de espera."); detail(el, alive, id); }; });
    el.querySelectorAll("[data-cx]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog("Cancelar esta inscrição? A vaga vai para a lista de espera.", "Cancelar inscrição"))) return; const rr = await sb.rpc("event_unregister", { p_reg: b.dataset.cx, p_reason: "Cancelada pela equipe" }); if (rr.error) return toast(errText(rr.error)); toast("Inscrição cancelada."); detail(el, alive, id); }));
    const qi = el.querySelector("#q"); if (qi) qi.oninput = (ev) => { q = ev.target.value; const pos = ev.target.selectionStart; paint(); const n = el.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); };
    if (tab === "checkin") checkin(el.querySelector("#cin"));
  };
  const refresh = async () => { const rr = await sb.rpc("event_get", { p_id: id }); if (!rr.error) { regs.splice(0, regs.length, ...rr.data.regs); Object.assign(c, rr.data.counts); } };
  const checkin = (box) => {
    const supported = "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia; let stream, timer, qq = "";
    const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; const s = box.querySelector("#stop"); if (s) s.hidden = true; };
    box.innerHTML = `${e.status !== "published" && e.status !== "finished" ? `<div class="card small">O check-in só funciona com o evento publicado.</div>` : ""}
      ${supported ? `<div class="card"><video id="vid" playsinline muted style="width:100%;border-radius:10px;background:var(--ink-2);min-height:160px"></video><div class="row gap mt"><button class="btn sm" id="cam">${icon("camera")} Ler QR do ingresso</button><button class="btn ghost sm" id="stop" hidden>Parar</button></div></div>` : ""}
      <label class="fld mt">Código do ingresso<input id="code" placeholder="Digite ou cole o código" autocomplete="off" autocapitalize="characters"></label><button class="btn block" id="go">Registrar entrada</button><div id="res" class="mt" aria-live="polite"></div>
      <h3 class="mt">Pela lista</h3><input class="psearch" id="lq" type="search" placeholder="Buscar pelo nome" aria-label="Buscar" value="${attr(qq)}"><div class="list mt" id="ll"></div>`;
    const show = (r, name) => { const M = { ok: [`Entrada registrada: ${r.name} (${r.count} pessoa${r.count > 1 ? "s" : ""}).`, "ok"], already: [`${r.name} já entrou às ${fmtWhen(r.at)}.`, "warn"], not_found: ["Ingresso não encontrado.", "err"], other_event: ["Este ingresso é de outro evento.", "err"], waitlist: [`${r.name} está na lista de espera, sem vaga confirmada.`, "err"], cancelled: [`A inscrição de ${r.name} foi cancelada.`, "err"], event_cancelled: ["Este evento foi cancelado.", "err"], event_not_open: ["O evento não está publicado.", "err"] }[r.result] || ["Resultado desconhecido.", "err"]; box.querySelector("#res").innerHTML = `<div class="card small" style="border-color:var(--${M[1] === "ok" ? "ok" : M[1] === "warn" ? "warn" : "danger"})"><b>${esc(M[0])}</b></div>`; };
    const run = async (code, reg, count) => { const rr = await sb.rpc("event_checkin", { p_event: id, p_code: code || null, p_reg: reg || null, p_count: count || null }); if (rr.error) { box.querySelector("#res").innerHTML = `<div class="card small"><b>${esc(errText(rr.error))}</b></div>`; return; } show(rr.data); if (rr.data.result === "ok") { await refresh(); fill(); } };
    box.querySelector("#go").onclick = () => run(box.querySelector("#code").value);
    box.querySelector("#code").onkeydown = (ev) => { if (ev.key === "Enter") run(ev.target.value); };
    const fill = () => { const l = regs.filter((g) => g.status === "confirmed" && (!qq || g.name.toLowerCase().includes(qq.toLowerCase()))).slice(0, 60); box.querySelector("#ll").innerHTML = l.map((g) => `<div class="li"><span class="grow"><span class="t">${esc(g.name)}${g.guests ? ` + ${g.guests}` : ""}</span><span class="s">${g.checked_in_at ? `Entrou às ${fmtWhen(g.checked_in_at)}` : "Não entrou"}</span></span>${g.checked_in_at ? `<button class="btn ghost sm" data-un="${g.id}">Desfazer</button>` : `<button class="btn sm" data-in="${g.id}">Entrada</button>`}</div>`).join("") || `<div class="li muted small">Ninguém encontrado.</div>`;
      box.querySelectorAll("[data-in]").forEach((b) => (b.onclick = () => run(null, b.dataset.in)));
      box.querySelectorAll("[data-un]").forEach((b) => (b.onclick = () => { const s = sheet(`<h3>Desfazer entrada</h3><label class="fld">Motivo<input id="rs" maxlength="300"></label><button class="btn block mt" id="ok">Desfazer</button>`); s.el.querySelector("#ok").onclick = async () => { const v = s.el.querySelector("#rs").value.trim(); if (!v) return toast("Informe o motivo."); const rr = await sb.rpc("event_checkin_undo", { p_reg: b.dataset.un, p_reason: v }); if (rr.error) return toast(errText(rr.error)); s.close(); toast("Entrada desfeita."); await refresh(); fill(); }; })); };
    fill(); box.querySelector("#lq").oninput = (ev) => { qq = ev.target.value; fill(); };
    const cam = box.querySelector("#cam");
    if (cam) cam.onclick = async () => { try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const v = box.querySelector("#vid"); v.srcObject = stream; await v.play(); box.querySelector("#stop").hidden = false; const det = new BarcodeDetector({ formats: ["qr_code"] });
      timer = setInterval(async () => { try { const f = await det.detect(v); if (f[0]?.rawValue) { stop(); run(f[0].rawValue); } } catch {} }, 400); } catch { toast("Não foi possível abrir a câmera. Confira a permissão ou digite o código."); } };
    const st = box.querySelector("#stop"); if (st) st.onclick = stop; window.addEventListener("hashchange", stop, { once: true });
  };
  paint();
}
