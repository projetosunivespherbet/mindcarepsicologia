import { afterAll, describe, expect, it } from "vitest";
import { appPool, call, mkClinic, mkUser, ownerPool, uniq } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const CNPJ = "11222333000181";
const CPF = "52998224725";
const chave = (d = "1") => d.repeat(50);

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Maria Souza", cpf: "529.982.247-25" } })).json;
  return { ...c, psiA, psiB, rec, pac };
}
type S = Awaited<ReturnType<typeof cenario>>;

const emissor = async (s: S, extra: Record<string, unknown> = {}, token = s.psiA.token) =>
  (await call("POST", "/fiscal/issuers", { token, body: { cnpj: "11.222.333/0001-81", razao_social: "Ana Lima Psicologia Ltda", municipio_ibge: "3516408", ...extra } })).json;

const cobranca = async (s: S, extra: Record<string, unknown> = {}, token = s.psiA.token, patient = s.pac) =>
  (await call("POST", "/charges", { token, body: { patient_id: patient.id, competencia: "2030-03", valor_centavos: 20000, ...extra } })).json;

const rascunho = (s: S, issuerId: string, chargeIds: string[], token = s.rec.token) =>
  call("POST", "/nfse", { token, body: { issuer_id: issuerId, charge_ids: chargeIds } });

const xmlNfse = (o: { cnpj?: string; vServ?: string; cpf?: string; chave?: string; n?: string } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${o.chave ?? chave()}"><nNFSe>${o.n ?? "10"}</nNFSe><emit><CNPJ>${o.cnpj ?? CNPJ}</CNPJ></emit><valores><vLiq>${o.vServ ?? "200.00"}</vLiq></valores><DPS><infDPS><toma><CPF>${o.cpf ?? CPF}</CPF></toma><valores><vServPrest><vServ>${o.vServ ?? "200.00"}</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;

/** Emissor pronto, cobrança e rascunho da psicóloga A. */
async function prontos(s: S) {
  const iss = await emissor(s, { emissor_nacional_ok: true });
  const ch = await cobranca(s);
  const doc = (await rascunho(s, iss.id, [ch.id])).json;
  return { iss, ch, doc };
}

describe("CPF do paciente", () => {
  it("valida e guarda só os dígitos", async () => {
    const s = await cenario();
    expect(s.pac.cpf).toBe(CPF);
    expect((await call("PATCH", `/patients/${s.pac.id}`, { token: s.psiA.token, body: { cpf: "111.111.111-11" } })).status).toBe(400);
    const limpo = await call("PATCH", `/patients/${s.pac.id}`, { token: s.psiA.token, body: { cpf: null } });
    expect(limpo.json.cpf).toBeNull();
  });
});

describe("emissor fiscal", () => {
  it("o psicólogo cadastra o próprio emissor; CNPJ é validado e normalizado", async () => {
    const s = await cenario();
    expect((await emissor(s, { cnpj: "11.222.333/0001-80" })).error).toBeDefined();
    const iss = await call("POST", "/fiscal/issuers", { token: s.psiA.token, body: { cnpj: "11.222.333/0001-81", razao_social: "Ana Lima Psicologia Ltda", municipio_ibge: "3516408" } });
    expect(iss.status).toBe(201);
    expect(iss.json).toMatchObject({ tipo: "profissional", professional_id: s.psiA.id, cnpj: CNPJ, regime: "simples", serie: "1", modo: "assistida", emissor_nacional_ok: false, habilitado_em: null });
    expect((await call("POST", "/fiscal/issuers", { token: s.rec.token, body: { cnpj: CNPJ, razao_social: "X Ltda", municipio_ibge: "3516408" } })).status).toBe(403);
    expect((await call("POST", "/fiscal/issuers", { token: s.psiB.token, body: { cnpj: CNPJ, razao_social: "Outra Ltda", municipio_ibge: "3516408" } })).status).toBe(409); // CNPJ ativo repetido
    expect((await call("POST", "/fiscal/issuers", { token: s.psiB.token, body: { cnpj: "12ABC34501DE35", razao_social: "Bruno Psicologia", municipio_ibge: "3516408" } })).status).toBe(201); // CNPJ alfanumérico
    expect((await call("POST", "/fiscal/issuers", { token: s.psiA.token, body: { cnpj: "12ABC34501DE35", razao_social: "X", municipio_ibge: "123" } })).status).toBe(400);
  });

  it("visibilidade: recepção e admin leem; outro psicólogo não vê nem edita", async () => {
    const s = await cenario();
    const iss = await emissor(s);
    const ids = async (t: string) => (await call("GET", "/fiscal/issuers", { token: t })).json.map((x: any) => x.id);
    expect(await ids(s.psiA.token)).toEqual([iss.id]);
    expect(await ids(s.rec.token)).toEqual([iss.id]);
    expect(await ids(s.adminToken)).toEqual([iss.id]);
    expect(await ids(s.psiB.token)).toEqual([]);
    expect((await call("PATCH", `/fiscal/issuers/${iss.id}`, { token: s.psiB.token, body: { regime: "mei" } })).status).toBe(404);
    expect((await call("PATCH", `/fiscal/issuers/${iss.id}`, { token: s.rec.token, body: { regime: "mei" } })).status).toBe(403);
    expect((await call("PATCH", `/fiscal/issuers/${iss.id}`, { token: s.adminToken, body: { regime: "mei" } })).status).toBe(404); // admin não edita o emissor de outro profissional
  });

  it("readiness: confirmar o acesso ao Emissor Nacional deixa o emissor pronto", async () => {
    const s = await cenario();
    const iss = await emissor(s);
    const antes = (await call("GET", `/fiscal/issuers/${iss.id}/readiness`, { token: s.psiA.token })).json;
    expect(antes.pronto).toBe(false);
    expect(antes.itens.find((i: any) => i.chave === "emissor_nacional").ok).toBe(false);
    expect(antes.itens.find((i: any) => i.chave === "codigo_tributacao").obrigatorio).toBe(false);
    const up = await call("PATCH", `/fiscal/issuers/${iss.id}`, { token: s.psiA.token, body: { emissor_nacional_ok: true, codigo_tributacao_padrao: "041601" } });
    expect(up.json.emissor_nacional_ok).toBe(true);
    expect(up.json.habilitado_em).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await call("GET", `/fiscal/issuers/${iss.id}/readiness`, { token: s.rec.token })).json.pronto).toBe(true);
    const desfeito = await call("PATCH", `/fiscal/issuers/${iss.id}`, { token: s.psiA.token, body: { emissor_nacional_ok: false } });
    expect(desfeito.json.habilitado_em).toBeNull();
  });
});

describe("rascunho de NFS-e", () => {
  it("monta tomador, serviço e valor a partir da cobrança; descrição é fixa", async () => {
    const s = await cenario();
    const { iss, ch, doc } = await prontos(s);
    expect(doc).toMatchObject({ status: "rascunho", origem: "nacional", valor_centavos: 20000, competencia: "2030-03-01", issuer_id: iss.id, charge_ids: [ch.id], pronta: true, pendencias: [] });
    expect(doc.tomador).toMatchObject({ nome: "Maria Souza", cpf_cnpj: CPF, origem: "paciente" });
    expect(doc.servico).toMatchObject({ descricao: "Serviços de psicologia", municipio_ibge: "3516408", codigo_tributacao: null });
    expect(JSON.stringify(doc)).not.toMatch(/ansiedade|queixa|diagn/i);
  });

  it("usa o responsável financeiro como tomador e aponta pendências", async () => {
    const s = await cenario();
    const iss = await emissor(s); // sem confirmar o acesso ao Emissor Nacional
    const resp = (await call("POST", "/payers", { token: s.rec.token, body: { nome: "João Souza", vinculo: "pai" } })).json; // sem CPF
    // responsável criado pela recepção: quem vincula é a recepção (o psicólogo só vê os que cadastrou ou já usa)
    const ch = (await call("POST", "/charges", { token: s.rec.token, body: { patient_id: s.pac.id, professional_id: s.psiA.id, payer_id: resp.id, competencia: "2030-03", valor_centavos: 20000 } })).json;
    const doc = (await rascunho(s, iss.id, [ch.id])).json;
    expect(doc.tomador).toMatchObject({ nome: "João Souza", cpf_cnpj: null, origem: "responsavel" });
    expect(doc.pronta).toBe(false);
    expect(doc.pendencias).toEqual(["Informe o CPF ou CNPJ do tomador", "Confirme o acesso do emissor ao Emissor Nacional"]);
    const fix = await call("PATCH", `/nfse/${doc.id}`, { token: s.rec.token, body: { tomador: { cpf_cnpj: "529.982.247-25" } } });
    expect(fix.json.tomador.cpf_cnpj).toBe(CPF);
    expect(fix.json.pendencias).toEqual(["Confirme o acesso do emissor ao Emissor Nacional"]);
    expect((await call("PATCH", `/nfse/${doc.id}`, { token: s.rec.token, body: { tomador: { cpf_cnpj: "123" } } })).status).toBe(400);
  });

  it("recusa cobrança de outro profissional, cancelada, repetida e de competências diferentes", async () => {
    const s = await cenario();
    const iss = await emissor(s, { emissor_nacional_ok: true });
    const outroPac = (await call("POST", "/patients", { token: s.psiB.token, body: { nome: "Paciente do Bruno" } })).json;
    const doBruno = await cobranca(s, {}, s.psiB.token, outroPac);
    expect((await rascunho(s, iss.id, [doBruno.id], s.adminToken)).status).toBe(422);

    const cancelada = await cobranca(s);
    await call("POST", `/charges/${cancelada.id}/cancel`, { token: s.psiA.token, body: { motivo: "Lançada por engano" } });
    expect((await rascunho(s, iss.id, [cancelada.id])).status).toBe(422);

    const a = await cobranca(s);
    const b = await cobranca(s, { competencia: "2030-04" });
    expect((await rascunho(s, iss.id, [a.id, b.id])).status).toBe(422);
    const ok = await rascunho(s, iss.id, [a.id]);
    expect(ok.status).toBe(201);
    expect((await rascunho(s, iss.id, [a.id])).status).toBe(409); // já tem nota ativa
    expect((await rascunho(s, iss.id, [uniq("x") && "00000000-0000-4000-8000-000000000000"])).status).toBe(404);
  });

  it("descartar o rascunho libera a cobrança; psicólogo só vê as próprias notas", async () => {
    const s = await cenario();
    const { iss, ch, doc } = await prontos(s);
    const lista = async (t: string) => (await call("GET", "/nfse", { token: t })).json.map((x: any) => x.id);
    expect(await lista(s.psiA.token)).toEqual([doc.id]);
    expect(await lista(s.rec.token)).toEqual([doc.id]);
    expect(await lista(s.psiB.token)).toEqual([]);
    expect((await call("GET", `/nfse/${doc.id}`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("DELETE", `/nfse/${doc.id}`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("DELETE", `/nfse/${doc.id}`, { token: s.rec.token })).status).toBe(200);
    expect((await rascunho(s, iss.id, [ch.id])).status).toBe(201);
  });

  it("dps-pack traz os dados e os passos para emitir no portal", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    const pack = (await call("GET", `/nfse/${doc.id}/dps-pack`, { token: s.rec.token })).json;
    expect(pack.emissor).toMatchObject({ cnpj: CNPJ, razao_social: "Ana Lima Psicologia Ltda", municipio_ibge: "3516408" });
    expect(pack.tomador.cpf_cnpj).toBe(CPF);
    expect(pack.valor_centavos).toBe(20000);
    expect(pack.servico.sugestao).toMatch(/4\.16/);
    expect(pack.passos).toHaveLength(4);
  });
});

describe("registro da nota emitida", () => {
  it("só o profissional emissor registra; confere a chave de 50 dígitos", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    const reg = (t: string, body: Record<string, unknown>) => call("POST", `/nfse/${doc.id}/register`, { token: t, body });
    expect((await reg(s.rec.token, { chave_acesso: chave(), numero_nfse: "1" })).status).toBe(403);
    expect((await reg(s.adminToken, { chave_acesso: chave(), numero_nfse: "1" })).status).toBe(403); // admin não registra a nota de outro
    expect((await reg(s.psiB.token, { chave_acesso: chave(), numero_nfse: "1" })).status).toBe(404);
    expect((await reg(s.psiA.token, { numero_nfse: "1" })).status).toBe(400);
    expect((await reg(s.psiA.token, { chave_acesso: "123", numero_nfse: "1" })).status).toBe(400);
    expect((await reg(s.psiA.token, { chave_acesso: chave(), numero_nfse: "1", emitida_em: "2999-01-01T00:00:00Z" })).status).toBe(422);
    const ok = await reg(s.psiA.token, { chave_acesso: chave(), numero_nfse: "123" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: "emitida", chave_acesso: chave(), numero_nfse: "123", tem_xml: false, avisos: [] });
    expect(ok.json.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await reg(s.psiA.token, { chave_acesso: chave(), numero_nfse: "123" })).status).toBe(422); // já registrada
  });

  it("nota emitida é imutável: nem edita, nem descarta; o banco também recusa", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "9" } });
    expect((await call("PATCH", `/nfse/${doc.id}`, { token: s.rec.token, body: { data_emissao: "2030-03-05" } })).status).toBe(422);
    expect((await call("DELETE", `/nfse/${doc.id}`, { token: s.rec.token })).status).toBe(422);
    await expect(ownerPool.query("UPDATE fiscal_documents SET valor_centavos = 1 WHERE id = $1", [doc.id])).rejects.toMatchObject({ code: "23514" });
    await expect(ownerPool.query("DELETE FROM fiscal_documents WHERE id = $1", [doc.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("a mesma chave não vale para duas notas", async () => {
    const s = await cenario();
    const { iss, doc } = await prontos(s);
    await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "1" } });
    const ch2 = await cobranca(s);
    const doc2 = (await rascunho(s, iss.id, [ch2.id])).json;
    const dup = await call("POST", `/nfse/${doc2.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "2" } });
    expect(dup.status).toBe(409);
    expect((await call("POST", `/nfse/${doc2.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave("2"), numero_nfse: "2" } })).status).toBe(200);
  });

  it("confere o XML: aceita o que bate, recusa o que diverge e avisa o que não conseguiu ler", async () => {
    const s = await cenario();
    const { iss, doc } = await prontos(s);
    const reg = (id: string, body: Record<string, unknown>) => call("POST", `/nfse/${id}/register`, { token: s.psiA.token, body });
    const base = { chave_acesso: chave(), numero_nfse: "10" };

    const cnpjErrado = await reg(doc.id, { ...base, xml: xmlNfse({ cnpj: "99999999000191" }) });
    expect(cnpjErrado.status).toBe(422);
    expect(cnpjErrado.json.error).toMatch(/CNPJ do prestador/);
    expect((await reg(doc.id, { ...base, xml: xmlNfse({ vServ: "150.00" }) })).json.error).toMatch(/valor do serviço/);
    expect((await reg(doc.id, { ...base, xml: xmlNfse({ cpf: "11144477735" }) })).json.error).toMatch(/documento do tomador/);
    expect((await reg(doc.id, { ...base, xml: xmlNfse({ chave: chave("2") }) })).json.error).toMatch(/chave de acesso/);
    expect((await reg(doc.id, { ...base, xml: xmlNfse({ n: "99" }) })).json.error).toMatch(/número da nota/);
    expect((await reg(doc.id, { ...base, xml: "<NFSe><infNFSe>" })).json.error).toMatch(/XML é inválido/);
    expect((await call("GET", `/nfse/${doc.id}`, { token: s.psiA.token })).json.status).toBe("rascunho"); // nada foi gravado

    const ok = await reg(doc.id, { ...base, xml: xmlNfse() });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: "emitida", tem_xml: true, avisos: [] });

    const ch2 = await cobranca(s);
    const doc2 = (await rascunho(s, iss.id, [ch2.id])).json;
    const semCampos = await reg(doc2.id, { chave_acesso: chave("3"), numero_nfse: "11", xml: "<NFSe><outra>1</outra></NFSe>" });
    expect(semCampos.status).toBe(200);
    expect(semCampos.json.avisos).toHaveLength(5); // prestador, valor, tomador, número e chave: nada encontrado no XML
  });

  it("o número é comparado sem zeros à esquerda; um Id fora do padrão vira aviso, não erro", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    const r = await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "10", xml: xmlNfse({ n: "000010", chave: "ABC" }) } });
    expect(r.status).toBe(200);
    expect(r.json.avisos).toEqual(["Não foi possível ler a chave de acesso no XML"]);
  });

  it("baixa o XML guardado; quem não vê a nota não baixa", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    expect((await call("GET", `/nfse/${doc.id}/xml`, { token: s.psiA.token })).status).toBe(404); // ainda sem XML
    await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "7", xml: xmlNfse({ n: "7" }) } });
    expect((await call("GET", `/nfse/${doc.id}/xml`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("GET", `/nfse/${doc.id}/xml`, { token: s.rec.token })).status).toBe(200);
  });

  it("nota emitida no sistema da prefeitura entra sem chave e sem conferência", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    const r = await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { origem: "municipal", numero_nfse: "2030/15", xml: "<qualquer>1</qualquer>" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "emitida", origem: "municipal", chave_acesso: null, numero_nfse: "2030/15" });
    expect(r.json.avisos).toHaveLength(1);
  });
});

describe("cancelamento", () => {
  it("só nota emitida, só o emissor, com motivo; depois a cobrança pode receber nova nota", async () => {
    const s = await cenario();
    const { iss, ch, doc } = await prontos(s);
    const cancelar = (t: string, motivo = "Valor emitido errado") => call("POST", `/nfse/${doc.id}/cancel`, { token: t, body: { motivo } });
    expect((await cancelar(s.psiA.token)).status).toBe(422); // ainda é rascunho
    await call("POST", `/nfse/${doc.id}/register`, { token: s.psiA.token, body: { chave_acesso: chave(), numero_nfse: "1" } });
    expect((await cancelar(s.rec.token)).status).toBe(403);
    expect((await cancelar(s.adminToken)).status).toBe(403);
    expect((await cancelar(s.psiA.token, "x")).status).toBe(400);
    const ok = await cancelar(s.psiA.token);
    expect(ok.json).toMatchObject({ status: "cancelada", cancel_motivo: "Valor emitido errado" });
    expect((await cancelar(s.psiA.token)).status).toBe(422);
    await expect(ownerPool.query("UPDATE fiscal_documents SET data_emissao = '2030-01-01' WHERE id = $1", [doc.id])).rejects.toMatchObject({ code: "23514" });
    const nova = await rascunho(s, iss.id, [ch.id]);
    expect(nova.status).toBe(201);
    expect(nova.json.id).not.toBe(doc.id);
  });

  it("o banco só deixa o emissor registrar, mesmo se a API errar", async () => {
    const s = await cenario();
    const { doc } = await prontos(s);
    const outro = `UPDATE fiscal_documents SET status = 'emitida', numero_nfse = '1', emitida_em = now(), chave_acesso = '${chave()}' WHERE id = $1`;
    const { withSession } = await import("../src/db");
    await expect(withSession(appPool as any, { userId: s.adminId, clinicId: s.clinicId, role: "admin", atende: false }, (db) => db.query(outro, [doc.id]))).rejects.toMatchObject({ code: "42501" });
    await expect(withSession(appPool as any, { userId: s.rec.id, clinicId: s.clinicId, role: "recepcao", atende: false }, (db) => db.query(outro, [doc.id]))).rejects.toMatchObject({ code: "42501" });
  });
});
