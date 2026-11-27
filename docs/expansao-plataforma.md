# Expansão da plataforma SOMOS — diagnóstico, matriz e andamento

Documento de acompanhamento do "Prompt mestre" (9 módulos). Atualizado a cada fase entregue.
Regras que valem para tudo: o Ministério de Louvor não é alterado; nada é apagado (tudo fica no histórico); permissão e escopo são conferidos no servidor; o Desenvolvedor é um perfil técnico e **não** ganha acesso aos módulos por atalho; Gestão de Ministérios e Equipes e Wayton Church Kids estão fora do escopo.

## 1. Diagnóstico da arquitetura (antes da expansão)

| Camada | Situação |
|---|---|
| App | PWA em JavaScript puro (módulos ES), roteador por hash, service worker; telas em `app/views`, utilitários em `app/lib`, componentes em `app/core.js`. |
| Banco | Supabase (Postgres). Tabelas sensíveis fechadas; acesso por funções `security definer`. Permissões em `access_grants.actions` + administrador da organização. |
| Ambientes | SOMOS Um (comunidade), SOMOS Servos (times) e SOMOS Chamados (liderança), decididos pelo servidor (`my_access`). |
| Pessoas | Ficha única (`people`) com famílias, histórico, jornadas, convertidos, contatos, relatórios, segmentação e carteira (Recursos 01–12). |
| Já existia | Agenda simples da igreja (`church_events`), avisos (`announcements`), notificações (`notifications`/`notify_user`), indisponibilidade pessoal (`unavailability`), escalas do Louvor (`schedules`), times, redes de supervisão. |
| Não existia | Células, programações recorrentes, escalas gerais, eventos com inscrição, financeiro, pedidos de oração/atendimento pastoral, múltiplas igrejas, API/webhooks. |

Limitações técnicas relevantes: hospedagem estática (Cloudflare Pages) + Supabase; não há servidor próprio para tarefas agendadas, envio de e-mail/push externo ou chamadas a provedores de pagamento sem credenciais. Itens que dependem disso serão entregues como estrutura e documentados como "dependem de configuração externa".

## 2. Pesquisa da inChurch e matriz comparativa

**Limite da pesquisa:** o site oficial e a documentação da inChurch não puderam ser abertos neste ambiente. A pesquisa usou o que foi possível ler: descrições públicas dos apps *Inchurch PRO* e *inChurch Control* na App Store e uma reportagem (bpmoney). Tudo o que não aparece nessas fontes está marcado **não confirmado**; as decisões para esses itens são **propostas próprias** do SOMOS, não cópia da inChurch.

| Funcionalidade | inChurch | SOMOS antes | Ação |
|---|---|---|---|
| Agenda oficial e eventos para o membro | Confirmado (PRO) | Parcial (agenda simples) | Aprimorar: Programações (Fase 1) e Eventos (Fase 2) |
| Inscrição em eventos e ingressos digitais | Confirmado (PRO, Control valida tickets) | Ausente | Implementar (Fase 2) |
| Check-in de eventos por QR/nome/lista | Parcial: validação de ingressos confirmada | Parcial (QR de carteira) | Implementar (Fase 2) |
| Notificações push, criação e agendamento | Confirmado (Control) | Parcial (notificações internas) | Aprimorar (Fase 4); push externo depende de configuração |
| Grupos e conteúdo segmentado | Confirmado (PRO) | Existente (Segmentação) | Preservar e reutilizar |
| Carteirinha digital | Confirmado (PRO) | Existente | Preservar |
| Pedidos de oração / de apoio | Confirmado (PRO, Control) | Ausente | Implementar (Fase 4) com confidencialidade reforçada |
| Dízimo e doações pelo app; destinação a objetivo; prestação de contas opcional | Confirmado (reportagem) | Ausente | Implementar o registro e a gestão (Fase 3); pagamento online só como arquitetura, sem credenciais |
| Planos de leitura, anotações, transmissões, vídeos, áudios, downloads offline | Confirmado (PRO) | Parcial (vídeos/áudios de times) | Implementar conteúdos e pregações (Fases 4–5); transmissões ao vivo dependem de serviço externo |
| Seleção de igreja/unidade | Confirmado (Control, reportagem) | Parcial (várias organizações por conta) | Aprimorar (Fase 6) |
| Check-in Kids | Confirmado (Control) | Parcial (infantil do Louvor) | **Fora do escopo** (Wayton Church Kids) |
| Células, relatório de célula, supervisão | **Não confirmado** | Ausente | Implementar como proposta própria (Fase 1) |
| Escalas gerais e substituições | **Não confirmado** | Parcial (só Louvor) | Implementar como proposta própria (Fase 1) |
| Financeiro completo (contas, orçamento, aprovações) | **Não confirmado** | Ausente | Implementar como proposta própria (Fase 3) |
| API pública e webhooks | **Não confirmado** | Ausente | Implementar como proposta própria (Fase 6) |
| Múltiplas igrejas com administração consolidada | **Não confirmado** (reportagem cita unidades) | Parcial | Proposta própria (Fase 6) |

## 3. Situação por módulo

| Módulo | Situação | Observação |
|---|---|---|
| 1. Células | Implementado e testado (banco + telas) | Fase 1 |
| 2. Cultos, Programações e Escalas | Implementado e testado (banco + telas) | Fase 1 |
| 3. Eventos | Implementado e testado (inscrição, ingresso QR, espera, check-in; **sem pagamento**) | Fase 2 |
| 4. Financeiro | Implementado e testado (contas, lançamentos, a pagar/receber, aprovação, orçamento, relatórios; **sem pagamento online**) | Fase 3 |
| 5. Comunicação | Implementado e testado (comunicados com agenda/validade/público/fixação, preferências de notificação, pregações; **sem push/e-mail externo**) | Fase 4 |
| 6. Cuidado Pastoral e Intercessão | Implementado e testado (pedidos de oração, grupos de intercessão, solicitação e registro de atendimento, trilha de acessos) | Fase 4 |
| 7. Experiência Digital | Implementado e testado (conteúdos, planos de leitura, busca integrada, atalhos da Home; **sem upload de vídeo/áudio nem transmissão ao vivo**) | Fase 5 |
| 8. Múltiplas Igrejas | Pendente | Fase 6 |
| 9. Integrações e Recursos Técnicos | Pendente | Fase 6 |

## 4. Fase 1 — regras implementadas

Arquivos: `supabase/migrations/20261205000001_celulas_programacoes_escalas.sql` (cópia em `supabase/setup/atualizacao-2026-12-05-celulas-programacoes-escalas.sql`), `app/views/celulas.js`, `app/views/programacoes.js`, `app/views/escalas.js`, `app/lib/mod-ui.js`, `tests/celulas-programacoes-escalas.test.ts`.

**Infraestrutura comum:** `mod_perm` (administrador da igreja ou concessão; sem atalho de desenvolvedor), `mod_audit` (auditoria única: usuário, operação, registro, motivo, data e antes/depois), 13 novas permissões, `my_modules` (o que a interface mostra), `mod_people_search` (nome e classificação, 2 letras no mínimo, só para quem trabalha nos módulos). As permissões novas entram em `all_actions()` sem reescrever as antigas.

**Células:** cadastro com nome único, categoria, local, dia/horário/frequência, capacidade, modalidade (presencial/online/híbrida) e supervisão. Liderança (líder, colíder, anfitrião, auxiliar). Um vínculo ativo por pessoa; sair, transferir e reentrar ficam no histórico. Reuniões: data (não futura), presença por participante, visitantes, observações, contagem manual; correção guarda o registro anterior. Supervisão livre: título próprio e nó pai opcional, sem ciclos. Relatórios só descritivos (sem "nota" de saúde): totais, ativas/inativas, participantes, média e taxa de presença, visitantes, novos, evolução mensal, células sem reunião, por supervisor e por célula, exportação CSV.
Escopo: permissão da igreja toda **ou** liderança da própria célula **ou** supervisão (inclui quem está abaixo na estrutura). Só participar não dá acesso a nada.

**Programações:** categorias, visibilidade (pública, membros, liderança), rascunho/publicada/cancelada. Recorrência: não repete, diária, semanal, quinzenal, mensal (dia 31 vira último dia do mês curto), dias da semana específicos, datas escolhidas, com data final. Exceções por data (cancelar com motivo, alterar horário/local/aviso) não apagam nada: desfazer marca a exceção como desfeita. Ordem de atividades livre (título, horário previsto, duração, responsável, observações), padrão e por data; cada alteração guarda o estado anterior.
A agenda simples existente (`church_events`) não foi alterada.

**Escalas gerais:** rascunho → publicada → aguardando/parcialmente confirmada/confirmada (calculado pelas respostas) → concluída ou cancelada (com motivo). Convite por notificação interna, confirmar, recusar, pedir substituição (com indicação opcional), aprovação por quem tem `roster_approve` ou `roster_manage`, histórico completo. Conflitos considerados na publicação e na aprovação do substituto: outra escala no mesmo horário, indisponibilidade informada pela pessoa e escala do Louvor (**somente leitura**); a publicação com conflito exige confirmação e registra que foi forçada.
O Louvor não foi alterado: `schedules` e `schedule_assignments` só são lidas.

**Não incluído na Fase 1 (honesto):** avisos por e-mail/push externo (só notificação interna); vínculo automático entre Programações e Escalas além da referência opcional; recorrência de escalas (cada escala é criada para uma data); aviso de lembrete antes do horário (depende de agendamento no servidor); células como critério de segmentação e como público de Comunicação (previsto na Fase 4).

## 4.1 Menu por público

O servidor (`my_menu`) decide quais atalhos pessoais aparecem: **Decidi seguir a Jesus** só para visitante, congregado e pessoa sem ficha (membro apenas se a liderança liberar na ficha, `person_menu_decision_set`, com `people_edit` e escopo total); **Minhas jornadas** só se a pessoa participa de uma jornada ou há jornada pública aberta para a sua classificação; **Minhas escalas** só para quem está em escala publicada (últimos 30 dias ou futura). Ocultar atalho não bloqueia o acesso direto pela URL. Arquivo: `supabase/setup/atualizacao-2026-12-05-menu-por-publico.sql`. Testes: `tests/menu-publico.test.ts`.

## 4.2 Menu inteligente e central de descoberta do SOMOS Um

Arquivos: `supabase/migrations/20261206000001_menu_inteligente_descoberta.sql` (cópia em `supabase/setup/atualizacao-2026-12-06-menu-inteligente.sql`), `app/lib/cards.js`, `app/views/destaques.js`, `tests/menu-inteligente.test.ts`.

**Diagnóstico (antes):** o menu era uma lista única, montada no navegador; "Decidi seguir a Jesus" e "Minhas jornadas" já eram filtrados pela classificação (4.1); "Como acolher" aparecia para todo servo; "Pedir arte ou vídeo" aparecia para qualquer membro e o banco aceitava o pedido de qualquer membro da igreja; tutoriais apareciam todos; a página inicial do SOMOS Um não tinha sugestões; **não existia catálogo de conteúdos/pregações**; não havia regra de "atualização cadastral periódica" (só o fluxo de pedido de alteração).

**Regras de visibilidade (decididas em `my_menu`, no servidor):**
- Decidi seguir a Jesus: consulta o histórico permanente (`faith_decisions` não anuladas, por pessoa ou conta). Aparece para visitante, frequentador e pessoa sem ficha **sem decisão registrada**; membro só se a liderança liberar na ficha; decisão registrada, novo convertido e membro com decisão: não aparece. Decisão anulada volta a mostrar.
- Minhas jornadas: participante (inclusive concluída, para manter o histórico) ou jornada pública aberta para a sua classificação.
- Minhas escalas e Indisponibilidades: quem pertence a algum time ou está em escala publicada; ao sair de todos os times, somem.
- Como acolher: administrador, permissão de acolhimento (`people_welcome`) ou integrante de time com o recurso "Visitantes". Integrante do Louvor não vê.
- Pedir arte ou vídeo: administrador, líder de time ou quem recebeu a permissão `media_request`; **também no banco** (a política de inserção em `media_requests` passou a exigir isso; o time de mídia continua podendo abrir pedidos internos).
- Tutoriais: só os dos recursos que a pessoa usa (liderança, vínculo, recurso do time, permissão).
- Sempre visíveis: Avisos, Meu cadastro, Solicitar contato, Tema, Sair.
O menu foi reorganizado em Igreja / Minha caminhada / Serviço, e se atualiza sozinho (ao abrir o menu, ao trocar de tela e ao voltar para o app).

**Cards "Para você" (`home_discover`):** continue sua jornada (atividade pendente), destaques/campanhas, estudo, última pregação, próximos eventos (agenda da igreja), último comunicado, jornadas abertas, decisão (só elegível sem decisão), carteira (só membro com carteira ativa), ministérios, solicitar contato (só não membros), atualizar cadastro (ficha sem alteração há mais de 180 dias e sem pedido em andamento — regra nova, simples). Todo card tem destino funcional e só existe com conteúdo real. Ordem e quantidade são configuráveis; comunicado urgente vai na frente; os convites institucionais giram de lugar a cada dia. Nada usa dado pastoral.
**Administração:** Chamados → Destaques do SOMOS Um (permissão `discover_manage`): campanha/estudo/pregação, título, descrição, link, botão, imagem enviada pela própria administração, público (todos, visitantes, frequentadores, membros, participantes de uma jornada ou **segmento da Segmentação existente**), período, prioridade, urgente, ativar/desativar, arquivar (nada é apagado) e auditoria.

**Limites reais:** (1) não foi possível baixar fotos de bancos de imagem (o ambiente bloqueia esses sites); os cards usam composição com ícone e as cores do SOMOS, com imagem opcional enviada pela administração, de jornada ou de comunicado; (2) estudos e pregações só aparecem quando cadastrados em Destaques — o catálogo completo de conteúdos (planos de leitura, transmissões) é da Fase 5; (3) "Eventos" usa a agenda da igreja; eventos com inscrição são da Fase 2; (4) a regra de privacidade de Aniversariantes não existe como configuração, então o item continua como estava; (5) a página inicial ainda mostra as "Ações da igreja" (atalhos de administração) para quem tem permissão — não foram movidas.

## 4.3 Fase 2 — Eventos

Arquivos: `supabase/migrations/20261207000001_eventos.sql` (cópia em `supabase/setup/atualizacao-2026-12-07-eventos.sql`), `app/views/inscricoes.js`, `tests/eventos.test.ts`. A agenda simples (`church_events`) não foi alterada.

**Permissões novas** (só administrador ou concessão; liderança de time, integrante e desenvolvedor não ganham acesso): `ev_view` (ver tudo e as inscrições), `ev_manage` (criar/editar, inscrever e cancelar inscrição pela equipe), `ev_publish` (publicar, cancelar com motivo, encerrar, voltar a rascunho), `ev_checkin`.
**Evento:** título, descrição, local, início/fim, imagem, público (todos/visitantes/frequentadores/membros), inscrição (sem inscrição, aberta, fechada), vagas, acompanhantes por inscrição, janela de inscrição. Rascunho → publicado → cancelado (motivo obrigatório; avisa inscritos) ou encerrado (só depois do início). Nada é apagado; tudo vai para a auditoria única.
**Inscrição (conta obrigatória):** confirma na hora ou entra na **lista de espera** quando as vagas (contando acompanhantes) acabam; ao cancelar, o primeiro da fila que couber é promovido e avisado; aumentar a capacidade também promove. Uma inscrição ativa por pessoa; reduzir a capacidade abaixo do confirmado é recusado.
**Ingresso:** código de 10 caracteres + QR (`EV-código`) em "Meus ingressos"; mostra posição na fila e evento cancelado.
**Check-in:** por QR (câmera, quando o navegador suporta `BarcodeDetector`), por código digitado ou pela lista; guarda quem fez, quando e quantas pessoas entraram; recusa ingresso inexistente, de outro evento, em espera, cancelado ou de evento cancelado; já usado avisa; desfazer exige motivo. Relatório: vagas, espera, presentes, ausentes; exportação CSV.
**Integração:** menu (Eventos, Meus ingressos), card "Tem algo especial chegando" (usa eventos publicados do público da pessoa; sem eles, cai na agenda simples) e Chamados → Eventos.

**Limites reais:** (1) **pagamento/ingresso pago não existe** — depende de provedor e credenciais; (2) inscrição exige conta no app (não há inscrição pública sem login); (3) o QR é lido pela câmera apenas em navegadores com `BarcodeDetector` (Chrome no Android funciona); nos demais, digita-se o código; (4) lembretes automáticos antes do evento dependem de agendamento no servidor e não foram feitos; (5) a inscrição pela equipe é só por nome (não liga à ficha da pessoa); (6) eventos recorrentes não foram feitos (use Programações para recorrência).

## 4.4 Fase 3 — Financeiro

Arquivos: `supabase/migrations/20261208000001_financeiro.sql` (cópia em `supabase/setup/atualizacao-2026-12-08-financeiro.sql`), `app/views/financeiro.js`, `tests/financeiro.test.ts`. Entrada: SOMOS Chamados → Financeiro.

**Permissões novas** (só administrador ou concessão; liderança/integrante de ministério e desenvolvedor não ganham acesso): `fin_view` (relatórios e lançamentos), `fin_entry` (lançar, baixar, cancelar o que está em aberto), `fin_approve` (aprovar/recusar despesas), `fin_manage` (contas, categorias, centros de custo, campanhas, orçamento, regra de aprovação, estorno), `fin_donors` (ver quem contribuiu).
**Estrutura:** contas/caixas (saldo inicial, ativar/desativar), categorias de receita e despesa (padrão criado na primeira abertura, editável), centros de custo, campanhas/destinações com meta, lançamentos (receita, despesa, transferência), comprovante em bucket **privado** (`fin/<igreja>/...`), orçamento anual ou mensal por categoria e/ou centro de custo.
**Contas a pagar e receber:** todo lançamento tem vencimento e fica "em aberto" até a baixa (data, conta, forma). Atrasados são calculados pela data. Parcelamento (valor total dividido, centavos na primeira parcela) e recorrência mensal (mesmo valor, até 60 vezes).
**Nada se apaga:** cancelar exige motivo e guarda quem e quando; lançamento já baixado só é cancelado por quem tem `fin_manage` (estorno) e o saldo volta; lançamento baixado não é editado. Não existe função de exclusão.
**Aprovação:** regra configurável (despesas a partir de X exigem aprovação; 0 = todas; vazio = nenhuma). Despesa pendente não pode ser baixada. **Ninguém aprova o que lançou ou alterou — nem o administrador.** Recusa exige motivo e cancela mantendo o registro; aprovação em série; aprovadores e quem lançou são avisados.
**Contribuições:** anônimas permitidas (sem pessoa e sem nome). Identificar quem contribuiu exige `fin_donors`; quem só tem `fin_view` vê valores mas não o contribuinte (lista, detalhe e busca). Editar sem `fin_donors` não apaga a identificação.
**Relatórios:** totais e fluxo de caixa por mês, receitas e despesas por categoria, despesas por centro de custo, receitas por campanha, saldo por conta, pendências (a pagar/receber, atrasadas, aguardando aprovação), orçado × realizado (realizado = só o baixado), histórico por lançamento e exportação CSV da lista filtrada. Auditoria na tabela única `mod_audit` (módulo `finance`).
**Pagamento online (preparo):** colunas `source` e `external_ref` (única por igreja) permitem que um webhook futuro crie receitas de forma idempotente. **Nada de provedor, credencial ou transação real foi criado**; a tela diz "Não configurado".

**Limites reais:** (1) sem Pix/cartão pelo app (depende de provedor e credenciais); (2) sem extrato do contribuinte para o próprio membro nem recibo/declaração anual; (3) sem conciliação com extrato bancário e sem importação; (4) comprovante só em imagem ou PDF até 10 MB, enviado pelo app; as políticas do bucket foram testadas pela regra (`fin_storage_ok`), pois a pilha local não tem o serviço de arquivos — confirmar um envio real após aplicar o SQL; (5) moeda única (R$); (6) o relatório é por data de baixa (regime de caixa), não por competência.

## 4.5 Fase 4A — Comunicação

Arquivos: `supabase/migrations/20261209000001_comunicacao.sql` (cópia em `supabase/setup/atualizacao-2026-12-09-comunicacao.sql`), `app/views/comunicacao.js`, `tests/comunicacao.test.ts`. Entrada: SOMOS Chamados → Comunicação; pregações em Menu → Pregações; preferências em Conta → Notificações.

**Permissões novas:** `comm_manage` (criar/editar rascunhos), `comm_publish` (publicar, agendar, despublicar, fixar), `comm_sermons` (pregações). Liderança de time e desenvolvedor não ganham acesso.
**Comunicados:** reaproveitam a tabela `announcements` e o feed existente (Home/Avisos); não há segundo feed. Estados: rascunho, agendado, no ar, vencido, despublicado, calculados no servidor pela data. Público reaproveita Segmentação: todos, visitantes, frequentadores, membros, segmento, grupo, célula (ministérios, times e redes via segmentos). Até 3 fixados, link (https ou tela do app) e validade. Excluir só rascunho que nunca foi publicado.
**Notificações:** aviso interno a quem é do público, uma vez por comunicado, sem avisar quem publicou. Preferências por grupo (comunicados, eventos, escalas, financeiro, conversas, lembretes); o essencial não se desliga. Limite de 5 avisos de comunicado por pessoa a cada 24 h.
**Pregações:** título, pregador, data, série, passagem, descrição, vídeo, áudio, imagem, links (até 8), público e rascunho/publicado; busca e filtro por série/categoria.

**Limites reais:** (1) **push e e-mail não existem** (dependem de configuração externa); só notificação interna; (2) comunicado agendado fica visível na hora marcada mesmo sem o servidor, mas o *aviso* depende do `pg_cron` (a cada 10 min) estar ativo no Supabase; (3) o card "Última pregação" da Home continua vindo dos Destaques; a página de pregações é separada; (4) mídia das pregações é link externo (YouTube etc.), sem upload de vídeo.

## 4.6 Fase 4B — Cuidado com Pessoas

Arquivos: `supabase/migrations/20261209000002_cuidado.sql` (cópia em `supabase/setup/atualizacao-2026-12-09-cuidado.sql`), `app/views/cuidado.js`, `tests/cuidado.test.ts`. Entrada: Menu/Chamados → Cuidado com Pessoas (membros); área de gestão só com permissão.

**Permissões novas:** `care_prayer` (caixa de pedidos de oração), `care_pastoral` (solicitações e registros de atendimento), `care_manage` (grupos de intercessão, anonimato, resumo e trilha de acessos). Gerir **não** dá leitura dos pedidos. Nem administrador lê as tabelas diretamente; tudo passa por funções que conferem a permissão.
**Pedido de oração:** a pessoa escolhe entre "só liderança autorizada" ou "um grupo de intercessão" (nunca a igreja toda); pode pedir acompanhamento; anônimo só se a igreja permitir e a identidade nunca é devolvida. Situação: recebido, em oração, acompanhamento, encerrado; responsável só entre autorizados (ou integrantes do grupo). Anotações internas não vão a quem pediu. Integrantes do grupo veem só os pedidos do próprio grupo e registram "orei".
**Atendimento pastoral:** a *solicitação* (o que a pessoa pede, com tema e preferência) é separada do *registro realizado* (data, resumo, retorno). Agendar exige responsável autorizado e data; encaminhar exige motivo. A observação restrita só é lida por quem registrou; outros da equipe veem apenas que existe.
**Confidencialidade:** notificações não carregam conteúdo; `mod_audit` não guarda texto; toda abertura/listagem de pedido ou registro entra em `care_access` (visível a `care_manage`); relatório só tem contagens; nenhuma função de segmentação ou relatório geral lê estas tabelas (verificado por teste).

**Limites reais:** (1) quem tem `care_pastoral`/`care_prayer` vê o conteúdo que a função permite, então a concessão deve ser criteriosa; (2) administrador também fica na lista de autorizados; (3) não há exportação nem vínculo automático do registro à ficha da pessoa além do `person_id` opcional; (4) sem lembrete automático de retorno agendado.

## 4.7 Correção — "Decidi seguir a Jesus"

Arquivos: `supabase/migrations/20261210000001_decisao_elegibilidade.sql` (cópia em `supabase/setup/atualizacao-2026-12-10-decisao-elegibilidade.sql`), `tests/decisao-regra.test.ts`.

**Regra única** (`decision_eligible`), usada pelo menu (`my_menu`), pelo card da Home (`home_discover`) e pelo backend do formulário (`convert_self_get/submit` recusam com `decision_unavailable`): a ficha da conta precisa ser **visitante ou frequentador**, nenhuma ficha da conta pode ser membro e **não pode haver decisão registrada** (não anulada). Líder, voluntário, administrador e integrante de time não entram na regra: membro nunca vê, mesmo sem decisão. Decisão anulada volta a permitir; quem muda de classificação é reavaliado na hora.
**Atalho manual removido:** o botão da ficha que liberava a opção a membros saiu; `person_menu_decision_set` recusa e as marcas antigas foram zeradas. O histórico de decisões não é alterado nem apagado.
**Consequência a conhecer:** conta **sem ficha** não tem classificação e, pela regra, não vê a opção nem envia o formulário (antes ficava "aguardando associação"). O canal "Solicitar contato" continua aberto a todos, e oração/acompanhamento seguem em Cuidado com Pessoas.

## 4.8 Fase 5 — Experiência Digital

Arquivos: `supabase/migrations/20261211000001_experiencia_digital.sql` (cópia em `supabase/setup/atualizacao-2026-12-11-experiencia-digital.sql`), `app/views/digital.js`, `tests/experiencia-digital.test.ts`. Entradas: Menu → Conteúdos, Planos de leitura e Buscar; busca e atalhos na Home; gestão em SOMOS Chamados → Experiência digital.

**Permissão nova:** `dig_manage` (administrador ou concessão; liderança de time e desenvolvedor não ganham acesso). Tabelas fechadas por RLS; tudo por funções.
**Home (9.1):** a página inicial já reunia agenda, eventos, comunicados, pregações e "Para você" (Fases anteriores). Agora ganha a barra de busca e os atalhos configuráveis, e dois cards automáticos: *plano de leitura* (continuar ou começar) e *conteúdo novo*, só quando existem e a pessoa pode abrir. Nenhuma função administrativa aparece para usuário comum.
**Conteúdos (9.2):** vídeo, áudio, estudo, material para baixar e institucional; séries; assunto; público (todos, visitante, frequentador, membro); rascunho/publicado (vídeo, áudio e material só publicam com link). Pregações seguem na Fase 4 (nada duplicado). Planos de leitura: dias com passagem, título e anotação; inscrição e progresso individuais; a gestão vê só contagens (inscritos, concluídos); dia com progresso não pode ser removido; despublicar não tira o plano de quem já começou.
**Busca integrada (9.3):** `search_all` encontra eventos, programações e agenda, pregações, conteúdos, planos, comunicados e nome da igreja, aplicando as mesmas regras de público e visibilidade (rascunho e conteúdo de outro público nunca aparecem; programação "só liderança" só para liderança). Curingas são ignorados; mínimo de 2 letras. Cada resultado leva a uma rota existente.
**Atalhos (9.4):** nome (até 24 letras), ícone, destino interno ou `https://`, público, ordem e ativo; máximo de 8 ativos. **Acolhimento (9.5)** não foi alterado: nenhum formulário novo e nenhuma coleta de dados.

**Limites reais:** (1) vídeo/áudio/material são **links externos** (YouTube, Drive etc.); só a imagem é enviada ao app, não há upload de vídeo, áudio ou PDF nem leitura offline; (2) **transmissão ao vivo** não existe (dependeria de serviço externo); (3) a busca **não ignora acentos** ("biblia" não acha "Bíblia") e a pregação aberta pela busca abre a lista já filtrada; (4) planos de leitura não têm lembrete diário nem anotações pessoais; (5) as fotos dos cards continuam opcionais, enviadas pela administração (o ambiente bloqueia bancos de imagem).

## 5. Como aplicar no Supabase

Rode `supabase/setup/atualizacao-2026-12-05-celulas-programacoes-escalas.sql` depois `atualizacao-2026-12-05-menu-por-publico.sql` `atualizacao-2026-12-06-menu-inteligente.sql` e `atualizacao-2026-12-07-eventos.sql` e `atualizacao-2026-12-08-financeiro.sql`, `atualizacao-2026-12-09-comunicacao.sql` e `atualizacao-2026-12-09-cuidado.sql` `atualizacao-2026-12-10-decisao-elegibilidade.sql` e `atualizacao-2026-12-11-experiencia-digital.sql` (nesta ordem) no SQL Editor. A última linha comentada ("verificação") deve retornar `true`. Reversão documentada no fim do arquivo.
