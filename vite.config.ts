import fs from "node:fs";
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";

const API_PLACEHOLDER = "https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev";

/**
 * Coloca a origem da API (VITE_API_URL) na política de segurança (CSP) do arquivo `_headers` do build.
 * Assim a CSP nunca bloqueia as chamadas à API por esquecimento de editar o arquivo à mão.
 */
function cspApiOrigin(apiUrl: string | undefined): Plugin {
  let outDir = "dist";
  return {
    name: "csp-api-origin",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, "_headers");
      if (!fs.existsSync(file)) return;
      let origin = "";
      if (apiUrl) {
        try {
          origin = new URL(apiUrl).origin;
        } catch {
          throw new Error(`VITE_API_URL inválida: ${apiUrl}`);
        }
      }
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").split(` ${API_PLACEHOLDER}`).join(origin ? ` ${origin}` : ""));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), cspApiOrigin(env.VITE_API_URL)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
