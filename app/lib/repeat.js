// Regras de repetição de escalas: toda semana = mesmo dia da semana; todo mês = mesma posição no mês (ex.: 3º sábado).
export const MAX_REPEAT = 26;
const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
export const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
export const DOW_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const ORD = ["1º", "2º", "3º", "4º", "último"];
// "o 3º sábado do mês": posição do dia da semana dentro do mês (a 5ª ocorrência vira "o último")
export const nthDow = (d) => { const x = new Date(d + "T12:00:00"); return { dow: x.getDay(), n: Math.min(5, Math.ceil(x.getDate() / 7)) }; };
export const monthlyDate = (d, i) => {
  const { dow, n } = nthDow(d), b = new Date(d + "T12:00:00"), y = b.getFullYear(), m = b.getMonth() + i;
  const dim = new Date(y, m + 1, 0).getDate();
  let day = 1 + ((dow - new Date(y, m, 1).getDay() + 7) % 7) + (n - 1) * 7;
  while (day > dim) day -= 7;
  return ymd(new Date(y, m, day, 12));
};
export const repeatLabel = (kind, d) => { const { dow, n } = nthDow(d); return kind === "weekly" ? `Toda ${DOW_LONG[dow]}` : kind === "biweekly" ? `A cada 2 semanas (${DOW_LONG[dow]})` : `Todo mês (${ORD[n - 1]} ${DOW_LONG[dow]})`; };
// todas as datas da repetição, da primeira até `until`: toda semana = mesmo dia da semana; todo mês = mesma posição no mês (ex.: 3º sábado)
export const repeatDates = (date, kind, until) => {
  const out = [date];
  for (let i = 1; out.length < MAX_REPEAT; i++) { const d = kind === "monthly" ? monthlyDate(date, i) : addDays(date, (kind === "weekly" ? 7 : 14) * i); if (d > until) break; out.push(d); }
  return out;
};
export const repeatUntilDefault = (date, kind) => {
  const x = new Date(date + "T12:00:00");
  if (kind === "monthly") return monthlyDate(date, 11);                       // 12 meses
  const eom = ymd(new Date(x.getFullYear(), x.getMonth() + 1, 0, 12));        // toda semana: até o fim do mês
  return repeatDates(date, kind, eom).length > 1 ? eom : ymd(new Date(x.getFullYear(), x.getMonth() + 2, 0, 12));
};
