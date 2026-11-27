// Atalhos redondos do Início (time e igreja). Ficam num só lugar para o menu lateral saber o que já está na tela
// e NÃO repetir. Regra da navegação: cada coisa mora em um lugar só (barra de baixo, atalhos do Início ou menu lateral).
import { teamHas, teamHasRepertoire, teamOnly, hasRepertoire, menuShow, state } from "../core.js";
import { hasTutorials } from "../views/ajuda.js";

// Recurso principal de cada tipo de time: antes ocupava um botão na barra de baixo (deixava a barra com 6); agora é atalho do Início.
export const teamFeatureShortcuts = (t) => [
  teamHas(t, "pedidos") && ["inbox", "Pedidos", `#/times/${t.id}/pedidos`],
  teamHas(t, "visitantes") && ["users", "Visitantes", `#/times/${t.id}/visitantes`],
  teamHas(t, "criancas") && ["users", "Crianças", `#/times/${t.id}/criancas`],
].filter(Boolean);

export const teamShortcuts = (t) => [
  ["calendar", "Escalas", `#/times/${t.id}/escalas`],
  ...teamFeatureShortcuts(t),
  teamHasRepertoire(t) && ["music", "Músicas", "#/musicas"],
  ["userOff", "Bloqueios", "#/bloqueios"],
  teamHas(t, "estudio") && ["layers", "Estúdio", `#/times/${t.id}/estudio`],
  !teamOnly() && ["gift", "Aniversários", "#/aniversariantes"],
  ["play", "Tutoriais", "#/ajuda"],
].filter(Boolean);

// Barra de baixo da igreja: sem chat (a conversa com a liderança é por outros caminhos) e só com o que NÃO é seção do Início
// (Agenda e Times já estão lá). Início, Cuidado e Ajustes são fixos; entram até 2 destes, na ordem, se a pessoa tiver o recurso.
export const churchNav = (settingsHref) => {
  const m = state.menu || {};
  const extra = [
    menuShow("scales") && ["escalas", "calendar", "Escalas", "#/calendario/meu"],
    m.events === true && ["eventos", "star", "Eventos", "#/eventos"],
    m.sermons === true && ["pregacoes", "mic", "Pregações", "#/pregacoes"],
    m.contents === true && ["conteudos", "play", "Conteúdos", "#/conteudos"],
  ].filter(Boolean).slice(0, 2);
  return [["inicio", "home", "Início", "#/"], ...extra, ["cuidado", "heart", "Cuidado", "#/cuidado"], ["config", "settings", "Ajustes", settingsHref]];
};

export const churchShortcuts = () => [
  ["megaphone", "Avisos", "#/avisos"],
  menuShow("scales") && ["calendar", "Minhas escalas", "#/calendario/meu"],
  menuShow("scales") && ["userOff", "Bloqueios", "#/bloqueios"],
  ["gift", "Aniversários", "#/aniversariantes"],
  hasRepertoire() && !state.myTeams.length && ["music", "Músicas", "#/musicas"],   // antes era um botão da barra de baixo
  hasTutorials() && ["play", "Tutoriais", "#/ajuda"],
].filter(Boolean).filter((x) => !churchNav("").some((n) => n[3] === x[2]));   // o que está na barra não repete nos atalhos

// Endereços que já aparecem fora do menu lateral no contexto atual (além da barra de baixo): o menu não os repete.
export const alsoOnScreen = (t) => t
  ? [`#/times/${t.id}/estudio`, `#/times/${t.id}/letras`]        // ferramentas do time ficam na página "Time"
  : ["#/busca"];                                                 // a igreja tem o campo de busca no Início
