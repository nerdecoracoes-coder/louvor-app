// Ambientes dos ministérios: Infantil (crianças, entrada e saída) e Diáconos (visitantes).
import { sb, state, must, esc, attr, icon, people, personName, canManageTeam, sheet, toast, errMsg, busy, on, empty, spinner, confirmDialog, waLink, fDate, fTime, ymd, teamHas } from "../core.js";

export function register(route) {
  route("/times/:id/criancas", (p, el, a) => kids(p.id, el, a));
  route("/times/:id/visitantes", (p, el, a) => visitors(p.id, el, a));
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-05-criancas-visitantes.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST205|column/i.test(String(e?.message || e?.code || e));
const getTeam = async (id) => state.orgTeams.find((t) => t.id === id) || (await must(sb.from("teams").select("*").eq("id", id).maybeSingle()));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const phoneRow = (phone, label = "Ligar") => phone ? `<div class="row gap-s mt-s"><a class="btn ghost sm" href="tel:${attr(phone)}">${icon("phone")} ${label}</a>${waLink(phone) ? `<a class="btn ghost sm" href="${waLink(phone)}" target="_blank" rel="noopener">${icon("chat")} WhatsApp</a>` : ""}</div>` : "";
const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
function ageOf(d) {
  if (!d) return "";
  const b = new Date(d + "T12:00:00"), n = new Date();
  let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth() - (n.getDate() < b.getDate() ? 1 : 0);
  if (m < 0) m = 0;
  return m < 24 ? `${m} ${m === 1 ? "mês" : "meses"}` : `${Math.floor(m / 12)} anos`;
}

// ---------------------------------------------------------------- Ministério Infantil
async function kids(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "criancas")) { el.innerHTML = empty("users", "Este time não tem o cadastro de crianças."); return; }
  const manage = canManageTeam(teamId);
  let children = [], open = new Map(), filter = "todas", q = "";
  const load = async () => {
    const [c, o] = await Promise.all([
      sb.from("children").select("*").eq("team_id", teamId).eq("active", true).order("name"),
      sb.from("child_checkins").select("*").eq("team_id", teamId).is("checked_out_at", null),
    ]);
    if (c.error || o.error) throw (c.error || o.error);
    children = c.data; open = new Map(o.data.map((x) => [x.child_id, x]));
  };
  try { await load(); } catch (e) { el.innerHTML = missing(e) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(e)); return; }
  if (!alive()) return;

  const draw = () => {
    const present = children.filter((c) => open.has(c.id)).length;
    const list = children.filter((c) => (filter === "presentes" ? open.has(c.id) : filter === "alerta" ? !!c.allergies : true) && (!q || norm(c.name).includes(norm(q))))
      .sort((a, b) => (open.has(b.id) - open.has(a.id)) || a.name.localeCompare(b.name));
    el.innerHTML = `<div class="pagehead"><h1>Crianças</h1><button class="btn primary sm" id="addkid">${icon("plus")} Cadastrar</button></div>
      <p class="muted small">Presentes agora: <b>${present}</b> de ${children.length}. Toque em <b>Entrada</b> ao receber e em <b>Saída</b> ao entregar.</p>
      <label class="search srch" style="display:block">${icon("search")}<input class="input" id="kq" placeholder="Procurar criança" value="${attr(q)}"></label>
      <div class="row gap-s mt-s" style="flex-wrap:wrap"><button class="chip ${filter === "todas" ? "on" : ""}" data-f="todas">Todas</button><button class="chip ${filter === "presentes" ? "on" : ""}" data-f="presentes">Presentes${present ? ` (${present})` : ""}</button>
        <button class="chip ${filter === "alerta" ? "on" : ""}" data-f="alerta">Com alergia ou aviso</button></div>
      <div class="list mt" id="kl">${list.map((c) => { const o = open.get(c.id);
        return `<div class="li kid"><button class="kidmain" data-k="${c.id}"><span class="kav${o ? " in" : ""}">${esc(initials(c.name))}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(c.name)}</span>
          <span class="s">${[ageOf(c.birth_date), c.guardian_name ? `Resp.: ${esc(c.guardian_name)}` : ""].filter(Boolean).join(" · ")}${c.allergies ? ` <span class="tag err">${icon("alert")} ${esc(c.allergies.length > 24 ? c.allergies.slice(0, 22) + "…" : c.allergies)}</span>` : ""}</span></span></button>
          ${o ? `<div class="kact"><button class="btn ghost sm" data-out="${c.id}">Saída</button><small class="tiny muted">desde ${fTime(o.checked_in_at)}</small></div>` : `<button class="btn primary sm" data-in="${c.id}">Entrada</button>`}</div>`; }).join("")
        || `<div style="padding:10px">${empty("users", children.length ? "Nenhuma criança encontrada" : "Nenhuma criança cadastrada", children.length ? "Tente outro nome ou filtro." : "Cadastre as crianças uma vez; depois é só tocar em Entrada e Saída.")}</div>`}</div>`;
  };
  draw();

  async function checkIn(c, btn) {
    busy(btn);
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const r = await sb.from("child_checkins").insert({ org_id: team.org_id, team_id: teamId, child_id: c.id, code, checked_in_by: state.user.id }).select("*").single();
    if (r.error) { busy(btn, false); return toast(/duplicate|unique/i.test(errMsg(r.error)) ? "Esta criança já está presente." : errMsg(r.error), "err"); }
    open.set(c.id, r.data); draw();
    const s = sheet(`<h3 style="text-align:center">Entrada de ${esc(c.name.split(" ")[0])}</h3>
      <p class="muted small" style="text-align:center">Entregue este código ao responsável. Ele será pedido na saída.</p>
      <div class="kcode">${code}</div>
      ${c.allergies ? `<div class="card" style="border-color:var(--danger)"><b class="small" style="color:var(--danger)">${icon("alert")} Atenção: ${esc(c.allergies)}</b></div>` : ""}
      ${c.notes ? `<p class="small mt-s">${esc(c.notes)}</p>` : ""}
      <button class="btn primary block mt" data-close>Pronto</button>`);
    s.el.querySelector("[data-close]").onclick = () => s.close();
  }
  function checkOut(c) {
    const o = open.get(c.id);
    const s = sheet(`<h3>Saída de ${esc(c.name)}</h3><p class="small muted" style="margin-top:-6px">Entrou às ${fTime(o.checked_in_at)}.</p>
      <label class="field"><span>Código de retirada</span><input class="input" id="kc" inputmode="numeric" maxlength="4" placeholder="4 números" autocomplete="off"></label>
      <label class="field"><span>Quem está retirando?</span><select id="kw">${c.guardian_name ? `<option value="${attr(c.guardian_name)}">${esc(c.guardian_name)} (responsável)</option>` : ""}<option value="">Outra pessoa</option></select></label>
      <label class="field hidden" id="kolab"><span>Nome de quem retira</span><input class="input" id="ko" maxlength="80"></label>
      <p class="small hidden" id="kwarn" style="color:var(--danger)">O código não confere. Confirme quem está retirando antes de entregar a criança.</p>
      <button class="btn primary block mt" id="kok">Confirmar saída</button>`);
    const sel = s.el.querySelector("#kw"), lab = s.el.querySelector("#kolab");
    const sync = () => lab.classList.toggle("hidden", !!sel.value); sel.onchange = sync; sync();
    let warned = false;
    s.el.querySelector("#kok").onclick = async (e) => {
      const typed = s.el.querySelector("#kc").value.trim(), okCode = typed === o.code;
      const who = sel.value || s.el.querySelector("#ko").value.trim();
      if (!who) return toast("Diga quem está retirando.", "err");
      if (!okCode && !warned) { warned = true; s.el.querySelector("#kwarn").classList.remove("hidden"); e.target.textContent = "Confirmar mesmo assim"; return; }
      busy(e.target);
      const r = await sb.from("child_checkins").update({ checked_out_at: new Date().toISOString(), checked_out_by: state.user.id, picked_by: who, code_ok: okCode }).eq("id", o.id);
      if (r.error) { busy(e.target, false); return toast(errMsg(r.error), "err"); }
      open.delete(c.id); s.close(); toast("Saída registrada"); draw();
    };
  }
  function detail(c) {
    const s = sheet(`<h3>${esc(c.name)}</h3><p class="small muted" style="margin-top:-6px">${esc(ageOf(c.birth_date))}${c.birth_date ? ` · ${esc(fDate(c.birth_date + "T12:00:00"))}` : ""}</p>
      ${c.allergies ? `<div class="card" style="border-color:var(--danger)"><b class="small" style="color:var(--danger)">${icon("alert")} Alergias e cuidados</b><p style="margin:4px 0 0">${esc(c.allergies)}</p></div>` : ""}
      <div class="card mt-s"><b class="small">Responsável</b><p style="margin:4px 0 0">${esc(c.guardian_name || "Não informado")}${c.guardian_phone ? ` · ${esc(c.guardian_phone)}` : ""}</p>${phoneRow(c.guardian_phone)}</div>
      ${c.notes ? `<div class="card mt-s"><b class="small">Observações</b><p style="margin:4px 0 0;white-space:pre-wrap">${esc(c.notes)}</p></div>` : ""}
      <div class="row gap mt"><button class="btn ghost grow" id="ked">${icon("edit")} Editar</button>${manage ? `<button class="btn danger" id="kdel" aria-label="Remover">${icon("trash")}</button>` : ""}</div>`, { wide: true });
    s.el.querySelector("#ked").onclick = () => { s.close(); form(c); };
    s.el.querySelector("#kdel")?.addEventListener("click", async () => {
      if (!(await confirmDialog(`Remover ${c.name} do cadastro?`, "Remover", true))) return;
      const r = await sb.from("children").update({ active: false }).eq("id", c.id);
      if (r.error) return toast(errMsg(r.error), "err");
      s.close(); children = children.filter((x) => x.id !== c.id); draw(); toast("Removida do cadastro");
    });
  }
  function form(c) {
    const s = sheet(`<h3>${c ? "Editar criança" : "Cadastrar criança"}</h3><form id="kf">
      <label class="field"><span>Nome *</span><input class="input" name="name" required maxlength="120" value="${attr(c?.name || "")}"></label>
      <label class="field"><span>Data de nascimento</span><input class="input" type="date" name="birth_date" value="${attr(c?.birth_date || "")}"></label>
      <label class="field"><span>Responsável</span><input class="input" name="guardian_name" maxlength="120" value="${attr(c?.guardian_name || "")}"></label>
      <label class="field"><span>Telefone do responsável</span><input class="input" name="guardian_phone" type="tel" inputmode="tel" maxlength="30" value="${attr(c?.guardian_phone || "")}" placeholder="(21) 99999-9999"></label>
      <label class="field"><span>Alergias e cuidados</span><input class="input" name="allergies" maxlength="200" value="${attr(c?.allergies || "")}" placeholder="Ex.: amendoim, lactose"></label>
      <label class="field"><span>Observações</span><textarea class="input" name="notes" rows="2" maxlength="500" placeholder="Ex.: tem medo de escuro, usa chupeta">${esc(c?.notes || "")}</textarea></label>
      <button class="btn primary block mt">Salvar</button></form>`, { wide: true });
    s.el.querySelector("#kf").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, btn = f.querySelector("button"); busy(btn);
      const row = { name: f.name.value.trim(), birth_date: f.birth_date.value || null, guardian_name: f.guardian_name.value.trim() || null, guardian_phone: f.guardian_phone.value.trim() || null,
        allergies: f.allergies.value.trim() || null, notes: f.notes.value.trim() || null };
      const r = c ? await sb.from("children").update(row).eq("id", c.id).select("*").single()
        : await sb.from("children").insert({ ...row, org_id: team.org_id, team_id: teamId, created_by: state.user.id }).select("*").single();
      busy(btn, false);
      if (r.error) return toast(errMsg(r.error), "err");
      children = c ? children.map((x) => (x.id === c.id ? r.data : x)) : [...children, r.data]; s.close(); draw(); toast(c ? "Salvo" : "Criança cadastrada");
    };
  }

  on(el, "click", "#addkid", () => form(null));
  on(el, "click", "[data-f]", (e, b) => { filter = b.dataset.f; draw(); });
  on(el, "click", "[data-k]", (e, b) => detail(children.find((c) => c.id === b.dataset.k)));
  on(el, "click", "[data-in]", (e, b) => checkIn(children.find((c) => c.id === b.dataset.in), b));
  on(el, "click", "[data-out]", (e, b) => checkOut(children.find((c) => c.id === b.dataset.out)));
  on(el, "input", "#kq", (e, i) => { q = i.value; const pos = i.selectionStart; draw(); const n = el.querySelector("#kq"); n.focus(); n.setSelectionRange(pos, pos); });
}

// ---------------------------------------------------------------- Diáconos: visitantes
const HOW = ["Convite de alguém", "Redes sociais", "Passando pela igreja", "Já conhecia", "Outro"];
const STATUS = { novo: ["Novo", "warn"], contatado: ["Contatado", "soft"], integrado: ["Integrado", "ok"] };
async function visitors(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await getTeam(teamId);
  if (!team || !teamHas(team, "visitantes")) { el.innerHTML = empty("users", "Este time não tem registro de visitantes."); return; }
  const manage = canManageTeam(teamId);
  let rows = [], filter = "acompanhar", q = "";
  const r0 = await sb.from("visitors").select("*").eq("team_id", teamId).order("visited_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (r0.error) { el.innerHTML = missing(r0.error) ? SETUP : empty("alert", "Não foi possível carregar", errMsg(r0.error)); return; }
  rows = r0.data; if (!alive()) return;
  const ppl = await people();
  const today = ymd(new Date());
  const rel = (d) => (d === today ? "Hoje" : fDate(d + "T12:00:00"));

  const draw = () => {
    const month = today.slice(0, 7);
    const list = rows.filter((v) => (filter === "acompanhar" ? v.status !== "integrado" : filter === "mes" ? v.visited_on.startsWith(month) : true) && (!q || norm(v.name).includes(norm(q))));
    const pend = rows.filter((v) => v.status === "novo").length;
    el.innerHTML = `<div class="pagehead"><h1>Visitantes</h1><button class="btn primary sm" id="addv">${icon("plus")} Registrar</button></div>
      <p class="muted small">${rows.filter((v) => v.visited_on.startsWith(month)).length} neste mês${pend ? ` · ${pend} ainda sem contato` : ""}.</p>
      <label class="search srch" style="display:block">${icon("search")}<input class="input" id="vq" placeholder="Procurar visitante" value="${attr(q)}"></label>
      <div class="row gap-s mt-s" style="flex-wrap:wrap"><button class="chip ${filter === "acompanhar" ? "on" : ""}" data-f="acompanhar">Acompanhar</button><button class="chip ${filter === "mes" ? "on" : ""}" data-f="mes">Este mês</button><button class="chip ${filter === "todos" ? "on" : ""}" data-f="todos">Todos</button></div>
      <div class="list mt">${list.map((v) => `<button class="li" data-v="${v.id}"><span class="kav">${esc(initials(v.name))}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(v.name)}</span>
        <span class="s">${esc(rel(v.visited_on))}${v.first_time ? " · 1ª visita" : ""}${v.how_known ? ` · ${esc(v.how_known)}` : ""}</span></span><span class="tag ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></button>`).join("")
        || `<div style="padding:10px">${empty("users", "Nenhum visitante aqui", "Registre quem visitar a igreja para acompanhar depois: ligar, convidar de novo e integrar.")}</div>`}</div>`;
  };
  draw();

  function form(v) {
    const s = sheet(`<h3>${v ? "Editar visitante" : "Registrar visitante"}</h3><form id="vf">
      <label class="field"><span>Nome *</span><input class="input" name="name" required maxlength="120" value="${attr(v?.name || "")}"></label>
      <label class="field"><span>Telefone / WhatsApp</span><input class="input" name="phone" type="tel" inputmode="tel" maxlength="30" value="${attr(v?.phone || "")}"></label>
      <label class="field"><span>Como conheceu a igreja</span><select name="how_known"><option value="">—</option>${HOW.map((h) => `<option ${v?.how_known === h ? "selected" : ""}>${h}</option>`).join("")}</select></label>
      <label class="switchrow"><span class="grow">Primeira visita</span><span class="switch"><input type="checkbox" name="first_time" ${v ? (v.first_time ? "checked" : "") : "checked"}><i></i></span></label>
      <label class="field"><span>Observações</span><textarea class="input" name="notes" rows="2" maxlength="500" placeholder="Ex.: veio com a família da Ana; pediu oração pelo emprego">${esc(v?.notes || "")}</textarea></label>
      <button class="btn primary block mt">Salvar</button></form>`, { wide: true });
    s.el.querySelector("#vf").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, btn = f.querySelector("button.primary"); busy(btn);
      const row = { name: f.name.value.trim(), phone: f.phone.value.trim() || null, how_known: f.how_known.value || null, first_time: f.first_time.checked, notes: f.notes.value.trim() || null };
      const r = v ? await sb.from("visitors").update(row).eq("id", v.id).select("*").single()
        : await sb.from("visitors").insert({ ...row, org_id: team.org_id, team_id: teamId, created_by: state.user.id }).select("*").single();
      busy(btn, false);
      if (r.error) return toast(errMsg(r.error), "err");
      rows = v ? rows.map((x) => (x.id === v.id ? r.data : x)) : [r.data, ...rows]; s.close(); draw(); toast(v ? "Salvo" : "Visitante registrado");
    };
  }
  function detail(v) {
    const s = sheet(`<h3>${esc(v.name)}</h3><p class="small muted" style="margin-top:-6px">${esc(rel(v.visited_on))}${v.first_time ? " · primeira visita" : ""}${v.how_known ? ` · ${esc(v.how_known)}` : ""}${v.created_by ? ` · registrado por ${esc(personName(ppl, v.created_by))}` : ""}</p>
      ${v.phone ? `<div class="card"><b>${esc(v.phone)}</b>${phoneRow(v.phone)}</div>` : ""}
      ${v.notes ? `<div class="card mt-s"><p style="margin:0;white-space:pre-wrap">${esc(v.notes)}</p></div>` : ""}
      <p class="small muted mt">Acompanhamento</p>
      <div class="row gap-s" style="flex-wrap:wrap">${Object.entries(STATUS).map(([k, [l]]) => `<button class="chip ${v.status === k ? "on" : ""}" data-st="${k}">${l}</button>`).join("")}</div>
      <div class="row gap mt"><button class="btn ghost grow" id="ved">${icon("edit")} Editar</button>${manage ? `<button class="btn danger" id="vdel" aria-label="Excluir">${icon("trash")}</button>` : ""}</div>`, { wide: true });
    on(s.el, "click", "[data-st]", async (e, b) => {
      const r = await sb.from("visitors").update({ status: b.dataset.st }).eq("id", v.id);
      if (r.error) return toast(errMsg(r.error), "err");
      v.status = b.dataset.st; s.close(); draw();
    });
    s.el.querySelector("#ved").onclick = () => { s.close(); form(v); };
    s.el.querySelector("#vdel")?.addEventListener("click", async () => {
      if (!(await confirmDialog("Excluir este visitante?", "Excluir", true))) return;
      const r = await sb.from("visitors").delete().eq("id", v.id);
      if (r.error) return toast(errMsg(r.error), "err");
      rows = rows.filter((x) => x.id !== v.id); s.close(); draw();
    });
  }
  on(el, "click", "#addv", () => form(null));
  on(el, "click", "[data-f]", (e, b) => { filter = b.dataset.f; draw(); });
  on(el, "click", "[data-v]", (e, b) => detail(rows.find((x) => x.id === b.dataset.v)));
  on(el, "input", "#vq", (e, i) => { q = i.value; const pos = i.selectionStart; draw(); const n = el.querySelector("#vq"); n.focus(); n.setSelectionRange(pos, pos); });
}
