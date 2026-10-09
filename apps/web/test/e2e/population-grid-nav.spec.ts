import { expect, test, type Page } from "@playwright/test";

/**
 * Slider de generaciones y centrado de la grilla. Lo que solo se puede
 * verificar en navegador real: que mover el slider mueva de verdad el
 * snapshot dibujado, que el gráfico de la OTRA pestaña quede en la misma
 * generación (la gráfica queda controlada desde RunPanel, no con su estado
 * interno), y la geometría del centrado, que en jsdom no existe.
 */
async function finishedRun(page: Page, generations = "300") {
  await page.goto("/");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByLabel("Generaciones").fill(generations);
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
}

async function openPopulationTab(page: Page) {
  const tab = page.getByRole("tab", { name: "Población" });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

const slider = (page: Page) => page.locator(".population-grid-nav input[type='range']");

test.describe("desktop 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("mover el slider dibuja esa generación en la grilla", async ({ page }) => {
    await finishedRun(page);
    await openPopulationTab(page);

    // 300 generaciones = 300 snapshots: el índice del slider y el número de
    // generación coinciden (las generaciones son contiguas desde 0).
    await slider(page).fill("89");
    await expect(page.locator(".population-grid-nav label")).toContainText("Generación 89 / 299");
    await expect(page.locator(".population-grid-generation")).toContainText(
      "Estás viendo la generación 89, no la más reciente.",
    );
  });

  test("las flechas del teclado saltan de un snapshot al siguiente", async ({ page }) => {
    await finishedRun(page);
    await openPopulationTab(page);

    await slider(page).fill("89");
    await slider(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".population-grid-nav label")).toContainText("Generación 88 / 299");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".population-grid-nav label")).toContainText("Generación 90 / 299");
  });

  test("mover el slider y volver a Gráfica: el panel de valores está en la misma generación", async ({ page }) => {
    await finishedRun(page);
    await openPopulationTab(page);
    await slider(page).fill("89");

    await page.getByRole("tab", { name: "Gráfica" }).click();
    // La gráfica quedó CONTROLADA desde RunPanel: sin eso seguiría mostrando
    // su propio último hover (o el placeholder), que era la asimetría que el
    // slider dejaba a la vista.
    await expect(page.locator(".chart-values-generation")).toHaveText("Generación 89");
  });

  test("el hover sobre la gráfica sigue moviendo la grilla (regresión del estado compartido)", async ({ page }) => {
    await finishedRun(page);

    const chart = page.locator(".chart-container").first();
    const wrapper = page.locator(".chart-container .recharts-wrapper").first();
    await wrapper.scrollIntoViewIfNeeded();
    const plot = (await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox())!;
    const wbox = (await wrapper.boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.3, wbox.y + wbox.height * 0.5);
    await expect(page.locator(".chart-hover-panel")).toContainText(/Generación \d+/);
    const hovered = Number((await page.locator(".chart-values-generation").textContent())!.replace(/\D/g, ""));

    await openPopulationTab(page);
    // El slider refleja el hover porque los dos escriben el MISMO estado.
    await expect(page.locator(".population-grid-nav label")).toContainText(`Generación ${hovered} / 299`);
    expect(await slider(page).inputValue()).toBe(String(hovered));
  });

  test("la grilla queda centrada en el ancho del panel", async ({ page }) => {
    await finishedRun(page);
    await openPopulationTab(page);

    const gaps = await page.evaluate(() => {
      const grid = document.querySelector(".population-grid")!.getBoundingClientRect();
      const canvas = document.querySelector(".population-grid canvas")!.getBoundingClientRect();
      return {
        left: canvas.left - grid.left,
        right: grid.right - canvas.right,
        canvasWidth: canvas.width,
        gridWidth: grid.width,
      };
    });

    // El canvas tiene ancho fijo en px (topeado en 700), así que en un panel
    // de ~1166px sobra espacio: lo que se verifica es que sobre lo MISMO a
    // los dos lados. Antes del centrado, left era 0 y right ~466.
    expect(gaps.canvasWidth).toBeLessThan(gaps.gridWidth);
    expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2);
    expect(gaps.left).toBeGreaterThan(50);
  });

  test("el ResizeObserver sigue midiendo después del centrado: el canvas no colapsa", async ({ page }) => {
    await finishedRun(page);
    await openPopulationTab(page);

    // `width: fit-content` sobre el wrapper podría haber dejado al canvas en
    // su ancho intrínseco (300px) si la medición se hubiera roto. Medido:
    // displaySize llega a 700, el tope de MAX_DISPLAY_SIZE, y la caja mide
    // 702 porque `getBoundingClientRect` incluye el borde de 1px por lado.
    const measured = await page.evaluate(() => {
      const canvas = document.querySelector(".population-grid canvas") as HTMLCanvasElement;
      return { inline: canvas.style.width, box: canvas.getBoundingClientRect().width };
    });
    expect(measured.inline).toBe("700px");
    expect(measured.box).toBe(702);
  });
});

test.describe("corrida en vivo", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("sigue al último snapshot hasta que el usuario lo mueve, y '↓ Último' lo devuelve", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("60");
    await page.getByLabel("Generaciones").fill("300");
    await page.getByRole("button", { name: "Iniciar corrida" }).click();
    await openPopulationTab(page);

    // Modo automático: sin tocar nada, el slider avanza solo.
    const first = Number(await slider(page).inputValue());
    await expect
      .poll(async () => Number(await slider(page).inputValue()), { timeout: 15_000 })
      .toBeGreaterThan(first);
    // Y sin aviso de "no es la más reciente", porque sí lo es.
    await expect(page.locator(".population-grid-generation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Último/ })).toHaveCount(0);

    // El usuario lo mueve: se queda ahí aunque la corrida siga avanzando.
    await slider(page).fill("3");
    await expect(page.locator(".population-grid-generation")).toContainText("Estás viendo la generación 3");
    const latestButton = page.getByRole("button", { name: /Último/ });
    await expect(latestButton).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await slider(page).inputValue()).toBe("3");

    // Y el botón lo devuelve al modo automático, no a un número congelado.
    await latestButton.click();
    await expect(latestButton).toHaveCount(0);
    await expect(page.locator(".population-grid-generation")).toHaveCount(0);
    const resumed = Number(await slider(page).inputValue());
    await expect
      .poll(async () => Number(await slider(page).inputValue()), { timeout: 15_000 })
      .toBeGreaterThan(resumed);
  });
});
