# Segmentação de Pessoas e Carteira Digital — regras

## Segmentação (SOMOS Chamados → Segmentação)
- **Fonte de dados**: a Ficha (`people`) e os vínculos que já existem (`team_members`, `network_teams`, `journey_participants`, `access_grants`). Nada de cadastro ou vínculo paralelo.
- **Segmento dinâmico**: critérios `E`/`OU` com grupos aninhados (até 4 níveis, 30 condições), avaliados ao vivo no servidor. Entrar e sair é automático; o histórico de entradas e saídas é registrado quando o segmento é aberto (não em tempo real contínuo).
- **Campos permitidos** (lista fechada): classificação, situação, idade, faixa etária, sexo, estado civil, bairro, cidade, ministério, time, grupo manual, jornada (participa/em andamento/pausada/concluída), função (líder de time, supervisor, liderança geral, secretaria), cargo, datas de cadastro/entrada/última mudança de classificação, conversão registrada, situação da carteira, elegibilidade à carteira. Nada confidencial ou pastoral.
- **Operadores**: é igual, é diferente, contém, não contém, maior, menor, preenchido, não preenchido, pertence, não pertence, entre, não entre.
- **Grupo manual**: participação com início e saída; remover preserva o histórico; encerrar mantém tudo e bloqueia novas entradas. Permanente ou temporário; visibilidade `all` ou restrita (criador, responsável, administração).
- **Escopo**: administrador, liderança geral e secretaria com permissão do módulo veem a igreja; supervisor só as pessoas dos times da sua rede. Idade só aparece para quem tem `people_view`.
- **Nunca**: participar de segmento/grupo concede permissão ou direito à carteira; mudar classificação; disparar mensagem sozinho. `segment_audience` apenas devolve o público atual para outros módulos (exige `people_segments_use`).
- **Auditoria**: `seg_log` registra criação, alteração, ativação, exportação, entradas/saídas e participação em grupos. Não há exclusão.

## Carteira Digital (SOMOS Um → Meu perfil → Carteira Digital; gestão em SOMOS Chamados → Carteiras Digitais)
- **Elegível**: classificação *Membro* e situação *Ativa* (reavaliado no servidor a cada emissão, reativação e consulta). Visitante, frequentador e cadastro pendente nunca recebem.
- **Matrícula**: pertence à pessoa (`person_matricula`), formato configurável (prefixo + dígitos), única por igreja, nunca reaproveitada, preservada em reemissão, revogação e troca de conta. Não há tela para editar o número.
- **QR Code**: contém só um link com token `idDaCarteira.assinatura`. A assinatura é derivada no servidor de um segredo da igreja e da versão da carteira; **o token não é guardado**. Renovar ou reemitir sobe a versão e invalida qualquer QR antigo. Revogar mantém o QR reconhecível como “revogada”.
- **Validação**: página pública consulta o servidor e mostra só nome, foto (se permitido), igreja, matrícula (se a igreja permitir) e situação, com o aviso de que não comprova identidade civil. Limite de tentativas por origem (10 falhas ou 120 consultas em 10 minutos).
- **Situação efetiva**: revogada; suspensa (manual, ou deixou de ser membro, ou cadastro pendente, ou inativo com política automática); válida.
- **Ciclo de vida**: nome e foto vêm da Ficha na hora; inativar/mudar classificação suspende sem nova matrícula; reativar só se voltou a ser elegível.
- **Lote**: todos os elegíveis, por ministério ou por segmento (a elegibilidade é conferida pessoa a pessoa); repetir não duplica; falhas voltam identificadas e podem ser reprocessadas.
- **Auditoria**: `wallet_log` (emissão, reemissão, suspensão, reativação, revogação, renovação de token, configuração, lotes e validações por leitor autorizado).
