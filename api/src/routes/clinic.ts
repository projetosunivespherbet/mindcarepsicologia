import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession } from "../db";
import { requireAuth, requireRole } from "../middleware";
import type { AppEnv } from "../types";
import { cnpjSchema, emailSchema, nameSchema, optText, readBody } from "../validation";

const CLINIC_COLUMNS = `id, nome, timezone, cnpj, razao_social, nome_fantasia, telefone, email, cep, logradouro, numero, bairro, cidade, estado, website, created_at`;

export const clinic = new Hono<AppEnv>();
clinic.use("*", requireAuth);

clinic.get("/", async (c) => {
  const s = c.get("session");
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(`SELECT ${CLINIC_COLUMNS} FROM clinics WHERE id = $1`, [s.clinicId]);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Clínica não encontrada" });
  return c.json(row);
});

clinic.patch("/", requireRole("admin"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z
      .object({
        nome: nameSchema.optional(),
        timezone: z.string().trim().min(2).max(64).optional(),
        cnpj: cnpjSchema.nullable().optional(),
        razao_social: z.string().trim().min(2).max(160).optional().nullable(),
        nome_fantasia: z.string().trim().min(2).max(160).optional().nullable(),
        telefone: optText(30),
        email: emailSchema.optional().nullable(),
        cep: z.string().trim().max(20).optional().nullable(),
        logradouro: z.string().trim().max(160).optional().nullable(),
        numero: z.string().trim().max(30).optional().nullable(),
        bairro: z.string().trim().max(80).optional().nullable(),
        cidade: z.string().trim().max(80).optional().nullable(),
        estado: z.string().trim().regex(/^[A-Z]{2}$/i, "Estado deve ser a sigla com 2 letras").optional().nullable(),
        website: z.string().trim().max(200).optional().nullable(),
      })
      .partial(),
  );

  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HTTPException(400, { message: "Nada para atualizar" });

  const row = await withSession(c.get("pool"), s, async (db) => {
    const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
    const r = await db.query(`UPDATE clinics SET ${sets} WHERE id = $1 RETURNING ${CLINIC_COLUMNS}`, [s.clinicId, ...entries.map(([, value]) => value)]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "Clínica não encontrada" });
    await audit(db, s, "clinic.update", "clinic", s.clinicId);
    return r.rows[0];
  });

  return c.json(row);
});
