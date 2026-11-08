// Palco do time: o desenho padrão do app (palco em perspectiva com os instrumentos) e os presets de escala.
// O líder monta o palco e os presets na aba "Time"; na escala, as posições viram o jeito visual de escalar.
import { sb, state, must, esc, attr, icon, canManageTeam, sheet, toast, errMsg, busy, on, empty, spinner, confirmDialog, roleIcon } from "../core.js";
import { instrumentArt, artWidth } from "./palco-art.js";

export function register(route) {
  route("/times/:id/palco", (p, el, a) => stagePage(p.id, el, a));
}

const missingTable = (e) => /relation|does not exist|schema cache|42P01|PGRST205/i.test(String(e?.message || e?.code || e));
const SETUP_MSG = `Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-07-palco-presets.sql</b> (e depois o <b>palco-giro</b>) no SQL Editor do Supabase.`;
export const Y_MIN = 15, Y_MAX = 84, X_MIN = 7, X_MAX = 93;

// ---------------------------------------------------------------- dados
export async function loadStage(teamId) {
  const [s, p] = await Promise.all([
    sb.from("team_stage_slots").select("*").eq("team_id", teamId).order("sort").order("created_at"),
    sb.from("team_presets").select("*").eq("team_id", teamId).order("sort").order("created_at"),
  ]);
  if (s.error || p.error) return { slots: [], presets: [], missing: true };
  return { slots: s.data || [], presets: p.data || [], missing: false };
}

// posição inicial de cada função no modelo padrão: bateria ao fundo, instrumentos no meio, vozes na frente
const rowOf = (name = "") => {
  const n = name.toLowerCase();
  if (/bateria|perc|cajon/.test(n)) return 0;
  if (/vocal|voz|ministro|soprano|contralto|tenor|baritono|barítono|back|cantor|volante|coral|coro/.test(n)) return 2;
  return 1;
};
export function defaultLayout(roles) {
  // fundo → frente: bateria, instrumentos, vozes; no máximo 3 por fileira para ninguém ficar em cima do outro
  const groups = [[], [], []];
  for (const r of roles) groups[rowOf(r.name)].push(r);
  const rows = [];
  for (const g of groups) for (let i = 0; i < g.length; i += 3) rows.push(g.slice(i, i + 3));
  const out = [];
  rows.forEach((list, ri) => {
    const y = rows.length === 1 ? 50 : Math.round(24 + (ri / (rows.length - 1)) * 56);
    list.forEach((r, i) => out.push({ role_id: r.id, x: Math.round(((i + 1) / (list.length + 1)) * 78 + 11), y }));
  });
  return out;
}

// ---------------------------------------------------------------- desenho
// render(slot) devolve { cls, name, who: { avatar, label } | null, attrs }. Quanto mais à frente, maior o instrumento.
export function stageHTML(slots, render, { cls = "" } = {}) {
  return `<div class="stage ${cls}">
    <svg class="stage-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs>
      <linearGradient id="stfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1b1f"/><stop offset=".5" stop-color="#2a2a2f"/><stop offset="1" stop-color="#37373d"/></linearGradient>
      <radialGradient id="stvig" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.45)"/></radialGradient>
      <linearGradient id="stwd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8883a"/><stop offset=".25" stop-color="#b8601f"/><stop offset="1" stop-color="#7a3a10"/></linearGradient></defs>
      <rect width="100" height="100" fill="#040405"/>
      <polygon points="5,9 95,9 99,89 1,89" fill="url(#stfl)"/><polygon points="5,9 95,9 99,89 1,89" fill="url(#stvig)"/>
      <polygon points="5,9 95,9 99,89 1,89" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <polygon points="1,89 99,89 100,94.5 0,94.5" fill="url(#stwd)"/><line x1="1" y1="89.4" x2="99" y2="89.4" stroke="rgba(255,226,170,.8)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <rect y="94.5" width="100" height="5.5" fill="#030304"/></svg>
    ${slots.map((s) => {
      const r = render(s) || {}; const k = 0.72 + 0.4 * ((Number(s.y) - Y_MIN) / (Y_MAX - Y_MIN));
      return `<div class="slot ${r.cls || ""}" data-sid="${s.id}" style="left:${Number(s.x)}%;top:${Number(s.y)}%;--k:${k.toFixed(3)};--aw:${artWidth(r.name)};z-index:${Math.round(Number(s.y))}" ${r.attrs || ""}>
        <span class="art" style="transform:rotate(${Number(s.rot) || 0}deg)">${instrumentArt(r.name)}</span>
        ${r.who ? `<span class="sface">${r.who.avatar}</span>` : ""}
        <span class="slabel">${r.who ? `<b class="swho">${esc(r.who.label)}</b>` : ""}<small class="sname">${esc(r.name)}</small></span>
        ${r.tools || ""}</div>`;
    }).join("")}</div>`;
}

// ---------------------------------------------------------------- página do líder
async function stagePage(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await must(sb.from("teams").select("*").eq("id", teamId).maybeSingle());
  const head = (extra = "") => `<div class="pagehead"><a class="back" href="#/times/${teamId}" aria-label="Voltar para Time">${icon("chevronLeft")}</a><h1>Mapa de palco</h1>${extra}</div>`;
  if (!team || team.org_id !== state.org.id) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  if (!canManageTeam(teamId)) { el.innerHTML = head() + empty("lock", "Somente líderes e administradores editam o palco."); return; }
  let roles = [];
  try { roles = (await must(sb.from("music_roles").select("id,name,sort,team_type").eq("org_id", state.org.id))).filter((r) => !r.team_type || r.team_type === team.team_type).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)); } catch (e) { el.innerHTML = head() + `<div class="card">${esc(String(e.message || e))}</div>`; return; }
  const data = await loadStage(teamId);
  if (!alive()) return;
  if (data.missing) { el.innerHTML = head() + `<div class="card"><p class="small" style="margin:0">${SETUP_MSG}</p></div>`; return; }
  let { slots, presets } = data;
  let selected = null;
  const roleName = (id) => roles.find((r) => r.id === id)?.name || "Função";

  function draw() {
    el.innerHTML = `${head(`<button class="btn primary sm" id="addslot">${icon("plus")} Adicionar</button>`)}
      <p class="small muted" style="margin:0 0 10px">Toque num instrumento para escolher; arraste para mudar de lugar. Ao escalar, é neste palco que você escolhe as pessoas.</p>
      ${slots.length ? stageHTML(slots, (s) => ({ cls: `edit${selected === s.id ? " sel" : ""}`, name: roleName(s.role_id),
        tools: selected === s.id ? `<span class="handles"><i></i><i></i><i></i><i></i></span><span class="stools" data-tools ${s.x > 62 ? 'style="left:auto;right:calc(100% + 12px)"' : ""}>
          <button type="button" data-act="rot" aria-label="Girar">${icon("refresh")}</button><button type="button" data-act="role" aria-label="Trocar a função">${icon("badge")}</button><button type="button" class="del" data-act="del" aria-label="Tirar do palco">${icon("trash")}</button></span>` : "" }), { cls: "editing" })
        : `<div class="card">${empty("stage", "Palco ainda vazio", "Comece pelo modelo padrão (uma posição para cada função) e depois ajuste do seu jeito.")}</div>`}
      ${slots.length ? "" : `<button class="btn primary block mt" id="seed">${icon("sparkle")} Usar modelo padrão</button>`}
      <div class="sec">${icon("layers")}<h2>Presets de escala</h2><span class="cnt2">${presets.length}</span><button class="more" id="addpreset" ${slots.length ? "" : "disabled"}>${icon("plus")} Novo</button></div>
      <p class="small muted" style="margin:-4px 0 10px">Um preset diz quais posições entram numa escala. Exemplo: o culto de domingo usa todas, o de quinta usa só voz e violão.</p>
      <div class="list">${presets.length ? presets.map((p) => { const n = p.slot_ids.filter((id) => slots.some((s) => s.id === id)).length; return `<button class="li" data-preset="${p.id}"><span class="cover" style="width:40px;height:40px">${icon("layers")}</span><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${n} ${n === 1 ? "posição" : "posições"}</span></span>${icon("chevronRight", "chev")}</button>`; }).join("")
        : `<div class="li muted small">Nenhum preset ainda. Sem preset, a escala mostra todas as posições.</div>`}</div>`;
    bindDrag();
  }

  // selecionar e arrastar instrumentos no palco
  function bindDrag() {
    const stage = el.querySelector(".stage.editing"); if (!stage) return;
    stage.addEventListener("pointerdown", (e) => { if (!e.target.closest(".slot")) { if (selected) { selected = null; draw(); } } });
    stage.querySelectorAll(".slot").forEach((node) => {
      let start = null, moved = false;
      node.addEventListener("pointerdown", (e) => {
        if (e.target.closest("[data-tools]")) return;
        e.stopPropagation(); start = { x: e.clientX, y: e.clientY }; moved = false; node.setPointerCapture(e.pointerId); node.classList.add("drag");
      });
      node.addEventListener("pointermove", (e) => {
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) moved = true;
        if (!moved) return;
        const r = stage.getBoundingClientRect();
        const x = Math.min(X_MAX, Math.max(X_MIN, ((e.clientX - r.left) / r.width) * 100)), y = Math.min(Y_MAX, Math.max(Y_MIN, ((e.clientY - r.top) / r.height) * 100));
        node.style.left = `${x}%`; node.style.top = `${y}%`; node.style.zIndex = Math.round(y);
        node.style.setProperty("--k", (0.72 + 0.4 * ((y - Y_MIN) / (Y_MAX - Y_MIN))).toFixed(3));
      });
      node.addEventListener("pointerup", async () => {
        if (!start) return; start = null; node.classList.remove("drag");
        const s = slots.find((x) => x.id === node.dataset.sid);
        if (!moved) { selected = selected === s.id ? selected : s.id; return draw(); }
        const x = Math.round(parseFloat(node.style.left) * 10) / 10, y = Math.round(parseFloat(node.style.top) * 10) / 10;
        s.x = x; s.y = y; selected = s.id;
        const r = await sb.from("team_stage_slots").update({ x, y }).eq("id", s.id);
        if (r.error) toast(errMsg(r.error), "err");
        draw();
      });
      node.addEventListener("pointercancel", () => { start = null; node.classList.remove("drag"); });
    });
  }

  async function rotate(s) {
    const rot = ((Number(s.rot) || 0) + 45) % 360;
    const r = await sb.from("team_stage_slots").update({ rot }).eq("id", s.id);
    if (r.error) return toast(missingTable(r.error) || /rot/.test(r.error.message || "") ? "Para girar, rode o SQL palco-giro no Supabase." : errMsg(r.error), "err");
    s.rot = rot; draw();
  }

  function roleSheet(s) {
    const sh = sheet(`<h3>Função desta posição</h3><p class="small muted" style="margin-top:-6px">Atual: ${esc(roleName(s.role_id))}</p>
      <div class="list" style="max-height:52vh;overflow:auto">${roles.map((r) => `<button class="li" data-r="${r.id}"><span class="cover" style="width:38px;height:38px">${icon(roleIcon(r.name))}</span><span class="grow"><span class="t">${esc(r.name)}</span></span>${r.id === s.role_id ? icon("check", "chev") : ""}</button>`).join("")}</div>`, { wide: true });
    on(sh.el, "click", "[data-r]", async (e, b) => {
      const r = await sb.from("team_stage_slots").update({ role_id: b.dataset.r }).eq("id", s.id);
      if (r.error) return toast(errMsg(r.error), "err");
      s.role_id = b.dataset.r; sh.close(); draw();
    });
  }
  async function removeSlot(s) {
    if (!(await confirmDialog(`Tirar ${roleName(s.role_id)} do palco?`, "Tirar", true))) return;
    const r = await sb.from("team_stage_slots").delete().eq("id", s.id);
    if (r.error) return toast(errMsg(r.error), "err");
    slots = slots.filter((x) => x.id !== s.id); selected = null;
    for (const p of presets.filter((p) => p.slot_ids.includes(s.id))) { p.slot_ids = p.slot_ids.filter((x) => x !== s.id); await sb.from("team_presets").update({ slot_ids: p.slot_ids }).eq("id", p.id); }
    draw();
  }

  function addSheet() {
    const sh = sheet(`<h3>Adicionar ao palco</h3><p class="small muted" style="margin-top:-6px">Escolha a função. Para ter duas vozes, por exemplo, adicione o Vocal duas vezes.</p>
      <div class="list" style="max-height:55vh;overflow:auto">${roles.map((r) => `<button class="li" data-r="${r.id}"><span class="cover art-mini" style="width:46px;height:46px">${instrumentArt(r.name)}</span><span class="grow"><span class="t">${esc(r.name)}</span></span>${icon("plus", "chev")}</button>`).join("") || `<div class="li muted small">Este time ainda não tem funções. Cadastre em Funções.</div>`}</div>`, { wide: true });
    on(sh.el, "click", "[data-r]", async (e, b) => {
      const jitter = (slots.length % 5) * 5;
      const r = await sb.from("team_stage_slots").insert({ org_id: state.org.id, team_id: teamId, role_id: b.dataset.r, x: 42 + jitter, y: 44 + jitter, sort: slots.length }).select("*").single();
      if (r.error) return toast(errMsg(r.error), "err");
      slots.push(r.data); selected = r.data.id; sh.close(); draw(); toast("Adicionado. Arraste para o lugar certo.");
    });
  }

  function presetSheet(p) {
    const on_ = new Set(p ? p.slot_ids : slots.map((s) => s.id));
    const sh = sheet(`<h3>${p ? "Editar preset" : "Novo preset"}</h3>
      <label class="field"><span>Nome *</span><input class="input" id="pn" maxlength="60" placeholder="Ex.: Culto de domingo" value="${attr(p?.name || "")}"></label>
      <p class="small muted">Toque nos instrumentos que entram neste preset.</p>
      <div id="pst">${stageHTML(slots, (s) => ({ cls: on_.has(s.id) ? "on" : "off", name: roleName(s.role_id) }))}</div>
      <div class="row gap mt">${p ? `<button class="btn danger" id="pdel" aria-label="Excluir preset">${icon("trash")}</button>` : ""}<button class="btn primary grow" id="psave">Salvar preset</button></div>`, { wide: true });
    on(sh.el, "click", ".slot", (e, b) => { const id = b.dataset.sid; on_.has(id) ? on_.delete(id) : on_.add(id); b.classList.toggle("on", on_.has(id)); b.classList.toggle("off", !on_.has(id)); });
    sh.el.querySelector("#psave").onclick = async (e) => {
      const name = sh.el.querySelector("#pn").value.trim();
      if (!name) return toast("Dê um nome ao preset.", "err");
      if (!on_.size) return toast("Escolha ao menos uma posição.", "err");
      busy(e.currentTarget);
      const ids = slots.filter((s) => on_.has(s.id)).map((s) => s.id);
      const r = p ? await sb.from("team_presets").update({ name, slot_ids: ids }).eq("id", p.id).select("*").single()
        : await sb.from("team_presets").insert({ org_id: state.org.id, team_id: teamId, name, slot_ids: ids, sort: presets.length }).select("*").single();
      if (r.error) { busy(e.currentTarget, false); return toast(/duplicate|unique/i.test(r.error.message || "") ? "Já existe um preset com esse nome." : errMsg(r.error), "err"); }
      if (p) Object.assign(p, r.data); else presets.push(r.data);
      sh.close(); draw(); toast("Preset salvo");
    };
    sh.el.querySelector("#pdel")?.addEventListener("click", async () => {
      sh.close();
      if (!(await confirmDialog(`Excluir o preset ${p.name}? As escalas já feitas não mudam.`, "Excluir", true))) return;
      const r = await sb.from("team_presets").delete().eq("id", p.id);
      if (r.error) return toast(errMsg(r.error), "err");
      presets = presets.filter((x) => x.id !== p.id); draw();
    });
  }

  on(el, "click", "[data-act]", (e, b) => {
    const s = slots.find((x) => x.id === selected); if (!s) return;
    const a = b.dataset.act; if (a === "rot") rotate(s); else if (a === "role") roleSheet(s); else if (a === "del") removeSlot(s);
  });
  on(el, "click", "#addslot", () => addSheet());
  on(el, "click", "#seed", async (e, b) => {
    busy(b);
    const rows = defaultLayout(roles).map((l, i) => ({ org_id: state.org.id, team_id: teamId, sort: i, ...l }));
    if (!rows.length) { busy(b, false); return toast("Este time ainda não tem funções cadastradas.", "err"); }
    const r = await sb.from("team_stage_slots").insert(rows).select("*");
    if (r.error) { busy(b, false); return toast(errMsg(r.error), "err"); }
    slots = r.data.sort((a, b2) => a.sort - b2.sort); draw();
  });
  on(el, "click", "#addpreset", () => presetSheet(null));
  on(el, "click", "[data-preset]", (e, b) => presetSheet(presets.find((p) => p.id === b.dataset.preset)));
  draw();
}
