import { describe, expect, it } from "vitest";
import { crc16, pixCopiaECola } from "@shared/pix";

describe("Pix copia e cola", () => {
  it("calcula o CRC16 conforme o padrão (vetor clássico e exemplo do Banco Central)", () => {
    expect(crc16("123456789")).toBe("29B1");
    const exemploBcb = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16(exemploBcb)).toBe("1D3D");
  });

  it("monta o código com valor, nome sem acento e cidade", () => {
    const code = pixCopiaECola({ chave: "11144477735", valorCentavos: 25000, nome: "Dra. Ana Lima", cidade: "São Paulo" });
    expect(code).toBe("00020101021126330014br.gov.bcb.pix0111111444777355204000053039865406250.005802BR5912DRA ANA LIMA6009SAO PAULO62070503***63048646");
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });

  it("omite o valor quando é zero e limita nome a 25 e cidade a 15 caracteres", () => {
    const code = pixCopiaECola({ chave: "a@b.com", nome: "Nome Muito Comprido Para O Campo Do Pix", cidade: "Cidade De Nome Muito Longo" });
    expect(code).not.toContain("54");
    expect(code).toContain("5925NOME MUITO COMPRIDO PARA");
    expect(code).toMatch(/6015CIDADE DE NOME M/);
  });
});
