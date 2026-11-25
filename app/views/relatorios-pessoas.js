// Relatórios de Pessoas (SOMOS Chamados): visão geral, perfil, evolução, família, ministérios e exportações.
// Todo número vem do servidor (agregado, com escopo e permissão validados lá). Aqui só se filtra, desenha e exporta o que está na tela.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, peopleCan, canPeople } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { buildXlsx } from "../lib/xlsx.js";
import { buildPdf } from "../lib/pdf.js";

export function register(route) {
  route("/relatorios-pessoas", (p, el, a) => page(el, a, "overview"));
  route("/relatorios-pessoas/:area", (p, el, a) => page(el, a, p.area));
}

const AREAS = [["overview", "Visão geral"], ["profile", "Perfil da comunidade"], ["evolution", "Evolução da membresia"], ["family", "Relatórios familiares"], ["ministry", "Distribuição ministerial"], ["exports", "Exportações"]];
const CLS = { member: "Membros", attender: "Frequentadores", visitor: "Visitantes", none: "Sem classificação" };
const STA = { active: "Ativas", inactive: "Inativas", pending: "Pendentes" };
const SEX = { M: "Masculino", F: "Feminino", none: "Não informado" };
const MAR = { solteiro: "Solteiro(a)", casado: "Casado(a)", divorciado: "Divorciado(a)", viuvo: "Viúvo(a)", uniao_estavel: "União estável", outro: "Outro", none: "Não informado" };
const GRAN = { day: "Por dia", week: "Por semana", month: "Por mês", year: "Por ano" };
const PRESETS = [["30d", "30 dias"], ["90d", "90 dias"], ["6m", "6 meses"], ["12m", "12 meses"], ["ytd", "Ano atual"], ["py", "Ano anterior"], ["custom", "Personalizado"]];
const CMP = { previous: "Período anterior", month: "Mês anterior", year: "Ano anterior", custom: "Outro período" };
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-03-relatorios-pessoas.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const br = (s) => (s ? s.split("-").reverse().join("/") : "");
const n1 = (v) => String(v).replace(".", ",");
const pct = (v) => (v == null ? "—" : n1(v) + "%");

// ---- filtros (ficam na memória enquanto o app estiver aberto; valem para todas as áreas, gráficos e exportações)
const DIMS = ["classification", "status", "band", "sex", "marital", "neighborhood", "city"];
const blank = () => ({ preset: "12m", from: "", to: "", compare: "previous", cfrom: "", cto: "", granularity: "month", network: "", team: "", ...Object.fromEntries(DIMS.map((d) => [d, []])) });
let F = blank(), OPT = null, OPT_ORG = "";
function range() {
  const t = new Date(), y = t.getFullYear(), back = (d) => { const x = new Date(t); x.setDate(x.getDate() - d); return iso(x); };
  const m = (k) => { const x = new Date(t); x.setMonth(x.getMonth() - k); return iso(x); };
  switch (F.preset) {
    case "30d": return [back(29), iso(t)]; case "90d": return [back(89), iso(t)]; case "6m": return [m(6), iso(t)]; case "12m": return [m(12), iso(t)];
    case "ytd": return [`${y}-01-01`, iso(t)]; case "py": return [`${y - 1}-01-01`, `${y - 1}-12-31`]; default: return [F.from || back(364), F.to || iso(t)];
  }
}
function toF() {
  const [from, to] = range(), f = { from, to, compare: F.compare, granularity: F.granularity };
  if (F.compare === "custom") { f.cfrom = F.cfrom; f.cto = F.cto; }
  for (const d of DIMS) if (F[d].length) f[d] = F[d];
  if (F.network) f.network = F.network; if (F.team) f.team = F.team;
  return f;
}
const hasFilters = () => DIMS.some((d) => F[d].length) || F.network || F.team;
function describe() {
  const o = OPT || {}, bits = [], lab = { classification: (k) => CLS[k] || k, status: (k) => STA[k] || k, sex: (k) => SEX[k] || k, marital: (k) => MAR[k] || k, band: (k) => (o.bands || []).find((b) => b.i === k)?.label || k, neighborhood: (k) => (k === "none" ? "Não informado" : k), city: (k) => (k === "none" ? "Não informado" : k) };
  const names = { classification: "Classificação", status: "Situação", band: "Faixa etária", sex: "Sexo", marital: "Estado civil", neighborhood: "Bairro", city: "Cidade" };
  for (const d of DIMS) if (F[d].length) bits.push(`${names[d]}: ${F[d].map(lab[d]).join(", ")}`);
  if (F.network) bits.push(`Ministério: ${(o.networks || []).find((x) => x.id === F.network)?.name || ""}`);
  if (F.team) bits.push(`Time: ${(o.teams || []).find((x) => x.id === F.team)?.name || ""}`);
  return bits.length ? bits.join(" · ") : "Nenhum filtro (toda a população visível)";
}
const periodText = (r) => { const p = r?.period || {}; const [a, b] = range(); return `${br(p.from || a)} a ${br(p.to || b)}`; };

// ---- desenho
const delta = (d) => {
  if (!d) return `<span class="tiny muted">sem base para comparar</span>`;
  const s = (x) => (x > 0 ? "+" : "") + x;
  if (d.pct == null) return `<span class="tiny muted">${d.abs === 0 && d.prev === 0 ? "sem movimento nos dois períodos" : `${s(d.abs)} (anterior: ${d.prev}, sem base percentual)`}</span>`;
  return `<span class="tiny muted">${d.abs > 0 ? "▲" : d.abs < 0 ? "▼" : "■"} ${s(d.abs)} (${s(d.pct).toString().replace(".", ",")}%) vs. período anterior</span>`;
};
const tile = (label, value, d, href) => { const inner = `<b>${value}</b><span>${esc(label)}</span>${d !== undefined ? delta(d) : ""}`; return href ? `<a class="mc-tile" href="${href}">${inner}</a>` : `<div class="mc-tile">${inner}</div>`; };
const bars = (items, empt = "Sem dados no filtro atual.") => items.length ? `<div class="list">${items.map((i) => `<div class="li" style="display:block"><div class="row between"><span>${esc(i.label)}</span><span class="muted small">${i.n}${i.pct != null ? ` · ${pct(i.pct)}` : ""}</span></div><div class="bar"><i style="width:${Math.max(i.pct ?? 0, i.n ? 2 : 0)}%"></i></div></div>`).join("")}</div>` : `<p class="muted small">${empt}</p>`;
function chart(title, rows, key, kind = "cols") {
  const v = rows.map((r) => r[key] || 0), max = Math.max(1, ...v), W = 320, H = 110, pad = 4, step = (W - 2 * pad) / Math.max(1, v.length);
  const lab = (r) => br(r.start);
  let g = "";
  if (kind === "line") { const pts = v.map((x, i) => `${(pad + step * (i + 0.5)).toFixed(1)},${(H - 16 - (x / max) * (H - 28)).toFixed(1)}`); g = `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${v.length === 1 ? `<circle cx="${pts[0].split(",")[0]}" cy="${pts[0].split(",")[1]}" r="3" fill="var(--accent)"/>` : ""}`; }
  else g = v.map((x, i) => `<rect x="${(pad + step * i + step * 0.15).toFixed(1)}" y="${(H - 16 - (x / max) * (H - 28)).toFixed(1)}" width="${Math.max(1.5, step * 0.7).toFixed(1)}" height="${((x / max) * (H - 28)).toFixed(1)}" rx="2" fill="var(--accent)"><title>${lab(rows[i])}: ${x}</title></rect>`).join("");
  const total = v.reduce((a, b) => a + b, 0);
  return `<div class="card"><div class="row between"><b>${esc(title)}</b><span class="tiny muted">${kind === "line" ? `máx. ${max}` : `total ${total}`}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${attr(title)}: ${v.join(", ")}" style="display:block;margin-top:8px"><line x1="0" x2="${W}" y1="${H - 16}" y2="${H - 16}" stroke="currentColor" opacity=".15"/>${g}<text x="${pad}" y="${H - 3}" font-size="9" fill="currentColor" opacity=".6">${rows.length ? lab(rows[0]) : ""}</text><text x="${W - pad}" y="${H - 3}" font-size="9" fill="currentColor" opacity=".6" text-anchor="end">${rows.length ? lab(rows[rows.length - 1]) : ""}</text></svg></div>`;
}
const head = (t) => `<div class="pagehead"><h1>${esc(t)}</h1></div><div class="mb"><a class="btn ghost sm" href="#/chamados">${icon("chevronLeft")} SOMOS Chamados</a></div>`;
const fail = (el, e) => { el.innerHTML = `${head("Relatórios de Pessoas")}${missing(e) ? SETUP : empty("lock", /forbidden/.test(e?.message || "") ? "Você não tem acesso a este relatório." : "Não foi possível carregar.", esc(errText(e)))}`; };

// ---- página
async function page(el, alive, area) {
  const org = state.org?.id; if (!AREAS.some((a) => a[0] === area)) area = "overview";
  el.innerHTML = `${head("Relatórios de Pessoas")}${spinner()}`;
  if (!OPT || OPT_ORG !== org) { const o = await sb.rpc("rp_options", { p_org: org }); if (!alive()) return; if (o.error) return fail(el, o.error); OPT = o.data; OPT_ORG = org; F = blank(); }
  const allowed = (a) => a === "exports" ? OPT.can.export || OPT.can.export_lists : OPT.areas[a];
  const tabs = AREAS.filter((a) => allowed(a[0]));
  if (!allowed(area)) area = tabs[0]?.[0];
  if (!area) { el.innerHTML = `${head("Relatórios de Pessoas")}${empty("lock", "Você não tem acesso a nenhum relatório.")}`; return; }
  el.innerHTML = `${head("Relatórios de Pessoas")}
    ${OPT.scope === "own" ? `<div class="mc-note mb">${icon("info")} Você vê apenas as pessoas dos ministérios que lidera ou supervisiona.</div>` : ""}
    <nav class="tabs" aria-label="Áreas do relatório">${tabs.map(([k, l]) => `<a href="#/relatorios-pessoas/${k}" class="${k === area ? "on" : ""}" ${k === area ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>
    <div id="flt"></div><div id="body">${spinner()}</div>`;
  const body = el.querySelector("#body");
  const reload = () => load(el, body, alive, area);
  drawFilters(el.querySelector("#flt"), area, reload);
  reload();
}

function drawFilters(box, area, reload) {
  const showPeriod = area !== "exports";
  box.innerHTML = `<div class="card" style="margin-bottom:14px">
    ${showPeriod ? `<div class="mc-chips" role="group" aria-label="Período">${PRESETS.map(([k, l]) => `<button class="chip ${F.preset === k ? "on" : ""}" data-p="${k}">${l}</button>`).join("")}</div>
    ${F.preset === "custom" ? `<div class="row gap" style="margin-top:10px"><label class="field grow"><span>De</span><input type="date" id="pf" value="${attr(range()[0])}"></label><label class="field grow"><span>Até</span><input type="date" id="pt" value="${attr(range()[1])}"></label></div>` : ""}
    ${area === "overview" || area === "evolution" ? `<div class="row gap" style="margin-top:10px">
      <label class="field grow"><span>Comparar com</span><select id="cmp">${Object.entries(CMP).map(([k, l]) => `<option value="${k}" ${F.compare === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field grow"><span>Gráficos</span><select id="gr">${Object.entries(GRAN).map(([k, l]) => `<option value="${k}" ${F.granularity === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      ${F.compare === "custom" ? `<div class="row gap"><label class="field grow"><span>Comparar de</span><input type="date" id="cf" value="${attr(F.cfrom)}"></label><label class="field grow"><span>até</span><input type="date" id="ct" value="${attr(F.cto)}"></label></div>` : ""}` : ""}` : ""}
    <div class="row between" style="margin-top:${showPeriod ? 8 : 0}px;gap:8px"><button class="btn ghost sm" id="more">${icon("sliders")} Filtros${hasFilters() ? " ativos" : ""}</button>${hasFilters() ? `<button class="btn ghost sm" id="clear">Limpar filtros</button>` : ""}</div>
    ${hasFilters() ? `<p class="tiny muted" style="margin-top:8px">${esc(describe())}</p>` : ""}</div>`;
  box.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { F.preset = b.dataset.p; if (F.preset === "custom") [F.from, F.to] = range(); drawFilters(box, area, reload); if (F.preset !== "custom") reload(); }));
  const bind = (id, fn) => { const e = box.querySelector(id); if (e) e.onchange = () => { fn(e.value); drawFilters(box, area, reload); reload(); }; };
  bind("#pf", (v) => (F.from = v)); bind("#pt", (v) => (F.to = v)); bind("#cmp", (v) => (F.compare = v)); bind("#gr", (v) => (F.granularity = v)); bind("#cf", (v) => (F.cfrom = v)); bind("#ct", (v) => (F.cto = v));
  box.querySelector("#clear")?.addEventListener("click", () => { const k = { preset: F.preset, from: F.from, to: F.to, compare: F.compare, cfrom: F.cfrom, cto: F.cto, granularity: F.granularity }; F = { ...blank(), ...k }; drawFilters(box, area, reload); reload(); });
  box.querySelector("#more").onclick = () => filterSheet(() => { drawFilters(box, area, reload); reload(); });
}

function filterSheet(done) {
  const o = OPT, groups = [["classification", "Classificação", o.classification.map((k) => [k, CLS[k] || k])], ["status", "Situação cadastral", o.status.map((k) => [k, STA[k] || k])], ["band", "Faixa etária", o.bands.map((b) => [b.i, b.label])], ["sex", "Sexo", o.sex.map((k) => [k, SEX[k] || k])], ["marital", "Estado civil", o.marital.map((k) => [k, MAR[k] || k])], ["neighborhood", "Bairro", o.neighborhood.map((k) => [k, k === "none" ? "Não informado" : k])], ["city", "Cidade", o.city.map((k) => [k, k === "none" ? "Não informado" : k])]].filter((g) => g[2].length > 1 || (g[2].length === 1 && g[0] === "status"));
  const sh = sheet(`<h2>Filtros</h2><p class="small muted">Valem para todos os indicadores, gráficos e exportações. Só aparecem opções que existem nos dados.</p>
    ${groups.map(([k, l, items]) => `<div class="field"><span>${l}</span><div class="mc-chips" style="flex-wrap:wrap" data-g="${k}">${items.map(([v, t]) => `<button type="button" class="chip ${F[k].includes(v) ? "on" : ""}" data-v="${attr(v)}" aria-pressed="${F[k].includes(v)}">${esc(t)}</button>`).join("")}</div></div>`).join("")}
    ${o.networks.length ? `<label class="field"><span>Ministério (rede)</span><select id="net"><option value="">Todos</option>${o.networks.map((n) => `<option value="${n.id}" ${F.network === n.id ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>` : ""}
    ${o.teams.length ? `<label class="field"><span>Time</span><select id="team"><option value="">Todos</option>${o.teams.map((n) => `<option value="${n.id}" ${F.team === n.id ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>` : ""}
    <div class="row gap"><button class="btn ghost grow" id="x">Limpar</button><button class="btn grow" id="ok">Aplicar</button></div>`);
  sh.el.querySelectorAll("[data-g] .chip").forEach((c) => (c.onclick = () => { const g = c.parentElement.dataset.g, v = c.dataset.v; F[g] = F[g].includes(v) ? F[g].filter((x) => x !== v) : [...F[g], v]; c.classList.toggle("on"); c.setAttribute("aria-pressed", F[g].includes(v)); }));
  sh.el.querySelector("#x").onclick = () => { for (const d of DIMS) F[d] = []; F.network = ""; F.team = ""; sh.close(); done(); };
  sh.el.querySelector("#ok").onclick = () => { F.network = sh.el.querySelector("#net")?.value || ""; F.team = sh.el.querySelector("#team")?.value || ""; sh.close(); done(); };
}

// ---- carregamento e desenho de cada área; cada uma devolve também o "modelo" usado nas exportações
async function load(el, body, alive, area) {
  body.innerHTML = spinner();
  if (area === "exports") return exportsView(body, alive);
  const org = state.org?.id, r = await sb.rpc("rp_report", { p_org: org, p_area: area, f: toF() });
  if (!alive()) return; if (r.error) { body.innerHTML = /forbidden|invalid/.test(r.error.message || "") || missing(r.error) ? (missing(r.error) ? SETUP : empty("alert", "Não foi possível montar o relatório.", esc(errText(r.error)))) : empty("alert", "Não foi possível carregar.", esc(errText(r.error))); return; }
  const d = r.data, v = VIEWS[area](d); body.innerHTML = v.html;
  v.after?.(body, d);
}
const lim = (d) => (d.limitations || []).length ? `<div class="mc-note" style="margin-top:12px">${icon("info")} ${d.limitations.map(esc).join("<br>")}</div>` : "";
const sec = (t, inner) => `<h3 class="mt">${esc(t)}</h3>${inner}`;
const mapBars = (list, dict, total) => list.map((x) => ({ label: dict[x.k] || (x.k === "none" ? "Não informado" : x.k), n: x.n, pct: x.pct ?? (total ? Math.round((x.n * 1000) / total) / 10 : null) }));

const VIEWS = {
  overview: (d) => {
    const p = d.pop, v = d.variation, can = canPeople() || peopleCan("people_view"), L = can ? "#/pessoas" : null;
    const conv = peopleCan("people_converts_view") ? "#/novos-convertidos" : null;
    return { html: `<div class="mc-tiles">${tile("Total de pessoas", p.total, undefined, L)}${tile("Membros", p.member, v.members, L)}${tile("Frequentadores", p.attender, undefined, L)}${tile("Visitantes", p.visitor, undefined, L)}
      ${tile("Novos convertidos (total)", d.converts_total, undefined, conv)}${tile("Ativas", p.active, undefined, L)}${tile("Inativas", p.inactive, undefined, L)}${tile("Cadastros incompletos", p.incomplete, undefined, L)}</div>
      <p class="tiny muted" style="margin-top:8px">Período ${esc(periodText(d))}. Comparado com ${br(d.period.prev_from)} a ${br(d.period.prev_to)}.</p>
      ${sec("No período", `<div class="mc-tiles">${tile("Novos cadastros", d.flows.new_registrations, v.new_registrations)}${tile("Novos visitantes", d.flows.new_visitors, v.new_visitors)}${tile("Novos membros", d.flows.new_members, v.new_members)}${tile("Novos convertidos", d.flows.converts, v.converts, conv)}</div>`)}
      ${sec("Distribuição por classificação", bars([["Membros", p.member], ["Frequentadores", p.attender], ["Visitantes", p.visitor], ...(p.none ? [["Sem classificação", p.none]] : [])].map(([label, n]) => ({ label, n, pct: p.total ? Math.round((n * 1000) / p.total) / 10 : null }))))}
      ${sec("Ativas e inativas", bars([["Ativas", p.active], ["Inativas", p.inactive]].map(([label, n]) => ({ label, n, pct: p.total ? Math.round((n * 1000) / p.total) / 10 : null }))))}
      ${sec("Evolução (" + GRAN[d.granularity].toLowerCase() + ")", `<div class="list" style="gap:12px">${chart("Evolução dos cadastros", d.series, "new_registrations")}${chart("Crescimento da membresia (membros ao fim de cada período)", d.series, "members", "line")}${chart("Novos visitantes", d.series, "new_visitors")}${chart("Novos convertidos", d.series, "converts")}</div>`)}
      ${lim(d)}`, model: null };
  },
  profile: (d) => ({ html: `${sec("Faixa etária", bars(d.bands.map((b) => ({ label: b.label, n: b.n, pct: b.pct }))))}${sec("Classificação", bars(mapBars(d.classification, CLS, d.total)))}${sec("Sexo", bars(mapBars(d.sex, SEX, d.total)))}${sec("Estado civil", bars(mapBars(d.marital, MAR, d.total)))}
    ${sec("Bairro", bars(d.neighborhood.map((x) => ({ label: x.k === "none" ? "Não informado" : x.k, n: x.n, pct: d.total ? Math.round((x.n * 1000) / d.total) / 10 : null }))))}${sec("Cidade", bars(d.city.map((x) => ({ label: x.k === "none" ? "Não informado" : x.k, n: x.n, pct: d.total ? Math.round((x.n * 1000) / d.total) / 10 : null }))))}
    ${sec("Composição familiar", `<div class="mc-tiles">${tile("Grupos familiares", d.families)}${tile("Sem vínculo familiar", d.without_family_link)}</div>`)}
    ${OPT.can.admin ? `<div style="margin-top:16px"><button class="btn ghost sm" id="bands">${icon("settings")} Configurar faixas etárias</button></div>` : ""}<p class="tiny muted" style="margin-top:10px">Quem não tem data de nascimento aparece em “Não informado”; nada é estimado.</p>`, after: (b) => { const x = b.querySelector("#bands"); if (x) x.onclick = bandsSheet; } }),
  evolution: (d) => {
    const rows = [["new_registrations", "Novos cadastros"], ["new_visitors", "Novos visitantes"], ["new_attenders", "Novos frequentadores"], ["new_members", "Novos membros"], ["converts", "Novos convertidos"], ["class_changes", "Mudanças de classificação"], ["inactivations", "Inativações"], ["reactivations", "Reativações"]];
    return { html: `<p class="tiny muted">Período ${esc(periodText(d))}. Comparado com ${br(d.period.prev_from)} a ${br(d.period.prev_to)}. Datas são as de OCORRÊNCIA, não as do registro.</p>
      <div class="card" style="overflow-x:auto"><table class="t" style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr><th align="left">Indicador</th><th align="right">Atual</th><th align="right">Anterior</th><th align="right">Diferença</th><th align="right">%</th></tr></thead><tbody>${rows.map(([k, l]) => { const x = d.delta[k]; return `<tr><td>${l}</td><td align="right">${x.cur}</td><td align="right">${x.prev}</td><td align="right">${x.abs > 0 ? "+" : ""}${x.abs}</td><td align="right">${x.pct == null ? "—" : (x.pct > 0 ? "+" : "") + n1(x.pct) + "%"}</td></tr>`; }).join("")}</tbody></table></div>
      ${d.members_start != null ? `<p class="small" style="margin-top:10px">Membros no início: <b>${d.members_start}</b> · no fim: <b>${d.members_end}</b></p>` : ""}
      ${sec("Gráficos (" + GRAN[d.granularity].toLowerCase() + ")", `<div class="list" style="gap:12px">${chart("Novos cadastros", d.series, "new_registrations")}${chart("Novos membros", d.series, "new_members")}${chart("Membros ao fim de cada período", d.series, "members", "line")}${chart("Inativações", d.series, "inactivations")}${chart("Reativações", d.series, "reactivations")}</div>`)}${lim(d)}` };
  },
  family: (d) => ({ html: `<div class="mc-tiles">${tile("Grupos familiares", d.families)}${tile("Pessoas com vínculo", d.with_link)}${tile("Pessoas sem vínculo", d.without_link)}${tile("Filhos cadastrados", d.children)}</div>
    ${sec("Famílias por número de integrantes", bars(d.sizes.map((s) => ({ label: `${s.size}${s.size >= 6 ? " ou mais" : ""} integrantes`, n: s.n, pct: null })), "Nenhum grupo familiar no filtro atual."))}${sec("Estado civil", bars(mapBars(d.marital, MAR, d.total)))}${lim(d)}` }),
  ministry: (d) => ({ html: `<div class="mc-tiles">${tile("Pessoas únicas em times", d.unique_linked)}${tile("Sem vínculo ministerial", d.unlinked)}${tile("Vínculos (pessoa × time)", d.links)}${tile("Em mais de um time", d.multi_team)}</div>
    ${sec("Por ministério (rede)", bars(d.networks.map((n) => ({ label: `${n.name} · ${n.teams} time(s), ${n.links} vínculo(s)`, n: n.people, pct: n.pct })), "Nenhum time vinculado a ministério."))}${sec("Por time", bars(d.teams.map((t) => ({ label: t.name, n: t.people, pct: t.pct }))), "Nenhum time com participantes.")}${lim(d)}` }),
};

// ---- faixas etárias configuráveis (só quem administra)
async function bandsSheet() {
  const org = state.org?.id, g = await sb.rpc("rp_settings_get", { p_org: org }); if (g.error) return toast(errText(g.error));
  let bands = g.data.age_bands.map((b) => ({ label: b.label, max: b.max }));
  const sh = sheet(`<h2>Faixas etárias</h2><p class="small muted">Cada faixa começa onde a anterior termina. A última não tem limite.</p><div id="rows"></div>
    <div class="row gap"><button class="btn ghost grow" id="add">Adicionar faixa</button><button class="btn grow" id="save">Salvar</button></div>`);
  const draw = () => { let min = 0; sh.el.querySelector("#rows").innerHTML = bands.map((b, i) => { const last = i === bands.length - 1, r = `<div class="row gap" style="align-items:flex-end"><label class="field grow"><span>Nome</span><input data-l="${i}" maxlength="40" value="${attr(b.label)}"></label><label class="field" style="width:96px"><span>De ${min} até</span>${last ? `<input disabled value="sem limite">` : `<input data-m="${i}" type="number" min="${min}" max="130" value="${b.max ?? ""}">`}</label>${bands.length > 2 ? `<button class="btn ghost sm" data-d="${i}" aria-label="Remover faixa">${icon("minus")}</button>` : ""}</div>`; min = (b.max ?? min) + 1; return r; }).join(""); };
  const read = () => { sh.el.querySelectorAll("[data-l]").forEach((i) => (bands[+i.dataset.l].label = i.value)); sh.el.querySelectorAll("[data-m]").forEach((i) => (bands[+i.dataset.m].max = i.value === "" ? null : +i.value)); };
  draw();
  sh.el.onclick = (e) => { const d = e.target.closest("[data-d]"); if (d) { read(); bands.splice(+d.dataset.d, 1); bands[bands.length - 1].max = null; draw(); } };
  sh.el.querySelector("#add").onclick = () => { read(); const l = bands[bands.length - 1]; l.max = (bands.length > 1 ? (bands[bands.length - 2].max ?? 0) : 0) + 10; bands.push({ label: "Nova faixa", max: null }); draw(); };
  sh.el.querySelector("#save").onclick = async (ev) => {
    read(); let min = 0; const out = bands.map((b, i) => { const o = { label: b.label.trim(), min, max: i === bands.length - 1 ? null : b.max }; min = (b.max ?? 0) + 1; return o; });
    busy(ev.currentTarget); const r = await sb.rpc("rp_settings_save", { p_org: org, p_bands: out }); busy(ev.currentTarget, false);
    if (r.error) return toast(/invalid_bands/.test(r.error.message) ? "Confira os nomes e os limites: cada faixa precisa terminar depois de onde começa." : errText(r.error));
    toast("Faixas salvas"); OPT = null; sh.close(); location.reload();
  };
}

// ---- exportações: o arquivo reflete o mesmo relatório que está na tela, com os mesmos filtros
const F_AREAS = { overview: "Visão geral", profile: "Perfil da comunidade", evolution: "Evolução da membresia", family: "Relatórios familiares", ministry: "Distribuição ministerial" };
const dist = (list, dict, total) => ({ head: ["Categoria", "Quantidade", "%"], rows: list.map((x) => [dict[x.k] || (x.k === "none" ? "Não informado" : x.k), x.n, x.pct ?? (total ? n1(Math.round((x.n * 1000) / total) / 10) : "")]) });
function model(area, d) {
  const T = [], K = [];
  if (area === "overview") {
    const p = d.pop, v = d.variation;
    K.push(["Total de pessoas", p.total], ["Membros", p.member], ["Frequentadores", p.attender], ["Visitantes", p.visitor], ["Ativas", p.active], ["Inativas", p.inactive], ["Cadastros incompletos", p.incomplete], ["Novos convertidos (total)", d.converts_total]);
    T.push({ name: "Variação", head: ["Indicador", "Atual", "Anterior", "Diferença", "%"], rows: Object.entries({ new_registrations: "Novos cadastros", new_visitors: "Novos visitantes", new_members: "Novos membros", converts: "Novos convertidos", members: "Membros" }).filter(([k]) => v[k]).map(([k, l]) => [l, v[k].cur, v[k].prev, v[k].abs, v[k].pct == null ? "sem base percentual" : n1(v[k].pct)]) });
    T.push({ name: "Série", head: ["Início", "Fim", "Cadastros", "Visitantes", "Novos membros", "Convertidos", "Membros ao fim"], rows: d.series.map((s) => [br(s.start), br(s.end), s.new_registrations, s.new_visitors, s.new_members, s.converts, s.members]) });
  } else if (area === "profile") {
    K.push(["Total de pessoas", d.total], ["Grupos familiares", d.families], ["Sem vínculo familiar", d.without_family_link]);
    T.push({ name: "Faixa etária", head: ["Faixa", "Quantidade", "%"], rows: d.bands.map((b) => [b.label, b.n, b.pct ?? ""]) }, { name: "Classificação", ...dist(d.classification, CLS, d.total) }, { name: "Sexo", ...dist(d.sex, SEX, d.total) }, { name: "Estado civil", ...dist(d.marital, MAR, d.total) }, { name: "Bairro", ...dist(d.neighborhood, {}, d.total) }, { name: "Cidade", ...dist(d.city, {}, d.total) });
  } else if (area === "evolution") {
    const L = { new_registrations: "Novos cadastros", new_visitors: "Novos visitantes", new_attenders: "Novos frequentadores", new_members: "Novos membros", converts: "Novos convertidos", class_changes: "Mudanças de classificação", inactivations: "Inativações", reactivations: "Reativações" };
    if (d.members_start != null) K.push(["Membros no início", d.members_start]); K.push(["Membros no fim", d.members_end]);
    T.push({ name: "Evolução", head: ["Indicador", "Atual", "Anterior", "Diferença", "%"], rows: Object.entries(L).map(([k, l]) => [l, d.delta[k].cur, d.delta[k].prev, d.delta[k].abs, d.delta[k].pct == null ? "sem base percentual" : n1(d.delta[k].pct)]) });
    T.push({ name: "Série", head: ["Início", "Fim", ...Object.values(L), "Membros ao fim"], rows: d.series.map((s) => [br(s.start), br(s.end), ...Object.keys(L).map((k) => s[k]), s.members]) });
  } else if (area === "family") {
    K.push(["Total de pessoas", d.total], ["Grupos familiares", d.families], ["Pessoas com vínculo", d.with_link], ["Pessoas sem vínculo", d.without_link], ["Filhos cadastrados", d.children]);
    T.push({ name: "Integrantes", head: ["Integrantes", "Famílias"], rows: d.sizes.map((s) => [s.size >= 6 ? "6 ou mais" : s.size, s.n]) }, { name: "Estado civil", ...dist(d.marital, MAR, d.total) });
  } else {
    K.push(["Pessoas únicas em times", d.unique_linked], ["Sem vínculo ministerial", d.unlinked], ["Vínculos (pessoa × time)", d.links], ["Em mais de um time", d.multi_team]);
    T.push({ name: "Ministérios", head: ["Ministério", "Pessoas únicas", "Times", "Vínculos", "%"], rows: d.networks.map((n) => [n.name, n.people, n.teams, n.links, n.pct ?? ""]) }, { name: "Times", head: ["Time", "Pessoas", "Líderes", "%"], rows: d.teams.map((t) => [t.name, t.people, t.leaders, t.pct ?? ""]) });
  }
  return { K, T, limits: d.limitations || [] };
}
const meta = (area, d, kind) => [["Relatório", `Pessoas — ${kind}`], ["Igreja", OPT.org_name || state.org?.name || ""], ["Gerado em", new Date().toLocaleString("pt-BR")], ["Período analisado", d?.period ? periodText(d) : "Situação atual do cadastro (sem recorte de período)"], ["Filtros utilizados", describe()]];
const csvCell = (v) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const save = (data, name, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
function fileOf(fmt, title, metaRows, K, T, limits) {
  const stamp = iso(new Date()), base = `relatorio-pessoas-${title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")}-${stamp}`;
  if (fmt === "xlsx") {
    const sheets = [{ name: "Resumo", rows: [[title], ...metaRows, [], ["Indicador", "Valor"], ...K, ...(limits.length ? [[], ["Observações"], ...limits.map((l) => [l])] : [])] }, ...T.map((t) => ({ name: t.name.slice(0, 31), rows: [t.head, ...t.rows] }))];
    save(buildXlsx(sheets), base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } else if (fmt === "csv") {
    const lines = [[title], ...metaRows, [], ["Indicador", "Valor"], ...K, ...T.flatMap((t) => [[], [t.name], t.head, ...t.rows]), ...(limits.length ? [[], ["Observações"], ...limits.map((l) => [l])] : [])];
    save("﻿" + lines.map((l) => l.map(csvCell).join(";")).join("\r\n"), base + ".csv", "text/csv;charset=utf-8");
  } else {
    const blocks = [{ h: title }, ...metaRows.map(([k, v]) => ({ small: `${k}: ${v}` })), { h2: "Indicadores" }, { table: { head: ["Indicador", "Valor"], rows: K, widths: [320, 175] } }];
    for (const t of T) { blocks.push({ h2: t.name }); blocks.push({ table: { head: t.head, rows: t.rows } }); }
    if (limits.length) { blocks.push({ h2: "Observações" }); limits.forEach((l) => blocks.push({ p: l })); }
    save(buildPdf({ title, footer: `${OPT.org_name || ""} · gerado em ${new Date().toLocaleString("pt-BR")}`, blocks }), base + ".pdf", "application/pdf");
  }
}
const FMT = [["xlsx", "Excel (.xlsx)"], ["csv", "CSV"], ["pdf", "PDF"]];
function exportsView(body, alive) {
  const org = state.org?.id, can = OPT.can;
  body.innerHTML = `<p class="small muted">Os arquivos trazem título, igreja, data de geração, período, filtros usados, indicadores e tabelas, exatamente como estão na tela. Cada exportação fica registrada.</p>
    ${can.export ? `<h3>Indicadores</h3><label class="field"><span>Relatório</span><select id="area">${Object.entries(F_AREAS).filter(([k]) => OPT.areas[k]).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <div class="mc-chips">${FMT.map(([k, l]) => `<button class="btn ghost sm" data-ex="${k}">${icon("download")} ${l}</button>`).join("")}</div>` : ""}
    ${can.export_lists ? `<h3 class="mt">Lista de pessoas</h3><div class="mc-note">${icon("lock")} Traz nome, classificação, situação, faixa etária, sexo, estado civil, bairro, cidade e datas. Não inclui CPF, contatos nem dados pastorais. Menores aparecem só com iniciais. Use com cuidado: é dado pessoal (LGPD).</div>
      <div class="mc-chips" style="margin-top:10px">${FMT.map(([k, l]) => `<button class="btn ghost sm" data-ls="${k}">${icon("download")} ${l}</button>`).join("")}</div>` : ""}
    ${can.admin ? `<h3 class="mt">Registro de exportações</h3><button class="btn ghost sm" id="aud">${icon("list")} Ver as últimas 100</button>` : ""}`;
  body.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = async () => {
    const area = body.querySelector("#area").value; busy(b);
    const r = await sb.rpc("rp_report", { p_org: org, p_area: area, f: toF() });
    if (r.error) { busy(b, false); return toast(errText(r.error)); }
    const m = model(area, r.data);
    if (!m.K.length && !m.T.some((t) => t.rows.length)) { busy(b, false); return toast("Não há dados para exportar com estes filtros."); }
    const log = await sb.rpc("report_export_log", { p_org: org, p_area: area, p_format: b.dataset.ex, p_filters: toF(), p_rows: m.T.reduce((a, t) => a + t.rows.length, 0) + m.K.length });
    busy(b, false); if (log.error) return toast(errText(log.error));
    fileOf(b.dataset.ex, F_AREAS[area], meta(area, r.data, F_AREAS[area]), m.K, m.T, m.limits); toast("Arquivo gerado");
  }));
  body.querySelectorAll("[data-ls]").forEach((b) => (b.onclick = async () => {
    busy(b); const r = await sb.rpc("rp_list", { p_org: org, f: toF(), p_limit: 5000, p_offset: 0, p_export: true, p_format: b.dataset.ls }); busy(b, false);
    if (r.error) return toast(errText(r.error)); const L = r.data.items;
    if (!L.length) return toast("Não há pessoas para exportar com estes filtros.");
    const head = ["Nome", "Classificação", "Situação", "Faixa etária", "Sexo", "Estado civil", "Bairro", "Cidade", "Cadastro em", "Membro desde"];
    const rows = L.map((i) => [i.name, CLS[i.classification] || i.classification, i.status === "active" ? "Ativa" : i.status === "inactive" ? "Inativa" : i.status, i.band, SEX[i.sex || "none"], MAR[i.marital || "none"], i.neighborhood || "Não informado", i.city || "Não informado", br(i.registered_at), br(i.joined_at)]);
    fileOf(b.dataset.ls, "Lista de pessoas", meta("list", null, "Lista de pessoas"), [["Pessoas listadas", rows.length], ["Total no filtro", r.data.total]], [{ name: "Pessoas", head, rows }], r.data.total > rows.length ? [`A lista foi limitada às primeiras ${rows.length} de ${r.data.total} pessoas.`] : []); toast("Arquivo gerado");
  }));
  const aud = body.querySelector("#aud");
  if (aud) aud.onclick = async () => { const r = await sb.rpc("rp_export_audit", { p_org: org }); if (r.error) return toast(errText(r.error)); sheet(`<h2>Registro de exportações</h2>${r.data.length ? `<div class="list">${r.data.map((x) => `<div class="li" style="display:block"><b>${esc(x.kind === "list" ? "Lista de pessoas" : F_AREAS[x.area] || x.area)}</b> · ${esc(x.format.toUpperCase())}<div class="tiny muted">${esc(x.by)} · ${new Date(x.at).toLocaleString("pt-BR")}${x.rows != null ? ` · ${x.rows} linha(s)` : ""}</div></div>`).join("")}</div>` : `<p class="muted">Nenhuma exportação ainda.</p>`}`, { wide: true }); };
}
