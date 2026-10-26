import { expect, test, type Page } from "@playwright/test";
import { ensureFormOpen } from "./helpers";

/**
 * RNF-008: máximo dinámico del input de generaciones según el tamaño de la
 * grilla. Lo que solo se puede verificar en navegador real es el
 * comportamiento del input nativo: qué hace el atributo `max` con el tipeo,
 * con las flechas del spinner y con la validación del formulario.
 */
test.use({ viewport: { width: 1280, height: 900 } });

const gen = (page: Page) => page.getByLabel("Generaciones");
const ancho = (page: Page) => page.getByLabel("Ancho de grilla");
const alto = (page: Page) => page.getByLabel("Alto de grilla");

test("al cargar la página el input tiene el max de la grilla por defecto", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  const medido = await page.evaluate(() => {
    const numeros = document.querySelectorAll("input[type=number]");
    const w = Number((numeros[0] as HTMLInputElement).value);
    const h = Number((numeros[1] as HTMLInputElement).value);
    return { celdas: w * h };
  });
  // El max declarado tiene que coincidir con 3.000.000 / celdas, topeado en 5000.
  const esperado = Math.min(Math.floor(3_000_000 / medido.celdas), 5000);
  await expect(gen(page)).toHaveAttribute("max", String(esperado));
});

test("cambiar el ancho de la grilla actualiza el max del input", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  await ancho(page).fill("40");
  await alto(page).fill("40");
  await expect(gen(page)).toHaveAttribute("max", "1875");

  await ancho(page).fill("20");
  await expect(gen(page)).toHaveAttribute("max", "3750"); // 3.000.000 / 800

  await alto(page).fill("20");
  await expect(gen(page)).toHaveAttribute("max", "5000"); // topeado por el absoluto
});

test("ampliar la grilla clampea el valor en silencio", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  await ancho(page).fill("20");
  await alto(page).fill("20");
  await gen(page).fill("5000");
  await expect(gen(page)).toHaveValue("5000");

  await ancho(page).fill("40");
  await alto(page).fill("40");
  await expect(gen(page)).toHaveValue("1875");
  // Ajuste esperado, no un error: ni aviso rojo ni botón bloqueado.
  await expect(page.locator(".load-indicator-over")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iniciar corrida/ })).toBeEnabled();
});

test("el input NO rechaza ni clampea el tipeo: lo acepta y el aviso explica", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  await ancho(page).fill("40");
  await alto(page).fill("40");
  // Medido: `max` en un input numérico frena las flechas del spinner y hace
  // fallar la validación nativa, pero NO impide escribir un valor mayor. Esto
  // fija ese comportamiento real en vez de asumir que el input lo bloquea.
  await gen(page).fill("5000");
  await expect(gen(page)).toHaveValue("5000");

  const validez = await page.evaluate(() => {
    const g = [...document.querySelectorAll("input[type=number]")].find(
      (i) => (i as HTMLInputElement).max === "1875",
    ) as HTMLInputElement;
    return { valido: g.checkValidity(), formValido: (document.querySelector(".run-form") as HTMLFormElement).checkValidity() };
  });
  expect(validez.valido).toBe(false);
  expect(validez.formValido).toBe(false);

  // Y la app lo explica antes de que el usuario intente enviar.
  await expect(page.locator(".load-indicator")).toHaveClass(/load-indicator-over/);
  await expect(page.locator(".load-indicator")).toContainText("5000 es más de lo que el servidor sostiene");
  await expect(page.getByRole("button", { name: /Iniciar corrida/ })).toBeDisabled();
});

test("las flechas del spinner sí respetan el max", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  await ancho(page).fill("40");
  await alto(page).fill("40");
  await gen(page).fill("1874");
  await gen(page).press("ArrowUp");
  await expect(gen(page)).toHaveValue("1875");
  await gen(page).press("ArrowUp");
  await expect(gen(page)).toHaveValue("1875"); // no pasa del tope
});

test("el aviso informa el máximo, no la carga", async ({ page }) => {
  await page.goto("/");
  await ensureFormOpen(page);
  await ancho(page).fill("40");
  await alto(page).fill("40");
  const texto = (await page.locator(".load-indicator").textContent()) ?? "";
  expect(texto).toContain("1600 células");
  expect(texto).toContain("máx. 1875 generaciones");
  expect(texto).not.toMatch(/carga/i);
});

test("una corrida en el borde exacto del máximo arranca y termina", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await ensureFormOpen(page);
  // 25x25 = 625 celdas, donde la carga pasa a ser el límite activo (4800).
  await ancho(page).fill("25");
  await alto(page).fill("25");
  await expect(gen(page)).toHaveAttribute("max", "4800");
  await gen(page).fill("120");
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: /Iniciar corrida/ }).click();
  await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 120_000 });
  await expect(page.locator(".error")).toHaveCount(0);
});
