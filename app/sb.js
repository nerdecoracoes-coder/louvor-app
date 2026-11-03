// Cliente leve do Supabase (login, banco, funções, arquivos e tempo real), sem dependências externas.
// Usa as mesmas APIs públicas do supabase-js: /auth/v1, /rest/v1, /storage/v1, /functions/v1, /realtime/v1.

const SESSION_KEY = "louvor.session";

export function createClient(url, anonKey) {
  url = url.replace(/\/+$/, "");
  const listeners = new Set();
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { session = null; }
  let refreshTimer = null;
  let refreshing = null;

  const save = (s) => {
    session = s;
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
    schedule();
    listeners.forEach((cb) => { try { cb(s); } catch {} });
  };
  const withExpiry = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user,
    expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600) });

  function schedule() {
    clearTimeout(refreshTimer);
    if (!session?.expires_at) return;
    const ms = session.expires_at * 1000 - Date.now() - 60_000;
    refreshTimer = setTimeout(() => refresh().catch(() => {}), Math.max(ms, 1000));
  }

  async function authReq(path, body, method = "POST", token) {
    const r = await fetch(`${url}/auth/v1${path}`, {
      method, headers: { apikey: anonKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new AuthError(j.msg || j.error_description || j.message || j.error || `Erro ${r.status}`, j.error_code || j.code);
    return j;
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    refreshing ??= (async () => {
      try { save(withExpiry(await authReq("/token?grant_type=refresh_token", { refresh_token: session.refresh_token }))); }
      catch (e) { if (e instanceof AuthError) save(null); throw e; }
      finally { refreshing = null; }
      return session;
    })();
    return refreshing;
  }

  async function token() {
    if (session && session.expires_at * 1000 - Date.now() < 30_000) await refresh().catch(() => {});
    return session?.access_token || anonKey;
  }

  const auth = {
    get session() { return session; },
    get user() { return session?.user ?? null; },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signUp({ email, password, data, redirectTo }) {
      const j = await authReq(`/signup${redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : ""}`, { email, password, data });
      if (j.access_token) save(withExpiry(j));
      return { session: j.access_token ? session : null, user: j.user ?? j };
    },
    async signIn({ email, password }) { save(withExpiry(await authReq("/token?grant_type=password", { email, password }))); return session; },
    async signOut() { try { if (session) await authReq("/logout", {}, "POST", session.access_token); } catch {} save(null); },
    async recover(email, redirectTo) { await authReq(`/recover${redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : ""}`, { email }); },
    async updateUser(attrs) { const u = await authReq("/user", attrs, "PUT", await token()); if (session) save({ ...session, user: u }); return u; },
    // retorno de links de e-mail (confirmação/recuperação): #access_token=...&refresh_token=...&type=...
    fromUrlHash(hash) {
      const p = new URLSearchParams(hash.replace(/^#/, ""));
      if (!p.get("access_token")) return null;
      const s = withExpiry({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
        expires_in: Number(p.get("expires_in") || 3600), expires_at: p.get("expires_at") ? Number(p.get("expires_at")) : undefined, user: null });
      save(s);
      authReq("/user", null, "GET", s.access_token).then((u) => save({ ...session, user: u })).catch(() => {});
      return { type: p.get("type") };
    },
    token, refresh,
  };
  schedule();

  async function rest(method, path, body, headers = {}) {
    let attempt = 0;
    for (;;) {
      const r = await fetch(`${url}/rest/v1${path}`, {
        method, headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.status === 401 && attempt++ === 0 && session) { await refresh().catch(() => {}); continue; }
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!r.ok) return { data: null, error: { status: r.status, message: data?.message || String(text), code: data?.code, details: data?.details, hint: data?.hint } };
      const range = r.headers.get("content-range");
      const count = range && range.includes("/") ? Number(range.split("/")[1]) : null;
      return { data, error: null, count };
    }
  }

  class Query {
    constructor(table) { this.table = table; this.method = "GET"; this.params = new URLSearchParams(); this.body = undefined; this.headers = {}; this.prefer = []; this.orders = []; this.isSingle = false; this.isMaybe = false; }
    select(cols = "*", opts = {}) { this.params.set("select", cols.replace(/\s+/g, "")); if (opts.count) this.prefer.push(`count=${opts.count}`); if (this.method !== "GET") this.prefer.push("return=representation"); return this; }
    insert(rows) { this.method = "POST"; this.body = rows; return this; }
    upsert(rows, { onConflict, ignoreDuplicates } = {}) { this.method = "POST"; this.body = rows; if (onConflict) this.params.set("on_conflict", onConflict); this.prefer.push(ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates"); return this; }
    update(patch) { this.method = "PATCH"; this.body = patch; return this; }
    delete() { this.method = "DELETE"; return this; }
    f(op, c, v) { this.params.append(c, `${op}.${v}`); return this; }
    eq(c, v) { return this.f("eq", c, v); }
    neq(c, v) { return this.f("neq", c, v); }
    gt(c, v) { return this.f("gt", c, v); }
    gte(c, v) { return this.f("gte", c, v); }
    lt(c, v) { return this.f("lt", c, v); }
    lte(c, v) { return this.f("lte", c, v); }
    ilike(c, v) { return this.f("ilike", c, v); }
    is(c, v) { return this.f("is", c, v); }
    in(c, arr) { return this.f("in", c, `(${arr.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")})`); }
    contains(c, arr) { return this.f("cs", c, `{${arr.join(",")}}`); }
    or(expr) { this.params.append("or", `(${expr})`); return this; }
    order(c, { ascending = true, nullsFirst } = {}) { this.orders.push(`${c}.${ascending ? "asc" : "desc"}${nullsFirst === undefined ? "" : nullsFirst ? ".nullsfirst" : ".nullslast"}`); return this; }
    limit(n) { this.params.set("limit", String(n)); return this; }
    single() { this.isSingle = true; return this; }
    maybeSingle() { this.isMaybe = true; return this; }
    async exec() {
      if (this.orders.length) this.params.set("order", this.orders.join(","));
      const h = { ...this.headers };
      const prefer = [...this.prefer];
      if (this.method !== "GET" && !prefer.some((p) => p.startsWith("return="))) prefer.push("return=minimal");
      if (prefer.length) h.Prefer = prefer.join(",");
      if (this.isSingle) h.Accept = "application/vnd.pgrst.object+json";
      const qs = this.params.toString();
      const r = await rest(this.method, `/${this.table}${qs ? "?" + qs : ""}`, this.body, h);
      if (this.isMaybe && !r.error) r.data = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
      return r;
    }
    then(res, rej) { return this.exec().then(res, rej); }
  }

  const storage = {
    from(bucket) {
      return {
        async upload(path, file, { upsert = false, contentType } = {}) {
          const r = await fetch(`${url}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
            method: "POST", body: file,
            headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "x-upsert": String(upsert), "Content-Type": contentType || file.type || "application/octet-stream", "cache-control": "3600" },
          });
          const j = await r.json().catch(() => ({}));
          return r.ok ? { data: { path }, error: null } : { data: null, error: { message: j.message || j.error || `Erro ${r.status}` } };
        },
        publicUrl(path) { return `${url}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`; },
        async signedUrl(path, expiresIn = 3600) {
          const r = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
            method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return { data: null, error: { message: j.message || `Erro ${r.status}` } };
          const s = j.signedURL || j.signedUrl;
          return { data: { url: s.startsWith("http") ? s : `${url}/storage/v1${s}` }, error: null };
        },
        async remove(paths) {
          const r = await fetch(`${url}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
          return r.ok ? { error: null } : { error: { message: `Erro ${r.status}` } };
        },
      };
    },
  };

  const functions = {
    url: (name) => `${url}/functions/v1/${name}`,
    async invoke(name, body) {
      const r = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { data: j, error: null } : { data: j, error: { status: r.status, message: j.error || `Erro ${r.status}` } };
    },
  };

  // Tempo real (protocolo Phoenix do Supabase Realtime). Se não conectar, as telas usam consulta periódica.
  const realtime = (() => {
    let ws = null, ref = 0, hb = null, open = false;
    const subs = new Map();
    const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    async function connect() {
      if (ws && ws.readyState <= 1) return;
      try { ws = new WebSocket(`${url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`); }
      catch { ws = null; return; }
      ws.onopen = async () => {
        open = true;
        hb = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), 25_000);
        for (const s of subs.values()) join(s, await token());
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        const s = subs.get(m.topic);
        if (!s) return;
        if (m.event === "phx_reply" && m.payload?.status === "ok") s.joined = true;
        if (m.event === "postgres_changes") {
          const d = m.payload?.data ?? m.payload;
          const rec = d?.record ?? d?.new ?? null;
          s.cb({ type: d?.type ?? d?.eventType, table: d?.table, record: rec, old: d?.old_record ?? d?.old });
        }
      };
      ws.onclose = () => { open = false; clearInterval(hb); subs.forEach((s) => (s.joined = false)); setTimeout(() => subs.size && connect(), 5000); };
      ws.onerror = () => {};
    }
    function join(s, access_token) {
      send({ topic: s.topic, event: "phx_join", ref: String(++ref), join_ref: String(ref),
        payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: s.changes }, access_token } });
    }
    auth.onChange((sess) => { if (sess) subs.forEach((s) => send({ topic: s.topic, event: "access_token", payload: { access_token: sess.access_token }, ref: String(++ref) })); });
    return {
      get connected() { return open; },
      isJoined(topic) { return !!subs.get("realtime:" + topic)?.joined; },
      subscribe(name, changes, cb) {
        const topic = "realtime:" + name;
        const s = { topic, changes, cb, joined: false };
        subs.set(topic, s);
        connect();
        if (open) token().then((t) => join(s, t));
        return () => { send({ topic, event: "phx_leave", payload: {}, ref: String(++ref) }); subs.delete(topic); };
      },
    };
  })();

  return { url, anonKey, auth, from: (t) => new Query(t), rpc: (fn, args = {}) => rest("POST", `/rpc/${fn}`, args), storage, functions, realtime };
}

export class AuthError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
