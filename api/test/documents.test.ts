import { afterAll, describe, expect, it } from "vitest";
import { canonicalize } from "../../shared/documents";
import { sha256Hex } from "../src/security";
import { appPool, call, mkClinic, mkUser, ownerPool } from "./helpers";
import { withSession } from "../src/db";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const psiB = await mkUser(c.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const adminAtende = await mkUser(c.adminToken, { nome: "Admin Atende", role: "admin", crp: "06/777", atende: true });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Maria Souza", data_nascimento: "1990-05-10" } })).json;
  return { ...c, psiA, psiB, rec, adminAtende, pac };
}

const declaracao = (s: Awaited<ReturnType<typeof cenario>>, extra: Record<string, unknown> = {}) =>
  call("POST", "/documents", {
    token: s.psiA.token,
    body: { patient_id: s.pac.id, tipo: "declaracao", finalidade: "Comprovar comparecimento", conteudo: { registro: "Compareceu em 04/03/2030." }, ...extra },
  });

describe("papel timbrado", () => {
  it("admin cria e edita; os demais só leem; só um padrão por clínica", async () => {
    const s = await cenario();
    const base = { nome: "Papel da clínica", modo: "padrao", linhas: ["Clínica Exemplo", "CNPJ 00.000.000/0001-00"], logo_data_url: PNG };
    expect((await call("POST", "/letterheads", { token: s.psiA.token, body: base })).status).toBe(403);
    const a = await call("POST", "/letterheads", { token: s.adminToken, body: { ...base, is_default: true } });
    expect(a.status).toBe(201);
    const b = await call("POST", "/letterheads", { token: s.adminToken, body: { nome: "Impresso", modo: "impresso", margem_top_mm: 45, is_default: true } });
    expect(b.json.margem_top_mm).toBe(45);
    const lista = (await call("GET", "/letterheads", { token: s.psiA.token })).json;
    expect(lista.filter((x: any) => x.is_default)).toHaveLength(1);
    expect(lista.find((x: any) => x.is_default).id).toBe(b.json.id);
    expect((await call("PATCH", `/letterheads/${a.json.id}`, { token: s.psiA.token, body: { nome: "X Y" } })).status).toBe(403);
    // desativar esconde de quem não é admin
    await call("PATCH", `/letterheads/${a.json.id}`, { token: s.adminToken, body: { ativo: false } });
    expect((await call("GET", "/letterheads", { token: s.psiA.token })).json).toHaveLength(1);
    expect((await call("GET", "/letterheads", { token: s.adminToken })).json).toHaveLength(2);
  });

  it("recusa SVG, imagem inválida e modo com imagem sem a imagem", async () => {
    const s = await cenario();
    const post = (body: Record<string, unknown>) => call("POST", "/letterheads", { token: s.adminToken, body: { nome: "Teste", ...body } });
    expect((await post({ modo: "padrao", logo_data_url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).status).toBe(400);
    expect((await post({ modo: "padrao", logo_data_url: "http://evil.test/x.png" })).status).toBe(400);
    expect((await post({ modo: "imagem" })).status).toBe(422);
    expect((await post({ modo: "imagem", fundo_data_url: PNG })).status).toBe(201);
    expect((await post({ modo: "padrao", margem_left_mm: 2 })).status).toBe(400);
  });
});

describe("documentos", () => {
  it("só psicólogo (ou admin que atende) produz documentos; autor e admin-atende enxergam", async () => {
    const s = await cenario();
    for (const t of [s.rec.token, s.adminToken]) {
      expect((await call("GET", "/documents", { token: t })).status).toBe(403);
      expect((await call("POST", "/documents", { token: t, body: { patient_id: s.pac.id, tipo: "declaracao" } })).status).toBe(403);
    }
    const d = await declaracao(s);
    expect(d.status).toBe(201);
    expect(d.json.status).toBe("rascunho");
    expect(d.json.titulo).toBe("Declaração");
    expect(d.json.identificacao).toMatchObject({ paciente_nome: "Maria Souza", psicologo_crp: "06/12345", clinica_nome: "Clínica Teste" });
    expect((await call("GET", `/documents/${d.json.id}`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("GET", "/documents", { token: s.psiB.token })).json).toHaveLength(0);
    expect((await call("GET", `/documents/${d.json.id}`, { token: s.adminAtende.token })).status).toBe(200);
    expect((await call("PATCH", `/documents/${d.json.id}`, { token: s.adminAtende.token, body: { titulo: "Outro título" } })).status).toBe(404);
  });

  it("psicólogo não cria documento de paciente de outro psicólogo", async () => {
    const s = await cenario();
    const r = await call("POST", "/documents", { token: s.psiB.token, body: { patient_id: s.pac.id, tipo: "declaracao" } });
    expect(r.status).toBe(404);
  });

  it("ignora seções que não existem no tipo e edita o rascunho", async () => {
    const s = await cenario();
    const d = await declaracao(s, { conteudo: { registro: "Texto", invasora: "descartar" } });
    expect(Object.keys(d.json.conteudo)).toEqual(["registro"]);
    const up = await call("PATCH", `/documents/${d.json.id}`, { token: s.psiA.token, body: { local: "Cajamar/SP", conteudo: { registro: "Novo texto" } } });
    expect(up.json).toMatchObject({ local: "Cajamar/SP", conteudo: { registro: "Novo texto" } });
  });

  it("não emite incompleto; ao emitir numera, gera código e hash recalculável", async () => {
    const s = await cenario();
    const vazio = await call("POST", "/documents", { token: s.psiA.token, body: { patient_id: s.pac.id, tipo: "relatorio" } });
    const falta = await call("POST", `/documents/${vazio.json.id}/emit`, { token: s.psiA.token, body: {} });
    expect(falta.status).toBe(422);
    expect(falta.json.error).toMatch(/Finalidade.*Solicitante.*Descrição da demanda.*Procedimento.*Análise.*Conclusão/);

    const d = await declaracao(s, { local: "Cajamar/SP" });
    const e = await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} });
    expect(e.status).toBe(200);
    expect(e.json.status).toBe("emitido");
    expect(e.json.numero).toMatch(/^\d{4}\/0001$/);
    expect(e.json.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const esperado = await sha256Hex(
      canonicalize({
        tipo: e.json.tipo, titulo: e.json.titulo, numero: e.json.numero, data_documento: e.json.data_documento, local: e.json.local,
        solicitante: e.json.solicitante, finalidade: e.json.finalidade, conteudo: e.json.conteudo, identificacao: e.json.identificacao,
      }),
    );
    expect(e.json.content_hash).toBe(esperado);
    expect((await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} })).status).toBe(409);
  });

  it("documento emitido é imutável e não pode ser excluído, nem pela via direta do banco", async () => {
    const s = await cenario();
    const d = await declaracao(s);
    await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} });
    expect((await call("PATCH", `/documents/${d.json.id}`, { token: s.psiA.token, body: { conteudo: { registro: "Adulterado" } } })).status).toBe(409);
    expect((await call("DELETE", `/documents/${d.json.id}`, { token: s.psiA.token })).status).toBe(409);
    const sessao = { userId: s.psiA.id, clinicId: s.clinicId, role: "psicologo" as const, atende: true };
    await expect(
      withSession(appPool as any, sessao, (db) => db.query("UPDATE documents SET conteudo = '{}'::jsonb WHERE id = $1", [d.json.id])),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      withSession(appPool as any, sessao, (db) => db.query("DELETE FROM documents WHERE id = $1", [d.json.id])),
    ).resolves.toMatchObject({ rowCount: 0 }); // a policy só deixa apagar rascunho
    const owner = await ownerPool.query("SELECT conteudo FROM documents WHERE id = $1", [d.json.id]);
    expect(owner.rows[0].conteudo.registro).toBe("Compareceu em 04/03/2030.");
  });

  it("rascunho pode ser excluído", async () => {
    const s = await cenario();
    const d = await declaracao(s);
    expect((await call("DELETE", `/documents/${d.json.id}`, { token: s.psiA.token })).status).toBe(204);
    expect((await call("GET", `/documents/${d.json.id}`, { token: s.psiA.token })).status).toBe(404);
  });

  it("numeração sequencial por clínica, sem repetir sob concorrência", async () => {
    const s = await cenario();
    const outra = await cenario();
    const ids = await Promise.all(Array.from({ length: 6 }, async () => (await declaracao(s)).json.id as string));
    const emitidos = await Promise.all(ids.map((id) => call("POST", `/documents/${id}/emit`, { token: s.psiA.token, body: {} })));
    const numeros = emitidos.map((r) => r.json.numero as string).sort();
    expect(emitidos.every((r) => r.status === 200)).toBe(true);
    expect(new Set(numeros).size).toBe(6);
    expect(numeros.map((n) => Number(n.split("/")[1]))).toEqual([1, 2, 3, 4, 5, 6]);
    const primeiro = await call("POST", "/documents", { token: outra.psiA.token, body: { patient_id: outra.pac.id, tipo: "declaracao", finalidade: "x", conteudo: { registro: "y" } } });
    const e = await call("POST", `/documents/${primeiro.json.id}/emit`, { token: outra.psiA.token, body: {} });
    expect(e.json.numero).toMatch(/\/0001$/);
  });

  it("congela o papel timbrado na emissão", async () => {
    const s = await cenario();
    const lh = (await call("POST", "/letterheads", { token: s.adminToken, body: { nome: "Padrão", modo: "padrao", linhas: ["Linha original"], is_default: true } })).json;
    const d1 = await declaracao(s);
    const e1 = (await call("POST", `/documents/${d1.json.id}/emit`, { token: s.psiA.token, body: {} })).json;
    expect(e1.letterhead.linhas).toEqual(["Linha original"]); // usou o padrão da clínica
    await call("PATCH", `/letterheads/${lh.id}`, { token: s.adminToken, body: { linhas: ["Linha alterada"] } });
    expect((await call("GET", `/documents/${e1.id}`, { token: s.psiA.token })).json.letterhead.linhas).toEqual(["Linha original"]);

    const d2 = await declaracao(s);
    const e2 = (await call("POST", `/documents/${d2.json.id}/emit`, { token: s.psiA.token, body: { letterhead_id: null } })).json;
    expect(e2.letterhead).toBeNull(); // emitido sem papel timbrado
    const d3 = await declaracao(s);
    expect((await call("POST", `/documents/${d3.json.id}/emit`, { token: s.psiA.token, body: { letterhead_id: crypto.randomUUID() } })).status).toBe(404);
  });

  it("anulação exige motivo, é só do autor e preserva o registro", async () => {
    const s = await cenario();
    const d = await declaracao(s);
    expect((await call("POST", `/documents/${d.json.id}/annul`, { token: s.psiA.token, body: { motivo: "Erro de digitação" } })).status).toBe(409); // rascunho
    await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} });
    expect((await call("POST", `/documents/${d.json.id}/annul`, { token: s.psiA.token, body: { motivo: "x" } })).status).toBe(400);
    expect((await call("POST", `/documents/${d.json.id}/annul`, { token: s.adminAtende.token, body: { motivo: "Não sou o autor" } })).status).toBe(404);
    const a = await call("POST", `/documents/${d.json.id}/annul`, { token: s.psiA.token, body: { motivo: "Dados do paciente incorretos" } });
    expect(a.json).toMatchObject({ status: "anulado", annul_reason: "Dados do paciente incorretos" });
    expect((await call("POST", `/documents/${d.json.id}/annul`, { token: s.psiA.token, body: { motivo: "Outra vez, sem efeito" } })).status).toBe(409);
    expect((await call("PATCH", `/documents/${d.json.id}`, { token: s.psiA.token, body: { titulo: "Mudou" } })).status).toBe(409);
  });

  it("verificação pública confirma o documento sem expor a pessoa atendida", async () => {
    const s = await cenario();
    const d = await declaracao(s);
    expect((await call("GET", `/verify/ABCDEFGHJKMN`)).status).toBe(404);
    const e = (await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} })).json;
    const v = await call("GET", `/verify/${e.codigo.slice(0, 4)}-${e.codigo.slice(4, 8)}-${e.codigo.slice(8)}`);
    expect(v.status).toBe(200);
    expect(v.json).toMatchObject({ numero: e.numero, status: "emitido", psicologo_nome: "Dra. Ana Lima", psicologo_crp: "06/12345", content_hash: e.content_hash });
    expect(JSON.stringify(v.json)).not.toMatch(/Maria|Souza|1990/);
    await call("POST", `/documents/${d.json.id}/annul`, { token: s.psiA.token, body: { motivo: "Emitido por engano" } });
    expect((await call("GET", `/verify/${e.codigo}`)).json.status).toBe("anulado");
    // rascunho nunca é verificável
    const r = await declaracao(s);
    expect((await call("GET", `/verify/${r.json.codigo ?? "ZZZZZZZZZZZZ"}`)).status).toBe(404);
  });

  it("emissão e consulta ficam no log de auditoria", async () => {
    const s = await cenario();
    const d = await declaracao(s);
    await call("POST", `/documents/${d.json.id}/emit`, { token: s.psiA.token, body: {} });
    await call("GET", `/documents/${d.json.id}`, { token: s.psiA.token });
    const r = await ownerPool.query("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY at", [d.json.id]);
    expect(r.rows.map((x) => x.action)).toEqual(["document.create", "document.emit", "document.view"]);
  });
});
