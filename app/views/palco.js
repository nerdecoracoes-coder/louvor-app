// Palco do time: o desenho padrão do app (retângulo com as posições das funções) e os presets de escala.
// O líder monta o palco e os presets na aba "Time"; na escala, as posições viram o jeito visual de escalar.
import { sb, state, must, esc, attr, icon, canManageTeam, sheet, toast, errMsg, busy, on, empty, spinner, confirmDialog, roleIcon } from "../core.js";

export function register(route) {
  route("/times/:id/palco", (p, el, a) => stagePage(p.id, el, a));
}

const missingTable = (e) => /relation|does not exist|schema cache|42P01|PGRST205/i.test(String(e?.message || e?.code || e));
const SETUP_MSG = `Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-07-palco-presets.sql</b> no SQL Editor do Supabase.`;

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
  if (/vocal|voz|ministro|soprano|contralto|tenor|back|cantor/.test(n)) return 2;
  return 1;
};
export function defaultLayout(roles) {
  const rows = [[], [], []];
  for (const r of roles) rows[rowOf(r.name)].push(r);
  const ys = [20, 48, 78], out = [];
  rows.forEach((list, ri) => list.forEach((r, i) => out.push({ role_id: r.id, x: Math.round(((i + 1) / (list.length + 1)) * 100), y: ys[ri] })));
  return out;
}

// ---------------------------------------------------------------- desenho
// render(slot) devolve { cls, inner, attrs } de cada posição
export function stageHTML(slots, render, { cls = "" } = {}) {
  return `<div class="stage ${cls}"><div class="stage-floor"></div>
    ${slots.map((s) => { const r = render(s) || {}; return `<button type="button" class="slot ${r.cls || ""}" data-sid="${s.id}" style="left:${Number(s.x)}%;top:${Number(s.y)}%" ${r.attrs || ""}>${r.inner || ""}</button>`; }).join("")}
    <span class="stage-front">Plateia</span></div>`;
}
export const slotFace = (name, extra = "") => `<span class="sicon">${icon(roleIcon(name))}</span><small class="sname">${esc(name)}</small>${extra}`;

// ---------------------------------------------------------------- página do líder
async function stagePage(teamId, el, alive) {
  el.innerHTML = spinner();
  const team = await must(sb.from("teams").select("*").eq("id", teamId).maybeSingle());
  const back = `<div class="pagehead"><a class="back" href="#/times/${teamId}" aria-label="Voltar para Time">${icon("chevronLeft")}</a><h1>Palco e presets</h1></div>`;
  if (!team || team.org_id !== state.org.id) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  if (!canManageTeam(teamId)) { el.innerHTML = back + empty("lock", "Somente líderes e administradores editam o palco."); return; }
  let roles = [];
  try { roles = (await must(sb.from("music_roles").select("id,name,sort,team_type").eq("org_id", state.org.id))).filter((r) => !r.team_type || r.team_type === team.team_type).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)); } catch (e) { el.innerHTML = back + `<div class="card">${esc(String(e.message || e))}</div>`; return; }
  const data = await loadStage(teamId);
  if (!alive()) return;
  if (data.missing) { el.innerHTML = back + `<div class="card"><p class="small" style="margin:0">${SETUP_MSG}</p></div>`; return; }
  let { slots, presets } = data;
  const roleName = (id) => roles.find((r) => r.id === id)?.name || "Função";

  function draw() {
    el.innerHTML = `${back}
      <p class="small muted" style="margin:0 0 12px">Este é o palco do time. Arraste cada posição para onde ela fica; toque para trocar a função ou tirar. Ao escalar, é nele que você escolhe as pessoas.</p>
      ${slots.length ? stageHTML(slots, (s) => ({ cls: "edit", inner: slotFace(roleName(s.role_id)) }), { cls: "editing" })
        : `<div class="card">${empty("users", "Palco ainda vazio", "Comece pelo modelo padrão (uma posição para cada função) e depois ajuste do seu jeito.")}</div>`}
      <div class="row gap mt wrap">
        <button class="btn primary grow" id="addslot">${icon("plus")} Adicionar posição</button>
        ${slots.length ? "" : `<button class="btn ghost grow" id="seed">${icon("sparkle")} Usar modelo padrão</button>`}
      </div>
      <div class="sec">${icon("layers")}<h2>Presets de escala</h2><span class="cnt2">${presets.length}</span><button class="more" id="addpreset" ${slots.length ? "" : "disabled"}>${icon("plus")} Novo</button></div>
      <p class="small muted" style="margin:-4px 0 10px">Um preset diz quais posições entram numa escala. Exemplo: o culto de domingo usa todas, o de quinta usa só voz e violão.</p>
      <div class="list">${presets.length ? presets.map((p) => { const n = p.slot_ids.filter((id) => slots.some((s) => s.id === id)).length; return `<button class="li" data-preset="${p.id}"><span class="cover" style="width:40px;height:40px">${icon("layers")}</span><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${n} ${n === 1 ? "posição" : "posições"}</span></span>${icon("chevronRight", "chev")}</button>`; }).join("")
        : `<div class="li muted small">Nenhum preset ainda. Sem preset, a escala mostra todas as posições.</div>`}</div>`;
    bindDrag();
  }

  // arrastar posições no palco
  function bindDrag() {
    const stage = el.querySelector(".stage.editing"); if (!stage) return;
    stage.querySelectorAll(".slot").forEach((node) => {
      let start = null, moved = false;
      node.addEventListener("pointerdown", (e) => { start = { x: e.clientX, y: e.clientY }; moved = false; node.setPointerCapture(e.pointerId); node.classList.add("drag"); });
      node.addEventListener("pointermove", (e) => {
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) moved = true;
        if (!moved) return;
        const r = stage.getBoundingClientRect();
        const x = Math.min(94, Math.max(6, ((e.clientX - r.left) / r.width) * 100)), y = Math.min(92, Math.max(8, ((e.clientY - r.top) / r.height) * 100));
        node.style.left = `${x}%`; node.style.top = `${y}%`;
      });
      const end = async (e) => {
        if (!start) return; start = null; node.classList.remove("drag");
        const s = slots.find((x) => x.id === node.dataset.sid);
        if (!moved) return slotSheet(s);
        const x = Math.round(parseFloat(node.style.left) * 10) / 10, y = Math.round(parseFloat(node.style.top) * 10) / 10;
        s.x = x; s.y = y;
        const r = await sb.from("team_stage_slots").update({ x, y }).eq("id", s.id);
        if (r.error) toast(errMsg(r.error), "err");
      };
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", () => { start = null; node.classList.remove("drag"); });
    });
  }

  function slotSheet(s) {
    const sh = sheet(`<h3>${esc(roleName(s.role_id))}</h3><p class="small muted" style="margin-top:-6px">Trocar a função desta posição ou tirá-la do palco.</p>
      <div class="list" style="max-height:48vh;overflow:auto">${roles.map((r) => `<button class="li" data-r="${r.id}"><span class="cover" style="width:38px;height:38px">${icon(roleIcon(r.name))}</span><span class="grow"><span class="t">${esc(r.name)}</span></span>${r.id === s.role_id ? icon("check", "chev") : ""}</button>`).join("")}</div>
      <button class="btn danger block mt" id="rm">${icon("trash")} Tirar do palco</button>`, { wide: true });
    on(sh.el, "click", "[data-r]", async (e, b) => {
      const r = await sb.from("team_stage_slots").update({ role_id: b.dataset.r }).eq("id", s.id);
      if (r.error) return toast(errMsg(r.error), "err");
      s.role_id = b.dataset.r; sh.close(); draw();
    });
    sh.el.querySelector("#rm").onclick = async () => {
      sh.close();
      if (!(await confirmDialog(`Tirar ${roleName(s.role_id)} do palco?`, "Tirar", true))) return;
      const r = await sb.from("team_stage_slots").delete().eq("id", s.id);
      if (r.error) return toast(errMsg(r.error), "err");
      slots = slots.filter((x) => x.id !== s.id);
      for (const p of presets.filter((p) => p.slot_ids.includes(s.id))) { p.slot_ids = p.slot_ids.filter((x) => x !== s.id); await sb.from("team_presets").update({ slot_ids: p.slot_ids }).eq("id", p.id); }
      draw();
    };
  }

  function addSheet() {
    const sh = sheet(`<h3>Adicionar posição</h3><p class="small muted" style="margin-top:-6px">Escolha a função. Para ter duas vozes, por exemplo, adicione o Vocal duas vezes.</p>
      <div class="list" style="max-height:55vh;overflow:auto">${roles.map((r) => `<button class="li" data-r="${r.id}"><span class="cover" style="width:38px;height:38px">${icon(roleIcon(r.name))}</span><span class="grow"><span class="t">${esc(r.name)}</span></span>${icon("plus", "chev")}</button>`).join("") || `<div class="li muted small">Este time ainda não tem funções. Cadastre em Funções.</div>`}</div>`, { wide: true });
    on(sh.el, "click", "[data-r]", async (e, b) => {
      const jitter = (slots.length % 5) * 6;
      const r = await sb.from("team_stage_slots").insert({ org_id: state.org.id, team_id: teamId, role_id: b.dataset.r, x: 44 + jitter, y: 44 + jitter, sort: slots.length }).select("*").single();
      if (r.error) return toast(errMsg(r.error), "err");
      slots.push(r.data); sh.close(); draw(); toast("Posição adicionada. Arraste para o lugar certo.");
    });
  }

  function presetSheet(p) {
    const on_ = new Set(p ? p.slot_ids : slots.map((s) => s.id));
    const sh = sheet(`<h3>${p ? "Editar preset" : "Novo preset"}</h3>
      <label class="field"><span>Nome *</span><input class="input" id="pn" maxlength="60" placeholder="Ex.: Culto de domingo" value="${attr(p?.name || "")}"></label>
      <p class="small muted">Toque nas posições que entram neste preset.</p>
      <div id="pst">${stageHTML(slots, (s) => ({ cls: on_.has(s.id) ? "on" : "off", inner: slotFace(roleName(s.role_id)) }))}</div>
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
