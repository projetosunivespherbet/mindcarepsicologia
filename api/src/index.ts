import { Pool } from "@neondatabase/serverless";
import { createApp } from "./app";
import type { DbPool } from "./db";
import type { Env } from "./types";

// Uma conexão por requisição (recomendado no Workers); encerrada depois da resposta.
const app = createApp({
  getPool: (env) => new Pool({ connectionString: env.DATABASE_URL, max: 1 }) as unknown as DbPool,
  releasePool: (pool, c) => c.executionCtx.waitUntil(pool.end()),
});

export default app satisfies ExportedHandler<Env>;
