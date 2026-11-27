// Comunicação: comunicados (público, agenda, validade, fixação), pregações e preferências de notificação.
// Toda regra (quem vê, quando aparece, quem recebe aviso) está no banco; aqui só se escolhe o que mostrar.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, pickFile, uploadPublic, safeUrl } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen, toLocalInput, iso } from "../lib/mod-ui.js";

export function register(route) {
  route("/comunicacao", (p, el, a) => manage(el, a));
  route("/pregacoes", (p, el, a) => sermons(el, a));
  route("/notificacoes/preferencias", (p, el, a) => prefs(el, a));
}

const tag = (t, c = "none") => `<span class="ptag ${c}">${esc(t)}</span>`;
const STATE = { draft: ["Rascunho", "none"], scheduled: ["Agendado", "st-pending"], live: ["No ar", "st-approved"], expired: ["Vencido", "none"], unpublished: ["Despublicado", "none"] };
const AUD = { all: "Toda a igreja", visitor: "Visitantes", attender: "Frequentadores", member: "Membros", segment: "Segmento", group: "Grupo", cell: "Célula" };
const mine = (v) => (v == null ? "" : String(v));

// ---------------------------------------------------------------- gestão (SOMOS Chamados → Comunicação)
async function manage(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Comunicação")}${spinner()}`;
  const first = await sb.rpc("comm_ann_list", { p_org: org, p_filter: {} }); if (!alive()) return;
  if (first.error) return fail(el, "Comunicação", first.error);
  let meta = first.data, tab = "ann", st = "", q = "";
  const shell = () => {
    const tabs = [["ann", "Comunicados"], [meta.can.sermons, "ser", "Pregações"], ["info", "Notificações"]].map((t) => (t.length === 2 ? [true, t[0], t[1]] : t)).filter((t) => t[0]);
    el.innerHTML = `${head("Comunicação")}<nav class="tabs">${tabs.map((t) => `<button class="${tab === t[1] ? "on" : ""}" data-t="${t[1]}">${t[2]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    return el.querySelector("#body");
  };
  const draw = async () => { const body = shell(); await (tab === "ann" ? announcements : tab === "ser" ? sermonsAdmin : info)(body); };

  async function announcements(body) {
    const x = await sb.rpc("comm_ann_list", { p_org: org, p_filter: { state: st || null, q: q || null } }); if (!alive()) return;
    if (x.error) { body.innerHTML = `<div class="card small">${esc(errText(x.error))}</div>`; return; }
    meta = x.data; const items = meta.items;
    body.innerHTML = `${meta.can.manage ? `<button class="btn primary sm mb" id="new">${icon("plus")} Novo comunicado</button>` : ""}
      <div class="chips mb">${[["", "Todos"], ["draft", "Rascunhos"], ["scheduled", "Agendados"], ["live", "No ar"], ["expired", "Vencidos"], ["unpublished", "Despublicados"]].map(([k, l]) => `<button class="chip ${st === k ? "on" : ""}" data-s="${k}">${l}</button>`).join("")}</div>
      <input class="psearch mb" id="q" type="search" placeholder="Buscar pelo título" aria-label="Buscar comunicado" value="${attr(q)}">
      <div class="list">${items.map((a) => `<button class="li col stack" data-id="${a.id}" style="align-items:stretch"><div class="row between"><b>${a.pinned ? "📌 " : ""}${esc(a.title)}</b>${tag(STATE[a.state][0], STATE[a.state][1])}</div>
        <span class="small muted">${AUD[a.audience]}${a.state === "scheduled" ? ` · sai em ${fmtWhen(a.publish_at)}` : a.state === "live" ? ` · desde ${fmtWhen(a.publish_at || a.created_at)}` : ""}${a.expires_at ? ` · válido até ${fmtWhen(a.expires_at)}` : ""}</span></button>`).join("") || empty("megaphone", "Nenhum comunicado aqui")}</div>`;
    body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { st = b.dataset.s; draw(); }));
    let t; body.querySelector("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); draw(); }, 400); };
    if (body.querySelector("#new")) body.querySelector("#new").onclick = () => form(null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => detail(items.find((a) => a.id === b.dataset.id))));
  }

  function detail(a) {
    const can = meta.can, live = a.state === "live", sched = a.state === "scheduled";
    const s = sheet(`<h3>${esc(a.title)}</h3><p class="row gap-s">${tag(STATE[a.state][0], STATE[a.state][1])}${a.pinned ? tag("Fixado") : ""}</p>
      ${a.body ? `<p class="small" style="white-space:pre-wrap">${esc(a.body)}</p>` : ""}
      <div class="card small" style="display:flex;flex-direction:column;gap:4px"><div>Público: <b>${esc(audLabel(a))}</b></div>${a.publish_at ? `<div>${sched ? "Sai em" : "Publicado em"}: ${fmtWhen(a.publish_at)}</div>` : ""}${a.expires_at ? `<div>Válido até: ${fmtWhen(a.expires_at)}</div>` : ""}${a.link_url ? `<div>Link: ${esc(a.link_label || a.link_url)}</div>` : ""}${a.notified ? `<div>Aviso enviado às pessoas do público.</div>` : ""}</div>
      <div class="row gap-s mt" style="flex-wrap:wrap">
        ${can.publish && (a.state === "draft" || a.state === "unpublished" || a.state === "expired") ? `<button class="btn primary sm" id="pub">Publicar</button>` : ""}
        ${can.publish && sched ? `<button class="btn ghost sm" id="pub">Reagendar</button>` : ""}
        ${can.publish && (live || sched) ? `<button class="btn ghost sm" id="unp">Despublicar</button>` : ""}
        ${can.publish && live ? `<button class="btn ghost sm" id="pin">${a.pinned ? "Desafixar" : "Fixar no topo"}</button>` : ""}
        ${can.manage ? `<button class="btn ghost sm" id="ed">Editar</button>` : ""}
        ${can.manage && a.state === "draft" && !a.notified ? `<button class="btn ghost danger sm" id="del">Excluir rascunho</button>` : ""}</div>
      ${live && can.manage ? `<p class="small muted mt">Alterar um comunicado no ar muda o que as pessoas veem agora.</p>` : ""}`);
    const q = (k) => s.el.querySelector(k), done = (m) => { s.close(); toast(m); draw(); };
    if (q("#ed")) q("#ed").onclick = () => { s.close(); form(a); };
    if (q("#pub")) q("#pub").onclick = () => { s.close(); publishSheet(a); };
    if (q("#unp")) q("#unp").onclick = async (ev) => { if (!(await confirmDialog("Tirar este comunicado do ar?", "Despublicar", true))) return; busy(ev.currentTarget); const r = await sb.rpc("comm_ann_unpublish", { p_id: a.id }); if (r.error) return toast(errText(r.error)); done("Comunicado despublicado."); };
    if (q("#pin")) q("#pin").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("comm_ann_pin", { p_id: a.id, p_pinned: !a.pinned }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } done(a.pinned ? "Comunicado desafixado." : "Comunicado fixado."); };
    if (q("#del")) q("#del").onclick = async (ev) => { if (!(await confirmDialog("Excluir este rascunho? Ele nunca foi publicado.", "Excluir", true))) return; busy(ev.currentTarget); const r = await sb.rpc("comm_ann_delete", { p_id: a.id }); if (r.error) return toast(errText(r.error)); done("Rascunho excluído."); };
  }
  const audLabel = (a) => a.audience === "segment" ? `Segmento: ${meta.segments.find((s) => s.id === a.segment_id)?.name || "—"}` : a.audience === "group" ? `Grupo: ${meta.groups.find((s) => s.id === a.group_id)?.name || "—"}` : a.audience === "cell" ? `Célula: ${meta.cells.find((s) => s.id === a.cell_id)?.name || "—"}` : AUD[a.audience];

  function publishSheet(a) {
    const s = sheet(`<h3>Publicar “${esc(a.title)}”</h3><p class="small muted">Público: ${esc(audLabel(a))}. Só quem faz parte do público vê e recebe o aviso.</p>
      <label class="small row gap-s mb"><input type="radio" name="w" value="now" checked> Publicar agora e avisar o público</label>
      <label class="small row gap-s mb"><input type="radio" name="w" value="later"> Agendar para</label><label class="fld"><input id="when" type="datetime-local" min="${toLocalInput(new Date(Date.now() + 60000))}" value="${toLocalInput(new Date(Date.now() + 3600000))}"></label>
      <p class="small muted">Agendados aparecem na hora marcada. O aviso no celular depende do envio automático do servidor (a cada 10 minutos).</p><button class="btn block mt" id="go">Confirmar</button>`);
    s.el.querySelector("#go").onclick = async (ev) => {
      const later = s.el.querySelector('[name="w"]:checked').value === "later", when = s.el.querySelector("#when").value;
      if (later && !when) return toast("Escolha a data e a hora.");
      busy(ev.currentTarget); const r = await sb.rpc("comm_ann_publish", { p_id: a.id, p_when: later ? new Date(when).toISOString() : null }); busy(ev.currentTarget, false);
      if (r.error) return toast(errText(r.error)); s.close(); toast(r.data.scheduled ? "Comunicado agendado." : `Comunicado publicado. ${r.data.notified} pessoa${r.data.notified === 1 ? "" : "s"} avisada${r.data.notified === 1 ? "" : "s"}.`); draw();
    };
  }

  function form(a) {
    const v = a || { audience: "all" }; let image = null;
    const opt = (rows, sel) => `<option value="">Escolher</option>${rows.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}`;
    const s = sheet(`<h3>${a ? "Editar comunicado" : "Novo comunicado"}</h3>
      <label class="fld">Título<input id="t" maxlength="140" value="${attr(v.title || "")}"></label>
      <label class="fld">Texto<textarea id="b" rows="5" maxlength="4000">${esc(v.body || "")}</textarea></label>
      <div class="row gap-s"><label class="fld grow">Link (opcional)<input id="l" placeholder="https://… ou #/eventos" value="${attr(v.link_url || "")}"></label><label class="fld grow">Texto do botão<input id="ll" maxlength="40" placeholder="Saiba mais" value="${attr(v.link_label || "")}"></label></div>
      <label class="fld">Etiqueta (opcional)<input id="tg" maxlength="30" value="${attr(v.tag || "")}"></label>
      <div class="fld">Imagem (opcional)<div class="row gap-s"><button class="btn ghost sm" id="im" type="button">${icon("image")} <span id="imn">${v.image_url ? "Trocar imagem" : "Escolher imagem"}</span></button></div></div>
      <label class="fld">Quem vê<select id="a">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld" id="fs" hidden><span id="fsl">Segmento</span><select id="sel"></select></label>
      <label class="fld">Válido até (opcional)<input id="e" type="datetime-local" value="${v.expires_at ? toLocalInput(v.expires_at) : ""}"></label>
      <p class="small muted">Salvar guarda como rascunho. Publicar e agendar é um passo à parte${meta.can.publish ? "" : ", feito por quem tem a permissão de publicar"}.</p><button class="btn block mt" id="ok">Salvar</button>`);
    const q = (k) => s.el.querySelector(k);
    const paint = () => {
      const k = q("#a").value, rows = k === "segment" ? meta.segments : k === "group" ? meta.groups : k === "cell" ? meta.cells : null;
      q("#fs").hidden = !rows; if (rows) { q("#fsl").textContent = { segment: "Segmento", group: "Grupo", cell: "Célula" }[k]; q("#sel").innerHTML = opt(rows, k === "segment" ? v.segment_id : k === "group" ? v.group_id : v.cell_id); }
    };
    q("#a").onchange = paint; paint();
    q("#im").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { image = await uploadPublic(`announcements/${org}`, f); q("#imn").textContent = "Imagem anexada"; } catch { toast("Não foi possível enviar a imagem."); } };
    q("#ok").onclick = async (ev) => {
      if (!q("#t").value.trim()) return toast("Informe o título.");
      const k = q("#a").value, needs = ["segment", "group", "cell"].includes(k); if (needs && !q("#sel").value) return toast("Escolha o público.");
      const p = { title: q("#t").value, body: q("#b").value, link_url: q("#l").value, link_label: q("#ll").value, tag: q("#tg").value, image_url: image, audience: k, expires_at: q("#e").value ? new Date(q("#e").value).toISOString() : null,
        segment_id: k === "segment" ? q("#sel").value : null, group_id: k === "group" ? q("#sel").value : null, cell_id: k === "cell" ? q("#sel").value : null };
      busy(ev.currentTarget); const r = await sb.rpc("comm_ann_save", { p_org: org, p_id: a?.id || null, p }); busy(ev.currentTarget, false);
      if (r.error) return toast(errText(r.error)); s.close(); toast(a ? "Comunicado salvo." : "Rascunho salvo. Publique quando estiver pronto."); draw();
    };
  }

  // ------------------------------------------------------------ pregações (equipe)
  async function sermonsAdmin(body) {
    const x = await sb.rpc("sermon_list", { p_org: org, p_filter: { q: q || null } }); if (!alive()) return;
    if (x.error) { body.innerHTML = `<div class="card small">${esc(errText(x.error))}</div>`; return; }
    const { items, series } = x.data;
    body.innerHTML = `<div class="row gap-s mb" style="flex-wrap:wrap"><button class="btn primary sm" id="new">${icon("plus")} Nova pregação</button><button class="btn ghost sm" id="ns">${icon("plus")} Nova série</button></div>
      <input class="psearch mb" id="q" type="search" placeholder="Buscar por título, pregador ou texto bíblico" aria-label="Buscar pregação" value="${attr(q)}">
      ${series.length ? `<p class="small muted">Séries: ${series.map((s) => esc(s.name) + " (" + s.count + ")").join(" · ")}</p>` : ""}
      <div class="list">${items.map((z) => `<button class="li col stack" data-id="${z.id}" style="align-items:stretch"><div class="row between"><b>${esc(z.title)}</b>${tag(z.status === "published" ? "Publicada" : "Rascunho", z.status === "published" ? "st-approved" : "none")}</div>
        <span class="small muted">${[z.preacher, z.preached_on && new Date(z.preached_on + "T12:00").toLocaleDateString("pt-BR"), z.series, z.scripture].filter(Boolean).map(esc).join(" · ")}</span></button>`).join("") || empty("play", "Nenhuma pregação cadastrada")}</div>`;
    let t; body.querySelector("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); draw(); }, 400); };
    body.querySelector("#new").onclick = () => sermonForm(null, series, () => draw());
    body.querySelector("#ns").onclick = () => seriesForm(() => draw());
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => sermonForm(items.find((z) => z.id === b.dataset.id), series, () => draw())));
  }
  async function info(body) {
    body.innerHTML = `<div class="card"><h3 style="margin-top:0">Notificações no app</h3><p class="small">Comunicados publicados avisam só quem faz parte do público e respeitam a preferência de cada pessoa. Cada pessoa recebe no máximo 5 avisos novos por dia; o restante continua no mural.</p></div>
      <div class="card mt"><h3 style="margin-top:0">Notificação no celular (push) e e-mail</h3><p class="small">Não configurados. Dependem de chaves de envio e de um serviço externo, que ainda não foram conectados. Nada é enviado fora do app.</p></div>
      <div class="card mt"><h3 style="margin-top:0">Comunicados agendados</h3><p class="small">Aparecem no mural na hora marcada. O aviso de notificação sai pelo envio automático do servidor (a cada 10 minutos), quando ele está ativo no seu Supabase.</p></div>`;
  }
  draw();
}

export function sermonForm(z, series, again) {
  const org = state.org.id, v = z || { audience: "all" }; let links = [...(v.links || [])], image = null;
  const s = sheet(`<h3>${z ? "Editar pregação" : "Nova pregação"}</h3>
    <label class="fld">Título<input id="t" maxlength="160" value="${attr(v.title || "")}"></label>
    <div class="row gap-s"><label class="fld grow">Pregador<input id="p" maxlength="120" value="${attr(v.preacher || "")}"></label><label class="fld grow">Data<input id="d" type="date" value="${v.preached_on || ""}"></label></div>
    <div class="row gap-s"><label class="fld grow">Série<select id="s"><option value="">Nenhuma</option>${series.map((x) => `<option value="${x.id}" ${x.id === v.series_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label><label class="fld grow">Categoria<input id="c" maxlength="40" value="${attr(v.category || "")}"></label></div>
    <label class="fld">Texto bíblico<input id="sc" maxlength="160" placeholder="Romanos 3:21-26" value="${attr(v.scripture || "")}"></label>
    <label class="fld">Descrição<textarea id="ds" rows="4" maxlength="3000">${esc(v.description || "")}</textarea></label>
    <label class="fld">Vídeo (link)<input id="vi" placeholder="https://" value="${attr(v.video_url || "")}"></label><label class="fld">Áudio (link)<input id="au" placeholder="https://" value="${attr(v.audio_url || "")}"></label>
    <div class="fld">Imagem (opcional)<div class="row gap-s"><button class="btn ghost sm" id="im" type="button">${icon("image")} <span id="imn">${v.image_url ? "Trocar imagem" : "Escolher imagem"}</span></button></div></div>
    <div class="fld">Links relacionados<div id="ls"></div><button class="btn ghost sm" id="al" type="button">${icon("plus")} Adicionar link</button></div>
    <label class="fld">Quem vê<select id="a">${[["all", "Toda a igreja"], ["visitor", "Visitantes"], ["attender", "Frequentadores"], ["member", "Membros"]].map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="row gap-s mt">${z ? `<button class="btn ghost" id="st">${z.status === "published" ? "Voltar a rascunho" : "Publicar"}</button>` : ""}<button class="btn grow" id="ok">Salvar</button></div>`);
  const q = (k) => s.el.querySelector(k);
  const paintLinks = () => { q("#ls").innerHTML = links.map((l, i) => `<div class="row gap-s mb"><input data-l="${i}" data-k="label" placeholder="Nome" maxlength="60" value="${attr(l.label || "")}"><input data-l="${i}" data-k="url" placeholder="https://" value="${attr(l.url || "")}"><button class="btn ghost sm" data-r="${i}" type="button" aria-label="Remover link">${icon("trash")}</button></div>`).join("");
    q("#ls").querySelectorAll("[data-l]").forEach((i) => (i.oninput = () => { links[Number(i.dataset.l)][i.dataset.k] = i.value; })); q("#ls").querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { links.splice(Number(b.dataset.r), 1); paintLinks(); })); };
  paintLinks(); q("#al").onclick = () => { if (links.length >= 8) return toast("No máximo 8 links."); links.push({ label: "", url: "" }); paintLinks(); };
  q("#im").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { image = await uploadPublic(`announcements/${org}`, f); q("#imn").textContent = "Imagem anexada"; } catch { toast("Não foi possível enviar a imagem."); } };
  const payload = () => ({ title: q("#t").value, preacher: q("#p").value, preached_on: q("#d").value || null, series_id: q("#s").value || null, category: q("#c").value, scripture: q("#sc").value, description: q("#ds").value,
    video_url: q("#vi").value, audio_url: q("#au").value, image_url: image, audience: q("#a").value, links: links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })) });
  q("#ok").onclick = async (ev) => { if (!q("#t").value.trim()) return toast("Informe o título."); busy(ev.currentTarget); const r = await sb.rpc("sermon_save", { p_org: org, p_id: z?.id || null, p: payload() }); busy(ev.currentTarget, false); if (r.error) return toast(errText(r.error)); s.close(); toast("Pregação salva. Ela só aparece para a igreja depois de publicada."); again(); };
  if (q("#st")) q("#st").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("sermon_set_status", { p_id: z.id, p_publish: z.status !== "published" }); busy(ev.currentTarget, false); if (r.error) return toast(errText(r.error)); s.close(); toast(z.status === "published" ? "Voltou a rascunho." : "Pregação publicada."); again(); };
}
function seriesForm(again) {
  const s = sheet(`<h3>Nova série</h3><label class="fld">Nome<input id="n" maxlength="100"></label><label class="fld">Descrição (opcional)<textarea id="d" rows="3" maxlength="500"></textarea></label><button class="btn block mt" id="ok">Salvar</button>`);
  s.el.querySelector("#ok").onclick = async (ev) => { const n = s.el.querySelector("#n").value.trim(); if (!n) return toast("Informe o nome."); busy(ev.currentTarget); const r = await sb.rpc("sermon_series_save", { p_org: state.org.id, p_id: null, p: { name: n, description: s.el.querySelector("#d").value } }); busy(ev.currentTarget, false); if (r.error) return toast(errText(r.error)); s.close(); toast("Série criada."); again(); };
}

// ---------------------------------------------------------------- pregações (membro)
async function sermons(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Pregações")}${spinner()}`;
  let f = { q: decodeURIComponent((location.hash.split("?q=")[1] || "").split("&")[0]), series_id: "", category: "" };
  const load = async () => {
    const x = await sb.rpc("sermon_list", { p_org: org, p_filter: { q: f.q || null, series_id: f.series_id || null, category: f.category || null } }); if (!alive()) return;
    if (x.error) return fail(el, "Pregações", x.error);
    const { items, series, categories, can } = x.data;
    el.innerHTML = `${head("Pregações")}${can ? `<a class="btn ghost sm mb" href="#/comunicacao">${icon("plus")} Gerenciar pregações</a>` : ""}
      <input class="psearch mb" id="q" type="search" placeholder="Buscar por título, pregador ou texto bíblico" aria-label="Buscar pregação" value="${attr(f.q)}">
      ${series.length ? `<div class="chips mb"><button class="chip ${f.series_id ? "" : "on"}" data-se="">Todas as séries</button>${series.filter((s) => s.count).map((s) => `<button class="chip ${f.series_id === s.id ? "on" : ""}" data-se="${s.id}">${esc(s.name)}</button>`).join("")}</div>` : ""}
      ${categories.length > 1 ? `<div class="chips mb"><button class="chip ${f.category ? "" : "on"}" data-ca="">Todas as categorias</button>${categories.map((c) => `<button class="chip ${f.category === c ? "on" : ""}" data-ca="${attr(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
      <div class="list">${items.map((z) => `<button class="li" data-id="${z.id}"><span class="cover" style="width:56px;height:56px">${safeUrl(z.image_url) ? `<img src="${attr(z.image_url)}" alt="">` : icon("play")}</span><span class="grow"><span class="t">${esc(z.title)}</span><span class="s">${[z.preacher, z.preached_on && new Date(z.preached_on + "T12:00").toLocaleDateString("pt-BR"), z.series].filter(Boolean).map(esc).join(" · ")}</span></span>${icon("chevronRight", "chev")}</button>`).join("") || empty("play", "Nenhuma pregação encontrada")}</div>`;
    let t; const qi = el.querySelector("#q"); qi.oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { f.q = e.target.value.trim(); await load(); el.querySelector("#q")?.focus(); }, 400); };
    el.querySelectorAll("[data-se]").forEach((b) => (b.onclick = () => { f.series_id = b.dataset.se; load(); }));
    el.querySelectorAll("[data-ca]").forEach((b) => (b.onclick = () => { f.category = b.dataset.ca; load(); }));
    el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => open(items.find((z) => z.id === b.dataset.id))));
  };
  const open = (z) => {
    const v = safeUrl(z.video_url), a = safeUrl(z.audio_url), img = safeUrl(z.image_url);
    sheet(`${img ? `<img src="${attr(img)}" alt="" style="border-radius:16px;margin-bottom:14px;max-height:220px;width:100%;object-fit:cover">` : ""}<h3>${esc(z.title)}</h3>
      <p class="small muted">${[z.preacher, z.preached_on && new Date(z.preached_on + "T12:00").toLocaleDateString("pt-BR"), z.series, z.category].filter(Boolean).map(esc).join(" · ")}</p>
      ${z.scripture ? `<p class="small"><b>Texto bíblico:</b> ${esc(z.scripture)}</p>` : ""}${z.description ? `<p class="small" style="white-space:pre-wrap">${esc(z.description)}</p>` : ""}
      <div class="row gap-s mt" style="flex-wrap:wrap">${v ? `<a class="btn primary sm" href="${attr(v)}" target="_blank" rel="noopener">${icon("play")} Assistir</a>` : ""}${a ? `<a class="btn ghost sm" href="${attr(a)}" target="_blank" rel="noopener">${icon("music")} Ouvir</a>` : ""}
      ${(z.links || []).map((l) => (safeUrl(l.url) ? `<a class="btn ghost sm" href="${attr(safeUrl(l.url))}" target="_blank" rel="noopener">${icon("link")} ${esc(l.label || "Abrir link")}</a>` : "")).join("")}</div>`);
  };
  await load();
}

// ---------------------------------------------------------------- preferências de notificação
async function prefs(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Preferências de notificação")}${spinner()}`;
  const x = await sb.rpc("notif_prefs_get", { p_org: org }); if (!alive()) return;
  if (x.error) return fail(el, "Preferências de notificação", x.error);
  const d = x.data;
  el.innerHTML = `${head("Preferências de notificação")}<p class="small muted">Escolha o que você quer receber no app. O conteúdo continua disponível mesmo com o aviso desligado.</p>
    <div class="list">${d.groups.map((g) => `<label class="li"><span class="grow"><span class="t">${esc(g.label)}</span><span class="s">${esc(g.hint)}</span></span><input type="checkbox" data-g="${g.key}" ${g.enabled ? "checked" : ""} aria-label="${attr(g.label)}"></label>`).join("")}</div>
    <p class="small muted mt">${esc(d.note)}</p><div class="card small mt">Notificação no celular (push): ${d.push.configured ? "ativa" : "ainda não configurada pela igreja."}</div>`;
  el.querySelectorAll("[data-g]").forEach((c) => (c.onchange = async () => { const r = await sb.rpc("notif_prefs_set", { p_org: org, p_grp: c.dataset.g, p_enabled: c.checked }); if (r.error) { c.checked = !c.checked; return toast(errText(r.error)); } toast(c.checked ? "Ligado." : "Desligado."); }));
}
