// Chat por time: conversas, mensagens em tempo real, anexos (câmera, galeria, arquivos, música, enquete).
import { sb, state, must, esc, attr, icon, avatar, teamBadge, people, personName, canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner,
  fRel, fTime, fDate, linkify, pickFile, shrinkImage, confirmDialog, teamHasRepertoire } from "../core.js";
import { songPicker } from "./schedules.js";

export function register(route) {
  route("/chat", chatList);
  route("/chat/:team", (p, el, alive) => conversation(p.team, el, alive));
}

async function chatList(_, el) {
  el.innerHTML = spinner();
  const ov = await must(sb.rpc("chat_overview", { p_org: state.org.id }));
  const teams = state.myTeams;
  const by = new Map(ov.map((o) => [o.team_id, o]));
  const rows = teams.map((t) => ({ t, o: by.get(t.id) })).sort((a, b) => (b.o?.last_message_at || "").localeCompare(a.o?.last_message_at || ""));
  const preview = (o) => !o?.last_message_at ? "Nenhuma mensagem ainda" : `${o.last_author ? esc(o.last_author.split(" ")[0]) + ": " : ""}${o.last_kind === "text" ? esc(o.last_body || "") : { image: "📷 Foto", file: "📎 Arquivo", song: "🎵 Música", poll: "📊 Enquete" }[o.last_kind] || ""}`;
  el.innerHTML = `<div class="pagehead"><h1>Chat</h1></div><p class="muted small">Cada time tem sua própria conversa.</p>
    ${rows.length ? `<div class="list mt">${rows.map(({ t, o }) => `<a class="li" href="#/chat/${t.id}">${teamBadge(t, 48)}<span class="grow" style="min-width:0"><span class="row between"><span class="t ellipsis">${esc(t.name)}</span>
      <span class="tiny ${o?.unread ? "accent" : "muted"}">${o?.last_message_at ? fRel(o.last_message_at) : ""}</span></span><span class="row between gap-s"><span class="s ellipsis">${preview(o)}</span>
      ${o?.unread ? `<span class="tag" style="border-radius:99px">${o.unread > 99 ? "99+" : o.unread}</span>` : ""}</span></span></a>`).join("")}</div>`
      : `<div class="card mt">${empty("chat", "Você ainda não participa de nenhum time")}</div>`}`;
}

const signed = new Map();
async function signedUrl(path) {
  if (signed.has(path)) return signed.get(path);
  const p = sb.storage.from("private").signedUrl(path, 3600).then((r) => r.data?.url || null);
  signed.set(path, p);
  return p;
}

async function conversation(teamId, el, alive) {
  const team = state.myTeams.find((t) => t.id === teamId);
  if (!team) { el.innerHTML = empty("lock", "Você não participa deste time", "O chat é exclusivo dos integrantes."); return; }
  const ppl = await people();
  el.innerHTML = `<div class="chatwrap"><div class="pagehead" style="margin:0 0 4px"><a class="back" href="#/chat">${icon("chevronLeft")}</a>${teamBadge(team, 40)}
      <a class="grow" href="#/times/${teamId}/integrantes" style="color:inherit;min-width:0"><b class="ellipsis" style="display:block">${esc(team.name)}</b><span class="tiny muted" id="live">conectando…</span></a></div>
    <div class="msgs" id="msgs">${spinner()}</div>
    <div class="composer"><button class="iconbtn" id="att" aria-label="Anexar">${icon("clip")}</button>
      <textarea id="txt" rows="1" placeholder="Mensagem" maxlength="4000"></textarea><button class="send" id="send" aria-label="Enviar">${icon("chevronRight")}</button></div></div>`;
  const box = el.querySelector("#msgs");
  const msgs = new Map();
  const polls = new Map(), votes = new Map(), songsMap = new Map();
  let oldest = null, newest = null, loadingOlder = false, done = false;

  async function hydrate(list) {
    const pollIds = list.filter((m) => m.poll_id && !polls.has(m.poll_id)).map((m) => m.poll_id);
    const songIds = list.filter((m) => m.song_id && !songsMap.has(m.song_id)).map((m) => m.song_id);
    const [p, s] = await Promise.all([
      pollIds.length ? must(sb.from("polls").select("*").in("id", pollIds)) : [],
      songIds.length ? must(sb.from("songs").select("id,title,artist,song_key,cover_url,current_project_id,status").in("id", songIds)) : [],
    ]);
    p.forEach((x) => polls.set(x.id, x)); s.forEach((x) => songsMap.set(x.id, x));
    if (pollIds.length) await refreshVotes(pollIds);
  }
  async function refreshVotes(ids) {
    const v = await must(sb.from("poll_votes").select("*").in("poll_id", ids));
    ids.forEach((id) => votes.set(id, v.filter((x) => x.poll_id === id)));
  }

  function bubble(m) {
    const me = m.user_id === state.user.id;
    const who = me ? "" : `<div class="who">${esc(personName(ppl, m.user_id))}</div>`;
    let body = "";
    if (m.deleted_at) body = `<i class="muted">Mensagem apagada</i>`;
    else if (m.kind === "text") body = linkify(m.body || "");
    else if (m.kind === "image") body = `<img class="att" data-img="${attr(m.attachment?.path || "")}" alt="${attr(m.attachment?.name || "Foto")}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="240" height="180">${m.body ? `<div>${linkify(m.body)}</div>` : ""}`;
    else if (m.kind === "file") body = `<button class="row gap" data-file="${attr(m.attachment?.path || "")}" style="text-align:left">${icon("file", "accent")}<span><b>${esc(m.attachment?.name || "Arquivo")}</b><br><span class="tiny muted">${m.attachment?.size ? (m.attachment.size / 1048576).toFixed(1) + " MB" : ""}</span></span></button>`;
    else if (m.kind === "song") {
      const s = songsMap.get(m.song_id);
      body = s ? `<div class="songmsg"><span class="cover" style="width:46px;height:46px">${s.cover_url ? `<img src="${attr(s.cover_url)}" alt="">` : icon("music")}</span>
        <a class="grow" href="#/musica/${s.id}" style="color:inherit;min-width:0"><b class="ellipsis" style="display:block">${esc(s.title)}</b><span class="tiny muted">${esc(s.artist || "")}${s.song_key ? " · " + esc(s.song_key) : ""}</span></a>
        ${s.current_project_id && s.status === "ready" ? `<a class="playbtn" href="#/player/${s.id}" aria-label="Tocar">${icon("play")}</a>` : ""}</div>` : `<i class="muted">Música indisponível</i>`;
    } else if (m.kind === "poll") body = pollHtml(polls.get(m.poll_id));
    return `<div class="msg${me ? " me" : ""}" data-mid="${m.id}">${me ? "" : avatar(ppl.get(m.user_id), 30, false)}<div class="bubble">${who}${body}<div class="when">${fTime(m.created_at)}</div></div></div>`;
  }
  function pollHtml(p) {
    if (!p) return `<i class="muted">Enquete</i>`;
    const v = votes.get(p.id) || [];
    const voters = new Set(v.map((x) => x.user_id)).size;
    return `<div class="pollbox" data-poll="${p.id}"><div class="q">📊 ${esc(p.question)}</div>${p.options.map((o, i) => {
      const n = v.filter((x) => x.option_index === i).length; const pct = voters ? Math.round((n / voters) * 100) : 0;
      const mine = v.some((x) => x.option_index === i && x.user_id === state.user.id);
      return `<button class="pollopt${mine ? " mine" : ""}" data-vote="${i}" ${p.closed_at ? "disabled" : ""}><i class="bar" style="width:${pct}%"></i><span><span>${mine ? "✓ " : ""}${esc(o)}</span><b>${n}</b></span></button>`;
    }).join("")}<div class="tiny muted mt-s">${voters} voto(s)${p.multiple ? " · várias respostas" : ""}${p.closed_at ? " · encerrada" : ""}
      ${!p.closed_at && (p.created_by === state.user.id || canManageTeam(teamId)) ? ` · <button class="link tiny" data-close-poll="${p.id}">encerrar</button>` : ""}</div></div>`;
  }

  function render(scrollToEnd) {
    const list = [...msgs.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let lastDay = "";
    const html = list.map((m) => { const d = fDate(m.created_at); const sep = d !== lastDay ? `<div class="day-sep">${d}</div>` : ""; lastDay = d; return sep + bubble(m); }).join("");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    box.innerHTML = (done ? `<div class="day-sep">Início da conversa</div>` : "") + (html || empty("chat", "Comece a conversa", "As mensagens são vistas só pelos integrantes deste time."));
    box.querySelectorAll("img[data-img]").forEach(async (img) => { const u = await signedUrl(img.dataset.img); if (u) { img.src = u; img.removeAttribute("width"); img.removeAttribute("height"); } });
    if (scrollToEnd || atBottom) box.scrollTop = box.scrollHeight;
    else if (scrollToEnd === false) box.scrollTop = prevTop + (box.scrollHeight - prevH);
  }

  async function loadInitial() {
    const rows = await must(sb.from("messages").select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(50));
    done = rows.length < 50;
    await hydrate(rows);
    rows.forEach((m) => msgs.set(m.id, m));
    oldest = rows[rows.length - 1]?.created_at || null;
    newest = rows[0]?.created_at || new Date(0).toISOString();
    render(true);
    markRead();
  }
  async function loadOlder() {
    if (loadingOlder || done || !oldest) return;
    loadingOlder = true;
    const rows = await must(sb.from("messages").select("*").eq("team_id", teamId).lt("created_at", oldest).order("created_at", { ascending: false }).limit(50));
    done = rows.length < 50;
    await hydrate(rows);
    rows.forEach((m) => msgs.set(m.id, m));
    if (rows.length) oldest = rows[rows.length - 1].created_at;
    render(false);
    loadingOlder = false;
  }
  async function loadNewer() {
    const rows = await must(sb.from("messages").select("*").eq("team_id", teamId).gt("created_at", newest).order("created_at").limit(100));
    if (!rows.length) return;
    await hydrate(rows);
    rows.forEach((m) => msgs.set(m.id, m));
    newest = rows[rows.length - 1].created_at;
    render();
    markRead();
  }
  const markRead = () => sb.from("chat_reads").upsert({ team_id: teamId, user_id: state.user.id, last_read_at: new Date().toISOString() }, { onConflict: "team_id,user_id" })
    .then(() => sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", state.user.id).eq("kind", "message").is("read_at", "null").eq("data->>team_id", teamId))
    .then(() => document.dispatchEvent(new Event("badges")));

  await loadInitial();
  box.addEventListener("scroll", () => { if (box.scrollTop < 60) loadOlder(); }, { passive: true });

  // tempo real com consulta periódica de reserva
  const unsub = sb.realtime.subscribe(`chat:${teamId}`, [
    { event: "INSERT", schema: "public", table: "messages", filter: `team_id=eq.${teamId}` },
    { event: "*", schema: "public", table: "poll_votes" },
  ], async (ev) => {
    if (ev.table === "messages" && ev.record) { await hydrate([ev.record]); msgs.set(ev.record.id, ev.record); if (ev.record.created_at > newest) newest = ev.record.created_at; render(); markRead(); }
    if (ev.table === "poll_votes") { const ids = [...polls.keys()]; if (ids.length) { await refreshVotes(ids); render(); } }
  });
  let ticks = 0;
  const timer = setInterval(async () => {
    if (!alive() || !document.body.contains(box)) { clearInterval(timer); unsub(); return; }
    const live = sb.realtime.isJoined(`chat:${teamId}`);
    const lbl = el.querySelector("#live"); if (lbl) lbl.textContent = live ? "ao vivo" : "atualizando automaticamente";
    if (!live || ++ticks % 6 === 0) {
      await loadNewer().catch(() => {});
      const ids = [...polls.keys()];
      if (ids.length) {
        const before = JSON.stringify(ids.map((i) => votes.get(i)?.length ?? 0));
        await refreshVotes(ids).catch(() => {});
        if (JSON.stringify(ids.map((i) => votes.get(i)?.length ?? 0)) !== before) render();
      }
    }
  }, 4000);

  // envio
  const txt = el.querySelector("#txt");
  txt.addEventListener("input", () => { txt.style.height = "auto"; txt.style.height = Math.min(140, txt.scrollHeight) + "px"; });
  txt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(); } });
  el.querySelector("#send").onclick = () => send();
  async function post(row) {
    const { data, error } = await sb.from("messages").insert({ org_id: state.org.id, team_id: teamId, user_id: state.user.id, ...row }).select("*").single();
    if (error) { toast(errMsg(error), "err"); return null; }
    await hydrate([data]); msgs.set(data.id, data); if (data.created_at > newest) newest = data.created_at; render(true);
    return data;
  }
  async function send() {
    const body = txt.value.trim(); if (!body) return;
    txt.value = ""; txt.style.height = "auto";
    if (!(await post({ kind: "text", body }))) txt.value = body;
  }
  async function sendFile(file, kind) {
    if (!file) return;
    if (file.size > 50 * 1048576) return toast("Arquivo maior que 50 MB.", "err");
    const f = kind === "image" ? await shrinkImage(file, 1600) : file;
    toast("Enviando…");
    const path = `chat/${state.org.id}/${teamId}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await sb.storage.from("private").upload(path, f);
    if (up.error) return toast(errMsg(up.error), "err");
    await post({ kind, attachment: { path, name: f.name, size: f.size, mime: f.type } });
  }
  el.querySelector("#att").onclick = () => {
    const s = sheet(`<h3>Anexar</h3><div class="attgrid">
      <button data-a="camera">${icon("camera")}Câmera</button><button data-a="gallery">${icon("image")}Foto ou galeria</button>
      <button data-a="file">${icon("file")}Arquivo</button>${teamHasRepertoire(team) ? `<button data-a="song">${icon("music")}Música</button>` : ""}<button data-a="poll">${icon("poll")}Enquete</button></div>`);
    s.el.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      s.close();
      if (a === "camera") sendFile(await pickFile("image/*", "environment"), "image");
      if (a === "gallery") sendFile(await pickFile("image/*"), "image");
      if (a === "file") { const f = await pickFile("*/*"); if (f) sendFile(f, f.type.startsWith("image/") ? "image" : "file"); }
      if (a === "song") songPicker([], (song) => song && post({ kind: "song", song_id: song.id }), { title: "Compartilhar música", multi: false });
      if (a === "poll") pollForm();
    });
  };
  function pollForm() {
    const s = sheet(`<h3>Nova enquete</h3><form id="pf"><label class="field"><span>Pergunta</span><input name="q" required maxlength="300" placeholder="Ex.: Ensaio no sábado às 16h?"></label>
      <div class="field"><span>Alternativas</span><div id="opts">${[0, 1].map((i) => `<input class="input mt-s" name="o" maxlength="120" placeholder="Opção ${i + 1}" required>`).join("")}</div>
      <button type="button" class="btn ghost sm mt-s" id="more">${icon("plus")} Mais uma opção</button></div>
      <label class="check"><input type="checkbox" name="multi"> Permitir mais de uma resposta</label><button class="btn primary block mt">Enviar enquete</button></form>`);
    s.el.querySelector("#more").onclick = () => { const n = s.el.querySelectorAll("[name=o]").length; if (n < 12) s.el.querySelector("#opts").insertAdjacentHTML("beforeend", `<input class="input mt-s" name="o" maxlength="120" placeholder="Opção ${n + 1}">`); };
    s.el.querySelector("#pf").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const options = fd.getAll("o").map((x) => String(x).trim()).filter(Boolean);
      if (options.length < 2) return toast("Informe ao menos duas opções.", "err");
      const { data, error } = await sb.from("polls").insert({ org_id: state.org.id, team_id: teamId, question: fd.get("q").trim(), options, multiple: !!fd.get("multi"), created_by: state.user.id }).select("*").single();
      if (error) return toast(errMsg(error), "err");
      polls.set(data.id, data); votes.set(data.id, []);
      s.close(); post({ kind: "poll", poll_id: data.id });
    };
  }
  on(box, "click", "[data-vote]", async (e, b) => {
    const pid = b.closest("[data-poll]").dataset.poll; const p = polls.get(pid); const i = Number(b.dataset.vote);
    const mine = (votes.get(pid) || []).filter((v) => v.user_id === state.user.id);
    if (mine.some((v) => v.option_index === i)) await sb.from("poll_votes").delete().eq("poll_id", pid).eq("user_id", state.user.id).eq("option_index", i);
    else {
      if (!p.multiple && mine.length) await sb.from("poll_votes").delete().eq("poll_id", pid).eq("user_id", state.user.id);
      const r = await sb.from("poll_votes").insert({ poll_id: pid, user_id: state.user.id, option_index: i });
      if (r.error) toast(errMsg(r.error), "err");
    }
    await refreshVotes([pid]); render();
  });
  on(box, "click", "[data-close-poll]", async (e, b) => {
    if (!(await confirmDialog("Encerrar esta enquete?", "Encerrar"))) return;
    const r = await sb.from("polls").update({ closed_at: new Date().toISOString() }).eq("id", b.dataset.closePoll).select("*").single();
    if (r.error) return toast(errMsg(r.error), "err");
    polls.set(r.data.id, r.data); render();
  });
  on(box, "click", "[data-file]", async (e, b) => { const u = await signedUrl(b.dataset.file); if (u) window.open(u, "_blank", "noopener"); });
  on(box, "click", "img[data-img]", (e, img) => { if (img.src.startsWith("http")) sheet(`<img src="${attr(img.src)}" alt="" style="width:100%;border-radius:14px">`, { wide: true }); });
}

// Compartilhar músicas da biblioteca no chat de um time
export function shareSongsToChat(songIds) {
  const teams = state.myTeams.filter(teamHasRepertoire);
  if (!teams.length) return toast("Você não participa de nenhum time de Louvor.");
  const s = sheet(`<h3>Enviar para qual time?</h3><div class="list">${teams.map((t) => `<button class="li" data-t="${t.id}">${teamBadge(t, 40)}<span class="grow t">${esc(t.name)}</span>${icon("chevronRight", "chev")}</button>`).join("")}</div>`);
  on(s.el, "click", "[data-t]", async (e, b) => {
    busy(b);
    const { error } = await sb.from("messages").insert(songIds.map((id) => ({ org_id: state.org.id, team_id: b.dataset.t, user_id: state.user.id, kind: "song", song_id: id })));
    if (error) { busy(b, false); return toast(errMsg(error), "err"); }
    s.close(); toast("Enviado no chat"); go(`/chat/${b.dataset.t}`);
  });
}
