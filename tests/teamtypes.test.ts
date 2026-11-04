// Tipos de time: o repertório só aparece para administradores e integrantes de times de Louvor.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser } from "./helpers";

let admin: any, louvorLider: any, louvorMembro: any, midia: any, midiaLider: any;
let org = "", louvor = "", multimidia = "", song = "";

beforeAll(async () => {
  [admin, louvorLider, louvorMembro, midia, midiaLider] = await Promise.all(["Admin T", "Lider Louvor", "Membro Louvor", "Membro Midia", "Lider Midia"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Tipos" })).data;
  louvor = (await admin.api.post("teams", { org_id: org, name: "INVT music", team_type: "louvor" })).data[0].id;
  multimidia = (await admin.api.post("teams", { org_id: org, name: "Mídia", team_type: "multimidia" })).data[0].id;
  const inv = async (t: string) => (await admin.api.rpc("create_team_invite", { p_team: t })).data;
  const tl = await inv(louvor), tm = await inv(multimidia);
  await louvorLider.api.rpc("accept_invite", { p_token: tl }); await louvorMembro.api.rpc("accept_invite", { p_token: tl });
  await midia.api.rpc("accept_invite", { p_token: tm }); await midiaLider.api.rpc("accept_invite", { p_token: tm });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${louvorLider.id}`, { is_leader: true });
  await admin.api.patch(`team_members?team_id=eq.${multimidia}&user_id=eq.${midiaLider.id}`, { is_leader: true });
});

describe("tipos de time", () => {
  test("tipo inválido é recusado; 'outro' guarda o nome digitado", async () => {
    expect((await admin.api.post("teams", { org_id: org, name: "X", team_type: "banda" })).ok).toBe(false);
    const r = await admin.api.post("teams", { org_id: org, name: "Teatro", team_type: "outro", team_type_label: "Teatro" });
    expect(r.data[0]).toMatchObject({ team_type: "outro", team_type_label: "Teatro" });
  });

  test("líder do Louvor cadastra música; líder da Multimídia não", async () => {
    const r = await louvorLider.api.post("songs", { org_id: org, title: "Emaús", artist: "Morada" });
    expect(r.status).toBe(201); song = r.data[0].id;
    expect((await midiaLider.api.post("songs", { org_id: org, title: "Outra" })).ok).toBe(false);
  });

  test("integrantes do Louvor e o admin veem o repertório; quem é só da Multimídia não", async () => {
    expect((await louvorMembro.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(1);
    expect((await admin.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(1);
    expect((await midia.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(0);
    expect((await midiaLider.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(0);
  });

  test("Multimídia não coloca música na escala nem compartilha no chat", async () => {
    const when = new Date(Date.now() + 864e5).toISOString();
    const sch = (await midiaLider.api.post("schedules", { org_id: org, team_id: multimidia, title: "Culto", starts_at: when })).data[0].id;
    expect((await midiaLider.api.post("schedule_songs", { schedule_id: sch, org_id: org, team_id: multimidia, song_id: song, title_snapshot: "x" })).ok).toBe(false);
    expect((await midia.api.post("messages", { org_id: org, team_id: multimidia, user_id: midia.id, kind: "song", song_id: song })).ok).toBe(false);
    expect((await midia.api.post("messages", { org_id: org, team_id: multimidia, user_id: midia.id, body: "oi" })).status).toBe(201);
    // no Louvor funciona
    expect((await louvorMembro.api.post("messages", { org_id: org, team_id: louvor, user_id: louvorMembro.id, kind: "song", song_id: song })).status).toBe(201);
  });

  test("recursos comuns continuam valendo para todo time", async () => {
    expect((await midia.api.get(`/schedules?team_id=eq.${multimidia}`)).data).toHaveLength(0); // rascunho
    expect((await midia.api.get(`/teams?org_id=eq.${org}`)).data.length).toBeGreaterThanOrEqual(2);
    expect((await midia.api.get(`/messages?team_id=eq.${multimidia}`)).data).toHaveLength(1);
  });

  test("ao entrar em um time de Louvor, passa a ver o repertório", async () => {
    await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [midia.id] });
    expect((await midia.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(1);
  });
});
