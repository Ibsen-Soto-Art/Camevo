import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Regresión permanente (Ajuste 1, segunda vez que se toca este bug): un
 * fix anterior (left:0→left:20) resolvió un déficit HORIZONTAL real pero
 * dejó sin cubrir el recorte VERTICAL de los labels rotados de los ejes
 * Y, que empeora con más líneas en la leyenda y con alturas de gráfico
 * más chicas (modo comparación) — ver docs/04-roadmap-fases.md. Un test
 * unitario con mocks no puede atrapar esto: depende de layout SVG real
 * (getBBox/getComputedTextLength), que jsdom no implementa. Se verifica
 * en los mismos tres escenarios que se usaron para diagnosticar el
 * problema, para que una futura leyenda más larga (o un chart aún más
 * bajo) no reintroduzca el recorte en silencio.
 */
async function assertNoTopClipping(chart: Locator) {
  const svg = chart.locator("> svg.recharts-surface").first();
  await expect(svg).toBeVisible();
  const svgBox = (await svg.boundingBox())!;

  const leftLabel = chart.locator("text", { hasText: "Fitness" });
  const rightLabel = chart.locator("text", { hasText: "Clima" });
  await expect(leftLabel).toBeVisible();
  await expect(rightLabel).toBeVisible();

  const leftBox = (await leftLabel.boundingBox())!;
  const rightBox = (await rightLabel.boundingBox())!;

  // overflow > 0 significa que el label empieza ARRIBA del borde superior
  // del SVG — el SVG lo recorta ahí (overflow:hidden default). <= 0 (con
  // margen) es la condición de "no cortado".
  const leftOverflowTop = svgBox.y - leftBox.y;
  const rightOverflowTop = svgBox.y - rightBox.y;

  expect(leftOverflowTop, "eje izquierdo cortado arriba").toBeLessThanOrEqual(0);
  expect(rightOverflowTop, "eje derecho cortado arriba").toBeLessThanOrEqual(0);
}

async function waitForClimateLines(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll(".recharts-legend-item").length >= 5, { timeout: 15_000 });
}

test("eje Y sin recorte: estado sin corrida (legend mínima)", async ({ page }) => {
  await page.goto("/");
  await assertNoTopClipping(page.locator(".chart-container .recharts-wrapper").first());
});

test("eje Y sin recorte: corrida real en curso (legend completa, 5 líneas)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await waitForClimateLines(page);

  await assertNoTopClipping(page.locator(".chart-container .recharts-wrapper").first());
});

test("eje Y sin recorte: modo comparación (height=320, el escenario más ajustado)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Modo").selectOption("live-compare");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();
  await waitForClimateLines(page);

  const charts = page.locator(".chart-container .recharts-wrapper");
  await assertNoTopClipping(charts.nth(0));
  await assertNoTopClipping(charts.nth(1));
});
