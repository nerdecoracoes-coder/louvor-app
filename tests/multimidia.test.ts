// Ministério de Multimídia: funções padrão, roteiro do culto (com as músicas do louvor), pedidos de mídia e checklist.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, operador: any, louvorLider: any, membro: any, fora: any;
let org = "", midia = "", louvor = "", schMidia = "", schLouvor = "", song = "", req = "";

beforeAll(async () => {
  [admin, lider, operador, louvorLider, membro, fora] = await Promise.all(["Admin M", "Lider Midia", "Operador", "Lider Louvor M", "Membro M", "Fora M"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Mídia" })).data;
  midia = (await admin.api.post("teams", { org_id: org, name: "Multimídia", team_type: "multimidia" })).data[0].id;
  louvor = (await admin.api.post("teams", { org_id: org, name: "INVT music", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, operador, louvorLider, membro);
  await admin.api.rpc("add_team_members", { p_team: midia, p_users: [lider.id, operador.id] });
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [louvorLider.id] });
  await admin.api.patch(`team_members?team_id=eq.${midia}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${louvorLider.id}`, { is_leader: true });
  const when = new Date(Date.now() + 3 * 864e5); when.setUTCHours(22, 0, 0, 0);
  schLouvor = (await louvorLider.api.post("schedules", { org_id: org, team_id: louvor, title: "Culto de Domingo", starts_at: when.toISOString(), status: "published" })).data[0].id;
  schMidia = (await lider.api.post("schedules", { org_id: org, team_id: midia, title: "Culto de Domingo", starts_at: new Date(when.getTime() - 30 * 60e3).toISOString(), status: "published" })).data[0].id;
  song = (await louvorLider.api.post("songs", { org_id: org, title: "Emaús", artist: "Morada", song_key: "B", lyrics: { blocks: [{ label: "Verso 1", text: "Teu amor me alcançou" }] } })).data[0].id;
  await louvorLider.api.post("schedule_songs", { schedule_id: schLouvor, org_id: org, team_id: louvor, song_id: song, title_snapshot: "", position: 1 });
});

describe("multimídia", () => {
  test("o tipo já vem com roteiro, pedidos e checklist e com as funções do ministério", async () => {
    expect((await admin.api.get(`/teams?id=eq.${midia}&select=features`)).data[0].features).toEqual(["checklist", "estudio", "letras", "pedidos", "roteiro"]);
    const roles = (await lider.api.get(`/music_roles?org_id=eq.${org}&team_type=eq.multimidia&order=sort`)).data.map((r: any) => r.name);
    expect(roles).toEqual(["Direção", "Projeção", "Transmissão/Corte", "Câmera 2", "Câmera 3", "Iluminação"]);
  });

  test("roteiro: o líder monta; o operador vê; quem é de fora não", async () => {
    const r = await lider.api.post("schedule_cues", [
      { schedule_id: schMidia, org_id: org, team_id: midia, position: 1, at_time: "18:30", kind: "abertura", title: "Abertura", duration_min: 5 },
      { schedule_id: schMidia, org_id: org, team_id: midia, position: 2, at_time: "18:35", kind: "louvor", title: "Louvor", duration_min: 25 },
    ]);
    expect(r.status).toBe(201);
    expect((await operador.api.post("schedule_cues", { schedule_id: schMidia, org_id: org, team_id: midia, title: "X" })).ok).toBe(false);
    expect((await operador.api.get(`/schedule_cues?schedule_id=eq.${schMidia}`)).data).toHaveLength(2);
    expect((await fora.api.get(`/schedule_cues?schedule_id=eq.${schMidia}`)).data).toHaveLength(0);
    // roteiro só em time com o recurso
    expect((await louvorLider.api.post("schedule_cues", { schedule_id: schLouvor, org_id: org, team_id: louvor, title: "X" })).ok).toBe(false);
  });

  test("as músicas do louvor no mesmo culto aparecem para o Multimídia, com a letra (sem acesso ao repertório)", async () => {
    const r = (await operador.api.rpc("service_songs", { p_schedule: schMidia })).data;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Emaús", artist: "Morada", song_key: "B", team_name: "INVT music" });
    expect(r[0].lyrics.blocks[0].text).toBe("Teu amor me alcançou");
    expect((await operador.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(0);   // repertório continua fechado
    expect((await fora.api.rpc("service_songs", { p_schedule: schMidia })).data).toHaveLength(0);
  });

  test("pedido de mídia: membro da igreja pede; o time é avisado; só o time muda a situação; quem pediu é avisado quando fica pronto", async () => {
    const r = await membro.api.post("media_requests", { org_id: org, team_id: midia, requested_by: membro.id, title: "Arte do retiro", kind: "arte", due_date: "2026-12-01" });
    expect(r.status).toBe(201); req = r.data[0].id;
    expect((await lider.api.get(`/notifications?user_id=eq.${lider.id}&kind=eq.media_request`)).data.length).toBeGreaterThan(0);
    expect((await fora.api.get(`/media_requests?id=eq.${req}`)).data).toHaveLength(0);
    expect(JSON.stringify((await membro.api.patch(`media_requests?id=eq.${req}`, { status: "pronto" })).data)).toContain("forbidden");
    expect((await membro.api.patch(`media_requests?id=eq.${req}`, { description: "Tema: Raízes" })).ok).toBe(true);
    expect((await operador.api.patch(`media_requests?id=eq.${req}`, { status: "fazendo", assignee: operador.id })).ok).toBe(true);
    expect(JSON.stringify((await membro.api.patch(`media_requests?id=eq.${req}`, { title: "Outro" })).data)).toContain("forbidden"); // já em andamento
    await operador.api.patch(`media_requests?id=eq.${req}`, { status: "pronto", delivery_url: "https://drive.google.com/x" });
    const n = (await membro.api.get(`/notifications?user_id=eq.${membro.id}&kind=eq.media_request&order=created_at.desc`)).data;
    expect(n[0].title).toBe("Pedido pronto: Arte do retiro");
    // pedido só para time que atende pedidos
    expect((await membro.api.post("media_requests", { org_id: org, team_id: louvor, requested_by: membro.id, title: "X" })).ok).toBe(false);
  });

  test("checklist: o líder define os itens; quem é do time marca; quem é de fora não", async () => {
    const items = (await lider.api.post("team_checklist_items", [
      { org_id: org, team_id: midia, position: 1, label: "Projetor ligado e testado" },
      { org_id: org, team_id: midia, position: 2, label: "Transmissão testada" },
    ])).data;
    expect(items).toHaveLength(2);
    expect((await operador.api.post("team_checklist_items", { org_id: org, team_id: midia, label: "X" })).ok).toBe(false);
    expect((await operador.api.post("schedule_checks", { schedule_id: schMidia, item_id: items[0].id, org_id: org, team_id: midia, checked_by: operador.id })).status).toBe(201);
    expect((await fora.api.post("schedule_checks", { schedule_id: schMidia, item_id: items[1].id, org_id: org, team_id: midia, checked_by: fora.id })).ok).toBe(false);
    expect((await lider.api.get(`/schedule_checks?schedule_id=eq.${schMidia}`)).data).toHaveLength(1);
  });
});
