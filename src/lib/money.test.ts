import { describe, expect, it } from "vitest";
import { brl, centsToInput, dateBR, monthLabel, parseBRL } from "./money";

describe("parseBRL", () => {
  it("aceita as formas usuais de digitar um valor", () => {
    expect(parseBRL("150")).toBe(15000);
    expect(parseBRL("150,5")).toBe(15050);
    expect(parseBRL("150,50")).toBe(15050);
    expect(parseBRL("1.250,00")).toBe(125000);
    expect(parseBRL("R$ 1.250,00")).toBe(125000);
    expect(parseBRL("150.50")).toBe(15050);
    expect(parseBRL("1.250")).toBe(125000);
  });
  it("recusa vazio, zero, negativo, texto e mais de duas casas", () => {
    for (const v of ["", "0", "0,00", "-10", "abc", "10,999", "1,2,3", "100000,01"]) expect(parseBRL(v)).toBeNull();
  });
});

describe("formatação", () => {
  it("formata valores e datas", () => {
    expect(brl(125000).replace(/\s/g, " ")).toBe("R$ 1.250,00");
    expect(centsToInput(15050)).toBe("150,50");
    expect(monthLabel("2030-03-01")).toBe("03/2030");
    expect(dateBR("2030-03-20")).toBe("20/03/2030");
  });
});
