// Ambiente de serviço ("Hora de servir"): abre sozinho no dia da escala, perto do horário do evento.
import { sb, state, must, esc, attr, icon, avatar, fTime, fDate, fDow, ymd, people, personName, myName, canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner, confirmDialog, linkify, cap, roleIcon } from "../core.js";

export function register(route) {
  route("/servico/:id", (p, el, a) => serviceView(p.id, el, a));
  route("/times/:id/servico", (p, el, a) => configView(p.id, el, a));
}

const skipKey = (id) => `svc_skip_${id}`;
const safeGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ok */ } };

export const DEFAULT_LEAD = 60;
export const LEAD_OPTIONS = [[0, "Desligado"], [15, "15 minutos"], [30, "30 minutos"], [45, "45 minutos"], [60, "1 hora"], [90, "1 h 30"], [120, "2 horas"], [180, "3 horas"]];

// A escala de hoje em que estou escalado e cuja janela de serviço (início − antecedência até o fim) está aberta.
export async function activeService() {
  if (!state.user || !state.org) return null;
  const now = Date.now();
  const rows = await must(sb.from("schedule_assignments")
    .select("schedule_id,role_name,role_id,schedules!inner(id,title,starts_at,ends_at,status,team_id,location)")
    .eq("user_id", state.user.id).eq("org_id", state.org.id).eq("schedules.status", "published")
    .gte("schedules.starts_at", new Date(now - 14 * 3600e3).toISOString()).lte("schedules.starts_at", new Date(now + 24 * 3600e3).toISOString()));
  if (!rows.length) return null;
  const teamIds = [...new Set(rows.map((r) => r.schedules.team_id))];
  const lead = new Map();
  const t = await sb.from("teams").select("id,service_lead_min").in("id", teamIds);
  for (const x of t.data || []) lead.set(x.id, x.service_lead_min);
  const open = [];
  for (const r of rows) {
    const s = r.schedules, start = new Date(s.starts_at).getTime();
    const min = lead.has(s.team_id) ? lead.get(s.team_id) : DEFAULT_LEAD;
    if (!min) continue;
    const end = s.ends_at ? new Date(s.ends_at).getTime() : start + 2.5 * 3600e3;
    if (now >= start - min * 60e3 && now <= end + 30 * 60e3 && !safeGet(skipKey(s.id))) open.push(s);
  }
  open.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return open[0] || null;
}

// Usado pelas rotas de início: true quando já mandou para a página de serviço.
export async function maybeService() {
  try { const s = await activeService(); if (s) { go(`/servico/${s.id}`); return true; } } catch (e) { console.warn(e); }
  return false;
}

const VERSES = [
  ["Sirvam uns aos outros com amor.", "Gálatas 5:13"],
  ["Tudo o que fizerem, façam de todo o coração, como para o Senhor.", "Colossenses 3:23"],
  ["Quem quiser ser o maior entre vocês será servo.", "Mateus 20:26"],
  ["Sirvam ao Senhor com alegria.", "Salmo 100:2"],
  ["Cada um exerça o dom que recebeu para servir os outros.", "1 Pedro 4:10"],
];
const HONOR = [
  "É uma honra servir com você hoje.",
  "Que privilégio poder servir a Deus e à igreja.",
  "Servir é um presente. Obrigado por estar aqui.",
  "Seu serviço faz diferença em cada pessoa que chegar hoje.",
];

const mins = (ms) => Math.round(ms / 60000);
const until = (iso) => {
  const d = mins(new Date(iso).getTime() - Date.now());
  if (d > 90) return `começa em ${Math.floor(d / 60)} h ${d % 60 ? `${d % 60} min` : ""}`.trim();
  if (d > 1) return `começa em ${d} min`;
  if (d >= -1) return "começa agora";
  return "em andamento";
};
export const targetOf = (item, startsAt) => (item.offset_min == null ? null : new Date(new Date(startsAt).getTime() + item.offset_min * 60e3).toISOString());
// Atraso em minutos (positivo = marcou depois do horário-alvo; tolerância de 5 min)
export const lateness = (checkedAt, targetAt) => (targetAt ? mins(new Date(checkedAt).getTime() - new Date(targetAt).getTime()) : 0);

async function serviceView(id, el, alive) {
  el.innerHTML = spinner();
  const s = (await must(sb.from("schedules").select("*").eq("id", id).limit(1)))[0];
  if (!s) { el.innerHTML = empty("calendar", "Escala não encontrada"); return; }
  const [mine, all, items, checks, songs, cues, ppl] = await Promise.all([
    must(sb.from("schedule_assignments").select("role_id,role_name").eq("schedule_id", id).eq("user_id", state.user.id)),
    must(sb.from("schedule_assignments").select("user_id,role_name").eq("schedule_id", id)),
    sb.from("role_checklist_items").select("*").eq("team_id", s.team_id).order("position").then((r) => r.data || []),
    sb.from("service_checks").select("*").eq("schedule_id", id).eq("user_id", state.user.id).then((r) => r.data || []),
    must(sb.from("schedule_songs").select("title_snapshot,artist_snapshot,song_key,notes").eq("schedule_id", id).order("position")),
    sb.from("schedule_cues").select("*").eq("schedule_id", id).order("position").then((r) => r.data || []),
    people(),
  ]);
  if (!alive()) return;
  const team = state.orgTeams?.find((t) => t.id === s.team_id) || state.myTeams.find((t) => t.id === s.team_id);
  const myRoleIds = new Set(mine.map((m) => m.role_id).filter(Boolean));
  const myItems = items.filter((i) => !i.role_id || myRoleIds.has(i.role_id));
  const done = new Map(checks.map((c) => [c.item_id, c]));
  const first = (myName().split(" ")[0]) || "você";
  const day = Math.floor(Date.now() / 864e5), v = VERSES[day % VERSES.length], honor = HONOR[day % HONOR.length];
  const manage = canManageTeam(s.team_id);
  let tab = "check";

  const pal = (s.palettes || []).filter((p) => p.colors?.length);
  const checkRow = (it) => {
    const c = done.get(it.id), target = targetOf(it, s.starts_at);
    let note = "";
    if (target && !c) note = `<small class="muted">até ${fTime(target)}</small>`;
    if (c) {
      const late = lateness(c.checked_at, c.target_at || target);
      note = `<small class="${late > 5 ? "svc-late" : "svc-ok"}">Marcado às ${fTime(c.checked_at)}${c.target_at || target ? (late > 5 ? ` · ${late} min depois de ${fTime(c.target_at || target)}` : ` · no horário (${fTime(c.target_at || target)})`) : ""}</small>`;
    }
    return `<button class="li check${c ? " on" : ""}" data-it="${it.id}"><span class="cb">${c ? icon("check") : ""}</span><span class="grow" style="min-width:0"><span class="t">${esc(it.label)}</span>${note ? `<br>${note}` : ""}</span></button>`;
  };
  const draw = () => {
    const n = myItems.filter((i) => done.has(i.id)).length;
    const pct = myItems.length ? Math.round(n / myItems.length * 100) : 0;
    const pane = {
      check: myItems.length
        ? `<div class="svc-prog"><div><i style="width:${pct}%"></i></div><span>${n} de ${myItems.length}</span></div><div class="list">${myItems.map(checkRow).join("")}</div>
           <p class="tiny muted" style="margin:10px 2px 0">O horário registrado é o do relógio no momento em que você marca.</p>`
        : empty("check", "Nenhum item para a sua função", manage ? `<a class="link" href="#/times/${s.team_id}/servico">Montar o checklist</a>` : "Quando o líder montar o checklist da sua função, ele aparece aqui."),
      culto: `<div class="card"><div class="meta">${icon("clock")} ${esc(cap(fDow(s.starts_at)))}, ${fDate(s.starts_at)} às ${fTime(s.starts_at)}${s.ends_at ? ` – ${fTime(s.ends_at)}` : ""}</div>
          ${s.location ? `<div class="meta">${icon("pin")} ${esc(s.location)}</div>` : ""}${s.notes ? `<p style="margin:8px 0 0">${linkify(esc(s.notes))}</p>` : ""}</div>
        ${pal.length ? `<div class="sec"><h2>Vestimenta</h2></div>${pal.map((p) => `<div class="card pal"><div class="row gap">${p.colors.map((c) => `<i class="sw" style="background:${attr(c)}"></i>`).join("")}<span class="grow">${esc(p.desc || "")}</span></div></div>`).join("")}` : ""}
        ${songs.length ? `<div class="sec"><h2>Músicas</h2><span class="cnt2">${songs.length}</span></div><div class="list">${songs.map((x, i) => `<div class="li"><b style="width:22px">${i + 1}</b><span class="grow ellipsis">${esc(x.title_snapshot)}${x.artist_snapshot ? ` <span class="muted">· ${esc(x.artist_snapshot)}</span>` : ""}</span>${x.song_key ? `<span class="tag soft">${esc(x.song_key)}</span>` : ""}</div>`).join("")}</div>` : ""}
        ${cues.length ? `<div class="sec"><h2>Roteiro</h2><span class="cnt2">${cues.length}</span></div><div class="list">${cues.map((c) => `<div class="li"><span class="tag gray">${c.at_time ? esc(String(c.at_time).slice(0, 5)) : "—"}</span><span class="grow">${esc(c.title)}${c.responsible ? ` <span class="muted">· ${esc(c.responsible)}</span>` : ""}</span></div>`).join("")}</div>` : ""}`,
      equipe: `<div class="list">${all.map((a) => `<div class="li">${avatar(ppl.get(a.user_id) || { display_name: "?" }, 36)}<span class="grow"><b>${esc(personName(ppl, a.user_id))}</b><br><small class="muted">${esc(a.role_name || "")}</small></span></div>`).join("")}</div>`,
    }[tab];
    el.querySelector("#pane").innerHTML = pane;
    el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const pb = el.querySelector("#pbadge"); if (pb) pb.textContent = myItems.length ? `${n}/${myItems.length}` : "";
  };

  el.innerHTML = `
  <section class="svc-hero">
    <p class="svc-kicker">Hora de servir</p>
    <h1>${esc(first)}, ${esc(honor.charAt(0).toLowerCase() + honor.slice(1))}</h1>
    <p class="svc-verse">“${esc(v[0])}” <span>${esc(v[1])}</span></p>
    <div class="svc-ev"><b>${esc(s.title)}</b><span>${fTime(s.starts_at)} · ${until(s.starts_at)}</span></div>
    <div class="svc-roles">${[...new Set(mine.map((m) => m.role_name).filter(Boolean))].map((r) => `<span class="pill">${icon(roleIcon(r) || "star")} ${esc(r)}</span>`).join("")}</div>
  </section>
  <div class="etabs" role="tablist">
    <button data-tab="check" class="on"><span class="tl">${icon("check")}<em id="pbadge"></em></span><span class="tn">Checklist</span></button>
    <button data-tab="culto"><span class="tl">${icon("calendar")}</span><span class="tn">Culto</span></button>
    <button data-tab="equipe"><span class="tl">${icon("users")}<em>${all.length}</em></span><span class="tn">Equipe</span></button>
  </div>
  <div id="pane"></div>
  <div class="row gap" style="margin:18px 0 6px;justify-content:space-between">
    <a class="link" href="#/inicio" id="skip">Ir para o início</a>
    ${manage ? `<a class="link" href="#/times/${s.team_id}/servico">Configurar o serviço</a>` : ""}</div>`;
  draw();
  on(el, "click", "[data-tab]", (e, b) => { tab = b.dataset.tab; draw(); });
  el.querySelector("#skip").onclick = () => safeSet(skipKey(s.id), "1");
  on(el, "click", "[data-it]", async (e, b) => {
    const it = myItems.find((i) => i.id === b.dataset.it); if (!it) return;
    try {
      if (done.has(it.id)) {
        await must(sb.from("service_checks").delete().eq("schedule_id", s.id).eq("item_id", it.id).eq("user_id", state.user.id));
        done.delete(it.id);
      } else {
        const row = { schedule_id: s.id, item_id: it.id, user_id: state.user.id, org_id: s.org_id, team_id: s.team_id, target_at: targetOf(it, s.starts_at) };
        const r = await must(sb.from("service_checks").insert(row).select());
        done.set(it.id, r[0] || { ...row, checked_at: new Date().toISOString() });
      }
      draw();
    } catch (err) { toast(errMsg(err), "err"); }
  });
}

// ---------------------------------------------------------------- configuração dos líderes
export const SUGGESTIONS = [["Chegar ao local", 30], ["Conferir o seu equipamento", 20], ["Participar da oração da equipe", 10], ["Tudo pronto para começar", 5]];

async function configView(teamId, el, alive) {
  if (!canManageTeam(teamId)) { el.innerHTML = empty("lock", "Somente líderes configuram o serviço."); return; }
  el.innerHTML = spinner();
  const team = state.orgTeams?.find((t) => t.id === teamId) || state.myTeams.find((t) => t.id === teamId);
  let items;
  const [roles, items0, trow] = await Promise.all([
    must(sb.from("music_roles").select("id,name,sort").eq("org_id", state.org.id).order("sort")),
    must(sb.from("role_checklist_items").select("*").eq("team_id", teamId).order("position")),
    sb.from("teams").select("service_lead_min").eq("id", teamId).limit(1).then((r) => r.data?.[0]),
  ]);
  items = items0;
  if (!alive()) return;
  const lead = trow?.service_lead_min ?? DEFAULT_LEAD;
  const groups = [{ id: null, name: "Todos os escalados" }, ...roles];
  const offTxt = (o) => (o == null ? "" : String(-o));
  const paint = () => { el.innerHTML = `<div class="pagehead"><a class="back" href="#/times/${teamId}">${icon("chevronLeft")}</a><h1>Hora de servir</h1></div>
  <p class="muted small" style="margin:0 0 12px">No dia da escala, quem está escalado abre o app direto na página de serviço, com o checklist da sua função.</p>
  <label class="field"><span>Abrir a página de serviço</span><select id="lead">${LEAD_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === lead ? "selected" : ""}>${v ? `${l} antes do início` : l}</option>`).join("")}</select></label>
  ${groups.map((g) => { const list = items.filter((i) => (i.role_id || null) === g.id); return `<div class="sec"><h2>${esc(g.name)}</h2><span class="cnt2">${list.length}</span></div>
    <div class="card" data-g="${g.id || ""}">
      ${list.map((i) => `<div class="row gap svc-cfg" data-id="${i.id}"><input class="input grow" data-lbl maxlength="140" value="${attr(i.label)}"><input class="input" data-off type="number" min="-720" max="720" placeholder="min antes" value="${offTxt(i.offset_min)}" title="Minutos antes do início (vazio = sem horário)"><button class="iconbtn" data-del aria-label="Remover">${icon("trash")}</button></div>`).join("") || `<p class="tiny muted" style="margin:0 0 8px">Nenhum item.</p>`}
      <div class="row gap"><input class="input grow" data-new maxlength="140" placeholder="Novo item (ex.: Chegar ao local)"><input class="input" data-newoff type="number" min="-720" max="720" placeholder="min antes"><button class="btn" data-add>${icon("plus")}</button></div>
      ${!g.id && !list.length ? `<button class="chip" data-sug style="margin-top:10px">Usar sugestões</button>` : ""}
    </div>`; }).join("")}`; };
  paint();
  const num = (v) => { const n = v === "" || v == null ? null : -Number(v); return Number.isFinite(n) ? n : null; };
  const reload = async () => { items = await must(sb.from("role_checklist_items").select("*").eq("team_id", teamId).order("position")); paint(); };
  const base = (g) => ({ org_id: state.org.id, team_id: teamId, role_id: g || null });
  on(el, "change", "#lead", async (e) => {
    try { await must(sb.from("teams").update({ service_lead_min: Number(e.target.value) }).eq("id", teamId)); toast("Salvo"); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-add]", async (e, b) => {
    const box = b.closest("[data-g]"), lbl = box.querySelector("[data-new]").value.trim(); if (!lbl) return;
    const n = items.filter((i) => (i.role_id || "") === box.dataset.g).length;
    try { await must(sb.from("role_checklist_items").insert({ ...base(box.dataset.g), label: lbl, offset_min: num(box.querySelector("[data-newoff]").value), position: n + 1 })); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-sug]", async (e, b) => {
    const g = b.closest("[data-g]").dataset.g;
    try { await must(sb.from("role_checklist_items").insert(SUGGESTIONS.map(([label, m], i) => ({ ...base(g), label, offset_min: -m, position: i + 1 })))); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  on(el, "click", "[data-del]", async (e, b) => {
    try { await must(sb.from("role_checklist_items").delete().eq("id", b.closest("[data-id]").dataset.id)); reload(); }
    catch (err) { toast(errMsg(err), "err"); }
  });
  const upd = async (e) => {
    const r = e.target.closest("[data-id]"); if (!r) return;
    const label = r.querySelector("[data-lbl]").value.trim(); if (!label) return;
    try { await must(sb.from("role_checklist_items").update({ label, offset_min: num(r.querySelector("[data-off]").value) }).eq("id", r.dataset.id)); toast("Salvo"); }
    catch (err) { toast(errMsg(err), "err"); }
  };
  on(el, "change", "[data-lbl],[data-off]", upd);
}
