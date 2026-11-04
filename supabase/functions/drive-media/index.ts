// Edge Function: entrega os áudios do Drive ao player (com checagem de permissão e suporte a intervalos de bytes).
import { handleMedia } from "../_shared/handlers.ts";
import { GoogleDrive, type DriveClient } from "../_shared/drive.ts";
import { r2FromEnv } from "../_shared/r2.ts";

let drive: DriveClient | null = null;
const env = {
  rest: Deno.env.get("SUPABASE_URL")! + "/rest/v1",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  drive: () => (drive ??= new GoogleDrive(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") ?? "{}")),
  r2: r2FromEnv((k) => Deno.env.get(k)),
};
Deno.serve((req) => handleMedia(req, env));
