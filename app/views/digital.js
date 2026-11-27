// Experiência Digital: conteúdos, planos de leitura, busca integrada e gestão (conteúdos, planos e atalhos da Home).
// Toda regra (quem vê o quê, publicado ou rascunho) está no banco; aqui só se escolhe como mostrar.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, pickFile, uploadPublic, safeUrl } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, toLocalInput } from "../lib/mod-ui.js";

export function register(route) {
  route("/conteudos", (p, el, a) => contents(el, a));
  route("/conteudos/:id", (p, el, a) => contentOpen(el, a, p.id));
  route("/planos", (p, el, a) => plans(el, a));
  route("/planos/:id", (p, el, a) => planOpen(el, a, p.id));
  route("/busca", (p, el, a) => searchPage(el, a));
  route("/digital-gestao", (p, el, a) => manage(el, a));
}

const org = () => state.org?.id;
const tag = (t, c = "none") => `<span class="ptag ${c}">${esc(t)}</span>`;
const KIND = { video: "Vídeo", audio: "Áudio", study: "Estudo", download: "Material", institutional: "Institucional" };
const KICON = { video: "play", audio: "music", study: "book", download: "download", institutional: "file" };
const AUD = { all: "Todos", visitor: "Visitantes", attender: "Frequentadores", member: "Membros" };
const BACK = ["#/", "Início"];
const thumb = (c) => `<span class="dc-art" style="width:56px;height:56px;border-radius:12px;flex:none">${c.image_url ? `<img src="${attr(c.image_url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ""}<i class="dc-ico">${icon(KICON[c.kind] || "file")}</i></span>`;

// ---------------------------------------------------------------- conteúdos
async function contents(el, alive) {
  el.innerHTML = `${head("Conteúdos", BACK)}${spinner()}`;
  let f = { q: "", kind: "", series_id: "" };
  const load = async () => {
    const x = await sb.rpc("content_list", { p_org: org(), p_filter: { q: f.q || null, kind: f.kind || null, series_id: f.series_id || null } }); if (!alive()) return;
    if (x.error) return fail(el, "Conteúdos", x.error, BACK);
    const { items, series, can_manage } = x.data;
    el.innerHTML = `${head("Conteúdos", BACK, can_manage ? `<a class="btn ghost sm" href="#/digital-gestao">Gerenciar</a>` : "")}
      <input class="psearch mb" id="q" type="search" placeholder="Buscar conteúdo" aria-label="Buscar conteúdo" value="${attr(f.q)}">
      <div class="chips mb">${[["", "Todos"], ...Object.entries(KIND)].map(([k, l]) => `<button class="chip ${f.kind === k ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
      ${series.length ? `<div class="chips mb">${series.map((s) => `<button class="chip ${f.series_id === s.id ? "on" : ""}" data-s="${s.id}">${esc(s.name)}</button>`).join("")}</div>` : ""}
      <div class="list">${items.map((c) => `<a class="li" href="#/conteudos/${c.id}">${thumb(c)}<span class="grow"><span class="t">${esc(c.title)}</span><span class="s">${KIND[c.kind]}${c.series ? " · " + esc(c.series) : ""}</span></span>${icon("chevronRight", "chev")}</a>`).join("")
        || empty("play", f.q || f.kind || f.series_id ? "Nada encontrado com esses filtros" : "Ainda não há conteúdos publicados")}</div>`;
    let t; const q = el.querySelector("#q"); q.oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load().then(() => el.querySelector("#q")?.focus()); }, 400); };
    el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { f.kind = b.dataset.k; load(); }));
    el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { f.series_id = f.series_id === b.dataset.s ? "" : b.dataset.s; load(); }));
  };
  load();
}
async function contentOpen(el, alive, id) {
  const back = ["#/conteudos", "Conteúdos"]; el.innerHTML = `${head("Conteúdo", back)}${spinner()}`;
  const r = await sb.rpc("content_get", { p_id: id }); if (!alive()) return;
  if (r.error) return fail(el, "Conteúdo", r.error, back);
  const c = r.data, link = safeUrl(c.url), file = safeUrl(c.file_url);
  el.innerHTML = `${head(c.title, back)}
    <div class="card"><p class="row gap-s">${tag(KIND[c.kind])}${c.series ? tag(c.series) : ""}${c.category ? tag(c.category) : ""}${c.status === "draft" ? tag("Rascunho") : ""}</p>
      ${c.image_url ? `<img src="${attr(c.image_url)}" alt="${attr(c.title)}" style="width:100%;border-radius:14px;margin:8px 0" onerror="this.remove()">` : ""}
      ${c.description ? `<p style="white-space:pre-wrap">${esc(c.description)}</p>` : ""}
      <div class="row gap-s mt" style="flex-wrap:wrap">
        ${link ? `<a class="btn primary" href="${attr(link)}" target="_blank" rel="noopener noreferrer">${icon(KICON[c.kind] === "music" ? "music" : "play")} ${c.kind === "audio" ? "Ouvir" : c.kind === "video" ? "Assistir" : "Abrir"}</a>` : ""}
        ${file ? `<a class="btn ${link ? "ghost" : "primary"}" href="${attr(file)}" target="_blank" rel="noopener noreferrer">${icon("download")} Baixar material</a>` : ""}</div></div>`;
}

// ---------------------------------------------------------------- planos de leitura
async function plans(el, alive) {
  el.innerHTML = `${head("Planos de leitura", BACK)}${spinner()}`;
  const r = await sb.rpc("plans_for_me", { p_org: org() }); if (!alive()) return;
  if (r.error) return fail(el, "Planos de leitura", r.error, BACK);
  el.innerHTML = `${head("Planos de leitura", BACK)}<div class="list">${r.data.map((p) => {
    const pct = p.total ? Math.round((p.done * 100) / p.total) : 0;
    return `<a class="li col stack" href="#/planos/${p.id}" style="align-items:stretch"><div class="row between"><b>${esc(p.title)}</b>${p.enrolled ? tag(pct >= 100 ? "Concluído" : "Em andamento", pct >= 100 ? "none" : "st-approved") : tag(p.total + " dias")}</div>
      ${p.description ? `<span class="small muted">${esc(p.description)}</span>` : ""}${p.enrolled ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><span class="small muted">${p.done} de ${p.total} dias</span>` : ""}</a>`;
  }).join("") || empty("book", "Ainda não há planos de leitura", "Quando a igreja publicar um plano, ele aparece aqui.")}</div>`;
}
async function planOpen(el, alive, id) {
  const back = ["#/planos", "Planos de leitura"]; el.innerHTML = `${head("Plano de leitura", back)}${spinner()}`;
  const r = await sb.rpc("plan_get", { p_id: id }); if (!alive()) return;
  if (r.error) return fail(el, "Plano de leitura", r.error, back);
  const p = r.data, done = p.days.filter((d) => d.done).length, pct = p.days.length ? Math.round((done * 100) / p.days.length) : 0;
  el.innerHTML = `${head(p.title, back)}
    ${p.description ? `<p class="small muted">${esc(p.description)}</p>` : ""}
    ${p.enrolled ? `<div class="card"><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="small muted">${done} de ${p.days.length} dias${pct >= 100 ? " · Plano concluído!" : ""}</p></div>`
      : `<button class="btn primary mb" id="go">Começar este plano</button>`}
    <div class="list">${p.days.map((d) => `<div class="li" style="align-items:flex-start">${p.enrolled ? `<input type="checkbox" data-d="${d.day_no}" ${d.done ? "checked" : ""} aria-label="Marcar dia ${d.day_no} como lido">` : ""}
      <span class="grow" style="display:flex;flex-direction:column;gap:4px;align-items:flex-start"><span class="t">Dia ${d.day_no}${d.title && !/^dia\s*\d+$/i.test(d.title) ? " · " + esc(d.title) : ""}</span><span class="s">${esc(d.passage)}</span>${d.note ? `<span class="small muted" style="white-space:pre-wrap">${esc(d.note)}</span>` : ""}
      ${safeUrl(d.url) ? `<a class="link small" href="${attr(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">Abrir leitura</a>` : ""}
      ${p.enrolled ? `${d.my_note ? `<span class="small" style="white-space:pre-wrap;border-left:3px solid var(--accent);padding-left:8px">${esc(d.my_note)}</span>` : ""}<button class="link small" data-n="${d.day_no}" style="align-self:flex-start">${d.my_note ? "Editar minha anotação" : "Anotar"}</button>` : ""}</span></div>`).join("")}</div>
    ${p.enrolled ? `<div class="card mt"><h3 style="margin-top:0">Lembrete diário</h3><p class="small muted">Um aviso por dia, no horário que você escolher, enquanto o plano não terminar. Só você vê suas anotações.</p>
      <label class="check"><input type="checkbox" id="rm" ${p.remind?.on ? "checked" : ""}> Quero ser lembrado</label><label class="fld" style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">Horário<input type="time" id="rt" value="${attr(p.remind?.time || "07:00")}"></label></div>` : ""}`;
  const go = el.querySelector("#go");
  if (go) go.onclick = async () => { busy(go); const x = await sb.rpc("plan_enroll", { p_id: id }); if (x.error) { busy(go, false); return toast(errText(x.error)); } toast("Plano iniciado."); planOpen(el, alive, id); };
  const saveRemind = async () => { const x = await sb.rpc("plan_remind_set", { p_id: id, p_on: el.querySelector("#rm").checked, p_time: el.querySelector("#rt").value || "07:00" }); toast(x.error ? errText(x.error) : "Lembrete salvo."); };
  if (el.querySelector("#rm")) { el.querySelector("#rm").onchange = saveRemind; el.querySelector("#rt").onchange = saveRemind; }
  el.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => {
    const day = Number(b.dataset.n), cur = p.days.find((d) => d.day_no === day)?.my_note || "";
    const sh = sheet(`<h3>Minha anotação · Dia ${day}</h3><p class="small muted">Privada: só você consegue ler.</p><label class="fld"><textarea id="nb" rows="6" maxlength="2000">${esc(cur)}</textarea></label><div class="row gap-s mt"><button class="btn grow" id="ok">Salvar</button></div>`);
    sh.el.querySelector("#ok").onclick = async (ev) => { busy(ev.currentTarget); const x = await sb.rpc("plan_note_set", { p_id: id, p_day: day, p_body: sh.el.querySelector("#nb").value }); if (x.error) { busy(ev.currentTarget, false); return toast(errText(x.error)); } sh.close(); toast("Anotação salva."); planOpen(el, alive, id); };
  }));
  el.querySelectorAll("[data-d]").forEach((c) => (c.onchange = async () => {
    const x = await sb.rpc("plan_mark", { p_id: id, p_day: Number(c.dataset.d), p_done: c.checked });
    if (x.error) { c.checked = !c.checked; return toast(errText(x.error)); } planOpen(el, alive, id);
  }));
}

// ---------------------------------------------------------------- busca integrada
async function searchPage(el, alive) {
  el.innerHTML = `${head("Buscar", BACK)}<input class="psearch mb" id="q" type="search" placeholder="Eventos, pregações, conteúdos, avisos…" aria-label="Buscar no SOMOS" autocomplete="off"><div id="res"><p class="small muted">Digite ao menos 2 letras. Você só encontra o que pode abrir.</p></div>`;
  const q = el.querySelector("#q"), res = el.querySelector("#res"); let t, seq = 0;
  q.oninput = () => {
    clearTimeout(t); t = setTimeout(async () => {
      const my = ++seq, v = q.value.trim();
      if (v.length < 2) { res.innerHTML = `<p class="small muted">Digite ao menos 2 letras. Você só encontra o que pode abrir.</p>`; return; }
      res.innerHTML = spinner();
      const r = await sb.rpc("search_all", { p_org: org(), p_q: v }); if (my !== seq || !alive()) return;
      if (r.error) { res.innerHTML = `<div class="card small">${esc(errText(r.error))}</div>`; return; }
      res.innerHTML = r.data.groups.map((g) => `<div class="sec"><h2>${esc(g.label)}</h2></div><div class="list">${g.items.map((i) => `<a class="li" href="${attr(i.route)}"><span class="grow"><span class="t">${esc(i.title)}</span>${i.sub ? `<span class="s">${esc(i.sub)}</span>` : ""}</span>${icon("chevronRight", "chev")}</a>`).join("")}</div>`).join("")
        || empty("search", "Nada encontrado", "Tente outra palavra.");
    }, 350);
  };
  setTimeout(() => q.focus(), 50);
}

// ---------------------------------------------------------------- gestão (conteúdos, planos, atalhos)
async function manage(el, alive) {
  const back = ["#/chamados", "SOMOS Chamados"]; el.innerHTML = `${head("Experiência digital", back)}${spinner()}`;
  const first = await sb.rpc("dig_content_list", { p_org: org() }); if (!alive()) return;
  if (first.error) return fail(el, "Experiência digital", first.error, back);
  let tab = "con", data = first.data;
  const draw = async () => {
    el.innerHTML = `${head("Experiência digital", back)}<nav class="tabs">${[["con", "Conteúdos"], ["pla", "Planos de leitura"], ["liv", "Ao vivo"], ["ata", "Atalhos da Home"]].map((t) => `<button class="${tab === t[0] ? "on" : ""}" data-t="${t[0]}">${t[1]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const body = el.querySelector("#body"); await ({ con: conTab, pla: plaTab, liv: livTab, ata: ataTab }[tab])(body);
  };
  const err = (body, e) => (body.innerHTML = `<div class="card small">${esc(errText(e))}</div>`);

  async function conTab(body) {
    const x = await sb.rpc("dig_content_list", { p_org: org() }); if (!alive()) return; if (x.error) return err(body, x.error); data = x.data;
    body.innerHTML = `<div class="row gap-s mb" style="flex-wrap:wrap"><button class="btn primary sm" id="new">${icon("plus")} Novo conteúdo</button><button class="btn ghost sm" id="ns">${icon("plus")} Nova série</button></div>
      <div class="list">${data.items.map((c) => `<button class="li col stack" data-id="${c.id}" style="align-items:stretch"><div class="row between"><b>${esc(c.title)}</b>${tag(c.status === "published" ? "Publicado" : "Rascunho", c.status === "published" ? "st-approved" : "none")}</div>
        <span class="small muted">${KIND[c.kind]}${c.series ? " · " + esc(c.series) : ""} · ${AUD[c.audience]}</span></button>`).join("") || empty("play", "Nenhum conteúdo cadastrado")}</div>`;
    body.querySelector("#new").onclick = () => conForm(null); body.querySelector("#ns").onclick = () => serieForm();
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => conForm(data.items.find((c) => c.id === b.dataset.id))));
  }
  function serieForm() {
    const s = sheet(`<h3>Nova série</h3><label class="fld">Nome<input id="n" maxlength="100"></label><label class="fld">Descrição (opcional)<input id="d" maxlength="500"></label><button class="btn block mt" id="ok">Salvar</button>`);
    const q = (k) => s.el.querySelector(k);
    q("#ok").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("dig_series_save", { p_org: org(), p_id: null, p: { name: q("#n").value, description: q("#d").value } }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Série criada."); draw(); };
  }
  function conForm(c) {
    let image = c?.image_url || null; const v = c || { kind: "video", audience: "all" };
    const s = sheet(`<h3>${c ? "Editar conteúdo" : "Novo conteúdo"}</h3>
      <label class="fld">Tipo<select id="k">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === v.kind ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld">Título<input id="t" maxlength="160" value="${attr(v.title || "")}"></label>
      <label class="fld">Descrição<textarea id="d" rows="4" maxlength="3000">${esc(v.description || "")}</textarea></label>
      <label class="fld">Série<select id="s"><option value="">Sem série</option>${data.series.map((x) => `<option value="${x.id}" ${x.id === v.series_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label class="fld">Assunto (opcional)<input id="c" maxlength="40" value="${attr(v.category || "")}"></label>
      <label class="fld">Link do vídeo, áudio ou leitura<input id="u" placeholder="https://…" value="${attr(v.url || "")}"></label>
      <label class="fld">Link do material para baixar<input id="f" placeholder="https://…" value="${attr(v.file_url || "")}"></label>
      <div class="fld">Imagem (opcional)<div><button class="btn ghost sm" id="im" type="button">${icon("image")} <span id="imn">${image ? "Trocar imagem" : "Escolher imagem"}</span></button></div></div>
      <label class="fld">Quem vê<select id="a">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="row gap-s mt" style="flex-wrap:wrap"><button class="btn grow" id="ok">Salvar</button>${c ? `<button class="btn ghost grow" id="st">${c.status === "published" ? "Voltar a rascunho" : "Publicar"}</button>` : ""}</div>`);
    const q = (k) => s.el.querySelector(k);
    q("#im").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { image = await uploadPublic(`contents/${org()}`, f); q("#imn").textContent = "Imagem anexada"; } catch { toast("Não foi possível enviar a imagem."); } };
    q("#ok").onclick = async (ev) => {
      busy(ev.currentTarget);
      const r = await sb.rpc("dig_content_save", { p_org: org(), p_id: c?.id || null, p: { kind: q("#k").value, title: q("#t").value, description: q("#d").value, series_id: q("#s").value || null, category: q("#c").value, url: q("#u").value, file_url: q("#f").value, image_url: image, audience: q("#a").value } });
      if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Conteúdo salvo."); draw();
    };
    if (q("#st")) q("#st").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("dig_content_set_status", { p_id: c.id, p_status: c.status === "published" ? "draft" : "published" }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast(c.status === "published" ? "Conteúdo despublicado." : "Conteúdo publicado."); draw(); };
  }

  async function plaTab(body) {
    const x = await sb.rpc("plan_admin_list", { p_org: org() }); if (!alive()) return; if (x.error) return err(body, x.error);
    body.innerHTML = `<button class="btn primary sm mb" id="new">${icon("plus")} Novo plano</button><div class="list">${x.data.map((p) => `<button class="li col stack" data-id="${p.id}" style="align-items:stretch"><div class="row between"><b>${esc(p.title)}</b>${tag(p.status === "published" ? "Publicado" : "Rascunho", p.status === "published" ? "st-approved" : "none")}</div>
      <span class="small muted">${p.days.length} dias · ${p.enrolled} inscrito(s) · ${p.finished} concluído(s)</span></button>`).join("") || empty("book", "Nenhum plano cadastrado")}</div>`;
    body.querySelector("#new").onclick = () => plaForm(null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => plaForm(x.data.find((p) => p.id === b.dataset.id))));
  }
  function plaForm(p) {
    const v = p || { audience: "all", days: [] };
    const s = sheet(`<h3>${p ? "Editar plano" : "Novo plano de leitura"}</h3>
      <label class="fld">Título<input id="t" maxlength="120" value="${attr(v.title || "")}"></label>
      <label class="fld">Descrição (opcional)<input id="d" maxlength="1000" value="${attr(v.description || "")}"></label>
      <label class="fld">Quem vê<select id="a">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld">Dias (uma leitura por linha; opcional: <i>Passagem | Título | Anotação</i>)<textarea id="days" rows="8" placeholder="João 1 | Dia 1 | Comece com calma">${esc(v.days.map((d) => [d.passage, d.title || "", d.note || ""].join(" | ").replace(/( \| )+$/, "")).join("\n"))}</textarea></label>
      <p class="small muted">Dias já lidos por alguém não podem ser removidos; só acrescentados ou ajustados.</p>
      <div class="row gap-s mt" style="flex-wrap:wrap"><button class="btn grow" id="ok">Salvar</button>${p ? `<button class="btn ghost grow" id="st">${p.status === "published" ? "Voltar a rascunho" : "Publicar"}</button>` : ""}</div>`);
    const q = (k) => s.el.querySelector(k);
    const days = () => q("#days").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [passage, title, ...note] = l.split("|").map((x) => x.trim()); return { passage, title: title || null, note: note.join(" | ") || null }; });
    q("#ok").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("plan_save", { p_org: org(), p_id: p?.id || null, p: { title: q("#t").value, description: q("#d").value, audience: q("#a").value, image_url: p?.image_url || null, days: days() } }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Plano salvo."); draw(); };
    if (q("#st")) q("#st").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("plan_set_status", { p_id: p.id, p_status: p.status === "published" ? "draft" : "published" }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast(p.status === "published" ? "Plano despublicado." : "Plano publicado."); draw(); };
  }

  const LSTATE = { live: ["Ao vivo agora", "st-approved"], scheduled: ["Agendada", "none"], past: ["Encerrada", "none"], off: ["Desativada", "none"] };
  async function livTab(body) {
    const x = await sb.rpc("live_list", { p_org: org() }); if (!alive()) return; if (x.error) return err(body, x.error);
    body.innerHTML = `<p class="small muted">Cadastre o link da transmissão (YouTube ou outro). O card aparece na Home dos membros 15 minutos antes do início e some quando termina. O vídeo abre no endereço informado.</p><button class="btn primary sm mb" id="new">${icon("plus")} Nova transmissão</button>
      <div class="list">${x.data.map((l) => `<button class="li col stack" data-id="${l.id}" style="align-items:stretch"><div class="row between"><b>${esc(l.title)}</b>${tag(...LSTATE[l.state])}</div><span class="small muted">${new Date(l.starts_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${AUD[l.audience]}</span></button>`).join("") || empty("play", "Nenhuma transmissão cadastrada")}</div>`;
    body.querySelector("#new").onclick = () => livForm(null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => livForm(x.data.find((l) => l.id === b.dataset.id))));
  }
  function livForm(l) {
    const v = l || { audience: "all", active: true }; const loc = (t) => (t ? toLocalInput(t) : "");
    const s = sheet(`<h3>${l ? "Editar transmissão" : "Nova transmissão"}</h3><label class="fld">Título<input id="t" maxlength="120" value="${attr(v.title || "")}"></label>
      <label class="fld">Link da transmissão (https://…)<input id="u" inputmode="url" placeholder="https://youtube.com/live/…" value="${attr(v.url || "")}"></label>
      <label class="fld">Endereço da imagem (opcional)<input id="im" inputmode="url" value="${attr(v.image_url || "")}"></label>
      <label class="fld">Início<input id="s" type="datetime-local" value="${loc(v.starts_at)}"></label><label class="fld">Fim (opcional; sem fim = 3 horas)<input id="e" type="datetime-local" value="${loc(v.ends_at)}"></label>
      <label class="fld">Quem vê<select id="a">${Object.entries(AUD).map(([k, t]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${t}</option>`).join("")}</select></label><label class="check"><input type="checkbox" id="on" ${v.active ? "checked" : ""}> Ativa</label>
      <div class="row gap-s mt" style="flex-wrap:wrap"><button class="btn grow" id="ok">Salvar</button>${l ? `<button class="btn ghost danger grow" id="del">Excluir</button>` : ""}</div>`);
    const q = (k) => s.el.querySelector(k);
    q("#ok").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("live_save", { p_org: org(), p_id: l?.id || null, p: { title: q("#t").value, url: q("#u").value.trim(), image_url: q("#im").value.trim(), starts_at: q("#s").value ? new Date(q("#s").value).toISOString() : "", ends_at: q("#e").value ? new Date(q("#e").value).toISOString() : "", audience: q("#a").value, active: q("#on").checked } }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Transmissão salva."); draw(); };
    if (q("#del")) q("#del").onclick = async (ev) => { if (!(await confirmDialog("Excluir esta transmissão?", "Excluir", true))) return; busy(ev.currentTarget); const r = await sb.rpc("live_delete", { p_id: l.id }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Transmissão excluída."); draw(); };
  }
  async function ataTab(body) {
    const x = await sb.rpc("shortcut_list", { p_org: org() }); if (!alive()) return; if (x.error) return err(body, x.error);
    body.innerHTML = `<p class="small muted">Atalhos redondos no topo da Home. No máximo 8 ativos, para não sobrecarregar a tela.</p><button class="btn primary sm mb" id="new">${icon("plus")} Novo atalho</button>
      <div class="list">${x.data.map((a) => `<button class="li col stack" data-id="${a.id}" style="align-items:stretch"><div class="row between"><b>${esc(a.label)}</b>${tag(a.active ? "Ativo" : "Inativo", a.active ? "st-approved" : "none")}</div><span class="small muted">${AUD[a.audience]} · ${esc(a.route)}</span></button>`).join("") || empty("link", "Nenhum atalho cadastrado")}</div>`;
    body.querySelector("#new").onclick = () => ataForm(null);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => ataForm(x.data.find((a) => a.id === b.dataset.id))));
  }
  const ROUTES = [["#/avisos", "Avisos"], ["#/agenda", "Agenda"], ["#/eventos", "Eventos"], ["#/pregacoes", "Pregações"], ["#/conteudos", "Conteúdos"], ["#/planos", "Planos de leitura"], ["#/jornadas", "Jornadas"], ["#/contato", "Solicitar contato"], ["#/cuidado", "Cuidado com Pessoas"], ["#/busca", "Buscar"]];
  function ataForm(a) {
    const v = a || { icon: "link", audience: "all", active: true, route: "#/avisos" }; const preset = ROUTES.some((r) => r[0] === v.route);
    const s = sheet(`<h3>${a ? "Editar atalho" : "Novo atalho"}</h3><label class="fld">Nome (até 24 letras)<input id="l" maxlength="24" value="${attr(v.label || "")}"></label>
      <label class="fld">Ícone<select id="i">${["link", "calendar", "star", "heart", "book", "play", "music", "megaphone", "users", "gift", "badge", "image", "file", "user"].map((k) => `<option ${k === v.icon ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label class="fld">Destino<select id="r">${ROUTES.map(([k, l]) => `<option value="${k}" ${k === v.route ? "selected" : ""}>${l}</option>`).join("")}<option value="_x" ${preset ? "" : "selected"}>Outro endereço (https://…)</option></select></label>
      <label class="fld" id="xw" ${preset ? "hidden" : ""}>Endereço<input id="x" placeholder="https://…" value="${preset ? "" : attr(v.route)}"></label>
      <label class="fld">Quem vê<select id="a">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === v.audience ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld">Ordem<input id="p" type="number" min="0" max="99" value="${v.position || 0}"></label><label class="check"><input type="checkbox" id="on" ${v.active ? "checked" : ""}> Ativo</label>
      <div class="row gap-s mt" style="flex-wrap:wrap"><button class="btn grow" id="ok">Salvar</button>${a ? `<button class="btn ghost danger grow" id="del">Excluir</button>` : ""}</div>`);
    const q = (k) => s.el.querySelector(k);
    q("#r").onchange = () => (q("#xw").hidden = q("#r").value !== "_x");
    q("#ok").onclick = async (ev) => { busy(ev.currentTarget); const r = await sb.rpc("shortcut_save", { p_org: org(), p_id: a?.id || null, p: { label: q("#l").value, icon: q("#i").value, route: q("#r").value === "_x" ? q("#x").value.trim() : q("#r").value, audience: q("#a").value, position: Number(q("#p").value) || 0, active: q("#on").checked } }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Atalho salvo."); draw(); };
    if (q("#del")) q("#del").onclick = async (ev) => { if (!(await confirmDialog("Excluir este atalho?", "Excluir", true))) return; busy(ev.currentTarget); const r = await sb.rpc("shortcut_delete", { p_id: a.id }); if (r.error) { busy(ev.currentTarget, false); return toast(errText(r.error)); } s.close(); toast("Atalho excluído."); draw(); };
  }
  draw();
}
