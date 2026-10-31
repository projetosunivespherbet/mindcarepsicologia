// Verificação pós-deploy, sem criar nem alterar dados.
// Uso: API_URL=https://sua-api.workers.dev ALLOWED_ORIGIN=https://seu-app.pages.dev npm run smoke
import { fileURLToPath } from "node:url";

export async function smoke({ apiUrl, origin, fetchImpl = fetch }) {
  const base = apiUrl.replace(/\/$/, "");
  const results = [];
  const check = async (nome, fn) => {
    try {
      const detalhe = await fn();
      results.push({ nome, ok: true, detalhe });
    } catch (err) {
      results.push({ nome, ok: false, detalhe: err instanceof Error ? err.message : String(err) });
    }
  };
  const req = (path, init) => fetchImpl(`${base}${path}`, init);
  const esperar = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  await check("API responde (/health)", async () => {
    const r = await req("/health");
    esperar(r.status === 200, `status ${r.status}`);
  });
  await check("API alcança o banco (/health/db)", async () => {
    const r = await req("/health/db");
    esperar(r.status === 200, `status ${r.status}: confira DATABASE_URL e se o papel app_user existe`);
  });
  await check("rota protegida exige login (/me → 401)", async () => {
    const r = await req("/me");
    esperar(r.status === 401, `status ${r.status}`);
  });
  await check("login inválido é recusado (401)", async () => {
    const r = await req("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "naoexiste@verificacao.test", password: "Senha@1234" }),
    });
    esperar(r.status === 401, `status ${r.status}`);
  });
  await check("verificação pública de código inexistente (404)", async () => {
    const r = await req("/verify/AAAAAAAAAAAA");
    esperar(r.status === 404, `status ${r.status}`);
  });
  await check("criação de clínica exige SETUP_TOKEN (403)", async () => {
    const r = await req("/platform/clinics", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    esperar(r.status === 403, `status ${r.status} (404 = SETUP_TOKEN não configurado)`);
  });
  if (origin) {
    await check("CORS libera só a origem do front", async () => {
      const ok = await req("/health", { headers: { Origin: origin } });
      esperar(ok.headers.get("access-control-allow-origin") === origin, "a origem do front não foi liberada: confira ALLOWED_ORIGIN");
      const ruim = await req("/health", { headers: { Origin: "https://origem-nao-autorizada.example" } });
      esperar(!ruim.headers.get("access-control-allow-origin"), "uma origem estranha foi liberada");
    });
  }
  return { results, failed: results.filter((r) => !r.ok).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    console.error("Defina API_URL (e, se quiser testar o CORS, ALLOWED_ORIGIN).");
    process.exit(2);
  }
  const { results, failed } = await smoke({ apiUrl, origin: process.env.ALLOWED_ORIGIN });
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.nome}${r.ok ? "" : ` — ${r.detalhe}`}`);
  console.log(failed ? `\n${failed} verificação(ões) falharam.` : "\nTudo certo.");
  process.exit(failed ? 1 : 0);
}
