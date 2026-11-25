// Financeiro: resumo, lançamentos (receitas, despesas, transferências), aprovação, baixa, estorno, orçamento e cadastros.
// Tudo passa por funções do banco que conferem a permissão; aqui só se escolhe o que mostrar.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, pickFile } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtDay, iso, pickPerson } from "../lib/mod-ui.js";

export function register(route) { route("/financeiro", (p, el, a) => page(el, a)); }

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-08-financeiro.sql</b> no SQL Editor do Supabase.</div>`;
const miss = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (s) => { const t = String(s ?? "").trim().replace(/[R$\s]/g, ""); if (!t) return NaN; return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };
const tag = (t, c = "none") => `<span class="ptag ${c}">${esc(t)}</span>`;
const KIND = { income: "Receita", expense: "Despesa", transfer: "Transferência" };
const METHOD = { cash: "Dinheiro", pix: "Pix", card: "Cartão", transfer: "Transferência bancária", boleto: "Boleto", check: "Cheque", other: "Outra" };
const ACC = { cash: "Caixa", bank: "Conta bancária", digital: "Conta digital" };
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ST = [["", "Todos"], ["open", "Em aberto"], ["overdue", "Atrasados"], ["awaiting", "Aguardando aprovação"], ["settled", "Baixados"], ["cancelled", "Cancelados"]];

async function page(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Financeiro")}${spinner()}`;
  if (!org) { el.innerHTML = `${head("Financeiro")}${empty("lock", "Você não tem acesso a esta área.")}`; return; }
  const r = await sb.rpc("fin_catalog", { p_org: org }); if (!alive()) return;
  if (r.error) return fail(el, "Financeiro", r.error);
  let cat = r.data; const can = () => cat.can;
  let tab = can().view ? "resumo" : "lanc", period = "month", f = { status: "", kind: "", q: "" }, bYear = new Date().getFullYear(), bMonth = null;
  const reload = async () => { const x = await sb.rpc("fin_catalog", { p_org: org }); if (x.error) return toast(errText(x.error)); cat = x.data; };
  const shell = () => {
    const tabs = [[can().view, "resumo", "Resumo"], [true, "lanc", "Lançamentos"], [can().view, "orc", "Orçamento"], [can().manage, "cad", "Cadastros"]].filter((t) => t[0]);
    el.innerHTML = `${head("Financeiro")}<nav class="tabs">${tabs.map((t) => `<button class="${tab === t[1] ? "on" : ""}" data-t="${t[1]}">${t[2]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    return el.querySelector("#body");
  };
  const draw = async () => {
    const body = shell();
    const go = tab === "resumo" ? resumo : tab === "lanc" ? lanc : tab === "orc" ? orcamento : cadastros;
    await go(body);
  };

  // ------------------------------------------------------------ resumo
  const range = () => {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    if (period === "last") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (period === "year") return [`${y}-01-01`, iso(n)];
    return [iso(new Date(y, m, 1)), iso(n)];
  };
  async function resumo(body) {
    const [from, to] = range();
    const x = await sb.rpc("fin_reports", { p_org: org, p_from: from, p_to: to }); if (!alive()) return;
    if (x.error) { body.innerHTML = `<div class="card small">${esc(errText(x.error))}</div>`; return; }
    const d = x.data, t = d.totals, p = d.pending, res = Number(t.income) - Number(t.expense);
    const bars = (rows, total) => rows.map((c) => `<div class="mb"><div class="row between small"><span>${esc(c.name)}</span><b>${brl(c.total)}</b></div><div class="bar" aria-hidden="true"><i style="width:${total ? Math.max(2, Math.round((Number(c.total) / total) * 100)) : 0}%"></i></div></div>`).join("") || `<p class="small muted">Nada no período.</p>`;
    body.innerHTML = `<div class="chips mb">${[["month", "Este mês"], ["last", "Mês passado"], ["year", "Este ano"]].map(([k, l]) => `<button class="chip ${period === k ? "on" : ""}" data-p="${k}">${l}</button>`).join("")}</div>
      <p class="small muted mb">Valores já pagos ou recebidos de ${fmtDay(from)} a ${fmtDay(to)}.</p>
      <div class="mc-tiles"><div class="mc-tile"><b>${brl(t.income)}</b><span>Receitas</span></div><div class="mc-tile"><b>${brl(t.expense)}</b><span>Despesas</span></div>
        <div class="mc-tile"><b>${res < 0 ? "−" : ""}${brl(Math.abs(res))}</b><span>${res < 0 ? "Resultado (déficit)" : "Resultado (sobra)"}</span></div><div class="mc-tile"><b>${brl(d.balances.reduce((s, b) => s + Number(b.balance), 0))}</b><span>Saldo total das contas</span></div></div>
      <h3 class="mt">Pendências</h3><div class="list">
        <button class="li" data-go="payable"><span class="grow"><span class="t">A pagar: ${brl(p.payable)}</span><span class="s">${p.payable_count} lançamento${p.payable_count === 1 ? "" : "s"}${Number(p.payable_overdue) ? ` · ${brl(p.payable_overdue)} atrasado` : ""}</span></span>${icon("chevronRight", "chev")}</button>
        <button class="li" data-go="receivable"><span class="grow"><span class="t">A receber: ${brl(p.receivable)}</span><span class="s">${p.receivable_count} lançamento${p.receivable_count === 1 ? "" : "s"}${Number(p.receivable_overdue) ? ` · ${brl(p.receivable_overdue)} atrasado` : ""}</span></span>${icon("chevronRight", "chev")}</button>
        ${p.awaiting_approval ? `<button class="li" data-go="awaiting"><span class="grow"><span class="t">${p.awaiting_approval} despesa${p.awaiting_approval === 1 ? "" : "s"} aguardando aprovação</span><span class="s">Só podem ser pagas depois de aprovadas</span></span>${icon("chevronRight", "chev")}</button>` : ""}</div>
      <h3 class="mt">Saldo por conta</h3><div class="list">${d.balances.map((b) => `<div class="li"><span class="grow"><span class="t">${esc(b.name)}${b.active ? "" : " (desativada)"}</span></span><b>${brl(b.balance)}</b></div>`).join("")}</div>
      <h3 class="mt">Receitas por categoria</h3><div class="card">${bars(d.income_by_category, Number(t.income))}</div>
      <h3 class="mt">Despesas por categoria</h3><div class="card">${bars(d.expense_by_category, Number(t.expense))}</div>
      ${d.expense_by_cost_center.some((c) => c.name !== "Sem centro de custo") ? `<h3 class="mt">Despesas por centro de custo</h3><div class="card">${bars(d.expense_by_cost_center, Number(t.expense))}</div>` : ""}
      ${d.income_by_campaign.length ? `<h3 class="mt">Campanhas e destinações</h3><div class="card">${bars(d.income_by_campaign, Number(t.income))}</div>` : ""}
      <h3 class="mt">Fluxo de caixa por mês</h3><div class="list">${d.flow.map((m) => `<div class="li col stack" style="align-items:stretch"><div class="row between"><b>${MONTHS[Number(m.month.slice(5)) - 1]}/${m.month.slice(0, 4)}</b><b>${brl(Number(m.income || 0) - Number(m.expense || 0))}</b></div><span class="small muted">Entrou ${brl(m.income || 0)} · Saiu ${brl(m.expense || 0)}</span></div>`).join("") || `<div class="li muted small">Sem movimentação no período.</div>`}</div>`;
    body.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { period = b.dataset.p; draw(); }));
    body.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { const g = b.dataset.go; f = { status: g === "awaiting" ? "awaiting" : "open", kind: g === "payable" ? "expense" : g === "receivable" ? "income" : "", q: "" }; tab = "lanc"; draw(); }));
  }

  // ------------------------------------------------------------ lançamentos
  async function lanc(body) {
    const filter = { status: f.status || null, kind: f.kind || null, q: f.q || null, limit: 200 };
    body.innerHTML = `<div class="row between mb gap-s" style="flex-wrap:wrap">${can().entry ? `<button class="btn primary sm" id="new">${icon("plus")} Novo lançamento</button>` : "<span></span>"}<button class="btn ghost sm" id="csv">${icon("download")} Exportar CSV</button></div>
      <div class="chips mb">${ST.map(([k, l]) => `<button class="chip ${f.status === k ? "on" : ""}" data-s="${k}">${l}</button>`).join("")}</div>
      <div class="chips mb">${[["", "Tudo"], ["income", "Receitas"], ["expense", "Despesas"], ["transfer", "Transferências"]].map(([k, l]) => `<button class="chip ${f.kind === k ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
      <input class="psearch mb" id="q" type="search" placeholder="Buscar pela descrição" aria-label="Buscar lançamento" value="${attr(f.q)}"><div id="rows">${spinner()}</div>`;
    body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { f.status = b.dataset.s; draw(); }));
    body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { f.kind = b.dataset.k; draw(); }));
    let t; body.querySelector("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 350); };
    if (body.querySelector("#new")) body.querySelector("#new").onclick = () => form(null, () => draw());
    let rows = [];
    const load = async () => {
      const box = body.querySelector("#rows"); if (!box) return;
      const x = await sb.rpc("fin_entries_list", { p_org: org, p_filter: { ...filter, q: f.q || null } }); if (!alive() || !body.contains(box)) return;
      if (x.error) { box.innerHTML = `<div class="card small">${esc(errText(x.error))}</div>`; return; }
      rows = x.data;
      box.innerHTML = `<div class="list">${rows.map((e) => `<button class="li col stack" data-id="${e.id}" style="align-items:stretch"><div class="row between"><b>${esc(e.description)}</b><b>${e.kind === "income" ? "+" : e.kind === "expense" ? "−" : "⇄"} ${brl(e.amount)}</b></div>
        <span class="small muted">${KIND[e.kind]}${e.category ? ` · ${esc(e.category)}` : ""}${e.kind === "transfer" ? ` · ${esc(e.account)} → ${esc(e.to_account)}` : e.account ? ` · ${esc(e.account)}` : ""}</span>
        <span class="row gap-s" style="flex-wrap:wrap"><span class="small muted">${e.status === "settled" ? `${e.kind === "income" ? "Recebido" : e.kind === "expense" ? "Pago" : "Feito"} em ${fmtDay(e.paid_at)}` : `Vence em ${fmtDay(e.due_date)}`}</span>
          ${e.overdue ? tag("Atrasado", "st-rejected") : ""}${e.status === "open" && e.approval === "pending" ? tag("Aguardando aprovação", "st-pending") : ""}${e.status === "cancelled" ? tag(e.approval === "rejected" ? "Recusada" : "Cancelado", "st-rejected") : ""}${e.installments ? tag(`${e.series_kind === "recurring" ? "Mensal" : "Parcela"} ${e.installment}/${e.installments}`) : ""}${e.has_receipt ? tag("Comprovante") : ""}${e.anonymous ? tag("Anônima") : ""}</span></button>`).join("") || empty("list", "Nenhum lançamento com esses filtros")}</div>${rows.length >= 200 ? `<p class="small muted mt">Mostrando os 200 mais recentes. Use os filtros para refinar.</p>` : ""}`;
      box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => detail(b.dataset.id, () => draw())));
    };
    body.querySelector("#csv").onclick = () => {
      if (!rows.length) return toast("Não há lançamentos para exportar.");
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const stl = { open: "Em aberto", settled: "Baixado", cancelled: "Cancelado" };
      const lines = [["Tipo", "Descrição", "Valor", "Situação", "Vencimento", "Baixa", "Categoria", "Conta", "Conta destino", "Centro de custo", "Campanha", "Forma", "Aprovação"].map(cell).join(";")]
        .concat(rows.map((e) => [KIND[e.kind], e.description, Number(e.amount).toFixed(2).replace(".", ","), stl[e.status], e.due_date, e.paid_at || "", e.category || "", e.account || "", e.to_account || "", e.cost_center || "", e.campaign || "", METHOD[e.method] || "", { none: "", pending: "Pendente", approved: "Aprovada", rejected: "Recusada" }[e.approval]].map(cell).join(";")));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })); a.download = `lancamentos-${iso(new Date())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    await load();
  }

  async function detail(id, again) {
    const s = sheet(spinner());
    const x = await sb.rpc("fin_entry_get", { p_id: id }); if (x.error) { s.close(); return toast(errText(x.error)); }
    const { entry: e, history, can_decide } = x.data, open = e.status === "open";
    const line = (l, v) => (v ? `<div class="row between small" style="gap:12px"><span class="muted">${l}</span><span style="text-align:right">${v}</span></div>` : "");
    const hist = history.map((h) => `<div class="small"><b>${esc(HACT[h.action] || h.action)}</b> · ${h.by ? esc(h.by) + " · " : ""}${new Date(h.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${h.reason ? `<br><span class="muted">${esc(h.reason)}</span>` : ""}</div>`).join("");
    s.el.innerHTML = `<div class="grab"></div><h3>${esc(e.description)}</h3><p style="font-size:22px;margin:0 0 8px"><b>${e.kind === "income" ? "+" : e.kind === "expense" ? "−" : ""} ${brl(e.amount)}</b></p>
      <div class="card" style="display:flex;flex-direction:column;gap:6px">
        ${line("Tipo", KIND[e.kind])}${line("Situação", { open: e.overdue ? "Em aberto (atrasado)" : "Em aberto", settled: "Baixado", cancelled: "Cancelado" }[e.status])}
        ${line("Vencimento", fmtDay(e.due_date))}${line("Baixa", e.paid_at ? fmtDay(e.paid_at) : "")}${line("Categoria", esc(e.category || ""))}${line("Conta", esc(e.account || ""))}${line("Conta destino", esc(e.to_account || ""))}
        ${line("Centro de custo", esc(e.cost_center || ""))}${line("Campanha", esc(e.campaign || ""))}${line("Forma", METHOD[e.method] || "")}
        ${e.kind === "income" ? line("Contribuinte", e.anonymous ? "Anônima" : e.donor_hidden ? "Identificado (oculto para o seu acesso)" : esc([e.person, e.counterparty].filter(Boolean).join(" · "))) : line("Fornecedor", esc(e.counterparty || ""))}
        ${e.approval !== "none" ? line("Aprovação", { pending: "Aguardando", approved: "Aprovada", rejected: "Recusada" }[e.approval]) : ""}${line("Observações", esc(e.notes || ""))}${e.cancel_reason ? line("Motivo do cancelamento", esc(e.cancel_reason)) : ""}
        ${e.installments ? line(e.series_kind === "recurring" ? "Recorrência" : "Parcelamento", `${e.installment} de ${e.installments}`) : ""}
        ${e.receipt_path ? `<button class="btn ghost sm" id="rec" style="align-self:flex-start">${icon("file")} Ver comprovante</button>` : ""}</div>
      <div class="row gap-s mt" style="flex-wrap:wrap">
        ${open && can().entry && !(e.kind === "expense" && e.approval === "pending") ? `<button class="btn primary sm" id="pay">${e.kind === "income" ? "Marcar como recebido" : "Marcar como pago"}</button>` : ""}
        ${can_decide ? `<button class="btn primary sm" id="ap">Aprovar</button><button class="btn ghost sm" id="rj">Recusar</button>` : ""}
        ${open && can().entry ? `<button class="btn ghost sm" id="ed">Editar</button>` : ""}
        ${(open && can().entry) || (e.status === "settled" && can().manage) ? `<button class="btn ghost sm" id="cn">${e.status === "settled" ? "Estornar (cancelar)" : "Cancelar"}</button>` : ""}</div>
      ${e.kind === "expense" && e.approval === "pending" && !can_decide ? `<p class="small muted mt">Esta despesa só pode ser paga depois de aprovada por outra pessoa.${can().approve ? " Quem lançou ou alterou não aprova a própria despesa." : ""}</p>` : ""}
      <h4 class="mt">Histórico</h4><div class="card" style="display:flex;flex-direction:column;gap:8px">${hist || `<span class="small muted">Sem registros.</span>`}</div>`;
    const q = (k) => s.el.querySelector(k), done = () => { s.close(); again(); };
    if (q("#rec")) q("#rec").onclick = async () => { const u = await sb.storage.from("private").signedUrl(e.receipt_path, 600); if (u.data?.url) window.open(u.data.url, "_blank", "noopener"); else toast("Não foi possível abrir o comprovante."); };
    if (q("#ed")) q("#ed").onclick = () => { s.close(); form(e, again); };
    if (q("#pay")) q("#pay").onclick = () => { s.close(); settle(e, again); };
    if (q("#ap")) q("#ap").onclick = async (ev) => { const b = ev.currentTarget; busy(b); const r = await sb.rpc("fin_entry_decide", { p_id: e.id, p_decision: "approve", p_reason: null, p_series: !!(e.series_id && q("#ser")?.checked) }); busy(b, false); if (r.error) return toast(errText(r.error)); toast("Despesa aprovada."); done(); };
    if (q("#rj")) q("#rj").onclick = () => reason("Recusar despesa", "Motivo da recusa", "Recusar", async (m) => { const r = await sb.rpc("fin_entry_decide", { p_id: e.id, p_decision: "reject", p_reason: m, p_series: false }); if (r.error) return toast(errText(r.error)); toast("Despesa recusada."); done(); return true; });
    if (q("#cn")) q("#cn").onclick = () => reason(e.status === "settled" ? "Estornar lançamento" : "Cancelar lançamento", "Motivo (fica no histórico)", e.status === "settled" ? "Estornar" : "Cancelar", async (m, series) => {
      const r = await sb.rpc("fin_entry_cancel", { p_id: e.id, p_reason: m, p_series: series }); if (r.error) return toast(errText(r.error)); toast(r.data.count > 1 ? `${r.data.count} lançamentos cancelados.` : "Lançamento cancelado."); done(); return true;
    }, e.series_id && open);
    if (can_decide && e.series_id) q("#ap")?.insertAdjacentHTML("beforebegin", `<label class="small row gap-s" style="width:100%"><input type="checkbox" id="ser"> Aprovar também as outras parcelas pendentes</label>`);
  }
  const HACT = { create: "Lançado", create_settled: "Lançado e baixado", update: "Alterado", settle: "Baixado", approve: "Aprovado", reject: "Recusado", cancel: "Cancelado", reverse: "Estornado", seed: "Cadastros iniciais" };
  function reason(title, label, ok, run, series = false) {
    const s = sheet(`<h3>${esc(title)}</h3><label class="fld">${esc(label)}<textarea id="m" rows="3" maxlength="300"></textarea></label>${series ? `<label class="small row gap-s"><input type="checkbox" id="ser"> Cancelar também as parcelas seguintes em aberto</label>` : ""}<button class="btn danger block mt" id="go">${esc(ok)}</button>`);
    s.el.querySelector("#go").onclick = async (ev) => { const m = s.el.querySelector("#m").value.trim(); if (!m) return toast("Informe o motivo."); const b = ev.currentTarget; busy(b); const r = await run(m, !!s.el.querySelector("#ser")?.checked); busy(b, false); if (r) s.close(); };
  }
  function settle(e, again) {
    const accs = cat.accounts.filter((a) => a.active);
    const s = sheet(`<h3>${e.kind === "income" ? "Marcar como recebido" : "Marcar como pago"}</h3><p class="small muted">${esc(e.description)} · ${brl(e.amount)}</p>
      <label class="fld">Data<input id="d" type="date" value="${iso(new Date())}" max="${iso(new Date())}"></label>
      <label class="fld">Conta<select id="a">${accs.map((a) => `<option value="${a.id}" ${a.id === (e.account_id || "") ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="fld">Forma<select id="m"><option value="">Manter</option>${Object.entries(METHOD).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label><button class="btn block mt" id="go">Confirmar</button>`);
    s.el.querySelector("#go").onclick = async (ev) => { const b = ev.currentTarget; busy(b); const r = await sb.rpc("fin_entry_settle", { p_id: e.id, p_date: s.el.querySelector("#d").value, p_account: s.el.querySelector("#a").value, p_method: s.el.querySelector("#m").value || null }); busy(b, false); if (r.error) return toast(errText(r.error)); s.close(); toast("Baixa registrada."); again(); };
  }

  // ------------------------------------------------------------ formulário de lançamento
  function form(e, again) {
    const v = e || { kind: "expense", due_date: iso(new Date()) }; let kind = v.kind, person = v.person_id ? { id: v.person_id, name: v.person || "" } : null, receipt = null;
    const opts = (rows, sel, none) => `${none ? `<option value="">${none}</option>` : ""}${rows.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}`;
    const accs = cat.accounts.filter((a) => a.active || a.id === v.account_id), ccs = cat.cost_centers.filter((a) => a.active || a.id === v.cost_center_id), camps = cat.campaigns.filter((a) => a.active || a.id === v.campaign_id);
    const thr = cat.settings.approval_threshold;
    const s = sheet(`<h3>${e ? "Editar lançamento" : "Novo lançamento"}</h3>
      ${e ? "" : `<div class="chips mb" id="kinds">${Object.entries(KIND).map(([k, l]) => `<button class="chip ${kind === k ? "on" : ""}" data-k="${k}" type="button">${l}</button>`).join("")}</div>`}
      <label class="fld">Descrição<input id="desc" maxlength="160" value="${attr(v.description || "")}"></label>
      <label class="fld">Valor (R$)<input id="amt" inputmode="decimal" placeholder="0,00" value="${v.amount != null ? String(v.amount).replace(".", ",") : ""}"></label>
      <div id="std">
        <label class="fld">Categoria<select id="cat"></select></label>
        <label class="fld" id="fcp"><span id="cpl">Fornecedor (opcional)</span><input id="cp" maxlength="120" value="${attr(v.counterparty || "")}"></label>
        <div id="donor" hidden><div class="small muted mb">Contribuição anônima não pede nome. Identificar só é possível com a permissão de ver contribuintes.</div>
          ${cat.can.donors ? `<label class="small row gap-s mb"><input type="checkbox" id="anon" ${v.anonymous ? "checked" : ""}> Contribuição anônima</label><div class="row gap-s mb"><button class="btn ghost sm" id="pp" type="button">${icon("user")} <span id="ppn">${person ? esc(person.name || "Pessoa escolhida") : "Escolher pessoa cadastrada"}</span></button></div>` : `<label class="small row gap-s mb"><input type="checkbox" id="anon" checked disabled> Contribuição anônima</label>`}</div>
        <div class="row gap-s"><label class="fld grow"><span id="dl">Vencimento</span><input id="due" type="date" value="${v.due_date || ""}"></label><label class="fld grow">Conta<select id="acc">${opts(accs, v.account_id, "Escolher depois")}</select></label></div>
        <label class="fld">Centro de custo (opcional)<select id="cc">${opts(ccs, v.cost_center_id, "Nenhum")}</select></label>
        <label class="fld" id="fcamp">Campanha ou destinação (opcional)<select id="camp">${opts(camps, v.campaign_id, "Nenhuma")}</select></label>
        <label class="fld">Forma<select id="met"><option value="">Não informar</option>${Object.entries(METHOD).map(([k, l]) => `<option value="${k}" ${k === v.method ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${e ? "" : `<label class="small row gap-s mb"><input type="checkbox" id="paid"> <span id="pdl">Já foi pago</span></label><label class="fld" id="fpd" hidden>Data da baixa<input id="pd" type="date" value="${iso(new Date())}" max="${iso(new Date())}"></label>
        <div id="rep"><div class="row gap-s"><label class="fld grow">Repetir<select id="rk"><option value="installment">Parcelado (divide o valor)</option><option value="recurring">Todo mês (mesmo valor)</option></select></label><label class="fld grow">Vezes<input id="rn" type="number" min="1" max="60" value="1"></label></div></div>`}
        <div class="fld">Comprovante (opcional, fica em área privada)<div class="row gap-s"><button class="btn ghost sm" id="rc" type="button">${icon("file")} <span id="rcn">${v.receipt_path ? "Trocar comprovante" : "Anexar comprovante"}</span></button></div></div>
        <label class="fld">Observações<textarea id="nt" rows="2" maxlength="1000">${esc(v.notes || "")}</textarea></label></div>
      <div id="trf" hidden><div class="row gap-s"><label class="fld grow">De<select id="from">${opts(accs, "")}</select></label><label class="fld grow">Para<select id="to">${opts(accs, accs[1]?.id || "")}</select></label></div><label class="fld">Data<input id="td" type="date" value="${iso(new Date())}" max="${iso(new Date())}"></label></div>
      <p class="small muted" id="hint"></p><button class="btn block mt" id="ok">Salvar</button>`);
    const q = (k) => s.el.querySelector(k);
    const paint = () => {
      const tr = kind === "transfer", inc = kind === "income";
      q("#std").hidden = tr; q("#trf").hidden = !tr; q("#donor").hidden = !inc; q("#fcamp").hidden = !inc; q("#fcp").hidden = inc && true;
      q("#cat").innerHTML = opts(cat.categories.filter((c) => c.kind === kind && (c.active || c.id === v.category_id)), v.category_id, "Escolher");
      q("#dl").textContent = inc ? "Data prevista" : "Vencimento"; if (q("#pdl")) q("#pdl").textContent = inc ? "Já foi recebido" : "Já foi pago"; q("#cpl").textContent = "Fornecedor (opcional)";
      q("#hint").textContent = kind === "expense" && thr != null ? `Despesas a partir de ${brl(thr)} precisam ser aprovadas por outra pessoa antes de serem pagas.` : tr ? "Transferência move o saldo entre duas contas e é registrada na hora." : "";
      if (q("#rep")) q("#rep").hidden = q("#paid")?.checked;
      if (q("#paid")) q("#paid").onchange = () => { q("#fpd").hidden = !q("#paid").checked; q("#rep").hidden = q("#paid").checked; };
    };
    s.el.querySelectorAll("#kinds [data-k]").forEach((b) => (b.onclick = () => { kind = b.dataset.k; s.el.querySelectorAll("#kinds .chip").forEach((c) => c.classList.toggle("on", c === b)); paint(); }));
    paint();
    if (q("#pp")) q("#pp").onclick = () => pickPerson("Escolher pessoa", (p) => { person = p; q("#ppn").textContent = p.name; if (q("#anon")) q("#anon").checked = false; });
    if (q("#anon") && !q("#anon").disabled) q("#anon").onchange = () => { if (q("#anon").checked) { person = null; q("#ppn").textContent = "Escolher pessoa cadastrada"; } };
    q("#rc").onclick = async () => {
      const file = await pickFile("image/*,application/pdf"); if (!file) return;
      if (file.size > 10 * 1024 * 1024) return toast("O arquivo é grande demais (máximo 10 MB).");
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
      const path = `fin/${org}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await sb.storage.from("private").upload(path, file); if (up.error) return toast("Não foi possível enviar o comprovante.");
      receipt = path; q("#rcn").textContent = "Comprovante anexado"; toast("Comprovante anexado.");
    };
    q("#ok").onclick = async (ev) => {
      const b = ev.currentTarget, tr = kind === "transfer", amount = num(q("#amt").value);
      if (!q("#desc").value.trim()) return toast("Descreva o lançamento."); if (!(amount > 0)) return toast("Informe um valor maior que zero.");
      let p;
      if (tr) p = { kind, description: q("#desc").value, amount, account_id: q("#from").value, to_account_id: q("#to").value, paid_at: q("#td").value, due_date: q("#td").value };
      else {
        if (!q("#cat").value) return toast("Escolha a categoria."); if (!q("#due").value) return toast("Informe a data.");
        const paid = q("#paid")?.checked; if (paid && !q("#acc").value) return toast("Escolha a conta usada.");
        const anon = kind === "income" && (q("#anon")?.checked ?? false);
        p = { kind, description: q("#desc").value, amount, category_id: q("#cat").value, counterparty: kind === "income" ? null : q("#cp").value, account_id: q("#acc").value || null, cost_center_id: q("#cc").value || null,
          campaign_id: kind === "income" ? q("#camp").value || null : null, method: q("#met").value || null, due_date: q("#due").value, paid_at: paid ? q("#pd").value : null, notes: q("#nt").value, receipt_path: receipt,
          anonymous: anon, person_id: kind === "income" && !anon ? person?.id || null : null, installments: paid ? 1 : Number(q("#rn")?.value || 1), series_kind: q("#rk")?.value || "installment" };
      }
      busy(b); const r = await sb.rpc("fin_entry_save", { p_org: org, p_id: e?.id || null, p }); busy(b, false);
      if (r.error) return toast(errText(r.error));
      s.close(); toast(r.data.count > 1 ? `${r.data.count} lançamentos criados.` : r.data.approval === "pending" ? "Lançado. Aguarda aprovação para ser pago." : "Lançamento salvo."); again();
    };
  }

  // ------------------------------------------------------------ orçamento
  async function orcamento(body) {
    const x = await sb.rpc("fin_budget_report", { p_org: org, p_year: bYear, p_month: bMonth }); if (!alive()) return;
    if (x.error) { body.innerHTML = `<div class="card small">${esc(errText(x.error))}</div>`; return; }
    const y0 = new Date().getFullYear();
    body.innerHTML = `<div class="row gap-s mb"><label class="fld grow" style="margin:0">Ano<select id="y">${[y0 - 1, y0, y0 + 1].map((y) => `<option ${y === bYear ? "selected" : ""}>${y}</option>`).join("")}</select></label>${can().manage ? `<button class="btn primary sm" id="add" style="align-self:end">${icon("plus")} Definir valor</button>` : ""}</div>
      <div class="chips mb"><button class="chip ${bMonth == null ? "on" : ""}" data-m="">Ano inteiro</button>${MONTHS.map((m, i) => `<button class="chip ${bMonth === i + 1 ? "on" : ""}" data-m="${i + 1}">${m}</button>`).join("")}</div>
      <p class="small muted">Realizado = só o que já foi pago ou recebido. ${bMonth == null ? "Mostra os valores definidos para o ano inteiro." : "Mostra os valores definidos para este mês."}</p>
      <div class="list">${x.data.map((l) => {
        const pl = Number(l.planned), ac = Number(l.actual), pct = pl ? Math.round((ac / pl) * 100) : ac ? 999 : 0, inc = l.kind === "income", diff = ac - pl;
        const note = inc ? (diff >= 0 ? `Meta batida (+${brl(diff)})` : `Faltam ${brl(-diff)} para a meta`) : diff > 0 ? `Acima do orçado em ${brl(diff)}` : `Dentro do orçado (sobram ${brl(-diff)})`;
        return `<div class="li col stack" style="align-items:stretch"><div class="row between"><b>${esc(l.category || l.cost_center)}${l.category && l.cost_center ? ` · ${esc(l.cost_center)}` : ""}</b>${tag(inc ? "Receita" : "Despesa")}</div>
          <div class="row between small"><span>Orçado ${brl(pl)}</span><span>Realizado ${brl(ac)}</span></div><div class="bar" aria-hidden="true"><i style="width:${Math.min(100, pct)}%"></i></div>
          <div class="row between small"><span class="muted">${pct >= 999 ? "—" : pct + "%"} · ${note}</span>${can().manage ? `<button class="btn ghost sm" data-e="${l.id}" data-c="${l.category_id || ""}" data-cc="${l.cost_center_id || ""}" data-v="${pl}">Alterar</button>` : ""}</div></div>`;
      }).join("") || empty("list", "Nenhum orçamento definido", can().manage ? "Use “Definir valor” para criar o primeiro." : "")}</div>`;
    body.querySelector("#y").onchange = (e) => { bYear = Number(e.target.value); draw(); };
    body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { bMonth = b.dataset.m ? Number(b.dataset.m) : null; draw(); }));
    const set = (c, cc, val) => { const lbl = cat.categories.find((k) => k.id === c)?.name || cat.cost_centers.find((k) => k.id === cc)?.name; return budgetForm(lbl, c, cc, val); };
    body.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => set(b.dataset.c || null, b.dataset.cc || null, b.dataset.v)));
    if (body.querySelector("#add")) body.querySelector("#add").onclick = () => set(null, null, "");
  }
  function budgetForm(label, c, cc, val) {
    const fixed = !!(c || cc);
    const s = sheet(`<h3>${label ? esc(label) : "Definir valor do orçamento"}</h3><p class="small muted">${bMonth ? `${MONTHS[bMonth - 1]}/${bYear}` : `Ano de ${bYear}`}</p>
      ${fixed ? "" : `<label class="fld">Categoria<select id="c"><option value="">Escolher</option>${cat.categories.filter((k) => k.active).map((k) => `<option value="${k.id}">${k.kind === "income" ? "Receita" : "Despesa"} · ${esc(k.name)}</option>`).join("")}</select></label><label class="fld">Centro de custo (opcional)<select id="cc"><option value="">Nenhum</option>${cat.cost_centers.filter((k) => k.active).map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></label>`}
      <label class="fld">Valor orçado (R$)<input id="v" inputmode="decimal" value="${val ? String(val).replace(".", ",") : ""}"></label>
      <div class="row gap-s mt">${fixed ? `<button class="btn ghost danger" id="rm">Remover</button>` : ""}<button class="btn grow" id="ok">Salvar</button></div>`);
    const q = (k) => s.el.querySelector(k);
    const run = async (amount, b) => { const cc2 = fixed ? cc : q("#cc").value || null, c2 = fixed ? c : q("#c").value || null; busy(b); const r = await sb.rpc("fin_budget_save", { p_org: org, p: { year: bYear, month: bMonth, category_id: c2, cost_center_id: cc2, amount } }); busy(b, false); if (r.error) return toast(errText(r.error)); s.close(); toast(amount == null ? "Valor removido." : "Orçamento salvo."); draw(); };
    q("#ok").onclick = (ev) => { const a = num(q("#v").value); if (!(a >= 0)) return toast("Informe um valor válido."); if (!fixed && !q("#c").value && !q("#cc").value) return toast("Escolha a categoria ou o centro de custo."); run(a, ev.currentTarget); };
    if (q("#rm")) q("#rm").onclick = async (ev) => { if (await confirmDialog("Remover este valor do orçamento?", "Remover", true)) run(null, ev.currentTarget); };
  }

  // ------------------------------------------------------------ cadastros e regras
  async function cadastros(body) {
    const row = (type, it, sub) => `<div class="li"><span class="grow"><span class="t">${esc(it.name)}${it.active ? "" : " (desativado)"}</span><span class="s">${sub}</span></span><button class="btn ghost sm" data-t="${type}" data-id="${it.id}">Editar</button></div>`;
    const cats = (k) => cat.categories.filter((c) => c.kind === k);
    body.innerHTML = `<h3>Regra de aprovação</h3><div class="card"><p class="small muted" style="margin-top:0">Despesas a partir deste valor só podem ser pagas depois de aprovadas por outra pessoa. Deixe vazio para não exigir aprovação.</p>
        <div class="row gap-s"><label class="fld grow" style="margin:0">Valor mínimo (R$)<input id="thr" inputmode="decimal" value="${cat.settings.approval_threshold != null ? String(cat.settings.approval_threshold).replace(".", ",") : ""}" placeholder="Sem aprovação"></label><button class="btn sm" id="thrs" style="align-self:end">Salvar</button></div></div>
      <div class="row between mt"><h3>Contas e caixas</h3><button class="btn ghost sm" data-new="account">${icon("plus")} Nova</button></div><div class="list">${cat.accounts.map((a) => row("account", a, `${ACC[a.kind]} · saldo ${brl(a.balance)}`)).join("")}</div>
      <div class="row between mt"><h3>Categorias de receita</h3><button class="btn ghost sm" data-new="category" data-kind="income">${icon("plus")} Nova</button></div><div class="list">${cats("income").map((c) => row("category", c, "Receita")).join("")}</div>
      <div class="row between mt"><h3>Categorias de despesa</h3><button class="btn ghost sm" data-new="category" data-kind="expense">${icon("plus")} Nova</button></div><div class="list">${cats("expense").map((c) => row("category", c, "Despesa")).join("")}</div>
      <div class="row between mt"><h3>Centros de custo</h3><button class="btn ghost sm" data-new="cost_center">${icon("plus")} Novo</button></div><div class="list">${cat.cost_centers.map((c) => row("cost_center", c, "Departamento ou área")).join("") || `<div class="li muted small">Nenhum centro de custo ainda.</div>`}</div>
      <div class="row between mt"><h3>Campanhas e destinações</h3><button class="btn ghost sm" data-new="campaign">${icon("plus")} Nova</button></div><div class="list">${cat.campaigns.map((c) => row("campaign", c, `Arrecadado ${brl(c.raised)}${c.goal ? ` de ${brl(c.goal)}` : ""}`)).join("") || `<div class="li muted small">Nenhuma campanha ainda.</div>`}</div>
      <h3 class="mt">Pagamento online</h3><div class="card small">Não configurado. Pix e cartão pelo app dependem de um provedor de pagamento e das credenciais da igreja, que ainda não foram conectados. Hoje as contribuições são lançadas por quem tem permissão.</div>`;
    body.querySelector("#thrs").onclick = async (ev) => { const t = body.querySelector("#thr").value.trim(), n = t ? num(t) : null; if (t && !(n >= 0)) return toast("Informe um valor válido."); const b = ev.currentTarget; busy(b); const r = await sb.rpc("fin_settings_save", { p_org: org, p: { approval_threshold: n } }); busy(b, false); if (r.error) return toast(errText(r.error)); await reload(); toast("Regra salva."); };
    const edit = (type, it, kind) => {
      const s = sheet(`<h3>${it ? "Editar" : "Novo"}</h3><label class="fld">Nome<input id="n" maxlength="80" value="${attr(it?.name || "")}"></label>
        ${type === "account" ? `<label class="fld">Tipo<select id="k">${Object.entries(ACC).map(([k, l]) => `<option value="${k}" ${k === (it?.kind || "bank") ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="fld">Saldo inicial (R$)<input id="ob" inputmode="decimal" value="${it ? String(it.opening_balance).replace(".", ",") : "0"}"></label>` : ""}
        ${type === "campaign" ? `<label class="fld">Meta (R$, opcional)<input id="g" inputmode="decimal" value="${it?.goal ? String(it.goal).replace(".", ",") : ""}"></label>` : ""}
        ${it ? `<label class="small row gap-s mb"><input type="checkbox" id="act" ${it.active ? "checked" : ""}> Ativo (desativar não apaga o histórico)</label>` : ""}<button class="btn block mt" id="ok">Salvar</button>`);
      const q = (k) => s.el.querySelector(k);
      q("#ok").onclick = async (ev) => {
        if (!q("#n").value.trim()) return toast("Informe o nome."); const b = ev.currentTarget; const ob = q("#ob") ? num(q("#ob").value) : 0; if (q("#ob") && Number.isNaN(ob)) return toast("Informe um saldo válido.");
        const g = q("#g")?.value.trim() ? num(q("#g").value) : null; if (q("#g") && q("#g").value.trim() && !(g > 0)) return toast("Informe uma meta válida.");
        busy(b); const r = await sb.rpc("fin_catalog_save", { p_org: org, p_type: type, p_id: it?.id || null, p: { name: q("#n").value, kind: q("#k")?.value || kind, opening_balance: ob, goal: g, active: q("#act") ? q("#act").checked : true } }); busy(b, false);
        if (r.error) return toast(errText(r.error)); s.close(); await reload(); toast("Salvo."); draw();
      };
    };
    const find = (type, id) => (type === "account" ? cat.accounts : type === "category" ? cat.categories : type === "cost_center" ? cat.cost_centers : cat.campaigns).find((x) => x.id === id);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => edit(b.dataset.t, find(b.dataset.t, b.dataset.id))));
    body.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => edit(b.dataset.new, null, b.dataset.kind)));
  }

  draw();
}
