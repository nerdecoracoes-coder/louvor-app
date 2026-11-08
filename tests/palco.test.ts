// Palco do time, presets de escala e versão da música na escala.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, membro: any, org = "", team = "", role = "", slotA = "", slotB = "";

beforeAll(async () => {
  [admin, lider, membro] = await Promise.all(["Admin P", "Lider P", "Membro P"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Palco" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, membro);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id, membro.id] });
  await admin.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
  role = (await admin.api.post("music_roles", { org_id: org, name: "Pedal Steel", sort: 1, team_type: "louvor" })).data[0].id;
});

describe("palco e presets", () => {
  test("o líder cria posições e o integrante só enxerga", async () => {
    const a = await lider.api.post("team_stage_slots", { org_id: org, team_id: team, role_id: role, x: 30, y: 40, sort: 0 });
    const b = await lider.api.post("team_stage_slots", { org_id: org, team_id: team, role_id: role, x: 70, y: 40, sort: 1 });
    expect(a.ok && b.ok).toBe(true);
    slotA = a.data[0].id; slotB = b.data[0].id;
    expect((await membro.api.get(`/team_stage_slots?team_id=eq.${team}`)).data).toHaveLength(2);
    expect((await membro.api.post("team_stage_slots", { org_id: org, team_id: team, role_id: role, x: 1, y: 1 })).ok).toBe(false);
  });
  test("posição fora do retângulo é recusada", async () => {
    expect((await lider.api.post("team_stage_slots", { org_id: org, team_id: team, role_id: role, x: 150, y: 10 })).ok).toBe(false);
  });
  test("presets: o líder cria, o integrante lê, nomes não repetem", async () => {
    const p = await lider.api.post("team_presets", { org_id: org, team_id: team, name: "Domingo", slot_ids: [slotA, slotB] });
    expect(p.ok).toBe(true);
    expect((await lider.api.post("team_presets", { org_id: org, team_id: team, name: "Domingo", slot_ids: [slotA] })).ok).toBe(false);
    expect((await membro.api.get(`/team_presets?team_id=eq.${team}`)).data).toHaveLength(1);
    expect((await membro.api.post("team_presets", { org_id: org, team_id: team, name: "Quinta", slot_ids: [] })).ok).toBe(false);
  });
  test("outra igreja não enxerga o palco", async () => {
    const fora = await newUser("Fora P");
    await fora.api.rpc("create_organization", { p_name: "Outra Igreja" });
    expect((await fora.api.get(`/team_stage_slots?team_id=eq.${team}`)).data).toHaveLength(0);
    expect((await fora.api.get(`/team_presets?team_id=eq.${team}`)).data).toHaveLength(0);
  });
  test("a escala guarda a versão escolhida da música", async () => {
    const song = (await lider.api.post("songs", { org_id: org, title: "Boa Parte", artist: "FHOP", status: "ready", song_key: "E" })).data[0].id;
    const v = (await lider.api.post("song_versions", { song_id: song, org_id: org, name: "Nely", song_key: "G", bpm: 72 })).data[0].id;
    const s = (await lider.api.post("schedules", { org_id: org, team_id: team, title: "Culto", starts_at: new Date(Date.now() + 86400e3).toISOString(), created_by: lider.id })).data[0].id;
    const r = await lider.api.post("schedule_songs", { schedule_id: s, org_id: org, team_id: team, song_id: song, position: 0, title_snapshot: "Boa Parte", song_key: "G", version_id: v, version_name: "Nely", bpm: 72 });
    expect(r.ok).toBe(true);
    const got = (await lider.api.get(`/schedule_songs?schedule_id=eq.${s}`)).data[0];
    expect(got).toMatchObject({ version_name: "Nely", song_key: "G" });
    await lider.api.del(`song_versions?id=eq.${v}`);
    expect((await lider.api.get(`/schedule_songs?schedule_id=eq.${s}`)).data[0].version_id).toBeNull();
  });
});
