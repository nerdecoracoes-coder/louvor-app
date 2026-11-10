import { describe, expect, test } from "bun:test";
import { parseKey, semitonesBetween, transposeKey, normKey } from "../app/lib/keys.js";

describe("tons", () => {
  test("lê tons com sustenido, bemol e menor", () => {
    expect(parseKey("F#m")).toEqual({ root: 6, minor: true });
    expect(parseKey("Bb")).toEqual({ root: 10, minor: false });
    expect(parseKey("Abm")).toEqual({ root: 8, minor: true });
    expect(parseKey("xyz")).toBeNull();
    expect(parseKey("")).toBeNull();
  });
  test("semitons pelo menor caminho", () => {
    expect(semitonesBetween("A", "D")).toBe(5);
    expect(semitonesBetween("A", "C")).toBe(3);
    expect(semitonesBetween("C", "A")).toBe(-3);
    expect(semitonesBetween("C", "F#")).toBe(6 - 12);
    expect(semitonesBetween("G", "G")).toBe(0);
    expect(semitonesBetween("Am", "C")).toBe(3);
    expect(semitonesBetween("", "C")).toBe(0);
  });
  test("transpor e normalizar", () => {
    expect(transposeKey("A", 3)).toBe("C");
    expect(transposeKey("Em", -5)).toBe("Bm");
    expect(normKey("Db")).toBe("C#");
    expect(normKey("estranho")).toBe("estranho");
    expect(normKey("")).toBeNull();
  });
});

import { isUnpitchedName } from "../app/player/engine.js";
test("faixas de bateria, percussão e loop não são transpostas; harmonia e melodia são", () => {
  for (const n of ["Bateria", "DRUMS", "Drum Kit", "Percussão", "Perc 2", "Loop", "Loops 1", "Click", "Guia", "Kick In", "Hi-Hat", "Overheads", "Cajón", "Bateria (L)"]) expect(isUnpitchedName(n)).toBe(true);
  for (const n of ["Baixo", "Violão", "Guitarra 1", "Teclado", "Pad", "Vocal Principal", "Backing", "Piano", "Cordas", "Sax"]) expect(isUnpitchedName(n)).toBe(false);
});
