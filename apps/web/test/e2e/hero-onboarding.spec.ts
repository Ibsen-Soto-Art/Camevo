import { expect, test } from "@playwright/test";

/**
 * RNF-004 (2ª verificación con persona real): requisito explícito del
 * hero — "en móvil tiene que caber sin hacer scroll". Regresión
 * permanente para que un futuro agregado al hero (o al mode-select justo
 * debajo) no vuelva a empujarlo fuera del viewport sin que nadie lo note.
 */
test("el hero cabe sin scroll en un viewport mobile típico (375x667, iPhone SE)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const hero = page.locator(".hero");
  const heroBox = (await hero.boundingBox())!;
  expect(heroBox.y + heroBox.height, "el hero debe terminar dentro del viewport visible (sin scroll)").toBeLessThanOrEqual(667);
});
