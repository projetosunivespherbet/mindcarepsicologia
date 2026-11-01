import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { cnsSchema, cpfSchema, emailSchema, nameSchema, optText, readBody, readQuery } from "../validation";

const COLS = "id, nome, cpf, cns, endereco, end_cep, end_logradouro, end_numero, end_complemento, end_bairro, end_cidade, end_uf, responsavel_nome, responsavel_cpf, responsavel_vinculo, responsavel_telefone, data_nascimento::text AS data_nascimento, telefone, email, genero, estado_civil, profissao, professional_id, ativo, created_at, updated_at";

const patientFields = {
  nome: nameSchema,
  cpf: cpfSchema.optional().nullable(),
  cns: cnsSchema.optional().nullable(),
  endereco: optText(300),
  end_cep: z.string().trim().transform((s) => s.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8}$/, "CEP inválido")).optional().nullable(),
  end_logradouro: optText(160),
  end_numero: optText(20),
  end_complemento: optText(80),
  end_bairro: optText(80),
  end_cidade: optText(80),
  end_uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF inválida").optional().nullable(),
  responsavel_nome: z.string().trim().min(2, "Nome do responsável muito curto").max(160).optional().nullable(),
  responsavel_cpf: cpfSchema.optional().nullable(),
  responsavel_vinculo: optText(60),
  responsavel_telefone: optText(30),
  data_nascimento: z.iso.date().optional().nullable(),
  telefone: optText(30),
  email: emailSchema.optional().nullable(),
  genero: optText(60),
  estado_civil: optText(60),
  profissao: optText(120),
  professional_id: z.uuid().optional().nullable(),
};

async function assertProfessional(db: DbClient, id: string | null | undefined) {
  if (!id) return;
  const r = await db.query("SELECT 1 FROM users WHERE id = $1 AND atende AND status <> 'inativo'", [id]);
  if (r.rows.length === 0) throw new HTTPException(422, { message: "O psicólogo responsável informado não atende nesta clínica" });
}

export const patients = new Hono<AppEnv>();
patients.use("*", requireAuth);

patients.get("/", async (c) => {
  const q = readQuery(c, z.object({ q: z.string().trim().max(100).optional(), ativo: z.enum(["true", "false"]).optional() }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${COLS} FROM patients
         WHERE ($1::text IS NULL OR nome ILIKE '%' || $1 || '%')
           AND ($2::boolean IS NULL OR ativo = $2::boolean)
         ORDER BY nome LIMIT 500`,
        [q.q ?? null, q.ativo ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

patients.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object(patientFields));
  // Psicólogo só cadastra pacientes sob a própria responsabilidade.
  const professionalId = s.role === "psicologo" ? s.userId : (body.professional_id ?? null);
  const row = await withSession(c.get("pool"), s, async (db) => {
    await assertProfessional(db, professionalId);
    const r = await db.query(
      `INSERT INTO patients (clinic_id, nome, cpf, cns, endereco, end_cep, end_logradouro, end_numero, end_complemento, end_bairro, end_cidade, end_uf, responsavel_nome, responsavel_cpf, responsavel_vinculo, responsavel_telefone, data_nascimento, telefone, email, genero, estado_civil, profissao, professional_id, created_by)
       VALUES ($1, $2, $11, $12, $13, $18, $19, $20, $21, $22, $23, $24, $14, $15, $16, $17, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLS}`,
      [s.clinicId, body.nome, body.data_nascimento ?? null, body.telefone ?? null, body.email ?? null,
       body.genero ?? null, body.estado_civil ?? null, body.profissao ?? null, professionalId, s.userId, body.cpf ?? null, body.cns ?? null, body.endereco || null,
       body.responsavel_nome || null, body.responsavel_cpf ?? null, body.responsavel_vinculo || null, body.responsavel_telefone || null,
       body.end_cep || null, body.end_logradouro || null, body.end_numero || null, body.end_complemento || null, body.end_bairro || null, body.end_cidade || null, body.end_uf || null],
    );
    await audit(db, s, "patient.create", "patient", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

patients.get("/:id", async (c) => {
  const s = c.get("session");
  const result = await withSession(c.get("pool"), s, async (db) => {
    const p = (await db.query(`SELECT ${COLS} FROM patients WHERE id = $1`, [c.req.param("id")])).rows[0];
    if (!p) return null;
    // Dados clínicos: a RLS devolve a linha só para quem pode ver.
    const a = (
      await db.query(
        `SELECT queixa_principal, historico_familiar, medicamentos, tratamentos_anteriores, expectativas, updated_at
         FROM patient_anamnesis WHERE patient_id = $1`,
        [p.id],
      )
    ).rows[0];
    await audit(db, s, a ? "patient.view_clinical" : "patient.view", "patient", p.id);
    return { ...p, anamnesis: a ?? null };
  });
  if (!result) throw new HTTPException(404, { message: "Paciente não encontrado" });
  return c.json(result);
});

// Histórico clínico do paciente com este profissional: cada sessão já iniciada, com prontuário e anotações privativas.
// Só o psicólogo (ou o administrador que atende) lê; a RLS ainda limita ao que é dele.
patients.get("/:id/records", async (c) => {
  const s = c.get("session");
  if (!(s.role === "psicologo" || (s.role === "admin" && s.atende))) {
    throw new HTTPException(403, { message: "Apenas o psicólogo responsável acessa o prontuário" });
  }
  const rows = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `SELECT a.id AS appointment_id, a.patient_id, a.starts_at, a.ends_at, a.status, a.atendimento,
              COALESCE(r.conteudo, '') AS conteudo, COALESCE(r.anotacoes, '') AS anotacoes, r.updated_at
       FROM appointments a LEFT JOIN session_records r ON r.appointment_id = a.id
       WHERE a.patient_id = $1 AND a.professional_id = app_user() AND a.status <> 'cancelado' AND a.starts_at <= now()
       ORDER BY a.starts_at DESC LIMIT 200`,
      [c.req.param("id")],
    );
    await audit(db, s, "session_record.list", "patient", c.req.param("id"));
    return r.rows;
  });
  return c.json(rows);
});

// Documento do prontuário: o profissional escolhe as sessões e quais anotações privativas acompanham.
patients.post("/:id/records/export", async (c) => {
  const s = c.get("session");
  if (!(s.role === "psicologo" || (s.role === "admin" && s.atende))) {
    throw new HTTPException(403, { message: "Apenas o psicólogo responsável acessa o prontuário" });
  }
  const body = await readBody(c, z.object({ sessoes: z.array(z.object({ id: z.uuid(), anotacoes: z.boolean() })).min(1, "Escolha ao menos uma sessão").max(200) }));
  const incluir = new Map(body.sessoes.map((x) => [x.id, x.anotacoes]));
  const out = await withSession(c.get("pool"), s, async (db) => {
    const p = (await db.query(`SELECT nome, cpf, cns, endereco, responsavel_nome, responsavel_cpf, responsavel_vinculo, data_nascimento::text AS data_nascimento FROM patients WHERE id = $1`, [c.req.param("id")])).rows[0];
    if (!p) throw new HTTPException(404, { message: "Paciente não encontrado" });
    const prof = (await db.query(`SELECT nome, crp FROM users WHERE id = app_user()`)).rows[0];
    const clinica = (await db.query(`SELECT nome FROM clinics WHERE id = app_clinic()`)).rows[0];
    const rows = (
      await db.query(
        `SELECT a.id, a.starts_at, a.ends_at, a.status, r.conteudo, r.anotacoes
         FROM appointments a JOIN session_records r ON r.appointment_id = a.id
         WHERE a.patient_id = $1 AND a.professional_id = app_user() AND a.id = ANY($2::uuid[])
         ORDER BY a.starts_at`,
        [c.req.param("id"), body.sessoes.map((x) => x.id)],
      )
    ).rows;
    await audit(db, s, "session_record.export", "patient", c.req.param("id"));
    return {
      paciente: p,
      profissional: prof ?? null,
      clinica: clinica?.nome ?? "",
      itens: rows.map((r) => ({
        appointment_id: r.id,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        status: r.status,
        conteudo: r.conteudo,
        anotacoes: incluir.get(r.id) && r.anotacoes ? r.anotacoes : null,
      })),
    };
  });
  return c.json(out);
});

patients.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ ...patientFields, ativo: z.boolean() }).partial());
  if (s.role === "psicologo" && body.professional_id !== undefined) {
    throw new HTTPException(403, { message: "Apenas a administração ou a recepção redefine o responsável" });
  }
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HTTPException(400, { message: "Nada para atualizar" });

  const row = await withSession(c.get("pool"), s, async (db) => {
    await assertProfessional(db, body.professional_id);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const r = await db.query(`UPDATE patients SET ${sets} WHERE id = $1 RETURNING ${COLS}`, [
      c.req.param("id"),
      ...entries.map(([, v]) => v),
    ]);
    if (r.rows[0]) await audit(db, s, "patient.update", "patient", r.rows[0].id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Paciente não encontrado" });
  return c.json(row);
});

patients.put("/:id/anamnesis", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      queixa_principal: optText(5000),
      historico_familiar: optText(5000),
      medicamentos: optText(2000),
      tratamentos_anteriores: optText(5000),
      expectativas: optText(5000),
    }),
  );
  if (s.role === "recepcao") throw new HTTPException(403, { message: "Sem permissão para dados clínicos" });
  const row = await withSession(c.get("pool"), s, async (db) => {
    const p = (await db.query("SELECT id FROM patients WHERE id = $1", [c.req.param("id")])).rows[0];
    if (!p) throw new HTTPException(404, { message: "Paciente não encontrado" });
    const r = await db.query(
      `INSERT INTO patient_anamnesis (patient_id, clinic_id, queixa_principal, historico_familiar, medicamentos,
                                      tratamentos_anteriores, expectativas, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (patient_id) DO UPDATE SET queixa_principal = EXCLUDED.queixa_principal,
         historico_familiar = EXCLUDED.historico_familiar, medicamentos = EXCLUDED.medicamentos,
         tratamentos_anteriores = EXCLUDED.tratamentos_anteriores, expectativas = EXCLUDED.expectativas,
         updated_by = EXCLUDED.updated_by
       RETURNING queixa_principal, historico_familiar, medicamentos, tratamentos_anteriores, expectativas, updated_at`,
      [p.id, s.clinicId, body.queixa_principal ?? null, body.historico_familiar ?? null, body.medicamentos ?? null,
       body.tratamentos_anteriores ?? null, body.expectativas ?? null, s.userId],
    );
    await audit(db, s, "patient.update_clinical", "patient", p.id);
    return r.rows[0];
  });
  return c.json(row);
});
