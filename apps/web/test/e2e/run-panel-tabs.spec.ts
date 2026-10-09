import { expect, test, type Page } from "@playwright/test";

/**
 * Pestañas de "Una corrida". Lo que solo se puede verificar en navegador
 * real: que la pestaña inactiva siga MIDIENDO aunque esté invisible, que es
 * la condición de que la sincronización gráfico↔grilla no se corte.
 *
 * La técnica es `position: absolute; opacity: 0` en la pestaña inactiva, no
 * `display: none` ni `height: 0`: `opacity` no afecta al layout, así que el
 * ResizeObserver de PopulationGrid y el ResponsiveContainer de RunChart
 * siguen viendo el ancho real. El `left/right: 0` es obligatorio — sin eso
 * un absoluto toma ancho shrink-to-fit y la grilla mediría mal.
 */
async function finishedRun(page: Page) {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByLabel("Generaciones").fill("300");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
}

async function plotWidth(page: Page): Promise<number> {
  const line = page.locator(".chart-container .recharts-cartesian-grid-horizontal line").first();
  return Math.round((await line.boundingBox())!.width);
}

test.describe("desktop 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ir a Población y volver a Gráfica deja el gráfico midiendo igual que antes", async ({ page }) => {
    await finishedRun(page);
    const before = await plotWidth(page);
    expect(before).toBeGreaterThan(0);

    await page.getByRole("tab", { name: "Población" }).click();
    await expect(page.getByRole("tab", { name: "Población" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Gráfica" }).click();
    await expect(page.getByRole("tab", { name: "Gráfica" })).toHaveAttribute("aria-selected", "true");

    // Medido: 996px en los dos momentos — ResponsiveContainer nunca perdió
    // la medición porque el panel jamás se desmontó ni colapsó su ancho.
    expect(await plotWidth(page)).toBe(before);
  });

  test("hover en el gráfico y cambio de pestaña: la grilla ya muestra esa generación, sin volver a pasar el mouse", async ({
    page,
  }) => {
    await finishedRun(page);

    const chart = page.locator(".chart-container").first();
    const wrapper = page.locator(".chart-container .recharts-wrapper").first();
    await wrapper.scrollIntoViewIfNeeded();
    const plot = (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
    const wbox = (await wrapper.boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.3, wbox.y + wbox.height * 0.5);
    // El panel se llena por un re-render de React: hay que esperarlo en vez
    // de leer justo después del movimiento del mouse.
    await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/);

    const panelText = await page.locator(".chart-hover-panel").textContent();
    const hoveredGen = /Generación (\d+)/.exec(panelText ?? "")?.[1];
    expect(hoveredGen, `el panel no mostró una generación. Panel: ${panelText}`).toBeDefined();

    await page.getByRole("tab", { name: "Población" }).click();

    // Sin tocar nada más: la grilla ya está en la generación hoviada.
    await expect(page.locator(".population-grid-generation")).toContainText(
      `Estás viendo la generación ${hoveredGen}`,
    );
  });

  test("la grilla mide su ancho real estando en la pestaña inactiva", async ({ page }) => {
    await finishedRun(page);

    // Con "Gráfica" activa, la grilla está invisible pero en layout.
    const measured = await page.evaluate(() => {
      const grid = document.querySelector(".population-grid") as HTMLElement;
      const canvas = document.querySelector(".population-grid-canvas") as HTMLCanvasElement;
      const panel = grid.closest(".run-tabpanel") as HTMLElement;
      return {
        gridWidth: Math.round(grid.getBoundingClientRect().width),
        canvasBacking: canvas.width,
        inactive: panel.classList.contains("run-tabpanel-inactive"),
        opacity: getComputedStyle(panel).opacity,
      };
    });

    expect(measured.inactive).toBe(true);
    expect(measured.opacity).toBe("0");
    // Lo que importa: ancho real, no 0 ni shrink-to-fit.
    expect(measured.gridWidth).toBeGreaterThan(500);
    expect(measured.canvasBacking).toBeGreaterThan(0);
  });

  test("el indicador de estado queda visible con cualquier pestaña activa", async ({ page }) => {
    await finishedRun(page);
    const outsideTabs = () =>
      page.evaluate(() => {
        const status = document.querySelector(".status-line");
        return status !== null && status.closest(".run-tabpanel") === null;
      });

    await expect(page.locator(".status-line")).toBeVisible();
    expect(await outsideTabs()).toBe(true);

    await page.getByRole("tab", { name: "Población" }).click();
    await expect(page.locator(".status-line")).toBeVisible();
    expect(await outsideTabs()).toBe(true);
  });

  test("la pestaña inactiva es inert: su contenido sale del orden de tabulación", async ({ page }) => {
    /*
     * `opacity: 0` NO saca del orden de tabulación ni del árbol de
     * accesibilidad. Sin `inert`, los ítems de la leyenda (tabIndex=0) y el
     * botón de guardar de la pestaña oculta seguirían siendo alcanzables con
     * Tab, invisibles — una trampa de foco.
     */
    await finishedRun(page);
    await page.getByRole("tab", { name: "Población" }).click();

    const hiddenFocusables = await page.evaluate(
      () => document.querySelectorAll(".run-tabpanel-inactive button, .run-tabpanel-inactive [tabindex='0']").length,
    );
    expect(hiddenFocusables).toBeGreaterThan(0); // hay candidatos…
    await expect(page.locator(".run-tabpanel-inactive")).toHaveAttribute("inert", /.*/); // …y quedan inertes

    // Recorrido real con Tab: nunca cae dentro del panel inerte.
    await page.getByRole("tab", { name: "Población" }).focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const insideInert = await page.evaluate(() => document.activeElement?.closest("[inert]") !== null);
      expect(insideInert, `la tabulación ${i + 1} cayó dentro del panel inerte`).toBe(false);
    }
  });
});

test.describe("mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("las pestañas también están en mobile, donde el scroll es más pronunciado", async ({ page }) => {
    await finishedRun(page);
    await expect(page.getByRole("tab", { name: "Gráfica" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Población" })).toBeVisible();

    await page.getByRole("tab", { name: "Población" }).click();
    await expect(page.locator(".population-grid")).toBeVisible();
  });
});

test.describe("regresión: los modos de comparación no tienen pestañas", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("comparar en vivo: dos paneles, cero pestañas", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Modo").selectOption("live-compare");
    await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
    await page.getByLabel("Generaciones").fill("150");
    await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();
    await expect(page.locator(".status-line").first()).toContainText("finalizada", { timeout: 90_000 });

    await expect(page.locator('[role="tab"]')).toHaveCount(0);
    await expect(page.locator(".run-panel")).toHaveCount(2);
    // Y el contenido de los dos sigue apilado, con gráfico y grilla a la vez.
    await expect(page.locator(".chart-container")).toHaveCount(2);
    await expect(page.locator(".population-grid")).toHaveCount(2);
  });

  test("comparar guardadas: tampoco", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Modo").selectOption("saved-compare");
    await expect(page.locator('[role="tab"]')).toHaveCount(0);
  });
});
