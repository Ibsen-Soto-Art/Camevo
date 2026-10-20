import { expect, test, type Page } from "@playwright/test";

/**
 * Invariantes responsive medidas en la auditoría de viewports. Solo se pueden
 * verificar en navegador real: son geometría y consultas de medios.
 *
 * `hasTouch`/`isMobile` no son decorativos: sin ellos Chromium reporta
 * `pointer: fine` incluso a 375px y las reglas de objetivo táctil no aplican
 * — el test pasaría o fallaría por la razón equivocada. Verificado: el
 * `summary` mide 34px sin emulación táctil y 52px con ella.
 */
const MOBILE = [
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
];

async function openForm(page: Page) {
  const details = page.locator(".config-details");
  if ((await details.getAttribute("open")) === null) {
    await page.getByText("Configuración de la corrida").click();
  }
}

async function startRun(page: Page, updates: string) {
  await openForm(page);
  await page.getByLabel("Ancho de grilla").fill("20");
  await page.getByLabel("Alto de grilla").fill("20");
  await page.getByLabel("Generaciones").fill(updates);
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: /Iniciar corrida/ }).click();
}

/** Desborde horizontal del documento: lo que produciría scroll lateral. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth };
  });
}

for (const vp of MOBILE) {
  test.describe(`${vp.name} (táctil)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    test("sin scroll horizontal en reposo, en curso y finalizada", async ({ page }) => {
      await page.goto("/");
      const reposo = await overflow(page);
      expect(reposo.bodyScroll, "reposo").toBeLessThanOrEqual(reposo.bodyClient);
      expect(reposo.scrollWidth).toBeLessThanOrEqual(reposo.clientWidth);

      await startRun(page, "100");
      await page.waitForSelector(".status-line", { timeout: 60_000 });
      const enCurso = await overflow(page);
      expect(enCurso.bodyScroll, "en curso").toBeLessThanOrEqual(enCurso.bodyClient);

      await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
      const terminada = await overflow(page);
      expect(terminada.bodyScroll, "finalizada").toBeLessThanOrEqual(terminada.bodyClient);

      // Y también en la pestaña Población, donde vive el canvas.
      await page.getByRole("tab", { name: "Población" }).click();
      const poblacion = await overflow(page);
      expect(poblacion.bodyScroll, "pestaña Población").toBeLessThanOrEqual(poblacion.bodyClient);
    });

    test("los controles tienen al menos 44px de alto", async ({ page }) => {
      await page.goto("/");
      await openForm(page);
      const chicos = await page.evaluate(() => {
        const sel = "button, .config-details > summary, select, input:not([type=range]), .run-form label.checkbox";
        return Array.from(document.querySelectorAll(sel))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return false;
            // El input del checkbox mide 24px a propósito: el objetivo es el
            // label que lo envuelve, que sí llega a 44px y recibe el click.
            if (el instanceof HTMLInputElement && el.type === "checkbox") return false;
            return r.height < 44;
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className || "-"}: ${Math.round(el.getBoundingClientRect().height)}px`);
      });
      expect(chicos, `controles por debajo de 44px: ${chicos.join(", ")}`).toEqual([]);
    });

    test("el botón de pausa de una corrida en curso llega a 44px", async ({ page }) => {
      await page.goto("/");
      await startRun(page, "3000");
      const pausar = page.getByRole("button", { name: "Pausar" });
      await expect(pausar).toBeVisible();
      const box = (await pausar.boundingBox())!;
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    });

    test("la grilla de población no desborda su contenedor", async ({ page }) => {
      await page.goto("/");
      await startRun(page, "100");
      await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 60_000 });
      await page.getByRole("tab", { name: "Población" }).click();

      const medido = await page.evaluate(() => {
        const canvas = document.querySelector(".population-grid canvas")!.getBoundingClientRect();
        const cont = document.querySelector(".population-grid")!.getBoundingClientRect();
        return {
          canvasRight: Math.round(canvas.right),
          contRight: Math.round(cont.right),
          canvasW: Math.round(canvas.width),
          contW: Math.round(cont.width),
        };
      });
      // Antes del fix el canvas medía exactamente 2px más que su contenedor
      // (el borde de 1px por lado, que `style.width` no descontaba).
      expect(medido.canvasW).toBeLessThanOrEqual(medido.contW);
      expect(medido.canvasRight).toBeLessThanOrEqual(medido.contRight);
    });
  });
}

test.describe("escritorio: el objetivo táctil no infla el layout", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("con puntero fino las reglas de 44px no aplican", async ({ page }) => {
    await page.goto("/");
    const fino = await page.evaluate(() => matchMedia("(pointer: fine)").matches);
    expect(fino).toBe(true);
    // Medido: aplicar 44px en todos los viewports costaba +250px de scroll
    // vertical en escritorio, para un problema que con mouse no existe.
    const altoSummary = await page.evaluate(() =>
      Math.round(document.querySelector(".config-details > summary")!.getBoundingClientRect().height),
    );
    expect(altoSummary).toBeLessThan(44);
    const o = await overflow(page);
    expect(o.bodyScroll).toBeLessThanOrEqual(o.bodyClient);
  });
});
