// Administração Institucional (Fase 6A): estrutura de igrejas/unidades, convites, acessos regionais, consolidado e histórico.
// Toda regra (quem estrutura, quem vê números, consentimento do vínculo) está no banco; aqui só se escolhe como mostrar.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, people } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen } from "../lib/mod-ui.js";

const BACK = ["#/chamados", "SOMOS Chamados"];
const KINDS = ["Organização principal", "Regional", "Igreja", "Congregação", "Unidade"];
const ACTS = [["structure", "Estruturar", "Criar unidades, gerar convites e mudar o tipo das unidades abaixo."], ["consolidated", "Ver números consolidados", "Quantidades por unidade (pessoas, células, eventos, programações). Nunca nomes."], ["consolidated_fin", "Ver indicadores financeiros", "Entradas e saídas do mês por unidade. A consulta fica registrada."]];
const ACT_LABEL = Object.fromEntries(ACTS.map((a) => [a[0], a[1]]));
const tag = (t, c = "none") => `<span class="ptag ${c}" style="white-space:nowrap">${esc(t)}</span>`;
const org = () => state.org?.id;
const money = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ACTION_TXT = { create: "Criou a unidade", link: "Vinculou a unidade", unlink: "Desvinculou a unidade", kind: "Mudou o tipo da unidade", grant: "Concedeu acesso", revoke: "Retirou acesso", view_fin: "Consultou indicadores financeiros", invite_create: "Gerou um convite", invite_revoke: "Revogou um convite" };

export function register(route) { route("/instituicao", (p, el, a) => institution(el, a)); }

async function institution(el, alive) {
  el.innerHTML = `${head("Administração institucional", BACK)}${spinner()}`;
  const acc = await sb.rpc("inst_access", { p_org: org() }); if (!alive()) return;
  if (acc.error) return fail(el, "Administração institucional", acc.error, BACK);
  const a = acc.data;
  if (!(a.admin || a.structure || a.consolidated)) return fail(el, "Administração institucional", { message: "forbidden" }, BACK);
  const tabs = [a.structure || a.consolidated ? ["est", "Estrutura"] : null, a.consolidated ? ["con", "Consolidado"] : null, a.admin ? ["ace", "Acessos"] : null, a.structure ? ["his", "Histórico"] : null].filter(Boolean);
  let tab = tabs[0]?.[0] || "est";
  const draw = async () => {
    el.innerHTML = `${head("Administração institucional", BACK)}<p class="small muted" style="margin:-8px 0 12px">${esc(state.org?.name || "")}. Cada igreja guarda os próprios dados; aqui só se organiza a estrutura e se consultam números.</p>
      <nav class="tabs">${tabs.map((t) => `<button class="${tab === t[0] ? "on" : ""}" data-t="${t[0]}">${t[1]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const body = el.querySelector("#body");
    await ({ est: estTab, con: conTab, ace: aceTab, his: hisTab }[tab])(body);
  };
  const err = (body, e) => (body.innerHTML = `<div class="card small">${esc(errText(e))}</div>`);

  // ---------------------------------------------------------------- estrutura
  async function estTab(body) {
    const r = a.structure || a.consolidated ? await sb.rpc("org_tree", { p_org: org() }) : { data: { units: [], parent: null } }; if (!alive()) return; if (r.error) return err(body, r.error);
    const t = r.data, kinds = new Set([...KINDS, ...t.units.map((u) => u.kind).filter(Boolean)]);
    const inv = a.structure ? await sb.rpc("org_invite_list", { p_parent: org() }) : { data: [] };
    body.innerHTML = `${t.parent ? `<div class="card small">Esta igreja faz parte de <b>${esc(t.parent.name)}</b>${t.parent.kind ? ` (${esc(t.parent.kind)})` : ""}.</div>` : ""}
      <div class="row gap-s mb" style="flex-wrap:wrap">${a.structure ? `<button class="btn primary sm" id="nu">${icon("plus")} Nova unidade</button><button class="btn ghost sm" id="gi">Gerar convite</button>` : ""}${a.admin && !a.has_parent ? `<button class="btn ghost sm" id="ai">Entrar em uma estrutura</button>` : ""}${a.admin && a.has_parent ? `<button class="btn ghost sm danger" id="lv">Sair da estrutura</button>` : ""}</div>
      <div class="list">${t.units.map((u) => `<div class="li col stack" style="align-items:stretch;padding-left:${14 + u.depth * 16}px"><div class="row between" style="gap:8px;flex-wrap:wrap"><b>${esc(u.name)}</b><span class="row gap-s">${u.kind ? tag(u.kind) : ""}${u.i_admin ? tag("Você administra", "st-approved") : ""}</span></div>
        <span class="small muted">${u.members} ${u.members === 1 ? "pessoa com acesso" : "pessoas com acesso"}</span>${a.structure && u.depth > 0 ? `<span class="row gap-s"><button class="link small" data-k="${u.id}" data-kn="${attr(u.kind || "")}">Mudar tipo</button>${u.i_admin ? "" : `<button class="link small" data-u="${u.id}" data-un="${attr(u.name)}">Desvincular</button>`}</span>` : ""}</div>`).join("") || empty("users", "Nenhuma unidade")}</div>
      ${a.structure ? `<h3 class="mt">Convites</h3><p class="small muted">Para uma igreja que já existe entrar na estrutura, gere um convite e entregue o código ao administrador dela. O código vale por 7 dias e uma vez só.</p>
      <div class="list">${inv.data.map((i) => `<div class="li col stack" style="align-items:stretch"><div class="row between" style="gap:8px;flex-wrap:wrap"><span>${i.unit_kind ? esc(i.unit_kind) : "Convite"} · ${fmtWhen(i.created_at)}</span>${i.state === "open" ? tag("Aberto", "st-approved") : i.state === "used" ? tag("Usado por " + (i.used_by || "—")) : tag("Expirado")}</div>${i.state === "open" ? `<button class="link small danger" data-rv="${i.id}" style="align-self:flex-start">Revogar</button>` : ""}</div>`).join("") || `<div class="li muted small">Nenhum convite.</div>`}</div>` : ""}`;
    const kindField = (v = "") => `<label class="fld">Tipo (livre)<input id="kd" list="kl" maxlength="40" value="${attr(v)}" placeholder="Ex.: Regional, Igreja, Congregação"><datalist id="kl">${[...kinds].map((k) => `<option value="${attr(k)}">`).join("")}</datalist></label>`;
    const q = (s, k) => s.el.querySelector(k);
    const run = async (ev, fn, args, ok, s) => { busy(ev.currentTarget); const x = await sb.rpc(fn, args); if (x.error) { busy(ev.currentTarget, false); toast(errText(x.error)); return null; } s?.close(); toast(ok); draw(); return x.data; };
    body.querySelector("#nu")?.addEventListener("click", () => {
      const s = sheet(`<h3>Nova unidade</h3><p class="small muted">Será criada abaixo de ${esc(state.org?.name || "esta igreja")}. Você será administrador dela.</p><label class="fld">Nome<input id="nm" maxlength="80"></label>${kindField()}<div class="row gap-s mt"><button class="btn grow" id="ok">Criar</button></div>`);
      q(s, "#ok").onclick = (ev) => run(ev, "org_unit_create", { p_parent: org(), p_name: q(s, "#nm").value, p_kind: q(s, "#kd").value }, "Unidade criada.", s);
    });
    body.querySelector("#gi")?.addEventListener("click", () => {
      const s = sheet(`<h3>Gerar convite</h3>${kindField("Igreja")}<div class="row gap-s mt"><button class="btn grow" id="ok">Gerar código</button></div>`);
      q(s, "#ok").onclick = async (ev) => {
        busy(ev.currentTarget); const x = await sb.rpc("org_invite_create", { p_parent: org(), p_kind: q(s, "#kd").value }); if (x.error) { busy(ev.currentTarget, false); return toast(errText(x.error)); }
        s.el.innerHTML = `<h3>Convite gerado</h3><p class="small muted">Copie agora: o código não será mostrado de novo. Vale por 7 dias e uma vez só.</p><div class="card" style="text-align:center"><b style="font-size:20px;letter-spacing:.06em" id="cd">${esc(x.data.code)}</b></div><div class="row gap-s mt"><button class="btn grow" id="cp">${icon("copy")} Copiar</button><button class="btn ghost grow" id="fx">Fechar</button></div>`;
        s.el.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(x.data.code); toast("Código copiado."); } catch { toast("Copie o código manualmente."); } };
        s.el.querySelector("#fx").onclick = () => { s.close(); draw(); };
      };
    });
    body.querySelector("#ai")?.addEventListener("click", () => {
      const s = sheet(`<h3>Entrar em uma estrutura</h3><p class="small muted">Digite o código que o administrador da estrutura enviou. Seus dados continuam só da sua igreja.</p><label class="fld">Código<input id="cd" placeholder="IGR-XXXXXXXXXXXX" autocapitalize="characters" autocomplete="off"></label><div class="row gap-s mt"><button class="btn grow" id="ok">Entrar</button></div>`);
      q(s, "#ok").onclick = (ev) => run(ev, "org_invite_accept", { p_child: org(), p_code: q(s, "#cd").value }, "Igreja vinculada à estrutura.", s).then((d) => d && location.reload());
    });
    body.querySelector("#lv")?.addEventListener("click", async (ev) => { if (!(await confirmDialog("Sair da estrutura? A igreja e todos os dados continuam; só deixa de aparecer nos números consolidados.", "Sair", true))) return; run({ currentTarget: ev.currentTarget }, "org_unit_unlink", { p_child: org() }, "Você saiu da estrutura.").then((d) => d && location.reload()); });
    body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
      const s = sheet(`<h3>Mudar tipo</h3>${kindField(b.dataset.kn)}<div class="row gap-s mt"><button class="btn grow" id="ok">Salvar</button></div>`);
      q(s, "#ok").onclick = (ev) => run(ev, "org_unit_set_kind", { p_org: b.dataset.k, p_kind: q(s, "#kd").value }, "Tipo atualizado.", s);
    }));
    body.querySelectorAll("[data-u]").forEach((b) => (b.onclick = async (ev) => { if (!(await confirmDialog(`Desvincular ${b.dataset.un}? Os dados dela não são apagados nem movidos.`, "Desvincular", true))) return; run({ currentTarget: b }, "org_unit_unlink", { p_child: b.dataset.u }, "Unidade desvinculada."); }));
    body.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => run({ currentTarget: b }, "org_invite_revoke", { p_id: b.dataset.rv }, "Convite revogado.")));
  }

  // ---------------------------------------------------------------- consolidado
  async function conTab(body) {
    const r = await sb.rpc("org_consolidated", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    const c = r.data, t = c.totals;
    const stat = (n, l) => `<div class="card" style="margin:0"><div style="font-size:26px;font-weight:700;letter-spacing:-.02em">${n}</div><div class="small muted">${l}</div></div>`;
    body.innerHTML = `<p class="small muted">Somente quantidades. Nomes e dados de pessoas ficam na igreja de origem.</p>
      <div class="grid2 mb">${stat(t.units, t.units === 1 ? "unidade" : "unidades")}${stat(t.people, "pessoas ativas")}${stat(t.members, "membros")}${stat(t.cells, "células ativas")}${stat(t.events_upcoming, "eventos próximos")}${stat(t.rosters_upcoming, "escalas futuras")}</div>
      ${c.fin_allowed ? `<h3>Financeiro do mês</h3><div class="grid2 mb">${stat(money(t.income), "entradas baixadas")}${stat(money(t.expense), "saídas baixadas")}</div>` : `<div class="card small muted">Indicadores financeiros exigem uma permissão própria, concedida em Acessos.</div>`}
      <h3 class="mt">Por unidade</h3><div class="list">${c.units.map((u) => `<div class="li col stack" style="align-items:stretch;padding-left:${14 + u.depth * 16}px"><div class="row between" style="gap:8px;flex-wrap:wrap"><b>${esc(u.name)}</b>${u.kind ? tag(u.kind) : ""}</div>
        <div class="small muted">${u.people} pessoas · ${u.members} membros · ${u.cells} células · ${u.events_upcoming} eventos próximos · ${u.programs} programações · ${u.rosters_upcoming} escalas futuras</div>
        ${u.fin ? `<div class="small">Entradas ${money(u.fin.income)} · Saídas ${money(u.fin.expense)} · A pagar ${money(u.fin.open_expense)}</div>` : ""}</div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- acessos
  async function aceTab(body) {
    const r = await sb.rpc("org_scope_list", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    body.innerHTML = `<p class="small muted">Quem recebe acesso aqui vê a estrutura e os números consolidados desta igreja e das unidades abaixo dela, conforme o que você marcar. Isso <b>não</b> abre a ficha das pessoas, o financeiro detalhado nem outros dados internos.</p>
      <button class="btn primary sm mb" id="new">${icon("plus")} Conceder acesso</button>
      <div class="list">${r.data.map((g) => `<div class="li col stack" style="align-items:stretch"><div class="row between" style="gap:8px;flex-wrap:wrap"><b>${esc(g.name)}${g.level ? ` · ${esc(g.level)}` : ""}</b><button class="btn ghost sm danger" data-rm="${g.id}">Retirar</button></div><span class="row gap-s" style="flex-wrap:wrap">${g.actions.map((x) => tag(ACT_LABEL[x] || x)).join("")}</span></div>`).join("") || `<div class="li muted small">Ninguém recebeu acesso global. Os administradores da igreja já têm estrutura e números.</div>`}</div>`;
    body.querySelector("#new").onclick = async () => {
      const ppl = [...(await people()).values()].sort((x, y) => x.display_name.localeCompare(y.display_name));
      const s = sheet(`<h3>Conceder acesso</h3><label class="fld">Pessoa (precisa ser desta igreja)<select id="u">${ppl.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join("")}</select></label>
        <label class="fld">Função (opcional)<input id="lv" maxlength="60" placeholder="Ex.: Liderança regional"></label>
        <div class="fld">Pode<div class="stack" style="gap:8px">${ACTS.map((x) => `<label class="li"><span class="grow"><span class="t">${x[1]}</span><span class="s">${x[2]}</span></span><input type="checkbox" value="${x[0]}" ${x[0] === "consolidated" ? "checked" : ""}></label>`).join("")}</div></div>
        <div class="row gap-s mt"><button class="btn grow" id="ok">Conceder</button></div>`);
      s.el.querySelector("#ok").onclick = async (ev) => {
        const acts = [...s.el.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value); if (!acts.length) return toast("Marque ao menos uma permissão.");
        busy(ev.currentTarget); const x = await sb.rpc("org_scope_set", { p_org: org(), p_user: s.el.querySelector("#u").value, p_level: s.el.querySelector("#lv").value, p_actions: acts });
        if (x.error) { busy(ev.currentTarget, false); return toast(errText(x.error)); } s.close(); toast("Acesso concedido."); draw();
      };
    };
    body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog("Retirar este acesso? Vale na hora.", "Retirar", true))) return; busy(b); const x = await sb.rpc("org_scope_remove", { p_id: b.dataset.rm }); if (x.error) { busy(b, false); return toast(errText(x.error)); } toast("Acesso retirado."); draw(); }));
  }

  // ---------------------------------------------------------------- histórico
  async function hisTab(body) {
    const r = await sb.rpc("org_inst_history", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    body.innerHTML = `<p class="small muted">Últimas 100 mudanças de estrutura, convites e acessos.</p><div class="list">${r.data.map((h) => `<div class="li col stack" style="align-items:stretch"><div class="row between" style="gap:8px;flex-wrap:wrap"><b>${esc(ACTION_TXT[h.entity === "invite" ? "invite_" + h.action : h.action] || h.action)}</b><span class="small muted">${fmtWhen(h.at)}</span></div>${h.detail?.name ? `<span class="small muted">${esc(h.detail.name)}</span>` : ""}${h.detail?.actions ? `<span class="small muted">${h.detail.actions.map((x) => esc(ACT_LABEL[x] || x)).join(", ")}</span>` : ""}</div>`).join("") || empty("clock", "Nenhuma mudança registrada")}</div>`;
  }
  draw();
}
