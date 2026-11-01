import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES, fillTemplate, identificacaoPaciente } from "@shared/documents";

const base = { paciente: "Fulano Ciclano", psicologo: "Dra. Ana", crp: "06/1", clinica: "Clínica" };

describe("modelos de documento", () => {
  it("identifica o paciente com CPF e CNS, só com o que está cadastrado", () => {
    expect(identificacaoPaciente("52998224725", "700000000000005")).toBe(", portador do CPF 529.982.247-25 e do CNS 700 0000 0000 0005,");
    expect(identificacaoPaciente("52998224725", null)).toBe(", portador do CPF 529.982.247-25,");
    expect(identificacaoPaciente(null, "700000000000005")).toBe(", portador do CNS 700 0000 0000 0005,");
    expect(identificacaoPaciente(null, null)).toBe("");
  });

  it("a declaração de comparecimento traz CPF, CNS e o horário da sessão", () => {
    const modelo = DOCUMENT_TYPES.declaracao.sections[0]!.template!;
    const inicio = new Date(2030, 2, 4, 9, 0).toISOString();
    const fim = new Date(2030, 2, 4, 9, 50).toISOString();
    expect(fillTemplate(modelo, { ...base, cpf: "52998224725", cns: "700000000000005", inicio, fim })).toBe(
      "Declaro, para os devidos fins, que Fulano Ciclano, portador do CPF 529.982.247-25 e do CNS 700 0000 0000 0005, esteve em atendimento psicológico no dia 04/03/2030, das 09:00 às 09:50.",
    );
  });

  it("sem sessão informada, mantém os campos de data e horário para preencher", () => {
    const modelo = DOCUMENT_TYPES.declaracao.sections[0]!.template!;
    expect(fillTemplate(modelo, base)).toBe("Declaro, para os devidos fins, que Fulano Ciclano esteve em atendimento psicológico nesta data, no horário de [início] às [fim].");
  });
});
