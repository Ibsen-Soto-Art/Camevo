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
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });
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
