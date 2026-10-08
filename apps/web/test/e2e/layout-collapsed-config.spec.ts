import { expect, test, type Page } from "@playwright/test";

/**
 * Con el formulario de configuración colapsado, la columna de contenido se
 * queda con todo el ancho. Es CSS puro (`:has()`), sin estado nuevo en
 * React — que además es la única forma que funciona: `open` se pasa como
 * valor inicial junto a un `key` y no hay `onToggle`, así que cuando el
 * usuario abre o cierra el panel React no se entera.
 *
 * Solo verificable en navegador real: depende de layout de grid resuelto y
 * de `:has()`, que jsdom no implementa.
 */
async function plotWidth(page: Page): Promise<number> {
  const line = page.locator(".chart-container .recharts-cartesian-grid-horizontal line").first();
  return Math.round((await line.boundingBox())!.width);
}

/**
 * Ancho del trazado una vez que dejó de moverse.
 *
 * Al alternar el `<details>` el layout reflúye y `ResponsiveContainer`
 * re-mide de forma ASÍNCRONA (su propio ResizeObserver), así que leer el
 * ancho justo después del click puede devolver el valor viejo o uno
 * intermedio. Medido: con una aserción de igualdad exacta inmediatamente
 * después del toggle, el test falló en una corrida completa de cada seis.
 */
async function settledPlotWidth(page: Page): Promise<number> {
  let previous = -1;
  for (let i = 0; i < 40; i++) {
    const current = await plotWidth(page);
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(50);
  }
  return previous;
}

async function finishedRun(page: Page) {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByLabel("Generaciones").fill("150");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
}

test.describe("desktop 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("el área de trazado es más ancha con el formulario colapsado que con el formulario abierto", async ({ page }) => {
    await finishedRun(page);
    const details = page.locator(".config-details");

    // Tras arrancar una corrida el formulario queda colapsado.
    await expect(details).not.toHaveAttribute("open", /.*/);
    const collapsed = await settledPlotWidth(page);

    await page.getByText("Configuración de la corrida").click();
    await expect(details).toHaveAttribute("open", /.*/);
    const open = await settledPlotWidth(page);

    // Medido: 996px colapsado contra 612px abierto en un viewport de 1280.
    expect(collapsed).toBeGreaterThan(open);
    expect(collapsed - open).toBeGreaterThan(200);

    // Y al volver a colapsar recupera el ancho, sin quedar a medio camino.
    await page.getByText("Configuración de la corrida").click();
    await expect(details).not.toHaveAttribute("open", /.*/);
    expect(await settledPlotWidth(page)).toBe(collapsed);
  });

  test("abierto son dos columnas; colapsado es una sola y el panel queda arriba, clickeable para reabrir", async ({
    page,
  }) => {
    await finishedRun(page);

    const geometry = () =>
      page.evaluate(() => {
        const layout = document.querySelector(".app-layout") as HTMLElement;
        const controls = (document.querySelector(".controls-column") as HTMLElement).getBoundingClientRect();
        const content = (document.querySelector(".content-column") as HTMLElement).getBoundingClientRect();
        return {
          tracks: getComputedStyle(layout).gridTemplateColumns.split(" ").length,
          controlsAboveContent: controls.top < content.top,
          sameWidth: Math.abs(controls.width - content.width) < 2,
        };
      });

    // Colapsado: una pista, y el formulario pasa a ser una barra arriba del
    // contenido en vez de una columna a la izquierda.
    const collapsed = await geometry();
    expect(collapsed.tracks).toBe(1);
    expect(collapsed.controlsAboveContent).toBe(true);
    expect(collapsed.sameWidth).toBe(true);

    // El <summary> sigue visible y sirve para reabrir: es la razón por la
    // que la primera columna no se colapsa a 0 de ancho.
    await expect(page.getByText("Configuración de la corrida")).toBeVisible();
    await page.getByText("Configuración de la corrida").click();

    const open = await geometry();
    expect(open.tracks).toBe(2);
    expect(open.sameWidth).toBe(false);
  });
});

test.describe("mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("por debajo de 900px no cambia nada: una sola columna con el formulario abierto o cerrado", async ({ page }) => {
    await finishedRun(page);
    const details = page.locator(".config-details");

    const tracks = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector(".app-layout") as HTMLElement).gridTemplateColumns.split(" ").length,
      );

    expect(await tracks()).toBe(1);
    const collapsedWidth = await settledPlotWidth(page);

    await page.getByText("Configuración de la corrida").click();
    await expect(details).toHaveAttribute("open", /.*/);
    expect(await tracks()).toBe(1);
    // El ancho del trazado no depende del estado del formulario en mobile.
    expect(await settledPlotWidth(page)).toBe(collapsedWidth);
  });
});

test.describe("modos de comparación", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("comparar corridas GUARDADAS: no hay .app-layout ni <details>, así que el layout no puede cambiar", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Modo").selectOption("saved-compare");

    // Esa ruta renderiza un fragmento con .saved-compare-header y
    // .compare-grid, fuera de .app-layout: `:has()` no tiene dónde aplicar.
    await expect(page.locator(".app-layout")).toHaveCount(0);
    await expect(page.locator(".config-details")).toHaveCount(0);
    await expect(page.locator(".saved-compare-header")).toBeVisible();
  });

  test("comparar corridas EN VIVO: sí tiene formulario, y colapsarlo ensancha los dos paneles a la vez", async ({
    page,
  }) => {
    /*
     * El caso que la premisa del pedido daba por descartado: "en modo
     * comparación no hay columna izquierda de controles". Eso es cierto para
     * las corridas guardadas, pero el modo en vivo comparte el mismo
     * `.app-layout` con su `.controls-column`, así que el colapso también
     * aplica ahí — y conviene, porque son dos gráficos compitiendo por el
     * ancho.
     */
    await page.goto("/");
    await page.getByLabel("Modo").selectOption("live-compare");
    await expect(page.locator(".app-layout")).toHaveCount(1);
    await expect(page.locator(".config-details")).toHaveCount(1);

    const details = page.locator(".config-details");
    await expect(details).toHaveAttribute("open", /.*/);
    const widthsOpen = await page
      .locator(".compare-grid .chart-container")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(widthsOpen).toHaveLength(2);

    await page.getByText("Configuración de la corrida").click();
    await expect(details).not.toHaveAttribute("open", /.*/);
    const widthsCollapsed = await page
      .locator(".compare-grid .chart-container")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));

    // Los DOS paneles se ensanchan, no solo el primero.
    expect(widthsCollapsed[0]!).toBeGreaterThan(widthsOpen[0]!);
    expect(widthsCollapsed[1]!).toBeGreaterThan(widthsOpen[1]!);
  });
});

test.describe("el margen derecho del gráfico no depende del ancho del layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("con los tres ejes Y activos, el hueco derecho es idéntico colapsado y expandido", async ({ page }) => {
    /*
     * Esto es lo que hace innecesario un ResizeObserver en RunChart: el
     * margen de `resolveChartMargin` está en píxeles y no depende del ancho,
     * y `ResponsiveContainer` ya re-mide y re-dispone el gráfico solo.
     * Medido: 180px de hueco derecho en los dos estados, con el SVG pasando
     * de 782px a 1166px.
     */
    await finishedRun(page);
    await page.waitForFunction(() => document.querySelectorAll(".chart-legend-item").length >= 6, { timeout: 20_000 });
    for (const name of ["Clima: AND", "Clima: NOT", "Clima: OR"]) {
      await page.locator(".chart-legend-item", { hasText: name }).click();
    }

    const rightGap = () =>
      page.evaluate(() => {
        const svg = document.querySelector(".chart-container svg.recharts-surface")!.getBoundingClientRect();
        const grid = document.querySelector(".chart-container .recharts-cartesian-grid-horizontal line")!.getBoundingClientRect();
        return { gap: Math.round(svg.x + svg.width - (grid.x + grid.width)), svg: Math.round(svg.width) };
      });

    const collapsed = await rightGap();
    await page.getByText("Configuración de la corrida").click();
    await page.waitForTimeout(300);
    const open = await rightGap();

    expect(collapsed.svg).toBeGreaterThan(open.svg); // el gráfico sí cambia de ancho…
    expect(collapsed.gap).toBe(open.gap); // …y el margen derecho no.
  });
});
