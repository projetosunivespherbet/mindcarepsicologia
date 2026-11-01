import { describe, expect, it } from "vitest";
import { ENDERECO_VAZIO, montarEndereco, partesDoViaCep } from "@/components/AddressInput";

describe("endereço em partes", () => {
  it("o CEP preenche rua, bairro, cidade e UF, mantendo número e complemento", () => {
    const atual = { ...ENDERECO_VAZIO, end_numero: "10", end_complemento: "apto 2" };
    expect(partesDoViaCep({ cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }, atual)).toEqual({
      end_cep: "01001000", end_logradouro: "Praça da Sé", end_numero: "10", end_complemento: "apto 2", end_bairro: "Sé", end_cidade: "São Paulo", end_uf: "SP",
    });
  });
  it("monta o texto do endereço para os documentos", () => {
    expect(montarEndereco({ end_cep: "01001000", end_logradouro: "Praça da Sé", end_numero: "10", end_complemento: "apto 2", end_bairro: "Sé", end_cidade: "São Paulo", end_uf: "SP" })).toBe(
      "Praça da Sé, 10, apto 2, Sé, São Paulo/SP, CEP 01001-000",
    );
    expect(montarEndereco({ ...ENDERECO_VAZIO, end_cidade: "Cajamar", end_uf: "SP" })).toBe("Cajamar/SP");
    expect(montarEndereco(ENDERECO_VAZIO)).toBe("");
  });
});
