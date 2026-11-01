import { afterAll, describe, expect, it } from "vitest";
import { appPool, call, mkClinic, mkUser, ownerPool } from "./helpers";

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
  // sessão passada, inserida pelo dono do banco (a API só marca no presente/futuro)
  const passada = async (dias: number, status: string) =>
    (
      await ownerPool.query(
        `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, status, valor, created_by)
         VALUES ($1, $2, $3, now() - $4::int * interval '1 day', now() - $4::int * interval '1 day' + interval '50 minutes', $5, 200, $3) RETURNING id`,
        [c.clinicId, pac.id, psiA.id, dias, status],
      )
    ).rows[0].id as string;
  return { c, psiA, psiB, rec, pac, passada };
}

describe("plano terapêutico", () => {
  it("cria metas, registra avanço por sessão e muda a situação; só o psicólogo acessa", async () => {
    const s = await cenario();
    const sessao = await s.passada(1, "realizado");
    const meta = await call("POST", `/patients/${s.pac.id}/goals`, { token: s.psiA.token, body: { titulo: "Reduzir crises de ansiedade", descricao: "Menos de uma por semana" } });
    expect(meta.status).toBe(201);
    expect(meta.json).toMatchObject({ titulo: "Reduzir crises de ansiedade", status: "ativa", avancos: [] });

    const av = await call("POST", `/goals/${meta.json.id}/progress`, { token: s.psiA.token, body: { nota: 4, comentario: "Duas crises na semana", appointment_id: sessao } });
    expect(av.status).toBe(201);
    await call("POST", `/goals/${meta.json.id}/progress`, { token: s.psiA.token, body: { nota: 7 } });
    const lista = (await call("GET", `/patients/${s.pac.id}/goals`, { token: s.psiA.token })).json;
    expect(lista[0].avancos.map((a: { nota: number }) => a.nota)).toEqual([4, 7]);
    expect((await call("POST", `/goals/${meta.json.id}/progress`, { token: s.psiA.token, body: { nota: 11 } })).status).toBe(400);

    expect((await call("PATCH", `/goals/${meta.json.id}`, { token: s.psiA.token, body: { status: "alcancada" } })).json.status).toBe("alcancada");

    for (const token of [s.rec.token, s.c.adminToken]) {
      expect((await call("GET", `/patients/${s.pac.id}/goals`, { token })).status).toBe(403);
      expect((await call("POST", `/goals/${meta.json.id}/progress`, { token, body: { nota: 1 } })).status).toBe(403);
    }
    expect((await call("POST", `/goals/${meta.json.id}/progress`, { token: s.psiB.token, body: { nota: 1 } })).status).toBe(404);
    await expect(appPool.query("DELETE FROM goal_progress")).rejects.toThrow();
  });
});

describe("escalas", () => {
  it("pontua PHQ-9 e GAD-7, dá a faixa e alerta o item 9", async () => {
    const s = await cenario();
    const phq = await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiA.token, body: { escala: "phq9", respostas: [2, 2, 1, 2, 1, 1, 1, 0, 1] } });
    expect(phq.status).toBe(201);
    expect(phq.json).toMatchObject({ pontuacao: 11, faixa: "Moderado", alerta: true });
    const gad = await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiA.token, body: { escala: "gad7", respostas: [1, 1, 1, 0, 0, 1, 0] } });
    expect(gad.json).toMatchObject({ pontuacao: 4, faixa: "Mínimo", alerta: false });

    expect((await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiA.token, body: { escala: "gad7", respostas: [1, 1] } })).status).toBe(400);
    expect((await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiA.token, body: { escala: "gad7", respostas: [4, 0, 0, 0, 0, 0, 0] } })).status).toBe(400);
    expect((await call("GET", `/patients/${s.pac.id}/scales`, { token: s.psiA.token })).json).toHaveLength(2);
    expect((await call("GET", `/patients/${s.pac.id}/scales`, { token: s.rec.token })).status).toBe(403);
    expect((await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiB.token, body: { escala: "gad7", respostas: [0, 0, 0, 0, 0, 0, 0] } })).status).toBe(404);
  });
});

describe("risco de abandono", () => {
  it("aponta duas faltas seguidas e quem está sem retorno há mais de 21 dias", async () => {
    const s = await cenario();
    await s.passada(20, "realizado");
    await s.passada(13, "faltou");
    await s.passada(6, "faltou");
    const outro = (await call("POST", "/patients", { token: s.psiA.token, body: { nome: "Paciente Dois" } })).json;
    await ownerPool.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, now() - interval '30 days', now() - interval '30 days' + interval '50 minutes', 'realizado', $3)`,
      [s.c.clinicId, outro.id, s.psiA.id],
    );
    const r = await call("GET", "/appointments/attention", { token: s.psiA.token });
    expect(r.status).toBe(200);
    const porNome = Object.fromEntries(r.json.map((x: { nome: string; motivo: string }) => [x.nome, x.motivo]));
    expect(porNome).toEqual({ "Paciente Um": "faltas_seguidas", "Paciente Dois": "sem_retorno" });
    // a recepção vê o mesmo (não é dado clínico); outro psicólogo não vê pacientes alheios
    expect((await call("GET", "/appointments/attention", { token: s.rec.token })).json).toHaveLength(2);
    expect((await call("GET", "/appointments/attention", { token: s.psiB.token })).json).toEqual([]);
  });
});

describe("linha do tempo", () => {
  it("junta sessões, cobranças, metas e escalas; a recepção não vê o que é clínico", async () => {
    const s = await cenario();
    await s.passada(3, "realizado");
    await call("POST", "/charges", { token: s.psiA.token, body: { patient_id: s.pac.id, valor_centavos: 20000 } });
    await call("POST", `/patients/${s.pac.id}/goals`, { token: s.psiA.token, body: { titulo: "Dormir melhor" } });
    await call("POST", `/patients/${s.pac.id}/scales`, { token: s.psiA.token, body: { escala: "gad7", respostas: [0, 0, 0, 0, 0, 0, 0] } });
    const tipos = async (token: string) => new Set(((await call("GET", `/patients/${s.pac.id}/timeline`, { token })).json as { tipo: string }[]).map((x) => x.tipo));
    expect([...(await tipos(s.psiA.token))].sort()).toEqual(["cobranca", "escala", "meta", "sessao"]);
    expect([...(await tipos(s.rec.token))].sort()).toEqual(["cobranca", "sessao"]);
  });
});
