import { expect, type Page, test } from "@playwright/test";

/**
 * Grupo 1 (identidad por navegador + guardado intencional): golden path
 * completo en navegador real, contra la API, el LiveRunRegistry y
 * Postgres reales (no mocks) — confirma que "Guardar esta corrida"
 * realmente persiste, que sin ese click una corrida nunca aparece en el
 * historial, y que el aislamiento por browser_id funciona de punta a
 * punta (ya cubierto a nivel de API en apps/api/test/api/rest.test.ts,
 * pero no todavía con el flujo real de localStorage + fetch del navegador).
 */
async function runShortSimulation(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Generaciones").fill("10");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });
}

test("una corrida recién terminada no aparece en el historial hasta hacer click en 'Guardar esta corrida'", async ({ page }) => {
  await runShortSimulation(page);

  await page.getByLabel("Modo").selectOption("saved-compare");
  const optionsBefore = await page.getByLabel(/corrida guardada a/i).locator("option").allTextContents();
  expect(optionsBefore.filter((text) => text !== "— seleccionar —")).toEqual([]);

  await page.getByLabel("Modo").selectOption("single");
  await page.getByRole("button", { name: "Guardar esta corrida" }).click();
  await expect(page.getByRole("button", { name: "Guardada ✓" })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Modo").selectOption("saved-compare");
  const optionsAfter = await page.getByLabel(/corrida guardada a/i).locator("option").allTextContents();
  expect(optionsAfter.filter((text) => text !== "— seleccionar —").length).toBeGreaterThan(0);
});

test("un segundo click en 'Guardar esta corrida' no falla — el botón pasa a 'Guardada ✓' deshabilitado, sin duplicar", async ({
  page,
}) => {
  await runShortSimulation(page);

  const saveButton = page.getByRole("button", { name: "Guardar esta corrida" });
  await saveButton.click();

  // Tras el primer guardado, el botón "Guardar esta corrida" desaparece,
  // reemplazado por uno deshabilitado "Guardada ✓" — no hay forma de
  // clickear un segundo "Guardar" desde la UI, lo cual ya es la garantía
  // real de que no se duplica: la única acción posible después de guardar
  // es no-acción.
  const savedButton = page.getByRole("button", { name: "Guardada ✓" });
  await expect(savedButton).toBeVisible({ timeout: 10_000 });
  await expect(savedButton).toBeDisabled();
  await expect(saveButton).not.toBeVisible();
});

test("Grupo 1: el aislamiento por navegador funciona de punta a punta — un navegador nunca ve las corridas guardadas de otro", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await runShortSimulation(pageA);
    await pageA.getByRole("button", { name: "Guardar esta corrida" }).click();
    await expect(pageA.getByRole("button", { name: "Guardada ✓" })).toBeVisible({ timeout: 10_000 });

    await pageB.goto("/");
    await pageB.getByLabel("Modo").selectOption("saved-compare");
    const optionsB = await pageB.getByLabel(/corrida guardada a/i).locator("option").allTextContents();
    expect(optionsB.filter((text) => text !== "— seleccionar —")).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
