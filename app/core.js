// Núcleo do app: estado, rotas, utilidades de interface e tema.
import { createClient } from "./sb.js";

const cfg = window.LOUVOR_CONFIG || {};
export const sb = createClient(cfg.supabaseUrl || "", cfg.supabaseAnonKey || "");
export const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
export const TZ = "America/Sao_Paulo";

// ---------------------------------------------------------------- estado
export const state = {
  user: null,          // auth user
  profile: null,       // profiles row
  orgs: [],            // [{org_id, role, display_name, organizations:{...}}]
  org: null,           // organização selecionada
  role: null,          // 'admin' | 'member' na organização selecionada
  myTeams: [],         // times do usuário na org (com is_leader)
  leaderOf: new Set(),
  unread: 0,
};
export const isAdmin = () => state.role === "admin";
export const isGuest = () => state.role === "guest";
export const canManageTeam = (teamId) => isAdmin() || state.leaderOf.has(teamId);
export const isStaff = () => isAdmin() || state.leaderOf.size > 0;
// Tipos de time. O repertório (músicas, player) é exclusivo dos tipos em REPERTOIRE_TYPES (igual ao banco: repertoire_types()).
export const TEAM_TYPES = [["louvor", "Louvor"], ["multimidia", "Multimídia"], ["diaconal", "Ministério Diaconal"], ["recepcao", "Recepção"],
  ["infantil", "Ministério Infantil"], ["intercessao", "Intercessão"], ["outro", "Outro"]];
export const REPERTOIRE_TYPES = ["louvor"];
export const teamTypeLabel = (t) => (t?.team_type === "outro" ? t.team_type_label || "Outro" : TEAM_TYPES.find((x) => x[0] === t?.team_type)?.[1] || "");
export const teamHasRepertoire = (t) => REPERTOIRE_TYPES.includes(t?.team_type);
export const hasRepertoire = () => isAdmin() || state.myTeams.some(teamHasRepertoire);
export const isRepertoireStaff = () => isAdmin() || state.myTeams.some((t) => t.is_leader && teamHasRepertoire(t));

// ---------------------------------------------------------------- html
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const attr = esc;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  });
}
export const safeUrl = (u) => { try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.href : null; } catch { return null; } };
export const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`).replace(/\n/g, "<br>");

// ---------------------------------------------------------------- datas
const fmt = (opts) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...opts });
export const fDate = (d) => fmt({ day: "2-digit", month: "short" }).format(new Date(d)).replace(".", "");
export const fDateLong = (d) => fmt({ weekday: "long", day: "2-digit", month: "long" }).format(new Date(d));
export const fTime = (d) => fmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const fDow = (d) => fmt({ weekday: "short" }).format(new Date(d)).replace(".", "");
export const fDay = (d) => fmt({ day: "2-digit" }).format(new Date(d));
export const fMon = (d) => fmt({ month: "short" }).format(new Date(d)).replace(".", "");
export const fRel = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return fTime(d);
  if (s < 7 * 86400) return fmt({ weekday: "short" }).format(new Date(d)).replace(".", "");
  return fDate(d);
};
// "YYYY-MM-DD" no fuso de São Paulo
export const ymd = (d) => fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)).split("/").reverse().join("-");
// Horário de Brasília (America/Sao_Paulo não tem horário de verão desde 2019: UTC-3 fixo)
export const fromLocal = (date, time) => new Date(`${date}T${time || "00:00"}:00-03:00`).toISOString();
export const localTime = (d) => fTime(d);
export const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const fMonthYear = (d) => cap(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(d));
export const fDur = (sec) => { if (sec == null) return ""; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------------------------------------------------------------- ícones (traço fino, minimalistas)
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.5-5A8.5 8.5 0 1 1 21 12z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M17 8.5a5 5 0 0 1 0 7"/><path d="M7 15l1 5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8S10.5 3.5 8 4s-1.5 4 4 4zM12 8s1.5-4.5 4-4 1.5 4-4 4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>', chevronLeft: '<path d="m15 6-6 6 6 6"/>', chevronDown: '<path d="m6 9 6 6 6-6"/>', chevronUp: '<path d="m6 15 6-6 6 6"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>', pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  prev: '<path d="M6 5v14"/><path d="M18 5 9 12l9 7z" fill="currentColor"/>', next: '<path d="M18 5v14"/><path d="m6 5 9 7-9 7z" fill="currentColor"/>',
  rew: '<path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z" fill="currentColor"/>', fwd: '<path d="m13 6 7 6-7 6zM4 6l7 6-7 6z" fill="currentColor"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  lyrics: '<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/>', tracks: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="18" r="1.6" fill="currentColor"/>',
  guitar: '<path d="m20 4-6.5 6.5"/><path d="M18 2l4 4"/><path d="M11.5 9.5c-1.7-.3-3.4.3-4.3 1.6-.5.7-1.4 1-2.2 1-1.5 0-2.7 1.3-2.4 2.9.3 1.9 2.1 3.8 4 4.1 1.6.3 2.9-.9 2.9-2.4 0-.8.3-1.7 1-2.2 1.3-.9 1.9-2.6 1.6-4.3"/><circle cx="8.5" cy="15.5" r="1.2"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  clip: '<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  poll: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>', shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 19 9.5 4.3 4.3 0 0 1 18 18z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 9"/><path d="M20 3v6h-6"/>',
  whatsapp: '<path d="M20.5 11.6a8.6 8.6 0 0 1-12.7 7.5L3.5 20.5l1.4-4.2a8.6 8.6 0 1 1 15.6-4.7z"/><path d="M9 8.5c.2 2.6 3.3 5.8 6.2 6.3l1.1-1.5-1.9-1-1 .7c-.9-.4-2-1.5-2.4-2.4l.7-1-1-1.9z"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>', drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  org: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6M9 10h.01M15 10h.01"/>', swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
};
export const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

// ---------------------------------------------------------------- componentes
export function initials(name) { return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
export function avatar(p, size = 44, ring = true) {
  const name = p?.display_name || p?.full_name || "";
  const inner = p?.avatar_url ? `<img src="${attr(p.avatar_url)}" alt="" loading="lazy">` : `<span>${esc(initials(name))}</span>`;
  return `<span class="av${ring ? " ring" : ""}" style="--s:${size}px">${inner}</span>`;
}
export function teamBadge(t, size = 44) {
  const c = t?.accent_color || "var(--accent)";
  const inner = t?.logo_url ? `<img src="${attr(t.logo_url)}" alt="">` : `<span>${esc(initials(t?.name))}</span>`;
  return `<span class="tbadge" style="--s:${size}px;--tc:${c}">${inner}</span>`;
}
export function empty(iconName, title, text = "", action = "") {
  return `<div class="empty">${icon(iconName)}<b>${esc(title)}</b>${text ? `<p>${text}</p>` : ""}${action}</div>`;
}
export const spinner = () => `<div class="spin" role="status" aria-label="Carregando"></div>`;

export function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3000);
}
export function errMsg(e) {
  if (String(e?.message).includes("only_admin_sets_leader")) return "Somente o administrador da igreja define os líderes.";
  if (String(e?.message).includes("not_church_member")) return "Este time recebe apenas membros cadastrados da igreja.";
  if (String(e?.message).includes("team_has_guests")) return "Remova os convidados antes de tornar este time um ministério.";
  const m = e?.message || String(e || "");
  const map = {
    forbidden: "Você não tem permissão para isso.", last_admin: "A igreja precisa de pelo menos um administrador geral.",
    invite_expired: "Este convite expirou ou foi cancelado.", invite_not_found: "Convite não encontrado.",
    not_authenticated: "Faça login para continuar.", "Invalid login credentials": "E-mail ou senha incorretos.",
    "User already registered": "Este e-mail já tem conta. Faça login.", protected_fields: "Este campo é controlado pelo sistema.",
    drive_managed_fields: "Título, artista, tom e BPM desta música vêm do nome do projeto no Drive.",
    "Email not confirmed": "Confirme seu e-mail pelo link que enviamos antes de entrar.",
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (/duplicate key/.test(m)) return "Já existe um registro igual.";
  if (/row-level security|permission denied/.test(m)) return "Você não tem permissão para isso.";
  if (/Failed to fetch|NetworkError/.test(m)) return "Sem conexão. Verifique a internet.";
  return m || "Algo deu errado.";
}
export async function must(p) { const r = await p; if (r.error) throw r.error; return r.data; }

// Folha inferior (bottom sheet) reutilizável. Retorna { el, close }.
export function sheet(html, { onClose, wide = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet${wide ? " wide" : ""}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("noscroll");
  const close = () => { wrap.classList.add("out"); document.body.classList.remove("noscroll"); setTimeout(() => wrap.remove(), 200); onClose?.(); window.removeEventListener("hashchange", close); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  window.addEventListener("hashchange", close);
  setTimeout(() => wrap.querySelector("input:not([type=hidden]):not([type=file]),textarea")?.focus({ preventScroll: true }), 150);
  return { el: wrap.querySelector(".sheet"), close };
}
export function confirmDialog(text, okLabel = "Confirmar", danger = false) {
  return new Promise((res) => {
    const s = sheet(`<h3>${esc(text)}</h3><div class="row gap end mt"><button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => res(false) });
    s.el.querySelector("[data-ok]").onclick = () => { res(true); s.close(); };
  });
}
export function busy(btn, on = true) { if (!btn) return; btn.disabled = on; btn.classList.toggle("loading", on); }
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

// Envio de imagem com redução de tamanho no próprio aparelho
export async function shrinkImage(file, max = 1200, quality = 0.85) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
}
export async function uploadPublic(path, file) {
  const f = await shrinkImage(file);
  const fullPath = `${path}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
  const r = await sb.storage.from("media").upload(fullPath, f, { upsert: true });
  if (r.error) throw r.error;
  return sb.storage.from("media").publicUrl(fullPath);
}
export function pickFile(accept = "image/*", capture) {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; if (capture) i.setAttribute("capture", capture);
    i.onchange = () => res(i.files?.[0] || null);
    i.click();
  });
}

// ---------------------------------------------------------------- tema
export function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function applyAccent(el, hex) {
  const rgb = hexToRgb(hex) || [61, 139, 255];
  el.style.setProperty("--accent", `rgb(${rgb.join(",")})`);
  el.style.setProperty("--accent-rgb", rgb.join(","));
}
export function applyOrgTheme() { applyAccent(document.documentElement, state.org?.accent_color || "#3D8BFF"); }

// ---------------------------------------------------------------- dados da sessão
export async function loadSession() {
  state.user = sb.auth.user;
  if (!state.user) return;
  const [p, orgs] = await Promise.all([
    sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
    sb.from("org_members").select("org_id,role,display_name,birth_date,organizations(*)").eq("user_id", state.user.id),
  ]);
  state.profile = p.data;
  state.orgs = (orgs.data || []).filter((o) => o.organizations).sort((a, b) => a.organizations.name.localeCompare(b.organizations.name));
  let sel = null;
  try { sel = localStorage.getItem("louvor.org"); } catch {}
  await selectOrg(state.orgs.find((o) => o.org_id === sel)?.org_id || state.orgs[0]?.org_id || null, false);
}
export async function selectOrg(orgId, persist = true) {
  const m = state.orgs.find((o) => o.org_id === orgId);
  state.org = m?.organizations || null;
  state.role = m?.role || null;
  state.myTeams = []; state.leaderOf = new Set();
  if (persist) try { localStorage.setItem("louvor.org", orgId || ""); } catch {}
  if (state.org) {
    const t = await sb.from("team_members").select("team_id,is_leader,teams(*)").eq("user_id", state.user.id).eq("org_id", state.org.id);
    state.myTeams = (t.data || []).filter((x) => x.teams).map((x) => ({ ...x.teams, is_leader: x.is_leader })).sort((a, b) => a.name.localeCompare(b.name));
    state.leaderOf = new Set(state.myTeams.filter((x) => x.is_leader).map((x) => x.id));
  }
  applyOrgTheme();
  document.dispatchEvent(new CustomEvent("org-changed"));
}
export function orgMember() { return state.orgs.find((o) => o.org_id === state.org?.id); }
export function myName() { return orgMember()?.display_name || state.profile?.full_name || ""; }

// ---------------------------------------------------------------- rotas
const routes = [];
export function route(pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler, opts });
}
export const go = (path) => { if (location.hash !== "#" + path) location.hash = path; else window.dispatchEvent(new HashChangeEvent("hashchange")); };
export function matchRoute(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------------------------------------------------------------- pessoas da organização (cache por org)
let peopleCache = { org: null, at: 0, map: new Map() };
export function invalidatePeople() { peopleCache.at = 0; }
export async function people(force = false) {
  if (!state.org) return new Map();
  if (!force && peopleCache.org === state.org.id && Date.now() - peopleCache.at < 60_000) return peopleCache.map;
  const om = await must(sb.from("org_members").select("user_id,role,display_name,birth_date,joined_at").eq("org_id", state.org.id));
  const ids = om.map((m) => m.user_id);
  const pr = ids.length ? await must(sb.from("profiles").select("id,full_name,avatar_url,phone,birth_date,city").in("id", ids)) : [];
  const pm = new Map(pr.map((p) => [p.id, p]));
  const map = new Map(om.map((m) => {
    const p = pm.get(m.user_id) || {};
    return [m.user_id, { id: m.user_id, role: m.role, full_name: p.full_name || "", display_name: m.display_name || p.full_name || "Sem nome",
      avatar_url: p.avatar_url, phone: p.phone, birth_date: m.birth_date || p.birth_date, city: p.city, joined_at: m.joined_at }];
  }));
  peopleCache = { org: state.org.id, at: Date.now(), map };
  return map;
}
export const personName = (map, id) => map.get(id)?.display_name || "Ex-integrante";
export function waLink(phone, text = "") {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  const full = d.length <= 11 ? "55" + d : d;
  return `https://wa.me/${full}${text ? "?text=" + encodeURIComponent(text) : ""}`;
}
export function roleIcon(name = "") {
  const n = name.toLowerCase();
  if (/guitarra|viol|baixo|ukul|cavaq/.test(n)) return "guitar";
  if (/vocal|voz|ministro|soprano|contralto|tenor|back/.test(n)) return "mic";
  if (/bateria|perc|cajon/.test(n)) return "wave";
  if (/teclado|piano|synth|keys/.test(n)) return "sliders";
  return "music";
}
