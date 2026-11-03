import { describe, expect, test, beforeAll } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseProjectName, bestName } from "../supabase/functions/_shared/naming.ts";
import { parseRpp, tokenize } from "../supabase/functions/_shared/rpp.ts";
import { parseWavHeader } from "../supabase/functions/_shared/wav.ts";
import { resolveRef, type FolderFile } from "../supabase/functions/_shared/resolve.ts";
import { makeProject } from "./fixtures/make-project.ts";

const ROOT = "/tmp/claude-0/fixtures-unit";
let dir = "";
beforeAll(async () => { dir = (await makeProject({ root: ROOT })).dir; });

describe("convenção de nomes", () => {
  test("exemplo do ministério", () => {
    expect(parseProjectName("Emaús - Morada - 140 BPM (B).rpp")).toMatchObject({ title: "Emaús", artist: "Morada", bpm: 140, key: "B", matched: true });
  });
  test("título com hífen e com ' - '", () => {
    expect(parseProjectName("Pós-Tudo - Gabriela Rocha - 72 BPM (G)")).toMatchObject({ title: "Pós-Tudo", artist: "Gabriela Rocha", bpm: 72, key: "G" });
    expect(parseProjectName("Te Louvarei - Ao Vivo - Morada - 140 BPM (B)")).toMatchObject({ title: "Te Louvarei - Ao Vivo", artist: "Morada" });
  });
  test("tons com acidente e menor; BPM decimal; travessão", () => {
    expect(parseProjectName("Oceans - Hillsong – 66,5 bpm (C#m)")).toMatchObject({ bpm: 66.5, key: "C#m", artist: "Hillsong" });
    expect(parseProjectName("A - B - 90 BPM (bb)").key).toBe("Bb");
    expect(parseProjectName("A - B - 90 BPM (F♯)").key).toBe("F#");
  });
  test("nome fora do padrão não inventa dados", () => {
    const p = parseProjectName("Musica Nova");
    expect(p).toMatchObject({ title: "Musica Nova", artist: null, bpm: null, key: null, matched: false });
    const q = parseProjectName("Emaús - Morada");
    expect(q).toMatchObject({ title: "Emaús", artist: "Morada", bpm: null, key: null, matched: false });
    const r = parseProjectName("X - Y - 120 BPM (Ré)");
    expect(r.key).toBe("Ré"); expect(r.warnings.length).toBe(1);
  });
  test("prefere o nome completo do .rpp ao da pasta", () => {
    expect(bestName("Emaús - Morada - 140 BPM (B).rpp", "Emaús - Morada")).toMatchObject({ title: "Emaús", bpm: 140, key: "B", from: "rpp" });
  });
});

describe("leitor .RPP", () => {
  test("tokenizer com aspas", () => {
    expect(tokenize(`MARKER 2 3.4 "Verso 1" 1 0`)).toEqual(["MARKER", "2", "3.4", "Verso 1", "1", "0"]);
    expect(tokenize(`NAME 'It"s'`)).toEqual(["NAME", `It"s`]);
  });

  test("projeto de teste completo", () => {
    const p = parseRpp(readFileSync(join(dir, "Emaús - Morada - 140 BPM (B).rpp"), "utf8"));
    expect(p.tempo).toBe(140); expect(p.timeSigNum).toBe(4); expect(p.timeSigDen).toBe(4);
    expect(p.sampleRate).toBe(48000);
    expect(p.tracks.map((t) => t.name)).toEqual(["Click", "Guide", "Drums", "Bass", "Keys", "BGVS", "BGV Alto", "BGV Tenor", "Pad", "LETRA"]);
    const by = Object.fromEntries(p.tracks.map((t) => [t.name, t]));
    expect(by.Guide.volume).toBeCloseTo(0.7);
    expect(by.Keys.pan).toBeCloseTo(-0.4);
    expect(by.Keys.fx).toEqual(["ReaEQ (Cockos)"]);
    expect(by.BGVS.kind).toBe("folder");
    expect(by["BGV Alto"].parentIdx).toBe(5);
    expect(by["BGV Tenor"].parentIdx).toBe(5);
    expect(by.Pad.parentIdx).toBeNull();
    expect(by.Pad.items[0]).toMatchObject({ position: 4, offset: 1, volume: 0.5, fadeIn: 0.5 });
    expect(by.Pad.warnings.join()).toContain("Automação de volume");
    expect(by.LETRA.kind).toBe("lyrics");
    expect(p.lyrics?.items[0]).toMatchObject({ position: 3.428571, notes: "Linha de teste 1\nLinha de teste 2" });
    // marcadores e região
    expect(p.markers.map((m) => [m.name, m.isRegion])).toEqual([["Intro", false], ["Verso 1", true], ["Refrão", false], ["Final", false]]);
    expect(p.markers[1].end).toBeCloseTo(6.857143);
    expect(p.length).toBe(12);
  });

  test("mute/solo e volume do master", () => {
    const txt = `<REAPER_PROJECT 0.1 "7.0"\n TEMPO 90 3 4\n MASTER_VOLUME 0.5 0.1 -1 -1 1\n MASTERMUTESOLO 1\n <TRACK\n NAME A\n MUTESOLO 1 0 0\n >\n <TRACK\n NAME B\n MUTESOLO 0 2 0\n MAINSEND 0 0\n >\n>`;
    const p = parseRpp(txt);
    expect(p.master).toEqual({ volume: 0.5, pan: 0.1, muted: true });
    expect(p.timeSigNum).toBe(3);
    expect(p.tracks[0].muted).toBe(true);
    expect(p.tracks[1].soloed).toBe(true);
    expect(p.tracks[1].sendsToParent).toBe(false);
  });

  test("takes múltiplos usam o take ativo e geram aviso", () => {
    const txt = `<REAPER_PROJECT 0.1\n <TRACK\n NAME V\n <ITEM\n POSITION 0\n LENGTH 5\n <SOURCE WAVE\n FILE "a.wav"\n >\n TAKE SEL\n NAME b\n <SOURCE WAVE\n FILE "b.wav"\n >\n >\n >\n>`;
    const it = parseRpp(txt).tracks[0].items[0];
    expect(it.fileRef).toBe("b.wav");
    expect(it.warnings.join()).toContain("2 takes");
  });

  test("arquivo inválido gera erro claro", () => {
    expect(() => parseRpp("hello")).toThrow("não é um projeto REAPER");
    expect(() => parseRpp("<REAPER_PROJECT 0.1\n <TRACK\n")).toThrow("incompleto");
  });
});

describe("WAV e associação de arquivos", () => {
  const list = (): FolderFile[] => {
    const out: FolderFile[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push({ id: p, name: n, relPath: relative(dir, p) }); });
    walk(dir); return out;
  };
  test("cabeçalhos 16/24/float", () => {
    const h = (f: string) => parseWavHeader(new Uint8Array(readFileSync(join(dir, "Tracks 1", f)).subarray(0, 65536)));
    expect(h("Click.wav")).toMatchObject({ codec: "pcm", bits: 16, channels: 1, sampleRate: 48000 });
    expect(h("Guide.wav")).toMatchObject({ codec: "pcm", bits: 24, channels: 1 });
    expect(h("Bass.wav")).toMatchObject({ codec: "float", bits: 32 });
    expect(h("Drums.wav").channels).toBe(2);
    expect(h("Click.wav").duration).toBeCloseTo(12, 2);
  });
  test("caminhos relativos, absolutos do Windows e só o nome", () => {
    const files = list();
    expect(resolveRef("Tracks 1\\Click.wav", files).how).toBe("relative");
    const abs = resolveRef("C:\\Users\\Ministerio\\Desktop\\Emaús - Morada\\Tracks 1\\Guide.wav", files);
    expect(abs.how).toBe("suffix"); expect(abs.file?.name).toBe("Guide.wav");
    expect(resolveRef("Bass.wav", files)).toMatchObject({ how: "name" });
    expect(resolveRef("Tracks 1/Nao Existe.wav", files).how).toBe("missing");
  });
});
