// Inicialização, estrutura (cabeçalho + navegação) e roteamento.
import { sb, configured, state, route, matchRoute, go, icon, esc, attr, avatar, teamBadge, loadSession, selectOrg, setSpace, sheet, on, toast, hasRepertoire, isRepertoireStaff, isAdmin, isStaff, canManageTeam, applyOrgTheme, errMsg, teamHasRepertoire, teamTypeLabel, teamHas, isGuest, myName, headerActions } from "./core.js";
import * as home from "./views/home.js";
import * as multimidia from "./views/multimidia.js";
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
home.register(route); multimidia.register(route); schedules.register(route); teams.register(route); songs.register(route); chat.register(route); account.register(route);
route("/convidar-membro", async (p, el) => { const { orgInviteSheet } = await import("./views/account.js"); history.replaceState(null, "", "#/org"); location.hash = "/org"; setTimeout(orgInviteSheet, 300); });
route("/player/:id", async ({ id }) => { await openPlayer(id); }, { overlay: true });

// Dois lugares: o TIME (onde a pessoa passa a maior parte do tempo) e a IGREJA (avisos gerais, calendário, membros, times).
// O app abre no último time usado; o seletor no topo troca de time ou leva para a igreja.
function navItems() {
  const t = state.space;
  if (t) return [
    ["inicio", "home", "Início", "#/"],
    ["escalas", "calendar", "Escalas", `#/times/${t.id}/escalas`],
    ...(teamHasRepertoire(t) ? [["musicas", "music", "Músicas", "#/musicas"]] : []),
    ...(teamHas(t, "pedidos") ? [["pedidos", "inbox", "Pedidos", `#/times/${t.id}/pedidos`]] : []),
    ["chat", "chat", "Chat", `#/chat/${t.id}`],
    ["time", "users", "Time", `#/times/${t.id}`],
  ];
  return [
    ["inicio", "home", "Início", "#/"],
    ["times", "users", "Times", "#/times"],
    ["calendario", "calendar", "Calendário", "#/calendario"],
    ...(hasRepertoire() && !state.myTeams.length ? [["musicas", "music", "Músicas", "#/musicas"]] : []),
    ["chat", "chat", "Chat", "#/chat"],
  ];
}
function navActive(path) {
  const t = state.space;
  if (path === "/" || path === "/inicio" || path === "") return "inicio";
  if (path.startsWith("/musica")) return "musicas";
  if (path.startsWith("/chat")) return "chat";
  if (t && (path.startsWith(`/times/${t.id}/pedidos`) || path.startsWith("/pedido"))) return "pedidos";
  if (t) {
    if (path.startsWith(`/times/${t.id}/escalas`) || path.startsWith("/escala") || path.startsWith("/calendario") || path === "/panorama") return "escalas";
    if (path.startsWith(`/times/${t.id}`)) return "time";
    return "";
  }
  if (path.startsWith("/times")) return "times";
  if (path.startsWith("/calendario")) return "calendario";
  return "";
}

function brandHtml() {
  const o = state.org;
  if (!o) return "";
  const t = state.space;
  if (t) return `${teamBadge(t, 34)}<span class="wm"><b>${esc(t.name)}</b><small>${esc(o.name)}</small></span>${icon("chevronDown", "chev")}`;
  const eq = `<span class="eq">${[10, 18, 24, 14, 20, 9].map((h) => `<i style="height:${h}px"></i>`).join("")}</span>`;
  const word = o.logo_url ? `<img src="${attr(o.logo_url)}" alt="${attr(o.name)}">` : `<span class="wm"><b>${esc(o.name)}</b>${o.subtitle ? `<small>${esc(o.subtitle)}</small>` : ""}</span>${eq}`;
  return `${word}${icon("chevronDown", "chev")}`;
}
const navKey = () => (state.space?.id || "igreja") + ":" + navItems().map((x) => x[0]).join(",");
function navHtml() {
  const items = navItems();
  return items.map(([k, ic, l, h]) => `<a href="${h}" data-nav="${k}">${icon(ic)}<span>${l}</span>${k === "chat" ? `<span class="dot hidden" id="chat-dot" style="position:absolute;top:14px;right:calc(50% - 18px);width:8px;height:8px;border-radius:8px;background:var(--accent);box-shadow:0 0 8px var(--accent)"></span>` : ""}</a>`).join("");
}

function renderShell() {
  const items = navItems();
  app.innerHTML = `${WAVES}<div class="shell">
    <header class="topbar">
      <button class="iconbtn menubtn" data-act="menu" aria-label="Abrir menu">${icon("menu")}</button>
      <button class="brand${state.space ? " team" : ""}" data-act="space" aria-label="Trocar de time ou ir para a igreja">${brandHtml()}</button>
      <span class="hdr-actions" id="hdr-actions"></span>
      <button class="iconbtn" data-act="add" aria-label="Adicionar">${icon("plus")}</button>
      <a class="iconbtn" href="#/notificacoes" aria-label="Notificações">${icon("bell")}<span class="dot hidden" id="bell-dot"></span></a>
    </header>
    <nav class="bottomnav" aria-label="Navegação principal" data-key="${attr(navKey())}" style="grid-template-columns:repeat(${items.length},1fr)">${navHtml()}</nav>
    <main class="view" id="view"></main>
  </div>`;
}

on(document, "click", "[data-act=space]", () => spaceSwitcher());
on(document, "click", "[data-act=orgs]", () => spaceSwitcher());
on(document, "click", "[data-act=add]", () => addMenu());
on(document, "click", "[data-act=menu]", () => openMenu());

function spaceSwitcher() {
  const o = state.org;
  const orgBadge = (org, size = 40) => org.logo_url ? `<span class="tbadge" style="--s:${size}px"><img src="${attr(org.logo_url)}" alt=""></span>` : `<span class="tbadge" style="--s:${size}px;--tc:${attr(org.accent_color)}"><span>${esc(org.name[0])}</span></span>`;
  const others = state.orgs.filter((x) => x.org_id !== o.id);
  const s = sheet(`<h3>Meus times</h3><div class="list menu">
    ${state.myTeams.map((t) => `<button class="li" data-space="${t.id}">${teamBadge(t, 40)}<span class="grow"><span class="t">${esc(t.name)}</span><span class="s">${esc(teamTypeLabel(t))}${t.is_leader ? " · Líder" : ""}</span></span>${state.space?.id === t.id ? icon("check", "accent") : ""}</button>`).join("")
      || `<div class="li muted small">Você ainda não participa de nenhum time.</div>`}
  </div>
  <h3 class="mt">Igreja</h3><div class="list menu">
    <button class="li" data-space="">${orgBadge(o)}<span class="grow"><span class="t">${esc(o.name)}</span><span class="s">Avisos gerais, calendário, membros e times</span></span>${!state.space ? icon("check", "accent") : ""}</button>
    ${isAdmin() ? `<a class="li" href="#/org">${icon("settings")}<span class="grow t">Configurações da igreja</span></a>` : ""}
  </div>
  ${others.length ? `<h3 class="mt">Outras igrejas</h3><div class="list menu">${others.map((x) => `<button class="li" data-org="${x.org_id}">${orgBadge(x.organizations)}<span class="grow"><span class="t">${esc(x.organizations.name)}</span><span class="s">${x.role === "admin" ? "Administrador geral" : x.role === "guest" ? "Convidado" : "Membro"}</span></span></button>`).join("")}</div>` : ""}
  <div class="list menu mt"><a class="li" href="#/nova-org">${icon("plus")}<span class="grow t">Cadastrar outra igreja</span></a></div>`);
  on(s.el, "click", "[data-space]", (e, b) => { s.close(); setSpace(b.dataset.space || null); renderShell(); go("/"); });
  on(s.el, "click", "[data-org]", async (e, b) => { s.close(); await selectOrg(b.dataset.org); renderShell(); go("/"); toast(`Você está em ${state.org.name}`); });
  s.el.addEventListener("click", (e) => { if (e.target.closest("a")) s.close(); });
}

// Menu lateral: perfil, visão geral da igreja, indisponibilidades, panorama de escalas e configurações.
function openMenu() {
  const t = state.space;
  const cfg = t ? (canManageTeam(t.id) ? `#/times/${t.id}/config` : "#/perfil") : (isAdmin() ? "#/org" : "#/perfil");
  const items = [["org", "Visão geral", "#/igreja"], ["userOff", "Indisponibilidades", "#/bloqueios"], ["bars", "Panorama de escalas", "#/panorama"]];
  const wrap = document.createElement("div");
  wrap.className = "drawer-wrap";
  wrap.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-label="Menu">
    <a class="dprofile" href="#/perfil">${avatar({ ...state.profile, display_name: myName() }, 52, false)}<span class="grow"><b class="ellipsis">${esc(myName())}</b><small class="ellipsis">${esc(state.user?.email || "")}</small></span>${icon("chevronRight", "chev")}</a>
    <nav class="dmenu">${items.map(([ic, l, h]) => `<a href="${h}">${icon(ic)}<span>${l}</span></a>`).join("")}</nav>
    <div class="dfoot"><a href="${cfg}">${icon("settings")}<span>Configurações</span></a></div></aside>`;
  document.body.appendChild(wrap);
  document.body.classList.add("noscroll");
  const close = () => { wrap.classList.add("out"); document.body.classList.remove("noscroll"); setTimeout(() => wrap.remove(), 200); window.removeEventListener("hashchange", close); document.removeEventListener("keydown", esc2); };
  const esc2 = (e) => { if (e.key === "Escape") close(); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("a")) close(); });
  window.addEventListener("hashchange", close);
  document.addEventListener("keydown", esc2);
  wrap.querySelector("a")?.focus({ preventScroll: true });
}

function addMenu() {
  const t = state.space;
  const items = [];
  if (t) {
    if (canManageTeam(t.id)) items.push(["calendar", "Nova escala", `Escala do ${t.name}`, `#/escala/nova/${t.id}`]);
    if (canManageTeam(t.id) && teamHasRepertoire(t) && isRepertoireStaff()) items.push(["music", "Nova música", "Cadastrar no repertório", "#/musicas/nova"]);
    if (canManageTeam(t.id)) items.push(["megaphone", "Novo aviso do time", `Comunicado para o ${t.name}`, `#/times/${t.id}/aviso`]);
    if (canManageTeam(t.id)) items.push(["link", "Convidar para o time", "Link exclusivo deste time", `#/times/${t.id}/integrantes?convidar=1`]);
    if (teamHas(t, "pedidos")) items.push(["inbox", "Registrar pedido", `Pedido de arte, vídeo ou slide para o ${t.name}`, `#/pedidos/novo/${t.id}`]);
  } else {
    if (isStaff()) items.push(["calendar", "Nova escala", "Criar e escalar integrantes", "#/escala/nova"]);
    if (isStaff()) items.push(["megaphone", "Novo aviso", "Comunicado para a igreja ou um time", "#/avisos/novo"]);
    if (state.myTeams.some((x) => canManageTeam(x.id)) || isAdmin()) items.push(["link", "Convidar para um time", "Link exclusivo de um time (só líderes e administradores)", "#/convidar"]);
    if (isAdmin()) items.push(["users", "Novo time", "Criar um time na igreja", "#/times/novo"]);
    if (isAdmin()) items.push(["org", "Convidar membro da igreja", "Cadastrar alguém como membro, sem time", "#/convidar-membro"]);
  }
  const asks = state.orgTeams.filter((x) => teamHas(x, "pedidos") && x.id !== t?.id);
  if (asks.length && !isGuest()) items.push(["image", "Pedir arte ou vídeo", `Pedido para ${asks.map((x) => x.name).join(", ")}`, asks.length === 1 ? `#/pedidos/novo/${asks[0].id}` : "#/pedidos/novo"]);
  items.push(["lock", "Bloquear datas", "Informar minha indisponibilidade", "#/bloqueios"]);
  const s = sheet(`<h3>Adicionar</h3><div class="list menu">${items.map(([ic, ti, d, h]) => `<a class="li" href="${h}">${icon(ic)}<span class="grow"><span class="t">${esc(ti)}</span><span class="s">${esc(d)}</span></span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`);
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
// Parabéns do dia: na primeira abertura do dia, uma janela avisa quem faz aniversário hoje
function birthdayLater() { if (state.user && state.org) setTimeout(() => import("./views/home.js").then((m) => m.birthdayPopup()).catch(() => {}), 1200); }

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
  // abrir a página (ou o chat) de um dos meus times leva para dentro dele
  if (path === "/igreja" && state.space) { setSpace(null); renderShell(); }
  const tm = /^\/(?:times|chat|t)\/([0-9a-f-]{36})/.exec(path);
  if (tm && tm[1] !== state.space?.id && state.myTeams.some((t) => t.id === tm[1])) { setSpace(tm[1]); renderShell(); }
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
  headerActions("");
  view.dataset.route = path;
  try { await m.handler(m.params, view, () => token === current); }
  catch (e) { console.error(e); view.innerHTML = `<div class="empty">${icon("alert")}<b>Não foi possível carregar</b><p>${esc(errMsg(e))}</p><button class="btn ghost mt" onclick="location.reload()">Tentar de novo</button></div>`; }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", render);
document.addEventListener("org-changed", () => {
  if (!document.getElementById("view")) return;
  // time ou recursos mudaram: refaz o topo e o menu
  const nav = document.querySelector(".bottomnav");
  if (nav && nav.dataset.key !== navKey()) { renderShell(); render(); return; }
  const b = document.querySelector(".brand"); if (b) b.innerHTML = brandHtml();
});
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
  birthdayLater();
}
export async function afterLogin() {
  await loadSession();
  if (state.orgs.length) renderShell();
  startBadges();
  render();
  birthdayLater();
}
window.addEventListener("louvor-login", afterLogin);

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
boot();
