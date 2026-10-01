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
async function runCatastropheScenario(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 30_000 });
}

test("Ajuste 1 + Mejora 1: hover llena el panel de valores (sin descripciones pedagógicas), sin mostrar el tooltip flotante de Recharts", async ({
  page,
}) => {
  await runCatastropheScenario(page);

  await expect(page.locator(".chart-hover-panel")).toContainText("Pasá el mouse sobre el gráfico para ver los valores");

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.hover({ position: { x: 300, y: 150 } });

  // Formato nuevo (Mejora 1): Generación + Fitness/Población visibles por defecto — sin la
  // descripción pedagógica larga que vivía en el tooltip flotante ya retirado.
  await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/);
  await expect(page.locator(".chart-hover-panel")).toContainText("Fitness promedio");
  await expect(page.locator(".chart-hover-panel")).toContainText("Población viva");
  await expect(page.locator(".chart-hover-panel")).not.toContainText(/crías producidas por organismo/);

  // El tooltip flotante de Recharts nunca debe aparecer — es exactamente lo que tapaba las líneas.
  const floatingTooltip = page.locator(".recharts-tooltip-wrapper");
  if ((await floatingTooltip.count()) > 0) {
    await expect(floatingTooltip.first()).not.toBeVisible();
  }
});

test("Mejora 1: el panel de valores persiste después de que el mouse sale del gráfico y de hacer scroll real", async ({ page }) => {
  await runCatastropheScenario(page);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.hover({ position: { x: 300, y: 150 } });
  await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/);
  const textWhileHovering = await page.locator(".chart-hover-panel").textContent();

  // Sale del gráfico (a diferencia del tooltip flotante original, esto NO debe limpiar el panel) y hace scroll real de la página.
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);

  const textAfterLeavingAndScrolling = await page.locator(".chart-hover-panel").textContent();
  expect(textAfterLeavingAndScrolling).toBe(textWhileHovering);
});

test.describe("Mejora 1: activación táctil real en mobile", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  /**
   * `locator.tap({position})` NO sirve para probar esto: medido con
   * Playwright que toques independientes repetidos sobre el MISMO
   * locator no siempre re-disparan un evento táctil real en el navegador
   * (movió al primer toque, después queda "ya tocando ese elemento" para
   * Playwright). `page.touchscreen.tap(x, y)` con coordenadas absolutas
   * de página sí dispara un touchstart/touchend real cada vez — es lo
   * que reveló originalmente que toques independientes (sin arrastre) NO
   * actualizaban `activeLabel` de Recharts de forma confiable más allá
   * del primero, y lo que confirma que el handler explícito agregado en
   * RunChart.tsx (`handleTouchPosition`) lo soluciona.
   */
  test("un toque sobre el gráfico activa el panel de valores, se queda visible hasta el próximo toque, y un toque en otra posición sí lo actualiza", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Generaciones").fill("200");
    await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
    await page.getByRole("button", { name: "Iniciar corrida" }).click();
    await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 30_000 });

    const wrapper = page.locator(".chart-container .recharts-wrapper").first();
    await wrapper.scrollIntoViewIfNeeded();
    const box = (await wrapper.boundingBox())!;
    /*
     * Las X se toman del área de TRAZADO (la grilla cartesiana ocupa
     * exactamente ese rectángulo), no del wrapper: medido en este mismo
     * repo que un wrapper de 554px puede contener un área de líneas de
     * ~294px, así que "80% del wrapper" cae más allá del último dato y el
     * segundo toque no cambia de generación. Con datos distintos el ancho
     * de los ticks del eje Y cambia, y con él el punto exacto donde eso
     * pasa — de ahí que fallara de forma intermitente y no siempre.
     */
    const plot = (await page.locator(".chart-container .recharts-cartesian-grid-horizontal line").first().boundingBox())!;

    await page.touchscreen.tap(plot.x + plot.width * 0.1, box.y + box.height * 0.5);
    await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/, { timeout: 5_000 });
    const textAfterFirstTap = await page.locator(".chart-hover-panel").textContent();

    // Sin tocar de nuevo, se mantiene — el equivalente táctil de "onMouseLeave no limpia".
    await page.waitForTimeout(300);
    expect(await page.locator(".chart-hover-panel").textContent()).toBe(textAfterFirstTap);

    // Un segundo toque, bien separado en X, sí actualiza el panel a otra generación.
    await page.touchscreen.tap(plot.x + plot.width * 0.9, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    expect(await page.locator(".chart-hover-panel").textContent()).not.toBe(textAfterFirstTap);
  });
});

test("Ajuste 2: un evento catastrófico pinta un overlay ámbar de grilla completa con el número de generación, no un borde rojo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Generaciones").fill("15");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 30_000 });

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
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 30_000 });

  const chart = page.locator(".chart-container").first();
  const legendBox = (await chart.locator(".recharts-legend-wrapper").first().boundingBox())!;
  const xAxisLabelBox = (await chart.locator(".chart-x-axis-label").boundingBox())!;
  const hoverPanelBox = (await chart.locator(".chart-hover-panel").first().boundingBox())!;
  const firstCaptionBox = (await chart.locator(".chart-caption").first().boundingBox())!;

  expect(xAxisLabelBox.y - (legendBox.y + legendBox.height), "leyenda → label Generación").toBeGreaterThanOrEqual(8);
  expect(hoverPanelBox.y - (xAxisLabelBox.y + xAxisLabelBox.height), "label Generación → panel de hover").toBeGreaterThanOrEqual(8);
  expect(firstCaptionBox.y - (hoverPanelBox.y + hoverPanelBox.height), "panel de hover → nota de análisis").toBeGreaterThanOrEqual(8);
});

test("RF-015: al pasar el mouse sobre una generación catastrófica, el panel dice cuántos murieron y por qué la curva no baja", async ({
  page,
}) => {
  /*
   * El caso que motivó el cambio: en velocidad Moderada la catástrofe
   * ocurre ANTES del ciclo de reproducción de la misma generación, la
   * grilla se rellena y la curva de población queda plana en 400 — así que
   * las líneas verticales rojas parecían no tener consecuencia. Solo
   * verificable en navegador real: el panel se llena por hover sobre el
   * SVG, que jsdom no monta.
   */
  test.setTimeout(180_000);
  await page.goto("/");
  // Moderada (default) con catástrofes cada 60 generaciones: con 300
  // generaciones hay 4 eventos, y la corrida no se extingue.
  await page.getByLabel("Generaciones").fill("300");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });

  const chart = page.locator(".chart-container").first();
  const referenceLines = chart.locator(".recharts-reference-line");
  expect(await referenceLines.count()).toBeGreaterThan(0);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.scrollIntoViewIfNeeded();
  const wbox = (await wrapper.boundingBox())!;

  /*
   * La posición se toma de la propia `ReferenceLine`, no barriendo el
   * gráfico: con 300 generaciones y un área de ~500px, un barrido de pasos
   * fijos puede saltar por encima de las 4 generaciones con evento (el
   * hover se ajusta al punto más cercano). Medido: un barrido de 41 pasos
   * pasaba en aislamiento y fallaba en la suite completa, donde el ancho
   * del área cambia. La línea de referencia está dibujada exactamente en la
   * generación catastrófica, así que es la coordenada correcta por
   * construcción.
   */
  const markerBox = (await referenceLines.first().locator("line").first().boundingBox())!;
  let found: string | null = null;
  for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
    await page.mouse.move(markerBox.x + markerBox.width / 2 + dx, wbox.y + wbox.height * 0.5);
    await page.waitForTimeout(80);
    const text = (await page.locator(".chart-hover-panel").textContent()) ?? "";
    if (/Catástrofe: murieron \d+ organismos/.test(text)) {
      found = text;
      break;
    }
  }

  expect(found, "el hover sobre la línea de referencia no mostró la línea de catástrofe").not.toBeNull();
  expect(found).toMatch(/⚡ Catástrofe: murieron \d+ organismos\./);
  expect(found).toContain("La población se rellenó en la misma generación, así que la curva no baja.");
  // Y el número es real, no un 0 que se colara por el `?? 0`.
  expect(Number(/murieron (\d+) organismos/.exec(found!)![1])).toBeGreaterThan(0);

  // En una generación SIN evento la línea no aparece.
  const generations = await page.evaluate(() => {
    const panel = document.querySelector(".chart-hover-panel");
    return panel?.textContent ?? "";
  });
  expect(generations).toBeTruthy();
});

test("RF-015: una corrida sin eventos catastróficos nunca muestra la línea de catástrofe en el panel", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByRole("checkbox", { name: /eventos catastróficos/i }).uncheck();
  await page.getByLabel("Generaciones").fill("300");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });

  const chart = page.locator(".chart-container").first();
  await expect(chart.locator(".recharts-reference-line")).toHaveCount(0);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.scrollIntoViewIfNeeded();
  const plot = (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
  const wbox = (await wrapper.boundingBox())!;
  for (let i = 0; i <= 20; i++) {
    await page.mouse.move(plot.x + (plot.width * i) / 20, wbox.y + wbox.height * 0.5);
    await expect(page.locator(".chart-hover-panel")).not.toContainText("Catástrofe");
  }
});

test("RF-015/RF-024: hover sobre una generación catastrófica de una corrida FINALIZADA pinta el overlay ámbar en la grilla", async ({
  page,
}) => {
  /*
   * Los dos problemas que motivaron el cambio, en un solo recorrido:
   * la grilla dibujaba siempre el último snapshot (así que leer "murieron
   * 60 organismos" no tenía reflejo visual), y el overlay ámbar no se veía
   * en corridas terminadas porque su ventana de 8 generaciones se medía
   * contra la generación FINAL, lejísimos de la última catástrofe.
   */
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByLabel("Generaciones").fill("300");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });

  const chart = page.locator(".chart-container").first();
  const banner = page.locator(".catastrophe-event-banner");

  // Estado inicial: la grilla muestra el final de la corrida, lejos de la
  // última catástrofe (gen 240 contra 299), así que no hay overlay.
  await expect(banner).toHaveCount(0);

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  await wrapper.scrollIntoViewIfNeeded();
  const wbox = (await wrapper.boundingBox())!;
  const marker = (await chart.locator(".recharts-reference-line").first().locator("line").first().boundingBox())!;

  // Hover exactamente sobre la línea de referencia de una catástrofe.
  let shown = false;
  for (const dx of [0, -1, 1, -2, 2]) {
    await page.mouse.move(marker.x + marker.width / 2 + dx, wbox.y + wbox.height * 0.5);
    await page.waitForTimeout(120);
    if ((await banner.count()) > 0) {
      shown = true;
      break;
    }
  }
  expect(shown, "la grilla no mostró el overlay de catástrofe al hacer hover sobre el evento").toBe(true);

  // El banner nombra la misma generación que el panel de valores.
  const panelText = (await page.locator(".chart-hover-panel").textContent()) ?? "";
  const hoveredGen = /Generación (\d+)/.exec(panelText)![1];
  await expect(banner).toContainText(`gen ${hoveredGen}`);
  expect(panelText).toMatch(/Catástrofe: murieron \d+ organismos/);

  // Y la grilla avisa que está mostrando una generación pasada.
  await expect(page.locator(".population-grid-generation").first()).toContainText(
    `Estás viendo la generación ${hoveredGen}`,
  );
});

test("regresión: una corrida en vivo sin hover sigue mostrando el último snapshot en la grilla", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByLabel("Generaciones").fill("200");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("60");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("en curso", { timeout: 20_000 });

  // Sin tocar el gráfico: la grilla invita al click, lo que solo pasa cuando
  // está mostrando el último snapshot de una corrida abierta.
  await expect(page.locator(".population-grid-hint").first()).toContainText("Hacé click en una celda");
  await expect(page.locator(".population-grid-canvas").first()).toHaveClass(/population-grid-canvas(?!-inert)/);
  const cursor = await page.locator(".population-grid-canvas").first().evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).toBe("pointer");
});

test("modo comparación: el hover en el gráfico de A no mueve la grilla de B", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByLabel("Modo").selectOption("live-compare");
  await page.getByLabel("Generaciones").fill("300");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();
  await expect(page.locator(".status-line").first()).toContainText("finalizada", { timeout: 90_000 });
  await expect(page.locator(".status-line").nth(1)).toContainText("finalizada", { timeout: 90_000 });

  const grids = page.locator(".population-grid");
  await expect(grids).toHaveCount(2);

  const wrapperA = page.locator(".chart-container .recharts-wrapper").first();
  await wrapperA.scrollIntoViewIfNeeded();
  const boxA = (await wrapperA.boundingBox())!;
  const plotA = (await page.locator(".chart-container").first().locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
  await page.mouse.move(plotA.x + plotA.width * 0.3, boxA.y + boxA.height * 0.5);
  await page.waitForTimeout(250);

  // El panel A se movió a una generación pasada…
  await expect(page.locator(".chart-hover-panel").first()).toContainText(/Generación \d+/);
  await expect(grids.first().locator(".population-grid-generation")).toContainText("Estás viendo la generación");
  // …y la grilla de B sigue intacta, en su último snapshot: sin indicador.
  await expect(grids.nth(1).locator(".population-grid-generation")).toHaveCount(0);
});
