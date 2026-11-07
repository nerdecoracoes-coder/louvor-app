// Versões da música por cantor: só quem cuida do repertório registra; todos do repertório leem.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, membro: any, outro: any, org = "", song = "";
beforeAll(async () => {
  [admin, membro, outro] = await Promise.all(["Admin V", "Membro V", "Outro V"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Versões" })).data;
  const louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, membro, outro);
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [membro.id] });
  song = (await admin.api.post("songs", { org_id: org, title: "Aclame", album: "Diante do Trono", notes: "Rafael D · Douglas B", source: "manual", created_by: admin.id })).data[0].id;
});

describe("versões da música", () => {
  test("administrador registra o tom de cada cantor; nome repetido é recusado", async () => {
    const a = await admin.api.post("song_versions", { song_id: song, org_id: org, name: "Rafael", song_key: "D", bpm: 124 });
    expect(a.status).toBe(201);
    expect((await admin.api.post("song_versions", { song_id: song, org_id: org, name: "Douglas", song_key: "B" })).status).toBe(201);
    expect((await admin.api.post("song_versions", { song_id: song, org_id: org, name: "Rafael", song_key: "E" })).ok).toBe(false);
  });
  test("quem é do Louvor lê as versões, mas não altera; quem não é do repertório não vê", async () => {
    expect((await membro.api.get(`/song_versions?song_id=eq.${song}`)).data).toHaveLength(2);
    expect((await membro.api.post("song_versions", { song_id: song, org_id: org, name: "Ana", song_key: "A" })).ok).toBe(false);
    expect((await membro.api.patch(`song_versions?song_id=eq.${song}&name=eq.Rafael`, { song_key: "G" })).data ?? []).toHaveLength(0);
    expect((await outro.api.get(`/song_versions?song_id=eq.${song}`)).data ?? []).toHaveLength(0);
  });
  test("álbum e observações ficam na música", async () => {
    const s = (await membro.api.get(`/songs?id=eq.${song}`)).data[0];
    expect(s.album).toBe("Diante do Trono"); expect(s.notes).toContain("Rafael D");
  });
});
