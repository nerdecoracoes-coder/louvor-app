// Repertório enviado à Multimídia: envio, aviso, alteração depois do envio e quem pode ler.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

type U = Awaited<ReturnType<typeof newUser>>;
let admin: U, mm: U, louvorMember: U, outsider: U;
let org = "", louvor = "", media = "", sched = "";

beforeAll(async () => {
  [admin, mm, louvorMember, outsider] = await Promise.all(["Admin Rep", "Midia Rep", "Louvor Rep", "Fora Rep"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Org Repertório" })).data;
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor Dom", team_type: "louvor" })).data[0].id;
  media = (await admin.api.post("teams", { org_id: org, name: "Mídia Dom", team_type: "multimidia" })).data[0].id;
  for (const [u, t] of [[mm, media], [louvorMember, louvor]] as const) {
    await joinChurch(admin.api, org, u);
    await u.api.rpc("accept_invite", { p_token: (await admin.api.rpc("create_team_invite", { p_team: t })).data });
  }
  await joinChurch(admin.api, org, outsider);
  sched = (await admin.api.post("schedules", { org_id: org, team_id: louvor, title: "Culto de domingo", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published" })).data[0].id;
  await admin.api.post("schedule_songs", { schedule_id: sched, org_id: org, team_id: louvor, title_snapshot: "Gratidão", artist_snapshot: "Get Worship", song_key: "D", position: 0, version_name: "Feminina", bpm: 78 });
});

describe("repertório para a Multimídia", () => {
  test("antes do envio a Multimídia não vê nada", async () => {
    expect((await mm.api.rpc("media_repertoires", {})).data).toEqual([]);
  });

  test("quem não gerencia o time do Louvor não consegue enviar", async () => {
    expect((await louvorMember.api.rpc("send_repertoire", { p_schedule: sched, p_sig: "x" })).ok).toBe(false);
    expect((await mm.api.rpc("send_repertoire", { p_schedule: sched, p_sig: "x" })).ok).toBe(false);
  });

  test("o líder envia: a Multimídia recebe o repertório e uma notificação", async () => {
    expect((await admin.api.rpc("send_repertoire", { p_schedule: sched, p_sig: "sig1" })).ok).toBe(true);
    const r = (await mm.api.rpc("media_repertoires", {})).data;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Culto de domingo", team_name: "Louvor Dom", mm_changed: false });
    expect(r[0].songs[0]).toMatchObject({ title: "Gratidão", key: "D", version: "Feminina", bpm: 78 });
    const n = (await mm.api.get("/notifications?kind=eq.repertoire")).data;
    expect(n[0]).toMatchObject({ title: "Repertório recebido: Culto de domingo", link: `#/repertorio-culto/${sched}` });
  });

  test("quem não é da Multimídia não lê o repertório enviado", async () => {
    expect((await louvorMember.api.rpc("media_repertoires", {})).data).toEqual([]);
    expect((await outsider.api.rpc("media_repertoires", { p_schedule: sched })).data).toEqual([]);
  });

  test("alterar depois do envio avisa a Multimídia uma vez; reenviar zera o aviso", async () => {
    await admin.api.rpc("mark_repertoire_changed", { p_schedule: sched });
    await admin.api.rpc("mark_repertoire_changed", { p_schedule: sched });
    expect((await mm.api.rpc("media_repertoires", {})).data[0].mm_changed).toBe(true);
    expect((await mm.api.get("/notifications?title=like.Repertório alterado*")).data).toHaveLength(1);
    await admin.api.rpc("send_repertoire", { p_schedule: sched, p_sig: "sig2" });
    expect((await mm.api.rpc("media_repertoires", {})).data[0].mm_changed).toBe(false);
    expect((await mm.api.get("/notifications?title=like.Repertório atualizado*")).data).toHaveLength(1);
  });

  test("escala em rascunho não pode ser enviada", async () => {
    const d = (await admin.api.post("schedules", { org_id: org, team_id: louvor, title: "Rascunho", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), status: "draft" })).data[0].id;
    expect((await admin.api.rpc("send_repertoire", { p_schedule: d, p_sig: "x" })).ok).toBe(false);
  });
});
