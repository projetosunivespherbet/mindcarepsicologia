import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verify } from "hono/jwt";
import { withDb, type Role } from "./db";
import type { Context } from "hono";
import type { AppEnv } from "./types";

/** Valida o JWT e relê papel e status no banco: desativar ou rebaixar alguém vale na hora. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HTTPException(401, { message: "Não autenticado" });

  let sub: string;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    sub = String(payload.sub);
  } catch {
    throw new HTTPException(401, { message: "Sessão inválida ou expirada" });
  }

  const row = await withDb(c.get("pool"), async (db) => {
    const r = await db.query("SELECT * FROM app_session_check($1)", [sub]);
    return r.rows[0];
  });
  if (!row || row.status !== "ativo") throw new HTTPException(401, { message: "Sessão inválida ou expirada" });

  c.set("session", { userId: sub, clinicId: row.clinic_id, role: row.role, atende: row.atende });
  await next();
});

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.get("session").role)) throw new HTTPException(403, { message: "Sem permissão" });
    await next();
  });

/** Limita tentativas por IP (cabeçalho CF-Connecting-IP, presente no Workers). Sem o cabeçalho, não limita. */
export async function rateLimit(c: Context<AppEnv>, name: string, limit: number, windowSeconds = 60) {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip) return;
  const ok = await withDb(c.get("pool"), async (db) =>
    (await db.query("SELECT app_rate_limit($1, $2, $3) AS ok", [`${name}:${ip}`, limit, windowSeconds])).rows[0].ok as boolean,
  );
  if (!ok) throw new HTTPException(429, { message: "Muitas tentativas. Aguarde um minuto e tente novamente." });
}
