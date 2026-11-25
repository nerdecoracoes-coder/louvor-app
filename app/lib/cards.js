// Cards visuais reutilizáveis (central de descoberta do SOMOS Um e outras telas).
// Formatos: feature (destaque com imagem), content (estudo/pregação), event, journey, progress (atividade pendente), notice, horizontal, compact.
// Sem imagem (ou com a imagem quebrada), o card usa uma composição com ícone e as cores do SOMOS.
import { esc, attr, icon } from "../core.js";

const hrefOf = (c) => c.route || c.url || "#/";
const extern = (c) => !c.route && !!c.url;
const open = (c) => `href="${attr(hrefOf(c))}"${extern(c) ? ` target="_blank" rel="noopener noreferrer"` : ""}`;
const img = (c) => (c.image ? `<img src="${attr(c.image)}" alt="${attr(c.title)}" loading="lazy" decoding="async">` : "");
const art = (c, ic) => `<span class="dc-art" data-k="${attr(c.key)}">${img(c)}<i class="dc-ico">${icon(c.icon || ic)}</i></span>`;
const go = (c) => `<span class="dc-go">${esc(c.action || "Abrir")} ${icon("chevronRight")}</span>`;

const KIND = {
  feature: (c) => `<a class="dc dc-feature${c.urgent ? " dc-urgent" : ""}" ${open(c)}>${art(c, "megaphone")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Destaque")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  content: (c) => `<a class="dc dc-content" ${open(c)}>${art(c, "play")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Conteúdo")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  event: (c) => `<a class="dc dc-event" ${open(c)}>${art(c, "calendar")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Agenda")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  journey: (c) => `<a class="dc dc-journey" ${open(c)}>${art(c, "route")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Jornadas")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  progress: (c) => `<a class="dc dc-progress" ${open(c)}>${art(c, "route")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Sua jornada")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}
    ${Number.isFinite(c.pct) ? `<span class="bar" role="progressbar" aria-valuenow="${c.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${c.pct}%"></i></span><small class="dc-pct">${c.pct}% concluído</small>` : ""}${go(c)}</span></a>`,
  notice: (c) => `<a class="dc dc-notice" ${open(c)}>${art(c, "megaphone")}<span class="dc-body"><span class="dc-tag">${esc(c.label || "Comunicado")}</span><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  horizontal: (c) => `<a class="dc dc-h" ${open(c)}><i class="dc-round">${icon(c.icon || "star")}</i><span class="dc-body"><b>${esc(c.title)}</b>${c.body ? `<small>${esc(c.body)}</small>` : ""}${go(c)}</span></a>`,
  compact: (c) => `<a class="dc dc-compact" ${open(c)}><i class="dc-round">${icon(c.icon || "star")}</i><span class="dc-body"><b>${esc(c.title)}</b><span class="dc-go">${esc(c.action || "Abrir")} ${icon("chevronRight")}</span></span></a>`,
};

export const discoverCard = (c) => (KIND[c.kind] || KIND.compact)(c);

// seção "Para você": rolagem horizontal no celular e grade no computador
export function discoverSection(cards, title = "Para você") {
  if (!cards?.length) return "";
  return `<section class="disc" aria-label="${attr(title)}"><div class="sec"><h2>${esc(title)}</h2></div><div class="disc-row">${cards.map(discoverCard).join("")}</div></section>`;
}

// imagem que não carrega some e deixa à mostra a composição de fundo
export function wireImages(root) {
  root.querySelectorAll(".dc-art img").forEach((im) => {
    const drop = () => im.remove();
    im.addEventListener("error", drop, { once: true });
    if (im.complete && im.naturalWidth === 0) drop();
  });
}
