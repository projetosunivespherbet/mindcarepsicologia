import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { alertaRisco, ESCALAS, faixa, pontuar, type EscalaKey } from "../../../shared/scales";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { optText, readBody } from "../validation";

/** Plano terapêutico e escalas: só o psicólogo (ou a administração que atende). */
const author = createMiddleware<AppEnv>(async (c, next) => {
  const s = c.get("session");
  if (!(s.role === "psicologo" || (s.role === "admin" && s.atende))) {
    throw new HTTPException(403, { message: "Apenas o psicólogo responsável acessa o plano terapêutico e as escalas" });
  }
  await next();
});

async function assertPatient(db: DbClient, id: string) {
  const p = (await db.query("SELECT id FROM patients WHERE id = $1", [id])).rows[0];
  if (!p) throw new HTTPException(404, { message: "Paciente não encontrado" });
}

/** A sessão informada precisa ser do mesmo paciente e do próprio profissional. */
async function assertAppointment(db: DbClient, appointmentId: string | null | undefined, patientId: string) {
  if (!appointmentId) return;
  const a = (await db.query("SELECT 1 FROM appointments WHERE id = $1 AND patient_id = $2 AND professional_id = app_user()", [appointmentId, patientId])).rows[0];
  if (!a) throw new HTTPException(422, { message: "A sessão informada não é deste paciente" });
}

const GOAL_COLS = `g.id, g.patient_id, g.titulo, g.descricao, g.status, g.created_at, g.updated_at,
  COALESCE((SELECT json_agg(json_build_object('id', p.id, 'nota', p.nota, 'comentario', p.comentario, 'appointment_id', p.appointment_id, 'created_at', p.created_at) ORDER BY p.created_at)
            FROM goal_progress p WHERE p.goal_id = g.id), '[]'::json) AS avancos`;

// ================================================================ /patients/:id/...

export const clinical = new Hono<AppEnv>();
clinical.use("*", requireAuth);

clinical.get("/:id/goals", author, async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query(`SELECT ${GOAL_COLS} FROM therapy_goals g WHERE g.patient_id = $1 ORDER BY g.status = 'ativa' DESC, g.created_at`, [c.req.param("id")])).rows,
  );
  return c.json(rows);
});

clinical.post("/:id/goals", author, async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ titulo: z.string().trim().min(2, "Descreva a meta").max(200), descricao: optText(2000) }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    await assertPatient(db, c.req.param("id"));
    const r = await db.query(
      `INSERT INTO therapy_goals (clinic_id, patient_id, professional_id, titulo, descricao, created_by)
       VALUES (app_clinic(), $1, app_user(), $2, $3, app_user()) RETURNING id`,
      [c.req.param("id"), body.titulo, body.descricao || null],
    );
    await audit(db, s, "goal.create", "goal", r.rows[0].id);
    return (await db.query(`SELECT ${GOAL_COLS} FROM therapy_goals g WHERE g.id = $1`, [r.rows[0].id])).rows[0];
  });
  return c.json(row, 201);
});

clinical.get("/:id/scales", author, async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT id, escala, respostas, pontuacao, appointment_id, created_at FROM scale_applications WHERE patient_id = $1 ORDER BY created_at`,
        [c.req.param("id")],
      )
    ).rows,
  );
  return c.json(rows.map((r) => ({ ...r, faixa: faixa(r.escala as EscalaKey, r.pontuacao), alerta: alertaRisco(r.escala as EscalaKey, r.respostas) })));
});

clinical.post("/:id/scales", author, async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ escala: z.enum(["phq9", "gad7"]), respostas: z.array(z.number().int().min(0).max(3)), appointment_id: z.uuid().optional().nullable() }),
  );
  if (body.respostas.length !== ESCALAS[body.escala].itens.length) {
    throw new HTTPException(400, { message: `Responda os ${ESCALAS[body.escala].itens.length} itens` });
  }
  const pontuacao = pontuar(body.respostas);
  const row = await withSession(c.get("pool"), s, async (db) => {
    await assertPatient(db, c.req.param("id"));
    await assertAppointment(db, body.appointment_id, c.req.param("id"));
    const r = await db.query(
      `INSERT INTO scale_applications (clinic_id, patient_id, professional_id, appointment_id, escala, respostas, pontuacao, created_by)
       VALUES (app_clinic(), $1, app_user(), $2, $3, $4, $5, app_user())
       RETURNING id, escala, respostas, pontuacao, appointment_id, created_at`,
      [c.req.param("id"), body.appointment_id ?? null, body.escala, body.respostas, pontuacao],
    );
    await audit(db, s, "scale.apply", "patient", c.req.param("id"));
    return r.rows[0];
  });
  return c.json({ ...row, faixa: faixa(body.escala, pontuacao), alerta: alertaRisco(body.escala, body.respostas) }, 201);
});

// Linha do tempo: tudo o que aconteceu com o paciente. Cada fonte passa pela RLS: a recepção vê sessões e
// financeiro; dados clínicos (documentos, metas, escalas) só aparecem para o psicólogo deles.
clinical.get("/:id/timeline", async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) => {
    await assertPatient(db, c.req.param("id"));
    return (
      await db.query(
        `SELECT * FROM (
           SELECT a.starts_at AS quando, 'sessao' AS tipo, a.status AS titulo, a.atendimento AS detalhe, NULL::int AS valor_centavos, a.id AS ref
             FROM appointments a WHERE a.patient_id = $1 AND a.starts_at <= now() + interval '60 days'
           UNION ALL
           SELECT ch.created_at, 'cobranca', ch.descricao, ch.status, ch.liquido_centavos, ch.id FROM charges ch WHERE ch.patient_id = $1
           UNION ALL
           SELECT pg.created_at, CASE WHEN pg.reverses_id IS NULL THEN 'pagamento' ELSE 'estorno' END, pg.metodo, NULL, pg.valor_centavos, ch.id
             FROM payments pg JOIN charges ch ON ch.id = pg.charge_id WHERE ch.patient_id = $1
           UNION ALL
           SELECT d.emitted_at, 'documento', d.titulo, d.numero, NULL, d.id FROM documents d WHERE d.patient_id = $1 AND d.emitted_at IS NOT NULL
           UNION ALL
           SELECT g.created_at, 'meta', g.titulo, g.status, NULL, g.id FROM therapy_goals g WHERE g.patient_id = $1
           UNION ALL
           SELECT sa.created_at, 'escala', sa.escala, NULL, sa.pontuacao, sa.id FROM scale_applications sa WHERE sa.patient_id = $1
         ) t ORDER BY quando DESC LIMIT 300`,
        [c.req.param("id")],
      )
    ).rows;
  });
  return c.json(rows);
});

// ================================================================ /goals/:id

export const goals = new Hono<AppEnv>();
goals.use("*", requireAuth, author);

goals.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ titulo: z.string().trim().min(2).max(200), descricao: optText(2000), status: z.enum(["ativa", "alcancada", "suspensa"]) }).partial(),
  );
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HTTPException(400, { message: "Nada para atualizar" });
  const row = await withSession(c.get("pool"), s, async (db) => {
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const r = await db.query(`UPDATE therapy_goals SET ${sets} WHERE id = $1 RETURNING id`, [c.req.param("id"), ...entries.map(([, v]) => v || null)]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "Meta não encontrada" });
    await audit(db, s, "goal.update", "goal", r.rows[0].id);
    return (await db.query(`SELECT ${GOAL_COLS} FROM therapy_goals g WHERE g.id = $1`, [r.rows[0].id])).rows[0];
  });
  return c.json(row);
});

goals.post("/:id/progress", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ nota: z.number().int().min(0).max(10), comentario: optText(500), appointment_id: z.uuid().optional().nullable() }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const g = (await db.query("SELECT id, patient_id FROM therapy_goals WHERE id = $1", [c.req.param("id")])).rows[0];
    if (!g) throw new HTTPException(404, { message: "Meta não encontrada" });
    await assertAppointment(db, body.appointment_id, g.patient_id);
    await db.query(
      `INSERT INTO goal_progress (clinic_id, goal_id, professional_id, appointment_id, nota, comentario, created_by)
       VALUES (app_clinic(), $1, app_user(), $2, $3, $4, app_user())`,
      [g.id, body.appointment_id ?? null, body.nota, body.comentario || null],
    );
    await audit(db, s, "goal.progress", "goal", g.id);
    return (await db.query(`SELECT ${GOAL_COLS} FROM therapy_goals g WHERE g.id = $1`, [g.id])).rows[0];
  });
  return c.json(row, 201);
});
