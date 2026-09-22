const STORAGE_KEY = "camevo_browser_id";

/**
 * Grupo 1 (identidad anónima por navegador): un UUID v4 generado una sola
 * vez y guardado en localStorage — sin login, sin cuentas, sin email. Si
 * se borra el localStorage (o las cookies del sitio), este id y el acceso
 * a las corridas guardadas con él desaparecen junto con él: eso es el
 * comportamiento correcto y esperado, no un bug.
 */
export function getBrowserId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
