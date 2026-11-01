import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession } from "../db";
import { requireAuth, requireRole } from "../middleware";
import type { AppEnv } from "../types";
import { cnpjSchema, cpfSchema, emailSchema, nameSchema, optText, readBody } from "../validation";
import { setClause } from "./finance";

const COLS = "id, nome, timezone, documento_tipo, documento, razao_social, telefone, email, endereco, encarregado_nome, encarregado_email, updated_at";

export const clinic = new Hono<AppEnv>();
clinic.use("*", requireAuth, requireRole("admin"));

const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());
const bad = (message: string) => new HTTPException(400, { message });

clinic.get("/", async (c) => {
  const row = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query(`SELECT ${COLS} FROM clinics WHERE id = $1`, [c.get("session").clinicId])).rows[0],
  );
  if (!row) throw new HTTPException(404, { message: "Clínica não encontrada" });
  return c.json(row);
});

clinic.patch("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z
      .object({
        nome: nameSchema,
        timezone: z.string().trim().max(60),
        documento_tipo: z.enum(["cpf", "cnpj"]).nullable(),
        documento: z.string().max(30).nullable(),
        razao_social: optText(160),
        telefone: optText(30),
        email: optText(160),
        endereco: optText(300),
        encarregado_nome: optText(160),
        encarregado_email: optText(160),
      })
      .partial(),
  );

  const fields: Record<string, unknown> = {};
  if (body.nome !== undefined) fields.nome = body.nome;

  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: body.timezone });
    } catch {
      throw bad("Fuso horário inválido (exemplo: America/Sao_Paulo)");
    }
    fields.timezone = body.timezone;
  }

  // CPF/CNPJ: tipo e número andam juntos (ambos preenchidos ou ambos vazios); o número é guardado sem máscara.
  if (body.documento_tipo !== undefined || body.documento !== undefined) {
    if (body.documento_tipo === undefined || body.documento === undefined) {
      throw bad("Envie o tipo e o número do documento juntos");
    }
    const numero = blank(body.documento);
    if ((body.documento_tipo === null) !== (numero === null)) {
      throw bad("Informe o tipo (CPF ou CNPJ) e o número, ou deixe os dois vazios");
    }
    if (body.documento_tipo === null || numero === null) {
      fields.documento_tipo = null;
      fields.documento = null;
    } else {
      const parsed = (body.documento_tipo === "cpf" ? cpfSchema : cnpjSchema).safeParse(numero);
      if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? "Documento inválido");
      fields.documento_tipo = body.documento_tipo;
      fields.documento = parsed.data;
    }
  }

  if (body.razao_social !== undefined) {
    const v = blank(body.razao_social);
    if (v !== null && v.length < 2) throw bad("Razão social muito curta");
    fields.razao_social = v;
  }
  if (body.email !== undefined) {
    const v = blank(body.email);
    if (v !== null && !emailSchema.safeParse(v).success) throw bad("E-mail inválido");
    fields.email = v?.toLowerCase() ?? null;
  }
  if (body.telefone !== undefined) fields.telefone = blank(body.telefone);
  if (body.endereco !== undefined) fields.endereco = blank(body.endereco);
  if (body.encarregado_nome !== undefined) {
    const v = blank(body.encarregado_nome);
    if (v !== null && v.length < 2) throw bad("Nome do encarregado muito curto");
    fields.encarregado_nome = v;
  }
  if (body.encarregado_email !== undefined) {
    const v = blank(body.encarregado_email);
    if (v !== null && !emailSchema.safeParse(v).success) throw bad("E-mail do encarregado inválido");
    fields.encarregado_email = v?.toLowerCase() ?? null;
  }

  const { sets, values } = setClause(fields, ["nome", "timezone", "documento_tipo", "documento", "razao_social", "telefone", "email", "endereco", "encarregado_nome", "encarregado_email"], 2);
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(`UPDATE clinics SET ${sets} WHERE id = $1 RETURNING ${COLS}`, [s.clinicId, ...values]);
    if (r.rows[0]) await audit(db, s, "clinic.update", "clinic", r.rows[0].id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Clínica não encontrada" });
  return c.json(row);
});
