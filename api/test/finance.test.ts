import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { withSession } from "../src/db";
import { isValidCnpj, isValidCpf } from "../src/validation";
import { app, appPool, at, call, env, mkClinic, mkUser, ownerPool, uniq } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Maria Souza" } })).json;
  return { ...c, psiA, psiB, rec, pac };
}
type S = Awaited<ReturnType<typeof cenario>>;

const key = () => uniq("idem-key-");
const pay = (token: string, chargeId: string, valor_centavos: number, extra: Record<string, unknown> = {}, k = key()) =>
  call("POST", `/charges/${chargeId}/payments`, { token, headers: { "Idempotency-Key": k }, body: { valor_centavos, metodo: "pix", ...extra } });

/** Cobrança manual da psicóloga A para a paciente, em março de 2030. */
const cobranca = async (s: S, extra: Record<string, unknown> = {}, token = s.psiA.token) =>
  (await call("POST", "/charges", { token, body: { patient_id: s.pac.id, competencia: "2030-03", valor_centavos: 20000, ...extra } })).json;

const sessao = async (token: string, s: S, day: number, extra: Record<string, unknown> = {}) =>
  (await call("POST", "/appointments", { token, body: { patient_id: s.pac.id, starts_at: at(day, "09:00"), ends_at: at(day, "10:00"), ...extra } })).json;

const marcar = (token: string, id: string, status: string) => call("PATCH", `/appointments/${id}`, { token, body: { status } });

describe("CPF e CNPJ", () => {
  it("valida dígitos verificadores (inclusive CNPJ alfanumérico)", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE34")).toBe(false);
  });
});

describe("catálogo de serviços", () => {
  it("psicólogo edita só os próprios preços; recepção só lê; admin cria serviço geral", async () => {
    const s = await cenario();
    const a = await call("POST", "/services", { token: s.psiA.token, body: { nome: "Sessão individual", valor_centavos: 20000, professional_id: s.psiB.id } });
    expect(a.status).toBe(201);
    expect(a.json.professional_id).toBe(s.psiA.id); // ignora o profissional informado
    expect((await call("POST", "/services", { token: s.rec.token, body: { nome: "Sessão", valor_centavos: 100 } })).status).toBe(403);
    const geral = await call("POST", "/services", { token: s.adminToken, body: { nome: "Sessão padrão", valor_centavos: 18000 } });
    expect(geral.status).toBe(201);
    expect(geral.json.professional_id).toBeNull();
    expect((await call("PATCH", `/services/${a.json.id}`, { token: s.psiB.token, body: { valor_centavos: 1 } })).status).toBe(404);
    expect((await call("PATCH", `/services/${geral.json.id}`, { token: s.psiA.token, body: { valor_centavos: 1 } })).status).toBe(404);
    const up = await call("PATCH", `/services/${a.json.id}`, { token: s.psiA.token, body: { valor_centavos: 25000 } });
    expect(up.json.valor_centavos).toBe(25000);
    expect((await call("GET", "/services", { token: s.rec.token })).json).toHaveLength(2);
    expect((await call("POST", "/services", { token: s.adminToken, body: { nome: "Sessão", valor_centavos: 0 } })).status).toBe(400);
  });
});

describe("responsáveis financeiros", () => {
  it("valida e normaliza o documento", async () => {
    const s = await cenario();
    expect((await call("POST", "/payers", { token: s.rec.token, body: { nome: "João Souza", cpf_cnpj: "111.111.111-11" } })).status).toBe(400);
    const ok = await call("POST", "/payers", { token: s.rec.token, body: { nome: "João Souza", cpf_cnpj: "529.982.247-25", vinculo: "pai" } });
    expect(ok.status).toBe(201);
    expect(ok.json.cpf_cnpj).toBe("52998224725");
    const pj = await call("POST", "/payers", { token: s.rec.token, body: { nome: "Empresa X", cpf_cnpj: "11.222.333/0001-81" } });
    expect(pj.json.cpf_cnpj).toBe("11222333000181");
  });

  it("psicólogo só vê responsáveis que criou ou que usa nas próprias cobranças", async () => {
    const s = await cenario();
    const r = (await call("POST", "/payers", { token: s.rec.token, body: { nome: "Responsável da recepção" } })).json;
    const p = (await call("POST", "/payers", { token: s.psiA.token, body: { nome: "Responsável da Ana" } })).json;
    const ids = async (t: string) => (await call("GET", "/payers", { token: t })).json.map((x: any) => x.id);
    expect(await ids(s.psiA.token)).toEqual([p.id]);
    expect(await ids(s.adminToken)).toHaveLength(2);
    expect(await ids(s.psiB.token)).toEqual([]);
    await call("POST", "/charges", { token: s.adminToken, body: { patient_id: s.pac.id, professional_id: s.psiA.id, payer_id: r.id, competencia: "2030-03", valor_centavos: 100 } });
    expect(await ids(s.psiA.token)).toHaveLength(2);
    expect((await call("PATCH", `/payers/${r.id}`, { token: s.psiB.token, body: { nome: "Outro Nome" } })).status).toBe(404);
  });
});

describe("cobranças", () => {
  it("psicólogo cria para si; outro psicólogo não vê; recepção e admin veem", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    expect(ch.status).toBe("aberta");
    expect(ch.professional_id).toBe(s.psiA.id);
    expect(ch.liquido_centavos).toBe(20000);
    expect(ch.saldo_centavos).toBe(20000);
    expect(ch.descricao).toBe("Atendimento psicológico");
    const lista = (t: string) => call("GET", "/charges?from=2030-03-01&to=2030-03-31", { token: t });
    expect((await lista(s.psiA.token)).json).toHaveLength(1);
    expect((await lista(s.rec.token)).json).toHaveLength(1);
    expect((await lista(s.adminToken)).json).toHaveLength(1);
    expect((await lista(s.psiB.token)).json).toHaveLength(0);
    expect((await call("GET", `/charges/${ch.id}`, { token: s.psiB.token })).status).toBe(404);
    // psicólogo B não enxerga a paciente da A, então não cobra por ela
    expect((await cobranca(s, {}, s.psiB.token)).error).toBe("Paciente não encontrado");
  });

  it("lista por paciente devolve o histórico inteiro; sem paciente exige período", async () => {
    const s = await cenario();
    await cobranca(s, { competencia: "2029-01" });
    await cobranca(s, { competencia: "2030-03" });
    const todas = await call("GET", `/charges?patient_id=${s.pac.id}`, { token: s.psiA.token });
    expect(todas.json.map((x: any) => x.competencia)).toEqual(["2030-03-01", "2029-01-01"]);
    expect((await call("GET", `/charges?patient_id=${s.pac.id}`, { token: s.psiB.token })).json).toEqual([]);
    expect((await call("GET", "/charges", { token: s.adminToken })).status).toBe(400);
    expect((await call("GET", "/charges?from=2030-03-01", { token: s.adminToken })).status).toBe(400);
  });

  it("recepção precisa indicar o psicólogo; valor vem do serviço ou da sessão; desconto menor que o valor", async () => {
    const s = await cenario();
    const sv = (await call("POST", "/services", { token: s.psiA.token, body: { nome: "Sessão", valor_centavos: 17000 } })).json;
    const base = { patient_id: s.pac.id, competencia: "2030-03" };
    expect((await call("POST", "/charges", { token: s.rec.token, body: { ...base, professional_id: undefined, valor_centavos: 100 } })).status).toBe(201); // usa o responsável da paciente (psiA)
    const semProf = (await call("POST", "/patients", { token: s.adminToken, body: { nome: "Sem Responsável" } })).json;
    expect((await call("POST", "/charges", { token: s.rec.token, body: { patient_id: semProf.id, valor_centavos: 100 } })).status).toBe(422);
    const porServico = await call("POST", "/charges", { token: s.rec.token, body: { ...base, service_id: sv.id } });
    expect(porServico.json.valor_centavos).toBe(17000);
    const doCatalogo = await call("POST", "/charges", { token: s.rec.token, body: base }); // sem valor: vale o preço do catálogo
    expect(doCatalogo.json.valor_centavos).toBe(17000);
    await call("PATCH", `/services/${sv.id}`, { token: s.psiA.token, body: { ativo: false } });
    expect((await call("POST", "/charges", { token: s.rec.token, body: base })).status).toBe(422); // sem valor e sem serviço ativo
    expect((await call("POST", "/charges", { token: s.rec.token, body: { ...base, valor_centavos: 1000, desconto_centavos: 1000 } })).status).toBe(422);
    const comDesconto = await call("POST", "/charges", { token: s.rec.token, body: { ...base, valor_centavos: 20000, desconto_centavos: 5000 } });
    expect(comDesconto.json.liquido_centavos).toBe(15000);
  });

  it("cobrança de sessão herda profissional, valor e competência; só uma ativa por sessão", async () => {
    const s = await cenario();
    const ap = await sessao(s.psiA.token, s, 0, { valor: 150, convenio: true });
    const ch = await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } });
    expect(ch.status).toBe(201);
    expect(ch.json).toMatchObject({ valor_centavos: 15000, competencia: "2030-03-01", origem: "sessao", convenio: true, professional_id: s.psiA.id });
    const dup = await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } });
    expect(dup.status).toBe(409);
    const outra = (await call("POST", "/patients", { token: s.psiA.token, body: { nome: "Outro Paciente" } })).json;
    expect((await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: outra.id, appointment_id: ap.id } })).status).toBe(422);
  });

  it("PATCH altera só campos permitidos; cancelamento exige motivo; cancelada é imutável", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    const up = await call("PATCH", `/charges/${ch.id}`, { token: s.rec.token, body: { vencimento: "2030-03-20", forma_prevista: "pix", desconto_centavos: 1000 } });
    expect(up.json).toMatchObject({ vencimento: "2030-03-20", forma_prevista: "pix", liquido_centavos: 19000 });
    expect((await call("PATCH", `/charges/${ch.id}`, { token: s.rec.token, body: { valor_centavos: 1 } })).status).toBe(400); // sem campo válido
    expect((await call("POST", `/charges/${ch.id}/cancel`, { token: s.rec.token, body: { motivo: "x" } })).status).toBe(400);
    const cancel = await call("POST", `/charges/${ch.id}/cancel`, { token: s.rec.token, body: { motivo: "Lançada por engano" } });
    expect(cancel.json).toMatchObject({ status: "cancelada", cancel_reason: "Lançada por engano" });
    expect((await call("PATCH", `/charges/${ch.id}`, { token: s.rec.token, body: { descricao: "Novo texto" } })).status).toBe(422);
    expect((await pay(s.rec.token, ch.id, 100)).status).toBe(422);
  });
});

describe("pagamentos", () => {
  it("exige Idempotency-Key; parcial vira parcial, total vira paga; não passa do saldo", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    expect((await call("POST", `/charges/${ch.id}/payments`, { token: s.rec.token, body: { valor_centavos: 100, metodo: "pix" } })).status).toBe(400);
    const p1 = await pay(s.rec.token, ch.id, 5000, { pago_em: "2020-01-15" });
    expect(p1.status).toBe(201);
    expect(p1.json.charge).toMatchObject({ status: "parcial", paid_centavos: 5000, saldo_centavos: 15000 });
    expect((await pay(s.rec.token, ch.id, 15001)).status).toBe(422);
    const p2 = await pay(s.rec.token, ch.id, 15000);
    expect(p2.json.charge).toMatchObject({ status: "paga", paid_centavos: 20000, saldo_centavos: 0 });
    expect((await pay(s.rec.token, ch.id, 1)).status).toBe(422);
    const det = (await call("GET", `/charges/${ch.id}`, { token: s.psiA.token })).json;
    expect(det.pagamentos).toHaveLength(2);
    expect((await pay(s.rec.token, ch.id, 100, { pago_em: "2999-01-01" })).status).toBe(422);
  });

  it("repetir a mesma chave devolve o mesmo pagamento; chave reutilizada com outro valor é conflito", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    const k = key();
    const a = await pay(s.rec.token, ch.id, 5000, {}, k);
    const b = await pay(s.rec.token, ch.id, 5000, {}, k);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.payment.id).toBe(a.json.payment.id);
    expect(b.json.charge.paid_centavos).toBe(5000);
    expect((await pay(s.rec.token, ch.id, 6000, {}, k)).status).toBe(409);
  });

  it("quem pode pagar: recepção e o psicólogo da cobrança; outro psicólogo não", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    expect((await pay(s.psiB.token, ch.id, 100)).status).toBe(404);
    expect((await pay(s.psiA.token, ch.id, 100)).status).toBe(201);
    expect((await pay(s.rec.token, ch.id, 100)).status).toBe(201);
    expect((await pay(s.adminToken, ch.id, 100, { recebido_por: "clinica" })).json.payment.recebido_por).toBe("clinica");
  });

  it("dois pagamentos simultâneos não estouram o saldo", async () => {
    const s = await cenario();
    const ch = await cobranca(s, { valor_centavos: 10000 });
    const rs = await Promise.all([pay(s.rec.token, ch.id, 7000), pay(s.rec.token, ch.id, 7000)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await call("GET", `/charges/${ch.id}`, { token: s.adminToken })).json.paid_centavos).toBe(7000);
  });

  it("estorno: só admin e o psicólogo da cobrança; mesmo valor; uma vez só; devolve o saldo", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    const p = (await pay(s.rec.token, ch.id, 20000)).json.payment;
    expect((await call("POST", `/payments/${p.id}/reverse`, { token: s.rec.token, body: { motivo: "Valor lançado errado" } })).status).toBe(403);
    expect((await call("POST", `/payments/${p.id}/reverse`, { token: s.psiB.token, body: { motivo: "Valor lançado errado" } })).status).toBe(404);
    expect((await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "x" } })).status).toBe(400);
    const rev = await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Valor lançado errado" } });
    expect(rev.status).toBe(201);
    expect(rev.json.charge).toMatchObject({ status: "aberta", paid_centavos: 0 });
    expect(rev.json.payment).toMatchObject({ reverses_id: p.id, valor_centavos: 20000, motivo_estorno: "Valor lançado errado" });
    expect((await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Valor lançado errado" } })).status).toBe(409);
    expect((await call("POST", `/payments/${rev.json.payment.id}/reverse`, { token: s.adminToken, body: { motivo: "Estornar o estorno" } })).status).toBe(422);
    const det = (await call("GET", `/charges/${ch.id}`, { token: s.adminToken })).json;
    expect(det.pagamentos.find((x: any) => x.id === p.id).estornado).toBe(true);
    // psicólogo da cobrança também pode estornar o que registrou
    const p2 = (await pay(s.psiA.token, ch.id, 100)).json.payment;
    expect((await call("POST", `/payments/${p2.id}/reverse`, { token: s.psiA.token, body: { motivo: "Lançado por engano" } })).status).toBe(201);
  });

  it("cobrança com pagamento ativo não cancela; depois do estorno cancela", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    const p = (await pay(s.rec.token, ch.id, 1000)).json.payment;
    const bloqueada = await call("POST", `/charges/${ch.id}/cancel`, { token: s.rec.token, body: { motivo: "Cancelar tudo" } });
    expect(bloqueada.status).toBe(422);
    expect(bloqueada.json.error).toMatch(/estorne/i);
    await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Pagamento indevido" } });
    expect((await call("POST", `/charges/${ch.id}/cancel`, { token: s.rec.token, body: { motivo: "Cancelar tudo" } })).status).toBe(200);
    // desconto não muda depois de haver pagamento
    const ch2 = await cobranca(s);
    await pay(s.rec.token, ch2.id, 1000);
    expect((await call("PATCH", `/charges/${ch2.id}`, { token: s.rec.token, body: { desconto_centavos: 500 } })).status).toBe(422);
  });

  it("o banco recusa editar/apagar pagamento e mexer em saldo ou status por fora", async () => {
    const s = await cenario();
    const ch = await cobranca(s);
    const p = (await pay(s.rec.token, ch.id, 1000)).json.payment;
    await expect(ownerPool.query("UPDATE payments SET valor_centavos = 1 WHERE id = $1", [p.id])).rejects.toMatchObject({ code: "23514" });
    await expect(ownerPool.query("DELETE FROM payments WHERE id = $1", [p.id])).rejects.toMatchObject({ code: "23514" });
    const sessao = { userId: s.adminId, clinicId: s.clinicId, role: "admin" as const, atende: false };
    await expect(withSession(appPool as any, sessao, (db) => db.query("UPDATE payments SET valor_centavos = 1 WHERE id = $1", [p.id]))).rejects.toMatchObject({ code: "42501" });
    await expect(withSession(appPool as any, sessao, (db) => db.query("UPDATE charges SET paid_centavos = 20000 WHERE id = $1", [ch.id]))).rejects.toMatchObject({ code: "42501" });
    await expect(withSession(appPool as any, sessao, (db) => db.query("UPDATE charges SET status = 'paga' WHERE id = $1", [ch.id]))).rejects.toMatchObject({ code: "23514" });
    const intacta = (await call("GET", `/charges/${ch.id}`, { token: s.adminToken })).json;
    expect(intacta).toMatchObject({ status: "parcial", paid_centavos: 1000 });
  });
});

describe("integração com a agenda", () => {
  it("payment_status da sessão acompanha a cobrança", async () => {
    const s = await cenario();
    const ap = await sessao(s.psiA.token, s, 0, { valor: 100 });
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } })).json;
    const status = async () =>
      (await call("GET", `/appointments?from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(1, "00:00"))}`, { token: s.psiA.token })).json[0].payment_status;
    const p = (await pay(s.rec.token, ch.id, 10000)).json.payment;
    expect(await status()).toBe("pago");
    await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Pagamento indevido" } });
    expect(await status()).toBe("pendente");
  });

  it("cancelar a sessão cancela a cobrança; com pagamento ativo, exige estorno antes", async () => {
    const s = await cenario();
    const ap = await sessao(s.psiA.token, s, 1, { valor: 100 });
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } })).json;
    const p = (await pay(s.rec.token, ch.id, 10000)).json.payment;
    const bloqueio = await marcar(s.psiA.token, ap.id, "cancelado");
    expect(bloqueio.status).toBe(422);
    expect(bloqueio.json.error).toMatch(/estorne/i);
    await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Sessão desmarcada" } });
    expect((await marcar(s.psiA.token, ap.id, "cancelado")).status).toBe(200);
    const depois = (await call("GET", `/charges/${ch.id}`, { token: s.adminToken })).json;
    expect(depois).toMatchObject({ status: "cancelada", cancel_reason: "Sessão cancelada" });
    expect((await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } })).status).toBe(422);
  });
});

describe("geração em lote", () => {
  it("cria cobrança das sessões realizadas, usa o catálogo quando falta valor e não duplica", async () => {
    const s = await cenario();
    await call("POST", "/services", { token: s.psiA.token, body: { nome: "Sessão", valor_centavos: 17000 } });
    const comValor = await sessao(s.psiA.token, s, 0, { valor: 150 });
    const semValorA = await sessao(s.psiA.token, s, 1);
    const semValorB = (await call("POST", "/appointments", { token: s.adminToken, body: { patient_id: s.pac.id, professional_id: s.psiB.id, starts_at: at(2, "09:00"), ends_at: at(2, "10:00") } })).json;
    // o Bruno só pode realizar a sessão enquanto houver um serviço geral ativo; depois ele é desativado
    const geral = (await call("POST", "/services", { token: s.adminToken, body: { nome: "Sessão padrão", valor_centavos: 15000 } })).json;
    const agendada = await sessao(s.psiA.token, s, 3, { valor: 150 });
    const falta = await sessao(s.psiA.token, s, 4, { valor: 150 });
    for (const [t, ap] of [[s.psiA.token, comValor], [s.psiA.token, semValorA], [s.adminToken, semValorB], [s.psiA.token, falta]] as const) {
      await marcar(t, ap.id, ap === falta ? "faltou" : "realizado");
    }
    await call("PATCH", `/services/${geral.id}`, { token: s.adminToken, body: { ativo: false } });
    const body = { from: at(0, "00:00"), to: at(7, "00:00") };
    expect((await call("POST", "/charges/generate", { token: s.psiA.token, body })).status).toBe(403);
    const r1 = await call("POST", "/charges/generate", { token: s.rec.token, body });
    expect(r1.json).toEqual({ criadas: 2, sem_valor: 1 }); // comValor + semValorA (catálogo); semValorB sem preço
    const r2 = await call("POST", "/charges/generate", { token: s.rec.token, body });
    expect(r2.json).toEqual({ criadas: 0, sem_valor: 1 });
    const lista = (await call("GET", "/charges?from=2030-03-01&to=2030-03-31", { token: s.adminToken })).json;
    expect(lista.map((c: any) => c.valor_centavos).sort()).toEqual([15000, 17000]);
    expect(lista.every((c: any) => c.origem === "sessao")).toBe(true);
    const r3 = await call("POST", "/charges/generate", { token: s.rec.token, body: { ...body, incluir_faltas: true } });
    expect(r3.json.criadas).toBe(1);
    expect(agendada.status).toBe("agendado"); // sessão só agendada não gera cobrança
    expect((await call("POST", "/charges/generate", { token: s.rec.token, body: { from: at(0, "00:00"), to: at(120, "00:00") } })).status).toBe(400);
  });
});

describe("relatórios", () => {
  it("resumo: faturado, recebido, em aberto e atrasado; psicólogo vê só o próprio", async () => {
    const s = await cenario();
    const ch1 = await cobranca(s, { valor_centavos: 20000, vencimento: "2020-01-10" });
    await cobranca(s, { valor_centavos: 10000 });
    await pay(s.rec.token, ch1.id, 8000, { pago_em: "2020-01-15" });
    const outraPac = (await call("POST", "/patients", { token: s.psiB.token, body: { nome: "Paciente do Bruno" } })).json;
    await call("POST", "/charges", { token: s.psiB.token, body: { patient_id: outraPac.id, competencia: "2030-03", valor_centavos: 5000 } });

    const mar = await call("GET", "/finance/summary?from=2030-03-01&to=2030-03-31", { token: s.adminToken });
    expect(mar.json).toMatchObject({ faturado_centavos: 35000, em_aberto_centavos: 27000, recebido_centavos: 0 });
    expect(mar.json.atrasado_centavos).toBe(12000);
    const jan = await call("GET", "/finance/summary?from=2020-01-01&to=2020-01-31", { token: s.adminToken });
    expect(jan.json.recebido_centavos).toBe(8000);

    const dela = (await call("GET", "/finance/summary?from=2030-03-01&to=2030-03-31", { token: s.psiA.token })).json;
    expect(dela.faturado_centavos).toBe(30000);
    expect(dela.por_profissional).toHaveLength(1);
    expect(dela.por_profissional[0].professional_id).toBe(s.psiA.id);
    expect((await call("GET", "/finance/summary?from=2030-03-31&to=2030-03-01", { token: s.adminToken })).status).toBe(400);
  });

  it("inadimplência por faixa: só administração e recepção", async () => {
    const s = await cenario();
    await cobranca(s, { valor_centavos: 10000, vencimento: "2020-01-10" });
    await cobranca(s, { valor_centavos: 3000, vencimento: "2999-01-01" });
    await cobranca(s, { valor_centavos: 2000 });
    expect((await call("GET", "/finance/receivables", { token: s.psiA.token })).status).toBe(403);
    const r = await call("GET", "/finance/receivables", { token: s.rec.token });
    expect(r.json.totais).toMatchObject({ mais_de_60: 10000, a_vencer: 3000, sem_vencimento: 2000, ate_30: 0, de_31_a_60: 0 });
    expect(r.json.itens).toHaveLength(3);
    expect(r.json.itens.find((i: any) => i.faixa === "mais_de_60").atrasada).toBe(true);
  });

  it("exportação CSV: só admin, com BOM, vírgula decimal, estorno negativo e proteção contra fórmulas", async () => {
    const s = await cenario();
    const perigosa = (await call("POST", "/patients", { token: s.psiA.token, body: { nome: "=HYPERLINK(\"http://x\")" } })).json;
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: perigosa.id, competencia: "2030-03", valor_centavos: 12345 } })).json;
    const ano = new Date().getUTCFullYear();
    const p = (await pay(s.rec.token, ch.id, 12345, { pago_em: `${ano}-01-02` })).json.payment;
    await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Pagamento indevido" } });
    const url = `/finance/export?from=${ano}-01-01&to=${ano}-12-31`;
    const get = (token: string) => app.request(url, { headers: { Authorization: `Bearer ${token}` } }, env);
    expect((await get(s.rec.token)).status).toBe(403);
    expect((await get(s.psiA.token)).status).toBe(403);
    const r = await get(s.adminToken);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain(`financeiro-${ano}-01-01_${ano}-12-31.csv`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para o Excel reconhecer UTF-8
    const linhas = new TextDecoder().decode(bytes).trimEnd().split("\r\n"); // o decoder já descarta o BOM
    expect(linhas[0]).toBe("data;tipo;valor;metodo;recebido_por;competencia;paciente;profissional;responsavel;cobranca");
    expect(linhas).toHaveLength(3); // cabeçalho, pagamento e estorno (só desta clínica)
    expect(linhas[1]).toContain(`${ano}-01-02;pagamento;123,45;pix;profissional;2030-03;\"'=HYPERLINK(\"\"http://x\"\")\"`);
    expect(linhas[2]).toContain(";estorno;-123,45;pix;profissional;2030-03;");
  });
});

describe("migração dos dados legados", () => {
  it("sessões realizadas com valor viram cobrança; as pagas ganham pagamento 'migrado'; reaplicar não duplica", async () => {
    const s = await cenario();
    const ap = await sessao(s.psiA.token, s, 0, { valor: 80.5 });
    await marcar(s.psiA.token, ap.id, "realizado");
    const paga = await sessao(s.psiA.token, s, 1, { valor: 100 });
    await marcar(s.psiA.token, paga.id, "realizado");
    await call("PATCH", `/appointments/${paga.id}`, { token: s.psiA.token, body: { payment_status: "pago" } });

    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "004_finance.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("INSERT INTO charges"));
    const client = await ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(backfill);
      await client.query(backfill); // idempotente
      const ch = (await client.query("SELECT appointment_id, valor_centavos, status, origem, paid_centavos FROM charges WHERE appointment_id = ANY($1) ORDER BY valor_centavos", [[ap.id, paga.id]])).rows;
      expect(ch).toEqual([
        { appointment_id: ap.id, valor_centavos: 8050, status: "aberta", origem: "migracao", paid_centavos: 0 },
        { appointment_id: paga.id, valor_centavos: 10000, status: "paga", origem: "migracao", paid_centavos: 10000 },
      ]);
      const pg = (await client.query("SELECT count(*)::int AS n, min(observacao) AS obs FROM payments p JOIN charges c ON c.id = p.charge_id WHERE c.appointment_id = $1", [paga.id])).rows[0];
      expect(pg).toEqual({ n: 1, obs: "migrado" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
