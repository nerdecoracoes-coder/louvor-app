// Carteira Digital do Membro: carteira no SOMOS Um (Meu perfil), gestão em SOMOS Chamados, leitor e página pública de validação.
// Identificação eclesiástica, não documento civil. Quem decide a validade é sempre o servidor.
import { sb, state, esc, attr, icon, avatar, sheet, toast, busy, empty, spinner, confirmDialog, peopleCan, canAdminOrg } from "../core.js";
import { qrSvg } from "../lib/qr.js";
import { errText } from "../lib/pessoas-import.js";

export function register(route) {
  route("/carteira", (p, el, a) => mine(el, a));
  route("/carteiras", (p, el, a) => admin(el, a));
  route("/carteiras/validar", (p, el, a) => scanner(el, a));
  route("/validar-carteira/:token", (p) => publicValidate(p.token), { public: true, noOrg: true });
}

const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-04-segmentacao-carteira.sql</b> no SQL Editor do Supabase.</div>`;
const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
const can = (a) => canAdminOrg() || peopleCan(a);
const day = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
const when = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const head = (t, back = ["#/perfil", "Meu perfil"]) => `<div class="pagehead"><h1>${esc(t)}</h1></div>${back ? `<div class="mb"><a class="btn ghost sm" href="${back[0]}">${icon("chevronLeft")} ${esc(back[1])}</a></div>` : ""}`;
const TOKEN = /[0-9a-f]{32}\.[0-9a-f]{32}/;
const urlOf = (token) => `${location.origin}${location.pathname}#/validar-carteira/${token}`;
const lum = (hex) => { const n = parseInt((hex || "#3753D1").slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const STATUS = { active: "Válida", suspended: "Suspensa", revoked: "Revogada", none: "Sem carteira" };
const KIND = { issued: "Emitida", issued_batch: "Emitida em lote", issued_self: "Emitida pelo próprio membro", reissued: "Reemitida", suspended: "Suspensa", reactivated: "Reativada", revoked: "Revogada", token_renewed: "QR Code renovado", config: "Configuração alterada", batch: "Operação em lote", validated: "Validada por leitor" };

// ---------------------------------------------------------------- cartão
function cardHtml(c, token, size = "full") {
  const dark = c.style === "dark", light = c.style === "light", acc = c.accent || "#3753D1";
  const onAcc = lum(acc) > 0.45 ? "#111" : "#fff"; // cor institucional definida pela igreja: o contraste é calculado, não fixo
  const bg = dark ? "background:var(--surface);color:var(--text)" : light ? "background:var(--raised);color:var(--text)" : `background:${acc};color:${onAcc}`;
  const sub = dark || light ? "var(--muted)" : "inherit";
  return `<div class="wcard" style="--wc:${attr(acc)};${bg};border:1px solid var(--line-2);border-radius:var(--r-lg,12px);padding:18px;position:relative;overflow:hidden;box-shadow:0 8px 24px rgba(var(--w),.08)" role="group" aria-label="${attr(c.title)}">
    <div style="position:absolute;left:0;right:0;top:0;height:6px;background:var(--wc)"></div>
    <div class="row" style="gap:12px;align-items:center;margin-top:6px">${c.logo_url ? `<img src="${attr(c.logo_url)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover">` : `<span style="width:44px;height:44px;border-radius:10px;background:var(--wc);display:grid;place-items:center">${icon("church")}</span>`}
      <div style="min-width:0"><div style="font-weight:700;line-height:1.2">${esc(c.church_name)}</div><div style="font-size:11px;letter-spacing:.12em;color:${sub}">${esc(c.title)}</div></div></div>
    <div class="row" style="gap:14px;margin-top:18px;align-items:center">${avatar({ display_name: c.name, avatar_url: c.photo_url }, 76, false)}
      <div style="min-width:0;flex:1"><div style="font-size:19px;font-weight:700;line-height:1.2;overflow-wrap:anywhere">${esc(c.name)}</div>
        ${c.matricula ? `<div style="font-size:13px;color:${sub};margin-top:4px">Matrícula <b style="color:inherit">${esc(c.matricula)}</b></div>` : ""}
        ${c.issued_at ? `<div style="font-size:12px;color:${sub}">Emitida em ${day(c.issued_at)}</div>` : ""}</div></div>
    <div class="row between" style="margin-top:16px;align-items:flex-end"><span class="ptag attender" style="align-self:flex-start">${esc(STATUS[c.status] || c.status)}</span>
      ${token && size === "full" ? `<button class="wqr" id="qr" data-url="${attr(urlOf(token))}" aria-label="Ampliar QR Code" style="background:#fff;padding:6px;border-radius:10px;line-height:0">${qrSvg(urlOf(token), { size: 96, margin: 1 })}</button>` : ""}</div></div>`;
}
const MSG = {
  no_person: ["user", "Sua conta ainda não está ligada a uma ficha", "Procure a secretaria da igreja para vincular seu cadastro. Depois disso sua carteira poderá ser emitida."],
  pending: ["clock", "Cadastro em análise", "Assim que a secretaria aprovar seu cadastro, sua situação será avaliada. Ainda não há carteira definitiva."],
  not_issued: ["badge", "Sua carteira ainda não foi emitida", "Procure a secretaria da igreja para solicitar a emissão."],
  suspended: ["lock", "Carteira suspensa", "Por enquanto ela não pode ser apresentada. Procure a secretaria da igreja para saber mais."],
  revoked: ["lock", "Carteira revogada", "Procure a secretaria da igreja para saber mais ou pedir uma nova emissão."],
};
async function mine(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Carteira Digital")}${spinner()}`;
  const r = await sb.rpc("wallet_mine", { p_org: org }); if (!alive()) return;
  if (r.error) { el.innerHTML = `${head("Carteira Digital")}${missing(r.error) ? SETUP : empty("alert", "Não foi possível carregar.", esc(errText(r.error)))}`; return; }
  const d = r.data; let body;
  if (d.state === "active") {
    body = `${cardHtml(d.card, d.token)}<div class="row gap" style="margin-top:14px"><button class="btn grow" id="big">${icon("search")} Ampliar QR Code</button><button class="btn ghost grow" id="det">${icon("info")} Detalhes</button></div>
      <p class="tiny muted" style="margin-top:12px">Identificação eclesiástica da igreja. Não é documento de identidade civil nem meio de pagamento.</p>`;
  } else if (d.state === "not_eligible") {
    body = empty("badge", "A carteira é para membros da igreja", d.reason === "inactive" ? "Seu cadastro está inativo no momento. Procure a secretaria da igreja para atualizar." : "Ela fica disponível para quem é membro oficial. Se você deseja se tornar membro, converse com a liderança ou com a secretaria da igreja.");
  } else { const [ic, t, p] = MSG[d.state] || MSG.not_issued; body = empty(ic, t, p); }
  el.innerHTML = `${head("Carteira Digital")}${body}`;
  const big = el.querySelector("#big") || el.querySelector("#qr"); if (big) big.onclick = () => sheet(`<h2 style="text-align:center">${esc(d.card.name)}</h2><div style="background:#fff;padding:12px;border-radius:14px;margin:12px auto;max-width:340px;line-height:0">${qrSvg(urlOf(d.token), { size: 300, margin: 2 }).replace('width="300" height="300"', 'width="100%"')}</div><p class="small muted" style="text-align:center">Aproxime o leitor ou a câmera deste QR Code.</p>`);
  const det = el.querySelector("#det"); if (det) det.onclick = () => sheet(`<h2>Detalhes</h2><div class="mc-kv"><span>Nome</span><b>${esc(d.card.name)}</b></div><div class="mc-kv"><span>Igreja</span><b>${esc(d.card.church_name)}</b></div>${d.card.matricula ? `<div class="mc-kv"><span>Matrícula</span><b>${esc(d.card.matricula)}</b></div>` : ""}${d.card.issued_at ? `<div class="mc-kv"><span>Emitida em</span><b>${day(d.card.issued_at)}</b></div>` : ""}<div class="mc-kv"><span>Situação</span><b>${esc(STATUS[d.card.status])}</b></div>
    <p class="small muted" style="margin-top:12px">Os dados vêm da sua ficha. Se algo estiver errado, peça a atualização cadastral. A validade é conferida pelo sistema da igreja a cada leitura do QR Code.</p>`);
}

// ---------------------------------------------------------------- resultado de validação (usado na página pública e no leitor)
function resultHtml(v) {
  const M = { valid: ["check", "Carteira válida", "ok"], suspended: ["alert", "Carteira suspensa", "warn"], revoked: ["alert", "Carteira revogada", "bad"], not_found: ["search", "Carteira não encontrada", "bad"] };
  const [ic, t] = M[v.result] || ["alert", "Erro de validação"];
  return `<div class="card" style="text-align:center">${icon(ic)}<h1 style="font-size:24px;margin:8px 0">${t}</h1>
    ${v.name ? `<div class="row" style="justify-content:center;margin:12px 0">${avatar({ display_name: v.name, avatar_url: v.photo_url }, 84, false)}</div><div style="font-size:19px;font-weight:700">${esc(v.name)}</div>` : ""}
    ${v.church ? `<div class="muted">${esc(v.church)}</div>` : ""}${v.matricula ? `<div class="small">Matrícula ${esc(v.matricula)}</div>` : ""}
    ${v.result === "suspended" ? `<p class="small muted">Esta carteira não está valendo no momento.</p>` : v.result === "not_found" ? `<p class="small muted">O código não corresponde a nenhuma carteira.</p>` : ""}
    <p class="tiny muted" style="margin-top:14px">${esc(v.notice || "Esta validação confirma a situação da carteira no sistema da igreja. Ela não comprova a identidade civil de quem a apresenta.")}</p></div>`;
}
const validateErr = (e) => (/rate_limited/.test(e?.message || "") ? "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo." : "Não foi possível validar agora. Tente novamente.");
async function publicValidate(token) {
  const root = document.getElementById("app"); const shell = (inner) => `<div class="backdrop"></div><div class="auth"><div class="box">${inner}</div></div>`;
  root.innerHTML = shell(spinner());
  const r = await sb.rpc("wallet_validate", { p_token: token });
  if (r.error) { root.innerHTML = shell(`<h1>Erro de validação</h1><p class="sub">${esc(validateErr(r.error))}</p>`); return; }
  root.innerHTML = shell(`<p class="sub">Validação de carteira de membro</p>${resultHtml(r.data)}`);
}

// ---------------------------------------------------------------- leitor (quem tem permissão de validar)
async function scanner(el, alive) {
  if (!can("people_wallet_validate")) { el.innerHTML = `${head("Validar carteira", ["#/carteiras", "Carteiras"])}${empty("lock", "Você não tem acesso a esta área.")}`; return; }
  const supported = "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia;
  el.innerHTML = `${head("Validar carteira", ["#/carteiras", "Carteiras"])}
    ${supported ? `<div class="card"><video id="vid" playsinline muted style="width:100%;border-radius:10px;background:var(--ink-2);min-height:200px"></video><div class="row gap" style="margin-top:10px"><button class="btn grow" id="cam">${icon("camera")} Ler com a câmera</button><button class="btn ghost grow" id="stop" hidden>Parar</button></div></div>` : `<div class="mc-note">${icon("info")} Este aparelho não lê QR Code pelo navegador. Aponte a câmera do celular para o QR Code ou cole o código ou o link abaixo.</div>`}
    <label class="field" style="margin-top:14px"><span>Código ou link da carteira</span><input id="code" placeholder="Cole o link ou o código" autocomplete="off"></label><button class="btn block" id="go">Validar</button><div id="res" style="margin-top:14px"></div>`;
  let stream, timer;
  const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; const s = el.querySelector("#stop"); if (s) s.hidden = true; };
  const check = async (text) => {
    const m = String(text || "").match(TOKEN); const box = el.querySelector("#res"); if (!box) return;
    if (!m) { box.innerHTML = resultHtml({ result: "not_found" }); return; }
    box.innerHTML = spinner(); const r = await sb.rpc("wallet_validate", { p_token: m[0] });
    box.innerHTML = r.error ? `<div class="card"><p>${esc(validateErr(r.error))}</p></div>` : resultHtml(r.data);
  };
  el.querySelector("#go").onclick = () => check(el.querySelector("#code").value);
  const cam = el.querySelector("#cam");
  if (cam) cam.onclick = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const v = el.querySelector("#vid"); v.srcObject = stream; await v.play(); el.querySelector("#stop").hidden = false;
      const det = new BarcodeDetector({ formats: ["qr_code"] });
      timer = setInterval(async () => { try { const f = await det.detect(v); if (f[0]?.rawValue) { stop(); check(f[0].rawValue); } } catch {} }, 400);
    } catch { toast("Não foi possível abrir a câmera. Confira a permissão ou cole o código."); }
  };
  const st = el.querySelector("#stop"); if (st) st.onclick = stop;
  window.addEventListener("hashchange", stop, { once: true });
}

// ---------------------------------------------------------------- gestão
async function admin(el, alive) {
  const org = state.org?.id; el.innerHTML = `${head("Carteiras Digitais", ["#/chamados", "SOMOS Chamados"])}${spinner()}`;
  const st = { q: "", status: "all", offset: 0 };
  el.innerHTML = `${head("Carteiras Digitais", ["#/chamados", "SOMOS Chamados"])}<div id="tiles"></div>
    <div class="row gap mb" style="flex-wrap:wrap"><input class="psearch grow" id="q" type="search" placeholder="Pesquisar por nome ou matrícula" aria-label="Pesquisar">
      <select id="st" aria-label="Situação"><option value="all">Todas</option><option value="active">Válidas</option><option value="suspended">Suspensas</option><option value="revoked">Revogadas</option><option value="none">Membros sem carteira</option></select></div>
    <div class="row gap mb" style="flex-wrap:wrap">${can("people_wallet_batch") ? `<button class="btn sm" id="batch">${icon("plus")} Gerar em lote</button>` : ""}${can("people_wallet_validate") ? `<a class="btn ghost sm" href="#/carteiras/validar">${icon("search")} Validar carteira</a>` : ""}${can("people_wallet_config") ? `<button class="btn ghost sm" id="cfg">${icon("settings")} Modelo e políticas</button>` : ""}</div>
    <div id="list">${spinner()}</div><div id="more"></div>`;
  const list = el.querySelector("#list");
  const load = async (append) => {
    if (!append) { st.offset = 0; list.innerHTML = spinner(); }
    const r = await sb.rpc("wallet_list", { p_org: org, p: { q: st.q, status: st.status, offset: st.offset, limit: 30 } }); if (!alive()) return;
    if (r.error) { list.innerHTML = missing(r.error) ? SETUP : empty(/forbidden/.test(r.error.message) ? "lock" : "alert", /forbidden/.test(r.error.message) ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(r.error))); return; }
    const c = r.data.counts; el.querySelector("#tiles").innerHTML = `<div class="mc-tiles"><div class="mc-tile"><b>${c.active}</b><span>Válidas</span></div><div class="mc-tile"><b>${c.none}</b><span>Membros sem carteira</span></div><div class="mc-tile"><b>${c.suspended}</b><span>Suspensas</span></div><div class="mc-tile"><b>${c.revoked}</b><span>Revogadas</span></div></div>`;
    const rows = r.data.items.map((i) => `<button class="li" data-p="${i.person_id}">${avatar({ display_name: i.name, avatar_url: i.photo_url }, 40, false)}<span class="grow"><span class="t">${esc(i.name)}</span><span class="s">${i.matricula ? esc(i.matricula) + " · " : ""}${esc(STATUS[i.status] || i.status)}${!i.eligible && i.status !== "none" ? " · fora da regra de membro ativo" : ""}</span></span>${icon("chevronRight", "chev")}</button>`).join("");
    if (append) list.querySelector(".list").insertAdjacentHTML("beforeend", rows); else list.innerHTML = rows ? `<div class="list">${rows}</div>` : empty("badge", "Nenhuma carteira encontrada.", "Ajuste a pesquisa ou o filtro.");
    st.offset += r.data.items.length; el.querySelector("#more").innerHTML = st.offset < r.data.total ? `<button class="btn ghost block" id="mr">Ver mais</button>` : "";
    const mr = el.querySelector("#mr"); if (mr) mr.onclick = () => load(true);
  };
  let t; el.querySelector("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; load(); }, 250); }; el.querySelector("#st").onchange = (e) => { st.status = e.target.value; load(); };
  list.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) detail(org, b.dataset.p, () => load()); };
  const bt = el.querySelector("#batch"); if (bt) bt.onclick = () => batchSheet(org, () => load());
  const cf = el.querySelector("#cfg"); if (cf) cf.onclick = () => configSheet(org);
  load();
}
async function detail(org, person, done) {
  const r = await sb.rpc("wallet_get", { p_org: org, p_person: person }); if (r.error) return toast(errText(r.error));
  const d = r.data, w = d.wallet, sh = sheet(`<h2>${esc(d.person.name)}</h2>
    <div class="mc-kv"><span>Situação da carteira</span><b>${esc(w ? STATUS[w.status] : "Sem carteira")}</b></div><div class="mc-kv"><span>Matrícula</span><b>${esc(d.matricula || "—")}</b></div>
    ${w ? `<div class="mc-kv"><span>Emitida em</span><b>${day(w.issued_at)}</b></div>${w.reason ? `<div class="mc-kv"><span>Motivo</span><b>${esc(w.reason)}</b></div>` : ""}` : ""}
    ${!d.eligible ? `<div class="mc-note" style="margin:10px 0">${icon("info")} Esta pessoa não é membro ativo, então a carteira não pode ser emitida nem reativada.</div>` : ""}
    <div class="row gap" style="flex-wrap:wrap;margin:12px 0">
      ${!w && d.eligible && can("people_wallet_issue") ? `<button class="btn sm" data-a="issue">Emitir carteira</button>` : ""}
      ${w && can("people_wallet_issue") && d.eligible ? `<button class="btn ghost sm" data-a="reissue">Reemitir</button>` : ""}
      ${w && w.stored_status === "active" && can("people_wallet_suspend") ? `<button class="btn ghost sm" data-a="suspend">Suspender</button>` : ""}
      ${w && w.stored_status === "suspended" && d.eligible && can("people_wallet_reactivate") ? `<button class="btn ghost sm" data-a="reactivate">Reativar</button>` : ""}
      ${w && w.stored_status !== "revoked" && can("people_wallet_revoke") ? `<button class="btn ghost sm" data-a="revoke">Revogar</button>` : ""}
      ${w && w.stored_status !== "revoked" && can("people_wallet_token") ? `<button class="btn ghost sm" data-a="token">Renovar QR Code</button>` : ""}</div>
    <h3>Histórico</h3>${d.history.length ? `<div class="list">${d.history.map((h) => `<div class="li"><span class="grow"><span class="t">${esc(KIND[h.kind] || h.kind)}</span><span class="s">${when(h.at)}${h.by ? " · " + esc(h.by) : ""}${h.reason ? " · " + esc(h.reason) : ""}</span></span></div>`).join("")}</div>` : `<p class="muted small">Sem registros.</p>`}`, { wide: true });
  sh.el.onclick = async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return; const a = b.dataset.a; let reason = null;
    if (["suspend", "revoke"].includes(a)) { reason = await askReason(a === "suspend" ? "Motivo da suspensão" : "Motivo da revogação"); if (!reason) return; }
    if (a === "token") { if (!(await confirmDialog("Renovar o QR Code? O atual deixa de valer e o membro verá o novo ao abrir a carteira.", "Renovar"))) return; }
    const fn = { issue: ["wallet_issue", { p_org: org, p_person: person, p_reason: null }], reissue: ["wallet_reissue", { p_id: w?.id, p_reason: null }], suspend: ["wallet_suspend", { p_id: w?.id, p_reason: reason }], reactivate: ["wallet_reactivate", { p_id: w?.id, p_reason: null }], revoke: ["wallet_revoke", { p_id: w?.id, p_reason: reason }], token: ["wallet_renew_token", { p_id: w?.id, p_reason: null }] }[a];
    busy(b); const x = await sb.rpc(fn[0], fn[1]); busy(b, false); if (x.error) return toast(/not_eligible/.test(x.error.message) ? "A pessoa precisa ser membro ativo." : errText(x.error));
    toast("Feito"); sh.close(); done(); detail(org, person, done);
  };
}
function askReason(title) {
  return new Promise((res) => { let ok = false; const sh = sheet(`<h2>${esc(title)}</h2><label class="field"><span>Motivo (obrigatório)</span><input id="rs" maxlength="200" autocomplete="off"></label><button class="btn block" id="ok">Confirmar</button>`, { onClose: () => res(ok ? ok : null) });
    sh.el.querySelector("#ok").onclick = () => { const v = sh.el.querySelector("#rs").value.trim(); if (v.length < 3) return toast("Informe o motivo"); ok = v; sh.close(); }; });
}
async function batchSheet(org, done) {
  const [o, s] = await Promise.all([sb.rpc("segment_options", { p_org: org }), sb.rpc("segment_list", { p_org: org, p: { status: "active" } })]);
  const nets = o.data?.networks || [], segs = s.data || [];
  const sh = sheet(`<h2>Gerar carteiras em lote</h2><p class="small muted">Só membros ativos recebem carteira, e quem já tem não é duplicado. Cada pessoa é conferida de novo na hora.</p>
    <label class="field"><span>Quem receberá</span><select id="w"><option value="all">Todos os membros elegíveis sem carteira</option>${nets.length ? `<option value="net">Elegíveis de um ministério</option>` : ""}${segs.length ? `<option value="seg">Pessoas de um segmento (só as elegíveis)</option>` : ""}</select></label>
    <label class="field" id="fn" hidden><span>Ministério</span><select id="net">${nets.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}</select></label>
    <label class="field" id="fs" hidden><span>Segmento</span><select id="seg">${segs.map((n) => `<option value="${n.id}">${esc(n.name)} (${n.count})</option>`).join("")}</select></label>
    <button class="btn block" id="go">Gerar carteiras</button><div id="out" style="margin-top:12px"></div>`);
  const w = sh.el.querySelector("#w"); w.onchange = () => { sh.el.querySelector("#fn").hidden = w.value !== "net"; sh.el.querySelector("#fs").hidden = w.value !== "seg"; };
  const run = async (p) => {
    const b = sh.el.querySelector("#go"); busy(b); const r = await sb.rpc("wallet_batch", { p_org: org, p }); busy(b, false); if (r.error) return toast(errText(r.error));
    const d = r.data, out = sh.el.querySelector("#out");
    out.innerHTML = `<div class="mc-note">${icon("check")} ${d.created} carteira(s) emitida(s), ${d.skipped} já existia(m).${d.failed.length ? ` ${d.failed.length} com falha.` : ""}</div>
      ${d.failed.length ? `<div class="list" style="margin-top:8px">${d.failed.map((f) => `<div class="li"><span class="grow"><span class="t">${esc(f.name || "Pessoa")}</span><span class="s">${esc(/not_eligible/.test(f.reason) ? "Não é membro ativo" : /person_pending/.test(f.reason) ? "Cadastro pendente" : f.reason)}</span></span></div>`).join("")}</div><button class="btn ghost block" id="re" style="margin-top:8px">Reprocessar só as falhas</button>` : ""}`;
    const re = out.querySelector("#re"); if (re) re.onclick = () => run({ person_ids: d.failed.map((f) => f.person_id) }); done();
  };
  sh.el.querySelector("#go").onclick = () => run(w.value === "net" ? { all: true, network_id: sh.el.querySelector("#net").value } : w.value === "seg" ? { segment_id: sh.el.querySelector("#seg").value } : { all: true });
}
async function configSheet(org) {
  const r = await sb.rpc("wallet_settings_get", { p_org: org }); if (r.error) return toast(errText(r.error)); const c = r.data;
  const sw = (id, label, on) => `<label class="mc-radio"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;
  const sh = sheet(`<h2>Modelo e políticas</h2>
    <label class="field"><span>Título da carteira</span><input id="ti" maxlength="40" value="${attr(c.title)}"></label>
    <label class="field"><span>Nome da igreja exibido</span><input id="cn" maxlength="80" value="${attr(c.church_name)}"></label>
    <div class="row gap"><label class="field grow"><span>Cor institucional</span><input id="ac" type="color" value="${attr(c.accent)}"></label><label class="field grow"><span>Estilo</span><select id="sty"><option value="dark">Escuro</option><option value="light">Claro</option><option value="accent">Cor da igreja</option></select></label></div>
    <div class="field"><span>Informações exibidas</span>${sw("sl", "Logo da igreja", c.show_logo)}${sw("sp", "Fotografia", c.show_photo)}${sw("sm", "Matrícula", c.show_matricula)}${sw("sd", "Data de emissão", c.show_issue_date)}</div>
    <div class="field"><span>Página pública de validação</span>${sw("pp", "Mostrar fotografia", c.public_photo)}${sw("pm", "Mostrar matrícula", c.public_matricula)}</div>
    <label class="field"><span>Emissão</span><select id="ip"><option value="manual">Só a administração emite</option><option value="auto">O membro elegível emite ao abrir a carteira</option></select></label>
    <label class="field"><span>Quando o membro fica inativo</span><select id="sp2"><option value="auto">Suspender a carteira automaticamente</option><option value="manual">Manter até a administração suspender</option></select></label>
    <div class="row gap"><label class="field grow"><span>Prefixo da matrícula</span><input id="px" maxlength="6" value="${attr(c.matricula_prefix)}"></label><label class="field grow"><span>Dígitos</span><input id="dg" type="number" min="3" max="8" value="${c.matricula_digits}"></label></div>
    <p class="tiny muted">O formato vale para as próximas matrículas. As já emitidas não mudam. Próximo número: ${c.matricula_next}.</p>
    <button class="btn block" id="ok">Salvar</button>`);
  sh.el.querySelector("#sty").value = c.style; sh.el.querySelector("#ip").value = c.issue_policy; sh.el.querySelector("#sp2").value = c.suspension_policy;
  const g = (id) => sh.el.querySelector("#" + id);
  g("ok").onclick = async (e) => {
    busy(e.currentTarget); const x = await sb.rpc("wallet_settings_save", { p_org: org, p: { title: g("ti").value, church_name: g("cn").value, accent: g("ac").value, style: g("sty").value, show_logo: g("sl").checked, show_photo: g("sp").checked, show_matricula: g("sm").checked, show_issue_date: g("sd").checked,
      public_photo: g("pp").checked, public_matricula: g("pm").checked, issue_policy: g("ip").value, suspension_policy: g("sp2").value, matricula_prefix: g("px").value, matricula_digits: +g("dg").value } }); busy(e.currentTarget, false);
    if (x.error) return toast(/invalid_config/.test(x.error.message) ? "Confira o título, a cor e o prefixo (letras e números)." : errText(x.error)); sh.close(); toast("Configuração salva");
  };
}
