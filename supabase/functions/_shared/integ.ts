// Integrações (Fase 6B): API pública v1 e envio de webhooks. Lógica separada do Deno.serve para poder ser testada fora do Supabase.
// A chave de serviço fica só no servidor. Nada aqui grava chaves ou segredos em log.

export interface IntegEnv {
  rest: string;         // <SUPABASE_URL>/rest/v1
  serviceKey: string;   // SUPABASE_SERVICE_ROLE_KEY
  cronSecret?: string;  // CRON_SECRET (agendamento do despacho)
  background?: (p: Promise<unknown>) => void;
}
export interface Deps {
  fetchFn?: typeof fetch;
  resolveDns?: (host: string) => Promise<string[]>;
  now?: () => number;
}

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(s: string): Promise<string> { return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
/** Assinatura enviada em X-Somos-Signature: "v1=" + HMAC-SHA256(segredo, `${timestamp}.${corpo}`) */
export async function signPayload(secret: string, ts: number, body: string): Promise<string> { return "v1=" + (await hmacHex(secret, `${ts}.${body}`)); }

/** Endereços que um webhook nunca pode alcançar (rede interna, loopback, link-local, nuvem). */
export function isPrivateIp(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  const m4 = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (s.includes(":")) return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  return true; // formato desconhecido: bloqueia
}

async function rpc(env: IntegEnv, f: typeof fetch, name: string, args: Record<string, unknown>) {
  const r = await f(`${env.rest}/rpc/${name}`, { method: "POST", headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text(); let data: any = null; try { data = t ? JSON.parse(t) : null; } catch { data = null; }
  return { ok: r.ok, status: r.status, data };
}

// ---------------------------------------------------------------- API v1
const ROUTES: Record<string, { scope: string | null; rpc: string | null }> = {
  "/v1/ping": { scope: null, rpc: null },
  "/v1/events": { scope: "events:read", rpc: "api_v1_events" },
  "/v1/programs": { scope: "programs:read", rpc: "api_v1_programs" },
  "/v1/sermons": { scope: "sermons:read", rpc: "api_v1_sermons" },
  "/v1/contents": { scope: "contents:read", rpc: "api_v1_contents" },
};
const MESSAGES: Record<string, [number, string]> = {
  invalid_key: [401, "Chave de API ausente ou inválida. Envie o cabeçalho Authorization: Bearer <chave>."],
  revoked: [401, "Esta chave foi revogada."],
  expired: [401, "Esta chave venceu. Gere uma nova em SOMOS Chamados → Integrações."],
  insufficient_scope: [403, "Esta chave não tem permissão para este recurso."],
  rate_limited: [429, "Limite de requisições por minuto atingido. Aguarde e tente de novo."],
  not_found: [404, "Recurso não encontrado."],
  method_not_allowed: [405, "Use GET."],
  invalid_parameter: [400, "Parâmetro inválido: limit deve ser de 1 a 100 e offset de 0 em diante."],
  internal_error: [500, "Erro interno. Tente novamente em instantes."],
};

export async function handleApi(req: Request, env: IntegEnv, deps: Deps = {}): Promise<Response> {
  const f = deps.fetchFn ?? fetch; const t0 = Date.now();
  const base: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-API-Version": "v1", "X-Content-Type-Options": "nosniff" };
  let ctx: { org?: string; key?: string } = {}; let path = "";
  const finish = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    const log = rpc(env, f, "api_log", { p_org: ctx.org ?? null, p_key: ctx.key ?? null, p_method: req.method, p_path: path || "/", p_status: status, p_ms: Date.now() - t0 }).catch(() => {});
    if (env.background) env.background(log);
    return new Response(req.method === "HEAD" ? null : JSON.stringify(body), { status, headers: { ...base, ...extra } });
  };
  const fail = (code: string, extra: Record<string, string> = {}) => { const [status, message] = MESSAGES[code] ?? MESSAGES.internal_error; return finish(status, { error: { code, message } }, extra); };
  try {
    const u = new URL(req.url);
    const m = u.pathname.match(/(?:^|\/)api(\/.*)?$/); path = (m?.[1] ?? "/").replace(/\/+$/, "") || "/";
    const auth = req.headers.get("authorization") ?? ""; const bearer = auth.match(/^Bearer\s+(\S+)$/i);
    if (!bearer) return fail("invalid_key", { "WWW-Authenticate": 'Bearer realm="somos-api"' });
    const route = ROUTES[path];
    const a = await rpc(env, f, "api_authenticate", { p_hash: await sha256Hex(bearer[1]), p_scope: route?.scope ?? null });
    if (!a.ok || !a.data) return fail("internal_error");
    ctx = { org: a.data.org_id, key: a.data.key_id };
    if (!a.data.ok) {
      const code = String(a.data.error);
      return fail(code in MESSAGES ? code : "invalid_key", code === "rate_limited" ? { "Retry-After": String(a.data.retry_after ?? 60), "X-RateLimit-Limit": String(a.data.limit ?? ""), "X-RateLimit-Remaining": "0" } : code === "invalid_key" ? { "WWW-Authenticate": 'Bearer realm="somos-api"' } : {});
    }
    const rl = { "X-RateLimit-Limit": String(a.data.limit), "X-RateLimit-Remaining": String(Math.max(0, a.data.remaining)) };
    if (!route) return fail("not_found", rl);
    if (req.method !== "GET" && req.method !== "HEAD") return fail("method_not_allowed", { ...rl, Allow: "GET, HEAD" });
    if (!route.rpc) return finish(200, { data: { ok: true, version: "v1", time: new Date((deps.now ?? Date.now)()).toISOString() } }, rl);
    const lim = u.searchParams.get("limit"), off = u.searchParams.get("offset");
    const limit = lim === null ? 50 : Number(lim), offset = off === null ? 0 : Number(off);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return fail("invalid_parameter", rl);
    const d = await rpc(env, f, route.rpc, { p_org: ctx.org, p_limit: limit, p_offset: offset });
    if (!d.ok) return fail("internal_error", rl);
    return finish(200, d.data, rl);
  } catch {
    return fail("internal_error");
  }
}

// ---------------------------------------------------------------- Webhooks: despacho
interface Claimed { id: number; attempt: number; event_id: number; event_type: string; payload: unknown; org_id: string; created_at: string; url: string; secret: string; endpoint_id: string }
interface Outcome { id: number; ok: boolean; status: number | null; error: string | null }

async function deliverOne(it: Claimed, deps: Deps): Promise<Outcome> {
  const f = deps.fetchFn ?? fetch; const now = deps.now ?? Date.now;
  let host = ""; try { const u = new URL(it.url); if (u.protocol !== "https:" || u.username || u.password) throw new Error("x"); host = u.hostname; } catch { return { id: it.id, ok: false, status: null, error: "endereço de destino inválido" }; }
  if (deps.resolveDns) {
    let ips: string[] = []; try { ips = await deps.resolveDns(host); } catch { return { id: it.id, ok: false, status: null, error: "não foi possível resolver o endereço" }; }
    if (!ips.length || ips.some(isPrivateIp)) return { id: it.id, ok: false, status: null, error: "destino bloqueado (endereço interno)" };
  }
  const body = JSON.stringify({ id: `evt_${it.event_id}`, type: it.event_type, created_at: it.created_at, data: it.payload });
  const ts = Math.floor(now() / 1000);
  try {
    const r = await f(it.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "User-Agent": "Somos-Webhooks/1", "X-Somos-Event": it.event_type, "X-Somos-Delivery": String(it.id), "X-Somos-Timestamp": String(ts), "X-Somos-Signature": await signPayload(it.secret, ts, body) },
      body,
    });
    if (r.status >= 200 && r.status < 300) return { id: it.id, ok: true, status: r.status, error: null };
    return { id: it.id, ok: false, status: r.status, error: r.status >= 300 && r.status < 400 ? "redirecionamento não seguido" : `o destino respondeu ${r.status}` };
  } catch (e) {
    const n = (e as { name?: string })?.name;
    return { id: it.id, ok: false, status: null, error: n === "TimeoutError" || n === "AbortError" ? "tempo esgotado (10 s)" : "falha de conexão" };
  }
}

/** Pega as entregas vencidas, envia (até 5 em paralelo) e informa o resultado. Seguro repetir: cada entrega tem identificador fixo (X-Somos-Delivery). */
export async function dispatchWebhooks(env: IntegEnv, deps: Deps = {}, limit = 50) {
  const f = deps.fetchFn ?? fetch;
  const c = await rpc(env, f, "wh_claim", { p_limit: limit });
  if (!c.ok) { await rpc(env, f, "integ_heartbeat", { p_source: "webhooks", p_ok: false, p_detail: { error: "claim" } }).catch(() => {}); throw new Error("claim " + c.status); }
  const items: Claimed[] = c.data ?? []; const results: Outcome[] = [];
  for (let i = 0; i < items.length; i += 5) results.push(...(await Promise.all(items.slice(i, i + 5).map((it) => deliverOne(it, deps)))));
  if (results.length) await rpc(env, f, "wh_report", { p_results: results });
  const sent = results.filter((r) => r.ok).length;
  await rpc(env, f, "integ_heartbeat", { p_source: "webhooks", p_ok: true, p_detail: { claimed: items.length, sent, failed: results.length - sent } });
  return { claimed: items.length, sent, failed: results.length - sent };
}

export function dispatchHandler(env: IntegEnv, deps: Deps = {}) {
  return async (req: Request): Promise<Response> => {
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (!env.cronSecret || req.headers.get("x-cron-secret") !== env.cronSecret) return j({ error: "unauthorized" }, 401);
    try { return j({ ok: true, ...(await dispatchWebhooks(env, deps)) }); } catch { return j({ ok: false, error: "dispatch_failed" }, 500); }
  };
}
