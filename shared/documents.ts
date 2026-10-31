// Definições compartilhadas entre a API e o front: tipos de documento, seções e dados do PDF.
// Os seis primeiros seguem as modalidades da Resolução CFP 06/2019; os demais são documentos da clínica.

export type DocumentTypeKey =
  | "declaracao"
  | "atestado"
  | "relatorio"
  | "relatorio_multiprofissional"
  | "laudo"
  | "parecer"
  | "encaminhamento"
  | "termo_consentimento";

export interface SectionDef {
  key: string;
  label: string;
  hint: string;
  required: boolean;
  /** Texto-base pré-preenchido; aceita {{paciente}}, {{psicologo}}, {{crp}}, {{clinica}}. */
  template?: string;
}

export interface DocumentTypeDef {
  key: DocumentTypeKey;
  label: string;
  /** true = modalidade prevista na Resolução CFP 06/2019 */
  cfp: boolean;
  titulo: string;
  descricao: string;
  needsSolicitante: boolean;
  needsFinalidade: boolean;
  aviso?: string;
  sections: SectionDef[];
}

export const DOCUMENT_TYPES: Record<DocumentTypeKey, DocumentTypeDef> = {
  declaracao: {
    key: "declaracao",
    label: "Declaração",
    cfp: true,
    titulo: "Declaração",
    descricao: "Registra de forma resumida e objetiva uma prestação de serviço psicológico (por exemplo, comparecimento).",
    needsSolicitante: false,
    needsFinalidade: true,
    aviso: "A declaração não deve conter diagnóstico nem detalhes do atendimento.",
    sections: [
      {
        key: "registro",
        label: "Informações declaradas",
        hint: "Apenas o necessário para a finalidade informada.",
        required: true,
        template:
          "Declaro, para os devidos fins, que {{paciente}} esteve em atendimento psicológico nesta data, no horário de [início] às [fim].",
      },
    ],
  },
  atestado: {
    key: "atestado",
    label: "Atestado psicológico",
    cfp: true,
    titulo: "Atestado Psicológico",
    descricao: "Certifica uma situação, estado ou funcionamento psicológico, com base em avaliação psicológica.",
    needsSolicitante: true,
    needsFinalidade: true,
    aviso: "Decorre de avaliação psicológica e deve se restringir à informação solicitada, com o fato constatado expresso.",
    sections: [
      {
        key: "fato",
        label: "Fato constatado",
        hint: "Restrinja-se à informação solicitada.",
        required: true,
        template: "Atesto, com base em avaliação psicológica realizada, que {{paciente}} [descrever o fato constatado].",
      },
    ],
  },
  relatorio: {
    key: "relatorio",
    label: "Relatório psicológico",
    cfp: true,
    titulo: "Relatório Psicológico",
    descricao: "Exposição descritiva e circunstanciada da atuação profissional; não tem finalidade de produzir diagnóstico.",
    needsSolicitante: true,
    needsFinalidade: true,
    sections: [
      { key: "demanda", label: "Descrição da demanda", hint: "Quem solicitou, por quê e para quê.", required: true },
      { key: "procedimento", label: "Procedimento", hint: "Recursos e métodos utilizados, e número de atendimentos.", required: true },
      { key: "analise", label: "Análise", hint: "Exposição descritiva, considerando os condicionantes históricos e sociais.", required: true },
      { key: "conclusao", label: "Conclusão", hint: "Considerações, orientações e encaminhamentos.", required: true },
    ],
  },
  relatorio_multiprofissional: {
    key: "relatorio_multiprofissional",
    label: "Relatório multiprofissional",
    cfp: true,
    titulo: "Relatório Multiprofissional",
    descricao: "Resulta da atuação em contexto multiprofissional, podendo ser produzido com profissionais de outras áreas.",
    needsSolicitante: true,
    needsFinalidade: true,
    sections: [
      { key: "equipe", label: "Profissionais envolvidos", hint: "Nome, área e registro de cada profissional.", required: true },
      { key: "demanda", label: "Descrição da demanda", hint: "Quem solicitou, por quê e para quê.", required: true },
      { key: "procedimento", label: "Procedimento", hint: "Recursos e métodos utilizados.", required: true },
      { key: "analise", label: "Análise", hint: "Exposição descritiva e circunstanciada.", required: true },
      { key: "conclusao", label: "Conclusão", hint: "Considerações, orientações e encaminhamentos.", required: true },
    ],
  },
  laudo: {
    key: "laudo",
    label: "Laudo psicológico",
    cfp: true,
    titulo: "Laudo Psicológico",
    descricao: "Resultado de avaliação psicológica, com informações técnicas e científicas sobre os fenômenos psicológicos.",
    needsSolicitante: true,
    needsFinalidade: true,
    sections: [
      { key: "demanda", label: "Descrição da demanda", hint: "Quem solicitou, por quê e para quê.", required: true },
      { key: "procedimento", label: "Procedimento", hint: "Raciocínio técnico-científico, recursos e referencial teórico-metodológico.", required: true },
      { key: "analise", label: "Análise", hint: "Interpretação dos dados, com o referencial que fundamenta as conclusões.", required: true },
      { key: "conclusao", label: "Conclusão", hint: "Resultado da avaliação, indicações e encaminhamentos.", required: true },
      { key: "referencias", label: "Referências", hint: "Fontes e instrumentos citados.", required: false },
    ],
  },
  parecer: {
    key: "parecer",
    label: "Parecer psicológico",
    cfp: true,
    titulo: "Parecer Psicológico",
    descricao: "Análise técnica que responde a uma questão do campo psicológico ou a documentos psicológicos questionados.",
    needsSolicitante: true,
    needsFinalidade: true,
    sections: [
      { key: "demanda", label: "Descrição da demanda", hint: "A questão-problema a ser respondida.", required: true },
      { key: "analise", label: "Análise", hint: "Discussão técnica da questão específica.", required: true },
      { key: "conclusao", label: "Conclusão", hint: "Pronunciamento indicativo ou conclusivo.", required: true },
      { key: "referencias", label: "Referências", hint: "Fontes citadas.", required: false },
    ],
  },
  encaminhamento: {
    key: "encaminhamento",
    label: "Encaminhamento",
    cfp: false,
    titulo: "Encaminhamento",
    descricao: "Encaminha a pessoa atendida a outro profissional ou serviço, com o mínimo de informação necessária.",
    needsSolicitante: false,
    needsFinalidade: true,
    aviso: "Compartilhe somente o necessário para a continuidade do cuidado.",
    sections: [
      { key: "destinatario", label: "Destinatário", hint: "Profissional ou serviço que receberá a pessoa.", required: true },
      {
        key: "motivo",
        label: "Motivo do encaminhamento",
        hint: "Sem detalhes além do necessário.",
        required: true,
        template: "Encaminho {{paciente}} para avaliação e acompanhamento, pelo seguinte motivo: [descrever].",
      },
    ],
  },
  termo_consentimento: {
    key: "termo_consentimento",
    label: "Termo de consentimento e contrato de serviços",
    cfp: false,
    titulo: "Termo de Consentimento e Contrato de Prestação de Serviços Psicológicos",
    descricao: "Formaliza o atendimento, o sigilo, os honorários e o tratamento de dados pessoais (LGPD).",
    needsSolicitante: false,
    needsFinalidade: false,
    aviso: "Modelo-base: revise e adapte conforme as orientações do seu conselho regional e do seu jurídico.",
    sections: [
      {
        key: "objeto",
        label: "Objeto",
        hint: "",
        required: true,
        template:
          "Este termo formaliza a prestação de serviços psicológicos por {{psicologo}} (CRP {{crp}}), na {{clinica}}, a {{paciente}}, mediante consentimento livre e esclarecido, com atendimentos em dia e horário previamente combinados.",
      },
      {
        key: "sigilo",
        label: "Sigilo profissional",
        hint: "",
        required: true,
        template:
          "As informações do atendimento são sigilosas e só poderão ser compartilhadas nas hipóteses previstas no Código de Ética Profissional do Psicólogo e na legislação, ou mediante autorização expressa da pessoa atendida.",
      },
      {
        key: "honorarios",
        label: "Honorários, faltas e cancelamentos",
        hint: "",
        required: true,
        template:
          "O valor de cada sessão é de R$ [valor], com pagamento [forma e prazo]. Faltas e cancelamentos devem ser comunicados com antecedência mínima de [prazo]; [definir a regra de cobrança].",
      },
      {
        key: "lgpd",
        label: "Tratamento de dados pessoais",
        hint: "",
        required: true,
        template:
          "Os dados pessoais e de saúde da pessoa atendida serão tratados exclusivamente para a prestação do serviço, o registro documental exigido pela profissão e o cumprimento de obrigações legais, com acesso restrito e pelo prazo de guarda previsto em norma. A pessoa atendida pode solicitar informações sobre seus dados nos termos da Lei Geral de Proteção de Dados.",
      },
      {
        key: "vigencia",
        label: "Vigência e encerramento",
        hint: "",
        required: false,
        template:
          "O acompanhamento tem início na data deste termo e pode ser encerrado por qualquer das partes, preferencialmente após conversa de encerramento.",
      },
    ],
  },
};

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES) as DocumentTypeKey[];

export interface Identificacao {
  paciente_nome: string;
  paciente_nascimento: string | null;
  psicologo_nome: string;
  psicologo_crp: string;
  clinica_nome: string;
}

export interface LetterheadData {
  modo: "padrao" | "imagem" | "impresso";
  margem_top_mm: number;
  margem_bottom_mm: number;
  margem_left_mm: number;
  margem_right_mm: number;
  logo_data_url: string | null;
  linhas: string[];
  rodape: string | null;
  fundo_data_url: string | null;
}

export interface DocumentData {
  tipo: DocumentTypeKey;
  titulo: string;
  status: "rascunho" | "emitido" | "anulado";
  numero: string | null;
  codigo: string | null;
  content_hash: string | null;
  data_documento: string;
  local: string | null;
  solicitante: string | null;
  finalidade: string | null;
  conteudo: Record<string, string>;
  identificacao: Identificacao;
  emitted_at: string | null;
  annul_reason: string | null;
}

export function fillTemplate(text: string, ctx: { paciente: string; psicologo: string; crp: string; clinica: string }) {
  return text
    .split("{{paciente}}").join(ctx.paciente)
    .split("{{psicologo}}").join(ctx.psicologo)
    .split("{{crp}}").join(ctx.crp)
    .split("{{clinica}}").join(ctx.clinica);
}

export function formatCodigo(codigo: string) {
  return codigo.replace(/(.{4})(?=.)/g, "$1-");
}

/** JSON estável (chaves ordenadas): a mesma entrada gera sempre o mesmo hash. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
