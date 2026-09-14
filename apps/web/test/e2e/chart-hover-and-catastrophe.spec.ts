import { expect, test } from "@playwright/test";

/**
 * Tercera ronda de re-auditoría de interfaz (post-producción):
 *
 * Ajuste 1 — el tooltip flotante de Recharts tapaba las líneas que el
 * usuario quería ver. Se reemplazó por un panel HTML fijo debajo del
 * gráfico. Solo verificable en navegador real: jsdom no implementa el
 * layout SVG del que depende el hit-testing de hover de Recharts.
 *
 * Ajuste 2 — el borde rojo perimetral de la grilla competía visualmente
 * con las celdas rojas de fitness bajo. Se reemplazó por un overlay
 * ámbar de grilla completa + texto flotante con la generación exacta.
 */
test("Ajuste 1: hover sobre el gráfico llena el panel externo, sin mostrar el tooltip flotante de Recharts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  await expect(page.locator(".chart-hover-panel")).toContainText("Pasá el mouse");

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.hover({ position: { x: 300, y: 150 } });

  await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/);
  await expect(page.locator(".chart-hover-panel")).toContainText("Fitness promedio");
  await expect(page.locator(".chart-hover-panel")).toContainText(/crías producidas por organismo/);

  // El tooltip flotante de Recharts nunca debe aparecer — es exactamente lo que tapaba las líneas.
  const floatingTooltip = page.locator(".recharts-tooltip-wrapper");
  if ((await floatingTooltip.count()) > 0) {
    await expect(floatingTooltip.first()).not.toBeVisible();
  }
});

test("Ajuste 2: un evento catastrófico pinta un overlay ámbar de grilla completa con el número de generación, no un borde rojo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Generaciones").fill("15");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  // El preset dispara catástrofes en múltiplos de 10 (FAST_CATASTROPHE.intervalGenerations); con 15 generaciones, la de gen 10 sigue dentro de la ventana de persistencia.
  await expect(page.getByText(/Evento catastrófico — gen 10/)).toBeVisible();

  const legend = page.locator(".population-grid-legend");
  await expect(legend.getByText("Evento catastrófico")).toBeVisible();
  const swatch = legend.locator(".grid-legend-swatch").last();
  const background = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe("rgb(245, 158, 11)"); // #f59e0b, ámbar — no rojo
});

test("Ajuste 4: al menos 8px de separación entre la leyenda, el label \"Generación\" y la nota de análisis", async ({ page }) => {
  // Regresión permanente: el presupuesto de espacio vertical entre el área
  // de líneas y la leyenda que Recharts calcula internamente es fijo
  // (~29.5px, medido) y no responde a margin/wrapperStyle — moviendo
  // "Generación" fuera del <svg> (texto HTML plano) se lo saca de esa
  // pelea por completo. Solo verificable en navegador real.
  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  const chart = page.locator(".chart-container").first();
  const legendBox = (await chart.locator(".recharts-legend-wrapper").first().boundingBox())!;
  const xAxisLabelBox = (await chart.locator(".chart-x-axis-label").boundingBox())!;
  const hoverPanelBox = (await chart.locator(".chart-hover-panel").first().boundingBox())!;
  const firstCaptionBox = (await chart.locator(".chart-caption").first().boundingBox())!;

  expect(xAxisLabelBox.y - (legendBox.y + legendBox.height), "leyenda → label Generación").toBeGreaterThanOrEqual(8);
  expect(hoverPanelBox.y - (xAxisLabelBox.y + xAxisLabelBox.height), "label Generación → panel de hover").toBeGreaterThanOrEqual(8);
  expect(firstCaptionBox.y - (hoverPanelBox.y + hoverPanelBox.height), "panel de hover → nota de análisis").toBeGreaterThanOrEqual(8);
});
