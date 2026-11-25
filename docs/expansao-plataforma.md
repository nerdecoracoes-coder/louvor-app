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
| 3. Eventos | Pendente | Fase 2 |
| 4. Financeiro | Pendente | Fase 3 |
| 5. Comunicação | Pendente | Fase 4 |
| 6. Cuidado Pastoral e Intercessão | Pendente | Fase 4 |
| 7. Experiência Digital | Pendente | Fase 5 |
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

## 5. Como aplicar no Supabase

Rode `supabase/setup/atualizacao-2026-12-05-celulas-programacoes-escalas.sql` no SQL Editor. A última linha comentada ("verificação") deve retornar `true`. Reversão documentada no fim do arquivo.
