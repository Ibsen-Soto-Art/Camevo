import { expect, test, type Page } from "@playwright/test";

/**
 * Layout de las dos tarjetas de ritmo en comparación en vivo. Solo se puede
 * verificar en navegador real: que estén lado a lado es geometría, y el
 * disparador es `auto-fit` contra el ancho real de `.controls-column`, que
 * jsdom no calcula.
 */
async function startLiveCompare(page: Page) {
  await page.goto("/");
  await page.getByLabel("Modo").selectOption("live-compare");
  // Lento y largo a propósito: las tarjetas solo existen mientras las dos
  // corridas siguen vivas (PlaybackControls devuelve null si terminaron).
  await page.getByLabel("Generaciones").fill("3000");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("200");
  await page.getByRole("button", { name: "Iniciar ambas corridas" }).click();
  await expect(page.locator(".playback-controls")).toHaveCount(2);
}

async function cards(page: Page) {
  return page.evaluate(() => {
    const cs = [...document.querySelectorAll(".live-compare-controls .playback-controls")] as HTMLElement[];
    return cs.map((c) => {
      const b = c.getBoundingClientRect();
      const button = c.querySelector("button")!.getBoundingClientRect();
      const slider = c.querySelector("input")!.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        width: Math.round(b.width),
        height: Math.round(b.height),
        buttonWidth: Math.round(button.width),
        sliderWidth: Math.round(slider.width),
      };
    });
  });
}

test.describe("desktop 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("las dos tarjetas quedan lado a lado y del mismo ancho mientras la corrida avanza", async ({ page }) => {
    await startLiveCompare(page);
    const [a, b] = await cards(page);

    // Mismo `top` = misma fila. Es la aserción que distingue lado a lado de
    // apilado, sin depender de píxeles concretos del layout.
    expect(a!.top).toBe(b!.top);
    expect(a!.width).toBe(b!.width);
    // Medido: 592px cada una dentro de una columna de 1200px. La cota de 700
    // fija que ninguna ocupa el ancho completo (antes medían 1200px).
    expect(a!.width).toBeLessThan(700);
    // Y el alto total es el de UNA tarjeta, no el de dos: medido 112px contra
    // los 240px que ocupaban apiladas.
    expect(a!.height).toBe(b!.height);
    expect(a!.height).toBeLessThan(150);
  });

  test("el botón y el slider siguen usables en las dos tarjetas", async ({ page }) => {
    await startLiveCompare(page);
    const both = await cards(page);
    for (const c of both) {
      // Medido: botón 83px, slider 133px — el slider no se comprime al
      // repartir la columna en dos, que es el riesgo de apretarlas.
      expect(c.buttonWidth).toBeGreaterThan(60);
      expect(c.sliderWidth).toBeGreaterThan(100);
    }
    const pausar = page.getByRole("button", { name: "Pausar" });
    await expect(pausar).toHaveCount(2);
    // Usable de verdad, no solo visible: el click cambia el estado.
    await pausar.first().click();
    await expect(page.getByRole("button", { name: "Reanudar" })).toHaveCount(1);
  });
});

test.describe("mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("en mobile siguen apiladas: dos tarjetas de 250px no entran", async ({ page }) => {
    await startLiveCompare(page);
    const [a, b] = await cards(page);
    expect(a!.top).not.toBe(b!.top);
    expect(b!.top).toBeGreaterThan(a!.top);
  });
});
