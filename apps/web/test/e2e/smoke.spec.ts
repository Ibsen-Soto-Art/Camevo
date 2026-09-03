import { expect, test } from "@playwright/test";

test("crea una corrida corta y la transmite en vivo, sin errores de consola", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Camevo/i })).toBeVisible();

  // Corrida corta para que el smoke test sea rápido.
  await page.getByLabel("Generaciones").fill("20");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();

  await expect(page.locator(".status-line")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 30_000 });

  const lineCount = await page.locator(".chart-container svg .recharts-line").count();
  expect(lineCount).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
