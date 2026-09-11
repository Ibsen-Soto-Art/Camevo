import { expect, test } from "@playwright/test";

/**
 * Fase 6: verificación real en navegador de las tres piezas nuevas —
 * unit tests con mocks no habrían atrapado un preset mal cableado a los
 * selectores reales, ni el selector de fuente climática desconectado del
 * body real de POST /runs, ni la cita del IPCC ausente del DOM real tras
 * una extinción real (no simulada).
 */
test("escenario preconfigurado autocompleta velocidad y muestra la narrativa", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "¿Puede la vida adaptarse?" }).click();

  await expect(page.locator(".scenario-narrative")).toContainText("rescate evolutivo");
  await expect(page.getByLabel("Velocidad del cambio climático")).toHaveValue("slow");
});

test("fuente de la tendencia climática: elegir 'historical' muestra la nota de NASA GISTEMP", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Fuente de la tendencia climática").selectOption("historical");

  await expect(page.locator(".form-note", { hasText: /NASA GISTEMP/i })).toBeVisible();
});

test("una corrida rápida que termina en extinción muestra la cita del IPCC AR6 con fuente exacta", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/");
  await page.getByRole("button", { name: "Cambio climático acelerado" }).click();
  await page.getByLabel("Generaciones").fill("200");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();

  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  await expect(page.getByText(/se extinguió en la generación/i)).toBeVisible();
  await expect(page.getByText(/3% y el 14%/)).toBeVisible();
  await expect(page.getByText(/IPCC.*AR6.*2022/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
