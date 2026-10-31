import { afterAll, describe, expect, it } from "vitest";
import { appPool, at, call, mkClinic, mkUser, ownerPool, uniq } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Maria Souza", cpf: "529.982.247-25" } })).json;
  return { ...c, psiA, psiB, rec, pac };
}
type S = Awaited<ReturnType<typeof cenario>>;

const sessao = async (s: S, day: number, extra: Record<string, unknown> = {}, token = s.psiA.token) =>
  (await call("POST", "/appointments", { token, body: { patient_id: s.pac.id, starts_at: at(day, "09:00"), ends_at: at(day, "10:00"), ...extra } })).json;
const marcar = (token: string, id: string, status: string) => call("PATCH", `/appointments/${id}`, { token, body: { status } });
const historico = async (s: S, table: string, rowId: string) => (await call("GET", `/audit/changes?table=${table}&row_id=${rowId}`, { token: s.adminToken })).json as any[];

describe("tipo de atendimento", () => {
  it("particular é o padrão e exige valor para ser realizado; pro bono não tem valor nem cobrança", async () => {
    const s = await cenario();
    const semValor = await sessao(s, 0);
    expect(semValor.atendimento).toBe("particular");
    const recusada = await marcar(s.psiA.token, semValor.id, "realizado");
    expect(recusada.status).toBe(422);
    expect(recusada.json.error).toMatch(/pro bono/);

    const comValor = await sessao(s, 1, { valor: 150 });
    expect((await marcar(s.psiA.token, comValor.id, "realizado")).status).toBe(200);

    const pro = await sessao(s, 2, { atendimento: "pro_bono" });
    expect(pro).toMatchObject({ atendimento: "pro_bono", convenio: false });
    const ok = await marcar(s.psiA.token, pro.id, "realizado");
    expect(ok.status).toBe(200);
    const semCobranca = await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: pro.id } });
    expect(semCobranca.status).toBe(422);
    expect(semCobranca.json.error).toMatch(/pro bono/);
    // pro bono com valor é recusado, na criação e depois de realizada
    expect((await call("POST", "/appointments", { token: s.psiA.token, body: { patient_id: s.pac.id, starts_at: at(3, "09:00"), ends_at: at(3, "10:00"), atendimento: "pro_bono", valor: 100 } })).status).toBe(422);
    expect((await call("PATCH", `/appointments/${pro.id}`, { token: s.psiA.token, body: { valor: 100 } })).status).toBe(422);
  });

  it("o catálogo serve de valor quando a sessão não tem; a cobrança nasce com o preço do serviço", async () => {
    const s = await cenario();
    await call("POST", "/services", { token: s.psiA.token, body: { nome: "Sessão", valor_centavos: 17000 } });
    const ap = await sessao(s, 0);
    expect((await marcar(s.psiA.token, ap.id, "realizado")).status).toBe(200);
    const ch = await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } });
    expect(ch.status).toBe(201);
    expect(ch.json.valor_centavos).toBe(17000);
  });

  it("não vira pro bono uma sessão que já tem cobrança; convênio e tipo de atendimento andam juntos", async () => {
    const s = await cenario();
    const ap = await sessao(s, 0, { valor: 100 });
    await marcar(s.psiA.token, ap.id, "realizado");
    await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } });
    const r = await call("PATCH", `/appointments/${ap.id}`, { token: s.psiA.token, body: { atendimento: "pro_bono", valor: null } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/cobrança/);

    const conv = await sessao(s, 1, { convenio: true, valor: 100 });
    expect(conv).toMatchObject({ atendimento: "convenio", convenio: true });
    const volta = await call("PATCH", `/appointments/${conv.id}`, { token: s.psiA.token, body: { convenio: false } });
    expect(volta.json).toMatchObject({ atendimento: "particular", convenio: false });
    const novo = await call("PATCH", `/appointments/${conv.id}`, { token: s.psiA.token, body: { atendimento: "convenio" } });
    expect(novo.json).toMatchObject({ atendimento: "convenio", convenio: true });
    const pb = await sessao(s, 2, { atendimento: "pro_bono" });
    expect((await call("PATCH", `/appointments/${pb.id}`, { token: s.psiA.token, body: { convenio: false } })).json.atendimento).toBe("pro_bono"); // não sai de pro bono sem querer
  });

  it("a geração em lote ignora as sessões pro bono", async () => {
    const s = await cenario();
    const a = await sessao(s, 0, { valor: 100 });
    const b = await sessao(s, 1, { atendimento: "pro_bono" });
    await marcar(s.psiA.token, a.id, "realizado");
    await marcar(s.psiA.token, b.id, "realizado");
    const r = await call("POST", "/charges/generate", { token: s.rec.token, body: { from: at(0, "00:00"), to: at(7, "00:00") } });
    expect(r.json).toEqual({ criadas: 1, sem_valor: 0 });
  });
});

describe("pendências de emissão e situação da nota", () => {
  it("lista as cobranças sem nota; a nota some da lista; convênio e cancelada ficam de fora", async () => {
    const s = await cenario();
    const iss = (await call("POST", "/fiscal/issuers", { token: s.psiA.token, body: { cnpj: "11.222.333/0001-81", razao_social: "Ana Lima Psicologia Ltda", municipio_ibge: "3516408", emissor_nacional_ok: true } })).json;
    const nova = (extra: Record<string, unknown>) => call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, competencia: "2030-03", valor_centavos: 20000, ...extra } });
    const sem = (await nova({})).json;
    const comNota = (await nova({})).json;
    const conv = (await nova({ convenio: true })).json;
    const cancelada = (await nova({})).json;
    await call("POST", `/charges/${cancelada.id}/cancel`, { token: s.psiA.token, body: { motivo: "Lançada por engano" } });

    let r = (await call("GET", "/finance/pending-invoices", { token: s.psiA.token })).json;
    expect(r.itens.map((c: any) => c.id).sort()).toEqual([comNota.id, sem.id].sort());
    expect(r.total_centavos).toBe(40000);
    expect(r.itens.every((c: any) => c.nota_status === null)).toBe(true);

    const doc = (await call("POST", "/nfse", { token: s.rec.token, body: { issuer_id: iss.id, charge_ids: [comNota.id] } })).json;
    r = (await call("GET", "/finance/pending-invoices", { token: s.rec.token })).json;
    expect(r.itens.map((c: any) => c.id)).toEqual([sem.id]);
    const lista = (await call("GET", `/charges?patient_id=${s.pac.id}`, { token: s.psiA.token })).json;
    expect(lista.find((c: any) => c.id === comNota.id).nota_status).toBe("rascunho");
    await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: "1".repeat(50), numero_nfse: "1" } });
    expect((await call("GET", `/charges?patient_id=${s.pac.id}`, { token: s.psiA.token })).json.find((c: any) => c.id === comNota.id).nota_status).toBe("emitida");
    expect(conv.convenio).toBe(true);
    // outro psicólogo não vê as pendências alheias
    expect((await call("GET", "/finance/pending-invoices", { token: s.psiB.token })).json.itens).toEqual([]);
  });

  it("a agenda mostra a situação da nota de cada sessão", async () => {
    const s = await cenario();
    const iss = (await call("POST", "/fiscal/issuers", { token: s.psiA.token, body: { cnpj: "11.222.333/0001-81", razao_social: "Ana Lima Psicologia Ltda", municipio_ibge: "3516408", emissor_nacional_ok: true } })).json;
    const ap = await sessao(s, 0, { valor: 100 });
    await marcar(s.psiA.token, ap.id, "realizado");
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, appointment_id: ap.id } })).json;
    const nota = async () => (await call("GET", `/appointments?from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(1, "00:00"))}`, { token: s.psiA.token })).json[0].nota_status;
    expect(await nota()).toBeNull();
    await call("POST", "/nfse", { token: s.rec.token, body: { issuer_id: iss.id, charge_ids: [ch.id] } });
    expect(await nota()).toBe("rascunho");
  });
});

describe("histórico de alterações", () => {
  it("grava a criação e cada mudança de valor, com o valor antigo e o novo e quem fez", async () => {
    const s = await cenario();
    const ap = await sessao(s, 0, { valor: 150 });
    await call("PATCH", `/appointments/${ap.id}`, { token: s.rec.token, body: { valor: 180 } });
    await call("PATCH", `/appointments/${ap.id}`, { token: s.psiA.token, body: { starts_at: at(0, "10:00"), ends_at: at(0, "11:00") } });
    const h = await historico(s, "appointments", ap.id);
    expect(h.map((x) => x.action)).toEqual(["UPDATE", "UPDATE", "INSERT"]); // mais recente primeiro
    const insert = h.find((x) => x.action === "INSERT");
    expect(insert.changes.valor).toBe(150);
    expect(insert.usuario).toBe("Dra. Ana Lima");
    const mudouValor = h.find((x) => x.changes.valor);
    expect(mudouValor.changes.valor).toEqual({ de: 150, para: 180 });
    expect(mudouValor.usuario).toBe("Rita Recepção");
    expect(Object.keys(h.find((x) => x.changes.starts_at).changes).sort()).toEqual(["ends_at", "starts_at"]);
  });

  it("o desconto da cobrança e o pro bono ficam registrados", async () => {
    const s = await cenario();
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, competencia: "2030-03", valor_centavos: 20000 } })).json;
    await call("PATCH", `/charges/${ch.id}`, { token: s.rec.token, body: { desconto_centavos: 5000 } });
    const h = await historico(s, "charges", ch.id);
    expect(h.find((x) => x.changes.desconto_centavos).changes.desconto_centavos).toEqual({ de: 0, para: 5000 });
    const pro = await sessao(s, 0, { atendimento: "pro_bono" });
    expect((await historico(s, "appointments", pro.id)).find((x) => x.action === "INSERT").changes.atendimento).toBe("pro_bono");
  });

  it("pagamentos mudam a cobrança e isso também fica no histórico", async () => {
    const s = await cenario();
    const ch = (await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, competencia: "2030-03", valor_centavos: 20000 } })).json;
    await call("POST", `/charges/${ch.id}/payments`, { token: s.rec.token, headers: { "Idempotency-Key": uniq("idem-key-") }, body: { valor_centavos: 20000, metodo: "pix" } });
    const h = await historico(s, "charges", ch.id);
    const pago = h.find((x) => x.changes.status);
    expect(pago.changes.status).toEqual({ de: "aberta", para: "paga" });
    expect(pago.usuario).toBe("Rita Recepção");
  });

  it("dados pessoais aparecem como 'alterado', sem o conteúdo", async () => {
    const s = await cenario();
    await call("PATCH", `/patients/${s.pac.id}`, { token: s.psiA.token, body: { cpf: "111.444.777-35", telefone: "11999990000" } });
    const h = await historico(s, "patients", s.pac.id);
    const up = h.find((x) => x.action === "UPDATE");
    expect(up.changes.cpf).toEqual({ alterado: true });
    expect(up.changes.telefone).toEqual({ alterado: true });
    expect(JSON.stringify(h)).not.toContain("11144477735");
    expect(JSON.stringify(h)).not.toContain("52998224725");
    const ins = h.find((x) => x.action === "INSERT");
    expect(ins.changes.nome).toBe("[omitido]");
  });

  it("só a administração lê o histórico", async () => {
    const s = await cenario();
    const ap = await sessao(s, 0, { valor: 100 });
    for (const t of [s.psiA.token, s.psiB.token, s.rec.token]) {
      expect((await call("GET", `/audit/changes?table=appointments&row_id=${ap.id}`, { token: t })).status).toBe(403);
    }
    expect((await call("GET", `/audit/changes?table=appointments&row_id=${ap.id}`, { token: s.adminToken })).status).toBe(200);
  });

  it("o histórico é imutável: nem pelo aplicativo, nem pelo banco", async () => {
    const s = await cenario();
    const ap = await sessao(s, 0, { valor: 100 });
    await expect(ownerPool.query("UPDATE change_log SET changes = '{}' WHERE row_id = $1", [ap.id])).rejects.toMatchObject({ code: "23514" });
    await expect(ownerPool.query("DELETE FROM change_log WHERE row_id = $1", [ap.id])).rejects.toMatchObject({ code: "23514" });
    await expect(ownerPool.query("TRUNCATE change_log")).rejects.toMatchObject({ code: "23514" });
    const { withSession } = await import("../src/db");
    const sessaoAdmin = { userId: s.adminId, clinicId: s.clinicId, role: "admin" as const, atende: false };
    await expect(withSession(appPool as any, sessaoAdmin, (db) => db.query("DELETE FROM change_log"))).rejects.toMatchObject({ code: "42501" });
    await expect(withSession(appPool as any, sessaoAdmin, (db) => db.query("INSERT INTO change_log (clinic_id, table_name, row_id, action, changes) VALUES ($1, 'x', $2, 'INSERT', '{}')", [s.clinicId, ap.id]))).rejects.toMatchObject({ code: "42501" });
    expect((await historico(s, "appointments", ap.id)).length).toBeGreaterThan(0);
  });
});
