// Cloudflare R2 pela API compatível com S3 (assinatura AWS SigV4), sem dependências.
//  - presignGet: link temporário de leitura (o navegador baixa direto do R2, com pedidos por intervalo de bytes)
//  - put: envio de arquivo (usado pelo conversor da versão leve)
// As chaves ficam só no servidor (secrets). O bucket é privado: sem link assinado, nada é lido.

export interface R2Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string }

export function r2FromEnv(get: (k: string) => string | undefined): R2Config | null {
  const account = get("R2_ACCOUNT_ID"), bucket = get("R2_BUCKET"), id = get("R2_ACCESS_KEY_ID"), secret = get("R2_SECRET_ACCESS_KEY");
  if (!bucket || !id || !secret || !(account || get("R2_ENDPOINT"))) return null;
  return { endpoint: get("R2_ENDPOINT") || `https://${account}.r2.cloudflarestorage.com`, bucket, accessKeyId: id, secretAccessKey: secret, region: "auto" };
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(data: string | Uint8Array) { return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data)); }
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
async function signingKey(secret: string, date: string, region: string, service: string) {
  const kDate = await hmac(enc.encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
// codificação de URI do SigV4 (RFC 3986; "/" preservada no caminho)
export const uriEncode = (s: string, keepSlash = false) =>
  Array.from(enc.encode(s), (b) => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) return c;
    return "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }).join("");
const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function target(cfg: R2Config, key: string) {
  const u = new URL(cfg.endpoint);
  const path = `${u.pathname.replace(/\/$/, "")}/${cfg.bucket}/${key}`;
  return { origin: u.origin, host: u.host, path: uriEncode(path, true) };
}

export async function presignGet(cfg: R2Config, key: string, expiresSec = 6 * 3600, now = new Date(), opts: { host?: string; path?: string; method?: string; query?: Record<string, string> } = {}) {
  const t = target(cfg, key);
  const host = opts.host ?? t.host, path = opts.path ?? t.path;
  const region = cfg.region ?? "auto", ts = amzDate(now), day = ts.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q: [string, string][] = [...Object.entries(opts.query ?? {}),
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"], ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`], ["X-Amz-Date", ts],
    ["X-Amz-Expires", String(expiresSec)], ["X-Amz-SignedHeaders", "host"],
  ];
  const qs = q.map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [opts.method ?? "GET", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", ts, scope, await sha256Hex(canonical)].join("\n");
  const sig = hex(await hmac(await signingKey(cfg.secretAccessKey, day, region, "s3"), sts));
  return `${t.origin}${path}?${qs}&X-Amz-Signature=${sig}`;
}

// Assina um pedido com cabeçalhos (usado no envio). Devolve os cabeçalhos a enviar.
export async function signHeaders(cfg: R2Config, method: string, key: string, headers: Record<string, string>, payloadHash: string, now = new Date(),
  opts: { host?: string; path?: string; query?: string } = {}) {
  const t = target(cfg, key);
  const host = opts.host ?? t.host, path = opts.path ?? t.path;
  const region = cfg.region ?? "auto", ts = amzDate(now), day = ts.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const all: Record<string, string> = { ...headers, host, "x-amz-date": ts, "x-amz-content-sha256": payloadHash };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonical = [method, path, opts.query ?? "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const sts = ["AWS4-HMAC-SHA256", ts, scope, await sha256Hex(canonical)].join("\n");
  const sig = hex(await hmac(await signingKey(cfg.secretAccessKey, day, region, "s3"), sts));
  const out = { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope},SignedHeaders=${names.join(";")},Signature=${sig}` };
  delete (out as Record<string, string>).host;
  return out;
}

// Link temporário para ENVIAR um arquivo direto do celular ao R2 (o arquivo não passa pelo servidor do Somos).
export const presignPut = (cfg: R2Config, key: string, expiresSec = 3 * 3600, now = new Date()) => presignGet(cfg, key, expiresSec, now, { method: "PUT" });

export async function remove(cfg: R2Config, key: string) {
  const t = target(cfg, key);
  const h = await signHeaders(cfg, "DELETE", key, {}, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const r = await fetch(`${t.origin}${t.path}`, { method: "DELETE", headers: h });
  if (!r.ok && r.status !== 404) throw new Error(`R2 ${r.status}`);
}

export async function put(cfg: R2Config, key: string, body: Uint8Array, contentType: string, tries = 4) {
  const t = target(cfg, key);
  const hash = await sha256Hex(body);
  for (let i = 0; ; i++) {
    const h = await signHeaders(cfg, "PUT", key, { "content-type": contentType }, hash);
    const r = await fetch(`${t.origin}${t.path}`, { method: "PUT", headers: h, body }).catch((e) => e as Error);
    if (r instanceof Response && r.ok) return;
    const transient = !(r instanceof Response) || r.status >= 500 || r.status === 429;
    const msg = r instanceof Response ? `R2 ${r.status}: ${(await r.text()).slice(0, 300)}` : `R2: ${r.message}`;
    if (!transient || i >= tries - 1) throw new Error(msg);
    await new Promise((res) => setTimeout(res, 1000 * 2 ** i)); // erro temporário do Cloudflare: tenta de novo
  }
}

// ---- envio em partes (multipart, API S3): arquivos grandes sobem em pedaços, cada um com seu link temporário
const qstr = (q: Record<string, string>) => Object.entries(q).map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
async function s3(cfg: R2Config, method: string, key: string, q: Record<string, string>, body?: string, contentType?: string) {
  const t = target(cfg, key), query = qstr(q);
  const hash = await sha256Hex(body ?? "");
  const h = await signHeaders(cfg, method, key, contentType ? { "content-type": contentType } : {}, hash, new Date(), { query });
  const r = await fetch(`${t.origin}${t.path}?${query}`, { method, headers: h, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`R2 ${r.status}: ${text.slice(0, 200)}`);
  return text;
}
export async function mpCreate(cfg: R2Config, key: string, contentType: string) {
  const x = await s3(cfg, "POST", key, { uploads: "" }, undefined, contentType);
  const id = /<UploadId>([^<]+)<\/UploadId>/.exec(x)?.[1];
  if (!id) throw new Error("R2: sem UploadId");
  return id;
}
export const presignPart = (cfg: R2Config, key: string, uploadId: string, part: number, expiresSec = 6 * 3600) =>
  presignGet(cfg, key, expiresSec, new Date(), { method: "PUT", query: { partNumber: String(part), uploadId } });
export async function mpComplete(cfg: R2Config, key: string, uploadId: string) {
  const listed = await s3(cfg, "GET", key, { uploadId });
  const parts = [...listed.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({ n: Number(/<PartNumber>(\d+)</.exec(m[1])![1]), etag: /<ETag>([^<]+)<\/ETag>/.exec(m[1])![1] })).sort((a, b) => a.n - b.n);
  if (!parts.length) throw new Error("Nenhuma parte enviada.");
  const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  await s3(cfg, "POST", key, { uploadId }, xml, "application/xml");
  return parts.length;
}
export async function mpAbort(cfg: R2Config, key: string, uploadId: string) {
  await s3(cfg, "DELETE", key, { uploadId }).catch(() => {});
}
