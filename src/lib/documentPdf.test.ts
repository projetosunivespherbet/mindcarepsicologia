import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DocumentData, LetterheadData } from "@shared/documents";
import { DEFAULT_LETTERHEAD, renderDocumentPdf } from "./documentPdf";

// PNG mínimo (RGB) gerado em memória, para testar logo e fundo sem arquivos binários no repositório.
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString("base64")}`;
}

const LOGO = png(120, 120, (x, y) => (x > 30 && x < 90 && y > 30 && y < 90 ? [240, 250, 248] : [20, 120, 110]));
const FUNDO = png(420, 594, (x, y) => {
  if (y < 48) return [20, 120, 110];
  if (y > 556) return [214, 236, 232];
  if (x < 8 || x > 411) return [190, 225, 220];
  return [255, 255, 255];
});

const base: DocumentData = {
  tipo: "declaracao",
  titulo: "Declaração",
  status: "emitido",
  numero: "2030/0007",
  codigo: "K7QM2XPD9R4T",
  content_hash: "a3f1c9d2e47b8a60b5d1f3c2e9a8b7c6d5e4f30a1b2c3d4e5f60718293a4b5c6",
  data_documento: "2030-03-04",
  local: "Cajamar/SP",
  solicitante: null,
  finalidade: "Comprovar comparecimento ao atendimento psicológico",
  conteudo: { registro: "Declaro, para os devidos fins, que Maria de Souza Albuquerque esteve em atendimento psicológico nesta data, no horário de 14h às 15h." },
  identificacao: {
    paciente_nome: "Maria de Souza Albuquerque",
    paciente_nascimento: "1990-05-10",
    psicologo_nome: "Dra. Ana Beatriz Lima",
    psicologo_crp: "06/123456",
    clinica_nome: "Clínica Exemplo",
  },
  emitted_at: "2030-03-04T17:42:00.000Z",
  annul_reason: null,
};

const paragrafo =
  "A avaliação foi conduzida em sete encontros semanais, com entrevistas semiestruturadas, observação clínica e aplicação de instrumentos padronizados, considerando o histórico escolar, familiar e social da pessoa atendida, bem como as demandas apresentadas pela instituição solicitante. ";

const laudo: DocumentData = {
  ...base,
  tipo: "laudo",
  titulo: "Laudo Psicológico",
  numero: "2030/0008",
  solicitante: "Vara da Infância e Juventude de Cajamar",
  finalidade: "Subsidiar decisão judicial sobre acompanhamento psicológico",
  conteudo: {
    demanda: paragrafo.repeat(2),
    procedimento: `${paragrafo.repeat(4)}\n${paragrafo.repeat(3)}`,
    analise: `${paragrafo.repeat(6)}\n${paragrafo.repeat(5)}\n${paragrafo.repeat(4)}`,
    conclusao: paragrafo.repeat(3),
    referencias: "CONSELHO FEDERAL DE PSICOLOGIA. Resolução CFP nº 06/2019. Brasília: CFP, 2019.",
  },
};

const padrao: LetterheadData = {
  ...DEFAULT_LETTERHEAD,
  modo: "padrao",
  logo_data_url: LOGO,
  linhas: ["Clínica Exemplo de Psicologia", "CNPJ 00.000.000/0001-00 · Rua das Flores, 100 — Cajamar/SP", "(11) 4444-0000 · contato@clinicaexemplo.com.br"],
  rodape: "Clínica Exemplo de Psicologia · Atendimento mediante agendamento",
};
const imagem: LetterheadData = { ...DEFAULT_LETTERHEAD, modo: "imagem", fundo_data_url: FUNDO, margem_top_mm: 40, margem_bottom_mm: 30 };
const impresso: LetterheadData = { ...DEFAULT_LETTERHEAD, modo: "impresso", margem_top_mm: 50, margem_bottom_mm: 35 };

const out = process.env.PDF_OUT;
async function gerar(nome: string, d: DocumentData, lh: LetterheadData | null) {
  const pdf = await renderDocumentPdf(d, lh, { verifyBaseUrl: "https://clinica.pages.dev" });
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/${nome}.pdf`, bytes);
  }
  return { pdf, bytes };
}

describe("PDF dos documentos", () => {
  it("declaração em papel timbrado gerado (logo, linhas e rodapé)", async () => {
    const { pdf, bytes } = await gerar("1-declaracao-padrao", base, padrao);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it("laudo longo quebra em várias páginas com imagem de fundo em todas", async () => {
    const { pdf } = await gerar("2-laudo-imagem", laudo, imagem);
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("modo para imprimir em papel timbrado físico (só margens)", async () => {
    const { pdf } = await gerar("3-laudo-impresso", laudo, impresso);
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("rascunho e anulado recebem marca d'água; rascunho não tem verificação", async () => {
    await gerar("4-rascunho", { ...base, status: "rascunho", numero: null, codigo: null, content_hash: null, emitted_at: null }, null);
    await gerar("5-anulado", { ...base, status: "anulado", annul_reason: "Dados do paciente incorretos" }, padrao);
  });

  it("relatório com seções numeradas e sem papel timbrado", async () => {
    const r: DocumentData = { ...laudo, tipo: "relatorio", titulo: "Relatório Psicológico", conteudo: { ...laudo.conteudo, referencias: "" } };
    const { pdf } = await gerar("6-relatorio-sem-timbre", r, null);
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("termo de consentimento", async () => {
    const t: DocumentData = {
      ...base,
      tipo: "termo_consentimento",
      titulo: "Termo de Consentimento e Contrato de Prestação de Serviços Psicológicos",
      finalidade: null,
      conteudo: {
        objeto: "Este termo formaliza a prestação de serviços psicológicos por Dra. Ana Beatriz Lima (CRP 06/123456), na Clínica Exemplo, a Maria de Souza Albuquerque, mediante consentimento livre e esclarecido.",
        sigilo: "As informações do atendimento são sigilosas e só poderão ser compartilhadas nas hipóteses previstas no Código de Ética Profissional do Psicólogo.",
        honorarios: "O valor de cada sessão é de R$ 180,00, com pagamento ao final de cada atendimento.",
        lgpd: "Os dados pessoais e de saúde serão tratados exclusivamente para a prestação do serviço e o registro documental exigido pela profissão.",
      },
    };
    await gerar("7-termo", t, padrao);
  });
});
