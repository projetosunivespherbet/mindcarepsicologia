import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { cpfSchema, emailSchema, nameSchema, optText, readBody, readQuery } from "../validation";

const COLS = "id, nome, cpf, data_nascimento::text AS data_nascimento, telefone, email, genero, estado_civil, profissao, professional_id, ativo, created_at, updated_at";

const patientFields = {
  nome: nameSchema,
  cpf: cpfSchema.optional().nullable(),
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
      `INSERT INTO patients (clinic_id, nome, cpf, data_nascimento, telefone, email, genero, estado_civil, profissao, professional_id, created_by)
       VALUES ($1, $2, $11, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLS}`,
      [s.clinicId, body.nome, body.data_nascimento ?? null, body.telefone ?? null, body.email ?? null,
       body.genero ?? null, body.estado_civil ?? null, body.profissao ?? null, professionalId, s.userId, body.cpf ?? null],
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
