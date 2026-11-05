// Multimídia: pedidos de mídia, roteiro do culto (com as músicas e letras do louvor) e checklist pré-culto.
// Cada parte só aparece em times com o recurso correspondente (roteiro, pedidos, checklist).
import { openProjection } from "./projecao.js";
import { sb, state, must, esc, attr, icon, avatar, people, personName, canManageTeam, isAdmin, isGuest, teamHas, teamBadge, sheet, toast, errMsg, busy,
  on, go, empty, spinner, fDate, fTime, ymd, confirmDialog, linkify, safeUrl, pickFile } from "../core.js";

export function register(route) {
  route("/times/:id/pedidos", (p, el, a) => teamRequests(p.id, el, a));
  route("/pedidos", (p, el, a) => myRequests(el, a));
  route("/pedidos/novo", (p, el) => requestForm(el, null));
  route("/pedidos/novo/:team", (p, el) => requestForm(el, p.team));
  route("/pedido/:id", (p, el, a) => requestDetail(p.id, el, a));
}

// ================================================================ pedidos de mídia
export const KINDS = [["arte", "Arte", "image"], ["video", "Vídeo", "play"], ["slide", "Slides", "layers"], ["foto", "Fotos", "camera"], ["outro", "Outro", "file"]];
const STATUS = { pendente: ["Pendente", "warn"], fazendo: ["Fazendo", "soft"], pronto: ["Pronto", "ok"], cancelado: ["Cancelado", "gray"] };
const kindLabel = (k) => KINDS.find((x) => x[0] === k)?.[1] || "Outro";
const dueTag = (r) => {
  if (!r.due_date || ["pronto", "cancelado"].includes(r.status)) return r.due_date ? `<span>Prazo ${fDate(r.due_date + "T12:00:00")}</span>` : "";
  const days = Math.round((new Date(r.due_date + "T12:00:00") - new Date(ymd(new Date()) + "T12:00:00")) / 864e5);
  const txt = days < 0 ? `Atrasado ${-days} dia${days === -1 ? "" : "s"}` : days === 0 ? "Prazo hoje" : days === 1 ? "Prazo amanhã" : `Prazo ${fDate(r.due_date + "T12:00:00")}`;
  return `<span class="${days <= 1 ? "danger-t" : ""}">${txt}</span>`;
};
const reqRow = (r, ppl, { showTeam = false } = {}) => {
  const [lab, cls] = STATUS[r.status] || STATUS.pendente;
  const ic = KINDS.find((x) => x[0] === r.kind)?.[2] || "file";
  const team = showTeam ? state.orgTeams.find((t) => t.id === r.team_id) : null;
  return `<a class="li" href="#/pedido/${r.id}"><span class="reqic">${icon(ic)}</span>
    <span class="grow" style="min-width:0"><span class="t ellipsis">${esc(r.title)}</span>
      <span class="s">${esc(kindLabel(r.kind))} · ${team ? esc(team.name) : esc(personName(ppl, r.requested_by))}${r.due_date ? " · " : ""}${dueTag(r)}</span></span>
    <span class="tag ${cls}">${lab}</span></a>`;
};

async function teamRequests(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = state.orgTeams.find((t) => t.id === teamId) || (await must(sb.from("teams").select("*").eq("id", teamId).maybeSingle()));
  if (!team || !teamHas(team, "pedidos")) { el.innerHTML = empty("inbox", "Este time não recebe pedidos."); return; }
  const [rows, ppl] = await Promise.all([must(sb.from("media_requests").select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(300)), people()]);
  if (!alive()) return;
  let tab = "abertos";
  const sortOpen = (a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.created_at.localeCompare(b.created_at);
  const draw = () => {
    const list = tab === "abertos" ? rows.filter((r) => ["pendente", "fazendo"].includes(r.status)).sort(sortOpen)
      : rows.filter((r) => r.status === (tab === "prontos" ? "pronto" : "cancelado"));
    el.querySelector("#rl").innerHTML = list.length ? list.map((r) => reqRow(r, ppl)).join("")
      : `<div style="padding:10px">${empty("inbox", tab === "abertos" ? "Nenhum pedido em aberto" : "Nada por aqui", tab === "abertos" ? "Quando alguém da igreja pedir uma arte, um vídeo ou slides, o pedido aparece aqui." : "")}</div>`;
    el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  };
  const open = rows.filter((r) => ["pendente", "fazendo"].includes(r.status)).length;
  el.innerHTML = `<div class="pagehead"><h1>Pedidos</h1><a class="btn primary sm" href="#/pedidos/novo/${teamId}">${icon("plus")} Registrar</a></div>
    <p class="muted small">Artes, vídeos e slides pedidos ao ${esc(team.name)}. Qualquer membro da igreja pode pedir pelo botão + do app.</p>
    <div class="row gap-s mt" style="flex-wrap:wrap"><button class="chip" data-tab="abertos">Em aberto${open ? ` (${open})` : ""}</button><button class="chip" data-tab="prontos">Prontos</button><button class="chip" data-tab="cancelados">Cancelados</button></div>
    <div class="list mt" id="rl"></div>`;
  on(el, "click", "[data-tab]", (e, b) => { tab = b.dataset.tab; draw(); });
  draw();
}

async function myRequests(el, alive) {
  el.innerHTML = spinner();
  const [rows, ppl] = await Promise.all([must(sb.from("media_requests").select("*").eq("requested_by", state.user.id).order("created_at", { ascending: false }).limit(100)), people()]);
  if (!alive()) return;
  el.innerHTML = `<div class="pagehead"><h1>Meus pedidos</h1><a class="btn primary sm" href="#/pedidos/novo">${icon("plus")} Novo pedido</a></div>
    <div class="list mt">${rows.length ? rows.map((r) => reqRow(r, ppl, { showTeam: true })).join("") : `<div style="padding:10px">${empty("inbox", "Você ainda não fez pedidos", "Peça uma arte, um vídeo ou slides ao Multimídia.")}</div>`}</div>`;
}

async function requestForm(el, teamId) {
  const targets = state.orgTeams.filter((t) => teamHas(t, "pedidos"));
  if (!targets.length) { el.innerHTML = empty("inbox", "Nenhum time recebe pedidos ainda", "O administrador liga o recurso \"Pedidos de mídia\" nas configurações do time."); return; }
  if (isGuest() && !state.myTeams.some((t) => t.id === teamId)) { el.innerHTML = empty("lock", "Pedidos são feitos por membros da igreja."); return; }
  const sel = targets.find((t) => t.id === teamId) || (targets.length === 1 ? targets[0] : null);
  const fromTeams = state.myTeams.filter((t) => t.id !== sel?.id);
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><h1>Novo pedido</h1></div>
    <form class="card" id="f">
      ${targets.length > 1 ? `<label class="field"><span>Para qual time? *</span><select name="team" required><option value="">Escolha</option>${targets.map((t) => `<option value="${t.id}" ${sel?.id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`
        : `<div class="row gap mb">${teamBadge(sel, 40)}<span><span class="tiny muted">Pedido para</span><b style="display:block">${esc(sel.name)}</b></span></div><input type="hidden" name="team" value="${sel.id}">`}
      <div class="field"><span>O que você precisa? *</span><div class="kinds">${KINDS.map(([k, l, ic], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? "checked" : ""}><span>${icon(ic)}${l}</span></label>`).join("")}</div></div>
      <label class="field"><span>Título *</span><input name="title" required maxlength="140" placeholder="Ex.: Arte para o retiro de jovens"></label>
      <label class="field"><span>Detalhes</span><textarea name="description" rows="4" placeholder="Textos, tamanho (story, feed, telão), referências, onde vai ser usado..."></textarea></label>
      <div class="two"><label class="field"><span>Para quando?</span><input type="date" name="due" min="${ymd(new Date())}"></label>
        ${fromTeams.length ? `<label class="field"><span>Em nome do time</span><select name="from"><option value="">Só eu</option>${fromTeams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>` : "<span></span>"}</div>
      <button class="btn primary block mt" id="save">Enviar pedido</button>
    </form>
    <p class="small muted mt"><a class="link" href="#/pedidos">Ver meus pedidos</a></p>`;
  const form = el.querySelector("#f");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const team = form.team.value; if (!team) return toast("Escolha o time", "err");
    const btn = el.querySelector("#save"); busy(btn);
    const r = await sb.from("media_requests").insert({ org_id: state.org.id, team_id: team, requested_by: state.user.id, title: form.title.value.trim(),
      kind: form.querySelector("input[name=kind]:checked").value, description: form.description.value.trim() || null, due_date: form.due.value || null,
      from_team_id: form.from?.value || null }).select("id").single();
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), "err");
    toast("Pedido enviado. Você será avisado quando ficar pronto."); go(`/pedido/${r.data.id}`);
  };
}

async function requestDetail(id, el, alive) {
  el.innerHTML = spinner();
  const r = await must(sb.from("media_requests").select("*").eq("id", id).maybeSingle());
  if (!r) { el.innerHTML = empty("inbox", "Pedido não encontrado"); return; }
  const [ppl, members] = await Promise.all([people(), must(sb.from("team_members").select("user_id").eq("team_id", r.team_id))]);
  if (!alive()) return;
  const team = state.orgTeams.find((t) => t.id === r.team_id);
  const staff = members.some((m) => m.user_id === state.user.id) || isAdmin();
  const mine = r.requested_by === state.user.id;
  const [lab, cls] = STATUS[r.status];
  const deliveryLink = safeUrl(r.delivery_url);
  el.innerHTML = `<div class="pagehead"><a class="back" href="javascript:history.back()">${icon("chevronLeft")}</a><div class="grow" style="min-width:0"><h1 style="font-size:23px">${esc(r.title)}</h1>
      <span class="small muted">${esc(kindLabel(r.kind))} · para ${esc(team?.name || "")}</span></div><span class="tag ${cls}">${lab}</span></div>
    <div class="card"><div class="row gap">${avatar(ppl.get(r.requested_by), 40, false)}<span class="grow"><span class="tiny muted">Pedido por</span><b style="display:block">${esc(personName(ppl, r.requested_by))}</b>
      <span class="tiny muted">${fDate(r.created_at)} às ${fTime(r.created_at)}${r.from_team_id ? ` · em nome do ${esc(state.orgTeams.find((t) => t.id === r.from_team_id)?.name || "time")}` : ""}</span></span></div>
      ${r.due_date ? `<p class="small mt-s" style="margin-bottom:0">${icon("calendar")} ${dueTag(r)}</p>` : ""}
      ${r.description ? `<p style="margin:12px 0 0">${linkify(r.description)}</p>` : ""}</div>
    ${r.status === "pronto" || r.delivery_url || r.delivery_path ? `<div class="sec">${icon("check")}<h2>Entrega</h2></div><div class="card">
      ${deliveryLink ? `<a class="btn ghost block" href="${attr(deliveryLink)}" target="_blank" rel="noopener">${icon("link")} Abrir link da entrega</a>` : ""}
      ${r.delivery_path ? `<button class="btn ghost block ${deliveryLink ? "mt-s" : ""}" id="dl">${icon("file")} Baixar ${esc(r.delivery_name || "arquivo")}</button>` : ""}
      ${!deliveryLink && !r.delivery_path ? `<p class="small muted" style="margin:0">Marcado como pronto, sem arquivo anexado.</p>` : ""}</div>` : ""}
    ${staff ? `<div class="sec">${icon("settings")}<h2>Atendimento</h2></div><div class="card">
      <label class="field"><span>Responsável</span><select id="asg"><option value="">Ninguém ainda</option>${members.map((m) => `<option value="${m.user_id}" ${r.assignee === m.user_id ? "selected" : ""}>${esc(personName(ppl, m.user_id))}</option>`).join("")}</select></label>
      <label class="field"><span>Link da entrega (Drive, Canva, YouTube...)</span><input id="durl" class="input" value="${attr(r.delivery_url || "")}" placeholder="https://"></label>
      <button class="btn ghost block" id="up">${icon("clip")} ${r.delivery_path ? "Trocar arquivo" : "Anexar arquivo"}</button>
      <div class="row gap mt wrap">
        ${r.status === "pendente" ? `<button class="btn ghost grow" data-st="fazendo">${icon("clock")} Começar</button>` : ""}
        ${["pendente", "fazendo"].includes(r.status) ? `<button class="btn primary grow" data-st="pronto">${icon("check")} Marcar como pronto</button>` : ""}
        ${["pronto", "cancelado"].includes(r.status) ? `<button class="btn ghost grow" data-st="fazendo">${icon("refresh")} Reabrir</button>` : ""}
        ${r.status !== "cancelado" && r.status !== "pronto" ? `<button class="btn ghost" data-st="cancelado">Cancelar</button>` : ""}
      </div><button class="btn ghost block mt-s" id="savedel">Salvar responsável e link</button></div>`
      : mine && r.status === "pendente" ? `<div class="row gap mt"><button class="btn ghost grow" data-st="cancelado">Cancelar pedido</button><button class="btn danger" id="del">${icon("trash")}</button></div>` : ""}`;
  const save = async (patch, msg) => {
    const x = await sb.from("media_requests").update(patch).eq("id", id);
    if (x.error) return toast(errMsg(x.error), "err");
    if (msg) toast(msg); requestDetail(id, el, alive);
  };
  el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    const st = b.dataset.st;
    if (st === "cancelado" && !(await confirmDialog("Cancelar este pedido?", "Cancelar pedido", true))) return;
    const patch = { status: st };
    if (staff) { patch.delivery_url = el.querySelector("#durl")?.value.trim() || null; if (!r.assignee && st !== "cancelado") patch.assignee = el.querySelector("#asg")?.value || state.user.id; }
    save(patch, { fazendo: "Pedido em andamento", pronto: "Pedido pronto. Quem pediu foi avisado.", cancelado: "Pedido cancelado" }[st]);
  }));
  el.querySelector("#savedel")?.addEventListener("click", () => save({ assignee: el.querySelector("#asg").value || null, delivery_url: el.querySelector("#durl").value.trim() || null }, "Salvo"));
  el.querySelector("#up")?.addEventListener("click", async (e) => {
    const f = await pickFile("*/*"); if (!f) return;
    if (f.size > 50 * 1024 * 1024) return toast("Arquivo maior que 50 MB: use um link (Drive, WeTransfer...).", "err");
    busy(e.target);
    const path = `requests/${r.org_id}/${r.team_id}/${r.id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await sb.storage.from("private").upload(path, f, { upsert: true });
    busy(e.target, false);
    if (up.error) return toast(errMsg(up.error), "err");
    save({ delivery_path: path, delivery_name: f.name }, "Arquivo anexado");
  });
  el.querySelector("#dl")?.addEventListener("click", async () => {
    const s = await sb.storage.from("private").signedUrl(r.delivery_path, 600);
    if (s.data?.url) window.open(s.data.url, "_blank", "noopener"); else toast(errMsg(s.error), "err");
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Excluir este pedido?", "Excluir", true))) return;
    const x = await sb.from("media_requests").delete().eq("id", id);
    if (x.error) return toast(errMsg(x.error), "err");
    toast("Pedido excluído"); go("/pedidos");
  });
}

// pedidos em aberto, para o início do time
export async function openRequestsCard(team) {
  const [rows, ppl] = await Promise.all([must(sb.from("media_requests").select("*").eq("team_id", team.id).in("status", ["pendente", "fazendo"]).order("due_date", { ascending: true, nullsFirst: false }).limit(4)), people()]);
  return `<div class="sec"><h2>Pedidos em aberto</h2><a href="#/times/${team.id}/pedidos">Todos ${icon("chevronRight")}</a></div>
    ${rows.length ? `<div class="list">${rows.map((r) => reqRow(r, ppl)).join("")}</div>` : `<div class="card small muted">Nenhum pedido em aberto.</div>`}`;
}

// ================================================================ roteiro do culto
export const CUE_KINDS = [["abertura", "Abertura"], ["louvor", "Louvor"], ["oracao", "Oração"], ["avisos", "Avisos"], ["oferta", "Oferta"],
  ["pregacao", "Pregação"], ["video", "Vídeo"], ["ceia", "Ceia"], ["encerramento", "Encerramento"], ["outro", "Outro"]];
const cueLabel = (k) => CUE_KINDS.find((x) => x[0] === k)?.[1] || "Outro";
const TEMPLATE = [["abertura", "Abertura", 5], ["louvor", "Louvor", 25], ["avisos", "Avisos", 5], ["oferta", "Oferta", 5], ["pregacao", "Pregação", 40], ["encerramento", "Encerramento e oração", 5]];
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

// Seções extras da escala (roteiro e checklist), conforme os recursos do time
export async function scheduleExtras(box, s) {
  const team = s.teams || state.orgTeams.find((t) => t.id === s.team_id);
  const parts = [];
  if (teamHas(team, "roteiro")) parts.push(roteiro(s, team));
  if (teamHas(team, "checklist")) parts.push(checklist(s, team));
  if (!parts.length) return;
  box.innerHTML = parts.map((_, i) => `<div id="ex${i}"></div>`).join("");
  await Promise.all(parts.map((p, i) => p(box.querySelector(`#ex${i}`))));
}

function roteiro(s, team) {
  return async function draw(box) {
    const [cues, songs] = await Promise.all([
      must(sb.from("schedule_cues").select("*").eq("schedule_id", s.id).order("position")),
      sb.rpc("service_songs", { p_schedule: s.id }).then((r) => r.data || []),
    ]);
    const manage = canManageTeam(team.id);
    const songsHtml = songs.length ? `<div class="cue-songs">${songs.map((x, i) => `<button class="cue-song" data-song="${i}"><b>${i + 1}</b><span class="grow ellipsis">${esc(x.title)}${x.artist ? ` <span class="muted">· ${esc(x.artist)}</span>` : ""}</span>
        ${x.song_key ? `<span class="tag soft">${esc(x.song_key)}</span>` : ""}${x.lyrics?.blocks?.length ? `<span class="tag gray">Letra</span>` : ""}</button>`).join("")}</div>
        <p class="tiny muted" style="margin:6px 0 0">Da escala "${esc(songs[0].schedule_title)}" do ${esc(songs[0].team_name)} (${fTime(songs[0].starts_at)}). Toque para ver a letra.</p>`
      : `<p class="tiny muted" style="margin:6px 0 0">As músicas aparecem aqui quando o time de louvor publicar a escala deste culto.</p>`;
    const hasLouvor = cues.some((c) => c.kind === "louvor");
    box.innerHTML = `<div class="sec">${icon("list")}<h2>Roteiro do culto</h2>${songs.length ? `<button class="more" id="proj">${icon("play")} Projetar letras</button>` : ""}${manage ? `<button class="more" id="cedit">${icon("edit")} ${cues.length ? "Editar" : "Montar"}</button>` : ""}</div>
      ${cues.length ? `<div class="cues">${cues.map((c) => `<div class="cue k-${c.kind}"><span class="ct">${hhmm(c.at_time) || "—"}</span>
          <div class="grow" style="min-width:0"><div class="row gap-s"><b class="ellipsis">${esc(c.title)}</b>${c.duration_min ? `<span class="tiny muted">${c.duration_min} min</span>` : ""}</div>
            ${c.responsible ? `<div class="tiny muted">${esc(c.responsible)}</div>` : ""}${c.notes ? `<div class="small" style="margin-top:4px">${linkify(c.notes)}</div>` : ""}
            ${c.kind === "louvor" ? songsHtml : ""}</div></div>`).join("")}</div>`
        : `<div class="card small muted">${manage ? "Monte a ordem do culto (abertura, louvor, avisos, pregação...). Use o modelo e ajuste." : "O roteiro deste culto ainda não foi montado."}</div>`}
      ${!hasLouvor && songs.length ? `<div class="card mt-s"><b class="small">Músicas do louvor</b>${songsHtml}</div>` : ""}`;
    box.querySelectorAll("[data-song]").forEach((b) => (b.onclick = () => lyricsSheet(songs[Number(b.dataset.song)])));
    box.querySelector("#proj")?.addEventListener("click", () => openProjection(songs));
    box.querySelector("#cedit")?.addEventListener("click", () => cueEditor(s, team, cues, () => draw(box)));
  };
}

function lyricsSheet(x) {
  const blocks = x.lyrics?.blocks || [];
  const text = blocks.map((b) => (b.label ? `[${b.label}]\n` : "") + b.text).join("\n\n");
  const sh = sheet(`<h3>${esc(x.title)}</h3><p class="small muted" style="margin-top:-6px">${esc(x.artist || "")}${x.song_key ? ` · Tom ${esc(x.song_key)}` : ""}</p>
    ${blocks.length ? `<div class="lyr" style="max-height:55vh;overflow:auto">${blocks.map((b) => `<div class="blk">${b.label ? `<h4>${esc(b.label)}</h4>` : ""}<p>${esc(b.text)}</p></div>`).join("")}</div>
      <button class="btn primary block mt" id="cp">${icon("copy")} Copiar letra</button>`
      : `<p class="muted">A letra desta música ainda não foi cadastrada no repertório.</p>`}`, { wide: true });
  sh.el.querySelector("#cp")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); toast("Letra copiada"); } catch { toast("Não foi possível copiar", "err"); } });
}

export function cueEditor(s, team, cues, done) {
  let list = cues.map((c) => ({ ...c }));
  const sh = sheet(`<h3>Roteiro do culto</h3><div id="cl"></div>
    <div class="row gap mt wrap"><button class="btn ghost grow" id="add">${icon("plus")} Item</button>${!list.length ? `<button class="btn ghost grow" id="tpl">${icon("sparkle")} Usar modelo</button>` : ""}</div>
    <button class="btn primary block mt" id="ok">Salvar roteiro</button>`, { wide: true });
  const start = new Date(s.starts_at);
  const draw = () => {
    sh.el.querySelector("#cl").innerHTML = list.length ? list.map((c, i) => `<div class="cue-edit" data-i="${i}">
      <div class="row gap-s"><input class="input" data-f="at_time" type="time" value="${hhmm(c.at_time)}" style="width:96px">
        <select class="input" data-f="kind" style="width:auto">${CUE_KINDS.map(([k, l]) => `<option value="${k}" ${c.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input class="input" data-f="duration_min" type="number" min="0" max="600" placeholder="min" value="${c.duration_min ?? ""}" style="width:70px"></div>
      <input class="input mt-s" data-f="title" placeholder="Título" maxlength="120" value="${attr(c.title || "")}">
      <div class="row gap-s mt-s"><input class="input grow" data-f="responsible" placeholder="Responsável (opcional)" value="${attr(c.responsible || "")}">
        <button class="iconbtn" data-up="${i}" aria-label="Subir">${icon("chevronUp")}</button><button class="iconbtn" data-dn="${i}" aria-label="Descer">${icon("chevronDown")}</button><button class="iconbtn" data-rm="${i}" aria-label="Remover">${icon("trash")}</button></div>
      <textarea class="input mt-s" data-f="notes" rows="1" placeholder="Observações (vídeo a rodar, versículo, aviso...)">${esc(c.notes || "")}</textarea></div>`).join("")
      : `<p class="small muted">Nenhum item ainda.</p>`;
  };
  const read = () => sh.el.querySelectorAll("[data-i]").forEach((row) => {
    const c = list[Number(row.dataset.i)];
    row.querySelectorAll("[data-f]").forEach((inp) => { const f = inp.dataset.f; c[f] = f === "duration_min" ? (inp.value === "" ? null : Number(inp.value)) : inp.value || null; });
  });
  const retime = () => { // horários em sequência a partir do início do culto, quando ainda não definidos
    let t = start.getTime();
    for (const c of list) { if (!c.at_time) c.at_time = fTime(new Date(t)); t = new Date(`${ymd(start)}T${hhmm(c.at_time)}:00-03:00`).getTime() + (c.duration_min || 0) * 60e3; }
  };
  sh.el.querySelector("#add").onclick = () => { read(); list.push({ kind: "outro", title: "", duration_min: null }); retime(); draw(); };
  const tpl = sh.el.querySelector("#tpl");
  tpl?.addEventListener("click", () => { list = TEMPLATE.map(([kind, title, duration_min]) => ({ kind, title, duration_min })); retime(); tpl.remove(); draw(); });
  on(sh.el, "click", "[data-rm]", (e, b) => { read(); list.splice(Number(b.dataset.rm), 1); draw(); });
  on(sh.el, "click", "[data-up]", (e, b) => { read(); const i = Number(b.dataset.up); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); });
  on(sh.el, "click", "[data-dn]", (e, b) => { read(); const i = Number(b.dataset.dn); if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); });
  sh.el.querySelector("#ok").onclick = async (e) => {
    read();
    if (list.some((c) => !c.title?.trim())) return toast("Dê um título a cada item", "err");
    busy(e.target);
    const del = await sb.from("schedule_cues").delete().eq("schedule_id", s.id);
    const rows = list.map((c, i) => ({ schedule_id: s.id, org_id: s.org_id, team_id: s.team_id, position: i + 1, at_time: c.at_time || null, kind: c.kind,
      title: c.title.trim(), duration_min: c.duration_min, responsible: c.responsible?.trim() || null, notes: c.notes?.trim() || null }));
    const ins = rows.length ? await sb.from("schedule_cues").insert(rows) : { error: null };
    busy(e.target, false);
    if (del.error || ins.error) return toast(errMsg(del.error || ins.error), "err");
    toast("Roteiro salvo"); sh.close(); done();
  };
  draw();
}

// ================================================================ checklist pré-culto
export const CHECK_TEMPLATE = ["Projetor / TV ligados e testados", "Letras e slides conferidos", "Câmeras posicionadas, com bateria e cartão", "Mesa de corte funcionando",
  "Transmissão testada (imagem e som)", "Iluminação conferida", "Internet estável no local"];

export const CHECK_TEMPLATES = {
  multimidia: CHECK_TEMPLATE,
  diaconal: ["Templo aberto, limpo e arejado", "Luzes, ventiladores e ar-condicionado ligados", "Cadeiras e corredores organizados", "Lugares reservados (idosos, gestantes, cadeirantes)",
    "Equipe da porta posicionada para receber", "Estacionamento sinalizado e com alguém responsável", "Elementos da Santa Ceia preparados (quando houver)", "Sacolas ou envelopes de oferta prontos",
    "Banheiros conferidos", "Kit de primeiros socorros no lugar"],
  infantil: ["Sala limpa, arejada e organizada", "Materiais da aula separados", "Lanche conferido (atenção a alergias)", "Lista de presença e check-in prontos", "Etiquetas e pulseiras de identificação",
    "Brinquedos e tapetes higienizados", "Voluntários com crachá", "Berçário preparado", "Autorizações e contatos dos responsáveis à mão", "Kit de primeiros socorros no lugar"],
};

function checklist(s, team) {
  return async function draw(box) {
    const [items, checks, ppl] = await Promise.all([
      must(sb.from("team_checklist_items").select("*").eq("team_id", team.id).order("position")),
      must(sb.from("schedule_checks").select("*").eq("schedule_id", s.id)),
      people(),
    ]);
    const done = new Map(checks.map((c) => [c.item_id, c]));
    const member = state.myTeams.some((t) => t.id === team.id);
    box.innerHTML = `<div class="sec">${icon("checkbox")}<h2>Checklist pré-culto</h2>${items.length ? `<span class="small muted">${done.size}/${items.length}</span>` : ""}</div>
      ${items.length ? `<div class="list">${items.map((it) => { const c = done.get(it.id); return `<button class="li check${c ? " on" : ""}" data-it="${it.id}" ${member ? "" : "disabled"}>
          <span class="cb">${c ? icon("check") : ""}</span><span class="grow"><span class="t">${esc(it.label)}</span>${c ? `<span class="s">${esc(personName(ppl, c.checked_by))} · ${fTime(c.checked_at)}</span>` : ""}</span></button>`; }).join("")}</div>`
        : `<div class="card small muted">${canManageTeam(team.id) ? `A lista de itens do time fica nas <a class="link" href="#/times/${team.id}/config">configurações do time</a>.` : "O líder ainda não definiu os itens do checklist."}</div>`}`;
    box.querySelectorAll("[data-it]").forEach((b) => (b.onclick = async () => {
      const it = b.dataset.it; busy(b);
      const r = done.has(it) ? await sb.from("schedule_checks").delete().eq("schedule_id", s.id).eq("item_id", it)
        : await sb.from("schedule_checks").insert({ schedule_id: s.id, item_id: it, org_id: s.org_id, team_id: s.team_id, checked_by: state.user.id });
      if (r.error) { busy(b, false); return toast(errMsg(r.error), "err"); }
      draw(box);
    }));
  };
}

// editor dos itens (configurações do time)
export async function checklistEditor(team, box) {
  const items = await must(sb.from("team_checklist_items").select("*").eq("team_id", team.id).order("position"));
  box.innerHTML = `<div class="card mt"><h3 style="font-size:16px">Checklist pré-culto</h3><p class="small muted">Itens que o time confere antes de cada culto. Aparecem em todas as escalas do time.</p>
    <div class="list" id="ci">${items.map((it) => `<div class="li"><span class="grow t">${esc(it.label)}</span><button class="iconbtn" data-del="${it.id}" aria-label="Remover">${icon("trash")}</button></div>`).join("") || `<div class="li muted small">Nenhum item.</div>`}</div>
    <form class="row gap mt-s" id="cf"><input class="input grow" name="label" maxlength="140" placeholder="Novo item"><button class="btn ghost sm">${icon("plus")}</button></form>
    ${!items.length ? `<button class="btn ghost block mt-s" id="sug">${icon("sparkle")} Usar lista sugerida</button>` : ""}</div>`;
  const add = async (labels) => {
    const r = await sb.from("team_checklist_items").insert(labels.map((label, i) => ({ org_id: team.org_id, team_id: team.id, label, position: items.length + i + 1 })));
    if (r.error) return toast(errMsg(r.error), "err");
    checklistEditor(team, box);
  };
  box.querySelector("#cf").onsubmit = (e) => { e.preventDefault(); const v = e.target.label.value.trim(); if (v) add([v]); };
  box.querySelector("#sug")?.addEventListener("click", () => add(CHECK_TEMPLATES[team.team_type] || CHECK_TEMPLATE));
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { const r = await sb.from("team_checklist_items").delete().eq("id", b.dataset.del); if (r.error) return toast(errMsg(r.error), "err"); checklistEditor(team, box); }));
}
