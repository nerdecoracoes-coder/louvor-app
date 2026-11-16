// Tempo de uso do player: cada um registra o seu; só o líder do time consulta o dos integrantes.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let lider: any, memb: any, fora: any, team: string, org: string;

beforeAll(async () => {
  [lider, memb, fora] = await Promise.all(["Líder", "Integrante", "De fora"].map(newUser));
  const r = (await lider.api.rpc("create_louvor_team", { p_name: "Louvor Tempo" })).data; team = r.team_id; org = r.org_id;
  await joinChurch(lider.api, org, memb);
  await lider.api.post("/team_members", { team_id: team, user_id: memb.id, org_id: org, is_leader: false });
});

async function song() {
  return (await lider.api.post("/songs", { org_id: org, title: "Música " + Math.random().toString(36).slice(2, 6), status: "ready" })).data?.[0]?.id;
}

describe("tempo no player", () => {
  test("registra por música e soma; limita um envio a 5 minutos; ignora música de outra organização", async () => {
    const sg = await song(); expect(sg).toBeTruthy();
    await memb.api.rpc("log_listening", { p_song: sg, p_seconds: 30 });
    await memb.api.rpc("log_listening", { p_song: sg, p_seconds: 9999 });
    await fora.api.rpc("log_listening", { p_song: sg, p_seconds: 50 });
    const r = (await lider.api.rpc("team_listening", { p_team: team })).data;
    expect(r.filter((x: any) => x.user_id === memb.id).reduce((a: number, x: any) => a + Number(x.seconds), 0)).toBe(330);
    expect(r.some((x: any) => x.user_id === fora.id)).toBe(false);
  });
  test("integrante comum não consulta o tempo dos outros, mas vê o próprio registro", async () => {
    expect((await memb.api.rpc("team_listening", { p_team: team })).ok).toBe(false);
    expect((await memb.api.get(`/player_usage?user_id=eq.${memb.id}`)).data.length).toBeGreaterThan(0);
    expect((await memb.api.get(`/player_usage?user_id=eq.${lider.id}`)).data).toEqual([]);
  });
  test("consulta por escala só considera as músicas dela", async () => {
    const a = await song(), b = await song();
    const sc = (await lider.api.post("/schedules", { org_id: org, team_id: team, title: "Culto", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published" })).data?.[0];
    await lider.api.post("/schedule_songs", { schedule_id: sc.id, org_id: org, team_id: team, song_id: a, position: 0, title_snapshot: "A" });
    await memb.api.rpc("log_listening", { p_song: a, p_seconds: 60, p_schedule: sc.id });
    await memb.api.rpc("log_listening", { p_song: b, p_seconds: 90 });
    const r = (await lider.api.rpc("team_listening", { p_team: team, p_schedule: sc.id })).data;
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ user_id: memb.id, song_id: a, seconds: 60 });
  });
});
