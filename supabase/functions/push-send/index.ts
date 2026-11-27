// Edge Function: envia as notificações pendentes para o celular (Web Push), mesmo com o app fechado.
// Só funciona depois de configurar os secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:contato@suaigreja.org) e CRON_SECRET.
// Sem as chaves, responde "not_configured" e não envia nada. Chamada a cada 1–5 min por agendamento (header x-cron-secret).
import webpush from "npm:web-push@3.6.7";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cronSecret = Deno.env.get("CRON_SECRET");
const pub = Deno.env.get("VAPID_PUBLIC_KEY");
const priv = Deno.env.get("VAPID_PRIVATE_KEY");
const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@example.org";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);
  const beat = (ok: boolean, configured: boolean, detail: Record<string, unknown> = {}) => rpc("integ_heartbeat", { p_source: "push", p_ok: ok, p_detail: { configured, ...detail } }).catch(() => {});
  if (!pub || !priv) { await beat(false, false); return json({ ok: false, error: "not_configured", detail: "Faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY." }, 200); }
  webpush.setVapidDetails(subject, pub, priv);
  const items: { id: number; title: string; body?: string; link?: string; subs: { endpoint: string; p256dh: string; auth: string }[] }[] = await rpc("push_claim", { p_limit: 100 });
  const done: number[] = [], dead: string[] = []; let sent = 0, failed = 0;
  for (const it of items) {
    const payload = JSON.stringify({ title: it.title, body: it.body ?? "", link: it.link ?? "#/" });
    let ok = it.subs.length === 0; // sem aparelhos: nada a fazer
    for (const s of it.subs) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); ok = true; sent++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(s.endpoint); else failed++; }
    }
    if (ok || it.subs.every((s) => dead.includes(s.endpoint))) done.push(it.id);
  }
  await rpc("push_report", { p_done: done, p_dead: dead, p_error: failed ? `${failed} falhas temporárias` : null });
  await beat(true, true, { claimed: items.length, sent, failed });
  return json({ ok: true, claimed: items.length, sent, failed, removed_devices: dead.length });
});
