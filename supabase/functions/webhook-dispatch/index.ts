// Edge Function: envia os webhooks pendentes (e refaz os que falharam, com espera crescente). Chamada a cada 1–5 min por agendamento.
// Secrets: CRON_SECRET (cabeçalho x-cron-secret). Só envia para endereços https públicos (endereços internos são bloqueados após consultar o DNS).
import { dispatchHandler } from "../_shared/integ.ts";

const env = { rest: Deno.env.get("SUPABASE_URL")! + "/rest/v1", serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, cronSecret: Deno.env.get("CRON_SECRET") };
const resolveDns = async (host: string) => {
  const out: string[] = [];
  for (const t of ["A", "AAAA"] as const) { try { out.push(...(await Deno.resolveDns(host, t))); } catch { /* sem registro deste tipo */ } }
  return out;
};
Deno.serve(dispatchHandler(env, { resolveDns }));
