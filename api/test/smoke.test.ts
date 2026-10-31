import { afterAll, describe, expect, it } from "vitest";
import { smoke } from "../scripts/smoke.mjs";
import { app, appPool, env, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

// Liga o fetch do script de verificação direto ao app da API (sem rede).
const bridge = (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  return Promise.resolve(app.request(`${u.pathname}${u.search}`, init, env));
};

describe("script de verificação pós-deploy", () => {
  it("passa contra uma API corretamente configurada", async () => {
    const { results, failed } = await smoke({ apiUrl: "https://api.exemplo.test", origin: env.ALLOWED_ORIGIN, fetchImpl: bridge as typeof fetch });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(failed).toBe(0);
    expect(results.length).toBeGreaterThanOrEqual(7);
  });

  it("acusa CORS mal configurado", async () => {
    const { results, failed } = await smoke({ apiUrl: "https://api.exemplo.test", origin: "https://outro-front.example", fetchImpl: bridge as typeof fetch });
    expect(failed).toBe(1);
    expect(results.find((r) => !r.ok)?.nome).toMatch(/CORS/);
  });
});
