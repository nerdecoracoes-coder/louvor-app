// SOMOS Chamados: ambiente de quem lidera (líderes de ministério, pastores supervisores de rede, liderança geral).
// Pessoa ≠ conta ≠ vínculo ≠ função ≠ permissão: aqui só se enxerga e configura o que o servidor libera (my_access / RPCs).
import { sb, state, esc, attr, icon, people, personName, teamBadge, teamTypeLabel, sheet, toast, errMsg, busy, on, empty, spinner, confirmDialog, canAdminOrg, canChamados, canPeople, canWelcome, peopleCan, myNetworks, isGeneralLeader, isDeveloper } from "../core.js";

export function register(route) { route("/chamados", (p, el, a) => view(el, a)); }

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-11-23-ambientes.sql</b> no SQL Editor do Supabase.</div>`;
const ACTIONS = [["view", "Ver"], ["create", "Criar"], ["edit", "Editar"], ["delete", "Excluir"], ["approve", "Aprovar"], ["manage", "Gerenciar"], ["administer", "Administrar"]];
const PEOPLE_ACTIONS = [["people_view", "Ver a base de pessoas"], ["people_edit", "Cadastrar e editar pessoas"], ["people_approve", "Aprovar cadastros"], ["people_import", "Importar e vincular pessoas"], ["people_welcome", "Registrar acolhimento de visitantes"], ["people_timeline_add", "Adicionar acontecimentos no histórico"], ["people_timeline_edit", "Corrigir acontecimentos manuais do histórico"], ["people_converts_view", "Ver novos convertidos"], ["people_converts_register", "Registrar decisões de fé"], ["people_converts_edit", "Corrigir informações das decisões"], ["people_converts_link", "Associar decisões a fichas"], ["people_converts_assign", "Designar responsáveis pelo acompanhamento"], ["people_converts_followup", "Acompanhar novos convertidos"], ["people_converts_indicators", "Ver indicadores de convertidos"], ["people_converts_admin", "Administrar convertidos (anular, formulário)"]];
const actLabel = (a) => ([...ACTIONS, ...PEOPLE_ACTIONS].find((x) => x[0] === a) || [a, a])[1];
const chipsOf = (list, on) => list.map(([k, l]) => `<label class="chip"><input type="checkbox" value="${k}" ${on.includes(k) ? "checked" : ""}> ${l}</label>`).join("");

async function view(el, alive) {
  if (!state.access) { el.innerHTML = `<div class="pagehead"><h1>SOMOS Chamados</h1></div>${SETUP}`; return; }
  if (!canChamados()) { el.innerHTML = empty("shield", "Você não tem acesso a este ambiente."); return; }
  el.innerHTML = spinner();
  const org = state.org.id;
  const [nets, nt, gr, ppl] = await Promise.all([
    sb.from("church_networks").select("*").eq("org_id", org).order("sort").order("name"),
    sb.from("network_teams").select("*").eq("org_id", org),
    sb.from("access_grants").select("*").eq("org_id", org),
    people(true),
  ]);
  if (nets.error) { el.innerHTML = SETUP; return; }
  if (!alive()) return;
  const admin = canAdminOrg();
  const teamsById = new Map(state.orgTeams.map((t) => [t.id, t]));
  const nm = (uid) => personName(ppl.get(uid)) || "Pessoa";
  const grants = gr.data || [];
  const paint = () => {
    const mine = new Set(state.access.leader_of || []);
    const covered = new Set();
    if (state.access.admin || state.access.developer || isGeneralLeader()) state.orgTeams.forEach((t) => covered.add(t.id));
    mine.forEach((id) => covered.add(id));
    const myNetIds = new Set(myNetworks().map((n) => n.id));
    (nt.data || []).filter((x) => myNetIds.has(x.network_id)).forEach((x) => covered.add(x.team_id));
    const teams = [...covered].map((id) => teamsById.get(id)).filter(Boolean);
    const teamRow = (t) => `<a class="li" href="#/times/${t.id}">${teamBadge(t, 40)}<span class="grow"><span class="t">${esc(t.name)}</span><span class="s">${esc(teamTypeLabel(t))}</span></span>${icon("chevronRight", "chev")}</a>`;
    const netTeams = (id) => (nt.data || []).filter((x) => x.network_id === id).map((x) => teamsById.get(x.team_id)).filter(Boolean);
    const supers = (id) => grants.filter((g) => g.role_key === "network_supervisor" && g.network_id === id);
    const leaders = grants.filter((g) => g.role_key === "general_leader");
    el.innerHTML = `<div class="pagehead"><h1>SOMOS Chamados</h1></div><p class="muted small" style="margin:-8px 0 14px">Ministérios e pessoas sob sua responsabilidade.${isDeveloper() ? " · Acesso de desenvolvedor" : ""}</p>
    ${canPeople() || canWelcome() || canAdminOrg() || isDeveloper() || ["people_converts_view", "people_converts_followup", "people_converts_register"].some(peopleCan) ? `<h3>Pessoas</h3><div class="list menu">${canPeople() || isDeveloper() ? `<a class="li" href="#/pessoas">${icon("users")}<span class="grow"><span class="t">Cadastro de pessoas</span><span class="s">Membros, frequentadores e visitantes</span></span>${icon("chevronRight", "chev")}</a>` : ""}${canAdminOrg() || peopleCan("people_approve") ? `<a class="li" href="#/atualizacoes-cadastrais">${icon("edit")}<span class="grow"><span class="t">Atualizações cadastrais</span><span class="s">Pedidos de mudança de dados, aprovados campo a campo</span></span>${icon("chevronRight", "chev")}</a>` : ""}${canAdminOrg() || ["people_converts_view", "people_converts_followup", "people_converts_register"].some(peopleCan) ? `<a class="li" href="#/novos-convertidos">${icon("heart")}<span class="grow"><span class="t">Novos convertidos</span><span class="s">Decisões de fé, acompanhamento e indicadores</span></span>${icon("chevronRight", "chev")}</a>` : ""}${canWelcome() ? `<a class="li" href="#/acolhimento">${icon("heart")}<span class="grow"><span class="t">Acolhimento de visitantes</span><span class="s">Primeira visita, retorno e jornada</span></span>${icon("chevronRight", "chev")}</a>` : ""}</div>` : ""}
    <h3${canPeople() || canWelcome() || isDeveloper() || ["people_converts_view", "people_converts_followup", "people_converts_register"].some(peopleCan) ? ' class="mt"' : ""}>Ministérios</h3>
    <div class="list menu">${teams.map(teamRow).join("") || `<div class="li muted small">Nenhum ministério sob sua responsabilidade ainda.</div>`}</div>
    ${(nets.data || []).length || admin ? `<div class="row between mt"><h3>Redes de supervisão</h3>${admin ? `<button class="btn ghost sm" data-net="">${icon("plus")} Nova rede</button>` : ""}</div>
    <div class="list">${(nets.data || []).map((n) => `<div class="li col"><div class="row between"><b>${esc(n.name)}</b>${admin ? `<span class="row gap-s"><button class="btn ghost sm" data-net="${n.id}">Editar</button><button class="btn ghost sm" data-sup="${n.id}">Supervisor</button></span>` : ""}</div>
      <div class="s muted small">${netTeams(n.id).map((t) => esc(t.name)).join(", ") || "Sem ministérios"}</div>
      ${supers(n.id).map((g) => `<div class="row between small"><span>${icon("badge")} ${esc(nm(g.user_id))}${g.title ? ` · ${esc(g.title)}` : ""}</span>${admin ? `<button class="btn ghost sm" data-rm="${g.id}">Remover</button>` : ""}</div>`).join("")}</div>`).join("") || `<div class="li muted small">Nenhuma rede criada.</div>`}</div>` : ""}
    ${admin ? `<div class="row between mt"><h3>Secretaria</h3><button class="btn ghost sm" data-sec>${icon("plus")} Adicionar</button></div>
    <div class="list">${grants.filter((g) => g.role_key === "secretary").map((g) => `<div class="li col"><div class="row between"><span>${icon("badge")} <b>${esc(nm(g.user_id))}</b>${g.title ? ` · ${esc(g.title)}` : ""}</span><button class="btn ghost sm" data-rm="${g.id}">Remover</button></div><div class="s muted small">${(g.actions || []).map(actLabel).join(", ")}</div></div>`).join("") || `<div class="li muted small">Ninguém na secretaria. A secretaria cuida do cadastro de pessoas.</div>`}</div>` : ""}
    ${admin ? `<div class="row between mt"><h3>Liderança geral</h3><button class="btn ghost sm" data-gl>${icon("plus")} Adicionar</button></div>
    <div class="list">${leaders.map((g) => `<div class="li col"><div class="row between"><span>${icon("crown")} <b>${esc(nm(g.user_id))}</b>${g.title ? ` · ${esc(g.title)}` : ""}</span><button class="btn ghost sm" data-rm="${g.id}">Remover</button></div><div class="s muted small">${(g.actions || []).map(actLabel).join(", ")}</div></div>`).join("") || `<div class="li muted small">Ninguém na liderança geral.</div>`}</div>` : ""}`;
  };
  const reload = async () => { const [a, b, c] = await Promise.all([sb.from("church_networks").select("*").eq("org_id", org).order("sort").order("name"), sb.from("network_teams").select("*").eq("org_id", org), sb.from("access_grants").select("*").eq("org_id", org)]); nets.data = a.data; nt.data = b.data; grants.splice(0, grants.length, ...(c.data || [])); paint(); };
  const call = async (fn, args, ok) => { const r = await sb.rpc(fn, args); if (r.error) { toast(errMsg(r.error)); return false; } toast(ok); await reload(); return true; };
  const pick = (title, extra, onSave) => {
    const opts = [...ppl.values()].sort((a, b) => nm(a.id).localeCompare(nm(b.id))).map((p) => `<option value="${p.id}">${esc(nm(p.id))}</option>`).join("");
    const s = sheet(`<h3>${title}</h3><label class="fld">Pessoa<select id="u">${opts}</select></label><label class="fld">Título (opcional)<input id="ti" maxlength="60" placeholder="Ex.: Pastor da rede"></label>${extra}<button class="btn block mt" id="ok">Salvar</button>`);
    s.el.querySelector("#ok").onclick = async (e) => { const b = e.currentTarget; busy(b); try { if (await onSave(s.el.querySelector("#u").value, s.el.querySelector("#ti").value.trim() || null, s.el)) s.close(); } finally { busy(b, false); } };
  };
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-net],[data-sup],[data-gl],[data-sec],[data-rm]"); if (!b) return;
    if (b.dataset.rm) { if (await confirmDialog("Remover esta função? A pessoa continua na igreja e nos times.", "Remover")) await call("grant_remove", { p_id: b.dataset.rm }, "Função removida"); return; }
    if ("gl" in b.dataset) {
      return pick("Liderança geral", `<div class="fld">Permissões<div class="chips" style="flex-wrap:wrap">${chipsOf([...ACTIONS.filter((a) => a[0] !== "delete"), ...PEOPLE_ACTIONS], ["view", "approve", "manage"])}</div></div>`,
        (u, ti, root) => call("grant_set", { p_org: org, p_user: u, p_role: "general_leader", p_network: null, p_title: ti, p_actions: [...root.querySelectorAll(".chips input:checked")].map((i) => i.value) }, "Liderança geral salva"));
    }
    if (b.dataset.sup) return pick("Pastor supervisor", `<div class="fld">Cadastro de pessoas (opcional)<div class="chips" style="flex-wrap:wrap">${chipsOf([PEOPLE_ACTIONS[0]], [])}</div><span class="tiny muted">Dá acesso apenas às pessoas com conta que servem nos ministérios desta rede.</span></div>`,
      (u, ti, root) => call("grant_set", { p_org: org, p_user: u, p_role: "network_supervisor", p_network: b.dataset.sup, p_title: ti, p_actions: ["view", "approve", "manage", ...[...root.querySelectorAll(".chips input:checked")].map((i) => i.value)] }, "Supervisor definido"));
    if ("sec" in b.dataset) return pick("Secretaria", `<div class="fld">Permissões<div class="chips" style="flex-wrap:wrap">${chipsOf(PEOPLE_ACTIONS, PEOPLE_ACTIONS.map((x) => x[0]))}</div></div>`,
      (u, ti, root) => { const acts = [...root.querySelectorAll(".chips input:checked")].map((i) => i.value); if (!acts.length) { toast("Marque ao menos uma permissão."); return false; } return call("grant_set", { p_org: org, p_user: u, p_role: "secretary", p_network: null, p_title: ti || "Secretaria", p_actions: acts }, "Secretaria definida"); });
    const cur = (nets.data || []).find((n) => n.id === b.dataset.net), has = new Set((nt.data || []).filter((x) => x.network_id === cur?.id).map((x) => x.team_id));
    const s = sheet(`<h3>${cur ? "Editar rede" : "Nova rede"}</h3><label class="fld">Nome<input id="nn" maxlength="60" value="${attr(cur?.name || "")}"></label><div class="fld">Ministérios<div class="list">${state.orgTeams.map((t) => `<label class="li"><input type="checkbox" value="${t.id}" ${has.has(t.id) ? "checked" : ""}><span class="grow">${esc(t.name)}</span></label>`).join("")}</div></div><div class="row gap-s mt"><button class="btn grow" id="ok">Salvar</button>${cur ? `<button class="btn ghost" id="del">Excluir</button>` : ""}</div>`);
    s.el.querySelector("#ok").onclick = async (ev) => { const name = s.el.querySelector("#nn").value.trim(); if (!name) return toast("Dê um nome à rede."); const b2 = ev.currentTarget; busy(b2); try { if (await call("network_save", { p_org: org, p_id: cur?.id || null, p_name: name, p_teams: [...s.el.querySelectorAll(".list input:checked")].map((i) => i.value) }, "Rede salva")) s.close(); } finally { busy(b2, false); } };
    const d = s.el.querySelector("#del"); if (d) d.onclick = async () => { if (await confirmDialog("Excluir a rede? Os ministérios não são afetados.", "Excluir") && await call("network_delete", { p_id: cur.id }, "Rede excluída")) s.close(); };
  });
  paint();
}
