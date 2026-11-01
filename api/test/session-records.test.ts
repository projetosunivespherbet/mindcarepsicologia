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
});
