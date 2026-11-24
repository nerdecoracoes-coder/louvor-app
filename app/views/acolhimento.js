// Acolhimento de visitantes: cadastro simples depois da conversa, retorno e jornada (primeira visita → retorno → aproximação → integração).
// Tudo passa por funções no servidor (welcome_*), que conferem a permissão "registrar acolhimento". Aqui só se mostra o que o servidor libera.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, canWelcome, people, personName, waLink, go } from "../core.js";
import { CLASS_LABEL } from "../lib/pessoas-import.js";

export function register(route) {
  route("/acolhimento", (p, el, a) => listView(el, a));
  route("/acolhimento/novo", (p, el, a) => newView(el, a));
  route("/acolhimento/:id", (p, el, a) => detailView(el, a, p.id));
}

const STAGES = [["first_visit", "Primeira visita"], ["returning", "Retorno"], ["approach", "Aproximação"], ["integration", "Integração"]];
const STAGE_LABEL = Object.fromEntries(STAGES);
const KINDS = [["interest", "Interesse manifestado"], ["request", "Pedido ou necessidade"], ["family", "Informação da família"], ["approach", "Aproximação"], ["integration", "Integração"], ["contact", "Contato feito"]];
const KIND_LABEL = Object.fromEntries(KINDS);
const PRESETS = {
  interest: ["Conhecer melhor a igreja", "Receber oração", "Conversar com alguém da liderança", "Conhecer atividades e ministérios"],
  integration: ["Apresentação dos ministérios", "Apresentação dos grupos e atividades", "Orientação sobre a comunidade", "Encaminhamento para conversa", "Interesse em participar de atividades"],
};
const ERRORS = {
  name_required: "Informe o nome.", name_too_long: "Nome muito longo.", invalid_date: "Data inválida.", invalid_welcomer: "Escolha um integrante da igreja como responsável.",
  invalid_phone: "Telefone inválido (use DDD e número).", phone_needs_consent: "Só é possível guardar o telefone se a pessoa autorizou o contato.", consent_needs_phone: "Para registrar a autorização, informe o telefone.",
  already_registered: "Essa visita já está registrada.", before_first_visit: "A data não pode ser anterior à primeira visita.", no_contact_consent: "A pessoa não autorizou contato.",
  note_required: "Escreva o que aconteceu.", note_too_long: "Texto muito longo.", forbidden: "Você não tem permissão para o acolhimento.", not_found: "Cadastro não encontrado.",
};
const errText = (e) => {
  const m = String(e?.message || e || "");
  if (/welcome_(register|list|get|visit|note|update)/.test(m) && /not exist|schema cache|Could not find/i.test(m)) return "Falta rodar a atualização do banco (atualizacao-2026-11-25-acolhimento.sql).";
  const k = Object.keys(ERRORS).find((x) => m.includes(x)); return k ? ERRORS[k] : m;
};
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-25-acolhimento.sql</b> no SQL Editor do Supabase.</div>`;
const br = (d) => (d ? d.split("-").reverse().join("/") : "");
const todayYmd = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const head = (title, back = "#/acolhimento") => `<div class="pagehead"><a class="back" href="${back}" aria-label="Voltar">${icon("chevronLeft")}</a><h1>${esc(title)}</h1></div>`;
const guard = (el) => {
  if (!canWelcome()) { el.innerHTML = `<div class="pagehead"><h1>Acolhimento</h1></div>${empty("lock", "Você não tem acesso ao registro de acolhimento.", `Quem serve no acolhimento recebe essa permissão da liderança. As orientações estão em <a class="link" href="#/acolher">Como acolher</a>.`)}`; return false; }
  return true;
};
const stageTrack = (stage) => {
  const at = STAGES.findIndex(([k]) => k === stage);
  return `<ol class="jtrack" aria-label="Jornada">${STAGES.map(([k, l], i) => `<li class="${i < at ? "done" : ""}${i === at ? " now" : ""}"><i></i><span>${l}</span></li>`).join("")}</ol>`;
};
async function welcomerOptions(sel) {
  const map = await people().catch(() => new Map());
  const rows = [...map.values()].filter((m) => m.role !== "guest").sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
  return rows.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.display_name)}${m.id === state.user.id ? " (eu)" : ""}</option>`).join("");
}

// ------------------------------------------------------------------ lista
async function listView(el, alive) {
  if (!guard(el)) return;
  const st = { q: "", page: 0 }, PAGE = 30;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/acolher" aria-label="Voltar">${icon("chevronLeft")}</a><h1>Acolhimento</h1><a class="btn primary sm" href="#/acolhimento/novo">${icon("plus")} Visitante</a></div>
    <p class="muted small" style="margin:-8px 0 14px">Registre depois da conversa, sem pressa. A pessoa não precisa deixar telefone.</p>
    <label class="psearch">${icon("search")}<input id="q" type="search" placeholder="Buscar pelo nome" autocomplete="off"></label>
    <div id="rows">${spinner()}</div><div id="more"></div>`;
  const rowsEl = el.querySelector("#rows"), moreEl = el.querySelector("#more");
  const row = (r) => `<a class="li" href="#/acolhimento/${r.id}">${avatar({ display_name: r.full_name }, 42, false)}<span class="grow"><span class="t">${esc(r.full_name)}</span>
    <span class="s">${r.first_visit_on ? `1ª visita ${br(r.first_visit_on)}` : "Sem visita registrada"}${r.visits > 1 ? ` · ${r.visits} visitas` : ""}</span></span>
    <span class="col-end"><span class="ptag ${r.stage === "first_visit" ? "" : "acct"}">${STAGE_LABEL[r.stage]}</span>${r.classification !== "visitor" ? `<span class="ptag ${r.classification}" style="margin-top:4px">${esc(CLASS_LABEL[r.classification] || "")}</span>` : ""}</span>${icon("chevronRight", "chev")}</a>`;
  const load = async (append) => {
    if (!append) { st.page = 0; rowsEl.innerHTML = spinner(); moreEl.innerHTML = ""; }
    const r = await sb.rpc("welcome_list", { p_org: state.org.id, p_q: st.q || null, p_limit: PAGE, p_offset: st.page * PAGE });
    if (!alive()) return;
    if (r.error) { rowsEl.innerHTML = /welcome_list/.test(r.error.message || "") && /not exist|schema cache|Could not find/i.test(r.error.message || "") ? SETUP : empty("alert", "Não foi possível carregar.", esc(errText(r.error))); return; }
    const { total, rows } = r.data;
    if (!append) rowsEl.innerHTML = rows.length ? `<div class="list">${rows.map(row).join("")}</div>` : empty("heart", st.q ? "Ninguém encontrado com esse nome." : "Nenhum visitante registrado ainda.", st.q ? "" : "Quando alguém visitar a igreja, registre aqui depois da conversa.");
    else rowsEl.querySelector(".list").insertAdjacentHTML("beforeend", rows.map(row).join(""));
    const shown = (st.page + 1) * PAGE;
    moreEl.innerHTML = total > shown ? `<button class="btn ghost block mt" id="mb">Ver mais</button>` : "";
    moreEl.querySelector("#mb")?.addEventListener("click", () => { st.page++; load(true); });
  };
  let t; el.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(false); }, 250); });
  load(false);
}

// ------------------------------------------------------------------ cadastro simples
async function newView(el, alive) {
  if (!guard(el)) return;
  const wopts = await welcomerOptions(state.user.id);
  if (!alive()) return;
  el.innerHTML = `${head("Novo visitante")}
    <p class="muted small" style="margin:-8px 0 14px">Só o nome é necessário. Telefone é opcional e só vale se a pessoa quis compartilhar.</p>
    <form id="f" novalidate>
      <label class="field"><span>Nome *</span><input name="full_name" maxlength="160" required autocomplete="off" autocapitalize="words"></label>
      <div class="grid2"><label class="field"><span>Primeira visita</span><input type="date" name="day" value="${todayYmd()}" max="${todayYmd()}"></label>
        <label class="field"><span>Quem acolheu</span><select name="welcomer">${wopts}</select></label></div>
      <label class="field"><span>Telefone (se a pessoa quis compartilhar)</span><input type="tel" name="phone" maxlength="30" autocomplete="off" inputmode="tel"></label>
      <label class="li" style="border:0;min-height:0;padding:0 0 14px"><input type="checkbox" name="consent" disabled><span class="grow s">A pessoa autorizou a igreja a entrar em contato por este telefone.</span></label>
      <button class="btn primary block" id="ok">Salvar visitante</button>
    </form>`;
  const f = el.querySelector("#f"), ph = f.phone, cb = f.consent;
  const sync = () => { const has = ph.value.trim().length > 0; cb.disabled = !has; if (!has) cb.checked = false; };
  ph.addEventListener("input", sync);
  const send = async (force) => {
    const b = f.querySelector("#ok"); busy(b);
    try {
      const day = f.day.value || todayYmd();
      const r = await sb.rpc("welcome_register", { p_org: state.org.id, p_name: f.full_name.value, p_phone: ph.value.trim() || null, p_consent: cb.checked, p_visited_on: day, p_welcomer: f.welcomer.value || null, p_force: !!force });
      if (r.error) return toast(errText(r.error));
      if (r.data.saved) { toast("Visitante registrado"); return go(`/acolhimento/${r.data.id}`); }
      dupSheet(r.data.duplicates, day);
    } finally { busy(b, false); }
  };
  const dupSheet = (dups, day) => {
    const s = sheet(`<h3>Essa pessoa já está cadastrada?</h3><p class="small muted">Encontramos cadastro parecido. Se for a mesma pessoa, registre apenas o retorno.</p>
      <div class="list menu">${dups.map((d) => `<button class="li" data-ret="${d.id}"><span class="grow"><span class="t">${esc(d.full_name)}</span><span class="s">${esc(CLASS_LABEL[d.classification] || "")} · mesmo ${esc(d.reason)}</span></span><span class="btn ghost sm">É ela: registrar retorno</span></button>`).join("")}</div>
      <button class="btn ghost block mt" id="other">É outra pessoa, cadastrar mesmo assim</button><button class="btn ghost block mt" id="cx">Cancelar</button>`);
    s.el.querySelector("#cx").onclick = () => s.close();
    s.el.querySelector("#other").onclick = () => { s.close(); send(true); };
    s.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ret]"); if (!b) return;
      const r = await sb.rpc("welcome_visit", { p_person: b.dataset.ret, p_visited_on: day, p_welcomer: f.welcomer.value || null });
      if (r.error) { toast(errText(r.error)); if (/already_registered/.test(r.error.message || "")) { s.close(); go(`/acolhimento/${b.dataset.ret}`); } return; }
      toast("Retorno registrado"); s.close(); go(`/acolhimento/${b.dataset.ret}`);
    });
  };
  f.addEventListener("submit", (e) => { e.preventDefault(); if (!f.full_name.value.trim()) return toast("Informe o nome."); send(false); });
}

// ------------------------------------------------------------------ ficha: jornada e histórico
async function detailView(el, alive, id) {
  if (!guard(el)) return;
  el.innerHTML = spinner();
  const [r, ppl] = await Promise.all([sb.rpc("welcome_get", { p_person: id }), people().catch(() => new Map())]);
  if (!alive()) return;
  if (r.error) { el.innerHTML = head("Acolhimento") + (/not exist|schema cache|Could not find/i.test(r.error.message || "") ? SETUP : empty("userOff", "Cadastro não encontrado.", esc(errText(r.error)))); return; }
  const { person: p, stage, visits, journey, consents } = r.data;
  const first = [...visits].reverse()[0];
  const events = [
    ...visits.map((v) => ({ at: v.visited_on, sort: 1, ic: "heart", t: v.kind === "first" ? "Primeira visita" : "Retorno", s: v.welcomed_by_name ? `Acolhido por ${v.welcomed_by_name}` : "" })),
    ...journey.map((j) => ({ at: j.happened_on, sort: 2, ic: "sparkle", t: KIND_LABEL[j.kind] || j.kind, s: j.note + (j.by ? ` — ${j.by}` : "") })),
    ...consents.map((c) => ({ at: c.at.slice(0, 10), sort: 0, ic: "phone", t: c.value ? "Autorizou contato" : "Retirou a autorização de contato", s: c.by ? `Registrado por ${c.by}` : "" })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.sort - a.sort));
  el.innerHTML = `${head("Acolhimento")}
    <div class="card perscard">
      <div class="row gap">${avatar({ display_name: p.full_name }, 56, false)}<span class="grow"><b class="ptitle">${esc(p.full_name)}</b>
        <span class="row gap-s wrap" style="margin-top:6px"><span class="ptag ${p.classification}">${esc(CLASS_LABEL[p.classification] || "")}</span>${first ? `<span class="tiny muted">1ª visita em ${br(first.visited_on)}</span>` : `<span class="tiny muted">sem visita registrada</span>`}</span></span></div>
      ${stageTrack(stage)}
      <p class="tiny muted" style="margin:10px 0 0">A jornada mostra o que já aconteceu. Cada pessoa tem seu próprio tempo, e ficar na primeira etapa está certo.</p>
    </div>
    <div class="card mt"><h3>Contato</h3>
      ${p.consent && p.phone ? `<div class="drow"><span>Telefone</span><b>${esc(p.phone)}</b></div><div class="row gap-s mt"><a class="btn ghost sm" href="tel:${attr(p.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} Ligar</a><a class="btn ghost sm" target="_blank" rel="noopener" href="${attr(waLink(p.phone, `Olá, ${p.full_name.split(" ")[0]}! Foi uma alegria receber você.`))}">${icon("whatsapp")} WhatsApp</a></div><p class="tiny muted" style="margin:10px 0 0">Autorizado${p.consent_at ? ` em ${br(p.consent_at.slice(0, 10))}` : ""}.</p>`
        : `<p class="small muted" style="margin:0">Sem telefone. Tudo bem: a pessoa pode compartilhar quando quiser.</p>`}
    </div>
    <div class="grid2 mt"><button class="btn primary" id="ret">${icon("heart")} Registrar retorno</button><button class="btn ghost" id="reg">${icon("sparkle")} Registrar conversa</button></div>
    <button class="btn ghost block mt" id="fix">${icon("edit")} Corrigir nome ou contato</button>
    <h3 class="mt">Histórico</h3>
    <div class="jlog">${events.length ? events.map((e) => `<div class="jev">${icon(e.ic)}<div><b>${esc(e.t)}</b><span>${br(e.at)}${e.s ? ` · ${esc(e.s)}` : ""}</span></div></div>`).join("") : `<p class="small muted">Nada registrado ainda.</p>`}</div>`;
  const refresh = () => detailView(el, alive, id);

  el.querySelector("#ret").onclick = async () => {
    const opts = await welcomerOptions(state.user.id);
    const s = sheet(`<h3>Registrar retorno</h3><p class="small muted">A data da primeira visita continua a mesma.</p>
      <div class="grid2"><label class="field"><span>Data</span><input type="date" id="d" value="${todayYmd()}" max="${todayYmd()}"></label><label class="field"><span>Quem acolheu</span><select id="w">${opts}</select></label></div>
      <button class="btn primary block" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; busy(b);
      try { const x = await sb.rpc("welcome_visit", { p_person: id, p_visited_on: s.el.querySelector("#d").value || null, p_welcomer: s.el.querySelector("#w").value || null });
        if (x.error) return toast(errText(x.error)); toast("Retorno registrado"); s.close(); refresh(); } finally { busy(b, false); }
    };
  };

  el.querySelector("#reg").onclick = () => {
    const kinds = KINDS.filter(([k]) => k !== "contact" || p.consent);
    const s = sheet(`<h3>Registrar conversa</h3><p class="small muted">Só o que a própria pessoa quis compartilhar. Nada aqui é obrigatório.</p>
      <label class="field"><span>Tipo</span><select id="k">${kinds.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <div class="chips jchips mb" id="pre" style="flex-wrap:wrap"></div>
      <label class="field"><span>O que aconteceu</span><textarea id="n" rows="3" maxlength="1000"></textarea></label>
      <label class="field"><span>Data</span><input type="date" id="d" value="${todayYmd()}" max="${todayYmd()}"></label>
      <button class="btn primary block" id="ok">Salvar</button>`);
    const k = s.el.querySelector("#k"), n = s.el.querySelector("#n"), pre = s.el.querySelector("#pre");
    const paint = () => { pre.innerHTML = (PRESETS[k.value] || []).map((t) => `<button type="button" class="chip" data-t="${attr(t)}">${esc(t)}</button>`).join(""); };
    k.addEventListener("change", paint); paint();
    pre.addEventListener("click", (e) => { const c = e.target.closest("[data-t]"); if (!c) return; n.value = n.value.trim() ? `${n.value.trim()}; ${c.dataset.t}` : c.dataset.t; });
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; busy(b);
      try { const x = await sb.rpc("welcome_note", { p_person: id, p_kind: k.value, p_note: n.value, p_on: s.el.querySelector("#d").value || null });
        if (x.error) return toast(errText(x.error)); toast("Registrado"); s.close(); refresh(); } finally { busy(b, false); }
    };
  };

  el.querySelector("#fix").onclick = () => {
    const s = sheet(`<h3>Corrigir dados</h3><p class="small muted">O histórico anterior é mantido.</p>
      <label class="field"><span>Nome</span><input id="nm" maxlength="160" value="${attr(p.full_name)}"></label>
      <label class="field"><span>Telefone</span><input id="ph" type="tel" maxlength="30" inputmode="tel" value="${attr(p.phone || "")}"></label>
      <label class="li" style="border:0;min-height:0;padding:0 0 14px"><input type="checkbox" id="cs" ${p.consent ? "checked" : ""} ${p.phone ? "" : "disabled"}><span class="grow s">A pessoa autorizou a igreja a entrar em contato.</span></label>
      <p class="tiny muted">Ao retirar a autorização, o telefone é apagado.</p>
      <button class="btn primary block" id="ok">Salvar</button>`);
    const ph = s.el.querySelector("#ph"), cs = s.el.querySelector("#cs");
    ph.addEventListener("input", () => { const has = ph.value.trim().length > 0; cs.disabled = !has; if (!has) cs.checked = false; });
    s.el.querySelector("#ok").onclick = async (e) => {
      const b = e.currentTarget; busy(b);
      try { const body = { full_name: s.el.querySelector("#nm").value };
        if (ph.value.trim() !== (p.phone || "")) body.phone = ph.value.trim();
        if (cs.checked !== p.consent) body.consent = cs.checked;
        const x = await sb.rpc("welcome_update", { p_person: id, p: body });
        if (x.error) return toast(errText(x.error)); toast("Dados atualizados"); s.close(); refresh(); } finally { busy(b, false); }
    };
  };
}
