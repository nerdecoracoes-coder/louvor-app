// Bibliotecas do módulo de pessoas: planilha .xlsx/.csv, mapeamento de colunas e QR Code.
import { describe, expect, test } from "bun:test";
import { readXlsx, readCsv, buildXlsx } from "../app/lib/xlsx.js";
import { mapRows, templateXlsx, toIsoDate, TEMPLATE_HEADERS } from "../app/lib/pessoas-import.js";
import { qrMatrix, qrSvg } from "../app/lib/qr.js";

describe("planilha", () => {
  test("o modelo oferecido para download volta a ser lido com as colunas certas", async () => {
    const rows = await readXlsx(templateXlsx());
    expect(rows[0]).toEqual(TEMPLATE_HEADERS);
    const { records, missing } = mapRows(rows);
    expect(missing).toEqual([]); expect(records.length).toBe(2);
    expect(records[0]).toMatchObject({ full_name: "Maria da Silva", birth_date: "1985-03-15", classification: "member", marital_status: "casado", state: "RJ", joined_at: "2015-02-10" });
    expect(records[1]).toMatchObject({ full_name: "João Pereira", classification: "visitor", marital_status: "solteiro" });
  });
  test("planilha feita no Excel (texto compartilhado, datas em número, colunas extras e linhas vazias)", async () => {
    const buf = new Uint8Array(await Bun.file(import.meta.dir + "/fixtures/pessoas.xlsx").arrayBuffer());
    const { records, ignored } = mapRows(await readXlsx(buf));
    expect(ignored).toEqual(["Observação extra"]);
    expect(records.map((r: any) => r.full_name)).toEqual(["Ana Lúcia", "Bruno <&> Silva", "Carla"]);
    expect(records[0]).toMatchObject({ phone: "(21) 99999-1111", cpf: "529.982.247-25", classification: "member", marital_status: "casado", zip: "24000-000" });
    expect(records[1]).toMatchObject({ birth_date: "1990-05-17", classification: "attender" });
    expect(records[2]).toMatchObject({ birth_date: "1975-12-03", classification: "visitor" });
  });
  test("texto com caracteres especiais sobrevive à escrita e leitura", async () => {
    const rows = await readXlsx(buildXlsx([{ name: "A & B", rows: [["Nome completo"], ['José "Zé" <d\'Ávila> & Cia']] }]));
    expect(rows[1][0]).toBe('José "Zé" <d\'Ávila> & Cia');
  });
  test("csv com ; e aspas", () => {
    const rows = readCsv('Nome completo;E-mail;Cidade\r\n"Silva; João";j@x.com;"Rio ""Maravilha"""\n');
    expect(rows[1]).toEqual(["Silva; João", "j@x.com", 'Rio "Maravilha"']);
  });
  test("sem a coluna de nome, avisa", () => { expect(mapRows([["E-mail"], ["a@b.com"]]).missing).toEqual(["Nome completo"]); });
  test("datas", () => { expect(toIsoDate("5/3/85")).toBe("1985-03-05"); expect(toIsoDate("45000")).toBe("2023-03-15"); expect(toIsoDate("")).toBe(""); });
});

describe("QR Code", () => {
  test("gera matriz quadrada com os padrões de localização", () => {
    const m = qrMatrix("https://exemplo.com/#/cadastro/abc");
    expect(m.length).toBe(m[0].length); expect((m.length - 17) % 4).toBe(0);
    for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) { expect(m[r][c]).toBe(true); expect(m[r + 3][c + 3]).toBe(true); expect(m[r + 1][c + 1]).toBe(false); }
  });
  test("svg e limite de tamanho", () => {
    expect(qrSvg("oi")).toContain("<svg");
    expect(() => qrMatrix("x".repeat(300))).toThrow();
  });
});
