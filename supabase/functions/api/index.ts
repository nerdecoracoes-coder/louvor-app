// Edge Function: API pública do SOMOS (v1, somente leitura). Endereço: <SUPABASE_URL>/functions/v1/api/v1/...
// Autenticação por chave de API (Authorization: Bearer somos_live_...), gerada em SOMOS Chamados → Integrações.
// Documentação: docs/api.md. Não usa o login de usuário (verify_jwt = false); toda a conferência é feita pela chave.
import { handleApi } from "../_shared/integ.ts";

const env = {
  rest: Deno.env.get("SUPABASE_URL")! + "/rest/v1",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  // deno-lint-ignore no-explicit-any
  background: (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(p) : p,
};
Deno.serve((req) => handleApi(req, env));
