// Aviso no celular (Web Push). Só liga quando o navegador/app suporta e a igreja configurou a chave pública (config.js → vapidPublicKey).
// O envio real é feito pela Edge Function push-send (veja docs/expansao-plataforma.md).
import { sb } from "../core.js";

const key = () => (window.LOUVOR_CONFIG && window.LOUVOR_CONFIG.vapidPublicKey) || "";
const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
const ab64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** "ok" | "sem_chave" (igreja ainda não configurou) | "sem_suporte" | "bloqueado" (permissão negada) */
export function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "sem_suporte";
  if (!key()) return "sem_chave";
  if (Notification.permission === "denied") return "bloqueado";
  return "ok";
}
async function current() { const reg = await navigator.serviceWorker.ready; return { reg, sub: await reg.pushManager.getSubscription() }; }
export async function pushActive() { if (pushState() === "sem_suporte") return false; try { return !!(await current()).sub; } catch { return false; } }
export async function pushEnable() {
  const st = pushState(); if (st !== "ok") return { ok: false, reason: st };
  if ((await Notification.requestPermission()) !== "granted") return { ok: false, reason: "bloqueado" };
  const { reg, sub: old } = await current();
  const sub = old || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key()) }));
  const r = await sb.rpc("push_subscribe", { p_endpoint: sub.endpoint, p_p256dh: ab64(sub.getKey("p256dh")), p_auth: ab64(sub.getKey("auth")), p_ua: navigator.userAgent.slice(0, 280) });
  if (r.error) return { ok: false, reason: "erro", error: r.error };
  return { ok: true };
}
export async function pushDisable() {
  try { const { sub } = await current(); if (sub) { await sb.rpc("push_unsubscribe", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); } } catch { /* nada a desfazer */ }
  return { ok: true };
}
