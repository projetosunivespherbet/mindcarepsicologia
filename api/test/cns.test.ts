import { afterAll, describe, expect, it } from "vitest";
import { isValidCns } from "../src/validation";
import { appPool, call, mkClinic, mkUser, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

describe("CNS (Cartão Nacional de Saúde)", () => {
  it("valida o dígito verificador dos números definitivos e provisórios", () => {
    for (const ok of ["100000000000007", "200000000010009", "170000000000008", "700000000000005", "898000000000002", "100000000060018"]) expect(isValidCns(ok), ok).toBe(true);
    for (const ruim of ["100000000000008", "700000000000006", "300000000000000", "12345", "abc000000000007", "1000000000000070"]) expect(isValidCns(ruim), ruim).toBe(false);
  });

  it("o paciente guarda o CNS (aceita espaços), recusa número inválido e permite remover", async () => {
    const c = await mkClinic();
    const psi = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
    const novo = await call("POST", "/patients", { token: psi.token, body: { nome: "Maria Souza", cpf: "529.982.247-25", cns: "700 0000 0000 0005" } });
    expect(novo.status).toBe(201);
    expect(novo.json).toMatchObject({ cpf: "52998224725", cns: "700000000000005" });

    expect((await call("POST", "/patients", { token: psi.token, body: { nome: "Outra Pessoa", cns: "700000000000006" } })).status).toBe(400);
    expect((await call("PATCH", `/patients/${novo.json.id}`, { token: psi.token, body: { cns: "123" } })).status).toBe(400);

    const troca = await call("PATCH", `/patients/${novo.json.id}`, { token: psi.token, body: { cns: "898000000000002" } });
    expect(troca.json.cns).toBe("898000000000002");
    const limpo = await call("PATCH", `/patients/${novo.json.id}`, { token: psi.token, body: { cns: null } });
    expect(limpo.json.cns).toBeNull();
  });
});
