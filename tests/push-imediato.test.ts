// Push imediato: o disparo na hora nunca pode atrapalhar a criacao de avisos e a configuracao e fechada.
import { describe, expect, test, beforeAll } from "bun:test";
import { execSync } from "node:child_process";
import { newUser } from "./helpers";

const q = (s: string) => execSync("psql -h 127.0.0.1 -p 54322 -U postgres -At -v ON_ERROR_STOP=1", { input: s, encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const fails = (s: string) => { try { q(s); return ""; } catch (e: any) { return String(e.stderr ?? e.message); } };
let u: any, org = "";

beforeAll(async () => {
  u = await newUser("Push Imediato");
  org = (await u.api.rpc("create_organization", { p_name: "Igreja Push" })).data;
  q("delete from push_cfg");
});

describe("push imediato", () => {
  test("o gatilho existe e a configuracao e fechada para usuarios", () => {
    expect(q("select exists (select 1 from pg_trigger where tgname='push_kick_trg' and not tgisinternal)")).toBe("t");
    expect(q("select has_function_privilege('authenticated','public.push_instant_set(text,text)','execute')")).toBe("f");
    expect(q("select has_table_privilege('authenticated','public.push_cfg','select')")).toBe("f");
  });
  test("valida a URL e o segredo", () => {
    expect(fails("select public.push_instant_set('http://x.supabase.co/functions/v1/push-send','0123456789abcdef0123')")).toContain("push_url_invalid");
    expect(fails("select public.push_instant_set('https://abc.supabase.co/functions/v1/push-send','curto')")).toContain("push_secret_short");
  });
  test("sem configuracao, criar aviso funciona e entra na fila", () => {
    q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${u.id}','https://example.com/e1','p','a') on conflict do nothing`);
    q(`insert into notifications (user_id, org_id, kind, title) values ('${u.id}','${org}','x','sem cfg')`);
    expect(q("select count(*) from push_outbox where title='sem cfg'")).toBe("1");
  });
  test("configurado, criar aviso nunca falha mesmo sem pg_net, e varios avisos na mesma transacao funcionam", () => {
    q("select public.push_instant_set('https://abc.supabase.co/functions/v1/push-send','0123456789abcdef0123')");
    q(`begin; insert into notifications (user_id, org_id, kind, title) values ('${u.id}','${org}','x','com cfg 1'),('${u.id}','${org}','x','com cfg 2'); commit;`);
    expect(q("select count(*) from push_outbox where title like 'com cfg%'")).toBe("2");
    q("delete from push_cfg");
  });
  test("com pg_net simulado: chama push-send com o segredo, uma vez por transacao", () => {
    q("create schema if not exists net; create table if not exists net.calls (url text, headers jsonb); create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ insert into net.calls values (url, headers) returning 1::bigint $$;");
    q("truncate net.calls; delete from push_cfg");
    q("select public.push_instant_set('https://abc.supabase.co/functions/v1/push-send','0123456789abcdef0123')");
    q(`begin; insert into notifications (user_id, org_id, kind, title) values ('${u.id}','${org}','x','lote 1'),('${u.id}','${org}','x','lote 2'),('${u.id}','${org}','x','lote 3'); commit;`);
    expect(q("select count(*) from net.calls")).toBe("1");
    expect(q("select url from net.calls")).toBe("https://abc.supabase.co/functions/v1/push-send");
    expect(q("select headers->>'x-cron-secret' from net.calls")).toBe("0123456789abcdef0123");
    q(`insert into notifications (user_id, org_id, kind, title) values ('${u.id}','${org}','x','outra')`);
    expect(q("select count(*) from net.calls")).toBe("2");
    q("drop schema net cascade; delete from push_cfg");
  });
});
