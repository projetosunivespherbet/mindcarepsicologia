import { afterAll, describe, expect, it } from "vitest";
import { appPool, at, call, mkClinic, mkUser, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Paciente Um" } })).json;
  const sessao = async (dia: number, status?: string) => {
    const ap = (await call("POST", "/appointments", { token: psiA.token, body: { patient_id: pac.id, starts_at: at(dia, "09:00"), ends_at: at(dia, "10:00"), valor: 200 } })).json;
    if (status) await call("PATCH", `/appointments/${ap.id}`, { token: psiA.token, body: { status } });
    return ap.id as string;
  };
  return { c, psiA, psiB, rec, pac, sessao };
}

describe("pacote de sessões", () => {
  it("cria o pacote com uma cobrança única e desconta cada sessão realizada", async () => {
    const s = await cenario();
    const novo = await call("POST", "/packages", { token: s.psiA.token, body: { patient_id: s.pac.id, sessoes: 2, valor_centavos: 36000, vencimento: "2030-03-01" } });
    expect(novo.status).toBe(201);
    expect(novo.json).toMatchObject({ sessoes: 2, usadas: 0, saldo: 2, status: "ativo", charge_status: "aberta", professional_id: s.psiA.id });
    const ch = (await call("GET", `/charges/${novo.json.charge_id}`, { token: s.psiA.token })).json;
    expect(ch).toMatchObject({ origem: "pacote", valor_centavos: 36000, descricao: "Pacote de 2 sessões", appointment_id: null });

    const a1 = await s.sessao(0, "realizado");
    const u1 = await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a1 } });
    expect(u1.status).toBe(200);
    expect(u1.json).toMatchObject({ usadas: 1, saldo: 1 });
    // repetir não desconta duas vezes
    expect((await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a1 } })).json.saldo).toBe(1);
    // sessão do pacote não gera cobrança avulsa
    expect((await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: a1 } })).status).toBe(422);

    // falta: desconta se o profissional escolher
    const a2 = await s.sessao(1, "faltou");
    expect((await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a2 } })).json).toMatchObject({ usadas: 2, saldo: 0 });

    // sem saldo: 404 e a sessão segue para cobrança avulsa
    const a3 = await s.sessao(2, "realizado");
    expect((await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a3 } })).status).toBe(404);
    expect((await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: a3 } })).status).toBe(201);
    expect((await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a3 } })).status).toBe(409);

    // devolver a falta ao pacote libera saldo; sessão cancelada também não conta
    expect((await call("POST", "/packages/release", { token: s.psiA.token, body: { appointment_id: a2 } })).status).toBe(200);
    const lista = (await call("GET", `/packages?patient_id=${s.pac.id}`, { token: s.psiA.token })).json;
    expect(lista[0]).toMatchObject({ usadas: 1, saldo: 1 });
    await call("PATCH", `/appointments/${a1}`, { token: s.psiA.token, body: { status: "cancelado" } });
    expect((await call("GET", `/packages?patient_id=${s.pac.id}`, { token: s.psiA.token })).json[0].saldo).toBe(2);
  });

  it("geração em lote ignora sessões do pacote; encerrado não desconta", async () => {
    const s = await cenario();
    const p = (await call("POST", "/packages", { token: s.psiA.token, body: { patient_id: s.pac.id, sessoes: 5, valor_centavos: 90000 } })).json;
    const a1 = await s.sessao(0, "realizado");
    await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a1 } });
    const g = await call("POST", "/charges/generate", { token: s.c.adminToken, body: { from: at(0, "00:00"), to: at(7, "00:00") } });
    expect(g.json.criadas).toBe(0);

    expect((await call("PATCH", `/packages/${p.id}`, { token: s.psiA.token, body: { status: "encerrado" } })).json.status).toBe("encerrado");
    const a2 = await s.sessao(1, "realizado");
    expect((await call("POST", "/packages/use", { token: s.psiA.token, body: { appointment_id: a2 } })).status).toBe(404);
  });

  it("recepção cria pacote para o responsável; outro psicólogo não vê nem usa", async () => {
    const s = await cenario();
    expect((await call("POST", "/packages", { token: s.rec.token, body: { patient_id: s.pac.id, sessoes: 4, valor_centavos: 70000 } })).json.professional_id).toBe(s.psiA.id);
    expect((await call("GET", `/packages?patient_id=${s.pac.id}`, { token: s.psiB.token })).json).toEqual([]);
    expect((await call("POST", "/packages", { token: s.rec.token, body: { patient_id: s.pac.id, sessoes: 0, valor_centavos: 100 } })).status).toBe(400);
  });

  it("a agenda informa a cobrança e o pacote da sessão", async () => {
    const s = await cenario();
    const a1 = await s.sessao(0);
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: a1, vencimento: "2030-03-04" } })).json;
    const item = (await call("GET", `/appointments?from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(7, "00:00"))}`, { token: s.psiA.token })).json.find((a: { id: string }) => a.id === a1);
    expect(item).toMatchObject({ charge_id: ch.id, package_id: null });
  });
});
