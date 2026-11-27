// Integrações (Fase 6B): visão geral e monitoramento, chaves de API, webhooks, entregas com reenvio e logs.
// Toda regra (permissão, escopo, limite, segredos) está no banco e nas Edge Functions; aqui só se escolhe como mostrar.
// Segredos (chave de API e segredo de assinatura) aparecem uma única vez, na criação.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen } from "../lib/mod-ui.js";

const BACK = ["#/chamados", "SOMOS Chamados"];
const org = () => state.org?.id;
const tag = (t, c = "none") => `<span class="ptag ${c}" style="white-space:nowrap">${esc(t)}</span>`;
const ROW = `class="row between" style="gap:8px;flex-wrap:wrap"`;
const SCOPES = [["events:read", "Eventos publicados", "Título, data, local e inscrição dos eventos abertos a todos."], ["programs:read", "Programações públicas", "Cultos e atividades com visibilidade pública."], ["sermons:read", "Pregações", "Pregações publicadas para todos."], ["contents:read", "Conteúdos", "Vídeos, áudios e estudos publicados para todos."]];
const EVENTS = [["person.created", "Pessoa cadastrada", "Nome, classificação e situação. Nunca CPF, e-mail ou telefone."], ["person.updated", "Pessoa atualizada", "Só quando nome, classificação ou situação mudam."], ["event.created", "Evento criado", "Título, data, situação e público."],
  ["registration.created", "Inscrição realizada", "Sem o nome de quem se inscreveu."], ["attendance.recorded", "Presença registrada", "Check-in de uma inscrição, com a quantidade."], ["contribution.recorded", "Contribuição registrada", "Valor, data, categoria e forma. Nunca a pessoa. Exige permissão financeira."], ["program.published", "Programação publicada", "Só programações de visibilidade pública."]];
const EV_LABEL = { ...Object.fromEntries(EVENTS.map((e) => [e[0], e[1]])), "webhook.test": "Teste de conexão" };
const ST = { pending: ["Na fila", "none"], failed: ["Falhou, vai tentar de novo", "warn"], dead: ["Abandonada", "st-rejected"], success: ["Entregue", "st-approved"] };
const SRC = { api: "API", webhook: "Webhooks", push: "Push", system: "Sistema" };
const SERVICES = [
  ["Notificação no celular (push)", "Código pronto. Passa a funcionar quando as chaves VAPID forem configuradas no servidor.", "push"],
  ["Pagamento (Pix e cartão)", "Não conectado. Exige provedor, contrato e credenciais. Não existe cobrança pelo app."],
  ["E-mail", "Não conectado. Exige provedor e domínio autenticado."],
  ["Mensagens (WhatsApp, SMS)", "Não conectado. Exige conta oficial do provedor e credenciais."],
  ["Armazenamento de arquivos", "Em uso: Supabase Storage (imagens e comprovantes) e, quando configurados, Google Drive e Cloudflare R2 para mídia dos times."],
  ["Transmissão e vídeo", "Por link: o card “Assistir ao vivo” da Home abre YouTube ou outro serviço. Sem player dentro do app."],
  ["Sistemas externos de gestão", "Use a API e os webhooks desta tela."]];

export function register(route) { route("/integracoes", (p, el, a) => integrations(el, a)); }

const showSecret = (title, hint, secret, done) => {
  const s = sheet(`<h3>${esc(title)}</h3><p class="small muted">${esc(hint)}</p><div class="card" style="overflow-wrap:anywhere"><b style="font-size:14px;letter-spacing:.02em" id="sc">${esc(secret)}</b></div><div class="row gap-s mt"><button class="btn grow" id="cp">${icon("copy")} Copiar</button><button class="btn ghost grow" id="fx">Fechar</button></div>`, { onClose: done });
  s.el.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(secret); toast("Copiado."); } catch { toast("Copie manualmente."); } };
  s.el.querySelector("#fx").onclick = () => s.close();
};

async function integrations(el, alive) {
  el.innerHTML = `${head("Integrações", BACK)}${spinner()}`;
  const acc = await sb.rpc("integ_access", { p_org: org() }); if (!alive()) return;
  if (acc.error || !acc.data?.manage) return fail(el, "Integrações", acc.error || { message: "forbidden" }, BACK);
  const fin = !!acc.data.fin;
  const TABS = [["ger", "Visão geral"], ["api", "Chaves de API"], ["whk", "Webhooks"], ["ent", "Entregas"], ["log", "Logs"]];
  let tab = "ger", fStatus = "", fSource = "", fLevel = "";
  const draw = async () => {
    el.innerHTML = `${head("Integrações", BACK)}<nav class="tabs">${TABS.map((t) => `<button class="${tab === t[0] ? "on" : ""}" data-t="${t[0]}">${t[1]}</button>`).join("")}</nav><div id="body">${spinner()}</div>`;
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    await ({ ger: gerTab, api: apiTab, whk: whkTab, ent: entTab, log: logTab }[tab])(el.querySelector("#body"));
  };
  const err = (body, e) => (body.innerHTML = `<div class="card small">${esc(errText(e))}</div>`);
  const run = async (btn, fn, args, ok, after) => { busy(btn); const x = await sb.rpc(fn, args); if (x.error) { busy(btn, false); toast(errText(x.error)); return null; } if (ok) toast(ok); if (after) await after(x.data); return x.data; };
  const checks = (list, sel = []) => list.map((x) => `<label class="li"><span class="grow"><span class="t">${esc(x[1])}</span><span class="s">${esc(x[2])}</span></span><input type="checkbox" value="${x[0]}" ${sel.includes(x[0]) ? "checked" : ""} ${x[3] ? "disabled" : ""}></label>`).join("");

  // ---------------------------------------------------------------- visão geral
  async function gerTab(body) {
    const r = await sb.rpc("integ_status", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    const s = r.data, hb = Object.fromEntries(s.heartbeats.map((h) => [h.source, h]));
    const beat = (src, label) => { const h = hb[src]; return `<div class="drow"><span>${label}</span><b>${!h ? "Nunca executou" : h.state === "late" ? "Sem execução há mais de 15 min" : "Em dia"}</b></div>${!h ? `<p class="small muted" style="margin:0 0 6px">Falta agendar a função no servidor (veja a documentação).</p>` : h.state === "late" ? `<p class="small" style="margin:0 0 6px;color:var(--warn)">Última execução: ${fmtWhen(h.last_run_at)}. Confira o agendamento.</p>` : `<p class="small muted" style="margin:0 0 6px">Última execução: ${fmtWhen(h.last_run_at)}</p>`}`; };
    const base = `${(window.LOUVOR_CONFIG?.supabaseUrl || "").replace(/\/$/, "")}/functions/v1/api/v1`;
    body.innerHTML = `<div class="card"><h3 style="margin-top:0">Webhooks</h3>
        <div class="drow"><span>Endereços ativos</span><b>${s.webhooks.endpoints_active}</b></div><div class="drow"><span>Na fila ou aguardando nova tentativa</span><b>${s.webhooks.pending}</b></div><div class="drow"><span>Falhas nas últimas 24 h</span><b>${s.webhooks.failed_24h}</b></div><div class="drow"><span>Abandonadas (precisam de reenvio)</span><b>${s.webhooks.dead}</b></div>
        ${s.webhooks.endpoints_disabled ? `<div class="drow"><span>Endereços desativados</span><b>${s.webhooks.endpoints_disabled}</b></div>` : ""}${beat("webhooks", "Envio automático")}</div>
      <div class="card mt"><h3 style="margin-top:0">API</h3><div class="drow"><span>Chaves ativas</span><b>${s.api.keys_active}</b></div><div class="drow"><span>Requisições nas últimas 24 h</span><b>${s.api.requests_24h}</b></div><div class="drow"><span>Com erro nas últimas 24 h</span><b>${s.api.errors_24h}</b></div></div>
      <div class="card mt"><h3 style="margin-top:0">Notificação no celular</h3><div class="drow"><span>Aparelhos cadastrados</span><b>${s.push.devices}</b></div><div class="drow"><span>Avisos aguardando envio</span><b>${s.push.pending}</b></div>
        <div class="drow"><span>Chaves de envio</span><b>${s.push.configured ? "Configuradas" : "Não configuradas"}</b></div>${beat("push", "Envio automático")}</div>
      <h3 class="mt">Serviços externos</h3><div class="list">${SERVICES.map((x) => `<div class="li col stack" style="align-items:stretch"><b>${esc(x[0])}</b><span class="small muted">${esc(x[1])}</span></div>`).join("")}</div>
      <h3 class="mt">Como usar a API</h3><div class="card small"><p style="margin-top:0">Somente leitura, versão 1. Envie a chave no cabeçalho <code>Authorization: Bearer &lt;chave&gt;</code>. A chave na URL não é aceita.</p>
        <p class="muted" style="overflow-wrap:anywhere">Endereço base: ${esc(base)}</p><p class="muted">Recursos: <code>/ping</code>, <code>/events</code>, <code>/programs</code>, <code>/sermons</code>, <code>/contents</code>. Parâmetros: <code>limit</code> (1 a 100) e <code>offset</code>. Respostas de erro trazem <code>error.code</code>. Ao passar do limite por minuto, a resposta é 429 com <code>Retry-After</code>.</p>
        <p class="muted" style="margin-bottom:0">A API não entrega pessoas, financeiro nem conteúdo restrito. Documentação completa em <code>docs/api.md</code>.</p></div>`;
  }

  // ---------------------------------------------------------------- chaves de API
  async function apiTab(body) {
    const r = await sb.rpc("api_key_list", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    const KS = { active: ["Ativa", "st-approved"], revoked: ["Revogada", "st-rejected"], expired: ["Vencida", "warn"] };
    body.innerHTML = `<p class="small muted">Chaves dão acesso de leitura ao que a igreja já publica para todos. Cada uma tem escopo, limite por minuto e validade. A chave completa aparece só ao criar.</p><button class="btn primary sm mb" id="new">${icon("plus")} Nova chave</button>
      <div class="list">${r.data.map((k) => `<div class="li col stack" style="align-items:stretch"><div ${ROW}><b>${esc(k.name)}</b>${tag(...KS[k.state])}</div><span class="small muted" style="overflow-wrap:anywhere">${esc(k.prefix)}… · ${k.rate_limit} por minuto</span>
        <span class="row gap-s" style="flex-wrap:wrap">${k.scopes.map((x) => tag(SCOPES.find((s) => s[0] === x)?.[1] || x)).join("")}</span>
        <span class="small muted">${k.expires_at ? "Vale até " + fmtWhen(k.expires_at) : "Sem validade"} · ${k.last_used_at ? "usada em " + fmtWhen(k.last_used_at) : "nunca usada"}</span>${k.state === "active" ? `<button class="link small danger" data-rv="${k.id}" data-n="${attr(k.name)}" style="align-self:flex-start">Revogar</button>` : ""}</div>`).join("") || empty("link", "Nenhuma chave criada")}</div>`;
    body.querySelector("#new").onclick = () => {
      const s = sheet(`<h3>Nova chave de API</h3><label class="fld">Nome (para você lembrar onde é usada)<input id="nm" maxlength="60" placeholder="Ex.: Site da igreja"></label>
        <div class="fld">Pode ler<div class="stack" style="gap:8px">${checks(SCOPES, ["events:read"])}</div></div>
        <label class="fld">Limite por minuto<select id="rt">${[30, 60, 120, 300].map((n) => `<option ${n === 60 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="fld">Validade<select id="dy"><option value="90">90 dias</option><option value="365" selected>1 ano</option><option value="">Sem validade (não recomendado)</option></select></label><div class="row gap-s mt"><button class="btn grow" id="ok">Gerar chave</button></div>`);
      s.el.querySelector("#ok").onclick = async (ev) => {
        const sc = [...s.el.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value); if (!sc.length) return toast("Marque ao menos um recurso.");
        const d = await run(ev.currentTarget, "api_key_create", { p_org: org(), p_name: s.el.querySelector("#nm").value, p_scopes: sc, p_rate: Number(s.el.querySelector("#rt").value), p_days: s.el.querySelector("#dy").value ? Number(s.el.querySelector("#dy").value) : null });
        if (d) { s.close(); showSecret("Chave criada", "Copie agora: ela não será mostrada de novo. Guarde em local seguro e nunca coloque em páginas públicas.", d.key, draw); }
      };
    };
    body.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog(`Revogar a chave “${b.dataset.n}”? Quem a usa perde o acesso na hora.`, "Revogar", true))) return; run(b, "api_key_revoke", { p_id: b.dataset.rv }, "Chave revogada.", draw); }));
  }

  // ---------------------------------------------------------------- webhooks
  async function whkTab(body) {
    const r = await sb.rpc("wh_list", { p_org: org() }); if (!alive()) return; if (r.error) return err(body, r.error);
    body.innerHTML = `<p class="small muted">Avisamos o endereço que você cadastrar quando algo acontece. Cada envio é assinado com o segredo do endereço (HMAC-SHA256), repetido em caso de falha e fica registrado em Entregas.</p><button class="btn primary sm mb" id="new">${icon("plus")} Novo endereço</button>
      <div class="list">${r.data.map((w) => `<div class="li col stack" style="align-items:stretch"><div ${ROW}><b>${esc(w.name)}</b>${w.active ? tag("Ativo", "st-approved") : tag("Desativado", "warn")}</div><span class="small muted" style="overflow-wrap:anywhere">${esc(w.url)}</span>
        <span class="row gap-s" style="flex-wrap:wrap">${w.events.map((x) => tag(EV_LABEL[x] || x)).join("")}</span>
        ${w.disabled_reason ? `<span class="small" style="color:var(--warn)">${esc(w.disabled_reason)}</span>` : ""}
        <span class="small muted">Segredo ${esc(w.secret_hint)} · ${w.pending} na fila · ${w.dead} abandonadas${w.last ? ` · último: ${esc((ST[w.last.status] || [w.last.status])[0])} em ${fmtWhen(w.last.at)}` : ""}</span>
        <span class="row gap-s" style="flex-wrap:wrap"><button class="link small" data-ed="${w.id}">Editar</button><button class="link small" data-ts="${w.id}">Testar</button><button class="link small" data-sc="${w.id}">Novo segredo</button><button class="link small" data-ac="${w.id}" data-on="${w.active ? 0 : 1}">${w.active ? "Desativar" : "Ativar"}</button><button class="link small danger" data-dl="${w.id}" data-n="${attr(w.name)}">Excluir</button></span></div>`).join("") || empty("link", "Nenhum endereço cadastrado")}</div>`;
    const form = (w) => {
      const v = w || { events: ["person.created"] };
      const s = sheet(`<h3>${w ? "Editar endereço" : "Novo endereço"}</h3><label class="fld">Nome<input id="nm" maxlength="60" value="${attr(v.name || "")}" placeholder="Ex.: Sistema de contabilidade"></label>
        <label class="fld">Endereço de destino (https://…)<input id="ur" inputmode="url" value="${attr(v.url || "")}" placeholder="https://exemplo.com.br/webhook"></label><p class="small muted">Só https e endereços públicos. Endereços internos, IP e localhost são recusados.</p>
        <div class="fld">Avisar quando<div class="stack" style="gap:8px">${checks(EVENTS.map((e) => [e[0], e[1], e[2], e[0] === "contribution.recorded" && !fin]), v.events)}</div></div><div class="row gap-s mt"><button class="btn grow" id="ok">Salvar</button></div>`);
      s.el.querySelector("#ok").onclick = async (ev) => {
        const evs = [...s.el.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value); if (!evs.length) return toast("Marque ao menos um evento.");
        const d = await run(ev.currentTarget, "wh_save", { p_org: org(), p_id: w?.id || null, p: { name: s.el.querySelector("#nm").value, url: s.el.querySelector("#ur").value.trim(), events: evs } });
        if (!d) return; s.close(); if (d.secret) showSecret("Endereço criado", "Este é o segredo de assinatura. Copie agora: não será mostrado de novo. Use-o para conferir o cabeçalho X-Somos-Signature.", d.secret, draw); else { toast("Endereço salvo."); draw(); }
      };
    };
    body.querySelector("#new").onclick = () => form(null);
    body.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => form(r.data.find((w) => w.id === b.dataset.ed))));
    body.querySelectorAll("[data-ts]").forEach((b) => (b.onclick = () => run(b, "wh_test", { p_id: b.dataset.ts }, "Teste na fila. Veja o resultado em Entregas em alguns instantes.")));
    body.querySelectorAll("[data-sc]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog("Gerar um novo segredo? O atual deixa de valer e o destino precisa ser atualizado.", "Gerar", true))) return; const d = await run(b, "wh_rotate_secret", { p_id: b.dataset.sc }); if (d) showSecret("Novo segredo", "Copie agora: não será mostrado de novo.", d.secret, draw); }));
    body.querySelectorAll("[data-ac]").forEach((b) => (b.onclick = () => run(b, "wh_set_active", { p_id: b.dataset.ac, p_on: b.dataset.on === "1" }, b.dataset.on === "1" ? "Endereço ativado." : "Endereço desativado.", draw)));
    body.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog(`Excluir “${b.dataset.n}” e o histórico de entregas dele?`, "Excluir", true))) return; run(b, "wh_delete", { p_id: b.dataset.dl }, "Endereço excluído.", draw); }));
  }

  // ---------------------------------------------------------------- entregas
  async function entTab(body) {
    const r = await sb.rpc("wh_deliveries", { p_org: org(), p_endpoint: null, p_status: fStatus || null, p_limit: 100 }); if (!alive()) return; if (r.error) return err(body, r.error);
    body.innerHTML = `<label class="fld">Situação<select id="fs"><option value="">Todas</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === fStatus ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
      <div class="list">${r.data.map((d) => `<div class="li col stack" style="align-items:stretch"><div ${ROW}><b>${esc(EV_LABEL[d.event_type] || d.event_type)}</b>${tag(...(ST[d.status] || [d.status]))}</div><span class="small muted">${esc(d.endpoint)} · ${d.attempts} ${d.attempts === 1 ? "tentativa" : "tentativas"}${d.response_status ? ` · resposta ${d.response_status}` : ""} · ${fmtWhen(d.delivered_at || d.last_attempt_at || d.created_at)}</span>
        ${d.error ? `<span class="small" style="color:var(--warn)">${esc(d.error)}</span>` : ""}${d.status === "failed" && d.next_attempt_at ? `<span class="small muted">Próxima tentativa: ${fmtWhen(d.next_attempt_at)}</span>` : ""}
        ${d.status === "failed" || d.status === "dead" ? `<button class="link small" data-rt="${d.id}" style="align-self:flex-start">Reenviar agora</button>` : ""}</div>`).join("") || empty("inbox", "Nenhuma entrega")}</div>
      <p class="small muted mt">Reenviar é seguro: o destino recebe o mesmo identificador (X-Somos-Delivery) e pode ignorar repetições.</p>`;
    body.querySelector("#fs").onchange = (e) => { fStatus = e.target.value; draw(); };
    body.querySelectorAll("[data-rt]").forEach((b) => (b.onclick = () => run(b, "wh_retry", { p_delivery: Number(b.dataset.rt) }, "Entrega na fila para reenvio.", draw)));
  }

  // ---------------------------------------------------------------- logs
  async function logTab(body) {
    const r = await sb.rpc("integ_log_list", { p_org: org(), p_source: fSource || null, p_level: fLevel || null, p_limit: 150 }); if (!alive()) return; if (r.error) return err(body, r.error);
    const LV = { info: ["Info", "none"], warn: ["Atenção", "warn"], error: ["Erro", "st-rejected"] };
    body.innerHTML = `<div class="grid2"><label class="fld">Origem<select id="fo"><option value="">Todas</option>${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${k === fSource ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="fld">Nível<select id="fl"><option value="">Todos</option>${Object.entries(LV).map(([k, v]) => `<option value="${k}" ${k === fLevel ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label></div>
      <p class="small muted">Chaves e segredos nunca são gravados nos logs. Registros com mais de 90 dias são apagados.</p>
      <div class="list">${r.data.map((l) => `<div class="li col stack" style="align-items:stretch"><div ${ROW}><b style="overflow-wrap:anywhere">${esc(l.event)}</b>${tag(...LV[l.level])}</div><span class="small muted">${esc(SRC[l.source] || l.source)} · ${fmtWhen(l.at)}${l.detail?.status ? ` · ${l.detail.status}` : ""}${l.detail?.ms != null ? ` · ${l.detail.ms} ms` : ""}</span>${l.detail?.error ? `<span class="small" style="color:var(--warn)">${esc(l.detail.error)}</span>` : ""}</div>`).join("") || empty("clock", "Nenhum registro")}</div>`;
    body.querySelector("#fo").onchange = (e) => { fSource = e.target.value; draw(); }; body.querySelector("#fl").onchange = (e) => { fLevel = e.target.value; draw(); };
  }
  draw();
}
