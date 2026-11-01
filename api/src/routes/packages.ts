import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { centsSchema, dateOnly, readBody, readQuery } from "../validation";
import { clinicToday } from "./finance";

// Pacote de sessões: uma cobrança única; cada sessão realizada (ou falta, se o profissional decidir) desconta do saldo.
const PKG_COLS = `p.id, p.patient_id, p.professional_id, p.sessoes, p.valor_centavos, p.status, p.charge_id, p.created_at,
  ch.status AS charge_status, ch.paid_centavos AS charge_paid_centavos,
  (SELECT count(*)::int FROM appointments a WHERE a.package_id = p.id AND a.status <> 'cancelado') AS usadas`;
const PKG_FROM = "FROM session_packages p JOIN charges ch ON ch.id = p.charge_id";

async function loadPackage(db: DbClient, id: string) {
  const r = (await db.query(`SELECT ${PKG_COLS} ${PKG_FROM} WHERE p.id = $1`, [id])).rows[0];
  if (!r) throw new HTTPException(404, { message: "Pacote não encontrado" });
  return { ...r, saldo: r.sessoes - r.usadas };
}

export const packages = new Hono<AppEnv>();
packages.use("*", requireAuth);

packages.get("/", async (c) => {
  const q = readQuery(c, z.object({ patient_id: z.uuid() }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query(`SELECT ${PKG_COLS} ${PKG_FROM} WHERE p.patient_id = $1 ORDER BY p.created_at DESC LIMIT 100`, [q.patient_id])).rows,
  );
  return c.json(rows.map((r) => ({ ...r, saldo: r.sessoes - r.usadas })));
});

packages.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      patient_id: z.uuid(),
      professional_id: z.uuid().optional(),
      sessoes: z.number().int().min(1, "Informe ao menos 1 sessão").max(100),
      valor_centavos: centsSchema,
      vencimento: dateOnly.optional().nullable(),
    }),
  );
  const row = await withSession(c.get("pool"), s, async (db) => {
    const patient = (await db.query("SELECT id, professional_id FROM patients WHERE id = $1", [body.patient_id])).rows[0];
    if (!patient) throw new HTTPException(404, { message: "Paciente não encontrado" });
    const professionalId = s.role === "psicologo" ? s.userId : (body.professional_id ?? patient.professional_id);
    if (!professionalId) throw new HTTPException(422, { message: "Informe o psicólogo responsável" });
    const ok = await db.query("SELECT 1 FROM users WHERE id = $1 AND atende AND status <> 'inativo'", [professionalId]);
    if (ok.rows.length === 0) throw new HTTPException(422, { message: "O psicólogo informado não atende nesta clínica" });
    const hoje = await clinicToday(db, s.clinicId);
    const ch = await db.query(
      `INSERT INTO charges (clinic_id, patient_id, professional_id, descricao, competencia, valor_centavos, vencimento, origem, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pacote', $8) RETURNING id`,
      [s.clinicId, body.patient_id, professionalId, `Pacote de ${body.sessoes} ${body.sessoes === 1 ? "sessão" : "sessões"}`,
       `${hoje.slice(0, 7)}-01`, body.valor_centavos, body.vencimento ?? null, s.userId],
    );
    const p = await db.query(
      `INSERT INTO session_packages (clinic_id, patient_id, professional_id, sessoes, valor_centavos, charge_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [s.clinicId, body.patient_id, professionalId, body.sessoes, body.valor_centavos, ch.rows[0].id, s.userId],
    );
    await audit(db, s, "package.create", "package", p.rows[0].id);
    return loadPackage(db, p.rows[0].id);
  });
  return c.json(row, 201);
});

packages.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ status: z.enum(["ativo", "encerrado"]) }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query("UPDATE session_packages SET status = $2 WHERE id = $1 RETURNING id", [c.req.param("id"), body.status]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "Pacote não encontrado" });
    await audit(db, s, "package.update", "package", r.rows[0].id);
    return loadPackage(db, r.rows[0].id);
  });
  return c.json(row);
});

/**
 * Desconta a sessão de um pacote. Sem package_id, usa o pacote ativo mais antigo com saldo do mesmo paciente e profissional.
 * 404 = não há pacote com saldo; 409 = a sessão já tem cobrança avulsa. Repetir não desconta duas vezes.
 */
packages.post("/use", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ appointment_id: z.uuid(), package_id: z.uuid().optional() }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const a = (await db.query("SELECT id, patient_id, professional_id, status, atendimento, package_id FROM appointments WHERE id = $1 FOR UPDATE", [body.appointment_id])).rows[0];
    if (!a) throw new HTTPException(404, { message: "Sessão não encontrada" });
    if (a.package_id) return loadPackage(db, a.package_id);
    if (a.status === "cancelado") throw new HTTPException(422, { message: "Sessão cancelada não desconta do pacote" });
    if (a.atendimento === "pro_bono") throw new HTTPException(422, { message: "Atendimento pro bono não desconta do pacote" });
    const cobrada = await db.query("SELECT 1 FROM charges WHERE appointment_id = $1 AND status <> 'cancelada'", [a.id]);
    if (cobrada.rows.length > 0) throw new HTTPException(409, { message: "Esta sessão já tem cobrança avulsa" });

    const pkg = (
      await db.query(
        `SELECT p.id, p.sessoes, (SELECT count(*)::int FROM appointments x WHERE x.package_id = p.id AND x.status <> 'cancelado') AS usadas
           FROM session_packages p
          WHERE p.patient_id = $1 AND p.professional_id = $2 AND p.status = 'ativo' AND ($3::uuid IS NULL OR p.id = $3)
          ORDER BY p.created_at FOR UPDATE OF p`,
        [a.patient_id, a.professional_id, body.package_id ?? null],
      )
    ).rows.find((p) => p.usadas < p.sessoes);
    if (!pkg) throw new HTTPException(404, { message: "Não há pacote ativo com saldo para este paciente" });
    await db.query("UPDATE appointments SET package_id = $2 WHERE id = $1", [a.id, pkg.id]);
    await audit(db, s, "package.use", "appointment", a.id);
    return loadPackage(db, pkg.id);
  });
  return c.json(row);
});

/** Devolve a sessão ao pacote (por engano ou mudança de decisão). */
packages.post("/release", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ appointment_id: z.uuid() }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query("UPDATE appointments SET package_id = NULL WHERE id = $1 AND package_id IS NOT NULL RETURNING id", [body.appointment_id]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "Sessão não está em pacote" });
    await audit(db, s, "package.release", "appointment", r.rows[0].id);
    return { ok: true };
  });
  return c.json(row);
});
