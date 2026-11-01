import { describe, expect, it } from "vitest";
import { enderecoDoCep } from "@/components/AddressInput";

describe("endereço pelo CEP", () => {
  it("monta rua, bairro, cidade/UF e CEP, deixando o número para completar", () => {
    expect(enderecoDoCep("01001000", { logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" })).toBe("Praça da Sé, nº , Sé, São Paulo/SP, CEP 01001-000");
  });
  it("CEP de cidade sem logradouro traz só cidade/UF e CEP", () => {
    expect(enderecoDoCep("07750000", { logradouro: "", bairro: "", localidade: "Cajamar", uf: "SP" })).toBe("Cajamar/SP, CEP 07750-000");
  });
});
