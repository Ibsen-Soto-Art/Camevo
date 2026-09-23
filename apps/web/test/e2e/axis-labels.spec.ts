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
/**
 * Población (nueva línea, RunChart) agregó un TERCER eje rotado, apilado
 * hacia afuera del de "Clima" — el mismo riesgo de recorte vertical que ya
 * afectó a los dos ejes originales, más uno nuevo: recorte HORIZONTAL por
 * la derecha, ya que este eje vive más lejos del borde del SVG y depende
 * de que `margin.right` (30 → 60) le haya dejado espacio real. Los tres
 * labels se verifican siempre, no solo los dos originales — de lo
 * contrario este test seguiría en verde aunque "Población" se recortara
 * por completo.
 */
async function assertNoAxisLabelClipping(chart: Locator) {
  const svg = chart.locator("> svg.recharts-surface").first();
  await expect(svg).toBeVisible();
  const svgBox = (await svg.boundingBox())!;

  const labels = {
    Fitness: chart.locator("text", { hasText: "Fitness" }),
    Clima: chart.locator("text", { hasText: "Clima" }),
    Población: chart.locator("text", { hasText: "Población" }),
  };

  for (const [name, locator] of Object.entries(labels)) {
    await expect(locator, `label "${name}" visible`).toBeVisible();
    const box = (await locator.boundingBox())!;

    // overflow > 0 significa que el label empieza ANTES del borde
    // correspondiente del SVG — el SVG lo recorta ahí (overflow:hidden
    // default). <= 0 (con margen) es la condición de "no cortado".
    const overflowTop = svgBox.y - box.y;
    const overflowRight = box.x + box.width - (svgBox.x + svgBox.width);

    expect(overflowTop, `label "${name}" cortado arriba`).toBeLessThanOrEqual(0);
    expect(overflowRight, `label "${name}" cortado a la derecha`).toBeLessThanOrEqual(0);
  }
}

async function waitForClimateLines(page: Page) {
  // Fitness + Diversidad + Población + hasta 3 líneas de clima = 6 con las 3 tareas activas.
  await page.waitForFunction(() => document.querySelectorAll(".recharts-legend-item").length >= 6, { timeout: 15_000 });
}

test("eje Y sin recorte: estado sin corrida (legend mínima)", async ({ page }) => {
  await page.goto("/");
  await assertNoAxisLabelClipping(page.locator(".chart-container .recharts-wrapper").first());
});

test("eje Y sin recorte: corrida real en curso (legend completa, 6 líneas)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await waitForClimateLines(page);

  await assertNoAxisLabelClipping(page.locator(".chart-container .recharts-wrapper").first());
});

test("eje Y sin recorte: modo comparación (height=320, el escenario más ajustado)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Modo").selectOption("live-compare");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();
  await waitForClimateLines(page);

  const charts = page.locator(".chart-container .recharts-wrapper");
  await assertNoAxisLabelClipping(charts.nth(0));
  await assertNoAxisLabelClipping(charts.nth(1));
});
