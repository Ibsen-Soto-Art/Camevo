/**
 * RF-008 (visibilizado): espeja el `Math.max(numAncestors, 2)` de
 * `apps/api/src/api/rest/config-request.ts` (`buildAncestorGenomes`) —
 * con clima activo, el servidor siempre siembra COMO MÍNIMO 2 linajes,
 * aunque el usuario haya pedido 1 (que es lo único que la UI ofrece hoy,
 * al no tener todavía un control para numAncestors). Si esa fórmula
 * cambia en el backend, hay que actualizar esta también — no hay una
 * sola fuente de verdad compartida porque el servidor nunca devuelve el
 * conteo YA resuelto, solo el solicitado (`PersistedRunConfig.numAncestors`).
 */
export function effectiveLineageCount(numAncestors: number, climateEnabled: boolean): number {
  return climateEnabled ? Math.max(numAncestors, 2) : numAncestors;
}
