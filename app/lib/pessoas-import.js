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
  invalid_label: "O nome da categoria deve ter de 2 a 40 letras", already_exists: "Já existe uma categoria com esse nome", invalid_filter: "Filtro inválido", note_too_long: "A observação é longa demais (máximo 500 letras)", too_many_rows: "A planilha tem linhas demais (máximo 5.000)" };
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
