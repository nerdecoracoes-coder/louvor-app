# Melhorias anotadas (para implementar depois da revisão do app)

## 1. Organização = a igreja (revisado em 04/11/2026)
- A organização representa a **igreja** (ex.: "INVT Tijuca"). Não muda para "Ministério".
- Ajustar os textos da criação/configuração para deixar isso claro (ex.: campo "Nome da igreja").
- ~~Trocar "Organização" por "Ministério"~~ — descartado.

## 2. Tipo de time (na criação e nas configurações do time)
- A página continua se chamando **Times**.
- O campo **Descrição** do time passa a ser um campo selecionável **Tipo de time**, com opções prontas
  (a refinar): Louvor, Ministério Diaconal, Multimídia, …
- Opção **"Outro"**, com campo para digitar um tipo que não esteja na lista.
- Ideia para avaliar depois: o tipo do time ligar/desligar partes do app (ex.: player multitrack e repertório para Louvor;
  Multimídia/Diaconal talvez usem só escalas, integrantes, chat e avisos) e sugerir funções padrão conforme o tipo
  (ex.: Louvor → Ministro, Guitarra…; Multimídia → Projeção, Câmera, Transmissão…).

## 3. Recursos por tipo de time × recursos gerais da igreja (direção definida em 04/11/2026)
A maior parte do que já existe faz sentido só para certos tipos de time. A estrutura passa a ser:
- **Recursos gerais da igreja** (para todos, antes dos times) — a definir. Rascunho para discutir:
  perfil, avisos da igreja, calendário geral, aniversariantes, bloqueio de datas, notificações, convites e administração.
- **Recursos de todo time** (rascunho): integrantes, escalas, chat, arquivos, avisos do time.
- **Recursos por tipo de time**:
  - Louvor: repertório/biblioteca, player multitrack, integração com o Google Drive, funções musicais, músicas na escala.
  - Multimídia, Ministério Diaconal e outros: recursos próprios a criar.
- Decidido em 04/11/2026:
  - **Repertório e o menu Músicas ficam exclusivos de alguns tipos de time** (a princípio, Louvor). Quem não participa
    de um time desses não vê o menu nem o repertório. O repertório continua um só por igreja, compartilhado entre esses times.
  - Abrir o repertório para a igreja toda fica para o futuro, quando houver um jeito que faça sentido para todos.
  - Os recursos dos outros tipos de time serão definidos depois de uma pesquisa com os líderes de cada time.
- A definir: quais tipos de time, além de Louvor, terão acesso ao repertório.

## 4. Categoria do time: Ministério da igreja × Time aberto a convidados (definido em 04/11/2026)
- Ao criar um time, o administrador escolhe a **categoria**:
  - **Ministério da igreja**: só podem entrar **membros cadastrados** da igreja. O link de convite do time
    não serve para quem não é membro (a pessoa precisa antes receber o convite de membro da igreja).
  - **Time aberto a convidados**: podem ser convidadas pessoas que **não são membros** (ex.: músicos das filiais).
    Elas entram como **convidados**: participam só daquele time (escalas, chat, repertório e player),
    não viram membros da igreja e não aparecem nas listas da igreja.
- Quem convida: o **líder do time** (e o administrador).
- Convidado aparece no time como "Convidado · Igreja de origem". Acesso permanente por padrão, com data de término opcional.
- Exemplos: time **Chega Mais** (culto jovem, usado sempre, com membros de filiais) e louvores de cultos especiais.
- Status: **implementado** em 04/11/2026.

## 5. Foto de perfil dos membros (anotado em 04/11/2026)
- Todo membro deve conseguir colocar foto no perfil. Hoje existe o botão "Trocar foto" em Meu perfil (tocar no avatar
  no canto superior direito), mas ele não ficou visível/fácil para o usuário.
- Fazer: deixar a opção de foto evidente (tocar na própria foto no perfil e na tela inicial), oferecer no primeiro acesso
  e conferir o envio no Supabase real (Storage).
- Status: **implementado** em 04/11/2026 (foto ao tocar no avatar, aviso na tela inicial enquanto não houver foto).

## Implementado em 04/11/2026
- [x] Textos do app: "organização" → "igreja" (nome da igreja, cadastrar igreja, configurações da igreja…).
- [x] Campo **Tipo de time** (Louvor, Multimídia, Ministério Diaconal, Recepção, Ministério Infantil, Intercessão, Outro) no lugar da descrição.
- [x] Repertório, menu Músicas, player, músicas na escala e música no chat exclusivos de times de Louvor (regra também no banco).
- [x] O administrador cadastra os times da igreja sem precisar participar deles; no cadastro escolhe o **líder** (ou define depois).
- [x] Só o administrador geral define ou remove líderes (regra também no banco).
- [x] **Membros da igreja**: convite da igreja (sem time). A entrada nos times é só por convite/inclusão do líder ou do administrador; ninguém solicita entrada.
- [x] **Funções por tipo de time**: as funções atuais ficaram como funções do Louvor; novas funções podem ser criadas para cada tipo (ou para todos).
- [x] Categoria do time (Ministério da igreja / Aberto a convidados) e convidados de outras igrejas (líder e administrador convidam).
- [x] Foto de perfil em evidência (tocar na própria foto; aviso na tela inicial enquanto não houver foto).
- [x] Nova aparência (revisada em 04/11 a partir da referência do usuário): Sora com títulos encorpados (fonte no próprio app), luz da cor da igreja no topo, botões redondos de vidro, menu flutuante só com ícones, listas em linhas,
      próxima escala em cartão na cor da igreja.

## 6. App centrado no time (definido em 04/11/2026)
- O app abre direto no time que a pessoa usou por último. No topo, o nome do time; tocando nele, troca de time ou vai para a **Igreja**.
- Menu dentro do time: Início (escalas da pessoa, avisos e aniversariantes do time), Escalas, Músicas (se o time tiver repertório), Chat e Time.
- Área da Igreja: avisos gerais, Times, Calendário, Chat e configurações (administrador).
- **Recursos do time**: o tipo sugere os recursos (Louvor já vem com Repertório e player) e o administrador ajusta. O acesso ao repertório depende do recurso.
- O **Google Drive** saiu das configurações da igreja: fica em Músicas (botão Drive) e nas configurações do time com repertório; administrador e líderes desses times gerenciam.
- Status: **implementado** em 04/11/2026.

## 7. Google Drive: pastas de cantor/grupo, capa e "- Editar" (04/11/2026)
- multitracks/Cantor ou Grupo/Música (ou a música direto em multitracks).
- Imagem JPEG na pasta da música vira a capa.
- Música ainda não pronta: "- Editar" no fim do nome da pasta; o app não lê e tira do app; tirar o "- Editar" traz de volta.
- Status: **implementado** em 04/11/2026.

## 8. Ministério de Multimídia — primeira versão (04/11/2026)
- Tipos de time: Louvor, Multimídia, Diáconos, Ministério Infantil e Outro.
- Recursos novos (o tipo Multimídia já vem com os três): **Roteiro do culto**, **Pedidos de mídia**, **Checklist pré-culto**.
- Funções padrão do Multimídia: Direção, Projeção, Transmissão/Corte, Câmera 2, Câmera 3, Iluminação.
- Roteiro: na escala do Multimídia; modelo pronto; as músicas da escala do Louvor no mesmo culto (até 4 h de diferença)
  aparecem no item "Louvor", com a letra (para os slides), sem abrir o repertório para o Multimídia.
- Pedidos: qualquer membro pede (botão +); o time recebe aviso; responsável, link ou arquivo de entrega; quem pediu é avisado.
- Checklist: o líder define os itens (há uma lista sugerida); quem é do time marca em cada escala.
- Próximos passos a definir com os líderes: equipamentos, ambiente dos Diáconos e do Ministério Infantil.
