// Peças de tela comuns aos módulos novos (Células, Programações, Escalas...).
import { sb, state, esc, icon, sheet, empty, spinner } from "../core.js";
import { errText } from "./pessoas-import.js";

export const SETUP = `<div class="card small">Esta parte precisa da atualização do banco de dados. Rode o arquivo <b>atualizacao-2026-12-05-celulas-programacoes-escalas.sql</b> no SQL Editor do Supabase.</div>`;
export const missing = (e) => /function|does not exist|schema cache/i.test(e?.message || "") && !/forbidden/.test(e?.message || "");
export const head = (t, back = ["#/chamados", "SOMOS Chamados"], extra = "") => `<div class="pagehead"><h1>${esc(t)}</h1>${extra}</div>${back ? `<div class="mb"><a class="btn ghost sm" href="${back[0]}">${icon("chevronLeft")} ${esc(back[1])}</a></div>` : ""}`;
export const fail = (el, title, e, back) => { el.innerHTML = `${head(title, back)}${missing(e) ? SETUP : empty("lock", /forbidden|not_found/.test(e?.message || "") ? "Você não tem acesso a esta área." : "Não foi possível carregar.", esc(errText(e)))}`; };
export const fmtDay = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "");
export const fmtWhen = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
export const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
export const toLocalInput = (d) => { const x = new Date(d); return `${iso(x)}T${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
export const CLS = { member: "Membro", attender: "Frequentador", visitor: "Visitante" };

// busca de pessoas (mínimo de 2 letras; só nome e classificação)
export function pickPerson(title, onPick, { exclude = [] } = {}) {
  const s = sheet(`<h3>${esc(title)}</h3><input class="psearch" id="q" type="search" placeholder="Digite ao menos 2 letras do nome" aria-label="Buscar pessoa" autocomplete="off"><div id="res" class="list mt"></div>`);
  const res = s.el.querySelector("#res"); let t, seq = 0;
  s.el.querySelector("#q").oninput = (e) => {
    clearTimeout(t); const q = e.target.value;
    t = setTimeout(async () => {
      const my = ++seq; if (q.trim().length < 2) { res.innerHTML = ""; return; }
      const r = await sb.rpc("mod_people_search", { p_org: state.org.id, p_q: q }); if (my !== seq) return;
      if (r.error) { res.innerHTML = `<div class="li muted small">${esc(errText(r.error))}</div>`; return; }
      const list = r.data.filter((p) => !exclude.includes(p.id));
      res.innerHTML = list.map((p) => `<button class="li" data-id="${p.id}" data-n="${esc(p.name)}"><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${esc(CLS[p.classification] || "")}</span></span></button>`).join("") || `<div class="li muted small">Ninguém encontrado.</div>`;
    }, 250);
  };
  res.onclick = (e) => { const b = e.target.closest("[data-id]"); if (!b) return; s.close(); onPick({ id: b.dataset.id, name: b.dataset.n }); };
  setTimeout(() => s.el.querySelector("#q")?.focus(), 50);
  return s;
}
export { spinner };
