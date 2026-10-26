import type { Page } from "@playwright/test";

/**
 * Abre el formulario de configuración si está cerrado, y no hace nada si ya
 * está abierto.
 *
 * Hace falta desde que el formulario arranca COLAPSADO en viewports de menos
 * de 640px (ver `startsCollapsed` en App.tsx: a 375px eso ahorra 1252px de
 * scroll vertical antes de poder empezar). Sin esto, cualquier `fill()` sobre
 * un campo del formulario espera indefinidamente sobre un input oculto y el
 * test muere por timeout — es lo que le pasó a cinco tests de móvil.
 *
 * Es idempotente a propósito: un `click()` a ciegas sobre el `<summary>`
 * CERRARÍA el formulario en escritorio, donde arranca abierto.
 */
export async function ensureFormOpen(page: Page): Promise<void> {
  if ((await page.locator(".config-details").getAttribute("open")) === null) {
    await page.getByText("Configuración de la corrida").click();
  }
}
