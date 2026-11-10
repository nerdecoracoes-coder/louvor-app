import { expect, test } from "bun:test";
import { repeatDates, monthlyDate, repeatUntilDefault, repeatLabel } from "../app/lib/repeat.js";

test("toda semana: todas as quintas-feiras até o fim do mês", () => {
  const until = repeatUntilDefault("2026-11-12", "weekly");
  expect(until).toBe("2026-11-30");
  expect(repeatDates("2026-11-12", "weekly", until)).toEqual(["2026-11-12", "2026-11-19", "2026-11-26"]);
  expect(repeatLabel("weekly", "2026-11-12")).toBe("Toda quinta-feira");
});

test("toda semana no fim do mês avança para o mês seguinte (não cria uma escala só)", () => {
  expect(repeatDates("2026-11-26", "weekly", repeatUntilDefault("2026-11-26", "weekly")).length).toBeGreaterThan(1);
});

test("a cada 2 semanas mantém o dia da semana", () => {
  expect(repeatDates("2026-11-12", "biweekly", "2026-12-31")).toEqual(["2026-11-12", "2026-11-26", "2026-12-10", "2026-12-24"]);
});

test("todo mês: o 3º sábado de cada mês", () => {
  expect(repeatLabel("monthly", "2026-11-21")).toBe("Todo mês (3º sábado)");
  expect([1, 2, 3].map((i) => monthlyDate("2026-11-21", i))).toEqual(["2026-12-19", "2027-01-16", "2027-02-20"]);
  expect(repeatDates("2026-11-21", "monthly", "2027-02-28")).toEqual(["2026-11-21", "2026-12-19", "2027-01-16", "2027-02-20"]);
});

test("todo mês: 1ª segunda e último domingo", () => {
  expect(monthlyDate("2026-11-02", 1)).toBe("2026-12-07");
  expect(repeatLabel("monthly", "2026-11-29")).toBe("Todo mês (último domingo)");
  expect(monthlyDate("2026-11-29", 1)).toBe("2026-12-27");
  expect(monthlyDate("2026-11-29", 3)).toBe("2027-02-28");
});

test("todo mês: 12 meses por padrão", () => {
  expect(repeatDates("2026-11-21", "monthly", repeatUntilDefault("2026-11-21", "monthly"))).toHaveLength(12);
});
