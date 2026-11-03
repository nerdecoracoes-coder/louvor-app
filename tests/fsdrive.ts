// SOMENTE PARA TESTES: implementa a mesma interface do cliente do Google Drive sobre uma pasta local,
// para exercitar a lógica de sincronização (novas pastas, alterações, exclusões, envio incompleto).
// Não é usado em produção e não substitui o teste com o Drive real.
import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { FOLDER_MIME, type DriveClient, type DriveFile } from "../supabase/functions/_shared/drive.ts";

export class FsDrive implements DriveClient {
  calls = 0;
  constructor(public root: string) {}
  serviceEmail() { return "teste@projeto.iam.gserviceaccount.com"; }
  // ID estável por caminho (como o ID do Drive, não muda quando o conteúdo muda)
  idOf(p: string) { return "fs_" + createHash("sha1").update(p).digest("hex").slice(0, 24); }
  private pathOf(id: string, dir = this.root): string | null {
    if (this.idOf(dir) === id) return dir;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (this.idOf(p) === id) return p;
      if (statSync(p).isDirectory()) { const r = this.pathOf(id, p); if (r) return r; }
    }
    return null;
  }
  private meta(p: string): DriveFile {
    const st = statSync(p);
    const dir = st.isDirectory();
    return { id: this.idOf(p), name: basename(p), mimeType: dir ? FOLDER_MIME : "application/octet-stream",
      md5Checksum: dir ? undefined : createHash("md5").update(readFileSync(p)).digest("hex"),
      size: dir ? undefined : String(st.size), modifiedTime: st.mtime.toISOString(), capabilities: { canEdit: false, canDownload: true } };
  }
  async getFile(id: string) { this.calls++; const p = this.pathOf(id); if (!p) throw new Error("Google Drive 404: File not found"); return this.meta(p); }
  async listChildren(id: string) {
    this.calls++;
    const p = this.pathOf(id); if (!p) throw new Error("Google Drive 404");
    return readdirSync(p).map((n) => this.meta(join(p, n)));
  }
  async downloadText(id: string) { this.calls++; return readFileSync(this.pathOf(id)!, "utf8"); }
  async downloadRange(id: string, start: number, end: number) {
    this.calls++;
    const fd = openSync(this.pathOf(id)!, "r");
    const buf = Buffer.alloc(end - start + 1);
    const n = readSync(fd, buf, 0, buf.length, start); closeSync(fd);
    return new Uint8Array(buf.subarray(0, n));
  }
  async media(id: string, range: string | null) {
    const p = this.pathOf(id); if (!p) return new Response("not found", { status: 404 });
    const size = statSync(p).size;
    const m = range?.match(/bytes=(\d+)-(\d*)/);
    if (!m) return new Response(readFileSync(p), { status: 200, headers: { "Content-Length": String(size) } });
    const s = Number(m[1]); const e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const bytes = await this.downloadRange(id, s, e);
    return new Response(bytes, { status: 206, headers: { "Content-Range": `bytes ${s}-${e}/${size}`, "Content-Length": String(bytes.length) } });
  }
}
