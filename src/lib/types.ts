import type { DocumentData, DocumentTypeKey, LetterheadData } from "@shared/documents";

export type Role = "admin" | "psicologo" | "recepcao";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administração",
  psicologo: "Psicólogo(a)",
  recepcao: "Recepção",
};

export interface Me {
  id: string;
  nome: string;
  email: string;
  role: Role;
  crp: string | null;
  atende: boolean;
  telefone: string | null;
  clinic_nome: string;
  timezone: string;
}

export interface Clinic {
  id: string;
  nome: string;
  timezone: string;
  documento_tipo: "cpf" | "cnpj" | null;
  documento: string | null;
  razao_social: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  updated_at: string;
}

export interface AppUser {
  id: string;
  nome: string;
  email: string | null;
  role: Role;
  crp: string | null;
  cpf: string | null;
  pix_chave: string | null;
  atende: boolean;
  telefone: string | null;
  status: "convidado" | "ativo" | "inativo";
  last_login_at: string | null;
}

export interface InviteLink {
  token: string;
  link: string;
  expires_at: string;
}

export interface Professional {
  id: string;
  nome: string;
  crp: string | null;
  pix_chave: string | null;
}

export interface Anamnesis {
  queixa_principal: string | null;
  historico_familiar: string | null;
  medicamentos: string | null;
  tratamentos_anteriores: string | null;
  expectativas: string | null;
}

export interface Patient {
  id: string;
  nome: string;
  cpf: string | null;
  cns: string | null;
  endereco: string | null;
  data_nascimento: string | null;
  telefone: string | null;
  email: string | null;
  genero: string | null;
  estado_civil: string | null;
  profissao: string | null;
  professional_id: string | null;
  ativo: boolean;
}

export interface PatientDetail extends Patient {
  anamnesis: Anamnesis | null;
}

export interface LetterheadRow extends LetterheadData {
  id: string;
  nome: string;
  is_default: boolean;
  ativo: boolean;
}

export interface DocListItem {
  id: string;
  patient_id: string;
  tipo: DocumentTypeKey;
  titulo: string;
  status: "rascunho" | "emitido" | "anulado";
  numero: string | null;
  data_documento: string;
  emitted_at: string | null;
  paciente_nome: string;
}

export interface DocFull extends DocumentData {
  id: string;
  patient_id: string;
  professional_id: string;
  letterhead: LetterheadData | null;
}

export interface VerifyResult {
  tipo: DocumentTypeKey;
  titulo: string;
  numero: string;
  status: "emitido" | "anulado";
  emitted_at: string;
  annulled_at: string | null;
  psicologo_nome: string;
  psicologo_crp: string;
  clinica_nome: string;
  content_hash: string;
}

export type ChargeStatus = "aberta" | "parcial" | "paga" | "cancelada";
export type PaymentMethod = "pix" | "dinheiro" | "cartao" | "transferencia" | "boleto" | "convenio" | "outro";

export interface Charge {
  id: string;
  patient_id: string;
  paciente_nome: string | null;
  professional_id: string;
  profissional_nome: string | null;
  descricao: string;
  competencia: string; // AAAA-MM-01
  valor_centavos: number;
  desconto_centavos: number;
  liquido_centavos: number;
  paid_centavos: number;
  saldo_centavos: number;
  vencimento: string | null;
  status: ChargeStatus;
  cancel_reason: string | null;
  atrasada: boolean;
  convenio: boolean;
  imposto_recolhido: boolean;
  nota_status: FiscalStatus | null;
}

export interface Payment {
  id: string;
  charge_id: string;
  valor_centavos: number;
  metodo: PaymentMethod;
  pago_em: string;
  observacao: string | null;
  reverses_id: string | null;
  motivo_estorno: string | null;
  estornado: boolean;
}

export interface ChargeDetail extends Charge {
  pagamentos: Payment[];
}

export type Regime = "mei" | "simples" | "presumido" | "outro";

export interface Issuer {
  id: string;
  tipo: "clinica" | "profissional";
  professional_id: string | null;
  cnpj: string;
  razao_social: string;
  inscricao_municipal: string | null;
  municipio_ibge: string;
  regime: Regime;
  serie: string;
  codigo_tributacao_padrao: string | null;
  emissor_nacional_ok: boolean;
  habilitado_em: string | null;
  ativo: boolean;
  updated_at: string;
}

export type FiscalStatus = "rascunho" | "emitida" | "cancelada";

export interface FiscalDoc {
  id: string;
  issuer_id: string;
  status: FiscalStatus;
  origem: "nacional" | "municipal";
  tomador: { nome: string; cpf_cnpj: string | null; email: string | null; origem: string };
  valor_centavos: number;
  competencia: string;
  data_emissao: string;
  chave_acesso: string | null;
  numero_nfse: string | null;
  emitida_em: string | null;
  cancel_motivo: string | null;
  tem_xml: boolean;
  emissor_professional_id: string | null;
  charge_ids: string[];
  pendencias: string[];
  pronta: boolean;
  avisos?: string[];
}

export interface DpsPack {
  emissor: { cnpj: string; razao_social: string; inscricao_municipal: string | null; municipio_ibge: string; regime: Regime };
  tomador: { nome: string; cpf_cnpj: string | null; email: string | null };
  servico: { descricao: string; codigo_tributacao: string | null; sugestao: string };
  valor_centavos: number;
  competencia: string;
  data_emissao: string;
  passos: string[];
}

export type Atendimento = "particular" | "convenio" | "pro_bono";

export type AppointmentStatus = "agendado" | "confirmado" | "realizado" | "faltou" | "cancelado";

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  tipo: "individual" | "grupo";
  status: AppointmentStatus;
  valor: number | null; // em reais
  payment_status: "pendente" | "pago" | "nao_pago";
  convenio: boolean;
  atendimento: Atendimento;
  nota_status: FiscalStatus | null;
  /** true/false só para o profissional da sessão (psicólogo); nulo para quem não acessa o prontuário. */
  prontuario: boolean | null;
  /** Nome de quem marcou a sessão. */
  agendado_por: string | null;
  created_at: string;
  imposto: boolean;
  series_id: string | null;
}

export interface Service {
  id: string;
  nome: string;
  valor_centavos: number;
  duracao_min: number | null;
  professional_id: string | null;
  ativo: boolean;
}

export interface Payer {
  id: string;
  nome: string;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  vinculo: string | null;
  ativo: boolean;
}

export interface FinanceSummary {
  periodo: { from: string; to: string };
  faturado_centavos: number;
  recebido_centavos: number;
  em_aberto_centavos: number;
  atrasado_centavos: number;
  por_profissional: { professional_id: string; nome: string; faturado_centavos: number; recebido_centavos: number; em_aberto_centavos: number; atrasado_centavos: number }[];
}

export interface Receivables {
  totais: Record<"a_vencer" | "sem_vencimento" | "ate_30" | "de_31_a_60" | "mais_de_60", number>;
  itens: (Charge & { faixa: string; dias_atraso: number | null })[];
}

export interface TimeBlock {
  id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  motivo: string | null;
}
