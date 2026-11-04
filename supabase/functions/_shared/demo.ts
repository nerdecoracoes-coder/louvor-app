// Integrantes de teste: contas fictícias com prazo, criadas pelo administrador para testar o app.
// Usa a API administrativa do Supabase Auth (chave de serviço, só no servidor).
import type { Db } from "./db.ts";

export interface DemoEnv { auth: string; serviceKey: string }

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

async function admin(env: DemoEnv, method: string, path: string, body?: unknown) {
  const r = await fetch(`${env.auth}/admin/${path}`, {
    method, headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(`Auth ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

export async function createDemo(env: DemoEnv, db: Db, p: { orgId: string; teamId: string; count: number; days: number; by: string }) {
  const team = await db.one("teams", `id=eq.${p.teamId}&org_id=eq.${p.orgId}`);
  if (!team) throw new Error("Time não encontrado.");
  const roles: any[] = await db.select("music_roles", `org_id=eq.${p.orgId}&or=(team_type.eq.${team.team_type},team_type.is.null)&order=sort`);
  const existing: any[] = await db.select("demo_users", `org_id=eq.${p.orgId}&team_id=eq.${p.teamId}&select=label`);
  const used = new Set(existing.map((x) => x.label));
  const expires = new Date(Date.now() + p.days * 864e5).toISOString();
  const out: { name: string; email: string; password: string; role: string | null }[] = [];
  for (let i = 0; i < p.count; i++) {
    const role = roles.length ? roles[(existing.length + i) % roles.length] : null;
    let name = `Teste · ${role?.name ?? "Integrante"}`;
    for (let k = 2; used.has(name); k++) name = `Teste · ${role?.name ?? "Integrante"} ${k}`;
    used.add(name);
    const email = `teste-${rand(8)}@exemplo.com`, password = `${rand(4)}-${rand(4)}-${rand(4)}`;
    const u = await admin(env, "POST", "users", { email, password, email_confirm: true, user_metadata: { full_name: name, demo: true } });
    const uid = u.id ?? u.user?.id;
    try {
      await db.insert("org_members", { org_id: p.orgId, user_id: uid, role: "member", display_name: name });
      await db.insert("team_members", { team_id: p.teamId, user_id: uid, org_id: p.orgId });
      if (role) await db.insert("team_member_roles", { team_id: p.teamId, user_id: uid, role_id: role.id, org_id: p.orgId });
      await db.insert("demo_users", { user_id: uid, org_id: p.orgId, team_id: p.teamId, label: name, email, created_by: p.by, expires_at: expires });
    } catch (e) { await admin(env, "DELETE", `users/${uid}`).catch(() => {}); throw e; }
    out.push({ name, email, password, role: role?.name ?? null });
  }
  return { users: out, expires_at: expires };
}

export async function deleteDemo(env: DemoEnv, db: Db, filter: string) {
  const rows: any[] = await db.select("demo_users", `${filter}&select=user_id`);
  for (const r of rows) await admin(env, "DELETE", `users/${r.user_id}`);
  return rows.length;
}

// chamada pela verificação agendada: apaga as contas de teste vencidas
export const cleanupDemo = (env: DemoEnv, db: Db) => deleteDemo(env, db, `expires_at=lt.${encodeURIComponent(new Date().toISOString())}`);
