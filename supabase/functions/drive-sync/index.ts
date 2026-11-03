// Edge Function: sincronização com o Google Drive (agendada, por aviso do Drive e pelo painel do administrador).
// Secrets necessários: GOOGLE_SERVICE_ACCOUNT (JSON da conta de serviço) e CRON_SECRET.
import { handleSync } from "../_shared/handlers.ts";
import { GoogleDrive, type DriveClient } from "../_shared/drive.ts";

let drive: DriveClient | null = null;
const env = {
  rest: Deno.env.get("SUPABASE_URL")! + "/rest/v1",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  cronSecret: Deno.env.get("CRON_SECRET"),
  publicUrl: Deno.env.get("SUPABASE_URL")! + "/functions/v1/drive-sync",
  drive: () => (drive ??= new GoogleDrive(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") ?? "{}")),
  // deno-lint-ignore no-explicit-any
  background: (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(p) : p,
};
Deno.serve((req) => handleSync(req, env));
