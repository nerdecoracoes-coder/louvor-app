// Cliente mínimo para os testes de integração contra o ambiente local (dev/stack.sh).
export const AUTH = process.env.AUTH_URL ?? "http://127.0.0.1:9999";
export const REST = process.env.REST_URL ?? "http://127.0.0.1:3000";
export const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

function b64url(buf: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function signJwt(payload: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export const serviceKey = () => signJwt({ role: "service_role", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 3600 });
export const anonKey = () => signJwt({ role: "anon", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 3600 });

export class Api {
  constructor(public token: string, public userId = "") {}
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const r = await fetch(REST + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, apikey: this.token, "Content-Type": "application/json", Prefer: "return=representation", ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data, ok: r.ok };
  }
  get(path: string) { return this.req("GET", path); }
  post(table: string, body: unknown) { return this.req("POST", "/" + table, body); }
  patch(path: string, body: unknown) { return this.req("PATCH", "/" + path, body); }
  del(path: string) { return this.req("DELETE", "/" + path); }
  rpc(fn: string, args: unknown = {}) { return this.req("POST", "/rpc/" + fn, args); }
}

let counter = 0;
export async function newUser(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, "")}.${Date.now()}.${counter++}@teste.local`;
  const r = await fetch(AUTH + "/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123", data: { full_name: name } }),
  });
  const j: any = await r.json();
  if (!j.access_token) throw new Error("signup failed: " + JSON.stringify(j));
  return { api: new Api(j.access_token, j.user.id), id: j.user.id as string, email };
}

// Torna a pessoa membro da igreja (convite da igreja) — necessário antes de entrar em times de ministério.
export async function joinChurch(admin: Api, org: string, ...users: { api: Api }[]) {
  for (const u of users) {
    const tok = (await admin.rpc("create_org_invite", { p_org: org })).data;
    await u.api.rpc("accept_invite", { p_token: tok });
  }
}
