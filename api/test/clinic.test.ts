import { afterAll, describe, expect, it } from "vitest";
import { appPool, call, mkClinic, mkUser, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const CNPJ = "11222333000181";
const CPF = "52998224725";

describe("dados da clínica", () => {
  it("o administrador lê e altera nome, fuso, documento e contato", async () => {
    const c = await mkClinic();
    const before = await call("GET", "/clinic", { token: c.adminToken });
    expect(before.status).toBe(200);
    expect(before.json.documento).toBeNull();

    const r = await call("PATCH", "/clinic", {
      token: c.adminToken,
      body: {
        nome: "Clínica Bem-Estar",
        timezone: "America/Manaus",
        documento_tipo: "cnpj",
        documento: "11.222.333/0001-81",
        razao_social: "Bem-Estar Psicologia Ltda",
        telefone: "(11) 4000-0000",
        email: "Contato@Clinica.Test",
        endereco: "Rua A, 10 - São Paulo/SP",
      },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ nome: "Clínica Bem-Estar", timezone: "America/Manaus", documento_tipo: "cnpj", documento: CNPJ, email: "contato@clinica.test" });

    const me = await call("GET", "/me", { token: c.adminToken });
    expect(me.json.clinic_nome).toBe("Clínica Bem-Estar");
    expect(me.json.timezone).toBe("America/Manaus");
  });

  it("aceita CPF válido e permite limpar o documento", async () => {
    const c = await mkClinic();
    const ok = await call("PATCH", "/clinic", { token: c.adminToken, body: { documento_tipo: "cpf", documento: "529.982.247-25" } });
    expect(ok.status).toBe(200);
    expect(ok.json.documento).toBe(CPF);

    const clear = await call("PATCH", "/clinic", { token: c.adminToken, body: { documento_tipo: null, documento: "" } });
    expect(clear.status).toBe(200);
    expect(clear.json.documento_tipo).toBeNull();
    expect(clear.json.documento).toBeNull();
  });

  it("recusa documento inválido, documento pela metade e fuso inexistente", async () => {
    const c = await mkClinic();
    const patch = (body: Record<string, unknown>) => call("PATCH", "/clinic", { token: c.adminToken, body });
    expect((await patch({ documento_tipo: "cnpj", documento: "11222333000180" })).status).toBe(400);
    expect((await patch({ documento_tipo: "cpf", documento: CNPJ })).status).toBe(400);
    expect((await patch({ documento_tipo: "cnpj", documento: "" })).status).toBe(400);
    expect((await patch({ documento_tipo: null, documento: CNPJ })).status).toBe(400);
    expect((await patch({ documento_tipo: "cnpj" })).status).toBe(400);
    expect((await patch({ timezone: "Marte/Olympus" })).status).toBe(400);
    expect((await patch({ email: "isto-nao-e-email" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it("psicólogo e recepção não leem nem alteram a clínica", async () => {
    const c = await mkClinic();
    const psi = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
    const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
    for (const u of [psi, rec]) {
      expect((await call("GET", "/clinic", { token: u.token })).status).toBe(403);
      expect((await call("PATCH", "/clinic", { token: u.token, body: { nome: "Invasão" } })).status).toBe(403);
    }
    expect((await call("GET", "/clinic")).status).toBe(401);
  });

  it("uma clínica não altera os dados de outra", async () => {
    const a = await mkClinic();
    const b = await mkClinic();
    await call("PATCH", "/clinic", { token: a.adminToken, body: { nome: "Clínica A Renomeada", documento_tipo: "cnpj", documento: CNPJ } });
    const lidaPorB = await call("GET", "/clinic", { token: b.adminToken });
    expect(lidaPorB.json.id).toBe(b.clinicId);
    expect(lidaPorB.json.nome).toBe("Clínica Teste");
    expect(lidaPorB.json.documento).toBeNull();
  });

  it("registra a alteração no histórico de auditoria", async () => {
    const c = await mkClinic();
    await call("PATCH", "/clinic", { token: c.adminToken, body: { nome: "Clínica Auditada" } });
    const r = await ownerPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'clinic.update'", [c.clinicId]);
    expect(r.rows[0].n).toBe(1);
  });
});

describe("edição de usuários pelo administrador", () => {
  it("altera nome, telefone e CRP; recepção nunca atende", async () => {
    const c = await mkClinic();
    const psi = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });

    const r1 = await call("PATCH", `/users/${psi.id}`, { token: c.adminToken, body: { nome: "Dra. Ana Lima Souza", telefone: "11 99999-0000", crp: "06/99999" } });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ nome: "Dra. Ana Lima Souza", telefone: "11 99999-0000", crp: "06/99999", atende: true });

    const r2 = await call("PATCH", `/users/${psi.id}`, { token: c.adminToken, body: { role: "recepcao", atende: false, crp: null } });
    expect(r2.status).toBe(200);
    expect(r2.json).toMatchObject({ role: "recepcao", atende: false, crp: null });
  });

  it("quem atende precisa de CRP, e só o administrador edita usuários", async () => {
    const c = await mkClinic();
    const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
    const semCrp = await call("PATCH", `/users/${rec.id}`, { token: c.adminToken, body: { role: "psicologo", atende: true, crp: null } });
    expect(semCrp.status).toBe(422);
    expect((await call("PATCH", `/users/${rec.id}`, { token: rec.token, body: { nome: "Outro Nome" } })).status).toBe(403);
  });
});

describe("encarregado de dados e informações públicas da clínica", () => {
  it("a administração define o encarregado; qualquer pessoa logada lê as informações da clínica", async () => {
    const c = await mkClinic();
    const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
    const r = await call("PATCH", "/clinic", { token: c.adminToken, body: { encarregado_nome: "Ana Souza", encarregado_email: "DPO@Clinica.test" } });
    expect(r.json).toMatchObject({ encarregado_nome: "Ana Souza", encarregado_email: "dpo@clinica.test" });
    expect((await call("PATCH", "/clinic", { token: c.adminToken, body: { encarregado_email: "nao-e-email" } })).status).toBe(400);
    const info = await call("GET", "/clinic-info", { token: rec.token });
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({ nome: "Clínica Teste", encarregado_nome: "Ana Souza", encarregado_email: "dpo@clinica.test" });
    expect((await call("GET", "/clinic-info")).status).toBe(401);
  });
});
