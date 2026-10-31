export type Role = "admin" | "psicologo" | "recepcao";

export interface Session {
  userId: string;
  clinicId: string;
  role: Role;
  atende: boolean;
}

export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
  release(err?: unknown): void;
}

// Compatível com `pg.Pool` e com `Pool` de @neondatabase/serverless.
export interface DbPool {
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

async function run<T>(pool: DbPool, setup: ((db: DbClient) => Promise<void>) | null, fn: (db: DbClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (setup) await setup(db);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

/** Transação sem contexto de clínica: só para as funções de acesso (login, convite). */
export function withDb<T>(pool: DbPool, fn: (db: DbClient) => Promise<T>) {
  return run(pool, null, fn);
}

/** Transação com o contexto do usuário; as policies de RLS leem estes valores. */
export function withSession<T>(pool: DbPool, s: Session, fn: (db: DbClient) => Promise<T>) {
  return run(
    pool,
    async (db) => {
      await db.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true),
                set_config('app.role', $3, true), set_config('app.atende', $4, true)`,
        [s.userId, s.clinicId, s.role, String(s.atende)],
      );
    },
    fn,
  );
}

export async function audit(db: DbClient, s: Session, action: string, entity: string, entityId: string | null) {
  await db.query(
    "INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id) VALUES ($1, $2, $3, $4, $5)",
    [s.clinicId, s.userId, action, entity, entityId],
  );
}
