# Somos — instruções para quem mexer neste projeto

## Identidade visual (obrigatório em qualquer tela nova ou alterada)
- Guia completo: `docs/design/guia-visual.md`. Imagem de referência do dono: `docs/design/referencia-visual.jpg`.
- Antes de criar ou mudar uma tela, olhe a referência e reaproveite o que for parecido (atalhos redondos, cartões limpos, listas com thumbnail, barras de progresso, cartão de versículo/aviso com ícone e botão de fechar/compartilhar, mini player, abas por texto).
- Dois temas sempre: escuro (padrão) e claro. Use só tokens CSS (`--accent`, `--accent-ink`, `--text`, `--surface`, `rgba(var(--w), X)`); nunca cores fixas.
- Cor principal e dos textos de ação: **azul** da logo (#3753D1). **Evitar roxo/lilás** em textos e botões (o dono não gosta); roxo só no gradiente da logo.
- Mantenha o comportamento do Ministério de Louvor intacto.

## Navegação (sem repetição)
- Barra de baixo: sempre 5 botões, iguais em todos os times (Início, Chat, Time, Igreja, Ajustes; na visão da igreja, sempre 5 e sem chat: Início, um entre Escalas/Eventos/Pregações/Conteúdos/Avisos, Cuidado, Buscar, Ajustes). O que já é seção do Início (Agenda, Times) não vai para a barra. Recurso próprio de um tipo de time (Pedidos, Visitantes, Crianças) é atalho do Início, nunca botão da barra.
- Atalhos do Início ficam em `app/lib/shortcuts.js`. O menu lateral (`openMenu` em `app/main.js`) filtra sozinho tudo o que já está na barra ou nesses atalhos; ao criar um atalho novo, basta incluí-lo lá.
