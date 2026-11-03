// Lógica HTTP das Edge Functions (separada do Deno.serve para poder ser testada fora do Supabase).
import { Db, asUser } from "./db.ts";
import { FOLDER_MIME, folderIdFromInput, type DriveClient } from "./drive.ts";
import { syncOrg } from "./sync.ts";

export interface Env {
  rest: string;            // <SUPABASE_URL>/rest/v1
  serviceKey: string;      // SUPABASE_SERVICE_ROLE_KEY (somente no servidor)
  anonKey: string;         // SUPABASE_ANON_KEY
  cronSecret?: string;     // CRON_SECRET (agendamento)
  publicUrl?: string;      // URL pública desta função, para o aviso de alterações do Drive
  drive: () => DriveClient;
  background?: (p: Promise<unknown>) => void;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, range, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function ensureWatch(env: Env, db: Db, integ: any) {
  // Aviso de alterações do Drive (push). É uma aceleração: a verificação agendada continua sendo a garantia.
  const drive = env.drive();
  if (!env.publicUrl?.startsWith("https://") || !drive.watchChanges) return null;
  if (integ.watch_expires_at && new Date(integ.watch_expires_at).getTime() - Date.now() > 24 * 3600e3) return null;
  const channelId = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const w = await drive.watchChanges(env.publicUrl, channelId, token, 6 * 24 * 3600e3);
  await db.update("drive_integrations", `org_id=eq.${integ.org_id}`, { watch_channel_id: channelId, watch_resource_id: w.resourceId, watch_token: token, watch_expires_at: w.expiration });
  return w;
}

export async function handleSync(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = new Db(env.rest, env.serviceKey);

  // 1) Aviso de alteração enviado pelo Google Drive
  const channel = req.headers.get("x-goog-channel-id");
  if (channel) {
    const integ = await db.one("drive_integrations", `watch_channel_id=eq.${encodeURIComponent(channel)}`);
    if (!integ || !safeEqual(req.headers.get("x-goog-channel-token") ?? "", integ.watch_token ?? "")) return new Response("ignored", { status: 200 });
    if (req.headers.get("x-goog-resource-state") === "sync") return new Response("ok");
    // o aviso do Drive não diz qual pasta mudou; sincroniza todas as organizações ligadas (é barato quando nada mudou)
    const all: any[] = await db.select("drive_integrations", "status=neq.paused&select=org_id");
    const job = (async () => { for (const i of all) await syncOrg({ db, drive: env.drive() }, i.org_id, "webhook").catch(() => {}); })();
    if (env.background) { env.background(job); return new Response("accepted", { status: 202 }); }
    await job; return new Response("ok");
  }

  // 2) Execução agendada (pg_cron): verificação periódica de segurança + renovação do aviso de alterações
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "cron") {
    if (!env.cronSecret || !safeEqual(req.headers.get("x-cron-secret") ?? "", env.cronSecret)) return json({ error: "forbidden" }, 403);
    const all: any[] = await db.select("drive_integrations", "status=neq.paused");
    const results: Record<string, unknown> = {};
    for (const i of all) {
      try { results[i.org_id] = await syncOrg({ db, drive: env.drive() }, i.org_id, "cron"); }
      catch (e) { results[i.org_id] = { error: String((e as Error).message) }; }
      await ensureWatch(env, db, i).catch(() => null);
    }
    return json({ ok: true, results });
  }

  // 3) Chamadas feitas pelo app (administrador logado)
  const jwt = bearer(req);
  if (!jwt) return json({ error: "Faça login." }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  const action = body.action ?? "info";
  if (action === "info") {
    try { return json({ service_email: env.drive().serviceEmail() }); }
    catch (e) { return json({ error: "Conta de serviço do Google não configurada no servidor.", detail: String((e as Error).message) }, 500); }
  }
  const orgId = String(body.org_id ?? "");
  const isAdmin = await asUser(env.rest, env.anonKey, jwt, "is_org_admin", { p_org: orgId });
  if (isAdmin !== true) return json({ error: "Somente administradores gerais podem gerenciar a integração." }, 403);

  if (action === "connect") {
    const folderId = folderIdFromInput(String(body.folder ?? ""));
    if (!folderId) return json({ error: "Cole o link da pasta \"multitracks\" do Google Drive." }, 400);
    const drive = env.drive();
    let f;
    try { f = await drive.getFile(folderId); }
    catch { return json({ error: `Não consegui abrir a pasta. Compartilhe a pasta "multitracks" com ${drive.serviceEmail()} (como Leitor) e tente de novo.` }, 400); }
    if (f.mimeType !== FOLDER_MIME) return json({ error: "O link não é de uma pasta." }, 400);
    const other = await db.one("drive_integrations", `folder_id=eq.${encodeURIComponent(folderId)}&org_id=neq.${orgId}`);
    if (other) return json({ error: "Esta pasta já está ligada a outra organização." }, 409);
    const warnings: string[] = [];
    if (f.capabilities?.canEdit) warnings.push("A conta de serviço tem permissão de EDIÇÃO nesta pasta. O app nunca altera arquivos, mas o recomendado é compartilhar como \"Leitor\".");
    const [integ] = await db.upsert("drive_integrations", {
      org_id: orgId, folder_id: folderId, folder_name: f.name, folder_owner: f.owners?.[0]?.emailAddress ?? null, status: "connected",
      last_error: null, connected_at: new Date().toISOString(), watch_channel_id: null, watch_token: null, watch_expires_at: null,
    }, "org_id");
    await ensureWatch(env, db, integ).catch((e) => warnings.push(`Aviso automático de alterações indisponível (${(e as Error).message}); a verificação periódica continua ativa.`));
    const job = syncOrg({ db, drive }, orgId, "connect");
    if (env.background) { env.background(job.catch(() => {})); return json({ ok: true, folder: f.name, warnings, started: true }); }
    const stats = await job.catch((e) => ({ error: String((e as Error).message) }));
    return json({ ok: true, folder: f.name, warnings, stats });
  }
  if (action === "sync" || action === "retry") {
    if (action === "retry" && body.song_id) {
      await db.update("songs", `id=eq.${body.song_id}&org_id=eq.${orgId}`, { next_retry_at: null, drive_signature: null });
    }
    try { return json({ ok: true, stats: await syncOrg({ db, drive: env.drive() }, orgId, "manual") }); }
    catch (e) { return json({ error: String((e as Error).message) }, 502); }
  }
  if (action === "disconnect") {
    await db.delete("drive_integrations", `org_id=eq.${orgId}`);
    return json({ ok: true });
  }
  return json({ error: "Ação desconhecida." }, 400);
}

// Transmite um áudio do Drive para o player, por intervalos de bytes, depois de conferir que o usuário
// logado pertence à organização dona do projeto. A credencial do Google nunca sai do servidor.
export async function handleMedia(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const fileId = url.searchParams.get("file") ?? "";
  const jwt = bearer(req) || url.searchParams.get("access_token") || "";
  if (!fileId || !jwt) return json({ error: "unauthorized" }, 401);
  const ok = await asUser(env.rest, env.anonKey, jwt, "can_read_drive_file", { p_file_id: fileId });
  if (ok !== true) return json({ error: "forbidden" }, 403);
  const upstream = await env.drive().media(fileId, req.headers.get("range"));
  const h = new Headers(CORS);
  for (const k of ["content-type", "content-length", "content-range"]) { const v = upstream.headers.get(k); if (v) h.set(k, v); }
  if (!h.get("content-type")) h.set("content-type", "application/octet-stream");
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "private, max-age=86400");
  return new Response(upstream.body, { status: upstream.status, headers: h });
}
