// Destaques do SOMOS Um: campanhas, estudos e pregações com público, período e prioridade; ordem dos cards. Tudo é conferido no servidor.
import { sb, state, esc, attr, icon, sheet, toast, busy, empty, spinner, confirmDialog, modCan, pickFile, uploadPublic } from "../core.js";
import { errText } from "../lib/pessoas-import.js";
import { head, fail, fmtWhen, toLocalInput } from "../lib/mod-ui.js";

export function register(route) {
  route("/destaques", (p, el, a) => home(el, a));
}

const KINDS = { campaign: "Campanha ou destaque", study: "Estudo", sermon: "Pregação" };
const AUD = { all: "Todos", visitor: "Visitantes", attender: "Frequentadores", member: "Membros", journey: "Participantes de uma jornada", segment: "Um segmento de pessoas" };
const CARDS = { continue: "Continue sua jornada", campaign: "Campanhas e destaques", study: "Estudo", sermon: "Última pregação", events: "Próximos eventos", notices: "Comunicados", journeys: "Jornadas abertas",
  decision: "Decidi seguir a Jesus", wallet: "Carteira digital", ministries: "Ministérios e participação", contact: "Solicitar contato", cadastro: "Atualizar cadastro" };
const BACK = ["#/chamados", "SOMOS Chamados"];
const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-06-menu-inteligente.sql</b> no SQL Editor do Supabase.</div>`;
const opt = (o, cur) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
const state_ = (i) => (!i.active ? ["Desativado", "none"] : i.ends_at && new Date(i.ends_at) < new Date() ? ["Encerrado", "none"] : i.starts_at && new Date(i.starts_at) > new Date() ? ["Agendado", "st-pending"] : ["No ar", "attender"]);

async function home(el, alive) {
  const org = state.org?.id;
  if (!org || !modCan("discover_manage")) { el.innerHTML = `${head("Destaques do SOMOS Um", BACK)}${empty("lock", "Você não tem acesso a esta área.")}`; return; }
  el.innerHTML = `${head("Destaques do SOMOS Um", BACK)}${spinner()}`;
  const r = await sb.rpc("discover_list", { p_org: org });
  if (!alive()) return;
  if (r.error) { if (/function|does not exist|schema cache/i.test(r.error.message || "")) el.innerHTML = `${head("Destaques do SOMOS Um", BACK)}${SETUP}`; else fail(el, "Destaques do SOMOS Um", r.error, BACK); return; }
  const d = r.data, items = d.items;
  const order = (d.settings?.card_order?.length ? d.settings.card_order : ["continue", "campaign", "study", "sermon", "events", "notices", "journeys", "decision", "wallet", "ministries", "contact", "cadastro"]);
  const max = d.settings?.max_cards || 8;
  const paint = () => {
    el.innerHTML = `${head("Destaques do SOMOS Um", BACK, `<button class="btn primary sm" id="new">${icon("plus")} Novo destaque</button>`)}
      <p class="muted small" style="margin:-4px 0 14px">O que aparece em "Para você" na página inicial. Estudos, pregações e campanhas só aparecem se você cadastrar. Os demais cards (eventos, comunicados, jornadas, carteira…) são automáticos e só surgem quando há conteúdo real.</p>
      <div class="list">${items.map((i) => { const [t, c] = state_(i); return `<div class="li col" style="align-items:stretch"><div class="row between"><b>${esc(i.title)}</b><span class="ptag ${c}">${t}</span></div>
        <span class="small muted">${esc(KINDS[i.kind])} · ${esc(AUD[i.audience])}${i.urgent ? " · urgente" : ""} · prioridade ${i.priority}${i.starts_at || i.ends_at ? ` · ${i.starts_at ? fmtWhen(i.starts_at) : "agora"} até ${i.ends_at ? fmtWhen(i.ends_at) : "sem fim"}` : ""}</span>
        <div class="row gap-s mt"><button class="btn ghost sm" data-ed="${i.id}">Editar</button><button class="btn ghost sm" data-tg="${i.id}">${i.active ? "Desativar" : "Ativar"}</button><button class="btn ghost sm" data-ar="${i.id}">Arquivar</button></div></div>`; }).join("") || empty("sparkle", "Nenhum destaque cadastrado", "Crie uma campanha, um estudo ou uma pregação para aparecer na página inicial.")}</div>
      <h3 class="mt">Ordem dos cards</h3>
      <p class="muted small">Marque o que pode aparecer e ordene. Comunicados urgentes sempre vão na frente. Os convites institucionais mudam de lugar a cada dia para a página não ficar repetitiva.</p>
      <div class="list" id="ord">${order.map((k, n) => `<div class="li" data-k="${k}"><label class="row gap-s grow"><input type="checkbox" checked data-on> <span>${esc(CARDS[k] || k)}</span></label><button class="btn ghost sm" data-mv="-1" ${n === 0 ? "disabled" : ""} aria-label="Subir">${icon("chevronLeft")}</button><button class="btn ghost sm" data-mv="1" ${n === order.length - 1 ? "disabled" : ""} aria-label="Descer">${icon("chevronRight")}</button></div>`).join("")}
        ${d.keys.filter((k) => !order.includes(k)).map((k) => `<div class="li" data-k="${k}"><label class="row gap-s grow"><input type="checkbox" data-on> <span>${esc(CARDS[k] || k)}</span></label></div>`).join("")}</div>
      <label class="fld mt">Quantidade máxima de cards<select id="max">${[3, 4, 5, 6, 8, 10, 12].map((n) => `<option ${n === max ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <button class="btn block mt" id="saveord">Salvar ordem</button>`;
    el.querySelector("#new").onclick = () => form(null);
    el.querySelector("#ord").onclick = (e) => {
      const b = e.target.closest("[data-mv]"); if (!b) return; const row = b.closest("[data-k]"), dir = Number(b.dataset.mv);
      const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sib || !sib.querySelector("[data-mv]")) return;
      dir < 0 ? row.parentNode.insertBefore(row, sib) : row.parentNode.insertBefore(sib, row);
      order.splice(0, order.length, ...[...el.querySelectorAll("#ord [data-k]")].map((x) => x.dataset.k));
      [...el.querySelectorAll("#ord [data-k]")].forEach((x, n, all) => x.querySelectorAll("[data-mv]").forEach((m) => { m.disabled = (Number(m.dataset.mv) < 0 && n === 0) || (Number(m.dataset.mv) > 0 && (n === all.length - 1 || !all[n + 1].querySelector("[data-mv]"))); }));
    };
    el.querySelector("#saveord").onclick = async (e) => {
      const b = e.currentTarget, list = [...el.querySelectorAll("#ord [data-k]")].filter((x) => x.querySelector("[data-on]").checked).map((x) => x.dataset.k);
      if (!list.length) return toast("Deixe ao menos um tipo de card marcado.");
      busy(b); const rr = await sb.rpc("discover_settings_save", { p_org: org, p_order: list, p_max: Number(el.querySelector("#max").value) }); busy(b, false);
      if (rr.error) return toast(errText(rr.error)); toast("Ordem salva."); home(el, alive);
    };
    el.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => form(items.find((x) => x.id === b.dataset.ed))));
    el.querySelectorAll("[data-tg]").forEach((b) => (b.onclick = async () => { const i = items.find((x) => x.id === b.dataset.tg); const rr = await sb.rpc("discover_set_active", { p_id: i.id, p_active: !i.active }); if (rr.error) return toast(errText(rr.error)); toast(i.active ? "Destaque desativado." : "Destaque ativado."); home(el, alive); }));
    el.querySelectorAll("[data-ar]").forEach((b) => (b.onclick = async () => { if (!(await confirmDialog("Arquivar este destaque? Ele sai da página inicial e da lista, mas o registro é mantido.", "Arquivar"))) return; const rr = await sb.rpc("discover_archive", { p_id: b.dataset.ar }); if (rr.error) return toast(errText(rr.error)); toast("Destaque arquivado."); home(el, alive); }));
  };
  const form = (it) => {
    const v = it || { kind: "campaign", audience: "all", priority: 50, urgent: false, active: true };
    const s = sheet(`<h3>${it ? "Editar destaque" : "Novo destaque"}</h3>
      <label class="fld">Tipo<select id="kind">${opt(KINDS, v.kind)}</select></label>
      <label class="fld">Título<input id="title" maxlength="120" value="${attr(v.title || "")}" placeholder="Ex.: Conhecendo a Bíblia"></label>
      <label class="fld">Descrição curta<textarea id="body" maxlength="300" rows="2">${esc(v.body || "")}</textarea></label>
      <label class="fld">Link de destino<input id="url" maxlength="600" inputmode="url" value="${attr(v.url || "")}" placeholder="https://… ou #/agenda"><small class="muted">Vídeo ou página externa (https://…) ou uma tela do aplicativo (ex.: #/jornadas). Sem link, o card não aparece útil: preencha sempre.</small></label>
      <label class="fld">Texto do botão<input id="act" maxlength="40" value="${attr(v.action_label || "")}" placeholder="Ex.: Assistir agora"></label>
      <div class="fld">Imagem (opcional)<div class="row gap-s"><button class="btn ghost sm" id="pic" type="button">${icon("camera")} Escolher imagem</button><button class="btn ghost sm" id="nopic" type="button" ${v.image_url ? "" : "hidden"}>Remover</button></div><img id="prev" alt="" style="max-width:100%;border-radius:10px;margin-top:8px" ${v.image_url ? `src="${attr(v.image_url)}"` : "hidden"}></div>
      <label class="fld">Para quem<select id="aud">${opt(AUD, v.audience)}</select></label>
      <label class="fld" id="jw" hidden>Jornada<select id="jr">${d.journeys.map((j) => `<option value="${j.id}" ${j.id === v.journey_id ? "selected" : ""}>${esc(j.name)}</option>`).join("") || `<option value="">Nenhuma jornada cadastrada</option>`}</select></label>
      <label class="fld" id="sw" hidden>Segmento (da Segmentação de pessoas)<select id="sg">${d.segments.map((j) => `<option value="${j.id}" ${j.id === v.segment_id ? "selected" : ""}>${esc(j.name)}</option>`).join("") || `<option value="">Nenhum segmento ativo</option>`}</select></label>
      <div class="row gap-s"><label class="fld grow">Começa em<input id="st" type="datetime-local" value="${v.starts_at ? toLocalInput(v.starts_at) : ""}"></label><label class="fld grow">Termina em<input id="en" type="datetime-local" value="${v.ends_at ? toLocalInput(v.ends_at) : ""}"></label></div>
      <label class="fld">Prioridade (0 a 100)<input id="pr" type="number" min="0" max="100" value="${v.priority}"></label>
      <label class="switchrow"><span class="grow"><b>Comunicado urgente</b><small>Vai na frente de todos os cards e ganha destaque.</small></span><span class="switch"><input type="checkbox" id="urg" ${v.urgent ? "checked" : ""}><i></i></span></label>
      <label class="switchrow"><span class="grow"><b>Ativo</b></span><span class="switch"><input type="checkbox" id="on" ${v.active ? "checked" : ""}><i></i></span></label>
      <button class="btn block mt" id="ok">Salvar</button>`);
    const q = (x) => s.el.querySelector(x); let image = v.image_url || null;
    const sync = () => { q("#jw").hidden = q("#aud").value !== "journey"; q("#sw").hidden = q("#aud").value !== "segment"; };
    q("#aud").onchange = sync; sync();
    q("#pic").onclick = async () => { const f = await pickFile("image/*"); if (!f) return; try { image = await uploadPublic(`discover/${org}`, f); q("#prev").src = image; q("#prev").hidden = false; q("#nopic").hidden = false; } catch (e) { toast(errText(e)); } };
    q("#nopic").onclick = () => { image = null; q("#prev").hidden = true; q("#nopic").hidden = true; };
    q("#ok").onclick = async (e) => {
      const b = e.currentTarget, loc = (x) => (x ? new Date(x).toISOString() : null);
      const p = { kind: q("#kind").value, title: q("#title").value, body: q("#body").value, url: q("#url").value, action_label: q("#act").value, image_url: image, audience: q("#aud").value,
        journey_id: q("#aud").value === "journey" ? q("#jr").value : null, segment_id: q("#aud").value === "segment" ? q("#sg").value : null, starts_at: loc(q("#st").value), ends_at: loc(q("#en").value),
        priority: Number(q("#pr").value || 50), urgent: q("#urg").checked, active: q("#on").checked };
      if (!p.title.trim()) return toast("Informe o título.");
      if (!p.url.trim()) return toast("Informe o link de destino: o card precisa levar a algum lugar.");
      busy(b); const rr = await sb.rpc("discover_save", { p_org: org, p_id: it?.id || null, p }); busy(b, false);
      if (rr.error) return toast(errText(rr.error)); s.close(); toast("Destaque salvo."); home(el, alive);
    };
  };
  paint();
}
