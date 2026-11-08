// Ensaios da escala: vários por escala, só o líder grava e os escalados recebem aviso.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, membro: any, outro: any, fora: any;
let org = "", team = "", sch = "", reh = "";

beforeAll(async () => {
  [admin, lider, membro, outro, fora] = await Promise.all(["Admin E", "Lider E", "Membro E", "Outro E", "Fora E"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Ensaio" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, membro, outro);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id, membro.id, outro.id] });
  await admin.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
  const when = new Date(Date.now() + 5 * 864e5);
  sch = (await lider.api.post("schedules", { org_id: org, team_id: team, title: "Culto E", starts_at: when.toISOString(), status: "draft" })).data[0].id;
  await lider.api.post("schedule_assignments", { schedule_id: sch, org_id: org, team_id: team, user_id: membro.id });
});

const notes = async (u: any) => (await u.api.get(`/notifications?kind=eq.rehearsal&order=created_at`)).data;

describe("ensaios", () => {
  test("rascunho: o líder marca ensaios e ninguém é avisado", async () => {
    const at = new Date(Date.now() + 2 * 864e5).toISOString();
    const r = await lider.api.post("schedule_rehearsals", [
      { schedule_id: sch, org_id: org, team_id: team, starts_at: at, notes: "Repertório novo" },
      { schedule_id: sch, org_id: org, team_id: team, starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), notes: null },
    ]);
    expect(r.status).toBe(201);
    reh = (await lider.api.get(`/schedule_rehearsals?schedule_id=eq.${sch}&order=starts_at`)).data[0].id;
    expect((await notes(membro)).length).toBe(0);
  });

  test("quem não lidera não grava; quem é de fora não vê", async () => {
    expect((await membro.api.post("schedule_rehearsals", { schedule_id: sch, org_id: org, team_id: team, starts_at: new Date().toISOString() })).ok).toBe(false);
    expect((await membro.api.get(`/schedule_rehearsals?schedule_id=eq.${sch}`)).data).toHaveLength(2);
    expect((await fora.api.get(`/schedule_rehearsals?schedule_id=eq.${sch}`)).data).toHaveLength(0);
  });

  test("com a escala publicada: marcar, mudar o horário e cancelar avisam só os escalados", async () => {
    await lider.api.patch(`schedules?id=eq.${sch}`, { status: "published" });
    const novo = await lider.api.post("schedule_rehearsals", { schedule_id: sch, org_id: org, team_id: team, starts_at: new Date(Date.now() + 4 * 864e5).toISOString(), notes: "Passagem de som" });
    expect(novo.status).toBe(201);
    let n = await notes(membro);
    expect(n.length).toBe(1);
    expect(n[0].title).toStartWith("Ensaio marcado");
    expect(n[0].link).toBe(`#/escala/${sch}`);
    await lider.api.patch(`schedule_rehearsals?id=eq.${reh}`, { notes: "Só a observação mudou" });
    expect((await notes(membro)).length).toBe(1);
    await lider.api.patch(`schedule_rehearsals?id=eq.${reh}`, { starts_at: new Date(Date.now() + 2.5 * 864e5).toISOString() });
    n = await notes(membro);
    expect(n.map((x: any) => x.title.split(":")[0])).toEqual(["Ensaio marcado", "Ensaio alterado"]);
    await lider.api.del(`/schedule_rehearsals?id=eq.${reh}`);
    expect((await notes(membro)).pop().title).toStartWith("Ensaio cancelado");
    expect((await notes(outro)).length).toBe(0);
  });
});
