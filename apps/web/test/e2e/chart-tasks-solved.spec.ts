import { expect, test, type Page } from "@playwright/test";

/**
 * Hallazgo ④ de la auditoría exploratoria del 29/09: la curva de "Fitness
 * promedio" puede subir mientras la adaptación funcional colapsa, porque
 * `averageFitness` es nacimientos / población y no tiene nada que ver con
 * resolver tareas lógicas. Medido en 20x20, Moderada, catástrofes activas,
 * 1500 generaciones, misma semilla: con mutación 1.0 el ratio
 * tardío/temprano da 2.03 —el más alto de la tabla— con el 87% de las
 * generaciones en CERO tareas; con mutación 0 da 1.01 con 108.276 tareas.
 *
 * Solo verificable en navegador real: el panel se llena por hover sobre el
 * SVG, que jsdom no monta.
 */
async function hoverPanel(page: Page): Promise<string> {
  const chart = page.locator(".chart-container").first();
  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.scrollIntoViewIfNeeded();
  const plot = (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
  const wbox = (await wrapper.boundingBox())!;
  await page.mouse.move(plot.x + plot.width * 0.7, wbox.y + wbox.height * 0.5);
  await page.waitForTimeout(200);
  return (await page.locator(".chart-hover-panel").textContent()) ?? "";
}

async function runWith(page: Page, mutationRate: string) {
  await page.goto("/");
  await page.getByLabel("Tasa de mutación").fill(mutationRate);
  await page.getByLabel("Generaciones").fill("400");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
}

test("con la mutación por defecto, el panel muestra el número de tareas resueltas sin la glosa", async ({ page }) => {
  test.setTimeout(180_000);
  await runWith(page, "0.05");
  const text = await hoverPanel(page);

  const match = /Tareas lógicas resueltas: (\d+)/.exec(text);
  expect(match, `el panel no mostró la línea de tareas. Panel: ${text}`).not.toBeNull();
  expect(Number(match![1])).toBeGreaterThan(0);
  // Con tareas resueltas no hay nada que aclarar: solo el número.
  expect(text).not.toContain("ningún organismo resolvió AND, NOT u OR");
});

test("con mutación 1.0 el panel muestra 0 CON la glosa, mientras el fitness sigue dando un número alto", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await runWith(page, "1");

  // Varias posiciones: con mutación 1.0 el 87% de las generaciones están en
  // cero, pero no todas — se busca una que lo esté.
  const chart = page.locator(".chart-container").first();
  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.scrollIntoViewIfNeeded();
  const plot = (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
  const wbox = (await wrapper.boundingBox())!;

  let zeroText: string | null = null;
  for (let i = 0; i <= 20 && zeroText === null; i++) {
    await page.mouse.move(plot.x + (plot.width * i) / 20, wbox.y + wbox.height * 0.5);
    await page.waitForTimeout(100);
    const text = (await page.locator(".chart-hover-panel").textContent()) ?? "";
    if (/Tareas lógicas resueltas: 0\b/.test(text)) zeroText = text;
  }

  expect(zeroText, "ninguna generación mostró 0 tareas con mutación 1.0").not.toBeNull();
  expect(zeroText).toContain("Tareas lógicas resueltas: 0 — ningún organismo resolvió AND, NOT u OR en esta generación.");
  // La contradicción, en el mismo panel: el fitness muestra un valor real
  // mientras las tareas están en cero.
  expect(zeroText).toMatch(/Fitness promedio: [\d.]+/);
});

test("la glosa NO se pinta de rojo: un cero es normal en generaciones tempranas", async ({ page }) => {
  test.setTimeout(180_000);
  await runWith(page, "1");
  await hoverPanel(page);

  const line = page.locator(".chart-values-tasks");
  await expect(line).toBeVisible();
  const color = await line.evaluate((el) => getComputedStyle(el).color);
  // El gris secundario del tema, no el rojo de error (#f87171) ni el ámbar
  // de catástrofe (#f59e0b).
  expect(color).not.toBe("rgb(248, 113, 113)");
  expect(color).not.toBe("rgb(245, 158, 11)");
});
