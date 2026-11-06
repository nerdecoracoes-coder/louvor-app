// Servidor local de desenvolvimento/testes (Bun). Junta, em um único endereço, o que o Supabase oferece:
//   /auth/v1  -> Supabase Auth (GoTrue) local      /rest/v1 -> PostgREST local
//   /functions/v1/drive-sync e drive-media -> os MESMOS handlers das Edge Functions, usando uma pasta local
//     no lugar do Google Drive (somente para testes)
//   /storage/v1 -> armazenamento local simples que aplica as mesmas regras de permissão do banco
// Uso: bun dev/serve.ts   (requer dev/stack.sh start)   — variáveis: PORT, DRIVE_ROOT
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, normalize, dirname, extname } from "node:path";
import { createHmac } from "node:crypto";
import { handleSync, handleMedia } from "../supabase/functions/_shared/handlers.ts";
import { FsDrive } from "../tests/fsdrive.ts";
import { run as runLight } from "../tools/light/convert.ts";
import { signJwt } from "../tests/helpers.ts";

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = normalize(join(import.meta.dir, ".."));
const STORE = process.env.STORE_DIR ?? "/var/tmp/louvor-storage";
const DRIVE_ROOT = process.env.DRIVE_ROOT ?? "/var/tmp/louvor-drive/multitracks";
mkdirSync(STORE, { recursive: true }); mkdirSync(DRIVE_ROOT, { recursive: true });
const AUTH = "http://127.0.0.1:9999", REST = "http://127.0.0.1:3000";
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const ANON = await signJwt({ role: "anon", iss: "supabase", exp });
const SERVICE = await signJwt({ role: "service_role", iss: "supabase", exp });
const drive = new FsDrive(DRIVE_ROOT);
// "R2" local: mesmo formato de caminho do Cloudflare (endpoint/bucket/chave), com pedidos por intervalo de bytes
const R2DIR = join(STORE, "r2");
const r2 = { endpoint: `http://127.0.0.1:${PORT}/r2`, bucket: "somos-dev", accessKeyId: "dev", secretAccessKey: "dev", region: "auto" };
const env = { rest: REST, serviceKey: SERVICE, anonKey: ANON, cronSecret: "dev-cron", drive: () => drive, storage: `http://127.0.0.1:${PORT}/storage/v1`, r2: process.env.NO_R2 ? null : r2, auth: AUTH };
const isService = (req: Request) => req.headers.get("authorization") === `Bearer ${SERVICE}`;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "Access-Control-Expose-Headers": "Content-Range, Content-Length" };

async function proxy(req: Request, target: string) {
  const u = new URL(req.url);
  const headers = new Headers(req.headers); headers.delete("host");
  const r = await fetch(target + u.search, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
  const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); h.delete("content-encoding"); h.delete("content-length");
  return new Response(await r.arrayBuffer(), { status: r.status, headers: h });
}
async function asUser(req: Request, fn: string, args: unknown) {
  const r = await fetch(`${REST}/rpc/${fn}`, { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return r.ok ? r.json() : false;
}
const sign = (p: string) => createHmac("sha256", SERVICE).update(p).digest("hex").slice(0, 32);
const safe = (bucket: string, path: string) => { const p = normalize(join(STORE, bucket, path)); if (!p.startsWith(join(STORE, bucket))) throw new Error("bad path"); return p; };

async function storage(req: Request, rest: string) {
  const u = new URL(req.url);
  let m;
  if (req.method === "GET" && (m = rest.match(/^object\/public\/media\/(.+)$/))) {
    const f = safe("media", decodeURIComponent(m[1])); if (!existsSync(f)) return new Response("not found", { status: 404, headers: CORS });
    return new Response(readFileSync(f), { headers: { ...CORS, "Content-Type": MIME[extname(f)] ?? "application/octet-stream" } });
  }
  if (req.method === "POST" && (m = rest.match(/^object\/sign\/(\w+)\/(.+)$/))) {
    const path = decodeURIComponent(m[2]);
    if (!(await asUser(req, "storage_can_read", { p_name: path }))) return Response.json({ message: "forbidden" }, { status: 403, headers: CORS });
    return Response.json({ signedURL: `/object/signed/${m[1]}/${m[2]}?token=${sign(m[1] + "/" + path)}` }, { headers: CORS });
  }
  if (req.method === "GET" && (m = rest.match(/^object\/signed\/(\w+)\/(.+)$/))) {
    const path = decodeURIComponent(m[2]);
    if (u.searchParams.get("token") !== sign(m[1] + "/" + path)) return new Response("forbidden", { status: 403, headers: CORS });
    const f = safe(m[1], path); if (!existsSync(f)) return new Response("not found", { status: 404, headers: CORS });
    return new Response(readFileSync(f), { headers: CORS });
  }
  if (req.method === "POST" && (m = rest.match(/^object\/(\w+)\/(.+)$/))) {
    const path = decodeURIComponent(m[2]);
    if (!isService(req) && !(await asUser(req, "storage_can_write", { p_bucket: m[1], p_name: path }))) return Response.json({ message: "new row violates row-level security policy" }, { status: 403, headers: CORS });
    const f = safe(m[1], path); mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, new Uint8Array(await req.arrayBuffer()));
    return Response.json({ Key: `${m[1]}/${path}` }, { headers: CORS });
  }
  if (req.method === "DELETE" && (m = rest.match(/^object\/(\w+)$/))) {
    const { prefixes } = await req.json();
    for (const p of prefixes) if (isService(req) || await asUser(req, "storage_can_write", { p_bucket: m[1], p_name: p })) rmSync(safe(m[1], p), { force: true });
    return Response.json([], { headers: CORS });
  }
  return new Response("not found", { status: 404, headers: CORS });
}

Bun.serve({
  port: PORT, hostname: "127.0.0.1", idleTimeout: 120,
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (p.startsWith("/auth/v1/")) return proxy(req, AUTH + p.slice(8));
      if (p.startsWith("/rest/v1/")) return proxy(req, REST + p.slice(8));
      if (p.startsWith("/storage/v1/")) return storage(req, p.slice(12));
      if (p === "/functions/v1/drive-sync") return handleSync(req, env);
      if (p === "/functions/v1/drive-media") return handleMedia(req, env);
      if (p.startsWith("/realtime/")) return new Response("realtime indisponível no ambiente local", { status: 404 });
      if (p === "/config.js") return new Response(`window.LOUVOR_CONFIG = ${JSON.stringify({ supabaseUrl: `http://127.0.0.1:${PORT}`, supabaseAnonKey: ANON })};`, { headers: { "Content-Type": MIME[".js"] } });
      if (p.startsWith("/r2/")) {
        const f = normalize(join(R2DIR, decodeURIComponent(p.slice(4))));
        if (!f.startsWith(R2DIR)) return new Response("bad", { status: 400 });
        // envio em partes (S3 multipart) simulado: partes ficam em uma pasta de trabalho até a conclusão
        const upId = u.searchParams.get("uploadId"), partsDir = upId ? join(R2DIR, ".mp", upId.replace(/[^\w-]/g, "")) : "";
        if (req.method === "POST" && u.searchParams.has("uploads")) { const id = crypto.randomUUID(); mkdirSync(join(R2DIR, ".mp", id), { recursive: true }); return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`, { headers: CORS }); }
        if (req.method === "PUT" && upId && u.searchParams.get("partNumber")) {
          const n = Number(u.searchParams.get("partNumber")); writeFileSync(join(partsDir, String(n).padStart(6, "0")), new Uint8Array(await req.arrayBuffer()));
          return new Response("", { status: 200, headers: { ...CORS, ETag: `"part${n}"` } });
        }
        if (req.method === "GET" && upId && !existsSync(f)) {
          const names = existsSync(partsDir) ? (await import("node:fs")).readdirSync(partsDir).sort() : [];
          return new Response(`<ListPartsResult>${names.map((n) => `<Part><PartNumber>${Number(n)}</PartNumber><ETag>"part${Number(n)}"</ETag></Part>`).join("")}</ListPartsResult>`, { headers: CORS });
        }
        if (req.method === "POST" && upId) {
          const fs = await import("node:fs"); const names = fs.readdirSync(partsDir).sort();
          mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, Buffer.concat(names.map((n) => fs.readFileSync(join(partsDir, n))))); rmSync(partsDir, { recursive: true, force: true });
          return new Response("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>", { headers: CORS });
        }
        if (req.method === "DELETE") { rmSync(upId ? partsDir : f, { recursive: true, force: true }); return new Response("", { status: 204, headers: CORS }); }
        if (req.method === "PUT") { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, new Uint8Array(await req.arrayBuffer())); return new Response("", { status: 200 }); }
        if (!u.searchParams.get("X-Amz-Signature")) return new Response("AccessDenied", { status: 403, headers: CORS });
        if (!existsSync(f)) return new Response("NoSuchKey", { status: 404, headers: CORS });
        const all = readFileSync(f); const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
        if (!m) return new Response(all, { headers: { ...CORS, "Content-Type": "audio/ogg" } });
        const a = Number(m[1]), b = m[2] ? Math.min(all.length - 1, Number(m[2])) : all.length - 1;
        return new Response(all.subarray(a, b + 1), { status: 206, headers: { ...CORS, "Content-Type": "audio/ogg", "Content-Range": `bytes ${a}-${b}/${all.length}` } });
      }
      if (p === "/__dev/light") {
        // roda o conversor como o GitHub faria (fila e resultado pelo mesmo endpoint do servidor)
        const call = (q: string, init: RequestInit = {}) => handleSync(new Request(`http://x/drive-sync?${q}`, { ...init, headers: { "x-cron-secret": "dev-cron", "Content-Type": "application/json" } }), env);
        const res = await runLight({
          queue: async (limit) => (await (await call(`mode=light-queue&limit=${limit}`)).json()).items,
          done: async (items) => { await call("mode=light-done", { method: "POST", body: JSON.stringify({ items }) }); },
          drive, upload: async (key, bytes) => { const f = join(R2DIR, r2.bucket, key); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, bytes); },
        }, { minutes: 5, parallel: 3, log: () => {} });
        return Response.json(res, { headers: CORS });
      }
      if (p === "/__dev/drive") return Response.json({ rootId: drive.idOf(DRIVE_ROOT), root: DRIVE_ROOT, service: SERVICE });
      const file = normalize(join(ROOT, p === "/" ? "index.html" : p));
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" } });
    } catch (e) {
      console.error(e);
      return Response.json({ error: String((e as Error).message) }, { status: 500, headers: CORS });
    }
  },
});
console.log(`dev server http://127.0.0.1:${PORT}  (Drive simulado em ${DRIVE_ROOT})`);
