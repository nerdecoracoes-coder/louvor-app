// "Como acolher": orientações para todos do SOMOS Servos receberem bem quem chega. Página só de leitura (sem formulários).
// O nome do item é provisório: fica em uma única constante para facilitar a troca.
import { state, esc, icon, empty, menuShow, canWelcome, teamOnly } from "../core.js";

export const ACOLHER_NAME = "Como acolher";

const STEPS = [
  { ic: "heart", title: "Receba com carinho.", label: "Primeira visita",
    text: "Receba a pessoa com um sorriso, apresente-se e conduza uma conversa espontânea. Procure conhecer seu nome, mas não transforme esse momento em uma entrevista. Não faça perguntas pessoais em sequência e não pressione a pessoa a fornecer informações.",
    points: ["Seja espontâneo.", "Escute mais do que pergunta.", "Respeite o espaço da pessoa.", "Não transforme o acolhimento em cadastro."] },
  { ic: "church", title: "Ajude a pessoa a conhecer a igreja.", label: "Apresente o SOMOS Um",
    text: "Ao final da conversa, apresente o SOMOS Um como uma maneira simples de conhecer a igreja, acompanhar os cultos, atividades, comunicados e informações institucionais.",
    points: ["Ela pode conhecer a igreja sem se comprometer com nenhuma atividade."], um: true },
  { ic: "phone", title: "Deixe a porta aberta.", label: "Ofereça um contato",
    text: "Pergunte naturalmente se a pessoa gostaria de compartilhar seu telefone para que a igreja possa entrar em contato. Explique que isso é opcional e respeite sua decisão.",
    points: ["Não insistir.", "Não constranger.", "Não solicitar informações desnecessárias.", "Não cadastrar um telefone sem autorização."] },
  { ic: "clock", title: "Relacionamento não tem pressa.", label: "Respeite o tempo da pessoa",
    text: "Se a pessoa retornar, continue recebendo-a com carinho. Aos poucos, conforme ela demonstrar interesse e abertura, apresente a comunidade e suas oportunidades de participação. Cada pessoa tem seu próprio tempo.",
    points: ["Não apresse a integração.", "Não pressione por compromissos.", "Não confunda frequência com obrigação.", "Construa relacionamento e confiança."] },
];

export function register(route) {
  route("/acolher", (p, el) => view(el));
}

function view(el) {
  if (!menuShow("welcome")) { el.innerHTML = `<div class="pagehead"><h1>${esc(ACOLHER_NAME)}</h1></div>${empty("lock", "Esta página é da equipe de acolhimento.", "Ela fica disponível para quem serve em um time com o recurso Visitantes, para a liderança e para quem recebeu a permissão de acolhimento.")}`; return; }
  el.innerHTML = `<div class="pagehead"><h1>${esc(ACOLHER_NAME)}</h1></div>
    <p class="muted" style="margin:-8px 0 18px">Acolher é responsabilidade de todos nós. Quatro passos para receber bem quem chega.</p>
    <div class="acsteps">${STEPS.map((s, i) => `<section class="card acstep">
      <div class="achead"><span class="acnum" aria-hidden="true">${i + 1}</span><div><span class="aclabel">${esc(s.label)}</span><h2>${esc(s.title)}</h2></div></div>
      <p>${esc(s.text)}</p>
      <ul class="acpts">${s.points.map((x) => `<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>
      ${s.um && !teamOnly() ? `<a class="btn ghost sm" href="#/igreja">${icon("church")} Conhecer o SOMOS Um</a>` : ""}
    </section>`).join("")}</div>
    <aside class="card acclose">${icon("heart")}<p>Nosso objetivo não é simplesmente cadastrar visitantes. É fazer com que cada pessoa se sinta acolhida, respeitada e à vontade para conhecer nossa comunidade.</p></aside>
    ${canWelcome() ? `<a class="li" href="#/acolhimento">${icon("userPlus")}<span class="grow"><span class="t">Registrar um visitante</span><span class="s">Depois da conversa, com calma</span></span>${icon("chevronRight", "chev")}</a>` : ""}`;
}
