import pg from "pg";
import { sign } from "hono/jwt";
import { createApp } from "../src/app";
import type { DbPool } from "../src/db";
import type { Env } from "../src/types";
import { APP_URL_DB, OWNER_URL } from "./env";

export const env: Env = {
  DATABASE_URL: APP_URL_DB,
  JWT_SECRET: "segredo-de-teste-com-tamanho-suficiente-123456",
  SETUP_TOKEN: "setup-token-de-teste",
  APP_URL: "https://app.exemplo.test",
  ALLOWED_ORIGIN: "https://app.exemplo.test",
  SCRYPT_N: "1024", // rápido nos testes; em produção o padrão é 16384
};

export const appPool = new pg.Pool({ connectionString: APP_URL_DB });
export const ownerPool = new pg.Pool({ connectionString: OWNER_URL });
export const app = createApp({ getPool: () => appPool as unknown as DbPool });

export const PASSWORD = "Senha@1234";

export async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
  return { status: res.status, json, res };
}

let counter = 0;
export const uniq = (p: string) => `${p}${Date.now()}${counter++}`;

export async function login(email: string, password = PASSWORD) {
  return call("POST", "/auth/login", { body: { email, password } });
}

/** Cria clínica + administrador pelo operador da plataforma. */
export async function mkClinic() {
  const email = `${uniq("admin")}@clinica.test`;
  const r = await call("POST", "/platform/clinics", {
    headers: { "x-setup-token": env.SETUP_TOKEN! },
    body: { clinic_nome: "Clínica Teste", admin_nome: "Admin Teste", email, password: PASSWORD },
  });
  const l = await login(email);
  return { clinicId: r.json.clinic_id as string, adminEmail: email, adminToken: l.json.token as string, adminId: l.json.user.id as string };
}

/** Pré-cadastro pelo admin + aceite do convite; devolve o token de sessão da pessoa. */
export async function mkUser(adminToken: string, body: Record<string, unknown>) {
  const email = `${uniq("u")}@clinica.test`;
  const created = await call("POST", "/users", { token: adminToken, body });
  const inviteToken = created.json.invite.link.split("/convite/")[1] as string;
  const accepted = await call("POST", "/invites/accept", { body: { token: inviteToken, email, password: PASSWORD } });
  return { id: created.json.user.id as string, email, token: accepted.json.token as string };
}

export const at = (day: number, hhmm: string) => {
  const d = new Date(Date.UTC(2030, 2, 4 + day)); // 04/03/2030 é segunda-feira
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00-03:00`;
};

export async function forgedToken(sub: string, secret: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  return sign({ sub, exp }, secret, "HS256");
}
