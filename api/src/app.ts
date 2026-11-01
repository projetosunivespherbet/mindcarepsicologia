import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { withDb, type DbPool } from "./db";
import { access } from "./routes/access";
import { appointments, blocks } from "./routes/appointments";
import { documents, letterheads, publicDocuments } from "./routes/documents";
import { changes } from "./routes/audit";
import { clinic } from "./routes/clinic";
import { fiscal, nfse } from "./routes/fiscal";
import { charges, finance, payers, payments, services } from "./routes/finance";
import { clinical, goals } from "./routes/clinical";
import { packages } from "./routes/packages";
import { patients } from "./routes/patients";
import { professionals, users } from "./routes/users";
import type { AppEnv, Env } from "./types";

/** Parte do contexto de execução do Worker que a API usa (evita depender dos tipos do Workers). */
export interface WorkerContext {
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
}

export interface Deps {
  getPool: (env: Env) => DbPool;
  /** Chamado ao final da requisição (no Worker, encerra a conexão com waitUntil). */
  releasePool?: (pool: DbPool, c: WorkerContext) => void;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  users_check: "Quem atende precisa ter o CRP informado",
  users_email_uq: "E-mail já cadastrado",
  charges_one_active_per_appointment: "Esta sessão já tem uma cobrança ativa",
  payments_reverses_uq: "Este pagamento já foi estornado",
  payments_idem_uq: "Esta Idempotency-Key já foi usada",
  fiscal_one_active_doc_per_charge: "Alguma das cobranças já tem nota fiscal ativa",
  fiscal_documents_chave_uq: "Esta chave de acesso já foi registrada",
  fiscal_issuers_cnpj_uq: "Já existe um emissor ativo com este CNPJ",
};

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());
  app.use("*", (c, next) =>
    cors({
      origin: (origin) => (origin === c.env.ALLOWED_ORIGIN ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    })(c, next),
  );
  app.use("*", async (c, next) => {
    const pool = deps.getPool(c.env);
    c.set("pool", pool);
    try {
      await next();
    } finally {
      if (deps.releasePool) deps.releasePool(pool, c as unknown as WorkerContext);
    }
  });

  app.get("/health", (c) => c.json({ ok: true }));
  // Confere a conexão e as credenciais do banco (usado na verificação pós-deploy).
  app.get("/health/db", async (c) => {
    try {
      await withDb(c.get("pool"), (db) => db.query("SELECT 1"));
      return c.json({ ok: true, db: true });
    } catch (err) {
      console.error("health/db:", err);
      // Diagnóstico sem segredos: ajuda a achar erro de formato em DATABASE_URL (sem senha, só forma).
      const u = String(c.env.DATABASE_URL ?? "");
      console.error(
        "health/db diag:",
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        JSON.stringify({
          tamanho: u.length,
          inicio: u.slice(0, 13),
          espacos: /\s/.test(u),
          aspas: /["'`]/.test(u),
          arrobas: (u.match(/@/g) ?? []).length,
          host: (u.split("@").pop() ?? "").split("/")[0],
        }),
      );
      return c.json({ ok: false, db: false }, 503);
    }
  });
  app.route("/", access);
  app.route("/clinic", clinic);
  app.route("/users", users);
  app.route("/professionals", professionals);
  app.route("/patients", patients);
  app.route("/patients", clinical);
  app.route("/goals", goals);
  app.route("/appointments", appointments);
  app.route("/blocks", blocks);
  app.route("/documents", documents);
  app.route("/letterheads", letterheads);
  app.route("/services", services);
  app.route("/payers", payers);
  app.route("/charges", charges);
  app.route("/packages", packages);
  app.route("/payments", payments);
  app.route("/finance", finance);
  app.route("/fiscal", fiscal);
  app.route("/nfse", nfse);
  app.route("/audit", changes);
  app.route("/", publicDocuments);

  app.notFound((c) => c.json({ error: "Não encontrado" }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) {
      return c.json({ error: "Dados inválidos", details: err.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) }, 400);
    }
    const e = err as { code?: string; constraint?: string; message?: string };
    switch (e.code) {
      case "23505":
        return c.json({ error: CONSTRAINT_MESSAGES[e.constraint ?? ""] ?? "Registro duplicado" }, 409);
      case "23P01":
        return c.json({ error: e.message }, 409);
      case "23514":
        return c.json({ error: CONSTRAINT_MESSAGES[e.constraint ?? ""] ?? (e.constraint ? "Dados inválidos" : e.message) }, 422);
      case "23503":
        return c.json({ error: "Referência inválida" }, 422);
      case "42501":
        return c.json({ error: "Sem permissão" }, 403);
      case "22P02":
        return c.json({ error: "Identificador inválido" }, 400);
      case "P0002":
      case "22023":
        return c.json({ error: e.message }, 400);
      default:
        console.error("erro interno:", err);
        return c.json({ error: "Erro interno" }, 500);
    }
  });

  return app;
}
