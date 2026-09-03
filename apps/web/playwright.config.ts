import { defineConfig } from "@playwright/test";

const API_PORT = 3001;
const WEB_PORT = 5173;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://camevo:camevo@localhost:5433/camevo";

/**
 * Smoke test end-to-end de verdad: levanta apps/api y apps/web como
 * procesos reales y conduce un navegador contra ellos — el mismo tipo de
 * verificación manual que ya atrapó el bug de CORS y la dependencia
 * faltante de react-is (apps/web/test/App.test.tsx, con mocks, nunca
 * los habría detectado). Requiere que `camevo-db` ya esté arriba
 * (`docker compose up -d camevo-db` desde la raíz del repo) — si no,
 * apps/api falla al arrancar y Playwright lo reporta como "webServer no
 * pudo iniciar", en vez de colgarse indefinidamente.
 */
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  retries: 0,
  webServer: [
    {
      command: "npx tsx src/api/main.ts",
      cwd: new URL("../api", import.meta.url).pathname,
      url: `http://localhost:${API_PORT}/health`,
      env: { DATABASE_URL, API_PORT: String(API_PORT) },
      reuseExistingServer: true,
      timeout: 20_000,
      stdout: "pipe",
    },
    {
      command: "npm run dev -- --port " + WEB_PORT,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: true,
      timeout: 20_000,
      stdout: "pipe",
    },
  ],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
  },
});
