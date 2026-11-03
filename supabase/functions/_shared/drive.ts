// Cliente da API oficial do Google Drive (v3) usando uma CONTA DE SERVIÇO (OAuth 2.0, fluxo JWT).
//
// Por que conta de serviço: ela não tem acesso a nada da conta da igreja. Ela só enxerga o que for
// COMPARTILHADO com o e-mail dela. Compartilhando apenas a pasta "multitracks" (como Leitor), o app
// consegue ler somente essa pasta e o que estiver dentro dela, e não consegue alterar os projetos.
// O escopo pedido é drive.readonly (somente leitura) — o alcance real fica limitado pelo compartilhamento.
// A chave da conta de serviço fica em um "secret" das Edge Functions e nunca vai para o navegador.

export interface DriveFile {
  id: string; name: string; mimeType: string; md5Checksum?: string; size?: string;
  modifiedTime?: string; parents?: string[]; trashed?: boolean; owners?: Array<{ emailAddress?: string; displayName?: string }>;
  capabilities?: { canEdit?: boolean; canDownload?: boolean };
}
export interface DriveClient {
  serviceEmail(): string;
  getFile(id: string): Promise<DriveFile>;
  listChildren(folderId: string): Promise<DriveFile[]>;
  downloadText(id: string): Promise<string>;
  downloadRange(id: string, start: number, end: number): Promise<Uint8Array>;
  media(id: string, range: string | null): Promise<Response>;
  watchChanges?(address: string, channelId: string, token: string, ttlMs: number): Promise<{ resourceId: string; expiration: string }>;
  startPageToken?(): Promise<string>;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

function b64url(bytes: Uint8Array | string) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem: string) {
  const b = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export class GoogleDrive implements DriveClient {
  private token: { value: string; exp: number } | null = null;
  private sa: ServiceAccount;
  constructor(serviceAccountJson: string) {
    this.sa = JSON.parse(serviceAccountJson);
    if (!this.sa.client_email || !this.sa.private_key) throw new Error("Credencial da conta de serviço inválida.");
  }
  serviceEmail() { return this.sa.client_email; }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64url(JSON.stringify({ iss: this.sa.client_email, scope: SCOPE, aud: this.sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
    const key = await crypto.subtle.importKey("pkcs8", pemToDer(this.sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`)));
    const r = await fetch(this.sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return this.token.value;
  }

  private async call(path: string, init: RequestInit = {}, retries = 3): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.accessToken()}` } });
      if ((r.status === 429 || r.status >= 500) && attempt < retries) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt + Math.random() * 300));
        continue;
      }
      if (!r.ok && r.status !== 206) {
        const t = await r.text();
        let msg = t; try { msg = JSON.parse(t).error?.message ?? t; } catch { /* texto */ }
        throw new DriveError(r.status, `Google Drive ${r.status}: ${msg}`);
      }
      return r;
    }
  }

  async getFile(id: string) {
    const r = await this.call(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,md5Checksum,size,modifiedTime,parents,trashed,owners(emailAddress,displayName),capabilities(canEdit,canDownload)`);
    return r.json() as Promise<DriveFile>;
  }
  async listChildren(folderId: string) {
    const out: DriveFile[] = [];
    let pageToken = "";
    do {
      const q = encodeURIComponent(`'${folderId.replace(/'/g, "")}' in parents and trashed = false`);
      const r = await this.call(`/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime,parents)${pageToken ? "&pageToken=" + pageToken : ""}`);
      const j = await r.json();
      out.push(...j.files);
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }
  async downloadText(id: string) {
    const r = await this.call(`/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    return new TextDecoder("utf-8").decode(new Uint8Array(await r.arrayBuffer()));
  }
  async downloadRange(id: string, start: number, end: number) {
    const r = await this.call(`/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Range: `bytes=${start}-${end}` } });
    return new Uint8Array(await r.arrayBuffer());
  }
  async media(id: string, range: string | null) {
    return this.call(`/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, range ? { headers: { Range: range } } : {});
  }
  async startPageToken() {
    const r = await this.call(`/changes/startPageToken?supportsAllDrives=true`);
    return (await r.json()).startPageToken as string;
  }
  async watchChanges(address: string, channelId: string, token: string, ttlMs: number) {
    const pt = await this.startPageToken();
    const r = await this.call(`/changes/watch?pageToken=${pt}&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channelId, type: "web_hook", address, token, expiration: Date.now() + ttlMs }),
    });
    const j = await r.json();
    return { resourceId: j.resourceId, expiration: new Date(Number(j.expiration)).toISOString() };
  }
}

export class DriveError extends Error { constructor(public status: number, msg: string) { super(msg); } }

// Extrai o ID de uma pasta a partir do link colado pelo administrador.
export function folderIdFromInput(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) ?? s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : null;
}
