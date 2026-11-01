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
  const janela = `from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(7, "00:00"))}`;
  const lista = async (token: string) => (await call("GET", `/appointments?${janela}`, { token })).json as { id: string; prontuario: boolean | null }[];
  return { c, psiA, psiB, rec, pac, sessao, lista };
}

describe("prontuário da sessão", () => {
  it("o psicólogo grava, relê e edita o registro; a agenda passa a marcar como preenchido", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");

    expect((await s.lista(s.psiA.token)).find((a) => a.id === id)?.prontuario).toBe(false);
    const vazio = await call("GET", `/appointments/${id}/record`, { token: s.psiA.token });
    expect(vazio.status).toBe(200);
    expect(vazio.json.conteudo).toBeNull();

    const salvo = await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo: "  Paciente relatou melhora do sono.  " } });
    expect(salvo.status).toBe(200);
    expect(salvo.json.conteudo).toBe("Paciente relatou melhora do sono.");
    expect((await s.lista(s.psiA.token)).find((a) => a.id === id)?.prontuario).toBe(true);

    const editado = await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo: "Texto revisado." } });
    expect(editado.status).toBe(200);
    expect((await call("GET", `/appointments/${id}/record`, { token: s.psiA.token })).json.conteudo).toBe("Texto revisado.");
    const n = await ownerPool.query("SELECT count(*)::int AS n FROM session_records WHERE appointment_id = $1", [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it("lista as sessões realizadas sem prontuário e atualiza quando o registro é salvo", async () => {
    const s = await cenario();
    const feita = await s.sessao(0, "realizado");
    await s.sessao(1); // agendada: não conta como pendente
    // as sessões de 2030 ainda estão no futuro: a lista cobre só o passado
    const pend = await call("GET", "/appointments/pending-records", { token: s.psiA.token });
    expect(pend.status).toBe(200);
    expect(pend.json).toHaveLength(0);

    // sessão passada: inserida direto pelo dono do banco para simular o histórico
    const passada = await ownerPool.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, status, valor, created_by)
       VALUES ($1, $2, $3, now() - interval '3 days', now() - interval '3 days' + interval '50 minutes', 'realizado', 200, $3) RETURNING id`,
      [s.c.clinicId, s.pac.id, s.psiA.id],
    );
    const idPassada = passada.rows[0].id as string;
    const antes = (await call("GET", "/appointments/pending-records", { token: s.psiA.token })).json as { id: string }[];
    expect(antes.map((a) => a.id)).toEqual([idPassada]);

    await call("PUT", `/appointments/${idPassada}/record`, { token: s.psiA.token, body: { conteudo: "Registro." } });
    expect((await call("GET", "/appointments/pending-records", { token: s.psiA.token })).json).toHaveLength(0);
    expect(feita).toBeTruthy();
  });

  it("recepção e administração sem atendimento não leem nem gravam, e não veem o indicador", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo: "Conteúdo clínico." } });

    for (const token of [s.rec.token, s.c.adminToken]) {
      expect((await call("GET", `/appointments/${id}/record`, { token })).status).toBe(403);
      expect((await call("PUT", `/appointments/${id}/record`, { token, body: { conteudo: "Invasão" } })).status).toBe(403);
      expect((await call("GET", "/appointments/pending-records", { token })).status).toBe(403);
      expect((await s.lista(token)).find((a) => a.id === id)?.prontuario).toBeNull();
    }
    expect((await call("GET", `/appointments/${id}/record`)).status).toBe(401);
  });

  it("outro psicólogo da mesma clínica não acessa o registro; outra clínica também não", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo: "Conteúdo clínico." } });

    expect((await call("GET", `/appointments/${id}/record`, { token: s.psiB.token })).json.conteudo).toBeNull();
    expect((await call("PUT", `/appointments/${id}/record`, { token: s.psiB.token, body: { conteudo: "Sobrescrita" } })).status).toBe(404);

    const outra = await mkClinic();
    const psiC = await mkUser(outra.adminToken, { nome: "Dra. Carla Dias", role: "psicologo", crp: "06/11111" });
    expect((await call("GET", `/appointments/${id}/record`, { token: psiC.token })).json.conteudo).toBeNull();
    expect((await call("PUT", `/appointments/${id}/record`, { token: psiC.token, body: { conteudo: "Sobrescrita" } })).status).toBe(404);

    expect((await call("GET", `/appointments/${id}/record`, { token: s.psiA.token })).json.conteudo).toBe("Conteúdo clínico.");
  });

  it("recusa texto vazio ou longo demais e sessão cancelada", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    const put = (conteudo: unknown) => call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo } });
    expect((await put("   ")).status).toBe(400);
    expect((await put("x".repeat(20001))).status).toBe(400);
    expect((await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: {} })).status).toBe(400);

    const cancelada = await s.sessao(2, "cancelado");
    expect((await call("PUT", `/appointments/${cancelada}/record`, { token: s.psiA.token, body: { conteudo: "Texto" } })).status).toBe(404);
  });

  it("registra leitura e gravação na auditoria e não permite exclusão física", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    await call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body: { conteudo: "Texto" } });
    await call("GET", `/appointments/${id}/record`, { token: s.psiA.token });
    const r = await ownerPool.query("SELECT action FROM audit_log WHERE clinic_id = $1 AND entity = 'session_record' ORDER BY at", [s.c.clinicId]);
    expect(r.rows.map((x) => x.action)).toEqual(["session_record.save", "session_record.read"]);
    await expect(appPool.query("DELETE FROM session_records")).rejects.toThrow();
  });

  it("anotações privativas ficam separadas do prontuário e salvar um não apaga o outro", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    const put = (body: unknown, token = s.psiA.token) => call("PUT", `/appointments/${id}/record`, { token, body });

    // só anotações: a sessão continua sem prontuário preenchido
    const so = await put({ anotacoes: "  Hipótese: ansiedade social.  " });
    expect(so.status).toBe(200);
    expect(so.json).toMatchObject({ conteudo: "", anotacoes: "Hipótese: ansiedade social." });
    expect((await s.lista(s.psiA.token)).find((a) => a.id === id)?.prontuario).toBe(false);

    // o prontuário entra sem sobrescrever as anotações
    await put({ conteudo: "Evolução favorável." });
    const lido = (await call("GET", `/appointments/${id}/record`, { token: s.psiA.token })).json;
    expect(lido).toMatchObject({ conteudo: "Evolução favorável.", anotacoes: "Hipótese: ansiedade social." });
    expect((await s.lista(s.psiA.token)).find((a) => a.id === id)?.prontuario).toBe(true);

    // e as anotações podem ser reescritas sem tocar o prontuário
    await put({ anotacoes: "Nova impressão." });
    expect((await call("GET", `/appointments/${id}/record`, { token: s.psiA.token })).json).toMatchObject({ conteudo: "Evolução favorável.", anotacoes: "Nova impressão." });

    // ninguém além do psicólogo da sessão grava anotações
    expect((await put({ anotacoes: "Invasão" }, s.rec.token)).status).toBe(403);
    expect((await put({ anotacoes: "Invasão" }, s.psiB.token)).status).toBe(404);
    expect((await put({ anotacoes: "x".repeat(20001) })).status).toBe(400);
  });

  it("histórico do paciente: lista as sessões já iniciadas com o registro, só para o psicólogo da sessão", async () => {
    const s = await cenario();
    await s.sessao(0, "realizado"); // 2030: ainda no futuro, não entra no histórico
    const passada = async (dias: number, status: string) =>
      (
        await ownerPool.query(
          `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, status, valor, created_by)
           VALUES ($1, $2, $3, now() - $4::int * interval '1 day', now() - $4::int * interval '1 day' + interval '50 minutes', $5, 200, $3) RETURNING id`,
          [s.c.clinicId, s.pac.id, s.psiA.id, dias, status],
        )
      ).rows[0].id as string;
    const velha = await passada(7, "realizado");
    const recente = await passada(2, "faltou");
    await passada(1, "cancelado"); // cancelada não entra
    await call("PUT", `/appointments/${velha}/record`, { token: s.psiA.token, body: { conteudo: "Primeira sessão.", anotacoes: "Nota A." } });

    const r = await call("GET", `/patients/${s.pac.id}/records`, { token: s.psiA.token });
    expect(r.status).toBe(200);
    expect(r.json.map((x: { appointment_id: string }) => x.appointment_id)).toEqual([recente, velha]); // mais recente primeiro
    expect(r.json[0]).toMatchObject({ status: "faltou", conteudo: "", anotacoes: "" });
    expect(r.json[1]).toMatchObject({ status: "realizado", conteudo: "Primeira sessão.", anotacoes: "Nota A." });

    for (const token of [s.rec.token, s.c.adminToken]) expect((await call("GET", `/patients/${s.pac.id}/records`, { token })).status).toBe(403);
    expect((await call("GET", `/patients/${s.pac.id}/records`, { token: s.psiB.token })).json).toEqual([]);
  });

  it("a lista da agenda informa quem marcou a sessão", async () => {
    const s = await cenario();
    const id = await s.sessao(0);
    const item = (await call("GET", `/appointments?from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(7, "00:00"))}`, { token: s.rec.token })).json.find((a: { id: string }) => a.id === id);
    expect(item.agendado_por).toBe("Dra. Ana Lima");
    expect(item.created_at).toBeTruthy();
  });
});

describe("trilha e documento do prontuário", () => {
  it("cada gravação guarda uma versão imutável, lida só pelo psicólogo da sessão", async () => {
    const s = await cenario();
    const id = await s.sessao(0, "realizado");
    const put = (body: unknown) => call("PUT", `/appointments/${id}/record`, { token: s.psiA.token, body });
    await put({ conteudo: "Versão 1." });
    await put({ conteudo: "Versão 2.", anotacoes: "Nota." });
    const v = await ownerPool.query("SELECT conteudo, anotacoes FROM session_record_versions WHERE appointment_id = $1 ORDER BY saved_at, id", [id]);
    expect(v.rows).toEqual([{ conteudo: "Versão 1.", anotacoes: "" }, { conteudo: "Versão 2.", anotacoes: "Nota." }]);
    await expect(appPool.query("UPDATE session_record_versions SET conteudo = 'x'")).rejects.toThrow();
    await expect(appPool.query("DELETE FROM session_record_versions")).rejects.toThrow();
  });

  it("exporta só as sessões escolhidas, com as anotações privativas que o profissional marcar", async () => {
    const s = await cenario();
    const a = await s.sessao(0, "realizado");
    const b = await s.sessao(1, "realizado");
    await call("PUT", `/appointments/${a}/record`, { token: s.psiA.token, body: { conteudo: "Sessão A.", anotacoes: "Privada A." } });
    await call("PUT", `/appointments/${b}/record`, { token: s.psiA.token, body: { conteudo: "Sessão B.", anotacoes: "Privada B." } });
    const exp = (token: string, sessoes: unknown) => call("POST", `/patients/${s.pac.id}/records/export`, { token, body: { sessoes } });

    const r = await exp(s.psiA.token, [{ id: a, anotacoes: true }, { id: b, anotacoes: false }]);
    expect(r.status).toBe(200);
    expect(r.json.paciente.nome).toBe("Paciente Um");
    expect(r.json.profissional).toMatchObject({ nome: "Dra. Ana Lima", crp: "06/12345" });
    expect(r.json.clinica).toBe("Clínica Teste");
    expect(r.json.itens.map((i: { conteudo: string; anotacoes: string | null }) => [i.conteudo, i.anotacoes])).toEqual([["Sessão A.", "Privada A."], ["Sessão B.", null]]);

    expect((await exp(s.psiA.token, [])).status).toBe(400);
    for (const token of [s.rec.token, s.c.adminToken]) expect((await exp(token, [{ id: a, anotacoes: true }])).status).toBe(403);
    expect((await exp(s.psiB.token, [{ id: a, anotacoes: true }])).status).toBe(404); // paciente de outro psicólogo
    const log = await ownerPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'session_record.export'", [s.c.clinicId]);
    expect(log.rows[0].n).toBe(1); // só a exportação bem-sucedida
  });
});
