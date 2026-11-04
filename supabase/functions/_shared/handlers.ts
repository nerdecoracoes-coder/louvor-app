// Lógica HTTP das Edge Functions (separada do Deno.serve para poder ser testada fora do Supabase).
import { Db, asUser } from "./db.ts";
import { FOLDER_MIME, folderIdFromInput, type DriveClient } from "./drive.ts";
import { syncOrg, type CoverStore } from "./sync.ts";
import { presignGet, type R2Config } from "./r2.ts";

export interface Env {
  rest: string;            // <SUPABASE_URL>/rest/v1
  serviceKey: string;      // SUPABASE_SERVICE_ROLE_KEY (somente no servidor)
  anonKey: string;         // SUPABASE_ANON_KEY
  cronSecret?: string;     // CRON_SECRET (agendamento)
  publicUrl?: string;      // URL pública desta função, para o aviso de alterações do Drive
  drive: () => DriveClient;
  storage?: string;        // <SUPABASE_URL>/storage/v1 (padrão: derivado de rest)
  publicStorage?: string;  // endereço público do armazenamento, se diferente
  r2?: R2Config | null;    // Cloudflare R2 (versão leve das faixas); sem ele o player usa o WAV do Drive
  background?: (p: Promise<unknown>) => void;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, range, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
};
// Capas das músicas: a imagem da pasta é copiada para o armazenamento público de imagens do app (bucket "media"),
// para aparecer nos cartões sem passar pelo Google a cada exibição. O original no Drive não é alterado.
export function coverStore(env: Env): CoverStore {
  const base = env.storage ?? env.rest.replace(/\/rest\/v1\/?$/, "/storage/v1");
  const h = { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` };
  return {
    async put(path, bytes, contentType) {
      const r = await fetch(`${base}/object/media/${path}`, { method: "POST", headers: { ...h, "Content-Type": contentType, "x-upsert": "true", "cache-control": "31536000" }, body: bytes });
      if (!r.ok) throw new Error(`Storage ${r.status} ${await r.text()}`);
      return `${env.publicStorage ?? base}/object/public/media/${path}`;
    },
    async remove(path) {
      await fetch(`${base}/object/media`, { method: "DELETE", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) }).catch(() => {});
    },
  };
}

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

// Fila grande (ex.: primeira importação): ao terminar uma rodada com músicas ainda na fila, já chama a próxima,
// sem esperar os 5 minutos do agendamento. Só continua se a rodada conseguiu processar algo (evita repetição infinita).
function continueIfQueued(env: Env, stats: any) {
  if (!stats || stats.busy || !(stats.deferred > 0) || !(stats.processed > 0) || !env.publicUrl || !env.cronSecret) return;
  const p = fetch(`${env.publicUrl}?mode=cron&chain=1`, { method: "POST", headers: { "x-cron-secret": env.cronSecret } }).catch(() => {});
  env.background ? env.background(p) : void p;
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
    const job = (async () => { for (const i of all) continueIfQueued(env, await syncOrg({ db, drive: env.drive(), covers: coverStore(env) }, i.org_id, "webhook").catch(() => null)); })();
    if (env.background) { env.background(job); return new Response("accepted", { status: 202 }); }
    await job; return new Response("ok");
  }

  const url = new URL(req.url);
  // 2a) Conversor da versão leve (GitHub): pede a fila e informa o resultado. Protegido pelo mesmo segredo do agendamento.
  const mode = url.searchParams.get("mode");
  if (mode === "light-queue" || mode === "light-done") {
    if (!env.cronSecret || !safeEqual(req.headers.get("x-cron-secret") ?? "", env.cronSecret)) return json({ error: "forbidden" }, 403);
    if (mode === "light-queue") return json({ items: await db.rpc("light_queue", { p_limit: Number(url.searchParams.get("limit") ?? 40) }) });
    const body = await req.json().catch(() => ({}));
    for (const it of (body.items ?? []) as any[]) {
      const prev = await db.one("light_audio", `drive_file_id=eq.${encodeURIComponent(it.drive_file_id)}&src=eq.${encodeURIComponent(it.src)}`);
      await db.upsert("light_audio", {
        org_id: it.org_id, drive_file_id: it.drive_file_id, src: it.src, key: it.error ? null : it.key, info: it.error ? null : it.info,
        bytes: it.error ? null : it.bytes ?? null, error: it.error ? String(it.error).slice(0, 500) : null,
        attempts: it.error ? (prev?.attempts ?? 0) + 1 : prev?.attempts ?? 0, updated_at: new Date().toISOString(),
      }, "drive_file_id,src");
    }
    return json({ ok: true });
  }

  // 2) Execução agendada (pg_cron): verificação periódica de segurança + renovação do aviso de alterações
  if (url.searchParams.get("mode") === "cron") {
    if (!env.cronSecret || !safeEqual(req.headers.get("x-cron-secret") ?? "", env.cronSecret)) return json({ error: "forbidden" }, 403);
    const all: any[] = await db.select("drive_integrations", "status=neq.paused");
    const results: Record<string, unknown> = {};
    const job = async () => {
      for (const i of all) {
        try { results[i.org_id] = await syncOrg({ db, drive: env.drive(), covers: coverStore(env) }, i.org_id, "cron"); continueIfQueued(env, results[i.org_id]); }
        catch (e) { results[i.org_id] = { error: String((e as Error).message) }; }
        await ensureWatch(env, db, i).catch(() => null);
      }
    };
    // continuação da fila: responde na hora e trabalha em segundo plano
    if (url.searchParams.get("chain") && env.background) { env.background(job()); return json({ ok: true, started: true }, 202); }
    await job();
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
  // administrador da igreja ou líder de um time com repertório
  const allowed = await asUser(env.rest, env.anonKey, jwt, "is_repertoire_staff", { p_org: orgId });
  if (allowed !== true) return json({ error: "Somente o administrador e os líderes dos times com repertório podem gerenciar a integração." }, 403);

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
    const job = syncOrg({ db, drive, covers: coverStore(env) }, orgId, "connect").then((st) => { continueIfQueued(env, st); return st; });
    if (env.background) { env.background(job.catch(() => {})); return json({ ok: true, folder: f.name, warnings, started: true }); }
    const stats = await job.catch((e) => ({ error: String((e as Error).message) }));
    return json({ ok: true, folder: f.name, warnings, stats });
  }
  if (action === "sync" || action === "retry") {
    if (action === "retry" && body.song_id) {
      await db.update("songs", `id=eq.${body.song_id}&org_id=eq.${orgId}`, { next_retry_at: null, drive_signature: null });
    }
    try {
      const stats = await syncOrg({ db, drive: env.drive(), covers: coverStore(env) }, orgId, "manual");
      if (stats.busy) return json({ error: "Já existe uma sincronização em andamento. Aguarde um pouco e tente de novo." }, 409);
      continueIfQueued(env, stats);
      return json({ ok: true, stats });
    }
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
  // Versão leve: lista, para um projeto, os links temporários (R2) das faixas já convertidas
  if (req.method === "POST") {
    const jwt = bearer(req);
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const pid = String(body.project_id ?? "");
    if (!/^[0-9a-f-]{36}$/.test(pid)) return json({ error: "projeto inválido" }, 400);
    if (!env.r2) return json({ files: {} });
    // o próprio banco (RLS) decide se o usuário enxerga as faixas deste projeto
    const r = await fetch(`${env.rest}/project_media?project_id=eq.${pid}&select=drive_file_id,md5,size`, { headers: { apikey: env.anonKey, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return json({ error: "forbidden" }, 403);
    const media: any[] = await r.json();
    if (!media.length) return json({ files: {} });
    const db = new Db(env.rest, env.serviceKey);
    const ids = [...new Set(media.map((m) => m.drive_file_id))].map((x) => `"${x}"`).join(",");
    const rows: any[] = await db.select("light_audio", `drive_file_id=in.(${encodeURIComponent(ids)})&key=not.is.null&select=drive_file_id,src,key,info,bytes`);
    const by = new Map(rows.map((x) => [`${x.drive_file_id}|${x.src}`, x]));
    const files: Record<string, unknown> = {};
    for (const m of media) {
      const x = by.get(`${m.drive_file_id}|${m.md5 ?? "s" + m.size}`);
      if (x) files[m.drive_file_id] = { ...x.info, key: x.key, bytes: x.bytes, url: await presignGet(env.r2, x.key, 6 * 3600) };
    }
    return json({ files, expires_in: 6 * 3600 });
  }
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
