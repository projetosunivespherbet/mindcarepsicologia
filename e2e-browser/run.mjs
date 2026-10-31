// Orquestra o teste de navegador: banco, API local, build do front, imagens de teste e o roteiro (flow.mjs).
// Uso: npm test            (CSP bloqueando, como em produção)
//      npm run test:report (CSP só avisando, para investigar)
import { execFileSync, spawn } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const work = join(here, ".work");
const mode = process.argv[2] === "report" ? "report" : "enforce";
const PORT = 8080;
const API_PORT = 8787;

const pg = createRequire(join(root, "api", "package.json"))("pg");
const host = process.env.TEST_PG_HOST ?? "127.0.0.1:5432";
const ownerPw = process.env.TEST_PG_OWNER_PASSWORD ?? "owner_pw";
const url = (user, pw, db) => `postgres://${user}:${pw}@${host}/${db}`;

// --- banco
const admin = new pg.Client({ connectionString: url("mc_owner", ownerPw, "postgres") });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS mindcare_browser WITH (FORCE)");
await admin.query("CREATE DATABASE mindcare_browser");
await admin.end();
execFileSync("node", ["api/scripts/migrate.mjs"], { cwd: root, env: { ...process.env, DATABASE_URL: url("mc_owner", ownerPw, "mindcare_browser") }, stdio: "ignore" });
const owner = new pg.Client({ connectionString: url("mc_owner", ownerPw, "mindcare_browser") });
await owner.connect();
await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
  CREATE ROLE mc_app LOGIN PASSWORD 'app_pw' IN ROLE app_runtime; END IF; END $$`);
await owner.end();

// --- imagens de teste (PNG gerado aqui, sem dependências)
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
rmSync(work, { recursive: true, force: true });
const assets = join(work, "assets");
mkdirSync(assets, { recursive: true });
writeFileSync(join(assets, "logo.png"), png(300, 120, (x, y) => (x > 90 && x < 210 && y > 30 && y < 90 ? [240, 250, 248] : [20, 120, 110])));
writeFileSync(join(assets, "fundo.png"), png(1240, 1754, (x, y) => (y < 160 ? [20, 120, 110] : y > 1600 ? [214, 236, 232] : [255, 255, 255])));

// --- front compilado, apontando para a API local
const dist = join(work, "dist");
execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], {
  cwd: root, env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` }, stdio: "ignore",
});

// --- API local (Node)
const api = spawn("npx", ["tsx", "src/node.ts"], {
  cwd: join(root, "api"),
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    DATABASE_URL: url("mc_app", "app_pw", "mindcare_browser"),
    JWT_SECRET: "segredo-do-navegador-com-tamanho-ok-123456",
    SETUP_TOKEN: "setup-browser",
    APP_URL: `http://localhost:${PORT}`,
    ALLOWED_ORIGIN: `http://localhost:${PORT}`,
    SCRYPT_N: "1024",
    PORT: String(API_PORT),
  },
});
const stopApi = () => {
  try { process.kill(-api.pid); } catch { /* já encerrada */ }
};
process.on("exit", stopApi);

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  up = await fetch(`http://localhost:${API_PORT}/health/db`).then((r) => r.ok).catch(() => false);
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  stopApi();
  throw new Error("A API local não subiu.");
}

// --- roteiro no navegador
const flow = spawn("node", [join(here, "flow.mjs"), mode], {
  stdio: "inherit",
  env: { ...process.env, E2E_DIST: dist, E2E_WORK: work, E2E_ASSETS: assets, E2E_API: `http://localhost:${API_PORT}`, E2E_PORT: String(PORT) },
});
const code = await new Promise((r) => flow.on("exit", r));
stopApi();
process.exit(code ?? 1);
