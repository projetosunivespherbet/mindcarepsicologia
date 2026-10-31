import { execFileSync } from "node:child_process";
import pg from "pg";
import { OWNER_ADMIN_URL, OWNER_URL } from "./env";

export default async function setup() {
  const admin = new pg.Client({ connectionString: OWNER_ADMIN_URL });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS mindcare_test WITH (FORCE)");
  await admin.query("CREATE DATABASE mindcare_test");
  await admin.end();

  execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: OWNER_URL }, stdio: "inherit" });

  const owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  await owner.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
      CREATE ROLE mc_app LOGIN PASSWORD 'app_pw' IN ROLE app_runtime;
    END IF; END $$`);
  await owner.end();
}
