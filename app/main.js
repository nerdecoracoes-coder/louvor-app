// Inicialização, estrutura (cabeçalho + navegação) e roteamento.
import { sb, configured, state, route, matchRoute, go, icon, esc, attr, avatar, loadSession, selectOrg, sheet, on, toast, isAdmin, isStaff, canManageTeam, applyOrgTheme, errMsg } from "./core.js";
import * as home from "./views/home.js";
import * as teams from "./views/teams.js";
import * as schedules from "./views/schedules.js";
import * as songs from "./views/songs.js";
import * as chat from "./views/chat.js";
import * as account from "./views/account.js";
import { openPlayer, closePlayer } from "./player/view.js";

const app = document.getElementById("app");
const WAVES = `<div class="backdrop" aria-hidden="true">
  <svg class="w1" viewBox="0 0 1200 300" preserveAspectRatio="none"><defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="rgb(var(--accent-rgb))" stop-opacity="0"/><stop offset=".6" stop-color="rgb(var(--accent-rgb))" stop-opacity=".55"/><stop offset="1" stop-color="rgb(var(--accent-rgb))" stop-opacity="0"/></linearGradient></defs>
  <path d="M0 210 C 300 120, 520 40, 1200 20" stroke="url(#g1)" stroke-width="1.6" fill="none"/><path d="M0 240 C 320 150, 560 80, 1200 60" stroke="url(#g1)" stroke-width=".8" fill="none" opacity=".6"/></svg>
  <svg class="w2" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 280 C 420 270, 760 210, 1200 40" stroke="url(#g1)" stroke-width="2" fill="none"/><path d="M0 300 C 440 290, 800 240, 1200 90" stroke="url(#g1)" stroke-width="1" fill="none" opacity=".5"/></svg></div>`;

// ---------------------------------------------------------------- rotas
home.register(route); teams.register(route); schedules.register(route); songs.register(route); chat.register(route); account.register(route);
route("/player/:id", async ({ id }) => { await openPlayer(id); }, { overlay: true });

function navActive(path) {
  if (path.startsWith("/times")) return "times";
  if (path.startsWith("/musica")) return "musicas";
  if (path.startsWith("/chat")) return "chat";
  if (path === "/" || path === "/inicio" || path === "") return "inicio";
  return "";
}

function brandHtml() {
  const o = state.org;
  if (!o) return "";
  const eq = `<span class="eq">${[10, 18, 24, 14, 20, 9].map((h) => `<i style="height:${h}px"></i>`).join("")}</span>`;
  const word = o.logo_url ? `<img src="${attr(o.logo_url)}" alt="${attr(o.name)}">` : `<span class="wm"><b>${esc(o.name)}</b>${o.subtitle ? `<small>${esc(o.subtitle)}</small>` : ""}</span>${eq}`;
  return `${word}${state.orgs.length > 1 ? icon("chevronDown", "chev") : ""}`;
}

function renderShell() {
  app.innerHTML = `${WAVES}<div class="shell">
    <header class="topbar">
      <button class="brand" data-act="orgs" aria-label="Organização">${brandHtml()}</button>
      <a class="iconbtn" href="#/calendario" aria-label="Calendário">${icon("calendar")}</a>
      <a class="iconbtn" href="#/notificacoes" aria-label="Notificações">${icon("bell")}<span class="dot hidden" id="bell-dot"></span></a>
      <a href="#/perfil" aria-label="Perfil" style="margin-left:4px">${avatar(state.profile, 40)}</a>
    </header>
    <nav class="bottomnav" aria-label="Navegação principal">
      <a href="#/" data-nav="inicio">${icon("home")}<span>Início</span></a>
      <a href="#/times" data-nav="times">${icon("users")}<span>Times</span></a>
      <button class="fab" data-act="add" aria-label="Adicionar">${icon("plus")}</button>
      <a href="#/musicas" data-nav="musicas">${icon("music")}<span>Músicas</span></a>
      <a href="#/chat" data-nav="chat">${icon("chat")}<span>Chat</span><span class="dot hidden" id="chat-dot" style="position:absolute;top:14px;right:calc(50% - 18px);width:8px;height:8px;border-radius:8px;background:var(--accent);box-shadow:0 0 8px var(--accent)"></span></a>
    </nav>
    <main class="view" id="view"></main>
  </div>`;
}

on(document, "click", "[data-act=orgs]", () => orgSwitcher());
on(document, "click", "[data-act=add]", () => addMenu());

function orgSwitcher() {
  const s = sheet(`<h3>Organizações</h3><div class="list menu">
    ${state.orgs.map((o) => `<button class="li" data-org="${o.org_id}">${o.organizations.logo_url ? `<span class="tbadge" style="--s:40px"><img src="${attr(o.organizations.logo_url)}" alt=""></span>` : `<span class="tbadge" style="--s:40px;--tc:${attr(o.organizations.accent_color)}"><span>${esc(o.organizations.name[0])}</span></span>`}
      <span class="grow"><span class="t">${esc(o.organizations.name)}</span><span class="s">${o.role === "admin" ? "Administrador geral" : "Integrante"}</span></span>${o.org_id === state.org?.id ? icon("check", "accent") : ""}</button>`).join("")}
  </div><div class="list menu mt">
    ${isAdmin() ? `<a class="li" href="#/org">${icon("settings")}<span class="grow t">Configurações da organização</span></a>` : ""}
    <a class="li" href="#/nova-org">${icon("plus")}<span class="grow t">Criar nova organização</span></a></div>`);
  on(s.el, "click", "[data-org]", async (e, b) => { s.close(); await selectOrg(b.dataset.org); renderShell(); go("/"); toast(`Você está em ${state.org.name}`); });
}

function addMenu() {
  const managed = state.myTeams.filter((t) => canManageTeam(t.id));
  const items = [];
  if (isStaff()) items.push(["calendar", "Nova escala", "Criar e escalar integrantes", "#/escala/nova"]);
  if (isStaff()) items.push(["music", "Nova música", "Cadastrar no repertório geral", "#/musicas/nova"]);
  if (isStaff()) items.push(["megaphone", "Novo aviso", "Comunicado para a organização ou um time", "#/avisos/novo"]);
  if (managed.length || isAdmin()) items.push(["link", "Convidar integrante", "Gerar link exclusivo de um time", "#/convidar"]);
  if (isAdmin()) items.push(["users", "Novo time", "Criar um time na organização", "#/times/novo"]);
  items.push(["lock", "Bloquear datas", "Informar minha indisponibilidade", "#/bloqueios"]);
  const s = sheet(`<h3>Adicionar</h3><div class="list menu">${items.map(([ic, t, d, h]) => `<a class="li" href="${h}">${icon(ic)}<span class="grow"><span class="t">${t}</span><span class="s">${d}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`);
  s.el.addEventListener("click", (e) => { if (e.target.closest("a")) s.close(); });
}

// ---------------------------------------------------------------- notificações (contador)
let notifTimer = null, notifUnsub = null;
export async function refreshBadges() {
  if (!state.user) return;
  const [n, c] = await Promise.all([
    sb.from("notifications").select("id", { count: "exact" }).eq("user_id", state.user.id).is("read_at", "null").limit(1),
    state.org ? sb.rpc("chat_overview", { p_org: state.org.id }) : Promise.resolve({ data: [] }),
  ]);
  const count = n.count ?? 0;
  const dot = document.getElementById("bell-dot");
  if (dot) { dot.classList.toggle("hidden", !count); dot.classList.toggle("n", count > 0); dot.textContent = count > 9 ? "9+" : String(count); }
  const unreadChat = (c.data || []).reduce((s, x) => s + (x.unread || 0), 0);
  document.getElementById("chat-dot")?.classList.toggle("hidden", !unreadChat);
}
function startBadges() {
  clearInterval(notifTimer); notifUnsub?.();
  refreshBadges();
  notifTimer = setInterval(refreshBadges, 30_000);
  notifUnsub = sb.realtime.subscribe(`notif:${state.user.id}`, [{ event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${state.user.id}` }], () => refreshBadges());
}
document.addEventListener("badges", refreshBadges);

// ---------------------------------------------------------------- navegação
let current = null;
async function render() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path] = raw.split("?");
  const m = matchRoute(path);

  // rotas públicas
  if (!state.user) {
    if (m?.opts.public) return m.handler(m.params, app);
    return account.authView(app, path);
  }
  if (!state.orgs.length && !m?.opts.noOrg) return account.onboarding(app);

  if (m?.opts.overlay) { await m.handler(m.params); return; }
  closePlayer();
  if (m?.opts.noOrg || m?.opts.public) { document.body.classList.remove("in-chat"); return m.handler(m.params, app); }
  if (!document.getElementById("view")) renderShell();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === navActive(path)));
  // elemento novo a cada navegação: nenhum ouvinte de evento sobra da tela anterior
  const old = document.getElementById("view");
  const view = old.cloneNode(false);
  old.replaceWith(view);
  document.body.classList.toggle("in-chat", /^\/chat\/.+/.test(path));
  applyOrgTheme();
  const token = (current = {});
  if (!m) { view.innerHTML = `<div class="empty">${icon("alert")}<b>Página não encontrada</b><a class="btn ghost mt" href="#/">Voltar ao início</a></div>`; return; }
  view.dataset.route = path;
  try { await m.handler(m.params, view, () => token === current); }
  catch (e) { console.error(e); view.innerHTML = `<div class="empty">${icon("alert")}<b>Não foi possível carregar</b><p>${esc(errMsg(e))}</p><button class="btn ghost mt" onclick="location.reload()">Tentar de novo</button></div>`; }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", render);
document.addEventListener("org-changed", () => { if (document.getElementById("view")) { const b = document.querySelector(".brand"); if (b) b.innerHTML = brandHtml(); } });
document.addEventListener("profile-changed", () => { const a = document.querySelector('.topbar a[href="#/perfil"]'); if (a) a.innerHTML = avatar(state.profile, 40); });
document.addEventListener("session-reload", async () => { await loadSession(); renderShell(); startBadges(); render(); });

async function boot() {
  if (!configured) { app.innerHTML = account.notConfigured(); return; }
  // retorno de e-mail de confirmação ou de recuperação de senha
  if (/access_token=/.test(location.hash)) {
    const r = sb.auth.fromUrlHash(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    if (r?.type === "recovery") { location.hash = "/nova-senha"; }
    else {
      let pending = null; try { pending = localStorage.getItem("louvor.pendingInvite"); } catch {}
      location.hash = pending ? `/convite/${pending}` : "/";
    }
  }
  sb.auth.onChange(async (s) => {
    const was = !!state.user;
    if (!s && was) { state.user = null; state.orgs = []; state.org = null; render(); }
  });
  if (sb.auth.session) {
    try { await sb.auth.token(); await loadSession(); }
    catch (e) { console.warn(e); }
  }
  if (state.user) { if (state.orgs.length) renderShell(); startBadges(); }
  render();
}
export async function afterLogin() {
  await loadSession();
  if (state.orgs.length) renderShell();
  startBadges();
  render();
}
window.addEventListener("louvor-login", afterLogin);

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
boot();
