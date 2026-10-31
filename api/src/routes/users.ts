import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession, type DbClient, type Session } from "../db";
import { requireAuth, requireRole } from "../middleware";
import { randomToken, sha256Hex } from "../security";
import type { AppEnv } from "../types";
import { emailSchema, nameSchema, optText, readBody, roleSchema } from "../validation";

const COLS = "id, nome, email, role, crp, atende, telefone, status, last_login_at, created_at";

async function createInvite(db: DbClient, s: Session, userId: string, kind: "convite" | "redefinicao", days: number, appUrl: string) {
  await db.query("UPDATE invites SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [userId]);
  const token = randomToken();
  const r = await db.query(
    `INSERT INTO invites (clinic_id, user_id, kind, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING expires_at`,
    [s.clinicId, userId, kind, await sha256Hex(token), days, s.userId],
  );
  await audit(db, s, `invite.${kind}`, "user", userId);
  // O token só existe aqui: no banco fica apenas o hash.
  return { token, link: `${appUrl.replace(/\/$/, "")}/convite/${token}`, expires_at: r.rows[0].expires_at };
}

export const users = new Hono<AppEnv>();
users.use("*", requireAuth, requireRole("admin"));

users.get("/", async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query(`SELECT ${COLS} FROM users ORDER BY nome`)).rows,
  );
  return c.json(rows);
});

// Pré-cadastro: o administrador cria o usuário e recebe um link para entregar à pessoa.
users.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      nome: nameSchema,
      role: roleSchema,
      crp: optText(30),
      atende: z.boolean().optional(),
      telefone: optText(30),
      email: emailSchema.optional(),
      expires_in_days: z.number().int().min(1).max(30).default(7),
    }),
  );
  const atende = body.role === "recepcao" ? false : (body.atende ?? body.role === "psicologo");
  if (atende && !body.crp) throw new HTTPException(422, { message: "Quem atende precisa ter o CRP informado" });

  const result = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `INSERT INTO users (clinic_id, nome, email, role, crp, atende, telefone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'convidado') RETURNING ${COLS}`,
      [s.clinicId, body.nome, body.email ?? null, body.role, body.crp ?? null, atende, body.telefone ?? null],
    );
    const user = r.rows[0];
    await audit(db, s, "user.create", "user", user.id);
    const invite = await createInvite(db, s, user.id, "convite", body.expires_in_days, c.env.APP_URL);
    return { user, invite };
  });
  return c.json(result, 201);
});

users.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      nome: nameSchema,
      role: roleSchema,
      crp: optText(30),
      atende: z.boolean(),
      telefone: optText(30),
      status: z.enum(["ativo", "inativo"]),
    }).partial(),
  );
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HTTPException(400, { message: "Nada para atualizar" });

  const row = await withSession(c.get("pool"), s, async (db) => {
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const r = await db.query(`UPDATE users SET ${sets} WHERE id = $1 RETURNING ${COLS}`, [
      c.req.param("id"),
      ...entries.map(([, v]) => v),
    ]);
    if (r.rows[0]) await audit(db, s, "user.update", "user", r.rows[0].id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Usuário não encontrado" });
  return c.json(row);
});

// Novo link de convite (se ainda não aceitou) ou de redefinição de senha. Invalida os anteriores.
users.post("/:id/invite", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ expires_in_days: z.number().int().min(1).max(30).default(7) }));
  const invite = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query("SELECT id, status FROM users WHERE id = $1", [c.req.param("id")]);
    const user = r.rows[0];
    if (!user) throw new HTTPException(404, { message: "Usuário não encontrado" });
    if (user.status === "inativo") throw new HTTPException(422, { message: "Reative o usuário antes de gerar o link" });
    return createInvite(db, s, user.id, user.status === "convidado" ? "convite" : "redefinicao", body.expires_in_days, c.env.APP_URL);
  });
  return c.json(invite, 201);
});

// Lista de profissionais que atendem (para selecionar responsável ou agenda): qualquer usuário logado.
export const professionals = new Hono<AppEnv>();
professionals.use("*", requireAuth);
professionals.get("/", async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query("SELECT id, nome, crp FROM users WHERE atende AND status <> 'inativo' ORDER BY nome")).rows,
  );
  return c.json(rows);
});
