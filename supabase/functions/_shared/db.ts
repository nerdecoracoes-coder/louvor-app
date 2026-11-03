// Acesso ao banco pela API REST do Supabase (PostgREST) usando a chave de serviço do servidor.
// Só é usado dentro das Edge Functions; a chave nunca chega ao navegador.
export class Db {
  constructor(private rest: string, private key: string) {}  // rest = <SUPABASE_URL>/rest/v1
  private async req(method: string, path: string, body?: unknown, prefer = "return=representation") {
    const r = await fetch(`${this.rest}${path}`, {
      method,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`DB ${method} ${path.split("?")[0]}: ${r.status} ${t}`);
    return t ? JSON.parse(t) : null;
  }
  select<T = any>(table: string, query = ""): Promise<T[]> { return this.req("GET", `/${table}${query ? "?" + query : ""}`); }
  async one<T = any>(table: string, query: string): Promise<T | null> { return (await this.select<T>(table, query))[0] ?? null; }
  insert<T = any>(table: string, rows: unknown): Promise<T[]> { return this.req("POST", `/${table}`, rows); }
  upsert<T = any>(table: string, rows: unknown, onConflict: string): Promise<T[]> {
    return this.req("POST", `/${table}?on_conflict=${onConflict}`, rows, "return=representation,resolution=merge-duplicates");
  }
  update<T = any>(table: string, filter: string, patch: unknown): Promise<T[]> { return this.req("PATCH", `/${table}?${filter}`, patch); }
  delete(table: string, filter: string) { return this.req("DELETE", `/${table}?${filter}`, undefined, "return=minimal"); }
  rpc<T = any>(fn: string, args: unknown): Promise<T> { return this.req("POST", `/rpc/${fn}`, args); }
}

// Consulta feita COM o login do usuário (respeita RLS): usada para checar permissões.
export async function asUser(rest: string, anonKey: string, userJwt: string, fn: string, args: unknown) {
  const r = await fetch(`${rest}/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) return null;
  return r.json();
}

export const q = (v: string) => encodeURIComponent(v);
