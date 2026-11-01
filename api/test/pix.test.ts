import { afterAll, describe, expect, it } from "vitest";
import { appPool, call, mkClinic, mkUser, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

describe("chave Pix do profissional", () => {
  it("o admin cadastra e limpa; os demais perfis enxergam na lista de profissionais; recusa formato inválido", async () => {
    const c = await mkClinic();
    const psi = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
    const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
    const patch = (token: string, body: Record<string, unknown>) => call("PATCH", `/users/${psi.id}`, { token, body });

    for (const chave of ["11144477735", "ana@Clinica.test", "+5511999998888", "123e4567-e12b-12d1-a456-426655440000"]) {
      const r = await patch(c.adminToken, { pix_chave: chave });
      expect(r.status, chave).toBe(200);
    }
    expect((await patch(c.adminToken, { pix_chave: "ANA@Clinica.test" })).json.pix_chave).toBe("ana@clinica.test");

    for (const ruim of ["12345", "11 99999-8888", "com espaço@x.com", "https://pix.example/abc"]) {
      expect((await patch(c.adminToken, { pix_chave: ruim })).status, ruim).toBe(400);
    }
    expect((await patch(psi.token, { pix_chave: "11144477735" })).status).toBe(403);

    const lista = await call("GET", "/professionals", { token: rec.token });
    expect(lista.json.find((p: { id: string }) => p.id === psi.id).pix_chave).toBe("ana@clinica.test");

    expect((await patch(c.adminToken, { pix_chave: null })).json.pix_chave).toBeNull();
  });
});
