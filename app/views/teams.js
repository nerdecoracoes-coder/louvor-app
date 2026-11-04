// Times: lista, criação, página do time (Escalas, Integrantes, Arquivos, Avisos), configurações e integrantes.
import { sb, state, must, esc, attr, icon, avatar, teamBadge, people, personName, invalidatePeople, isAdmin, canManageTeam, sheet, toast, errMsg, busy,
  on, go, empty, spinner, fDate, uploadPublic, pickFile, confirmDialog, applyAccent, waLink, roleIcon, selectOrg, linkify, safeUrl } from "../core.js";
import { schedRow } from "./home.js";
import { noticeForm } from "./home.js";

export function register(route) {
  route("/times", teamsList);
  route("/times/novo", newTeam);
  route("/convidar", inviteChooser);
  route("/times/:id", (p, el, a) => teamView(p.id, "escalas", el, a));
  route("/times/:id/config", (p, el) => teamSettings(p.id, el));
  route("/times/:id/aviso", (p, el) => noticeForm(el, p.id));
  route("/times/:id/:tab", (p, el, a) => teamView(p.id, p.tab, el, a));
}

const COLORS = ["#1EA7FF", "#7C5CFF", "#22D3EE", "#34D399", "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#A3E635", "#E5E7EB"];
export const colorPicker = (name, value) => `<div class="colors">${COLORS.map((c) => `<label style="background:${c}"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === (value || "").toLowerCase() ? "checked" : ""}><i></i></label>`).join("")}
  <label title="Outra cor" style="box-shadow:none"><input type="color" name="${name}_custom" value="${attr(COLORS.includes(value) ? "#1EA7FF" : value || "#1EA7FF")}"></label></div>`;
export const readColor = (form, name) => {
  const checked = form.querySelector(`input[name=${name}]:checked`)?.value;
  const custom = form.querySelector(`input[name=${name}_custom]`);
  return custom?.dataset.touched ? custom.value : checked || custom?.value || "#1EA7FF";
};
export const bindColor = (form, name) => {
  const custom = form.querySelector(`input[name=${name}_custom]`);
  custom?.addEventListener("input", () => { custom.dataset.touched = "1"; form.querySelectorAll(`input[name=${name}]`).forEach((r) => (r.checked = false)); });
  form.querySelectorAll(`input[name=${name}]`).forEach((r) => r.addEventListener("change", () => delete custom.dataset.touched));
};

async function teamsList(_, el, alive) {
  el.innerHTML = spinner();
  const all = await must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name"));
  const counts = await must(sb.from("team_members").select("team_id").eq("org_id", state.org.id));
  if (!alive()) return;
  const cnt = (id) => counts.filter((c) => c.team_id === id).length;
  const mine = new Set(state.myTeams.map((t) => t.id));
  const visible = isAdmin() ? all : all.filter((t) => mine.has(t.id));
  const others = isAdmin() ? [] : [];
  el.innerHTML = `<div class="pagehead"><h1>Times</h1>${isAdmin() ? `<a class="btn primary sm" href="#/times/novo">${icon("plus")} Novo time</a>` : ""}</div>
    <p class="muted small">${isAdmin() ? "Como administrador geral, você vê todos os times da organização." : "Times dos quais você participa."}</p>
    ${visible.length ? `<div class="grid mt">${visible.map((t) => `<div class="teamcard" style="--tc:${attr(t.accent_color || "var(--accent)")}">
      <a href="#/times/${t.id}" class="row gap grow" style="color:inherit;min-width:0">${teamBadge(t, 52)}<span class="grow" style="min-width:0"><h3 class="ellipsis">${esc(t.name)}</h3>
        <span class="small muted">${cnt(t.id)} integrante${cnt(t.id) === 1 ? "" : "s"}${state.leaderOf.has(t.id) ? " · você é líder" : mine.has(t.id) ? "" : " · você não participa"}</span></span></a>
      ${mine.has(t.id) ? `<a class="iconbtn" href="#/chat/${t.id}" aria-label="Chat do time">${icon("chat")}</a>` : ""}
      <button class="iconbtn" data-menu="${t.id}" aria-label="Opções">${icon("more")}</button></div>`).join("")}</div>`
      : `<div class="card mt">${empty("users", "Você ainda não está em nenhum time", "Peça ao líder um link de convite.")}</div>`}`;
  void others;
  on(el, "click", "[data-menu]", (e, b) => {
    const t = all.find((x) => x.id === b.dataset.menu);
    const m = mine.has(t.id);
    const s = sheet(`<div class="row gap mb">${teamBadge(t, 44)}<h3 style="margin:0">${esc(t.name)}</h3></div><div class="list menu">
      <a class="li" href="#/times/${t.id}">${icon("users")}<span class="grow t">Abrir time</span></a>
      ${m ? `<a class="li" href="#/chat/${t.id}">${icon("chat")}<span class="grow t">Chat do time</span></a>` : ""}
      <a class="li" href="#/calendario/time:${t.id}">${icon("calendar")}<span class="grow t">Calendário do time</span></a>
      ${canManageTeam(t.id) ? `<button class="li" data-inv>${icon("link")}<span class="grow t">Convidar integrante</span></button><a class="li" href="#/times/${t.id}/config">${icon("settings")}<span class="grow t">Configurações</span></a>` : ""}
      ${m ? `<button class="li danger" data-leave>${icon("logout")}<span class="grow t">Sair do time</span></button>` : ""}</div>`);
    s.el.addEventListener("click", async (ev) => {
      if (ev.target.closest("a")) s.close();
      if (ev.target.closest("[data-inv]")) { s.close(); inviteSheet(t); }
      if (ev.target.closest("[data-leave]")) {
        if (!(await confirmDialog(`Sair do time ${t.name}?`, "Sair", true))) return;
        const r = await sb.from("team_members").delete().eq("team_id", t.id).eq("user_id", state.user.id);
        if (r.error) return toast(errMsg(r.error), "err");
        s.close(); await selectOrg(state.org.id, false); toast("Você saiu do time"); go("/times");
      }
    });
  });
}

async function newTeam(_, el) {
  if (!isAdmin()) { el.innerHTML = empty("lock", "Somente administradores gerais criam times."); return; }
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times">${icon("chevronLeft")}</a><h1>Novo time</h1></div>
    <form class="card" id="f"><label class="field"><span>Nome do time *</span><input name="name" required maxlength="120" placeholder="Ex.: Louvor Domingo"></label>
    <label class="field"><span>Descrição</span><input name="description" maxlength="200"></label>
    <div class="field"><span>Cor de destaque</span>${colorPicker("color", "#1EA7FF")}</div>
    <button class="btn primary block" id="save">Criar time</button></form>`;
  const form = el.querySelector("#f"); bindColor(form, "color");
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    const { data, error } = await sb.from("teams").insert({ org_id: state.org.id, name: form.name.value.trim(), description: form.description.value || null, accent_color: readColor(form, "color"), created_by: state.user.id }).select("*").single();
    busy(btn, false);
    if (error) return toast(errMsg(error), "err");
    // quem cria o time entra nele como líder (pode sair depois, se não for participar)
    const tm = await sb.from("team_members").insert({ team_id: data.id, user_id: state.user.id, org_id: state.org.id, is_leader: true });
    if (tm.error) toast(errMsg(tm.error), "err");
    await selectOrg(state.org.id, false);
    toast("Time criado. Você entrou como líder."); go(`/times/${data.id}/integrantes`);
  };
}

async function inviteChooser(_, el) {
  const teams = isAdmin() ? await must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name")) : state.myTeams.filter((t) => canManageTeam(t.id));
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Convidar integrante</h1></div><p class="muted small">Escolha o time do convite.</p>
    <div class="list mt">${teams.map((t) => `<button class="li" data-t="${t.id}">${teamBadge(t, 40)}<span class="grow t">${esc(t.name)}</span>${icon("chevronRight", "chev")}</button>`).join("") || `<div class="li muted">Você não gerencia nenhum time.</div>`}</div>`;
  on(el, "click", "[data-t]", (e, b) => inviteSheet(teams.find((t) => t.id === b.dataset.t)));
}

export async function inviteSheet(team) {
  const s = sheet(`<h3>Convidar para ${esc(team.name)}</h3>${spinner()}`);
  const r = await sb.rpc("create_team_invite", { p_team: team.id });
  if (r.error) { s.close(); return toast(errMsg(r.error), "err"); }
  const link = `${location.origin}${location.pathname}#/convite/${r.data}`;
  const text = `Você foi convidado(a) para o time ${team.name} (${state.org.name}). Entre pelo link: ${link}`;
  s.el.innerHTML = `<div class="grab"></div><h3>Convidar para ${esc(team.name)}</h3>
    <p class="small muted">Quem abrir este link cria a conta (ou faz login) e entra no time como integrante. O link vale por 30 dias.</p>
    <label class="field"><span>Link exclusivo</span><input class="input" readonly value="${attr(link)}" id="lnk"></label>
    <div class="two"><button class="btn ghost" id="cp">${icon("copy")} Copiar link</button>
      <a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon("whatsapp")} WhatsApp</a></div>
    ${navigator.share ? `<button class="btn ghost block mt" id="sh">${icon("share")} Compartilhar</button>` : ""}`;
  s.el.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Link copiado"); } catch { s.el.querySelector("#lnk").select(); document.execCommand("copy"); toast("Link copiado"); } };
  s.el.querySelector("#sh")?.addEventListener("click", () => navigator.share({ title: team.name, text, url: link }).catch(() => {}));
}

// ---------------------------------------------------------------- página do time
async function teamView(id, tab, el, alive) {
  el.innerHTML = spinner();
  const team = await must(sb.from("teams").select("*").eq("id", id).maybeSingle());
  if (!team || team.org_id !== state.org.id) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const members = await must(sb.from("team_members").select("*").eq("team_id", id));
  if (!alive()) return;
  const manage = canManageTeam(id);
  const isMember = members.some((m) => m.user_id === state.user.id);
  if (team.apply_theme && team.accent_color) applyAccent(document.documentElement, team.accent_color);
  const tabs = [["escalas", "Escalas", "calendar"], ["integrantes", "Integrantes", "users"], ["arquivos", "Arquivos", "file"], ["avisos", "Avisos", "megaphone"]];
  if (!tabs.some((t) => t[0] === tab)) tab = "escalas";
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times">${icon("chevronLeft")}</a>${teamBadge(team, 52)}
      <div class="grow" style="min-width:0"><h1 class="ellipsis" style="font-size:22px">${esc(team.name)}</h1><span class="small muted">${members.length} integrante${members.length === 1 ? "" : "s"}</span></div>
      ${isMember ? `<a class="iconbtn" href="#/chat/${id}" aria-label="Chat">${icon("chat")}</a>` : ""}${manage ? `<a class="iconbtn" href="#/times/${id}/config" aria-label="Configurações">${icon("settings")}</a>` : ""}</div>
    <div class="tabs">${tabs.map(([k, l, ic]) => `<a href="#/times/${id}/${k}" class="${tab === k ? "on" : ""}">${icon(ic)}${l}</a>`).join("")}</div>
    <div id="tab"></div>`;
  const box = el.querySelector("#tab");
  if (tab === "escalas") return schedulesTab(team, box, manage);
  if (tab === "integrantes") return membersTab(team, members, box, manage);
  if (tab === "arquivos") return filesTab(team, box, manage);
  if (tab === "avisos") return noticesTab(team, box, manage);
}

async function schedulesTab(team, box, manage) {
  const now = new Date(Date.now() - 3 * 3600e3).toISOString();
  const [up, past] = await Promise.all([
    must(sb.from("schedules").select("*").eq("team_id", team.id).gte("starts_at", now).order("starts_at").limit(50)),
    must(sb.from("schedules").select("*").eq("team_id", team.id).lt("starts_at", now).order("starts_at", { ascending: false }).limit(30)),
  ]);
  box.innerHTML = `<div class="row gap wrap mb">${manage ? `<a class="btn primary sm" href="#/escala/nova/${team.id}">${icon("plus")} Nova escala</a>` : ""}<a class="btn ghost sm" href="#/calendario/time:${team.id}">${icon("calendar")} Calendário do time</a></div>
    ${up.length ? up.map((s) => schedRow(s, { showTeam: false })).join("") : `<div class="card">${empty("calendar", "Nenhuma escala futura")}</div>`}
    ${past.length ? `<div class="sec"><h2>Escalas anteriores</h2></div>${past.map((s) => schedRow(s, { showTeam: false })).join("")}` : ""}`;
}

async function membersTab(team, members, box, manage) {
  const [ppl, roles, tmr] = await Promise.all([
    people(true),
    must(sb.from("music_roles").select("*").eq("org_id", state.org.id).order("sort")),
    must(sb.from("team_member_roles").select("*").eq("team_id", team.id)),
  ]);
  const rolesOf = (uid) => tmr.filter((r) => r.user_id === uid).map((r) => roles.find((x) => x.id === r.role_id)?.name).filter(Boolean);
  let q = "", roleFilter = "";
  const draw = () => {
    const list = members.map((m) => ({ ...m, p: ppl.get(m.user_id) })).filter((m) => m.p)
      .filter((m) => !q || m.p.display_name.toLowerCase().includes(q))
      .filter((m) => !roleFilter || tmr.some((r) => r.user_id === m.user_id && r.role_id === roleFilter))
      .sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || a.p.display_name.localeCompare(b.p.display_name));
    box.querySelector("#mlist").innerHTML = list.map((m) => `<div class="li">${avatar(m.p, 44, m.is_leader)}
      <span class="grow" style="min-width:0"><span class="t row gap-s">${esc(m.p.display_name)}${m.is_leader ? `<span class="tag soft">Líder</span>` : ""}${m.p.role === "admin" ? `<span class="tag gray">Admin</span>` : ""}</span>
      <span class="s">${rolesOf(m.user_id).map(esc).join(" · ") || "Sem função definida"}</span></span>
      <button class="iconbtn" data-mm="${m.user_id}" aria-label="Opções">${icon("more")}</button></div>`).join("") || `<div class="li muted">Ninguém encontrado.</div>`;
  };
  box.innerHTML = `${manage ? `<div class="row gap wrap mb"><button class="btn primary sm" id="inv">${icon("link")} Convidar</button><button class="btn ghost sm" id="add">${icon("plus")} Adicionar da organização</button></div>` : ""}
    <div class="row gap mb"><label class="search grow">${icon("search")}<input class="input" id="q" placeholder="Pesquisar integrante"></label></div>
    <div class="chips mb"><button class="chip on" data-rf="">Todas as funções</button>${roles.map((r) => `<button class="chip" data-rf="${r.id}">${esc(r.name)}</button>`).join("")}</div>
    <div class="list" id="mlist"></div>`;
  draw();
  box.querySelector("#q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  on(box, "click", "[data-rf]", (e, b) => { roleFilter = b.dataset.rf; box.querySelectorAll("[data-rf]").forEach((c) => c.classList.toggle("on", c === b)); draw(); });
  box.querySelector("#inv")?.addEventListener("click", () => inviteSheet(team));
  box.querySelector("#add")?.addEventListener("click", () => addExisting(team, members, ppl));
  on(box, "click", "[data-mm]", (e, b) => memberMenu(team, members.find((m) => m.user_id === b.dataset.mm), ppl, roles, tmr, manage));
}

function addExisting(team, members, ppl) {
  const inTeam = new Set(members.map((m) => m.user_id));
  const cands = [...ppl.values()].filter((p) => !inTeam.has(p.id)).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const sel = new Set();
  const s = sheet(`<h3>Adicionar ao ${esc(team.name)}</h3><p class="small muted">Pessoas que já fazem parte da organização. Selecione uma ou várias.</p>
    <label class="search mb" style="display:block">${icon("search")}<input class="input" id="q" placeholder="Pesquisar"></label>
    <div class="list" id="cl" style="max-height:50vh;overflow:auto">${cands.map((p) => `<button class="li" data-u="${p.id}" data-n="${attr(p.display_name.toLowerCase())}">${avatar(p, 38, false)}<span class="grow t">${esc(p.display_name)}</span><span class="selbox">${icon("check")}</span></button>`).join("") || `<div class="li muted">Todos da organização já estão neste time.</div>`}</div>
    <button class="btn primary block mt" id="go" disabled>Adicionar</button>`);
  s.el.querySelector("#q").oninput = (e) => { const v = e.target.value.toLowerCase(); s.el.querySelectorAll("[data-u]").forEach((b) => b.classList.toggle("hidden", !b.dataset.n.includes(v))); };
  on(s.el, "click", "[data-u]", (e, b) => {
    const id = b.dataset.u; sel.has(id) ? sel.delete(id) : sel.add(id);
    b.querySelector(".selbox").classList.toggle("on", sel.has(id));
    const g = s.el.querySelector("#go"); g.disabled = !sel.size; g.textContent = sel.size ? `Adicionar ${sel.size}` : "Adicionar";
  });
  s.el.querySelector("#go").onclick = async (e) => {
    busy(e.target);
    const r = await sb.rpc("add_team_members", { p_team: team.id, p_users: [...sel] });
    if (r.error) { busy(e.target, false); return toast(errMsg(r.error), "err"); }
    s.close(); toast(`${r.data} pessoa(s) adicionada(s)`); go(`/times/${team.id}/integrantes`);
  };
}

function memberMenu(team, m, ppl, roles, tmr, manage) {
  const p = ppl.get(m.user_id);
  const wa = waLink(p.phone, `Olá ${p.display_name.split(" ")[0]}!`);
  const me = m.user_id === state.user.id;
  const s = sheet(`<div class="row gap mb">${avatar(p, 52)}<div><h3 style="margin:0">${esc(p.display_name)}</h3><span class="small muted">${m.is_leader ? "Líder do time" : "Integrante"}</span></div></div>
    <div class="list menu">
      ${wa ? `<a class="li" href="${wa}" target="_blank" rel="noopener">${icon("whatsapp")}<span class="grow t">Chamar no WhatsApp</span></a>` : `<div class="li muted small">${icon("whatsapp")}<span class="grow">Sem telefone cadastrado</span></div>`}
      ${manage ? `<button class="li" data-a="edit">${icon("edit")}<span class="grow t">Editar integrante</span></button>
        <button class="li" data-a="leader">${icon("crown")}<span class="grow t">${m.is_leader ? "Remover liderança" : "Tornar líder do time"}</span></button>
        <button class="li" data-a="copy">${icon("swap")}<span class="grow t">Mover ou copiar para outro time</span></button>
        <button class="li danger" data-a="remove">${icon("trash")}<span class="grow t">Remover do time</span></button>` : ""}
      ${me && !manage ? `<button class="li danger" data-a="remove">${icon("logout")}<span class="grow t">Sair do time</span></button>` : ""}
    </div>`);
  s.el.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "edit") { s.close(); editMember(team, m, p, roles, tmr, ppl); }
    if (a === "leader") {
      const r = await sb.from("team_members").update({ is_leader: !m.is_leader }).eq("team_id", team.id).eq("user_id", m.user_id);
      if (r.error) return toast(errMsg(r.error), "err");
      s.close(); toast(m.is_leader ? "Liderança removida" : `${p.display_name} agora é líder`); await selectOrg(state.org.id, false); go(`/times/${team.id}/integrantes`);
    }
    if (a === "copy") { s.close(); copyMember(team, m, p); }
    if (a === "remove") {
      if (!(await confirmDialog(me ? "Sair deste time?" : `Remover ${p.display_name} do time? A conta da pessoa continua existindo.`, "Remover", true))) return;
      const r = await sb.from("team_members").delete().eq("team_id", team.id).eq("user_id", m.user_id);
      if (r.error) return toast(errMsg(r.error), "err");
      s.close(); toast("Removido do time"); if (me) await selectOrg(state.org.id, false); go(`/times/${team.id}/integrantes`);
    }
  });
}

async function copyMember(team, m, p) {
  const teams = (isAdmin() ? await must(sb.from("teams").select("*").eq("org_id", state.org.id).order("name")) : state.myTeams).filter((t) => t.id !== team.id && canManageTeam(t.id));
  const s = sheet(`<h3>${esc(p.display_name)}</h3><p class="small muted">Escolha o time de destino. As funções musicais vão junto.</p>
    <label class="field"><span>Time</span><select class="input" id="to">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>
    <div class="two"><button class="btn ghost" data-mv="0">${icon("copy")} Copiar</button><button class="btn primary" data-mv="1">${icon("swap")} Mover</button></div>`);
  if (!teams.length) s.el.querySelector(".two").outerHTML = `<p class="muted">Você não gerencia outros times.</p>`;
  on(s.el, "click", "[data-mv]", async (e, b) => {
    const move = b.dataset.mv === "1"; busy(b);
    const r = await sb.rpc("copy_team_member", { p_from: team.id, p_to: s.el.querySelector("#to").value, p_user: m.user_id, p_move: move });
    busy(b, false);
    if (r.error) return toast(errMsg(r.error), "err");
    s.close(); toast(move ? "Integrante movido" : "Integrante copiado"); go(`/times/${team.id}/integrantes`);
  });
}

async function editMember(team, m, p, roles, tmr, ppl) {
  const om = await must(sb.from("org_members").select("*").eq("org_id", state.org.id).eq("user_id", m.user_id).maybeSingle());
  const myRoles = new Set(tmr.filter((r) => r.user_id === m.user_id).map((r) => r.role_id));
  const others = [...ppl.values()].filter((x) => x.id !== m.user_id).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const s = sheet(`<h3>Editar integrante</h3><form id="f">
    <label class="field"><span>Nome utilizado na organização</span><input name="display_name" value="${attr(om?.display_name || "")}" placeholder="${attr(p.full_name)}" ${isAdmin() ? "" : "disabled"}></label>
    <div class="field"><span>Funções musicais</span><div class="chips wrap" style="flex-wrap:wrap">${roles.map((r) => `<label class="chip ${myRoles.has(r.id) ? "on" : ""}"><input type="checkbox" class="sr" name="role" value="${r.id}" ${myRoles.has(r.id) ? "checked" : ""}>${icon(roleIcon(r.name))}${esc(r.name)}</label>`).join("")}
      <button type="button" class="chip" id="newrole">${icon("plus")} Nova função</button></div></div>
    <div class="field"><span>Nível de acesso no time</span><select name="leader"><option value="0" ${m.is_leader ? "" : "selected"}>Integrante</option><option value="1" ${m.is_leader ? "selected" : ""}>Líder do time</option></select>
      ${isAdmin() ? `<label class="check"><input type="checkbox" name="admin" ${om?.role === "admin" ? "checked" : ""}> Administrador geral da organização</label>` : ""}</div>
    <div class="two"><label class="field"><span>Data de nascimento</span><input type="date" name="birth_date" value="${attr(om?.birth_date || p.birth_date || "")}" ${isAdmin() ? "" : "disabled"}></label>
      <label class="field"><span>Limite de escalas por mês</span><input type="number" min="0" max="62" name="monthly_limit" value="${m.monthly_limit ?? ""}" placeholder="Sem limite"></label></div>
    <div class="field"><span>Evitar escalar junto com</span><div class="hint" style="margin:0 0 8px">Preferência usada na sugestão automática. Não impede a escala manual.</div>
      <div style="max-height:180px;overflow:auto" class="list">${others.map((o) => `<label class="li check" style="min-height:44px"><input type="checkbox" name="avoid" value="${o.id}" ${(m.avoid_with || []).includes(o.id) ? "checked" : ""}>${esc(o.display_name)}</label>`).join("")}</div></div>
    <button class="btn primary block" id="save">Salvar</button></form>`);
  const form = s.el.querySelector("#f");
  form.addEventListener("change", (e) => { if (e.target.name === "role") e.target.closest(".chip").classList.toggle("on", e.target.checked); });
  s.el.querySelector("#newrole").onclick = async () => {
    const name = prompt("Nome da nova função musical");
    if (!name?.trim()) return;
    const { data, error } = await sb.from("music_roles").insert({ org_id: state.org.id, name: name.trim(), sort: roles.length + 1 }).select("*").single();
    if (error) return toast(errMsg(error), "err");
    roles.push(data);
    s.el.querySelector("#newrole").insertAdjacentHTML("beforebegin", `<label class="chip on"><input type="checkbox" class="sr" name="role" value="${data.id}" checked>${icon(roleIcon(data.name))}${esc(data.name)}</label>`);
  };
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = s.el.querySelector("#save"); busy(btn);
    try {
      const fd = new FormData(form);
      const roleIds = fd.getAll("role");
      const ops = [
        sb.rpc("set_member_roles", { p_team: team.id, p_user: m.user_id, p_roles: roleIds }),
        sb.from("team_members").update({ is_leader: fd.get("leader") === "1", monthly_limit: fd.get("monthly_limit") ? Number(fd.get("monthly_limit")) : null, avoid_with: fd.getAll("avoid") }).eq("team_id", team.id).eq("user_id", m.user_id),
      ];
      if (isAdmin()) {
        ops.push(sb.from("org_members").update({ display_name: fd.get("display_name")?.trim() || null, birth_date: fd.get("birth_date") || null }).eq("org_id", state.org.id).eq("user_id", m.user_id));
        const wantAdmin = !!fd.get("admin");
        if (wantAdmin !== (om?.role === "admin")) ops.push(sb.rpc("set_org_admin", { p_org: state.org.id, p_user: m.user_id, p_admin: wantAdmin }));
      }
      for (const r of await Promise.all(ops)) if (r.error) throw r.error;
      invalidatePeople(); await selectOrg(state.org.id, false);
      s.close(); toast("Integrante atualizado"); go(`/times/${team.id}/integrantes`);
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  };
}

async function filesTab(team, box, manage) {
  const files = await must(sb.from("team_files").select("*").eq("team_id", team.id).order("created_at", { ascending: false }));
  box.innerHTML = `${manage ? `<div class="row gap wrap mb"><button class="btn primary sm" id="up">${icon("clip")} Enviar arquivo</button><button class="btn ghost sm" id="lnk">${icon("link")} Adicionar link</button></div>` : ""}
    ${files.length ? `<div class="list">${files.map((f) => `<div class="li"><span class="cover" style="width:44px;height:44px">${icon(f.url ? "link" : f.mime?.startsWith("image/") ? "image" : "file")}</span>
      <button class="grow" style="text-align:left;min-width:0" data-open="${f.id}"><span class="t ellipsis" style="display:block">${esc(f.name)}</span><span class="s">${f.size ? (f.size / 1048576).toFixed(1) + " MB · " : ""}${fDate(f.created_at)}</span></button>
      ${manage || f.uploaded_by === state.user.id ? `<button class="iconbtn" data-del="${f.id}">${icon("trash")}</button>` : ""}</div>`).join("")}</div>`
      : `<div class="card">${empty("file", "Nenhum arquivo compartilhado", "Documentos, partituras e materiais do time aparecem aqui.")}</div>`}`;
  box.querySelector("#up")?.addEventListener("click", async () => {
    const file = await pickFile("*/*"); if (!file) return;
    if (file.size > 50 * 1048576) return toast("Arquivo maior que 50 MB.", "err");
    toast("Enviando…");
    const path = `files/${state.org.id}/${team.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await sb.storage.from("private").upload(path, file);
    if (up.error) return toast(errMsg(up.error), "err");
    const r = await sb.from("team_files").insert({ org_id: state.org.id, team_id: team.id, name: file.name, storage_path: path, size: file.size, mime: file.type, uploaded_by: state.user.id });
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Arquivo enviado"); filesTab(team, box, manage);
  });
  box.querySelector("#lnk")?.addEventListener("click", () => {
    const s = sheet(`<h3>Adicionar link</h3><form id="lf"><label class="field"><span>Nome</span><input name="name" required></label><label class="field"><span>Endereço</span><input name="url" type="url" required placeholder="https://"></label><button class="btn primary block">Adicionar</button></form>`);
    s.el.querySelector("#lf").onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      if (!safeUrl(f.url)) return toast("Endereço inválido", "err");
      const r = await sb.from("team_files").insert({ org_id: state.org.id, team_id: team.id, name: f.name, url: f.url, uploaded_by: state.user.id });
      if (r.error) return toast(errMsg(r.error), "err");
      s.close(); filesTab(team, box, manage);
    };
  });
  on(box, "click", "[data-open]", async (e, b) => {
    const f = files.find((x) => x.id === b.dataset.open);
    if (f.url) return window.open(f.url, "_blank", "noopener");
    const r = await sb.storage.from("private").signedUrl(f.storage_path, 600);
    if (r.error) return toast(errMsg(r.error), "err");
    window.open(r.data.url, "_blank", "noopener");
  });
  on(box, "click", "[data-del]", async (e, b) => {
    if (!(await confirmDialog("Excluir este arquivo?", "Excluir", true))) return;
    const f = files.find((x) => x.id === b.dataset.del);
    if (f.storage_path) await sb.storage.from("private").remove([f.storage_path]);
    const r = await sb.from("team_files").delete().eq("id", f.id);
    if (r.error) return toast(errMsg(r.error), "err");
    filesTab(team, box, manage);
  });
}

async function noticesTab(team, box, manage) {
  const [rows, ppl] = await Promise.all([must(sb.from("announcements").select("*").eq("team_id", team.id).order("created_at", { ascending: false })), people()]);
  box.innerHTML = `${manage ? `<a class="btn primary sm mb" href="#/times/${team.id}/aviso">${icon("plus")} Novo aviso do time</a>` : ""}
    ${rows.length ? rows.map((n) => `<div class="card" style="margin:12px 0">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ""}<h3 style="margin:6px 0">${esc(n.title)}</h3>
      ${n.body ? `<p style="margin:0">${linkify(n.body)}</p>` : ""}${safeUrl(n.link_url) ? `<a class="link small" href="${attr(n.link_url)}" target="_blank" rel="noopener">${icon("link")} Abrir link</a>` : ""}
      <div class="row between mt-s"><span class="tiny muted">${esc(personName(ppl, n.created_by))} · ${fDate(n.created_at)}</span>
      ${manage || n.created_by === state.user.id ? `<button class="iconbtn" data-del="${n.id}">${icon("trash")}</button>` : ""}</div></div>`).join("")
      : `<div class="card">${empty("megaphone", "Nenhum aviso do time")}</div>`}`;
  on(box, "click", "[data-del]", async (e, b) => {
    if (!(await confirmDialog("Excluir este aviso?", "Excluir", true))) return;
    await sb.from("announcements").delete().eq("id", b.dataset.del); noticesTab(team, box, manage);
  });
}

async function teamSettings(id, el) {
  const team = await must(sb.from("teams").select("*").eq("id", id).maybeSingle());
  if (!team || !canManageTeam(id)) { el.innerHTML = empty("lock", "Você não pode alterar este time."); return; }
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${id}">${icon("chevronLeft")}</a><h1>Configurações do time</h1></div>
  <form class="card" id="f">
    <div class="row gap mb"><span id="logo">${teamBadge(team, 72)}</span><div class="col gap-s"><button type="button" class="btn ghost sm" id="up">${icon("image")} Trocar logotipo</button>${team.logo_url ? `<button type="button" class="link small" id="rm" style="text-align:left">Remover</button>` : ""}</div></div>
    <label class="field"><span>Nome</span><input name="name" value="${attr(team.name)}" required maxlength="120"></label>
    <label class="field"><span>Descrição</span><input name="description" value="${attr(team.description || "")}" maxlength="200"></label>
    <div class="field"><span>Cor de destaque do time</span>${colorPicker("color", team.accent_color || "#1EA7FF")}</div>
    <label class="li" style="padding:12px 0;border:0"><span class="grow"><span class="t">Aplicar a cor nas telas do time</span><span class="s">Desligado: a cor aparece só no logotipo e nas identificações, mantendo o visual principal do app.</span></span>
      <span class="switch"><input type="checkbox" name="apply_theme" ${team.apply_theme ? "checked" : ""}><i></i></span></label>
    <button class="btn primary block mt" id="save">Salvar</button>
  </form>
  ${isAdmin() ? `<div class="card mt"><h3 class="danger-t" style="font-size:16px">Excluir time</h3><p class="small muted">Remove o time, suas escalas, chat e arquivos. As contas dos integrantes continuam existindo.</p><button class="btn danger sm" id="del">${icon("trash")} Excluir time</button></div>` : ""}`;
  const form = el.querySelector("#f"); bindColor(form, "color");
  let logo = team.logo_url;
  el.querySelector("#up").onclick = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    try { logo = await uploadPublic(`teams/${state.org.id}/${id}`, f); el.querySelector("#logo").innerHTML = teamBadge({ ...team, logo_url: logo }, 72); }
    catch (e) { toast(errMsg(e), "err"); }
  };
  el.querySelector("#rm")?.addEventListener("click", () => { logo = null; el.querySelector("#logo").innerHTML = teamBadge({ ...team, logo_url: null }, 72); });
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    const r = await sb.from("teams").update({ name: form.name.value.trim(), description: form.description.value || null, accent_color: readColor(form, "color"), apply_theme: form.apply_theme.checked, logo_url: logo }).eq("id", id);
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), "err");
    await selectOrg(state.org.id, false); toast("Time atualizado"); go(`/times/${id}`);
  };
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Excluir o time ${team.name}? Esta ação não pode ser desfeita.`, "Excluir", true))) return;
    const r = await sb.from("teams").delete().eq("id", id);
    if (r.error) return toast(errMsg(r.error), "err");
    await selectOrg(state.org.id, false); toast("Time excluído"); go("/times");
  });
}
