// Eventos do time (reuniões, fraternização...) com confirmação de presença, e devocional semanal em vídeo.
import { compress, canCompress } from "../lib/videoz.js";
import { sb, state, must, esc, attr, icon, avatar, sheet, toast, errMsg, busy, on, go, empty, spinner, teamHas, canManageTeam, pickFile, fDate, fTime, fDay, fMon, fDateLong, fromLocal, ymd, people, personName, confirmDialog } from "../core.js";

export function register(route) {
  route("/times/:id/eventos", (p, el, a) => list(p.id, el, a));
  route("/times/:id/eventos/:eid", (p, el, a) => detail(p.id, p.eid, el, a));
  route("/times/:id/devocional", (p, el, a) => devList(p.id, el, a));
  route("/times/:id/devocional/:did", (p, el, a) => devWatch(p.id, p.did, el, a));
}

const SKIP = 20 * 1024 * 1024;
const WEEK = 7 * 24 * 3600e3;
const SETUP = (n) => `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>${n}</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /relation|does not exist|schema cache|42P01|PGRST|function/i.test(String(e?.message || e?.code || e));
const KINDS = { reuniao: "Reunião", fraternizacao: "Fraternização", ensaio: "Ensaio", estudo: "Estudo", outro: "Outro" };
const ANSWERS = { vou: "Vou", talvez: "Talvez", nao: "Não vou" };
const teamOf = async (id) => state.orgTeams.find((t) => t.id === id) || state.myTeams.find((t) => t.id === id) || (await must(sb.from("teams").select("*").eq("id", id).maybeSingle()));
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "") || "video";

export const eventRow = (e, teamId) => `<a class="li evt" href="#/times/${teamId}/eventos/${e.id}"><span class="evdate"><b>${fDay(e.starts_at)}</b><small>${esc(fMon(e.starts_at))}</small></span>
  <span class="grow" style="min-width:0"><span class="t ellipsis">${esc(e.title)}</span><span class="s">${esc(KINDS[e.kind] || "")} · ${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ""}</span></span>${icon("chevronRight", "chev")}</a>`;

// ---------------------------------------------------------------- eventos
async function list(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!team || !teamHas(team, "eventos")) { el.innerHTML = empty("calendar", "Este time não usa eventos."); return; }
  const from = new Date(Date.now() - 3 * 3600e3).toISOString();
  const [up, past] = await Promise.all([
    sb.from("team_events").select("*").eq("team_id", teamId).gte("starts_at", from).order("starts_at"),
    sb.from("team_events").select("*").eq("team_id", teamId).lt("starts_at", from).order("starts_at", { ascending: false }).limit(10),
  ]);
  if (up.error) { el.innerHTML = missing(up.error) ? SETUP("atualizacao-2026-11-06-eventos-devocional.sql") : empty("alert", "Não foi possível carregar", errMsg(up.error)); return; }
  if (!alive()) return;
  const manage = canManageTeam(teamId);
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Eventos</h1>${manage ? `<button class="btn primary sm" id="new">${icon("plus")} Novo</button>` : ""}</div>
    <p class="muted small">Reuniões, fraternização e encontros de ${esc(team.name)}. Cada integrante confirma se vai.</p>
    ${up.data.length ? `<div class="list">${up.data.map((e) => eventRow(e, teamId)).join("")}</div>` : `<div class="card">${empty("calendar", "Nenhum evento marcado", manage ? "Toque em Novo para marcar uma reunião ou uma fraternização." : "Quando o líder marcar, aparece aqui.")}</div>`}
    ${(past.data || []).length ? `<div class="sec"><h2>Anteriores</h2></div><div class="list" style="opacity:.75">${past.data.map((e) => eventRow(e, teamId)).join("")}</div>` : ""}`;
  el.querySelector("#new")?.addEventListener("click", () => eventForm(team, null, () => list(teamId, el, alive)));
}

export function eventForm(team, ev, again) {
  const d0 = ev ? ymd(ev.starts_at) : ymd(new Date()), t0 = ev ? fTime(ev.starts_at) : "19:00", t1 = ev?.ends_at ? fTime(ev.ends_at) : "";
  const s = sheet(`<h3>${ev ? "Editar evento" : "Novo evento"}</h3><form id="ef">
    <label class="field"><span>Tipo</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(ev?.kind || "reuniao") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="field"><span>Título *</span><input name="title" required maxlength="120" value="${attr(ev?.title || "")}" placeholder="Ex.: Fraternização do louvor"></label>
    <div class="dt3"><fieldset class="of"><legend>Data *</legend><input type="date" name="date" required value="${d0}"></fieldset>
      <fieldset class="of"><legend>Início *</legend><input type="time" name="start" required value="${t0}"></fieldset>
      <fieldset class="of"><legend>Fim</legend><input type="time" name="end" value="${t1}"></fieldset></div>
    <label class="field"><span>Local</span><input name="location" maxlength="160" value="${attr(ev?.location || "")}" placeholder="Ex.: Casa do João"></label>
    <label class="field"><span>Detalhes</span><textarea name="description" maxlength="1000" placeholder="O que levar, pauta da reunião...">${esc(ev?.description || "")}</textarea></label>
    <button class="btn primary block" id="esave">${ev ? "Salvar" : "Marcar evento"}</button></form>`);
  s.el.querySelector("#ef").onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const b = s.el.querySelector("#esave"); busy(b);
    const row = { kind: f.kind, title: f.title.trim(), description: f.description.trim() || null, location: f.location.trim() || null, starts_at: fromLocal(f.date, f.start), ends_at: f.end ? fromLocal(f.date, f.end) : null };
    const r = ev ? await sb.from("team_events").update(row).eq("id", ev.id) : await sb.from("team_events").insert({ ...row, team_id: team.id, org_id: team.org_id, created_by: state.user.id });
    if (r.error) { busy(b, false); return toast(errMsg(r.error), "err"); }
    s.close(); toast(ev ? "Evento salvo" : "Evento marcado. O time foi avisado."); again();
  };
}

async function detail(teamId, eid, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  const [r, rs, ppl] = await Promise.all([sb.from("team_events").select("*").eq("id", eid).eq("team_id", teamId).maybeSingle(), sb.from("team_event_rsvps").select("*").eq("event_id", eid), people()]);
  if (r.error) { el.innerHTML = empty("alert", "Não foi possível carregar", errMsg(r.error)); return; }
  const e = r.data; if (!e) { el.innerHTML = empty("calendar", "Evento não encontrado"); return; }
  if (!alive()) return;
  const mine = (rs.data || []).find((x) => x.user_id === state.user.id)?.answer, manage = canManageTeam(teamId);
  const by = (a) => (rs.data || []).filter((x) => x.answer === a);
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/eventos">${icon("chevronLeft")}</a><h1 style="font-size:22px">${esc(e.title)}</h1></div>
    <div class="card"><p class="row gap-s" style="margin:0 0 6px"><span class="tag soft">${esc(KINDS[e.kind] || "")}</span></p>
      <p class="row gap-s muted">${icon("calendar")}${esc(fDateLong(e.starts_at))}, ${fTime(e.starts_at)}${e.ends_at ? ` às ${fTime(e.ends_at)}` : ""}</p>
      ${e.location ? `<p class="row gap-s muted">${icon("pin")}${esc(e.location)}</p>` : ""}${e.description ? `<p style="white-space:pre-line">${esc(e.description)}</p>` : ""}</div>
    <div class="sec"><h2>Você vai?</h2></div>
    <div class="segs">${Object.entries(ANSWERS).map(([k, v]) => `<button type="button" class="seg${mine === k ? " on" : ""}" data-ans="${k}">${v}</button>`).join("")}</div>
    <div class="sec"><h2>Respostas <small class="muted">${(rs.data || []).length}</small></h2></div>
    ${(rs.data || []).length ? Object.entries(ANSWERS).map(([k, v]) => by(k).length ? `<p class="small muted" style="margin:10px 0 4px">${v} (${by(k).length})</p><div class="row gap-s wrap">${by(k).map((x) => `<span class="chip">${avatar(ppl.get(x.user_id) || { display_name: "?" }, 22, false)} ${esc((personName(ppl, x.user_id) || "").split(" ")[0])}</span>`).join("")}</div>` : "").join("") : `<p class="small muted">Ninguém respondeu ainda.</p>`}
    ${manage ? `<div class="row gap mt"><button class="btn ghost grow" id="edit">${icon("edit")} Editar</button><button class="btn ghost danger grow" id="del">${icon("trash")} Excluir</button></div>` : ""}`;
  on(el, "click", "[data-ans]", async (ev, b) => {
    const x = await sb.from("team_event_rsvps").upsert({ event_id: eid, user_id: state.user.id, answer: b.dataset.ans, updated_at: new Date().toISOString() }, { onConflict: "event_id,user_id" });
    if (x.error) return toast(errMsg(x.error), "err"); toast("Resposta enviada"); detail(teamId, eid, el, alive);
  });
  el.querySelector("#edit")?.addEventListener("click", () => eventForm(team, e, () => detail(teamId, eid, el, alive)));
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este evento?", "Excluir", true))) return;
    const d = await sb.from("team_events").delete().eq("id", eid); if (d.error) return toast(errMsg(d.error), "err");
    toast("Evento excluído"); go(`/times/${teamId}/eventos`);
  });
}

// ---------------------------------------------------------------- devocional
const devCard = (d, ppl, teamId) => `<a class="li" href="#/times/${teamId}/devocional/${d.id}"><span class="cover">${d.thumb ? `<img src="${attr(d.thumb)}" alt="">` : icon("play")}</span><span class="grow" style="min-width:0"><span class="t ellipsis">${esc(d.title)}</span><span class="s">${esc(personName(ppl, d.author_id))} · ${fDate(d.created_at)}</span></span>${icon("chevronRight", "chev")}</a>`;

async function devList(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await teamOf(teamId);
  if (!team || !teamHas(team, "devocional")) { el.innerHTML = empty("play", "Este time não usa devocional."); return; }
  const [r, ppl] = await Promise.all([sb.from("team_devotionals").select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(60), people()]);
  if (r.error) { el.innerHTML = missing(r.error) ? SETUP("atualizacao-2026-11-06-eventos-devocional.sql") : empty("alert", "Não foi possível carregar", errMsg(r.error)); return; }
  if (!alive()) return;
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Devocional</h1><button class="btn primary sm" id="post">${icon("plus")} Postar</button></div>
    <p class="muted small">Um vídeo por semana para o time. Quem posta avisa todo mundo.</p>
    ${r.data.length ? `<div class="list">${r.data.map((d) => devCard(d, ppl, teamId)).join("")}</div>` : `<div class="card">${empty("play", "Nenhum devocional ainda", "Toque em Postar para enviar o primeiro vídeo.")}</div>`}`;
  el.querySelector("#post").onclick = () => postSheet(team, () => devList(teamId, el, alive));
}

function postSheet(team, again) {
  const week = fDate(new Date());
  let file = null;
  const s = sheet(`<h3>Postar devocional</h3>
    <label class="field"><span>Título *</span><input id="dtl" maxlength="140" value="Devocional da semana ${week.slice(0, 5)}"></label>
    <label class="field"><span>Mensagem</span><textarea id="dds" maxlength="1500" placeholder="Versículo, resumo, pedido de oração..."></textarea></label>
    <div class="field"><span>Vídeo</span><button type="button" class="btn ghost block" id="dpick">${icon("camera")} Gravar ou escolher vídeo</button><p class="tiny muted" id="dfile" style="margin:6px 0 0">Vídeos grandes são comprimidos aqui no aparelho antes de enviar. Isso leva quase o tempo do vídeo, com a tela ligada.</p><div id="dprog" class="small muted" style="margin-top:6px"></div></div>
    <label class="field"><span>Ou link do vídeo (YouTube, Drive...)</span><input id="dlink" type="url" inputmode="url" placeholder="https://"></label>
    <button class="btn primary block" id="dok">Postar para o time</button>`, { wide: true });
  s.el.querySelector("#dpick").onclick = async () => {
    const f = await pickFile("video/*"); if (!f) return;
    if (f.size > SKIP && !canCompress()) return toast("Este navegador não comprime vídeo. Use o Chrome ou cole o link.", "err");
    file = f; s.el.querySelector("#dfile").textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
  };
  s.el.querySelector("#dok").onclick = async (ev) => {
    const title = s.el.querySelector("#dtl").value.trim(), link = s.el.querySelector("#dlink").value.trim();
    if (!title) return toast("Escreva o título.", "err");
    if (!file && !link) return toast("Escolha um vídeo ou cole um link.", "err");
    if (link && !/^https?:\/\//i.test(link)) return toast("O link precisa começar com https://", "err");
    busy(ev.currentTarget);
    try {
      let path = null, thumb = null, bytes = null;
      if (file) {
        const prog = s.el.querySelector("#dprog");
        const r = await compress(file, (_, t) => { prog.textContent = t; });
        prog.textContent = "Enviando…";
        const base = slug(file.name).replace(/\.[a-z0-9]+$/, "");
        path = `devotionals/${team.org_id}/${team.id}/${Date.now()}-${base}.${r.ext}`;
        const up = await sb.storage.from("private").upload(path, r.blob, { upsert: false, contentType: r.mime }); if (up.error) throw up.error;
        thumb = r.thumb; bytes = r.blob.size;
      }
      await must(sb.from("team_devotionals").insert({ team_id: team.id, org_id: team.org_id, title, description: s.el.querySelector("#dds").value.trim() || null, video_path: path, video_url: link || null, author_id: state.user.id, thumb, video_bytes: bytes, video_expires_at: path ? new Date(Date.now() + WEEK).toISOString() : null }));
      s.close(); toast("Devocional postado. O time foi avisado."); again();
    } catch (err) { busy(ev.currentTarget, false); toast(missing(err) ? "Falta rodar a atualização do banco." : errMsg(err), "err"); }
  };
}

async function devWatch(teamId, did, el, alive) {
  el.innerHTML = spinner();
  const [r, ppl] = await Promise.all([sb.from("team_devotionals").select("*").eq("id", did).eq("team_id", teamId).maybeSingle(), people()]);
  if (r.error) { el.innerHTML = empty("alert", "Não foi possível carregar", errMsg(r.error)); return; }
  const d = r.data; if (!d) { el.innerHTML = empty("play", "Devocional não encontrado"); return; }
  let src = null;
  if (d.video_path) { const u = await sb.storage.from("private").signedUrl(d.video_path, 3600); src = u.data?.url || null; }
  if (!alive()) return;
  const can = d.author_id === state.user.id || canManageTeam(teamId);
  el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}/devocional">${icon("chevronLeft")}</a><h1 style="font-size:22px">${esc(d.title)}</h1></div>
    <p class="small muted">${esc(personName(ppl, d.author_id))} · ${esc(fDateLong(d.created_at))}</p>
    ${src ? `<video id="vid" class="cv" src="${attr(src)}" poster="${attr(d.thumb || "")}" controls playsinline preload="metadata"></video>${d.video_expires_at ? `<p class="tiny muted">Disponível no app até ${esc(fDate(d.video_expires_at))}.</p>` : ""}` : ""}
    ${d.video_url ? `<a class="btn primary block mt" href="${attr(d.video_url)}" target="_blank" rel="noopener noreferrer">${icon("play")} Assistir o vídeo</a>` : ""}
    ${!src && d.video_path ? `<div class="card small">Não foi possível abrir o vídeo agora. Tente de novo.</div>` : ""}
    ${d.description ? `<div class="card mt"><p style="white-space:pre-line;margin:0">${esc(d.description)}</p></div>` : ""}
    ${can ? `<button class="btn ghost danger block mt" id="del">${icon("trash")} Excluir devocional</button>` : ""}`;
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este devocional?", "Excluir", true))) return;
    if (d.video_path) await sb.storage.from("private").remove([d.video_path]).catch(() => {});
    const x = await sb.from("team_devotionals").delete().eq("id", did); if (x.error) return toast(errMsg(x.error), "err");
    toast("Devocional excluído"); go(`/times/${teamId}/devocional`);
  });
}

// ---------------------------------------------------------------- início do time
// Devocional da semana e próximos eventos, para a tela início do time.
export async function teamExtras(team) {
  const out = [];
  const from = new Date(Date.now() - 3 * 3600e3).toISOString();
  const wantsEv = teamHas(team, "eventos"), wantsDev = teamHas(team, "devocional");
  const [ev, dv, ppl] = await Promise.all([
    wantsEv ? sb.from("team_events").select("*").eq("team_id", team.id).gte("starts_at", from).order("starts_at").limit(3) : null,
    wantsDev ? sb.from("team_devotionals").select("*").eq("team_id", team.id).order("created_at", { ascending: false }).limit(1) : null,
    people(),
  ]);
  const d = dv && !dv.error ? dv.data?.[0] : null;
  if (wantsDev) {
    out.push(d
      ? `<div class="sec"><h2>Devocional da semana</h2><a href="#/times/${team.id}/devocional">Ver todos ${icon("chevronRight")}</a></div>
         <a class="devo" href="#/times/${team.id}/devocional/${d.id}"><span class="play">${icon("play")}</span><span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(d.title)}</b><small>${esc(personName(ppl, d.author_id))} · ${fDate(d.created_at)}</small></span></a>`
      : dv?.error ? "" : `<div class="sec"><h2>Devocional da semana</h2><a href="#/times/${team.id}/devocional">Postar ${icon("plus")}</a></div><div class="card small muted">Nenhum devocional ainda. Quem grava o vídeo da semana pode postar aqui.</div>`);
  }
  if (wantsEv && ev && !ev.error) {
    out.push(`<div class="sec"><h2>Próximos eventos</h2><a href="#/times/${team.id}/eventos">${canManageTeam(team.id) ? `Marcar ${icon("plus")}` : `Ver todos ${icon("chevronRight")}`}</a></div>
      ${ev.data.length ? `<div class="list">${ev.data.map((e) => eventRow(e, team.id)).join("")}</div>` : `<div class="card small muted">Nenhum evento marcado.</div>`}`);
  }
  return out.join("");
}
