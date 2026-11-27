// Limpeza do registro da sincronizacao do Drive: apaga so o que e antigo e nunca mexe em dados de usuarios.
import { describe, expect, test, beforeAll } from "bun:test";
import { execSync } from "node:child_process";
import { newUser } from "./helpers";
const q = (s: string) => execSync("psql -h 127.0.0.1 -p 54322 -U postgres -At -v ON_ERROR_STOP=1", { input: s, encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
let org = "", userId = "";
beforeAll(async () => {
  const u = await newUser("Sync Limpeza"); userId = u.id;
  org = (await u.api.rpc("create_organization", { p_name: "Igreja Sync" })).data;
  q(`insert into sync_runs (id, org_id, trigger, started_at, status) values
      ('00000000-0000-0000-0000-0000000000a1','${org}', 'cron', now() - interval '20 days', 'ok'),
      ('00000000-0000-0000-0000-0000000000a2','${org}', 'cron', now() - interval '1 day', 'ok'),
      ('00000000-0000-0000-0000-0000000000a3','${org}', 'cron', now() - interval '30 days', 'running')`);
  q(`insert into sync_events (org_id, run_id, level, message, created_at) values
      ('${org}', '00000000-0000-0000-0000-0000000000a2', 'info', 'antigo', now() - interval '5 days'),
      ('${org}', '00000000-0000-0000-0000-0000000000a2', 'info', 'recente', now() - interval '1 day'),
      ('${org}', '00000000-0000-0000-0000-0000000000a3', 'info', 'da rodada em andamento', now() - interval '1 hour')`);
});
describe("sync_purge", () => {
  test("a funcao e fechada para usuarios", () => {
    expect(q("select has_function_privilege('authenticated','public.sync_purge()','execute')")).toBe("f");
  });
  test("apaga eventos com mais de 3 dias e rodadas com mais de 14, preserva o recente e rodada em andamento", () => {
    const r = JSON.parse(q("select public.sync_purge()"));
    expect(r.events).toBeGreaterThanOrEqual(1);
    expect(q(`select string_agg(message, ',' order by message) from sync_events where org_id='${org}'`)).toBe("da rodada em andamento,recente");
    expect(q(`select count(*) from sync_runs where id='00000000-0000-0000-0000-0000000000a1'`)).toBe("0");
    expect(q(`select count(*) from sync_runs where id in ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3')`)).toBe("2");
  });
  test("nao toca em musicas nem em outros dados", () => {
    expect(q(`select count(*) from organizations where id='${org}'`)).toBe("1");
    expect(q(`select count(*) from profiles where id='${userId}'`)).toBe("1");
  });
});
