import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth, requireRole } from "../middleware";
import type { AppEnv } from "../types";
import { centsSchema, cpfCnpjSchema, dateOnly, emailSchema, isoDateTime, nameSchema, optText, readBody, readQuery } from "../validation";

const DAY_MS = 24 * 3600 * 1000;
const FORMAS = ["pix", "dinheiro", "cartao", "transferencia", "convenio"] as const;
const METODOS = ["pix", "dinheiro", "cartao", "transferencia", "boleto", "convenio", "outro"] as const;
const STATUS = ["aberta", "parcial", "paga", "cancelada"] as const;

export const notFound = (what: string) => new HTTPException(404, { message: `${what} não encontrado` });

function checkDays(from: string, to: string, maxDays: number) {
  const span = Date.parse(to) - Date.parse(from);
  if (!(span >= 0) || span > maxDays * DAY_MS) {
    throw new HTTPException(400, { message: `Informe um período válido de até ${maxDays} dias` });
  }
}

function checkInstants(from: string, to: string, maxDays: number) {
  const span = Date.parse(to) - Date.parse(from);
  if (!(span > 0) || span > maxDays * DAY_MS) {
    throw new HTTPException(400, { message: `Informe um período válido de até ${maxDays} dias` });
  }
}

/** Monta "campo = $n" só para os campos presentes no corpo. */
export function setClause(body: Record<string, unknown>, allowed: string[], firstParam: number) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    values.push(body[key]);
    sets.push(`${key} = $${firstParam + values.length - 1}`);
  }
  if (sets.length === 0) throw new HTTPException(400, { message: "Nenhum campo para alterar" });
  return { sets: sets.join(", "), values };
}

async function assertProfessional(db: DbClient, id: string) {
  const r = await db.query("SELECT 1 FROM users WHERE id = $1 AND atende AND status <> 'inativo'", [id]);
  if (r.rows.length === 0) throw new HTTPException(422, { message: "O psicólogo informado não atende nesta clínica" });
}

export async function clinicToday(db: DbClient, clinicId: string): Promise<string> {
  const r = await db.query("SELECT (now() AT TIME ZONE timezone)::date::text AS hoje FROM clinics WHERE id = $1", [clinicId]);
  return r.rows[0].hoje as string;
}

// ================================================================ serviços (catálogo)

const SERVICE_COLS = "id, nome, valor_centavos, duracao_min, professional_id, ativo, created_at, updated_at";
const serviceName = z.string().trim().min(2, "Nome muito curto").max(80);

export const services = new Hono<AppEnv>();
services.use("*", requireAuth);

services.get("/", async (c) => {
  const q = readQuery(c, z.object({ ativo: z.enum(["true", "false"]).optional(), professional_id: z.uuid().optional() }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${SERVICE_COLS} FROM services
          WHERE ($1::boolean IS NULL OR ativo = $1::boolean)
            AND ($2::uuid IS NULL OR professional_id = $2 OR professional_id IS NULL)
          ORDER BY nome LIMIT 500`,
        [q.ativo ?? null, q.professional_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

services.post("/", async (c) => {
  const s = c.get("session");
  if (s.role === "recepcao") throw new HTTPException(403, { message: "Sem permissão" });
  const body = await readBody(
    c,
    z.object({
      nome: serviceName,
      valor_centavos: centsSchema,
      duracao_min: z.number().int().min(10).max(480).optional().nullable(),
      professional_id: z.uuid().optional().nullable(),
    }),
  );
  // Psicólogo só define preço para si; a administração pode criar um serviço geral (sem profissional).
  const professionalId = s.role === "psicologo" ? s.userId : (body.professional_id ?? null);
  const row = await withSession(c.get("pool"), s, async (db) => {
    if (professionalId) await assertProfessional(db, professionalId);
    const r = await db.query(
      `INSERT INTO services (clinic_id, nome, valor_centavos, duracao_min, professional_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${SERVICE_COLS}`,
      [s.clinicId, body.nome, body.valor_centavos, body.duracao_min ?? null, professionalId],
    );
    await audit(db, s, "service.create", "service", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

services.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ nome: serviceName, valor_centavos: centsSchema, duracao_min: z.number().int().min(10).max(480).nullable(), ativo: z.boolean() }).partial(),
  );
  const { sets, values } = setClause(body, ["nome", "valor_centavos", "duracao_min", "ativo"], 2);
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(`UPDATE services SET ${sets} WHERE id = $1 RETURNING ${SERVICE_COLS}`, [c.req.param("id"), ...values]);
    if (!r.rows[0]) throw notFound("Serviço");
    await audit(db, s, "service.update", "service", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row);
});

// ================================================================ responsáveis financeiros

const PAYER_COLS = "id, nome, cpf_cnpj, email, telefone, vinculo, ativo, created_at, updated_at";
const payerFields = {
  nome: nameSchema,
  cpf_cnpj: cpfCnpjSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  telefone: optText(30),
  vinculo: optText(60),
};

export const payers = new Hono<AppEnv>();
payers.use("*", requireAuth);

payers.get("/", async (c) => {
  const q = readQuery(c, z.object({ q: z.string().trim().max(100).optional(), ativo: z.enum(["true", "false"]).optional() }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${PAYER_COLS} FROM payers
          WHERE ($1::text IS NULL OR nome ILIKE '%' || $1 || '%')
            AND ($2::boolean IS NULL OR ativo = $2::boolean)
          ORDER BY nome LIMIT 500`,
        [q.q ?? null, q.ativo ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

payers.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object(payerFields));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `INSERT INTO payers (clinic_id, nome, cpf_cnpj, email, telefone, vinculo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PAYER_COLS}`,
      [s.clinicId, body.nome, body.cpf_cnpj ?? null, body.email ?? null, body.telefone ?? null, body.vinculo ?? null, s.userId],
    );
    await audit(db, s, "payer.create", "payer", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

payers.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ ...payerFields, ativo: z.boolean() }).partial());
  const { sets, values } = setClause(body, ["nome", "cpf_cnpj", "email", "telefone", "vinculo", "ativo"], 2);
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(`UPDATE payers SET ${sets} WHERE id = $1 RETURNING ${PAYER_COLS}`, [c.req.param("id"), ...values]);
    if (!r.rows[0]) throw notFound("Responsável");
    await audit(db, s, "payer.update", "payer", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row);
});

// ================================================================ cobranças

const CHARGE_COLS = `c.id, c.patient_id, p.nome AS paciente_nome, c.professional_id, u.nome AS profissional_nome,
  c.payer_id, c.appointment_id, c.descricao, c.competencia::text AS competencia,
  c.valor_centavos, c.desconto_centavos, c.liquido_centavos, c.paid_centavos,
  (c.liquido_centavos - c.paid_centavos) AS saldo_centavos,
  c.vencimento::text AS vencimento, c.forma_prevista, c.convenio, c.imposto_recolhido,
  c.status, c.origem, c.cancel_reason, c.cancelled_at, c.created_at, c.updated_at,
  (c.vencimento IS NOT NULL AND c.vencimento < (now() AT TIME ZONE cl.timezone)::date AND c.status IN ('aberta', 'parcial')) AS atrasada,
  (SELECT d.status FROM fiscal_document_charges l JOIN fiscal_documents d ON d.id = l.document_id
    WHERE l.charge_id = c.id AND l.ativo LIMIT 1) AS nota_status`;
const CHARGE_FROM = `FROM charges c
  JOIN clinics cl ON cl.id = c.clinic_id
  LEFT JOIN patients p ON p.id = c.patient_id
  LEFT JOIN users u ON u.id = c.professional_id`;

async function loadCharge(db: DbClient, id: string) {
  const r = await db.query(`SELECT ${CHARGE_COLS} ${CHARGE_FROM} WHERE c.id = $1`, [id]);
  if (!r.rows[0]) throw notFound("Cobrança");
  return r.rows[0];
}

const PAYMENT_COLS = `pg.id, pg.charge_id, pg.valor_centavos, pg.metodo, pg.pago_em::text AS pago_em, pg.observacao,
  pg.recebido_por, pg.registrado_por, pg.reverses_id, pg.motivo_estorno, pg.created_at,
  EXISTS (SELECT 1 FROM payments r WHERE r.reverses_id = pg.id) AS estornado`;

export const charges = new Hono<AppEnv>();
charges.use("*", requireAuth);

charges.get("/", async (c) => {
  const q = readQuery(
    c,
    z.object({
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      status: z.enum(STATUS).optional(),
      patient_id: z.uuid().optional(),
      professional_id: z.uuid().optional(),
    }),
  );
  // Sem paciente, o período é obrigatório (até 93 dias). Com paciente, vale o histórico inteiro.
  if (!q.patient_id && !(q.from && q.to)) throw new HTTPException(400, { message: "Informe o período (from e to) ou um paciente" });
  if (!!q.from !== !!q.to) throw new HTTPException(400, { message: "Informe from e to juntos" });
  if (q.from && q.to) checkDays(q.from, q.to, 93);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${CHARGE_COLS} ${CHARGE_FROM}
          WHERE ($1::date IS NULL OR c.competencia >= date_trunc('month', $1::date)::date)
            AND ($2::date IS NULL OR c.competencia <= $2::date)
            AND ($3::text IS NULL OR c.status = $3) AND ($4::uuid IS NULL OR c.patient_id = $4)
            AND ($5::uuid IS NULL OR c.professional_id = $5)
          ORDER BY c.competencia DESC, c.created_at DESC LIMIT 500`,
        [q.from ?? null, q.to ?? null, q.status ?? null, q.patient_id ?? null, q.professional_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

charges.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      patient_id: z.uuid(),
      professional_id: z.uuid().optional(),
      appointment_id: z.uuid().optional(),
      payer_id: z.uuid().optional().nullable(),
      service_id: z.uuid().optional(),
      descricao: z.string().trim().min(2).max(200).optional(),
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato AAAA-MM").optional(),
      valor_centavos: centsSchema.optional(),
      desconto_centavos: z.number().int().min(0).max(10_000_000).default(0),
      vencimento: dateOnly.optional().nullable(),
      forma_prevista: z.enum(FORMAS).optional().nullable(),
      convenio: z.boolean().optional(),
      imposto_recolhido: z.boolean().optional(),
    }),
  );
  const row = await withSession(c.get("pool"), s, async (db) => {
    const patient = (await db.query("SELECT id, professional_id FROM patients WHERE id = $1", [body.patient_id])).rows[0];
    if (!patient) throw notFound("Paciente");
    const tz = (await db.query("SELECT timezone, (now() AT TIME ZONE timezone)::date::text AS hoje FROM clinics WHERE id = $1", [s.clinicId])).rows[0];

    let professionalId: string | null = s.role === "psicologo" ? s.userId : (body.professional_id ?? null);
    type Appt = { patient_id: string; professional_id: string; status: string; atendimento: string; valor_centavos: number | null; competencia: string; convenio: boolean; imposto: boolean };
    let appt: Appt | undefined;
    if (body.appointment_id) {
      appt = (
        await db.query(
          `SELECT a.patient_id, a.professional_id, a.status, a.atendimento, NULLIF(round(a.valor * 100)::int, 0) AS valor_centavos,
                  to_char(date_trunc('month', a.starts_at AT TIME ZONE $2), 'YYYY-MM-DD') AS competencia, a.convenio, a.imposto
             FROM appointments a WHERE a.id = $1`,
          [body.appointment_id, tz.timezone],
        )
      ).rows[0] as Appt | undefined;
      if (!appt) throw notFound("Sessão");
      if (appt.patient_id !== body.patient_id) throw new HTTPException(422, { message: "A sessão não pertence a este paciente" });
      if (appt.status === "cancelado") throw new HTTPException(422, { message: "Sessão cancelada não gera cobrança" });
      if (appt.atendimento === "pro_bono") throw new HTTPException(422, { message: "Atendimento pro bono não gera cobrança" });
      professionalId = appt.professional_id;
    }
    professionalId ??= patient.professional_id ?? null;
    if (!professionalId) throw new HTTPException(422, { message: "Informe o psicólogo responsável" });
    await assertProfessional(db, professionalId);

    let valor = body.valor_centavos ?? null;
    if (valor === null && body.service_id) {
      const sv = (await db.query("SELECT valor_centavos FROM services WHERE id = $1 AND ativo", [body.service_id])).rows[0];
      if (!sv) throw new HTTPException(422, { message: "Serviço não encontrado ou inativo" });
      valor = sv.valor_centavos;
    }
    valor ??= appt?.valor_centavos ?? null;
    if (valor === null) {
      // sem valor na sessão, vale o preço do catálogo (o do profissional tem prioridade sobre o geral)
      const sv = (
        await db.query(
          "SELECT valor_centavos FROM services WHERE ativo AND (professional_id = $1 OR professional_id IS NULL) ORDER BY professional_id NULLS LAST, created_at LIMIT 1",
          [professionalId],
        )
      ).rows[0];
      valor = sv?.valor_centavos ?? null;
    }
    if (valor === null) throw new HTTPException(422, { message: "Informe o valor, um serviço do catálogo ou uma sessão com valor" });
    if (body.desconto_centavos >= valor) throw new HTTPException(422, { message: "O desconto deve ser menor que o valor" });

    if (body.payer_id) {
      const py = await db.query("SELECT 1 FROM payers WHERE id = $1 AND ativo", [body.payer_id]);
      if (py.rows.length === 0) throw new HTTPException(422, { message: "Responsável financeiro não encontrado ou inativo" });
    }

    const competencia = body.competencia ? `${body.competencia}-01` : (appt?.competencia ?? `${String(tz.hoje).slice(0, 7)}-01`);
    const ins = await db.query(
      `INSERT INTO charges (clinic_id, patient_id, professional_id, payer_id, appointment_id, descricao, competencia,
                            valor_centavos, desconto_centavos, vencimento, forma_prevista, convenio, imposto_recolhido, origem, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Atendimento psicológico'), $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [s.clinicId, body.patient_id, professionalId, body.payer_id ?? null, body.appointment_id ?? null, body.descricao ?? null,
       competencia, valor, body.desconto_centavos, body.vencimento ?? null, body.forma_prevista ?? null,
       body.convenio ?? appt?.convenio ?? false, body.imposto_recolhido ?? appt?.imposto ?? false,
       body.appointment_id ? "sessao" : "manual", s.userId],
    );
    await audit(db, s, "charge.create", "charge", ins.rows[0].id);
    return loadCharge(db, ins.rows[0].id);
  });
  return c.json(row, 201);
});

// Gera, em lote, as cobranças das sessões realizadas (e, se pedido, das faltas) que ainda não têm cobrança.
charges.post("/generate", requireRole("admin", "recepcao"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ from: isoDateTime, to: isoDateTime, professional_id: z.uuid().optional(), incluir_faltas: z.boolean().default(false) }),
  );
  checkInstants(body.from, body.to, 93);
  const result = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `WITH cand AS (
         SELECT a.id, a.patient_id, a.professional_id, a.convenio, a.imposto, a.starts_at,
                date_trunc('month', a.starts_at AT TIME ZONE cl.timezone)::date AS competencia,
                COALESCE(
                  NULLIF(round(a.valor * 100)::int, 0),
                  (SELECT sv.valor_centavos FROM services sv
                    WHERE sv.ativo AND (sv.professional_id = a.professional_id OR sv.professional_id IS NULL)
                    ORDER BY sv.professional_id NULLS LAST, sv.created_at LIMIT 1)
                ) AS valor_centavos
           FROM appointments a JOIN clinics cl ON cl.id = a.clinic_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2
            AND a.atendimento <> 'pro_bono' AND (a.status = 'realizado' OR ($3::boolean AND a.status = 'faltou'))
            AND ($4::uuid IS NULL OR a.professional_id = $4)
            AND NOT EXISTS (SELECT 1 FROM charges ch WHERE ch.appointment_id = a.id AND ch.status <> 'cancelada')
       ), ins AS (
         INSERT INTO charges (clinic_id, patient_id, professional_id, appointment_id, competencia, valor_centavos,
                              convenio, imposto_recolhido, origem, created_by)
         SELECT $5::uuid, patient_id, professional_id, id, competencia, valor_centavos, convenio, imposto, 'sessao', $6::uuid
           FROM cand WHERE valor_centavos IS NOT NULL
         ON CONFLICT DO NOTHING
         RETURNING id
       )
       SELECT (SELECT count(*) FROM ins)::int AS criadas, (SELECT count(*) FROM cand WHERE valor_centavos IS NULL)::int AS sem_valor`,
      [body.from, body.to, body.incluir_faltas, body.professional_id ?? null, s.clinicId, s.userId],
    );
    await audit(db, s, "charge.generate", "charge", null);
    return r.rows[0];
  });
  return c.json(result);
});

charges.get("/:id", async (c) => {
  const out = await withSession(c.get("pool"), c.get("session"), async (db) => {
    const charge = await loadCharge(db, c.req.param("id"));
    const pagamentos = (
      await db.query(`SELECT ${PAYMENT_COLS} FROM payments pg WHERE pg.charge_id = $1 ORDER BY pg.created_at, pg.id`, [charge.id])
    ).rows;
    return { ...charge, pagamentos };
  });
  return c.json(out);
});

charges.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z
      .object({
        descricao: z.string().trim().min(2).max(200),
        desconto_centavos: z.number().int().min(0).max(10_000_000),
        vencimento: dateOnly.nullable(),
        forma_prevista: z.enum(FORMAS).nullable(),
        convenio: z.boolean(),
        imposto_recolhido: z.boolean(),
        payer_id: z.uuid().nullable(),
      })
      .partial(),
  );
  const { sets, values } = setClause(body, ["descricao", "desconto_centavos", "vencimento", "forma_prevista", "convenio", "imposto_recolhido", "payer_id"], 2);
  const row = await withSession(c.get("pool"), s, async (db) => {
    if (body.payer_id) {
      const py = await db.query("SELECT 1 FROM payers WHERE id = $1 AND ativo", [body.payer_id]);
      if (py.rows.length === 0) throw new HTTPException(422, { message: "Responsável financeiro não encontrado ou inativo" });
    }
    const r = await db.query(`UPDATE charges SET ${sets} WHERE id = $1 RETURNING id`, [c.req.param("id"), ...values]);
    if (!r.rows[0]) throw notFound("Cobrança");
    await audit(db, s, "charge.update", "charge", r.rows[0].id);
    return loadCharge(db, r.rows[0].id);
  });
  return c.json(row);
});

charges.post("/:id/cancel", requireRole("admin", "recepcao", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ motivo: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres)").max(300) }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query("UPDATE charges SET status = 'cancelada', cancel_reason = $2 WHERE id = $1 RETURNING id", [c.req.param("id"), body.motivo]);
    if (!r.rows[0]) throw notFound("Cobrança");
    await audit(db, s, "charge.cancel", "charge", r.rows[0].id);
    return loadCharge(db, r.rows[0].id);
  });
  return c.json(row);
});

charges.post("/:id/payments", async (c) => {
  const s = c.get("session");
  const key = c.req.header("Idempotency-Key") ?? "";
  if (key.length < 8 || key.length > 100) {
    throw new HTTPException(400, { message: "Envie o cabeçalho Idempotency-Key (8 a 100 caracteres)" });
  }
  const body = await readBody(
    c,
    z.object({
      valor_centavos: centsSchema,
      metodo: z.enum(METODOS),
      pago_em: dateOnly.optional(),
      observacao: optText(300),
      recebido_por: z.enum(["profissional", "clinica"]).default("profissional"),
    }),
  );
  const chargeId = c.req.param("id");
  const out = await withSession(c.get("pool"), s, async (db) => {
    await loadCharge(db, chargeId); // 404 se a cobrança não existe ou não é visível para este perfil

    const prev = (await db.query(`SELECT ${PAYMENT_COLS} FROM payments pg WHERE pg.idempotency_key = $1`, [key])).rows[0];
    if (prev) {
      if (prev.charge_id !== chargeId || prev.valor_centavos !== body.valor_centavos) {
        throw new HTTPException(409, { message: "Esta Idempotency-Key já foi usada em outra operação" });
      }
      return { status: 200 as const, payment: prev, charge: await loadCharge(db, chargeId) };
    }

    const hoje = await clinicToday(db, s.clinicId);
    if (body.pago_em && body.pago_em > hoje) throw new HTTPException(422, { message: "A data do pagamento não pode ser futura" });
    const ins = await db.query(
      `INSERT INTO payments (clinic_id, charge_id, valor_centavos, metodo, pago_em, observacao, recebido_por, registrado_por, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [s.clinicId, chargeId, body.valor_centavos, body.metodo, body.pago_em ?? hoje, body.observacao ?? null, body.recebido_por, s.userId, key],
    );
    await audit(db, s, "payment.create", "payment", ins.rows[0].id);
    const payment = (await db.query(`SELECT ${PAYMENT_COLS} FROM payments pg WHERE pg.id = $1`, [ins.rows[0].id])).rows[0];
    return { status: 201 as const, payment, charge: await loadCharge(db, chargeId) };
  });
  return c.json({ payment: out.payment, charge: out.charge }, out.status);
});

// ================================================================ pagamentos (estorno)

export const payments = new Hono<AppEnv>();
payments.use("*", requireAuth);

payments.post("/:id/reverse", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ motivo: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres)").max(300) }));
  const out = await withSession(c.get("pool"), s, async (db) => {
    const orig = (await db.query("SELECT id, charge_id, valor_centavos, metodo, recebido_por, reverses_id FROM payments WHERE id = $1", [c.req.param("id")])).rows[0];
    if (!orig) throw notFound("Pagamento");
    if (orig.reverses_id) throw new HTTPException(422, { message: "Um estorno não pode ser estornado" });
    const hoje = await clinicToday(db, s.clinicId);
    const ins = await db.query(
      `INSERT INTO payments (clinic_id, charge_id, valor_centavos, metodo, pago_em, recebido_por, registrado_por, reverses_id, motivo_estorno)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [s.clinicId, orig.charge_id, orig.valor_centavos, orig.metodo, hoje, orig.recebido_por, s.userId, orig.id, body.motivo],
    );
    await audit(db, s, "payment.reverse", "payment", ins.rows[0].id);
    const payment = (await db.query(`SELECT ${PAYMENT_COLS} FROM payments pg WHERE pg.id = $1`, [ins.rows[0].id])).rows[0];
    return { payment, charge: await loadCharge(db, orig.charge_id) };
  });
  return c.json(out, 201);
});

// ================================================================ relatórios

const NET_PAYMENT = "CASE WHEN pg.reverses_id IS NULL THEN pg.valor_centavos ELSE -pg.valor_centavos END";

export const finance = new Hono<AppEnv>();
finance.use("*", requireAuth);

// Faturado e recebido no período; em aberto e atrasado são o saldo atual. Cada perfil só enxerga o que a RLS permite.
finance.get("/summary", async (c) => {
  const q = readQuery(c, z.object({ from: dateOnly, to: dateOnly }));
  checkDays(q.from, q.to, 366);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `WITH hoje AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM clinics WHERE id = app_clinic())
         SELECT u.id AS professional_id, u.nome,
           COALESCE((SELECT sum(ch.liquido_centavos) FROM charges ch
                      WHERE ch.professional_id = u.id AND ch.status <> 'cancelada'
                        AND ch.competencia >= date_trunc('month', $1::date)::date AND ch.competencia <= $2::date), 0)::float8 AS faturado_centavos,
           COALESCE((SELECT sum(${NET_PAYMENT}) FROM payments pg JOIN charges ch ON ch.id = pg.charge_id
                      WHERE ch.professional_id = u.id AND pg.pago_em >= $1::date AND pg.pago_em <= $2::date), 0)::float8 AS recebido_centavos,
           COALESCE((SELECT sum(ch.liquido_centavos - ch.paid_centavos) FROM charges ch
                      WHERE ch.professional_id = u.id AND ch.status IN ('aberta', 'parcial')), 0)::float8 AS em_aberto_centavos,
           COALESCE((SELECT sum(ch.liquido_centavos - ch.paid_centavos) FROM charges ch
                      WHERE ch.professional_id = u.id AND ch.status IN ('aberta', 'parcial')
                        AND ch.vencimento < (SELECT d FROM hoje)), 0)::float8 AS atrasado_centavos
           FROM users u WHERE u.atende ORDER BY u.nome`,
        [q.from, q.to],
      )
    ).rows,
  );
  const por_profissional = rows.filter((r: any) => r.faturado_centavos || r.recebido_centavos || r.em_aberto_centavos);
  const total = (k: string) => por_profissional.reduce((acc: number, r: any) => acc + r[k], 0);
  return c.json({
    periodo: { from: q.from, to: q.to },
    faturado_centavos: total("faturado_centavos"),
    recebido_centavos: total("recebido_centavos"),
    em_aberto_centavos: total("em_aberto_centavos"),
    atrasado_centavos: total("atrasado_centavos"),
    por_profissional,
  });
});

// Cobranças ainda sem nota fiscal (convênio fica de fora: a nota, se houver, é para a operadora).
finance.get("/pending-invoices", async (c) => {
  const itens = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${CHARGE_COLS} ${CHARGE_FROM}
          WHERE c.status <> 'cancelada' AND NOT c.convenio
            AND NOT EXISTS (SELECT 1 FROM fiscal_document_charges l JOIN fiscal_documents d ON d.id = l.document_id
                             WHERE l.charge_id = c.id AND l.ativo)
          ORDER BY c.competencia, c.created_at LIMIT 500`,
      )
    ).rows,
  );
  return c.json({ total_centavos: itens.reduce((n: number, r: any) => n + r.liquido_centavos, 0), itens });
});

// Inadimplência por idade do vencimento.
finance.get("/receivables", requireRole("admin", "recepcao"), async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${CHARGE_COLS},
                CASE WHEN c.vencimento IS NULL THEN NULL ELSE ((now() AT TIME ZONE cl.timezone)::date - c.vencimento) END AS dias_atraso
           ${CHARGE_FROM}
          WHERE c.status IN ('aberta', 'parcial')
          ORDER BY c.vencimento NULLS LAST, c.created_at LIMIT 500`,
      )
    ).rows,
  );
  const faixa = (dias: number | null) => (dias === null ? "sem_vencimento" : dias <= 0 ? "a_vencer" : dias <= 30 ? "ate_30" : dias <= 60 ? "de_31_a_60" : "mais_de_60");
  const totais: Record<string, number> = { a_vencer: 0, sem_vencimento: 0, ate_30: 0, de_31_a_60: 0, mais_de_60: 0 };
  const itens = rows.map((r: any) => {
    const f = faixa(r.dias_atraso);
    totais[f]! += r.saldo_centavos;
    return { ...r, faixa: f };
  });
  return c.json({ totais, itens });
});

// Exportação para o contador (CSV com ";" e vírgula decimal, abre direto no Excel).
const csvText = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita execução de fórmula na planilha
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

finance.get("/export", requireRole("admin"), async (c) => {
  const s = c.get("session");
  const q = readQuery(c, z.object({ from: dateOnly, to: dateOnly, format: z.literal("csv").default("csv") }));
  checkDays(q.from, q.to, 366);
  const rows = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `SELECT pg.pago_em::text AS data, CASE WHEN pg.reverses_id IS NULL THEN 'pagamento' ELSE 'estorno' END AS tipo,
              (${NET_PAYMENT}) AS valor_centavos, pg.metodo, pg.recebido_por, to_char(ch.competencia, 'YYYY-MM') AS competencia,
              pt.nome AS paciente, u.nome AS profissional, py.nome AS responsavel, ch.id AS cobranca
         FROM payments pg
         JOIN charges ch ON ch.id = pg.charge_id
         LEFT JOIN patients pt ON pt.id = ch.patient_id
         LEFT JOIN users u ON u.id = ch.professional_id
         LEFT JOIN payers py ON py.id = ch.payer_id
        WHERE pg.pago_em >= $1::date AND pg.pago_em <= $2::date
        ORDER BY pg.pago_em, pg.created_at LIMIT 20000`,
      [q.from, q.to],
    );
    await audit(db, s, "finance.export", "payment", null);
    return r.rows;
  });
  const header = ["data", "tipo", "valor", "metodo", "recebido_por", "competencia", "paciente", "profissional", "responsavel", "cobranca"];
  const lines = rows.map((r: any) =>
    [csvText(r.data), csvText(r.tipo), csvMoney(r.valor_centavos), csvText(r.metodo), csvText(r.recebido_por), csvText(r.competencia),
     csvText(r.paciente), csvText(r.profissional), csvText(r.responsavel), csvText(r.cobranca)].join(";"),
  );
  const csv = `\uFEFF${header.join(";")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="financeiro-${q.from}_${q.to}.csv"`,
    "Cache-Control": "no-store",
  });
});

// ---------------------------------------------------------------- Receita Saúde (arquivo de lote para o Carnê-Leão)
// Layout do Manual do Receita Saúde 2.1 (pergunta 24): CSV com ";", até 1.000 linhas, todos os pagamentos do mesmo ano.
// Cada linha vira um recibo do profissional. Só entram pagamentos recebidos pelo próprio profissional, de pessoa física,
// sem estorno e fora de convênio. O envio ao e-CAC é feito pelo profissional: o MindCare só gera o arquivo.
const RS_MAX_LINHAS = 1000;
const RS_OCUPACAO_PSICOLOGO = "255";
// Colunas "sempre vazias" entre o CPF do beneficiário e o indicador de recibo (S): a tabela do manual lista 4
// (CPF não informado, CNPJ, indicador de IRRF, valor do IRRF), mas a linha de exemplo do manual mostra 3.
// Se a análise do e-CAC reclamar de deslocamento de colunas, ajuste só este número.
const RS_VAZIOS = 4;

/** Uma linha do lote: data;rendimento;ocupação;valor;dedução;descrição;PF;CPF pagador;CPF beneficiário;4 vazios;S;CPF profissional;registro. */
export function receitaSaudeLine(l: { data: string; valor_centavos: number; descricao: string; cpf_pagador: string; cpf_beneficiario: string; cpf_profissional: string; registro: string }) {
  const [y, m, d] = l.data.split("-");
  return [`${d}/${m}/${y}`, "R01.001.001", RS_OCUPACAO_PSICOLOGO, csvMoney(l.valor_centavos), "", l.descricao, "PF", l.cpf_pagador, l.cpf_beneficiario, ...Array<string>(RS_VAZIOS).fill(""), "S", l.cpf_profissional, l.registro].join(";");
}

finance.get("/receita-saude", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const q = readQuery(c, z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o mês como AAAA-MM"), professional_id: z.uuid().optional() }));
  const professionalId = s.role === "psicologo" ? s.userId : q.professional_id;
  if (!professionalId) throw new HTTPException(400, { message: "Escolha o psicólogo" });
  const from = `${q.month}-01`;

  const { prof, rows } = await withSession(c.get("pool"), s, async (db) => {
    const prof = (await db.query("SELECT id, nome, cpf, crp FROM users WHERE id = $1 AND atende", [professionalId])).rows[0];
    if (!prof) throw notFound("Psicólogo");
    const r = await db.query(
      `SELECT pg.id AS payment_id, pg.pago_em::text AS data, pg.valor_centavos, pt.nome AS paciente, pt.cpf AS cpf_paciente,
              py.nome AS pagador, py.cpf_cnpj AS doc_pagador, (ch.payer_id IS NULL) AS pagador_e_paciente, ap.starts_at AS sessao_em,
              to_char(ap.starts_at AT TIME ZONE cl.timezone, 'DD/MM/YY') AS sessao_dia
         FROM payments pg
         JOIN charges ch ON ch.id = pg.charge_id
         JOIN patients pt ON pt.id = ch.patient_id
         JOIN clinics cl ON cl.id = ch.clinic_id
         LEFT JOIN payers py ON py.id = ch.payer_id
         LEFT JOIN appointments ap ON ap.id = ch.appointment_id
        WHERE ch.professional_id = $1
          AND pg.reverses_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reverses_id = pg.id)
          AND pg.recebido_por = 'profissional' AND pg.metodo <> 'convenio' AND NOT ch.convenio
          AND (ap.id IS NULL OR ap.atendimento = 'particular')
          AND pg.pago_em >= $2::date AND pg.pago_em < ($2::date + interval '1 month')
        ORDER BY pg.pago_em, pg.created_at LIMIT 5000`,
      [professionalId, from],
    );
    await audit(db, s, "finance.receita_saude", "payment", null);
    return { prof, rows: r.rows };
  });

  const avisosProf: string[] = [];
  if (!prof.cpf) avisosProf.push("O CPF do psicólogo não está cadastrado (a administração informa em Usuários > Editar)");
  if (prof.crp && String(prof.crp).length > 15) avisosProf.push("O CRP tem mais de 15 caracteres (limite do arquivo)");

  const linhas = rows.map((r: any) => {
    const problemas: string[] = [];
    const cpfPagador = r.pagador_e_paciente ? r.cpf_paciente : r.doc_pagador && String(r.doc_pagador).length === 11 ? r.doc_pagador : null;
    if (!r.cpf_paciente) problemas.push("Paciente sem CPF");
    if (!r.pagador_e_paciente && !r.doc_pagador) problemas.push("Responsável financeiro sem CPF");
    if (!r.pagador_e_paciente && r.doc_pagador && String(r.doc_pagador).length !== 11) problemas.push("Pagador é pessoa jurídica (o recibo é só para pessoa física)");
    const descricao = r.sessao_dia ? `Sessão de psicologia realizada em ${r.sessao_dia}` : "Atendimento psicológico";
    return {
      payment_id: r.payment_id as string,
      data: r.data as string,
      valor_centavos: r.valor_centavos as number,
      paciente: r.paciente as string,
      pagador: (r.pagador_e_paciente ? r.paciente : r.pagador) as string,
      problemas,
      csv: problemas.length || avisosProf.length
        ? null
        : receitaSaudeLine({ data: r.data, valor_centavos: r.valor_centavos, descricao, cpf_pagador: cpfPagador, cpf_beneficiario: r.cpf_paciente, cpf_profissional: prof.cpf, registro: prof.crp ?? "" }),
    };
  });

  const prontas = linhas.filter((l) => l.csv !== null).map((l) => l.csv as string);
  const arquivos = [];
  for (let i = 0; i < prontas.length; i += RS_MAX_LINHAS) {
    const parte = prontas.slice(i, i + RS_MAX_LINHAS);
    arquivos.push({ nome: `receita-saude-${q.month}-parte${arquivos.length + 1}.csv`, linhas: parte.length, csv: `${parte.join("\r\n")}\r\n` });
  }
  return c.json({
    mes: q.month,
    profissional: { id: prof.id, nome: prof.nome, crp: prof.crp, cpf_cadastrado: !!prof.cpf },
    avisos: avisosProf,
    resumo: {
      pagamentos: linhas.length,
      prontos: prontas.length,
      com_pendencia: linhas.length - prontas.length,
      total_centavos: linhas.filter((l) => l.csv !== null).reduce((t, l) => t + l.valor_centavos, 0),
    },
    linhas: linhas.map(({ csv: _csv, ...resto }) => resto),
    arquivos,
  });
});
