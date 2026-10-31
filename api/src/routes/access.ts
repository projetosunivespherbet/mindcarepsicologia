import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign } from "hono/jwt";
import { z } from "zod";
import { withDb, withSession } from "../db";
import { rateLimit, requireAuth } from "../middleware";
import { hashPassword, safeEqualStrings, sha256Hex, verifyPassword, verifyTurnstile } from "../security";
import type { AppEnv, Env } from "../types";
import { emailSchema, nameSchema, passwordSchema, readBody } from "../validation";

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const scryptN = (env: Env) => Number(env.SCRYPT_N ?? 16384);

// Hash fixo para igualar o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | undefined;

async function issueToken(env: Env, userId: string) {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, env.JWT_SECRET, "HS256");
}

export const access = new Hono<AppEnv>();

// Operador da plataforma cria uma clínica e o primeiro administrador (não depende de e-mail).
access.post("/platform/clinics", async (c) => {
  if (!c.env.SETUP_TOKEN) throw new HTTPException(404, { message: "Não encontrado" });
  const provided = c.req.header("x-setup-token") ?? "";
  if (!(await safeEqualStrings(provided, c.env.SETUP_TOKEN))) throw new HTTPException(403, { message: "Sem permissão" });

  const body = await readBody(
    c,
    z.object({ clinic_nome: nameSchema, admin_nome: nameSchema, email: emailSchema, password: passwordSchema }),
  );
  const hash = await hashPassword(body.password, scryptN(c.env));
  const clinicId = await withDb(c.get("pool"), async (db) => {
    const r = await db.query("SELECT app_create_clinic($1, $2, $3, $4) AS id", [
      body.clinic_nome,
      body.admin_nome,
      body.email,
      hash,
    ]);
    return r.rows[0].id as string;
  });
  return c.json({ clinic_id: clinicId }, 201);
});

access.post("/auth/login", async (c) => {
  await rateLimit(c, "login", 10);
  const body = await readBody(
    c,
    z.object({ email: emailSchema, password: z.string().min(1).max(128), turnstile: z.string().optional() }),
  );
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstile, c.req.header("CF-Connecting-IP")))) {
    throw new HTTPException(400, { message: "Falha na verificação anti-robô" });
  }

  const pool = c.get("pool");
  const user = await withDb(pool, async (db) => (await db.query("SELECT * FROM app_login_lookup($1)", [body.email])).rows[0]);

  const generic = new HTTPException(401, { message: "E-mail ou senha incorretos, ou conta temporariamente bloqueada" });
  if (!user) {
    dummyHash ??= hashPassword("senha-ficticia", scryptN(c.env));
    await verifyPassword(body.password, await dummyHash);
    throw generic;
  }
  const locked = user.locked_until && new Date(user.locked_until) > new Date();
  const ok = !locked && user.status === "ativo" && (await verifyPassword(body.password, user.password_hash));
  if (!locked) await withDb(pool, (db) => db.query("SELECT app_login_register($1, $2)", [user.id, ok]));
  if (!ok) throw generic;

  return c.json({
    token: await issueToken(c.env, user.id),
    user: { id: user.id, nome: user.nome, role: user.role, atende: user.atende, clinic_id: user.clinic_id },
  });
});

// Página de aceite do convite: mostra só o necessário para quem recebeu o link.
access.get("/invites/:token", async (c) => {
  await rateLimit(c, "invite-peek", 30);
  const hash = await sha256Hex(c.req.param("token"));
  const row = await withDb(c.get("pool"), async (db) => (await db.query("SELECT * FROM app_invite_peek($1)", [hash])).rows[0]);
  if (!row) throw new HTTPException(404, { message: "Convite inválido ou expirado" });
  return c.json({
    kind: row.kind,
    nome: row.nome,
    role: row.role,
    email: row.email,
    clinic_nome: row.clinic_nome,
    expires_at: row.expires_at,
  });
});

access.post("/invites/accept", async (c) => {
  await rateLimit(c, "invite-accept", 10);
  const body = await readBody(
    c,
    z.object({
      token: z.string().min(20).max(100),
      email: emailSchema.optional(),
      password: passwordSchema,
      turnstile: z.string().optional(),
    }),
  );
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstile, c.req.header("CF-Connecting-IP")))) {
    throw new HTTPException(400, { message: "Falha na verificação anti-robô" });
  }
  const tokenHash = await sha256Hex(body.token);
  const passwordHash = await hashPassword(body.password, scryptN(c.env));
  const userId = await withDb(c.get("pool"), async (db) => {
    const r = await db.query("SELECT app_invite_accept($1, $2, $3) AS id", [tokenHash, body.email ?? null, passwordHash]);
    return r.rows[0].id as string;
  });
  return c.json({ token: await issueToken(c.env, userId) });
});

access.get("/me", requireAuth, async (c) => {
  const s = c.get("session");
  const me = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `SELECT u.id, u.nome, u.email, u.role, u.crp, u.atende, u.telefone, c.nome AS clinic_nome, c.timezone
       FROM users u JOIN clinics c ON c.id = u.clinic_id WHERE u.id = $1`,
      [s.userId],
    );
    return r.rows[0];
  });
  return c.json(me);
});

access.post("/auth/change-password", requireAuth, async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ current_password: z.string().min(1).max(128), new_password: passwordSchema }));
  const newHash = await hashPassword(body.new_password, scryptN(c.env));
  await withSession(c.get("pool"), s, async (db) => {
    const cur = (await db.query("SELECT app_get_password_hash($1) AS h", [s.userId])).rows[0]?.h;
    if (!(await verifyPassword(body.current_password, cur))) {
      throw new HTTPException(400, { message: "Senha atual incorreta" });
    }
    await db.query("SELECT app_set_password($1, $2)", [s.userId, newHash]);
  });
  return c.json({ ok: true });
});
