import { Hono } from "hono";
import { z } from "zod";
import { withSession } from "../db";
import { requireAuth, requireRole } from "../middleware";
import type { AppEnv } from "../types";
import { readQuery } from "../validation";

const TABLES = ["appointments", "charges", "services", "payers", "patients", "fiscal_issuers", "fiscal_documents"] as const;

export const changes = new Hono<AppEnv>();
changes.use("*", requireAuth, requireRole("admin"));

// Histórico de alterações (valor antigo e novo), só para a administração. Dados pessoais aparecem como "alterado".
changes.get("/changes", async (c) => {
  const q = readQuery(c, z.object({ table: z.enum(TABLES).optional(), row_id: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT cl.id, cl.table_name, cl.row_id, cl.action, cl.changes, cl.at, cl.user_id, u.nome AS usuario
           FROM change_log cl LEFT JOIN users u ON u.id = cl.user_id
          WHERE ($1::text IS NULL OR cl.table_name = $1) AND ($2::uuid IS NULL OR cl.row_id = $2)
          ORDER BY cl.at DESC, cl.id DESC LIMIT $3`,
        [q.table ?? null, q.row_id ?? null, q.limit],
      )
    ).rows,
  );
  return c.json(rows);
});
