import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { isoDateTime, optText, readBody, readQuery } from "../validation";

const COLS = `id, patient_id, professional_id, starts_at, ends_at, tipo, status, valor::float8 AS valor,
              payment_status, convenio, atendimento, imposto, series_id, package_id, observacao, created_at, updated_at`;
// situação da nota da sessão (a cobrança ativa e a nota ativa dela): nulo = ainda sem nota
const NOTA_STATUS = `(SELECT d.status FROM charges ch JOIN fiscal_document_charges l ON l.charge_id = ch.id AND l.ativo
                      JOIN fiscal_documents d ON d.id = l.document_id
                     WHERE ch.appointment_id = appointments.id AND ch.status <> 'cancelada' LIMIT 1) AS nota_status`;
const ATENDIMENTOS = ["particular", "convenio", "pro_bono"] as const;
const MAX_RANGE_MS = 93 * 24 * 3600 * 1000;

const range = z.object({
  from: isoDateTime,
  to: isoDateTime,
  professional_id: z.uuid().optional(),
  patient_id: z.uuid().optional(),
});

function checkRange(from: string, to: string) {
  const span = new Date(to).getTime() - new Date(from).getTime();
  if (!(span > 0) || span > MAX_RANGE_MS) {
    throw new HTTPException(400, { message: "Informe um período válido de até 93 dias" });
  }
}

const appointmentFields = {
  tipo: z.enum(["individual", "grupo"]),
  status: z.enum(["agendado", "confirmado", "realizado", "faltou", "cancelado"]),
  valor: z.number().min(0).max(100000).nullable(),
  payment_status: z.enum(["pendente", "pago", "nao_pago"]),
  convenio: z.boolean(),
  atendimento: z.enum(ATENDIMENTOS),
  imposto: z.boolean(),
  observacao: optText(500),
};

// Prontuário da sessão: true/false só para o profissional da sessão; nulo para os demais (não enxergam o prontuário).
const PRONTUARIO = `(CASE WHEN professional_id = app_user() THEN EXISTS (SELECT 1 FROM session_records r WHERE r.appointment_id = appointments.id AND r.conteudo <> '') END) AS prontuario`;
// Quem marcou a sessão (nome), para o card da agenda.
// Cobrança avulsa ativa da sessão (para "Cobrar agora" / "Ver cobrança"); a RLS de charges esconde o que não é do usuário.
const CHARGE_ID = `(SELECT ch.id FROM charges ch WHERE ch.appointment_id = appointments.id AND ch.status <> 'cancelada' LIMIT 1) AS charge_id`;
const AGENDADO_POR = `(SELECT u.nome FROM users u WHERE u.id = appointments.created_by) AS agendado_por`;

/** Só o psicólogo (ou o administrador que atende) escreve e lê prontuários. */
const author = createMiddleware<AppEnv>(async (c, next) => {
  const s = c.get("session");
  if (!(s.role === "psicologo" || (s.role === "admin" && s.atende))) {
    throw new HTTPException(403, { message: "Apenas o psicólogo responsável acessa o prontuário" });
  }
  await next();
});

export const appointments = new Hono<AppEnv>();
appointments.use("*", requireAuth);

// Sessões realizadas, do próprio profissional, que ainda estão sem prontuário (últimos 180 dias).
appointments.get("/pending-records", author, async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT a.id, a.patient_id, a.starts_at, a.ends_at FROM appointments a
         WHERE a.professional_id = app_user() AND a.status = 'realizado'
           AND a.starts_at <= now() AND a.starts_at > now() - interval '180 days'
           AND NOT EXISTS (SELECT 1 FROM session_records r WHERE r.appointment_id = a.id AND r.conteudo <> '')
         ORDER BY a.starts_at DESC LIMIT 100`,
      )
    ).rows,
  );
  return c.json(rows);
});

appointments.get("/:id/record", author, async (c) => {
  const s = c.get("session");
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = (
      await db.query("SELECT appointment_id, conteudo, anotacoes, updated_at FROM session_records WHERE appointment_id = $1", [c.req.param("id")])
    ).rows[0];
    if (r) await audit(db, s, "session_record.read", "session_record", r.appointment_id);
    return r;
  });
  return c.json(row ?? { appointment_id: c.req.param("id"), conteudo: null, anotacoes: null, updated_at: null });
});

appointments.put("/:id/record", author, async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      conteudo: z.string().trim().min(1, "Escreva o registro da sessão").max(20000, "Texto muito longo (máximo 20.000 caracteres)").optional(),
      anotacoes: z.string().trim().max(20000, "Anotações muito longas (máximo 20.000 caracteres)").optional(),
    }),
  );
  if (body.conteudo === undefined && body.anotacoes === undefined) throw new HTTPException(400, { message: "Escreva o registro da sessão" });
  const row = await withSession(c.get("pool"), s, async (db) => {
    // Só o que veio no corpo é alterado: salvar o prontuário não apaga as anotações privativas, e vice-versa.
    const r = await db.query(
      `INSERT INTO session_records (appointment_id, clinic_id, patient_id, professional_id, conteudo, anotacoes, created_by, updated_by)
       SELECT a.id, a.clinic_id, a.patient_id, a.professional_id, COALESCE($2::text, ''), COALESCE($3::text, ''), app_user(), app_user()
       FROM appointments a WHERE a.id = $1 AND a.professional_id = app_user() AND a.status <> 'cancelado'
       ON CONFLICT (appointment_id) DO UPDATE SET
         conteudo = COALESCE($2::text, session_records.conteudo),
         anotacoes = COALESCE($3::text, session_records.anotacoes),
         updated_by = app_user()
       RETURNING appointment_id, conteudo, anotacoes, updated_at`,
      [c.req.param("id"), body.conteudo ?? null, body.anotacoes ?? null],
    );
    if (r.rows[0]) await audit(db, s, "session_record.save", "session_record", r.rows[0].appointment_id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Sessão não encontrada" });
  return c.json(row);
});

appointments.get("/", async (c) => {
  const q = readQuery(c, range);
  checkRange(q.from, q.to);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${COLS}, ${NOTA_STATUS}, ${PRONTUARIO}, ${AGENDADO_POR}, ${CHARGE_ID} FROM appointments
         WHERE starts_at >= $1 AND starts_at < $2
           AND ($3::uuid IS NULL OR professional_id = $3) AND ($4::uuid IS NULL OR patient_id = $4)
         ORDER BY starts_at`,
        [q.from, q.to, q.professional_id ?? null, q.patient_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

// Cria uma sessão ou uma série semanal; se qualquer data conflitar, nada é gravado.
appointments.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      patient_id: z.uuid(),
      professional_id: z.uuid().optional(),
      starts_at: isoDateTime,
      ends_at: isoDateTime,
      tipo: appointmentFields.tipo.default("individual"),
      valor: appointmentFields.valor.optional(),
      convenio: z.boolean().optional(),
      atendimento: appointmentFields.atendimento.optional(),
      imposto: z.boolean().default(false),
      observacao: optText(500),
      recorrencia: z.object({ frequencia: z.literal("semanal"), ocorrencias: z.number().int().min(2).max(52) }).optional(),
    }),
  );
  const professionalId = s.role === "psicologo" ? s.userId : body.professional_id;
  if (!professionalId) throw new HTTPException(422, { message: "Informe o profissional" });
  const n = body.recorrencia?.ocorrencias ?? 1;
  const atendimento = body.atendimento ?? (body.convenio ? "convenio" : "particular");
  if (atendimento === "pro_bono" && (body.valor ?? 0) > 0) {
    throw new HTTPException(422, { message: "Atendimento pro bono não tem valor" });
  }

  const rows = await withSession(c.get("pool"), s, async (db) => {
    const patient = (await db.query("SELECT id FROM patients WHERE id = $1", [body.patient_id])).rows[0];
    if (!patient) throw new HTTPException(404, { message: "Paciente não encontrado" });

    const r = await db.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, tipo, valor, convenio, imposto, series_id, created_by, atendimento, observacao)
       SELECT app_clinic(), $1, $2,
              (($3::timestamptz AT TIME ZONE c.timezone) + g.n * interval '7 days') AT TIME ZONE c.timezone,
              (($4::timestamptz AT TIME ZONE c.timezone) + g.n * interval '7 days') AT TIME ZONE c.timezone,
              $5, $6, $7, $8, $10::uuid, app_user(), $11, $12
       FROM clinics c, generate_series(0, $9::int - 1) AS g(n)
       WHERE c.id = app_clinic()
       RETURNING ${COLS}`,
      [body.patient_id, professionalId, body.starts_at, body.ends_at, body.tipo, body.valor ?? null, atendimento === "convenio", body.imposto, n,
       n > 1 ? crypto.randomUUID() : null, atendimento, body.observacao || null],
    );
    await audit(db, s, "appointment.create", "appointment", r.rows[0].id);
    return r.rows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  });
  return c.json(n > 1 ? rows : rows[0], 201);
});

appointments.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      ...appointmentFields,
      starts_at: isoDateTime,
      ends_at: isoDateTime,
      professional_id: z.uuid(),
    }).partial(),
  );
  if (s.role === "psicologo" && body.professional_id !== undefined) {
    throw new HTTPException(403, { message: "Apenas a administração ou a recepção troca o profissional" });
  }
  // convenio e atendimento andam juntos: o banco exige que 'convenio' coincida com o tipo de atendimento
  const legacyConvenio = body.convenio !== undefined && body.atendimento === undefined ? body.convenio : undefined;
  if (body.atendimento !== undefined) body.convenio = body.atendimento === "convenio";
  if (legacyConvenio !== undefined) delete body.convenio;
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0 && legacyConvenio === undefined) throw new HTTPException(400, { message: "Nada para atualizar" });

  const row = await withSession(c.get("pool"), s, async (db) => {
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const params: unknown[] = [c.req.param("id"), ...entries.map(([, v]) => v)];
    if (legacyConvenio !== undefined) {
      params.push(legacyConvenio);
      const n = params.length;
      sets.push(`atendimento = CASE WHEN $${n}::boolean THEN 'convenio' WHEN atendimento = 'convenio' THEN 'particular' ELSE atendimento END`, `convenio = $${n}::boolean`);
    }
    const r = await db.query(`UPDATE appointments SET ${sets.join(", ")} WHERE id = $1 RETURNING ${COLS}`, params);
    if (r.rows[0]) await audit(db, s, "appointment.update", "appointment", r.rows[0].id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Sessão não encontrada" });
  return c.json(row);
});

export const blocks = new Hono<AppEnv>();
blocks.use("*", requireAuth);

blocks.get("/", async (c) => {
  const q = readQuery(c, range.pick({ from: true, to: true, professional_id: true }));
  checkRange(q.from, q.to);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT id, professional_id, starts_at, ends_at, motivo FROM time_blocks
         WHERE starts_at < $2 AND ends_at > $1 AND ($3::uuid IS NULL OR professional_id = $3) ORDER BY starts_at`,
        [q.from, q.to, q.professional_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

blocks.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ professional_id: z.uuid().optional(), starts_at: isoDateTime, ends_at: isoDateTime, motivo: optText(200) }),
  );
  const professionalId = s.role === "psicologo" ? s.userId : body.professional_id;
  if (!professionalId) throw new HTTPException(422, { message: "Informe o profissional" });
  if (new Date(body.ends_at) <= new Date(body.starts_at)) {
    throw new HTTPException(422, { message: "Horário inválido: o início deve ser antes do fim" });
  }

  const row = await withSession(c.get("pool"), s, async (db) => {
    const clash = await db.query(
      `SELECT 1 FROM appointments WHERE professional_id = $1 AND status <> 'cancelado' AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [professionalId, body.starts_at, body.ends_at],
    );
    if (clash.rows.length > 0) throw new HTTPException(409, { message: "Há sessões marcadas neste período" });
    const r = await db.query(
      `INSERT INTO time_blocks (clinic_id, professional_id, starts_at, ends_at, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, professional_id, starts_at, ends_at, motivo`,
      [s.clinicId, professionalId, body.starts_at, body.ends_at, body.motivo ?? null, s.userId],
    );
    return r.rows[0];
  });
  return c.json(row, 201);
});

blocks.delete("/:id", async (c) => {
  const done = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query("DELETE FROM time_blocks WHERE id = $1 RETURNING id", [c.req.param("id")])).rows.length,
  );
  if (!done) throw new HTTPException(404, { message: "Bloqueio não encontrado" });
  return c.body(null, 204);
});
