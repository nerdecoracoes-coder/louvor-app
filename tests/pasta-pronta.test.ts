import { expect, test } from "bun:test";
import { folderReadiness } from "../supabase/functions/_shared/sync.ts";

const f = (name: string, relPath = name) => ({ id: name, name, relPath, md5: null, size: 1, modifiedTime: null, mimeType: "" });

test("pronta: projeto no padrão exato + foto JPEG na pasta", () => {
  expect(folderReadiness([f("Emaús - Morada - 140 BPM (B).rpp"), f("foto.jpg")]).ready).toBe(true);
  expect(folderReadiness([f("Te Louvarei - Ao Vivo - Morada - 72 BPM (F#m).RPP"), f("capa.JPEG")]).ready).toBe(true);
});
test("incompleta: falta foto, nome fora do padrão ou imagem que não é JPEG", () => {
  expect(folderReadiness([f("Emaús - Morada - 140 BPM (B).rpp")])).toMatchObject({ ready: false });
  expect(folderReadiness([f("Emaús - Morada.rpp"), f("foto.jpg")])).toMatchObject({ ready: false });
  expect(folderReadiness([f("Emaús - Morada - 140 BPM.rpp"), f("foto.jpg")])).toMatchObject({ ready: false });
  expect(folderReadiness([f("Emaús - Morada - 140 BPM (B).rpp"), f("foto.png")])).toMatchObject({ ready: false });
  expect(folderReadiness([f("Emaús - Morada - 140 BPM (B).rpp"), f("Tracks/foto.jpg", "Tracks/foto.jpg")])).toMatchObject({ ready: false });
});
