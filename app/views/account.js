// Conta, convites, primeira organização, perfil, notificações e configurações da organização (incluindo Google Drive).
import { sb, state, must, esc, attr, icon, avatar, teamBadge, isAdmin, sheet, toast, errMsg, busy, on, go, empty, spinner, fDate, fRel,
  uploadPublic, pickFile, confirmDialog, selectOrg, people, invalidatePeople, applyOrgTheme, roleIcon, TEAM_TYPES } from "../core.js";
import { colorPicker, readColor, bindColor } from "./teams.js";

export function register(route) {
  route("/convite/:token", (p, el) => inviteView(p.token), { public: true, noOrg: true });
  route("/nova-org", () => newOrgView(), { noOrg: true });
  route("/nova-senha", () => newPasswordView(), { noOrg: true });
  route("/perfil", profileView);
  route("/notificacoes", notificationsView);
  route("/org", orgSettings);
  route("/org/drive", driveSettings);
}

const logo = () => `<div class="logo"><span class="tbadge" style="--s:56px;border-radius:18px">${icon("music")}</span></div>`;
const root = () => document.getElementById("app");
const authShell = (inner) => `<div class="backdrop"><svg class="w2" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 280 C 420 270, 760 210, 1200 40" stroke="rgba(30,167,255,.45)" stroke-width="2" fill="none"/><path d="M0 300 C 440 290, 800 240, 1200 90" stroke="rgba(30,167,255,.25)" stroke-width="1" fill="none"/></svg></div><div class="auth"><div class="box">${inner}</div></div>`;

export function notConfigured() {
  return authShell(`${logo()}<h1>Quase lá</h1><p class="sub">Falta informar o endereço e a chave pública do Supabase no arquivo <b>config.js</b>. Veja o passo a passo no README do repositório.</p>`);
}

// ---------------------------------------------------------------- login / cadastro
export function authView(el, path, invite = null) {
  let mode = "login";
  const draw = () => {
    el.innerHTML = authShell(`${logo()}
      ${invite ? `<div class="invitecard">${teamBadge(invite.team || invite.org, 52)}<div><span class="tiny muted">${invite.team ? "Convite para o time" : "Convite para ser membro da igreja"}</span><b style="display:block;font-size:17px">${esc((invite.team || invite.org).name)}</b>${invite.team ? `<span class="small muted">${esc(invite.org.name)}</span>` : ""}</div></div>` : ""}
      <h1>${mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Recuperar senha"}</h1>
      <p class="sub">${mode === "login" ? "Gestão de escalas, times e repertório do ministério." : mode === "signup" ? "O cadastro é gratuito. Para entrar em um time, você precisa de um convite." : "Enviaremos um link para criar uma nova senha."}</p>
      <form id="af">
        ${mode === "signup" ? `<label class="field"><span>Nome completo</span><input name="name" required autocomplete="name" maxlength="100"></label>` : ""}
        <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="email"></label>
        ${mode !== "forgot" ? `<label class="field"><span>Senha</span><input name="password" type="password" required minlength="6" autocomplete="${mode === "login" ? "current-password" : "new-password"}"></label>` : ""}
        ${mode === "signup" ? `<label class="field"><span>WhatsApp (opcional)</span><input name="phone" type="tel" autocomplete="tel" placeholder="(21) 99999-9999"></label>` : ""}
        <button class="btn primary block" id="go">${mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}</button>
      </form>
      <div class="center mt small">${mode === "login" ? `Não tem conta? <button class="link" data-m="signup">Criar conta</button><br><button class="link mt-s" data-m="forgot">Esqueci minha senha</button>`
        : `Já tem conta? <button class="link" data-m="login">Entrar</button>`}</div>`);
    el.querySelector("#af").onsubmit = submit;
    on(el, "click", "[data-m]", (e, b) => { mode = b.dataset.m; draw(); });
  };
  async function submit(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = el.querySelector("#go"); busy(btn);
    const back = location.origin + location.pathname;
    try {
      if (mode === "login") { await sb.auth.signIn({ email: f.email.trim(), password: f.password }); window.dispatchEvent(new Event("louvor-login")); }
      else if (mode === "signup") {
        const r = await sb.auth.signUp({ email: f.email.trim(), password: f.password, data: { full_name: f.name.trim(), phone: f.phone || null }, redirectTo: back });
        if (r.session) window.dispatchEvent(new Event("louvor-login"));
        else { el.querySelector(".box").innerHTML = `${logo()}<h1>Confirme seu e-mail</h1><p class="sub">Enviamos um link para <b>${esc(f.email)}</b>. Abra o link para ativar a conta${invite ? " e concluir a entrada no time" : ""}.</p>`; }
      } else { await sb.auth.recover(f.email.trim(), back); toast("Se o e-mail estiver cadastrado, você receberá o link."); mode = "login"; draw(); }
    } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  }
  draw();
}

// ---------------------------------------------------------------- convite
async function inviteView(token) {
  const el = root();
  try { localStorage.setItem("louvor.pendingInvite", token); } catch {}
  el.innerHTML = authShell(spinner());
  const r = await sb.rpc("get_invite", { p_token: token });
  const inv = r.data;
  if (!inv) { el.innerHTML = authShell(`${logo()}<h1>Convite não encontrado</h1><p class="sub">Confira o link com quem convidou você.</p><a class="btn ghost block" href="#/">Ir para o início</a>`); clearPending(); return; }
  const T = inv.team, isOrg = !T;
  if (!inv.valid) { el.innerHTML = authShell(`${logo()}<h1>Convite expirado</h1><p class="sub">${isOrg ? `Peça um novo link ao administrador da ${esc(inv.org.name)}.` : `Peça um novo link ao líder do time ${esc(T.name)}.`}</p><a class="btn ghost block" href="#/">Ir para o início</a>`); clearPending(); return; }
  if (!state.user) return authView(el, "", inv);
  const card = isOrg
    ? `<div class="invitecard">${teamBadge(inv.org, 60)}<div class="grow"><span class="tiny muted">Igreja</span><b style="display:block;font-size:19px">${esc(inv.org.name)}</b><span class="small muted">${inv.org.members} membro(s)</span></div></div>`
    : `<div class="invitecard">${teamBadge(T, 60)}<div class="grow"><span class="tiny muted">${esc(inv.org.name)}</span><b style="display:block;font-size:19px">${esc(T.name)}</b><span class="small muted">${T.members} integrante(s)</span></div></div>`;
  el.innerHTML = authShell(`${logo()}${card}
    ${inv.already_member ? `<h1>Você já faz parte ${isOrg ? "desta igreja" : "deste time"}</h1><p class="sub">Nada a fazer por aqui.</p><button class="btn primary block" id="open">${isOrg ? "Abrir o app" : "Abrir o time"}</button>`
      : isOrg ? `<h1>Tornar-se membro?</h1><p class="sub">Você será cadastrado(a) como membro da igreja. A entrada nos times é feita pelo convite do líder de cada time.</p><button class="btn primary block" id="accept">Aceitar convite</button><a class="btn ghost block mt-s" href="#/">Agora não</a>`
      : !inv.is_church_member && T.category !== "open" ? `<h1>Convite só para membros</h1><p class="sub">${esc(T.name)} é um ministério da ${esc(inv.org.name)} e recebe apenas membros cadastrados da igreja. Peça ao administrador o convite de membro e abra este link de novo.</p><a class="btn ghost block" href="#/">Ir para o início</a>`
      : !inv.is_church_member ? `<h1>Participar como convidado?</h1><p class="sub">Você entrará no time ${esc(T.name)} como convidado(a) de outra igreja. Verá apenas este time.</p>
        <label class="field"><span>Sua igreja</span><input class="input" id="church" maxlength="80" placeholder="Ex.: Nova Vida Niterói"></label>
        <button class="btn primary block" id="accept">Aceitar convite</button><a class="btn ghost block mt-s" href="#/">Agora não</a>`
      : `<h1>Entrar no time?</h1><p class="sub">Você entrará como integrante. O líder poderá definir suas funções.</p><button class="btn primary block" id="accept">Aceitar convite</button><a class="btn ghost block mt-s" href="#/">Agora não</a>`}`);
  const openIt = (orgId, teamId) => { clearPending(); try { localStorage.setItem("louvor.org", orgId); } catch {} document.dispatchEvent(new Event("session-reload")); setTimeout(() => go(teamId ? `/times/${teamId}` : "/"), 200); };
  el.querySelector("#open")?.addEventListener("click", () => openIt(inv.org.id, T?.id));
  el.querySelector("#accept")?.addEventListener("click", async (e) => {
    busy(e.target);
    const a = await sb.rpc("accept_invite", { p_token: token, p_church: el.querySelector("#church")?.value || null });
    if (a.error) { busy(e.target, false); return toast(errMsg(a.error), "err"); }
    toast(a.data.status === "already_member" ? "Você já fazia parte" : `Bem-vindo(a) ${isOrg ? "à " + inv.org.name : "ao " + T.name}!`);
    openIt(a.data.org_id, a.data.team_id);
  });
}
const clearPending = () => { try { localStorage.removeItem("louvor.pendingInvite"); } catch {} };

// ---------------------------------------------------------------- sem organização
export function onboarding(el) {
  let pending = null; try { pending = localStorage.getItem("louvor.pendingInvite"); } catch {}
  if (pending) return go(`/convite/${pending}`);
  el.innerHTML = authShell(`${logo()}<h1>Olá, ${esc((state.profile?.full_name || "").split(" ")[0])}!</h1>
    <p class="sub">Sua conta está pronta, mas você ainda não participa de nenhuma igreja.</p>
    <div class="list menu"><a class="li" href="#/nova-org">${icon("org")}<span class="grow"><span class="t">Cadastrar uma igreja</span><span class="s">Você será o administrador geral</span></span>${icon("chevronRight", "chev")}</a>
      <button class="li" id="paste">${icon("link")}<span class="grow"><span class="t">Tenho um link de convite</span><span class="s">Cole o link enviado pelo líder</span></span>${icon("chevronRight", "chev")}</button></div>
    <button class="btn ghost block mt" id="out">${icon("logout")} Sair da conta</button>`);
  el.querySelector("#paste").onclick = () => {
    const s = sheet(`<h3>Link de convite</h3><form id="pf"><label class="field"><input class="input" name="l" required placeholder="Cole aqui o link"></label><button class="btn primary block">Abrir convite</button></form>`);
    s.el.querySelector("#pf").onsubmit = (e) => { e.preventDefault(); const m = e.target.l.value.match(/convite\/([a-f0-9]{20,})/i) || e.target.l.value.match(/^([a-f0-9]{40,})$/i); if (!m) return toast("Link inválido", "err"); s.close(); go(`/convite/${m[1]}`); };
  };
  el.querySelector("#out").onclick = () => sb.auth.signOut();
}

function newOrgView() {
  const el = root();
  el.innerHTML = authShell(`${logo()}<h1>Nova igreja</h1><p class="sub">A igreja reúne os times (equipes ministeriais), com seus integrantes, escalas e recursos.</p>
    <form id="of"><label class="field"><span>Nome da igreja *</span><input name="name" required maxlength="120" placeholder="Ex.: Nova Vida da Tijuca"></label>
      <label class="field"><span>Subtítulo (opcional)</span><input name="subtitle" maxlength="60" placeholder="Ex.: Igreja"></label>
      <div class="field"><span>Cor de destaque</span>${colorPicker("color", "#3D8BFF")}</div>
      <button class="btn primary block" id="go">Cadastrar igreja</button></form>
    ${state.orgs.length ? `<a class="btn ghost block mt-s" href="#/">Cancelar</a>` : ""}`);
  const form = el.querySelector("#of"); bindColor(form, "color");
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#go"); busy(btn);
    const r = await sb.rpc("create_organization", { p_name: form.name.value, p_accent: readColor(form, "color"), p_subtitle: form.subtitle.value || null });
    if (r.error) { busy(btn, false); return toast(errMsg(r.error), "err"); }
    try { localStorage.setItem("louvor.org", r.data); } catch {}
    toast("Igreja cadastrada. Agora crie o primeiro time.");
    document.dispatchEvent(new Event("session-reload"));
    setTimeout(() => go("/times/novo"), 250);
  };
}

function newPasswordView() {
  const el = root();
  el.innerHTML = authShell(`${logo()}<h1>Nova senha</h1><form id="nf"><label class="field"><span>Nova senha</span><input type="password" name="p" minlength="6" required autocomplete="new-password"></label><button class="btn primary block" id="go">Salvar</button></form>`);
  el.querySelector("#nf").onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#go"); busy(btn);
    try { await sb.auth.updateUser({ password: e.target.p.value }); toast("Senha alterada"); document.dispatchEvent(new Event("session-reload")); go("/"); }
    catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
  };
}

// ---------------------------------------------------------------- perfil
async function profileView(_, el) {
  const p = state.profile || {};
  const tmr = await must(sb.from("team_member_roles").select("team_id,music_roles(name),teams(name)").eq("user_id", state.user.id));
  const byTeam = new Map(); for (const r of tmr) { const k = r.teams?.name || ""; if (!byTeam.has(k)) byTeam.set(k, []); if (r.music_roles) byTeam.get(k).push(r.music_roles.name); }
  let photo = p.avatar_url || null;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Meu perfil</h1></div>
    <div class="row gap-l mb"><button class="hero-av" id="av" aria-label="Trocar foto">${avatar({ ...p, avatar_url: photo }, 96)}<span class="cam">${icon("camera")}</span></button><div class="col gap-s"><button class="btn ghost sm" id="ph">${icon("camera")} ${photo ? "Trocar foto" : "Adicionar foto"}</button>
      <span class="small muted">${esc(state.user.email || "")}</span></div></div>
    <form class="card" id="pf">
      <label class="field"><span>Nome completo</span><input name="full_name" required maxlength="100" value="${attr(p.full_name || "")}"></label>
      <div class="two"><label class="field"><span>WhatsApp</span><input name="phone" type="tel" value="${attr(p.phone || "")}" placeholder="(21) 99999-9999"></label>
        <label class="field"><span>Data de nascimento</span><input name="birth_date" type="date" value="${attr(p.birth_date || "")}"></label></div>
      <label class="field"><span>Cidade</span><input name="city" maxlength="80" value="${attr(p.city || "")}"></label>
      <label class="field"><span>Sobre</span><textarea name="about" maxlength="500">${esc(p.about || "")}</textarea></label>
      <button class="btn primary block" id="save">Salvar perfil</button></form>
    <div class="sec">${icon("music")}<h2>Minhas funções</h2></div>
    ${byTeam.size ? `<div class="list">${[...byTeam.entries()].map(([t, rs]) => `<div class="li"><span class="grow"><span class="t">${esc(t)}</span><span class="s">${rs.length ? rs.map(esc).join(" · ") : "Sem função definida"}</span></span></div>`).join("")}</div>`
      : `<p class="small muted">As funções são definidas pelos líderes de cada time.</p>`}
    <div class="sec">${icon("org")}<h2>Igrejas</h2></div>
    <div class="list">${state.orgs.map((o) => `<div class="li"><span class="grow"><span class="t">${esc(o.organizations.name)}</span><span class="s">${o.role === "admin" ? "Administrador geral" : o.role === "guest" ? "Convidado" : "Membro"}${o.display_name ? ` · aparece como "${esc(o.display_name)}"` : ""}</span></span></div>`).join("")}</div>
    <div class="row gap mt wrap"><button class="btn ghost" id="pw">${icon("lock")} Alterar senha</button><button class="btn danger" id="out">${icon("logout")} Sair</button></div>`;
  el.querySelector("#av").onclick = () => el.querySelector("#ph").click();
  el.querySelector("#ph").onclick = async () => {
    const f = await pickFile("image/*"); if (!f) return;
    try { photo = await uploadPublic(`avatars/${state.user.id}`, f); el.querySelector("#av").innerHTML = avatar({ ...p, avatar_url: photo }, 96) + `<span class="cam">${icon("camera")}</span>`;
      await must(sb.from("profiles").update({ avatar_url: photo }).eq("id", state.user.id)); state.profile.avatar_url = photo; invalidatePeople(); document.dispatchEvent(new Event("profile-changed")); toast("Foto atualizada"); }
    catch (e) { toast(errMsg(e), "err"); }
  };
  el.querySelector("#pf").onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    const f = Object.fromEntries(new FormData(e.target));
    const row = { full_name: f.full_name.trim(), phone: f.phone || null, birth_date: f.birth_date || null, city: f.city || null, about: f.about || null };
    const r = await sb.from("profiles").update(row).eq("id", state.user.id).select("*").single();
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), "err");
    state.profile = r.data; invalidatePeople(); document.dispatchEvent(new Event("profile-changed")); toast("Perfil salvo");
  };
  el.querySelector("#pw").onclick = () => {
    const s = sheet(`<h3>Alterar senha</h3><form id="nf"><label class="field"><span>Nova senha</span><input type="password" name="p" minlength="6" required autocomplete="new-password"></label><button class="btn primary block">Salvar</button></form>`);
    s.el.querySelector("#nf").onsubmit = async (e) => { e.preventDefault(); try { await sb.auth.updateUser({ password: e.target.p.value }); s.close(); toast("Senha alterada"); } catch (err) { toast(errMsg(err), "err"); } };
  };
  el.querySelector("#out").onclick = async () => { if (await confirmDialog("Sair da conta neste aparelho?", "Sair")) { await sb.auth.signOut(); location.hash = "/"; } };
}

// ---------------------------------------------------------------- notificações
const KIND_ICON = { schedule_published: "calendar", schedule_changed: "calendar", announcement: "megaphone", message: "chat", team_joined: "users", invite_accepted: "link", leader: "crown", admin: "shield" };
async function notificationsView(_, el) {
  el.innerHTML = spinner();
  const rows = await must(sb.from("notifications").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(100));
  const orgName = (id) => state.orgs.find((o) => o.org_id === id)?.organizations.name;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Notificações</h1>${rows.some((r) => !r.read_at) ? `<button class="btn ghost sm" id="all">Marcar todas como lidas</button>` : ""}</div>
    ${rows.length ? `<div class="list">${rows.map((n) => `<button class="li" data-n="${n.id}" style="${n.read_at ? "opacity:.6" : ""}"><span class="cover" style="width:42px;height:42px">${icon(KIND_ICON[n.kind] || "bell")}</span>
      <span class="grow" style="min-width:0"><span class="t">${esc(n.title)}</span><span class="s">${esc(n.body || "")}${n.org_id && n.org_id !== state.org?.id && orgName(n.org_id) ? ` · ${esc(orgName(n.org_id))}` : ""}</span></span>
      <span class="col" style="align-items:flex-end;gap:4px"><span class="tiny muted">${fRel(n.created_at)}</span>${n.read_at ? "" : `<span style="width:8px;height:8px;border-radius:8px;background:var(--accent)"></span>`}</span></button>`).join("")}</div>`
      : `<div class="card">${empty("bell", "Nenhuma notificação", "Convites, escalas, avisos e mensagens aparecem aqui.")}</div>`}`;
  el.querySelector("#all")?.addEventListener("click", async () => {
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", state.user.id).is("read_at", "null");
    document.dispatchEvent(new Event("badges")); notificationsView(_, el);
  });
  on(el, "click", "[data-n]", async (e, b) => {
    const n = rows.find((x) => x.id === b.dataset.n);
    if (!n.read_at) await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    document.dispatchEvent(new Event("badges"));
    if (n.org_id && n.org_id !== state.org?.id && state.orgs.some((o) => o.org_id === n.org_id)) await selectOrg(n.org_id);
    if (n.link) location.hash = n.link.replace(/^#/, "");
  });
}

// ---------------------------------------------------------------- configurações da organização
async function orgSettings(_, el) {
  if (!isAdmin()) { el.innerHTML = empty("lock", "Somente administradores gerais acessam esta página."); return; }
  const o = state.org;
  const [ppl, roles, integ] = await Promise.all([people(true), must(sb.from("music_roles").select("*").eq("org_id", o.id).order("sort")), must(sb.from("drive_integrations").select("*").eq("org_id", o.id).maybeSingle())]);
  let logoUrl = o.logo_url;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/">${icon("chevronLeft")}</a><h1>Igreja</h1></div>
    <form class="card" id="of">
      <div class="row gap mb"><span class="tbadge" id="lg" style="--s:72px">${logoUrl ? `<img src="${attr(logoUrl)}" alt="">` : `<span>${esc(o.name[0])}</span>`}</span>
        <div class="col gap-s"><button type="button" class="btn ghost sm" id="up">${icon("image")} Logotipo</button>${logoUrl ? `<button type="button" class="link small" id="rm" style="text-align:left">Remover logotipo</button>` : ""}
        <span class="tiny muted">Sem logotipo, o nome aparece escrito no cabeçalho.</span></div></div>
      <label class="field"><span>Nome da igreja</span><input name="name" required maxlength="120" value="${attr(o.name)}"></label>
      <label class="field"><span>Subtítulo (opcional)</span><input name="subtitle" maxlength="60" value="${attr(o.subtitle || "")}" placeholder="Ex.: Igreja"></label>
      <div class="field"><span>Cor de destaque</span>${colorPicker("color", o.accent_color)}</div>
      <button class="btn primary block" id="save">Salvar</button></form>

    <div class="sec">${icon("cloud")}<h2>Google Drive</h2><a href="#/org/drive">${integ ? "Gerenciar" : "Conectar"} ${icon("chevronRight")}</a></div>
    <div class="card small">${integ ? `<div class="row gap">${icon("check", "ok")}<span class="grow">Pasta <b>${esc(integ.folder_name || "")}</b> conectada${integ.last_success_at ? ` · última sincronização ${fRel(integ.last_success_at)}` : ""}</span></div>${integ.last_error ? `<p class="danger-t">${esc(integ.last_error)}</p>` : ""}`
      : `<span class="muted">Conecte a pasta "multitracks" para importar os projetos do REAPER automaticamente.</span>`}</div>

    <div class="sec">${icon("users")}<h2>Membros da igreja</h2><button class="more" id="orginv">${icon("link")} Convidar membro</button></div>
    <p class="small muted" style="margin-top:-6px">Membros podem ser incluídos nos times pelos líderes. Administradores gerais criam times e definem os líderes.</p>
    <div class="list">${[...ppl.values()].sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.display_name.localeCompare(b.display_name)).map((p) => `<div class="li">${avatar(p, 40, false)}
      <span class="grow"><span class="t">${esc(p.display_name)}</span><span class="s">${p.role === "admin" ? "Administrador geral" : p.role === "guest" ? "Convidado de outra igreja" : "Membro"} · desde ${fDate(p.joined_at)}</span></span>
      <button class="iconbtn" data-p="${p.id}">${icon("more")}</button></div>`).join("")}</div>

    <div class="sec">${icon("music")}<h2>Funções por tipo de time</h2><button class="more" id="addrole">${icon("plus")} Nova</button></div>
    <div class="list" id="roles">${roles.sort((a, b) => String(a.team_type).localeCompare(String(b.team_type)) || a.sort - b.sort).map((r) => `<div class="li">${icon(roleIcon(r.name), "accent")}<span class="grow"><span class="t">${esc(r.name)}</span><span class="s">${r.team_type ? esc(TEAM_TYPES.find((x) => x[0] === r.team_type)?.[1] || r.team_type) : "Todos os tipos"}</span></span><button class="iconbtn" data-er="${r.id}">${icon("edit")}</button><button class="iconbtn" data-dr="${r.id}">${icon("trash")}</button></div>`).join("")}</div>

    <div class="card mt"><h3 class="danger-t" style="font-size:16px">Excluir igreja</h3><p class="small muted">Apaga todos os times, escalas, chats e o repertório desta igreja. As contas das pessoas continuam existindo. Os arquivos do Google Drive não são tocados.</p>
      <button class="btn danger sm" id="delorg">${icon("trash")} Excluir igreja</button></div>`;
  const form = el.querySelector("#of"); bindColor(form, "color");
  el.querySelector("#up").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { logoUrl = await uploadPublic(`orgs/${o.id}`, f); el.querySelector("#lg").innerHTML = `<img src="${attr(logoUrl)}" alt="">`; } catch (e) { toast(errMsg(e), "err"); } };
  el.querySelector("#rm")?.addEventListener("click", () => { logoUrl = null; el.querySelector("#lg").innerHTML = `<span>${esc(o.name[0])}</span>`; });
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#save"); busy(btn);
    const r = await sb.from("organizations").update({ name: form.name.value.trim(), subtitle: form.subtitle.value || null, accent_color: readColor(form, "color"), logo_url: logoUrl }).eq("id", o.id).select("*").single();
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Igreja atualizada"); document.dispatchEvent(new Event("session-reload"));
  };
  on(el, "click", "[data-p]", (e, b) => {
    const p = ppl.get(b.dataset.p); const me = p.id === state.user.id;
    const s = sheet(`<div class="row gap mb">${avatar(p, 48)}<h3 style="margin:0">${esc(p.display_name)}</h3></div><div class="list menu">
      <button class="li" data-a="admin">${icon("shield")}<span class="grow t">${p.role === "admin" ? "Remover administração geral" : "Tornar administrador geral"}</span></button>
      <button class="li" data-a="name">${icon("edit")}<span class="grow t">Nome na igreja</span></button>
      <button class="li danger" data-a="remove">${icon("trash")}<span class="grow t">${me ? "Sair da igreja" : "Remover da igreja"}</span></button></div>`);
    s.el.addEventListener("click", async (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a; if (!a) return;
      let r;
      if (a === "admin") r = await sb.rpc("set_org_admin", { p_org: o.id, p_user: p.id, p_admin: p.role !== "admin" });
      if (a === "name") { const n = prompt("Nome utilizado na igreja", p.display_name); if (n === null) return; r = await sb.from("org_members").update({ display_name: n.trim() || null }).eq("org_id", o.id).eq("user_id", p.id); }
      if (a === "remove") { if (!(await confirmDialog(me ? "Sair desta igreja?" : `Remover ${p.display_name} da igreja e de todos os times dela?`, "Remover", true))) return; r = await sb.from("org_members").delete().eq("org_id", o.id).eq("user_id", p.id); }
      if (r?.error) return toast(errMsg(r.error), "err");
      s.close(); invalidatePeople(); toast("Atualizado");
      if (me && a !== "name") document.dispatchEvent(new Event("session-reload")); else orgSettings(_, el);
    });
  });
  el.querySelector("#orginv").onclick = () => orgInviteSheet();
  el.querySelector("#addrole").onclick = async () => {
    const sh = sheet(`<h3>Nova função</h3><form id="rf"><label class="field"><span>Nome</span><input name="n" required maxlength="60" placeholder="Ex.: Projeção"></label>
      <label class="field"><span>Para qual tipo de time</span><select name="t">${TEAM_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}<option value="">Todos os tipos</option></select></label>
      <button class="btn primary block">Criar função</button></form>`);
    const res = await new Promise((ok) => (sh.el.querySelector("#rf").onsubmit = (e) => { e.preventDefault(); ok({ n: e.target.n.value.trim(), t: e.target.t.value || null }); }));
    sh.close();
    const r = await sb.from("music_roles").insert({ org_id: o.id, name: res.n, sort: roles.length + 1, team_type: res.t });
    if (r.error) return toast(errMsg(r.error), "err"); orgSettings(_, el);
  };
  on(el, "click", "[data-er]", async (e, b) => {
    const r0 = roles.find((r) => r.id === b.dataset.er); const n = prompt("Nome da função", r0.name); if (!n?.trim()) return;
    const r = await sb.from("music_roles").update({ name: n.trim() }).eq("id", r0.id); if (r.error) return toast(errMsg(r.error), "err"); orgSettings(_, el);
  });
  on(el, "click", "[data-dr]", async (e, b) => {
    if (!(await confirmDialog("Excluir esta função? Ela sai de todos os integrantes.", "Excluir", true))) return;
    const r = await sb.from("music_roles").delete().eq("id", b.dataset.dr); if (r.error) return toast(errMsg(r.error), "err"); orgSettings(_, el);
  });
  el.querySelector("#delorg").onclick = async () => {
    const typed = prompt(`Para confirmar, digite o nome da igreja: ${o.name}`);
    if (typed?.trim() !== o.name) return toast("Nome não confere. Nada foi excluído.");
    const r = await sb.from("organizations").delete().eq("id", o.id);
    if (r.error) return toast(errMsg(r.error), "err");
    try { localStorage.removeItem("louvor.org"); } catch {}
    toast("Igreja excluída"); document.dispatchEvent(new Event("session-reload")); go("/");
  };
}

export async function orgInviteSheet() {
  const s = sheet(`<h3>Convidar membro para ${esc(state.org.name)}</h3>${spinner()}`);
  const r = await sb.rpc("create_org_invite", { p_org: state.org.id });
  if (r.error) { s.close(); return toast(errMsg(r.error), "err"); }
  const link = `${location.origin}${location.pathname}#/convite/${r.data}`;
  const text = `Você foi convidado(a) para ser membro da ${state.org.name} no app. Entre pelo link: ${link}`;
  s.el.innerHTML = `<div class="grab"></div><h3>Convidar membro para ${esc(state.org.name)}</h3>
    <p class="small muted">Quem abrir o link cria a conta (ou entra) e passa a ser membro da igreja, sem entrar em nenhum time. Depois, os líderes incluem os membros nos times. O link vale por 30 dias.</p>
    <label class="field"><span>Link de convite da igreja</span><input class="input" readonly value="${attr(link)}" id="lnk"></label>
    <div class="two"><button class="btn ghost" id="cp">${icon("copy")} Copiar link</button>
      <a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon("whatsapp")} WhatsApp</a></div>`;
  s.el.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Link copiado"); } catch { s.el.querySelector("#lnk").select(); document.execCommand("copy"); toast("Link copiado"); } };
}

// ---------------------------------------------------------------- Google Drive
async function driveSettings(_, el) {
  if (!isAdmin()) { el.innerHTML = empty("lock", "Somente administradores gerais."); return; }
  el.innerHTML = spinner();
  const [integ, info, runs, events, pend] = await Promise.all([
    must(sb.from("drive_integrations").select("*").eq("org_id", state.org.id).maybeSingle()),
    sb.functions.invoke("drive-sync", { action: "info" }),
    must(sb.from("sync_runs").select("*").eq("org_id", state.org.id).order("started_at", { ascending: false }).limit(5)),
    must(sb.from("sync_events").select("*").eq("org_id", state.org.id).order("created_at", { ascending: false }).limit(60)),
    must(sb.from("songs").select("id,title,status,status_message,drive_folder_name").eq("org_id", state.org.id).eq("source", "drive").in("status", ["processing", "waiting_files", "error"])),
  ]);
  const email = info.data?.service_email;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/org">${icon("chevronLeft")}</a><h1>Google Drive</h1></div>
    <div class="card"><h3 style="font-size:16px">Como funciona</h3>
      <ol class="small muted" style="padding-left:18px;margin:8px 0 0;line-height:1.7">
        <li>Na conta Google da igreja, abra a pasta <b>multitracks</b> e toque em <b>Compartilhar</b>.</li>
        <li>Adicione o e-mail abaixo como <b>Leitor</b>. O app só enxerga o que for compartilhado com esse e-mail — nenhuma outra pasta da conta.</li>
        <li>Copie o link da pasta e cole aqui. Cada subpasta (ex.: "Emaús - Morada") vira uma música no repertório.</li></ol>
      ${email ? `<div class="row gap mt"><input class="input grow" readonly value="${attr(email)}" id="em"><button class="btn ghost sm" id="cpem">${icon("copy")}</button></div>`
        : `<p class="danger-t small mt">A conta de serviço do Google ainda não foi configurada no servidor (${esc(info.data?.error || info.error?.message || "função indisponível")}). Veja o README.</p>`}</div>
    <form class="card mt" id="cf"><label class="field"><span>Link da pasta "multitracks"</span><input name="folder" required placeholder="https://drive.google.com/drive/folders/..." value="${integ ? attr(`https://drive.google.com/drive/folders/${integ.folder_id}`) : ""}"></label>
      <button class="btn primary block" id="conn">${integ ? "Atualizar conexão" : "Conectar pasta"}</button></form>
    ${integ ? `<div class="card mt"><div class="row between"><span><b>${esc(integ.folder_name || "")}</b><br><span class="small muted">${integ.status === "error" ? `<span class="danger-t">Com erro</span>` : "Conectada"}${integ.last_success_at ? ` · sincronizada ${fRel(integ.last_success_at)}` : ""}</span></span>
      <button class="btn ghost sm" id="sync">${icon("refresh")} Sincronizar agora</button></div>
      <p class="tiny muted mt-s">Verificação automática a cada 5 minutos${integ.watch_expires_at && new Date(integ.watch_expires_at) > new Date() ? " + aviso imediato do Drive quando algo muda" : ""}.</p>
      ${integ.last_error ? `<p class="small danger-t">${esc(integ.last_error)}</p>` : ""}
      <button class="link small danger-t mt-s" id="disc">Desconectar</button></div>` : ""}
    ${pend.length ? `<div class="sec"><h2>Pendências</h2></div><div class="list">${pend.map((s) => `<a class="li" href="#/musica/${s.id}"><span class="grow"><span class="t">${esc(s.drive_folder_name || s.title)}</span><span class="s">${esc(s.status_message || "")}</span></span>
      <span class="tag ${s.status === "error" ? "err" : s.status === "waiting_files" ? "warn" : "soft"}">${s.status === "error" ? "Erro" : s.status === "waiting_files" ? "Aguardando" : "Na fila"}</span></a>`).join("")}</div>` : ""}
    <div class="sec"><h2>Histórico</h2></div>
    <div class="list">${runs.map((r) => `<div class="li"><span class="grow"><span class="t">${{ cron: "Verificação automática", webhook: "Aviso do Drive", manual: "Manual", connect: "Conexão" }[r.trigger] || r.trigger} · ${fRel(r.started_at)}</span>
      <span class="s">${r.status === "running" ? "Em andamento…" : r.error ? esc(r.error) : `${r.stats.folders ?? 0} pasta(s) · ${r.stats.created ?? 0} nova(s) · ${r.stats.updated ?? 0} atualizada(s) · ${r.stats.removed ?? 0} removida(s)${r.stats.errors ? ` · ${r.stats.errors} erro(s)` : ""}`}</span></span>
      <span class="tag ${r.status === "ok" ? "ok" : r.status === "running" ? "soft" : "err"}">${r.status}</span></div>`).join("") || `<div class="li muted small">Nenhuma sincronização ainda.</div>`}</div>
    ${events.length ? `<details class="card mt"><summary style="cursor:pointer">Registro detalhado (${events.length})</summary><div class="mt-s">${events.map((e) => `<div class="small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="${e.level === "error" ? "danger-t" : e.level === "warn" ? "warn" : "muted"}">${e.level === "error" ? "Erro" : e.level === "warn" ? "Aviso" : "Info"}</span> · <span class="tiny muted">${fRel(e.created_at)}</span><br>${esc(e.message)}</div>`).join("")}</div></details>` : ""}`;
  el.querySelector("#cpem")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(email); toast("E-mail copiado"); } catch { el.querySelector("#em").select(); } });
  el.querySelector("#cf").onsubmit = async (e) => {
    e.preventDefault(); const btn = el.querySelector("#conn"); busy(btn);
    const r = await sb.functions.invoke("drive-sync", { action: "connect", org_id: state.org.id, folder: e.target.folder.value });
    busy(btn, false);
    if (r.error) return toast(r.data?.error || errMsg(r.error), "err");
    (r.data.warnings || []).forEach((w) => toast(w));
    toast(`Pasta "${r.data.folder}" conectada. A importação começou.`); driveSettings(_, el);
  };
  el.querySelector("#sync")?.addEventListener("click", async (e) => {
    busy(e.target); const r = await sb.functions.invoke("drive-sync", { action: "sync", org_id: state.org.id }); busy(e.target, false);
    if (r.error) return toast(r.data?.error || errMsg(r.error), "err");
    const st = r.data.stats; toast(`${st.folders} pasta(s): ${st.created} nova(s), ${st.updated} atualizada(s), ${st.removed} removida(s)${st.deferred ? `, ${st.deferred} na fila` : ""}`); driveSettings(_, el);
  });
  el.querySelector("#disc")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Desconectar a pasta? As músicas já importadas continuam no repertório, mas deixam de ser atualizadas.", "Desconectar", true))) return;
    const r = await sb.functions.invoke("drive-sync", { action: "disconnect", org_id: state.org.id });
    if (r.error) return toast(errMsg(r.error), "err"); driveSettings(_, el);
  });
}
