import { afterAll, describe, expect, it } from "vitest";
import { receitaSaudeLine } from "../src/routes/finance";
import { appPool, call, mkClinic, mkUser, ownerPool, uniq } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const CPF_PSI = "11144477735";
const CPF_PAC = "52998224725";
const CPF_RESP = "39053344705";
const ANO = new Date().getFullYear() - 1; // pagamentos não podem ser futuros
const MES = `${ANO}-03`;

async function cenario() {
  const c = await mkClinic();
  const psi = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psi.token, body: { nome: "Maria Souza", cpf: CPF_PAC } })).json;
  return { ...c, psi, psiB, rec, pac };
}
type S = Awaited<ReturnType<typeof cenario>>;

const cobrar = async (s: S, extra: Record<string, unknown> = {}) =>
  (await call("POST", "/charges", { token: s.psi.token, body: { patient_id: s.pac.id, competencia: `${MES}-01`, valor_centavos: 25000, ...extra } })).json;
const pagar = (s: S, chargeId: string, dia: string, extra: Record<string, unknown> = {}) =>
  call("POST", `/charges/${chargeId}/payments`, { token: s.rec.token, headers: { "Idempotency-Key": uniq("idem-key-") }, body: { valor_centavos: 25000, metodo: "pix", pago_em: `${MES}-${dia}`, ...extra } });
const exportar = (token: string, query = `month=${MES}`) => call("GET", `/finance/receita-saude?${query}`, { token });

describe("linha do arquivo", () => {
  it("segue o layout do manual: 16 colunas, data DD/MM/AAAA, valor com vírgula, S no indicador de recibo", () => {
    const linha = receitaSaudeLine({ data: "2025-07-31", valor_centavos: 25000, descricao: "Sessão de psicologia realizada em 31/07/25", cpf_pagador: "12345678900", cpf_beneficiario: "12345678900", cpf_profissional: "98765432100", registro: "06/12345" });
    expect(linha).toBe("31/07/2025;R01.001.001;255;250,00;;Sessão de psicologia realizada em 31/07/25;PF;12345678900;12345678900;;;;;S;98765432100;06/12345");
    expect(linha.split(";")).toHaveLength(16);
  });
});

describe("exportação para o Receita Saúde", () => {
  it("gera uma linha por pagamento do próprio psicólogo, com CPFs e CRP", async () => {
    const s = await cenario();
    await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: "111.444.777-35" } });
    const ch = await cobrar(s);
    expect((await pagar(s, ch.id, "05")).status).toBe(201);

    const r = await exportar(s.psi.token);
    expect(r.status).toBe(200);
    expect(r.json.resumo).toMatchObject({ pagamentos: 1, prontos: 1, com_pendencia: 0, total_centavos: 25000 });
    expect(r.json.arquivos).toHaveLength(1);
    expect(r.json.arquivos[0].csv).toBe(`05/03/${ANO};R01.001.001;255;250,00;;Atendimento psicológico;PF;${CPF_PAC};${CPF_PAC};;;;;S;${CPF_PSI};06/12345\r\n`);
  });

  it("usa o CPF do responsável financeiro como pagador e o do paciente como beneficiário", async () => {
    const s = await cenario();
    await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: CPF_PSI } });
    const payer = (await call("POST", "/payers", { token: s.psi.token, body: { nome: "Carlos Souza", cpf_cnpj: CPF_RESP } })).json;
    const ch = await cobrar(s, { payer_id: payer.id });
    await pagar(s, ch.id, "10");
    const csv = (await exportar(s.psi.token)).json.arquivos[0].csv as string;
    expect(csv).toContain(`;PF;${CPF_RESP};${CPF_PAC};`);
  });

  it("aponta pendências em vez de gerar linha incompleta: sem CPF do psicólogo, do paciente ou pagador PJ", async () => {
    const s = await cenario();
    const ch = await cobrar(s);
    await pagar(s, ch.id, "05");

    const semCpfPsi = await exportar(s.psi.token);
    expect(semCpfPsi.json.avisos[0]).toMatch(/Pendente de CPF do psicólogo/);
    expect(semCpfPsi.json.arquivos).toHaveLength(0);

    await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: CPF_PSI } });
    const pacSemCpf = (await call("POST", "/patients", { token: s.psi.token, body: { nome: "Paciente Sem CPF" } })).json;
    const ch2 = (await call("POST", "/charges", { token: s.psi.token, body: { patient_id: pacSemCpf.id, competencia: `${MES}-01`, valor_centavos: 10000 } })).json;
    await pagar(s, ch2.id, "06", { valor_centavos: 10000 });
    const pj = (await call("POST", "/payers", { token: s.psi.token, body: { nome: "Empresa Ltda", cpf_cnpj: "11222333000181" } })).json;
    const ch3 = await cobrar(s, { payer_id: pj.id });
    await pagar(s, ch3.id, "07");

    const r = await exportar(s.psi.token);
    expect(r.json.resumo).toMatchObject({ pagamentos: 3, prontos: 1, com_pendencia: 2 });
    const problemas = r.json.linhas.flatMap((l: { problemas: string[] }) => l.problemas).join(" | ");
    expect(problemas).toMatch(/Pendente de CPF/);
    expect(problemas).toMatch(/pessoa jurídica/);
  });

  it("deixa de fora estornos, pagamentos recebidos pela clínica, convênio e outros meses", async () => {
    const s = await cenario();
    await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: CPF_PSI } });
    const estornada = await cobrar(s);
    const p = (await pagar(s, estornada.id, "05")).json.payment;
    await call("POST", `/payments/${p.id}/reverse`, { token: s.adminToken, body: { motivo: "Valor lançado errado" } });
    await pagar(s, (await cobrar(s)).id, "06", { recebido_por: "clinica" });
    await pagar(s, (await cobrar(s)).id, "07", { metodo: "convenio" });
    await pagar(s, (await cobrar(s)).id, "08", { pago_em: `${ANO}-04-02` });
    const boa = await cobrar(s);
    await pagar(s, boa.id, "09");

    const r = await exportar(s.psi.token);
    expect(r.json.resumo.pagamentos).toBe(1);
    expect(r.json.linhas[0].data).toBe(`${MES}-09`);
  });

  it("administração escolhe o psicólogo; recepção é barrada; um psicólogo não vê o de outro", async () => {
    const s = await cenario();
    await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: CPF_PSI } });
    await pagar(s, (await cobrar(s)).id, "05");

    expect((await exportar(s.adminToken)).status).toBe(400); // admin precisa escolher o psicólogo
    const adm = await exportar(s.adminToken, `month=${MES}&professional_id=${s.psi.id}`);
    expect(adm.status).toBe(200);
    expect(adm.json.resumo.prontos).toBe(1);
    expect((await exportar(s.rec.token)).status).toBe(403);
    expect((await exportar(s.psiB.token)).json.resumo.pagamentos).toBe(0);
    expect((await exportar(s.psi.token, "month=2030-13")).status).toBe(400);
    expect((await call("GET", "/finance/receita-saude?month=" + MES)).status).toBe(401);
  });

  it("registra a exportação na auditoria", async () => {
    const s = await cenario();
    await exportar(s.psi.token);
    const n = await ownerPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'finance.receita_saude'", [s.clinicId]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe("CPF do usuário", () => {
  it("o admin grava e limpa; CPF inválido é recusado; psicólogo não altera o próprio", async () => {
    const s = await cenario();
    const ok = await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: "111.444.777-35" } });
    expect(ok.json.cpf).toBe(CPF_PSI);
    expect((await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: "11144477734" } })).status).toBe(400);
    expect((await call("PATCH", `/users/${s.psi.id}`, { token: s.adminToken, body: { cpf: null } })).json.cpf).toBeNull();
    expect((await call("PATCH", `/users/${s.psi.id}`, { token: s.psi.token, body: { cpf: CPF_PSI } })).status).toBe(403);
  });
});
