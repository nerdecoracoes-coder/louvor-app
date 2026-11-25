# Relatórios de Pessoas — regras de cálculo

Tudo é calculado no servidor (funções `rp_*` no banco). A tela só filtra, desenha e exporta o que o servidor devolveu.

## População de cada relatório
- Só entram **fichas** (tabela `people`) da igreja, com situação *ativa* e *inativa* (pendentes e rejeitadas só aparecem se filtradas). Usuário do app sem ficha **nunca** é contado como membro.
- Cada pessoa conta **uma vez**, em qualquer área. Quem está em três times conta uma vez no total de pessoas.
- Escopo: quem tem `people_reports_church` vê a igreja inteira; quem só tem `people_reports_own` vê as pessoas dos times que lidera e das redes que supervisiona. Sem nenhuma das duas, o servidor recusa.
- Filtros (combináveis): período, classificação, situação, faixa etária, sexo, estado civil, bairro, cidade, ministério (rede) e time. Valem para indicadores, gráficos e exportações. Dado ausente é “Não informado” e nunca é presumido.

## Indicadores
| Indicador | Regra |
|---|---|
| Total / membros / frequentadores / visitantes | Classificação **atual** da ficha. Soma das classificações = total. |
| Ativas / inativas | Situação cadastral atual. |
| Cadastros incompletos | Falta data de nascimento, sexo, todos os contatos (telefone, WhatsApp, e-mail) ou cidade. |
| Novos convertidos | **Evento** (decisão de fé não anulada, pela data da decisão), não classificação. “Total” conta todas as decisões visíveis; no período conta pela data da decisão. Decisões ainda sem ficha só entram quando não há filtro de perfil e o relatório é da igreja toda. |
| Faixa etária | Idade calculada hoje (fuso de São Paulo). Faixas configuráveis (padrão 0–12, 13–17, 18–24, 25–34, 35–44, 45–54, 55–64, 65+). Sem nascimento: “Não informado”. |
| Grupo familiar | Conjunto de pessoas ligadas entre si pelos vínculos da ficha (componentes conexos). Conta uma vez. Pessoa sem vínculo não forma família. |
| Filhos cadastrados | Pessoas que aparecem como filho(a) de alguém dentro da população filtrada. |
| Pessoas únicas em times | Fichas ligadas a conta que participam de ao menos um time. **Vínculos** = pessoa × time. Quem está em 2 times: 1 pessoa, 2 vínculos. |

## Evolução (histórico)
- Reconstruída do histórico da ficha pela data de **ocorrência** (não a do registro): criação, mudança de classificação, situação.
- Novos membros: entrada em “membro” vindo de outra classificação; a primeira entrada usa a data de membresia da ficha quando existe.
- Membros ao fim de cada período: estoque calculado pelos intervalos de classificação do histórico.
- Pessoas sem histórico de cadastro/classificação não entram nas séries; o relatório mostra a **cobertura do histórico** e avisa a limitação em vez de inventar números.
- Inativações e reativações só existem desde que a mudança de situação passou a ser registrada.

## Comparações
- Períodos: anterior de mesma duração, mês anterior, ano anterior ou outro período à escolha.
- Variação absoluta sempre; percentual **só quando o período anterior não é zero** (senão aparece “sem base percentual”).
- Variação de membros só é mostrada quando o histórico cobre 100% da população filtrada.

## Privacidade (LGPD)
- Relatórios são agregados. O relatório familiar mostra apenas totais.
- Lista de pessoas exige `people_reports_individual`; exportá-la exige `people_reports_export_lists`. Traz só nome, classificação, situação, faixa etária, sexo, estado civil, bairro, cidade e datas. Menores aparecem só com iniciais. Nunca CPF, contatos, observações ou dados pastorais.
- Toda exportação (indicadores ou lista) é registrada em `report_exports` com quem, quando, formato, filtros e quantidade de linhas.
