// "Já escalado neste horário": só conta escala que se sobrepõe ao horário do evento, não o dia inteiro.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, pessoa: any, org = "", team = "";
const dia = new Date(Date.now() + 6 * 86400e3); dia.setUTCHours(0, 0, 0, 0);
const hora = (h: number, m = 0) => new Date(dia.getTime() + (h * 60 + m) * 60e3).toISOString();   // UTC; só a diferença entre horários importa

const contagem = async (starts: string, ends: string | null = null) =>
  (await admin.api.rpc("schedule_candidates", { p_team: team, p_starts: starts, p_ends: ends, p_exclude_schedule: null })).data.find((c: any) => c.user_id === pessoa.id).same_day_count;

beforeAll(async () => {
  [admin, pessoa] = await Promise.all(["Admin H", "Pessoa H"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Horário" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor H", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, pessoa);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [pessoa.id] });
  const role = (await admin.api.post("music_roles", { org_id: org, name: "Vocal H" })).data[0].id;
  await admin.api.post("team_member_roles", { team_id: team, user_id: pessoa.id, role_id: role, org_id: org });
  const manha = (await admin.api.post("schedules", { org_id: org, team_id: team, title: "Culto da manhã", starts_at: hora(12, 30), ends_at: hora(14, 30), created_by: admin.id })).data[0].id;
  await admin.api.post("schedule_assignments", { schedule_id: manha, org_id: org, team_id: team, user_id: pessoa.id });
});

describe("conflito por horário", () => {
  test("o culto da noite, no mesmo dia, não conta o culto da manhã", async () => {
    expect(await contagem(hora(22, 30))).toBe(0);
  });
  test("o mesmo horário conta", async () => {
    expect(await contagem(hora(12, 30))).toBe(1);
  });
  test("um evento que começa no meio do outro também conta", async () => {
    expect(await contagem(hora(13, 30))).toBe(1);
  });
  test("começar logo depois do fim do outro não conta", async () => {
    expect(await contagem(hora(14, 30))).toBe(0);
  });
});
