import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * RF-027: flujo completo real en navegador, contra la API y el registro
 * en memoria reales (no mocks) — es exactamente el caso que un test
 * unitario con `fetch` simulado no puede atrapar: que el endpoint
 * realmente esté cableado end-to-end (backend registrando el
 * SimulationState en vivo, ruta REST leyéndolo, frontend mostrando el
 * resultado).
 *
 * Grilla 2x2 (el mínimo permitido por el formulario, `min={2}`) sin
 * clima: un solo ancestro, sembrado en una celda elegida por el RNG
 * (seeding.ts, `Math.floor(rng() * grid.size)`) — determinística por
 * semilla, pero no en un índice fijo conocido de antemano. En vez de
 * asumir una posición, se prueban las 4 celdas en orden hasta encontrar
 * la ocupada — robusto sin importar dónde cayó la siembra.
 */
async function setupOneCellGrid(page: Page, generations: number, msPerGeneration: number) {
  await page.goto("/");
  await page.getByRole("checkbox", { name: /módulo climático activo/i }).uncheck();
  await page.getByLabel("Ancho de grilla").fill("2");
  await page.getByLabel("Alto de grilla").fill("2");
  await page.getByLabel("Generaciones").fill(String(generations));
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill(String(msPerGeneration));
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
}

/** Clickea las 4 celdas de una grilla 2x2 en orden hasta que el panel deje de decir "Hábitat vacío". */
async function clickUntilOrganismFound(page: Page, canvas: Locator): Promise<void> {
  const box = (await canvas.boundingBox())!;
  const positions = [
    { x: box.width * 0.25, y: box.height * 0.25 },
    { x: box.width * 0.75, y: box.height * 0.25 },
    { x: box.width * 0.25, y: box.height * 0.75 },
    { x: box.width * 0.75, y: box.height * 0.75 },
  ];
  for (const position of positions) {
    await canvas.click({ position });
    const panelText = await page.locator(".organism-inspect-panel").innerText();
    if (!panelText.includes("Hábitat vacío")) return;
  }
  throw new Error("Ninguna de las 4 celdas de la grilla 2x2 tenía un organismo — inesperado, revisar seeding.ts");
}

test("click en la celda ocupada de una corrida EN VIVO (todavía corriendo) muestra el detalle real del organismo", async ({ page }) => {
  // Ritmo lento a propósito: con 0ms/generación la corrida termina (y
  // streamRunLive ya sacó el runId del registro, try/finally) antes de
  // que el click llegue a viajar — hay que atraparla mientras sigue
  // "running", no esperar a "done".
  await setupOneCellGrid(page, 20, 400);
  await expect(page.locator(".status-line")).toContainText("running", { timeout: 10_000 });

  await clickUntilOrganismFound(page, page.locator(".population-grid-canvas"));

  await expect(page.locator(".organism-inspect-panel")).toContainText(/Produjo \d+ crías/);
  await expect(page.locator(".organism-inspect-panel")).toContainText(/Generación \d+/);
  await expect(page.locator(".organism-inspect-panel")).toContainText(/Posición en la grilla: \(\d, \d\)/);
});

test("click en una corrida que ya terminó muestra el 404 específico de 'corrida no activa', no un error genérico", async ({ page }) => {
  // Cubre el caso que motivó la condición de diseño: el registro en
  // memoria (LiveRunRegistry) saca la corrida apenas streamRunLive
  // termina (try/finally) — igual que pasaría con una corrida guardada
  // (RF-025) o con un reinicio del servidor. El mensaje debe ser
  // específico, no un spinner indefinido ni un error de consola.
  await setupOneCellGrid(page, 3, 0);
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  await clickUntilOrganismFound(page, page.locator(".population-grid-canvas"));

  await expect(page.locator(".organism-inspect-panel")).toContainText("La corrida ya no está activa en el servidor", {
    timeout: 10_000,
  });
});
