# Guia visual do Somos

Referência: `referencia-visual.jpg` (3 celulares: Testemunhos, Início, Edificação/Trilhas). Enviada pelo dono em 23/11/2026 como o estilo desejado para o app. Vale para o tema claro e para o escuro.

## Cores
- Marca (da logo): laranja #FA6141 → magenta #B1468A → roxo #6B42BC → azul #3753D1.
- **Azul #3753D1 é a cor de ação**: links, abas ativas, ícones ativos, botões, barras de progresso. Escuro: texto de ação #8EA6FF. Claro: #2B44B8.
- Roxo/lilás: o dono não gosta; não usar em textos nem botões.
- Apoio: verde (progresso concluído / ok), amarelo (progresso em andamento / aviso), cinza para placeholders.
- Tokens em `app/styles.css` (`:root` e `:root[data-theme="light"]`).

## Padrões da referência a reutilizar
1. **Saudação**: "Olá, Nome 👋" grande, avatar à esquerda, busca e sino à direita.
2. **Faixa de humor/ação**: barra arredondada de uma linha com emoji, texto e seta (ex.: "Como está se sentindo hoje?").
3. **Atalhos redondos**: círculo com ícone de traço fino e rótulo pequeno embaixo, rolagem horizontal (`quickRow()` em `core.js`, classe `.quick`).
4. **Carrossel de destaque**: imagem grande arredondada com pontos de paginação (azul no ativo).
5. **Cartão de aviso/versículo do dia**: ícone azul + título, texto cinza, referência pequena, botão fechar (X) no topo e compartilhar embaixo à direita.
6. **Mini player fixo**: barra com ícone de onda + rótulo à esquerda; anterior / play (círculo azul contornado) / próximo à direita.
7. **Cabeçalho de seção**: título em negrito à esquerda e ação em maiúsculas pequenas à direita ("OCULTAR", "VER TODOS", "EXPANDIR") com seta.
8. **Cartões de feed (Testemunhos)**: abas de texto no topo (Todos, Gratidão, Finanças, Saúde…) com a ativa em azul sublinhada; cartão com avatar + nome, etiqueta arredondada de categoria, texto citado truncado, rodapé com botão de coração azul e "Você e N pessoas celebraram".
9. **Lista de vídeos/cursos**: miniatura grande com ícone de play, título, autor em cinza; grade de 2 colunas menores com título e série.
10. **Trilhas/progresso**: cartão com miniatura pequena, título, barra fina (amarela em andamento, verde ao concluir) e "50% completo".
11. Cartões brancos (claro) / superfície elevada (escuro), borda fina, cantos 14–22px, sombra suave, muito espaço em branco, ícones de traço fino.

## Regras ao implementar
- Sempre testar nos dois temas (`E2E_THEME=light` no e2e).
- Reaproveitar componentes existentes antes de criar novos; se criar, deixe genérico para outras telas.
- Não mudar o comportamento do Ministério de Louvor.

## Decisões do dono (23/11/2026)
- **Cantos**: cartões levemente arredondados (≈12px; tokens `--r-lg` 12, `--r` 10, `--r-sm` 8). Nada de cantos muito redondos em cartões; só bolhas de chat, chips e botões-pílula ficam redondos.
- **Atalhos redondos** (`quickRow`) não podem repetir a barra de navegação (Início, Times/Escalas, Agenda, Músicas, Chat). Usam as funções do menu lateral: Avisos, Minhas escalas, Bloqueios, Aniversários, Tutoriais, Panorama, Estúdio, Metrônomo.
