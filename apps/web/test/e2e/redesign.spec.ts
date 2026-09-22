import { expect, type Page, test } from "@playwright/test";

/**
 * Grupo 2 (rediseño visual): verificación real en navegador de la
 * propuesta aprobada — tokens de diseño, tipografía, layout de columnas
 * 30/70 en desktop / apilado en mobile-tablet, y que el botón "Guardar
 * esta corrida" quedó reordenado al cierre de la narrativa. Corre contra
 * la API y Postgres reales (no mocks), igual que el resto de la suite
 * e2e — es lo único que puede atrapar un desajuste real de layout, algo
 * que un test con jsdom (sin layout engine real) no puede medir.
 */

const VIEWPORTS = [
  { label: "375px (mobile)", width: 375, height: 812 },
  { label: "768px (tablet)", width: 768, height: 1024 },
  { label: "1280px (desktop)", width: 1280, height: 900 },
];

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

async function runShortSimulation(page: Page, generations = 8): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Generaciones").fill(String(generations));
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 20_000 });
}

test.describe("Grupo 2 (rediseño visual): tokens de diseño aplicados", () => {
  test("fondo oscuro, tipografías Fraunces/IBM Plex Sans, y textura de grilla estática cargan", async ({ page }) => {
    await page.goto("/");

    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
    });
    expect(body.backgroundColor).toBe("rgb(11, 21, 18)"); // #0b1512
    expect(body.backgroundImage).not.toBe("none"); // textura de grilla estática (no partículas animadas)

    const h1Font = await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily);
    expect(h1Font).toContain("Fraunces");

    const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily);
    expect(rootFont).toContain("IBM Plex Sans");
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`viewport ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("modo 'single': sin overflow horizontal, layout de columnas correcto, y 'Guardar esta corrida' después del panel explicativo", async ({
      page,
    }) => {
      await page.goto("/");
      expect(await hasHorizontalOverflow(page)).toBe(false);

      await runShortSimulation(page);
      expect(await hasHorizontalOverflow(page)).toBe(false);

      // Orden real en el DOM dentro de .run-panel: el bloque de guardado
      // (.save-run) debe aparecer DESPUÉS del panel explicativo — la
      // reubicación aprobada como "cierre de la narrativa", no pegado al
      // status-line de arriba.
      const classOrder = await page.evaluate(() => {
        const panel = document.querySelector(".run-panel");
        return panel ? Array.from(panel.children).map((el) => el.className) : [];
      });
      const explanatoryIndex = classOrder.findIndex((c) => c.includes("explanatory-panel"));
      const saveIndex = classOrder.findIndex((c) => c.includes("save-run"));
      expect(explanatoryIndex).toBeGreaterThan(-1);
      expect(saveIndex).toBeGreaterThan(explanatoryIndex);

      const controlsBox = await page.locator(".controls-column").boundingBox();
      const contentBox = await page.locator(".content-column").boundingBox();
      expect(controlsBox).not.toBeNull();
      expect(contentBox).not.toBeNull();

      if (viewport.width >= 900) {
        // Dos columnas lado a lado (30/70 aprobado): misma fila, controles entre 20-40% del ancho combinado.
        expect(Math.abs(controlsBox!.y - contentBox!.y)).toBeLessThan(20);
        const controlsRatio = controlsBox!.width / (controlsBox!.width + contentBox!.width);
        expect(controlsRatio).toBeGreaterThan(0.2);
        expect(controlsRatio).toBeLessThan(0.4);
      } else {
        // Apiladas: el contenido arranca debajo de los controles, no al lado.
        expect(contentBox!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height - 5);
      }
    });

    test("modo 'live-compare': dos corridas en paralelo renderizan sin overflow horizontal", async ({ page }) => {
      await page.goto("/");
      await page.getByLabel("Modo").selectOption("live-compare");
      await page.getByLabel("Generaciones").fill("8");
      await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();

      const statusLines = page.locator(".status-line");
      await expect(statusLines.first()).toContainText("done", { timeout: 20_000 });
      await expect(statusLines.nth(1)).toContainText("done", { timeout: 20_000 });

      expect(await page.locator(".run-panel").count()).toBe(2);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });

    test("modo 'saved-compare': nota de aislamiento por navegador visible, sin overflow horizontal", async ({ page }) => {
      await runShortSimulation(page, 5);
      await page.getByRole("button", { name: "Guardar esta corrida" }).click();
      await expect(page.getByRole("button", { name: "Guardada ✓" })).toBeVisible({ timeout: 10_000 });

      await page.getByLabel("Modo").selectOption("saved-compare");
      await expect(page.getByText(/únicas para este navegador y perfil/i)).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);

      await page.getByLabel(/corrida guardada a/i).selectOption({ index: 1 });
      await expect(page.locator(".run-panel").first().locator(".status-line")).toContainText("done", { timeout: 10_000 });
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
}
