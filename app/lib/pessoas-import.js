// Cadastro de pessoas: rótulos, modelo de planilha e leitura/normalização das linhas importadas.
import { buildXlsx } from "./xlsx.js";

export const CLASSES = [["member", "Membro"], ["attender", "Frequentador"], ["visitor", "Visitante"]];
export const CLASSES_FORM = [...CLASSES, ["none", "Sem classificação"]];
export const CLASS_LABEL = Object.fromEntries(CLASSES_FORM);
export const STATUS_LABEL = { active: "Ativo", inactive: "Inativo", pending: "Pendente", rejected: "Rejeitado" };
export const MARITAL = [["solteiro", "Solteiro(a)"], ["casado", "Casado(a)"], ["divorciado", "Divorciado(a)"], ["viuvo", "Viúvo(a)"], ["uniao_estavel", "União estável"], ["outro", "Outro"]];
export const MARITAL_LABEL = Object.fromEntries(MARITAL);

// campos do formulário público que o administrador pode pedir
export const FORM_FIELDS = [["social_name", "Nome social"], ["birth_date", "Data de nascimento"], ["sex", "Sexo"], ["cpf", "CPF"], ["marital_status", "Estado civil"],
  ["phone", "Telefone"], ["whatsapp", "WhatsApp"], ["email", "E-mail"], ["address", "Endereço"], ["city", "Cidade"], ["state", "Estado"], ["zip", "CEP"]];

export const ERRORS = {
  name_required: "Falta o nome completo", invalid_cpf: "CPF inválido", invalid_email: "E-mail inválido", invalid_zip: "CEP inválido (use 8 números)", invalid_state: "Estado inválido (use a sigla, ex.: RJ)",
  invalid_sex: "Sexo inválido", invalid_marital: "Estado civil inválido", invalid_birth: "Data de nascimento inválida", invalid_date: "Data inválida", invalid_classification: "Classificação inválida (use Membro, Frequentador ou Visitante)",
  duplicate_in_file: "CPF repetido na própria planilha", duplicate_cpf: "Já existe alguém com esse CPF", forbidden: "Você não tem permissão para isso", not_found: "Cadastro não encontrado",
  not_pending: "Este cadastro não está pendente", form_closed: "Este formulário não está recebendo cadastros", too_many_requests: "Muitos envios em pouco tempo. Tente de novo em alguns minutos.",
  not_a_member: "A pessoa não faz parte da igreja", field_too_long: "Algum campo passou do tamanho permitido",
  already_related: "Essas pessoas já estão relacionadas", same_person: "Escolha outra pessoa: não dá para relacionar alguém com ela mesma", invalid_relation: "Tipo de parentesco inválido",
  already_has_spouse: "Uma dessas pessoas já tem cônjuge cadastrado", invalid_age: "As datas de nascimento não combinam com esse parentesco", invalid_cycle: "Esse vínculo criaria uma contradição na árvore da família",
  already_guardian: "Essa pessoa já é responsável legal", guardian_minor: "Um menor de idade não pode ser responsável legal", ward_not_minor: "Só dá para definir responsável legal de menor de idade (ou curatela)",
  invalid_kind: "Tipo de responsabilidade inválido", invalid_category: "Escolha uma categoria válida", invalid_title: "Informe um título com 2 a 120 letras", invalid_date: "A data não pode ser futura nem anterior a 1900",
  text_too_long: "Algum texto passou do tamanho permitido", auto_protected: "Registros automáticos não podem ser alterados", voided: "Esse registro já foi anulado", reason_required: "Explique o motivo",
  field_locked: "Esse dado só a secretaria altera", already_pending: "Esse dado já tem uma solicitação em análise", cannot_cancel: "Essa solicitação já não pode ser cancelada", already_decided: "Essa solicitação já foi concluída",
  self_approval: "Quem fez o pedido não pode aprová-lo. Peça a outro responsável", invalid_decision: "Decisão inválida", invalid_field: "Campo inválido", invalid_mode: "Regra inválida", not_authenticated: "Entre na sua conta para continuar",
  invalid_label: "O nome da categoria deve ter de 2 a 40 letras", already_exists: "Já existe uma categoria com esse nome", invalid_filter: "Filtro inválido", note_too_long: "A observação é longa demais (máximo 500 letras)", too_many_rows: "A planilha tem linhas demais (máximo 5.000)" };
Object.assign(ERRORS, {
  registration_closed: "As inscrições estão encerradas.", registration_not_yet: "As inscrições ainda não abriram.", registration_none: "Este evento não tem inscrição.", registration_ended: "Este evento já terminou.",
  already_registered: "Você já está inscrito(a) neste evento.", invalid_guests: "Quantidade de acompanhantes inválida.", event_closed: "Este evento já foi cancelado ou encerrado.", event_not_open: "O evento precisa estar publicado.",
  capacity_below_registered: "Já há mais vagas confirmadas do que essa capacidade.", already_cancelled: "Esta inscrição já foi cancelada.", already_checked_in: "Quem já entrou não pode cancelar a inscrição.", not_checked_in: "Esta pessoa ainda não fez check-in.",
  invalid_registration: "Situação de inscrição inválida.",
  invalid_audience: "Escolha um público válido.", invalid_journey: "Escolha uma jornada desta igreja.", invalid_segment: "Escolha um segmento desta igreja.", invalid_max: "Escolha entre 3 e 12 cards.",
  invalid_data: "Confira os campos: o link precisa começar com https:// ou #/ e as datas precisam fazer sentido.",
  consent_required: "Marque a autorização para podermos responder.", contact_required: "Informe um telefone ou e-mail para recebermos o retorno.", pref_needs_phone: "Para WhatsApp ou ligação, informe o telefone.", pref_needs_email: "Para retorno por e-mail, informe o e-mail.",
  pref_other_required: "Descreva como prefere ser contatado.", message_required: "Escreva a sua mensagem.", message_too_long: "A mensagem passou de 2000 letras.", invalid_pref: "Preferência de contato inválida.",
  request_closed: "A solicitação está encerrada. Reabra para alterar.", invalid_transition: "Essa mudança de situação não é permitida a partir da situação atual.", same_status: "A solicitação já está nessa situação.", reopen_first: "Reabra a solicitação primeiro (vai para Em análise).",
  no_change: "Nada mudou.", description_required: "Descreva o contato realizado.", already_started: "O acompanhamento pastoral já foi iniciado.", note_required: "Escreva a observação.", name_too_long: "O nome é longo demais.", invalid_phone: "Telefone inválido.",
});
Object.assign(ERRORS, {
  invalid_area: "Relatório inválido.", invalid_filter: "Algum filtro tem valor inválido. Limpe os filtros e tente de novo.", invalid_period: "Período inválido: confira as datas.", too_many_points: "Período grande demais para este agrupamento. Escolha por semana, mês ou ano.", invalid_granularity: "Agrupamento inválido.",
  invalid_bands: "Faixas etárias inválidas: cada faixa começa onde a anterior termina e a última não tem limite.", invalid_format: "Formato de arquivo inválido.",
});
Object.assign(ERRORS, {
  invalid_criteria: "Confira os critérios: algum valor está vazio ou inválido.", invalid_field: "Campo não permitido em segmentos.", invalid_operator: "Esse operador não vale para o campo escolhido.", criteria_required: "Inclua ao menos uma condição.", duplicate_name: "Já existe um item com esse nome.", invalid_owner: "Responsável inválido.", segment_inactive: "Este segmento está desativado.", group_not_active: "Este grupo não está ativo.",
  not_eligible: "A pessoa precisa ser membro ativo para ter carteira.", person_pending: "O cadastro ainda está pendente de aprovação.", already_issued: "Esta pessoa já tem carteira. Use Reemitir se precisar de um novo QR Code.", rate_limited: "Muitas tentativas seguidas. Aguarde alguns minutos.", invalid_config: "Confira os dados da configuração.", too_many: "Seleção grande demais para um lote. Divida em partes.",
});
Object.assign(ERRORS, {
  already_in_cell: "Esta pessoa já está em uma célula. Use Transferir para mudá-la.", cell_full: "A célula atingiu a capacidade.", cell_inactive: "Esta célula está inativa.", capacity_below_members: "A capacidade não pode ser menor que o número de participantes.",
  invalid_supervisor: "Supervisor inválido.", invalid_parent: "Essa hierarquia não é válida (não pode apontar para si mesma ou para alguém abaixo).", no_active_link: "Esta pessoa não está em nenhuma célula.", same_cell: "A pessoa já está nesta célula.", leader_cannot_transfer: "Quem lidera a célula precisa deixar a função antes de ser transferido.",
  person_not_found: "Pessoa não encontrada.", person_not_active: "A pessoa precisa ter cadastro ativo.", future_date: "A data da reunião não pode ser futura.", meeting_exists: "Já existe reunião registrada nesta data.", not_a_member: "Só participantes da célula entram na lista de presença.", visitor_name_required: "Informe o nome do visitante.",
  date_required: "Informe a data.", reason_required: "Informe o motivo.", name_required: "Informe o nome.", invalid_recurrence: "Repetição inválida.", dates_required: "Escolha ao menos uma data.", weekdays_required: "Escolha ao menos um dia da semana.", invalid_until: "A data final não pode ser anterior ao início.", time_required: "Informe o horário.", invalid_time: "O horário final precisa ser depois do inicial.",
  program_cancelled: "Esta programação foi cancelada.", not_an_occurrence: "A programação não acontece nesta data.", range_too_long: "Período grande demais.", invalid_items: "Lista inválida.", title_required: "Toda atividade precisa de um título.", invalid_program: "Programação inválida.", roster_closed: "Esta escala já foi encerrada.",
  duplicate_person: "A mesma pessoa aparece duas vezes.", no_people: "Adicione pessoas antes de publicar.", not_draft: "Esta escala já foi publicada.", cannot_respond: "Você não pode responder agora.", invalid_answer: "Resposta inválida.", invalid_substitute: "Substituto inválido.", substitute_required: "Escolha quem vai substituir.", already_decided: "Este pedido já foi decidido.", not_started: "A escala ainda não começou.", invalid_status: "Situação inválida.", invalid_kind: "Tipo inválido.",
});
Object.assign(ERRORS, {
  version_conflict: "Outra pessoa alterou isto agora. Os dados foram atualizados, confira e tente de novo.", journey_empty: "A jornada precisa ter ao menos uma etapa com atividade antes de ser ativada.", step_not_empty: "Esta etapa tem atividades. Remova-as antes.",
  invalid_order: "A ordem enviada não confere com a lista atual.", invalid_requires: "Escolha apenas etapas anteriores.", auto_needs_event: "Atividade automática precisa de um evento da agenda.", already_participant: "Esta pessoa já participa desta jornada.",
  journey_not_active: "Esta jornada não está ativa.", journey_archived: "Jornada arquivada não pode ser alterada.", not_eligible: "Esta jornada não está disponível para o seu perfil.", no_person_record: "Você ainda não tem ficha na igreja.",
  participation_not_active: "Esta participação não está em andamento.", step_locked: "Conclua a etapa anterior primeiro.", already_done: "Esta atividade já foi registrada.", auto_only: "Esta atividade é concluída sozinha quando o evento acontece.",
  nothing_to_approve: "Não há nada aguardando aprovação.", nothing_to_reopen: "Não há o que desfazer.", required_pending: "Ainda há atividades obrigatórias pendentes.", link_required: "Associe a decisão a uma ficha antes.",
  not_for_converts: "Esta jornada não está liberada para novos convertidos.", no_rule: "Esta jornada não tem critério de convite.", invalid_notify: "Aviso inválido.", invalid_visibility: "Visibilidade inválida.", invalid_step_mode: "Sequência inválida.",
  invalid_team: "Equipe inválida.", invalid_event: "Evento inválido.", invalid_rule: "Critério inválido.", has_participants: "Esta jornada já tem participantes.", invalid_url: "Use um link que comece com https://.", invalid_status: "Situação inválida.",
  invalid_action: "Ação inválida.", invalid_filter: "Filtro inválido.", invalid_kind: "Tipo inválido.", invalid_mode: "Forma de conclusão inválida.", text_too_long: "Texto longo demais.",
  duplicate_decision: "Já existe uma decisão dessa pessoa nesta data", person_not_found: "Não encontramos essa ficha", invalid_origin: "Escolha a origem da decisão", invalid_consent: "Autorização de contato inválida",
  invalid_time: "Horário inválido", place_too_long: "O local passou de 120 letras", note_too_long: "A observação passou do tamanho permitido", reason_required: "Informe o motivo da alteração",
  reason_too_long: "O motivo passou de 500 letras", already_linked: "Esta decisão já está associada a uma ficha", invalid_responsible: "Essa pessoa não pode ser responsável pelo acompanhamento",
  invalid_mode: "Modo de registro inválido", invalid_action: "Ação inválida", contact_not_authorized: "A pessoa não autorizou contato: não é possível registrar contato",
  followup_declined: "A pessoa não deseja acompanhamento", body_required: "Escreva o registro", body_too_long: "O texto passou de 1000 letras", invalid_channel: "Canal inválido",
  confirm_identity: "Confirme que este é o seu cadastro", invalid_highlight: "O destaque deve ser de 1 a 365 dias", title_too_long: "O título passou de 120 letras",
});
export const errText = (e) => { const m = String(e?.message || e || ""); const k = Object.keys(ERRORS).find((x) => m.includes(x)); return k ? ERRORS[k] : m; };

export const TEMPLATE_HEADERS = ["Nome completo", "Data de nascimento", "E-mail", "Telefone", "CPF", "Estado civil", "Endereço", "Cidade", "Estado", "CEP", "Classificação", "Data de ingresso na membresia"];
const KEYS = ["full_name", "birth_date", "email", "phone", "cpf", "marital_status", "address", "city", "state", "zip", "classification", "joined_at"];

export function templateXlsx() {
  return buildXlsx([
    { name: "Pessoas", rows: [TEMPLATE_HEADERS,
      ["Maria da Silva", "15/03/1985", "maria@exemplo.com", "(21) 99999-0000", "529.982.247-25", "Casado(a)", "Rua das Flores, 100", "Rio de Janeiro", "RJ", "20000-000", "Membro", "10/02/2015"],
      ["João Pereira", "02/11/1990", "", "(21) 98888-1111", "", "Solteiro(a)", "", "Niterói", "RJ", "", "Visitante", ""]] },
    { name: "Instruções", rows: [["Como preencher"],
      ["Só o nome completo é obrigatório. Apague as duas linhas de exemplo antes de importar."],
      ["Datas: dia/mês/ano (15/03/1985). Classificação: Membro, Frequentador ou Visitante (vazio = Visitante)."],
      ["Estado civil: Solteiro(a), Casado(a), Divorciado(a), Viúvo(a), União estável ou Outro."],
      ["Estado: sigla com 2 letras. CEP e CPF podem ter pontos e traços."],
      ["Cadastros que já existem (mesmo CPF, e-mail ou nome com data de nascimento) são avisados e não são substituídos."]] },
  ]);
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const HEAD = { full_name: ["nome completo", "nome"], birth_date: ["data de nascimento", "nascimento", "data nascimento", "aniversario"], email: ["e mail", "email", "e-mail"],
  phone: ["telefone", "celular", "whatsapp", "fone"], cpf: ["cpf"], marital_status: ["estado civil"], address: ["endereco", "logradouro"], city: ["cidade", "municipio"],
  state: ["estado", "uf"], zip: ["cep"], classification: ["classificacao", "situacao eclesiastica", "tipo"], joined_at: ["data de ingresso na membresia", "data de ingresso", "ingresso", "data de membresia"] };

// "15/03/1985", "1985-03-15" ou número de série do Excel -> "1985-03-15" (ou o texto original se não entender)
export function toIsoDate(v) {
  const s = String(v ?? "").trim(); if (!s) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return `${String(y).padStart(4, "0")}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{4,6}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); return d.toISOString().slice(0, 10); }
  return s;
}
const CLS = { membro: "member", membra: "member", frequentador: "attender", frequentadora: "attender", visitante: "visitor", member: "member", attender: "attender", visitor: "visitor" };
const MAR = { "solteiro a": "solteiro", "casado a": "casado", "divorciado a": "divorciado", "viuvo a": "viuvo", solteiro: "solteiro", solteira: "solteiro", casado: "casado", casada: "casado", divorciado: "divorciado", divorciada: "divorciado", viuvo: "viuvo", viuva: "viuvo", "uniao estavel": "uniao_estavel", outro: "outro", outra: "outro" };

// matriz de texto -> { records, missing, ignored } (records no formato esperado pela função people_import)
export function mapRows(rows) {
  rows = rows.filter((r) => r.some((x) => String(x || "").trim()));
  if (!rows.length) return { records: [], missing: ["Nome completo"], ignored: [] };
  const header = rows[0].map(norm), col = {};
  KEYS.forEach((k) => { const i = header.findIndex((h) => HEAD[k].some((a) => norm(a) === h)); if (i >= 0) col[k] = i; });
  const ignored = rows[0].filter((_, i) => !Object.values(col).includes(i) && String(rows[0][i] || "").trim());
  if (col.full_name == null) return { records: [], missing: ["Nome completo"], ignored };
  const records = rows.slice(1).map((r) => {
    const g = (k) => (col[k] == null ? "" : String(r[col[k]] ?? "").trim());
    const o = { full_name: g("full_name"), email: g("email"), phone: g("phone"), cpf: g("cpf"), address: g("address"), city: g("city"), state: g("state"), zip: g("zip"),
      birth_date: toIsoDate(g("birth_date")), joined_at: toIsoDate(g("joined_at")) };
    const cl = norm(g("classification")); o.classification = cl ? (CLS[cl] || cl) : "visitor";
    const ms = norm(g("marital_status")); o.marital_status = ms ? (MAR[ms] || ms) : "";
    return o;
  });
  return { records, missing: [], ignored };
}
Object.assign(ERRORS, {
  invalid_amount: "Informe um valor maior que zero.", fin_description_required: "Descreva o lançamento.", category_required: "Escolha a categoria.", due_required: "Informe o vencimento.",
  invalid_method: "Forma de pagamento inválida.", fin_future_date: "A data da baixa não pode ser futura.", account_required: "Escolha a conta usada.", invalid_installments: "Parcelas: use de 1 a 60 (e sem baixa imediata quando houver mais de uma).",
  invalid_accounts: "Escolha duas contas diferentes.", invalid_reference: "Algum item escolhido (categoria, conta, centro de custo ou campanha) não está disponível. Atualize e tente de novo.",
  entry_locked: "Este lançamento não pode mais ser alterado. Para corrigir, cancele-o (estorno) com um motivo e lance de novo.", approval_required: "Esta despesa precisa ser aprovada antes de ser paga.",
  fin_self_approval: "Quem lançou ou alterou a despesa não pode aprová-la. Peça a outro responsável.", fin_not_pending: "Esta despesa não está aguardando aprovação.", name_taken: "Já existe um item com esse nome.",
  invalid_type: "Tipo de cadastro inválido.", donor_forbidden: "Você não tem permissão para identificar quem contribuiu. Use contribuição anônima.", invalid_receipt: "Comprovante inválido. Envie o arquivo de novo.",
  fin_invalid_data: "Confira os campos: algum valor está fora do permitido.",
});
