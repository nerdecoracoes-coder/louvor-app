// Página "Time" (dentro do time): convite, integrantes, funções, equipes, classificações, liderança, arquivos e avisos.
import { teamHas, sb, state, must, esc, attr, icon, avatar, teamBadge, people, isAdmin, isStaff, canManageTeam, sheet, toast, errMsg, busy, on, go, empty, spinner,
  confirmDialog, roleIcon, roleIconPicker, bindRoleIconPicker, loadRoleIcons, roleIcons, selectOrg, teamTypeLabel, teamHasRepertoire, applyAccent } from "../core.js";

export function register(route) {
  route("/times/:id/funcoes", (p, el, a) => rolesPage(p.id, el, a));
  route("/times/:id/equipes", (p, el, a) => groupsPage(p.id, el, a));
  route("/times/:id/classificacoes", (p, el, a) => classPage(p.id, el, a));
  route("/times/:id/lideranca", (p, el, a) => leadersPage(p.id, el, a));
}

const SETUP_MSG = `Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-05-time.sql</b> no SQL Editor do Supabase.`;
const missingTable = (e) => /relation|does not exist|schema cache|42P01|PGRST205|column/i.test(String(e?.message || e?.code || e));
const backHead = (id, title, extra = "") => `<div class="pagehead"><a class="back" href="#/times/${id}" aria-label="Voltar para Time">${icon("chevronLeft")}</a><h1>${esc(title)}</h1>${extra}</div>`;

async function loadTeam(id) {
  const team = await must(sb.from("teams").select("*").eq("id", id).maybeSingle());
  if (!team || team.org_id !== state.org.id) return null;
  return team;
}

// ---------------------------------------------------------------- Time
export async function timePage(id, el, alive) {
  el.innerHTML = spinner();
  const team = await loadTeam(id);
  if (!team) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const [members, roles, groups] = await Promise.all([
    must(sb.from("team_members").select("user_id,is_leader").eq("team_id", id)),
    must(sb.from("music_roles").select("id,team_type").eq("org_id", state.org.id)).then((rs) => rs.filter((r) => !r.team_type || r.team_type === team.team_type)),
    sb.from("team_groups").select("id").eq("team_id", id).then((r) => (r.error ? null : r.data)),
  ]);
  if (!alive()) return;
  if (team.apply_theme && team.accent_color) applyAccent(document.documentElement, team.accent_color);
  const manage = canManageTeam(id);
  const isMember = members.some((m) => m.user_id === state.user.id);
  const leaders = members.filter((m) => m.is_leader).length;
  const row = (ic, label, href, num, sub = "") => `<a href="${href}">${icon(ic)}<span class="grow">${label}${sub ? `<small>${sub}</small>` : ""}</span>${num != null ? `<span class="num">${num}</span>` : ""}${icon("chevronRight", "chev")}</a>`;
  el.innerHTML = `<div class="pagehead"><h1>Time</h1></div>
    <div class="teamcover">${teamBadge(team, 84)}<h2>${esc(team.name)}</h2><span class="small muted">${esc(teamTypeLabel(team))}</span></div>
    <div class="menulist">
      ${manage ? `<button data-inv>${icon("link")}<span class="grow">Convidar membros<small>Link exclusivo deste time</small></span>${icon("chevronRight", "chev")}</button>` : ""}
      ${row("users", "Integrantes", `#/times/${id}/integrantes`, members.length)}
      ${row("badge", "Funções", `#/times/${id}/funcoes`, roles.length)}
      ${manage ? row("stage", "Palco e presets", `#/times/${id}/palco`, null, "Posições das funções e modelos de escala") : ""}
      ${row("layers", "Equipes", `#/times/${id}/equipes`, groups ? groups.length : null)}
      ${teamHasRepertoire(team) ? row("tag", "Classificações", `#/times/${id}/classificacoes`, null) : ""}
      ${row("crown", "Liderança", `#/times/${id}/lideranca`, leaders)}
      ${teamHas(team, "eventos") ? row("calendar", "Eventos do time", `#/times/${id}/eventos`, null, "Reuniões, fraternização e confirmação de presença") : ""}
      ${teamHas(team, "devocional") ? row("play", "Devocional da semana", `#/times/${id}/devocional`, null, "Vídeo da semana para o time") : ""}
      ${teamHas(team, "estudio") ? row("layers", "Estúdio de mídia", `#/times/${id}/estudio`, null, "Slides do culto, fundos, vídeos e legendas") : ""}
      ${teamHas(team, "letras") ? row("lyrics", "Letras para a mídia", `#/times/${id}/letras`, null, "Partes, estilo e exportar para PowerPoint") : ""}
      ${row("file", "Arquivos", `#/times/${id}/arquivos`, null)}
      ${row("megaphone", "Avisos do time", `#/times/${id}/avisos`, null)}
      ${manage ? row("sliders", "Recursos e configurações", `#/times/${id}/config`, null, "Nome, cor, tipo e recursos do time") : ""}
      ${isMember ? `<button class="danger" data-leave>${icon("logout")}<span class="grow">Sair do time</span></button>` : ""}
    </div>`;
  on(el, "click", "[data-inv]", async () => { const { inviteSheet } = await import("./teams.js"); inviteSheet(team); });
  on(el, "click", "[data-leave]", async () => {
    if (!(await confirmDialog(`Sair do time ${team.name}?`, "Sair", true))) return;
    const r = await sb.from("team_members").delete().eq("team_id", id).eq("user_id", state.user.id);
    if (r.error) return toast(errMsg(r.error), "err");
    await selectOrg(state.org.id, false); toast("Você saiu do time"); go("/times");
  });
}

// ---------------------------------------------------------------- Funções
async function rolesPage(id, el, alive) {
  el.innerHTML = spinner();
  const team = await loadTeam(id);
  if (!team) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const draw = async () => {
    const [roles, tmr] = await Promise.all([
      must(sb.from("music_roles").select("*").eq("org_id", state.org.id).order("sort")).then((rs) => rs.filter((r) => !r.team_type || r.team_type === team.team_type)),
      must(sb.from("team_member_roles").select("role_id").eq("team_id", id)),
    ]);
    if (!alive()) return;
    const n = (rid) => tmr.filter((x) => x.role_id === rid).length;
    const edit = isStaff();
    el.innerHTML = `${backHead(id, "Funções", edit ? `<button class="btn primary sm" id="new">${icon("plus")} Nova</button>` : "")}
      <p class="subhead">Funções que as pessoas exercem em ${esc(team.name)}. Usadas para montar as escalas.</p>
      <div class="list">${roles.map((r) => `<${edit && r.team_type ? "button" : "div"} class="li" ${edit && r.team_type ? `data-r="${r.id}"` : ""}><span class="cover" style="width:42px;height:42px">${icon(roleIcon(r.name))}</span>
        <span class="grow" style="min-width:0"><span class="t">${esc(r.name)}</span><span class="s">${n(r.id)} pessoa${n(r.id) === 1 ? "" : "s"}${r.team_type ? "" : " · função padrão"}</span></span>${edit && r.team_type ? icon("chevronRight", "chev") : ""}</${edit && r.team_type ? "button" : "div"}>`).join("")
        || `<div class="li muted">Nenhuma função cadastrada.</div>`}</div>`;
    el.querySelector("#new")?.addEventListener("click", () => roleSheet(null));
    on(el, "click", "[data-r]", (e, b) => roleSheet(roles.find((x) => x.id === b.dataset.r)));
    function roleSheet(r) {
      const s = sheet(`<h3>${r ? "Editar função" : "Nova função"}</h3><form id="f"><label class="field"><span>Nome *</span><input name="name" required maxlength="60" value="${attr(r?.name || "")}" placeholder="Ex.: Violão"></label>${roleIconPicker(r?.icon || roleIcons.get(r?.name || "") || "")}
        <button class="btn primary block" id="save">Salvar</button>${r && isAdmin() ? `<button type="button" class="btn danger block mt-s" id="del">${icon("trash")} Excluir função</button>` : ""}</form>`);
      bindRoleIconPicker(s.el);
      s.el.querySelector("#f").onsubmit = async (ev) => {
        ev.preventDefault(); const btn = s.el.querySelector("#save"); busy(btn);
        const name = ev.target.name.value.trim(), ico = ev.target.icon.value || null;
        const q = r ? sb.from("music_roles").update({ name, icon: ico }).eq("id", r.id) : sb.from("music_roles").insert({ org_id: state.org.id, name, icon: ico, sort: roles.length + 1, team_type: team.team_type });
        let res = await q;
        if (res.error && /icon/i.test(res.error.message || "")) res = await (r ? sb.from("music_roles").update({ name }).eq("id", r.id) : sb.from("music_roles").insert({ org_id: state.org.id, name, sort: roles.length + 1, team_type: team.team_type })); // SQL do ícone ainda não aplicado
        busy(btn, false);
        if (res.error) return toast(errMsg(res.error), "err");
        await loadRoleIcons();
        s.close(); toast("Função salva"); draw();
      };
      s.el.querySelector("#del")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`Excluir a função ${r.name}? Quem a tinha fica sem ela.`, "Excluir", true))) return;
        const res = await sb.from("music_roles").delete().eq("id", r.id);
        if (res.error) return toast(errMsg(res.error), "err");
        s.close(); toast("Função excluída"); draw();
      });
    }
  };
  await draw();
}

// ---------------------------------------------------------------- Equipes
async function groupsPage(id, el, alive) {
  el.innerHTML = spinner();
  const team = await loadTeam(id);
  if (!team) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const ppl = await people();
  const draw = async () => {
    const g = await sb.from("team_groups").select("*").eq("team_id", id).order("sort").order("created_at");
    if (g.error) { el.innerHTML = `${backHead(id, "Equipes")}<div class="card small">${missingTable(g.error) ? SETUP_MSG : esc(errMsg(g.error))}</div>`; return; }
    const gm = await must(sb.from("team_group_members").select("group_id,user_id").eq("team_id", id));
    const members = await must(sb.from("team_members").select("user_id").eq("team_id", id));
    if (!alive()) return;
    const manage = canManageTeam(id);
    const of = (gid) => gm.filter((x) => x.group_id === gid).map((x) => ppl.get(x.user_id)).filter(Boolean);
    el.innerHTML = `${backHead(id, "Equipes", manage ? `<button class="btn primary sm" id="new">${icon("plus")} Nova</button>` : "")}
      <p class="subhead">Grupos dentro do time, como Banda A e Banda B. Ajudam a escalar quem costuma servir junto.</p>
      ${g.data.length ? `<div class="list">${g.data.map((x) => { const ms = of(x.id); return `<${manage ? "button" : "div"} class="li" ${manage ? `data-g="${x.id}"` : ""}>
        <span class="cover" style="width:42px;height:42px">${icon("layers")}</span><span class="grow" style="min-width:0"><span class="t">${esc(x.name)}</span>
        <span class="s ellipsis">${ms.length ? ms.map((p) => esc(p.display_name.split(" ")[0])).join(", ") : "Sem integrantes"}</span></span>${manage ? icon("chevronRight", "chev") : ""}</${manage ? "button" : "div"}>`; }).join("")}</div>`
        : `<div class="card">${empty("layers", "Nenhuma equipe criada", manage ? "Crie a primeira equipe com o botão Nova." : "O líder pode criar equipes para organizar o time.")}</div>`}`;
    el.querySelector("#new")?.addEventListener("click", () => groupSheet(null));
    on(el, "click", "[data-g]", (e, b) => groupSheet(g.data.find((x) => x.id === b.dataset.g)));
    function groupSheet(grp) {
      const sel = new Set(grp ? gm.filter((x) => x.group_id === grp.id).map((x) => x.user_id) : []);
      const cands = members.map((m) => ppl.get(m.user_id)).filter(Boolean).sort((a, b) => a.display_name.localeCompare(b.display_name));
      const s = sheet(`<h3>${grp ? "Editar equipe" : "Nova equipe"}</h3><form id="f"><label class="field"><span>Nome *</span><input name="name" required maxlength="80" value="${attr(grp?.name || "")}" placeholder="Ex.: Banda A"></label>
        <div class="field"><span>Integrantes</span><div class="list" style="max-height:40vh;overflow:auto">${cands.map((p) => `<button type="button" class="li" data-u="${p.id}">${avatar(p, 38, false)}<span class="grow t">${esc(p.display_name)}</span><span class="selbox ${sel.has(p.id) ? "on" : ""}">${icon("check")}</span></button>`).join("")}</div></div>
        <button class="btn primary block" id="save">Salvar</button>${grp ? `<button type="button" class="btn danger block mt-s" id="del">${icon("trash")} Excluir equipe</button>` : ""}</form>`);
      on(s.el, "click", "[data-u]", (e, b) => { const u = b.dataset.u; sel.has(u) ? sel.delete(u) : sel.add(u); b.querySelector(".selbox").classList.toggle("on", sel.has(u)); });
      s.el.querySelector("#f").onsubmit = async (ev) => {
        ev.preventDefault(); const btn = s.el.querySelector("#save"); busy(btn);
        try {
          const name = ev.target.name.value.trim();
          let gid = grp?.id;
          if (grp) await must(sb.from("team_groups").update({ name }).eq("id", gid));
          else gid = (await must(sb.from("team_groups").insert({ team_id: id, org_id: state.org.id, name, sort: g.data.length + 1 }).select("id").single())).id;
          await must(sb.from("team_group_members").delete().eq("group_id", gid));
          if (sel.size) await must(sb.from("team_group_members").insert([...sel].map((u) => ({ group_id: gid, user_id: u, team_id: id, org_id: state.org.id }))));
          s.close(); toast("Equipe salva"); draw();
        } catch (err) { toast(errMsg(err), "err"); } finally { busy(btn, false); }
      };
      s.el.querySelector("#del")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`Excluir a equipe ${grp.name}? As pessoas continuam no time.`, "Excluir", true))) return;
        const res = await sb.from("team_groups").delete().eq("id", grp.id);
        if (res.error) return toast(errMsg(res.error), "err");
        s.close(); toast("Equipe excluída"); draw();
      });
    }
  };
  await draw();
}

// ---------------------------------------------------------------- Classificações (do repertório)
const SUGGESTED = ["Louvor", "Adoração", "Celebração", "Ceia", "Ofertório"];
async function classPage(id, el, alive) {
  el.innerHTML = spinner();
  const team = await loadTeam(id);
  if (!team) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const draw = async () => {
    const c = await sb.from("classifications").select("*").eq("org_id", state.org.id).order("sort").order("name");
    if (c.error) { el.innerHTML = `${backHead(id, "Classificações")}<div class="card small">${missingTable(c.error) ? SETUP_MSG : esc(errMsg(c.error))}</div>`; return; }
    if (!alive()) return;
    const edit = isStaff();
    el.innerHTML = `${backHead(id, "Classificações", edit ? `<button class="btn primary sm" id="new">${icon("plus")} Nova</button>` : "")}
      <p class="subhead">Para organizar o repertório por momento do culto. Cada música pode ter uma classificação.</p>
      ${c.data.length ? `<div class="list">${c.data.map((x) => `<${edit ? "button" : "div"} class="li" ${edit ? `data-c="${x.id}"` : ""}><span class="cover" style="width:42px;height:42px">${icon("tag")}</span>
        <span class="grow t">${esc(x.name)}</span>${edit ? icon("chevronRight", "chev") : ""}</${edit ? "button" : "div"}>`).join("")}</div>`
        : `<div class="card">${empty("tag", "Nenhuma classificação", edit ? `<button class="btn ghost sm mt-s" id="sug">Adicionar sugestões</button>` : "")}</div>`}`;
    el.querySelector("#new")?.addEventListener("click", () => sheetFor(null));
    el.querySelector("#sug")?.addEventListener("click", async () => {
      const r = await sb.from("classifications").insert(SUGGESTED.map((name, i) => ({ org_id: state.org.id, name, sort: i + 1 })));
      if (r.error) return toast(errMsg(r.error), "err");
      draw();
    });
    on(el, "click", "[data-c]", (e, b) => sheetFor(c.data.find((x) => x.id === b.dataset.c)));
    function sheetFor(x) {
      const s = sheet(`<h3>${x ? "Editar classificação" : "Nova classificação"}</h3><form id="f"><label class="field"><span>Nome *</span><input name="name" required maxlength="60" value="${attr(x?.name || "")}" placeholder="Ex.: Adoração"></label>
        <button class="btn primary block" id="save">Salvar</button>${x ? `<button type="button" class="btn danger block mt-s" id="del">${icon("trash")} Excluir</button>` : ""}</form>`);
      s.el.querySelector("#f").onsubmit = async (ev) => {
        ev.preventDefault(); const btn = s.el.querySelector("#save"); busy(btn);
        const name = ev.target.name.value.trim();
        const r = await (x ? sb.from("classifications").update({ name }).eq("id", x.id) : sb.from("classifications").insert({ org_id: state.org.id, name, sort: c.data.length + 1 }));
        busy(btn, false);
        if (r.error) return toast(/duplicate|unique/i.test(errMsg(r.error)) ? "Já existe uma classificação com esse nome." : errMsg(r.error), "err");
        if (x && x.name !== name) await sb.from("songs").update({ classification: name }).eq("org_id", state.org.id).eq("classification", x.name);
        s.close(); toast("Classificação salva"); draw();
      };
      s.el.querySelector("#del")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`Excluir a classificação ${x.name}? As músicas ficam sem classificação.`, "Excluir", true))) return;
        await sb.from("songs").update({ classification: null }).eq("org_id", state.org.id).eq("classification", x.name);
        const r = await sb.from("classifications").delete().eq("id", x.id);
        if (r.error) return toast(errMsg(r.error), "err");
        s.close(); toast("Classificação excluída"); draw();
      });
    }
  };
  await draw();
}

// ---------------------------------------------------------------- Liderança
async function leadersPage(id, el, alive) {
  el.innerHTML = spinner();
  const team = await loadTeam(id);
  if (!team) { el.innerHTML = empty("alert", "Time não encontrado"); return; }
  const [members, ppl] = await Promise.all([must(sb.from("team_members").select("user_id,is_leader").eq("team_id", id)), people()]);
  if (!alive()) return;
  const leaders = members.filter((m) => m.is_leader).map((m) => ppl.get(m.user_id)).filter(Boolean);
  const admins = [...ppl.values()].filter((p) => p.role === "admin");
  const li = (p, s) => `<div class="li">${avatar(p, 44, true)}<span class="grow" style="min-width:0"><span class="t ellipsis" style="display:block">${esc(p.display_name)}</span><span class="s">${s}</span></span></div>`;
  el.innerHTML = `${backHead(id, "Liderança")}
    <div class="sec"><h2>Líderes do time</h2></div>
    <div class="list">${leaders.map((p) => li(p, "Líder do time")).join("") || `<div class="li muted small">Nenhum líder definido.</div>`}</div>
    <div class="sec"><h2>Administradores da igreja</h2></div>
    <div class="list">${admins.map((p) => li(p, "Administrador geral")).join("") || `<div class="li muted small">Nenhum administrador encontrado.</div>`}</div>
    <p class="small muted mt">${isAdmin() ? `Para mudar a liderança, abra <a class="link" href="#/times/${id}/integrantes">Integrantes</a> e use o menu da pessoa.` : "A liderança de cada time é definida pelo administrador da igreja."}</p>`;
}
