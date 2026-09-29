import { expect, test } from "@playwright/test";

/**
 * Mejora 2 (leyenda interactiva): con 6 líneas simultáneas el gráfico es
 * visualmente denso — click en un ítem de la leyenda oculta/muestra esa
 * línea, con opacidad reducida (~30%) en las ocultas. Solo verificable en
 * navegador real: la leyenda custom (`.chart-legend-item`) no llega a
 * montarse en jsdom (ResponsiveContainer depende de ResizeObserver/layout
 * real — ver test/RunChart.test.tsx).
 */
async function runWithClimate(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".chart-legend-item").length >= 6, { timeout: 15_000 });
}

function legendItem(page: import("@playwright/test").Page, name: string) {
  return page.locator(".chart-legend-item", { hasText: name });
}

async function opacityOf(locator: import("@playwright/test").Locator): Promise<number> {
  return Number(await locator.evaluate((el) => getComputedStyle(el).opacity));
}

test("estado inicial: Fitness y Población visibles (opacidad 1), clima y diversidad atenuados (~30%)", async ({ page }) => {
  await runWithClimate(page);

  expect(await opacityOf(legendItem(page, "Fitness promedio"))).toBeCloseTo(1, 1);
  expect(await opacityOf(legendItem(page, "Población viva"))).toBeCloseTo(1, 1);

  expect(await opacityOf(legendItem(page, "Clima: AND"))).toBeCloseTo(0.3, 1);
  expect(await opacityOf(legendItem(page, "Clima: NOT"))).toBeCloseTo(0.3, 1);
  expect(await opacityOf(legendItem(page, "Clima: OR"))).toBeCloseTo(0.3, 1);
  expect(await opacityOf(legendItem(page, "Diversidad genética"))).toBeCloseTo(0.3, 1);
});

test("click en un ítem oculto lo activa: pasa a opacidad completa y su valor aparece en el panel al pasar el mouse", async ({
  page,
}) => {
  await runWithClimate(page);

  const diversityItem = legendItem(page, "Diversidad genética");
  await diversityItem.click();
  expect(await opacityOf(diversityItem)).toBeCloseTo(1, 1);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.hover({ position: { x: 300, y: 150 } });
  await expect(page.locator(".chart-hover-panel")).toContainText("Diversidad genética");
});

test("el eje Y de población aparece/desaparece junto con su serie, sin dejar el margen derecho vacío", async ({ page }) => {
  // El riesgo concreto de quitar el eje es que la `<Line yAxisId="population">`
  // quede apuntando a un eje inexistente. La línea usa `hide` sobre el mismo
  // `hiddenKeys`, así que no debería pasar — se verifica de verdad, mirando la
  // consola del navegador, en vez de asumirlo.
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await runWithClimate(page);

  const chart = page.locator(".chart-container").first();
  const populationAxisLabel = chart.locator("text", { hasText: "Población" });

  // El ancho del área de trazado sale de la grilla cartesiana, que ocupa
  // exactamente ese rectángulo — es la forma directa de medir que
  // `margin.right` cambió, sin depender de valores internos de Recharts.
  const plotWidth = async () =>
    (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!.width;

  // Visible por defecto: el eje existe.
  await expect(populationAxisLabel).toBeVisible();
  const widthWithAxis = await plotWidth();

  // Al ocultar la serie, el eje desaparece por completo del SVG.
  await legendItem(page, "Población viva").click();
  await expect(populationAxisLabel).toHaveCount(0);

  // ...y el área de trazado se ensancha ~30px (margin.right 60 → 30), en vez
  // de dejar una franja vacía donde estaba el eje.
  const widthWithoutAxis = await plotWidth();
  expect(widthWithoutAxis - widthWithAxis).toBeGreaterThan(20);

  // Al volver a mostrarla, el eje reaparece y el área vuelve a su ancho original.
  await legendItem(page, "Población viva").click();
  await expect(populationAxisLabel).toBeVisible();
  expect(await plotWidth()).toBeCloseTo(widthWithAxis, 0);

  expect(consoleErrors).toEqual([]);
});

test("click en un ítem visible lo oculta: pasa a opacidad reducida y desaparece del panel de valores", async ({ page }) => {
  await runWithClimate(page);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.hover({ position: { x: 300, y: 150 } });
  await expect(page.locator(".chart-hover-panel")).toContainText("Fitness promedio");

  const fitnessItem = legendItem(page, "Fitness promedio");
  await fitnessItem.click();
  expect(await opacityOf(fitnessItem)).toBeCloseTo(0.3, 1);

  // Vuelve a pasar el mouse (una generación distinta) para forzar una actualización real del panel.
  await wrapper.hover({ position: { x: 320, y: 150 } });
  await expect(page.locator(".chart-hover-panel")).not.toContainText("Fitness promedio");
  // Población sigue visible — ocultar una línea no afecta a las demás.
  await expect(page.locator(".chart-hover-panel")).toContainText("Población viva");
});

test("el eje Y de clima aparece/desaparece con sus series — y por defecto NO está, porque están ocultas", async ({ page }) => {
  /*
   * Auditoría exploratoria: el fix del eje de población (v0.20.1) no se
   * había aplicado al de clima, así que la PRIMERA pantalla mostraba un
   * eje "Clima" con escala numérica y ninguna línea que lo usara — las
   * tres series climáticas están en DEFAULT_HIDDEN_KEYS.
   */
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await runWithClimate(page);

  const chart = page.locator(".chart-container").first();
  const climateAxisLabel = chart.locator("text", { hasText: "Clima" });
  const plotWidth = async () =>
    (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!.width;

  // Estado inicial: clima oculto ⇒ sin eje "Clima".
  await expect(climateAxisLabel).toHaveCount(0);
  const widthWithoutClimate = await plotWidth();

  // Activar UNA sola serie climática ya hace aparecer el eje.
  await legendItem(page, "Clima: AND").click();
  await expect(climateAxisLabel).toBeVisible();
  const widthWithClimate = await plotWidth();
  expect(widthWithoutClimate - widthWithClimate).toBeGreaterThan(20);

  // Activar las otras dos no agrega un segundo eje: comparten `yAxisId`.
  await legendItem(page, "Clima: NOT").click();
  await legendItem(page, "Clima: OR").click();
  await expect(climateAxisLabel).toHaveCount(1);
  expect(await plotWidth()).toBeCloseTo(widthWithClimate, 0);

  // Ocultar las tres lo vuelve a quitar, y el área recupera su ancho.
  await legendItem(page, "Clima: AND").click();
  await legendItem(page, "Clima: NOT").click();
  await expect(climateAxisLabel).toHaveCount(1); // todavía queda OR visible
  await legendItem(page, "Clima: OR").click();
  await expect(climateAxisLabel).toHaveCount(0);
  expect(await plotWidth()).toBeCloseTo(widthWithoutClimate, 0);

  expect(consoleErrors).toEqual([]);
});

test("con TODAS las series ocultas el panel invita a reactivar una, y el foco queda en el último ítem", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await runWithClimate(page);

  // Ocultar las dos visibles por defecto deja el gráfico sin ninguna serie.
  await legendItem(page, "Fitness promedio").click();
  await legendItem(page, "Población viva").click();

  await expect(page.locator(".chart-hover-panel")).toContainText("Activá al menos una línea en la leyenda");
  await expect(page.locator(".chart-hover-panel")).not.toContainText(/Generación \d+/);

  // El foco se conserva en el ítem recién alternado: sin esto quedaba en
  // <body> y la siguiente pulsación de Espacio scrolleaba la página.
  const focusedKey = await page.evaluate(() => document.activeElement?.getAttribute("data-series-key") ?? null);
  expect(focusedKey).toBe("populationSize");

  // Y desde ahí se puede reactivar con el teclado, sin volver a tabular.
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(" ");
  await expect(page.locator(".chart-hover-panel")).not.toContainText("Activá al menos una línea");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  expect(consoleErrors).toEqual([]);
});

test("encadenar toggles con el teclado: Enter y Espacio alternan series sucesivas sin perder el foco", async ({ page }) => {
  await runWithClimate(page);

  const fitness = legendItem(page, "Fitness promedio");
  await fitness.focus();
  expect(await opacityOf(fitness)).toBeCloseTo(1, 1);

  await page.keyboard.press("Enter");
  expect(await opacityOf(fitness)).toBeCloseTo(0.3, 1);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-series-key") ?? null)).toBe("averageFitness");

  await page.keyboard.press(" ");
  expect(await opacityOf(fitness)).toBeCloseTo(1, 1);

  await page.keyboard.press("Enter");
  expect(await opacityOf(fitness)).toBeCloseTo(0.3, 1);
});
