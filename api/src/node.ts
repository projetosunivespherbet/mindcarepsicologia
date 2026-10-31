// Servidor local para desenvolvimento e testes de navegador: a mesma API, em Node, com qualquer Postgres.
// Uso: DATABASE_URL=... JWT_SECRET=... SETUP_TOKEN=... APP_URL=... ALLOWED_ORIGIN=... npm run dev:node
import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app";
import type { DbPool } from "./db";
import type { Env } from "./types";

const required = ["DATABASE_URL", "JWT_SECRET", "APP_URL", "ALLOWED_ORIGIN"] as const;
for (const k of required) if (!process.env[k]) throw new Error(`Defina ${k}`);

const env: Env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  SETUP_TOKEN: process.env.SETUP_TOKEN,
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET,
  APP_URL: process.env.APP_URL!,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN!,
  SCRYPT_N: process.env.SCRYPT_N,
};

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const app = createApp({ getPool: () => pool as unknown as DbPool });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: (req) => app.fetch(req, env), port }, () => console.log(`API em http://localhost:${port}`));
