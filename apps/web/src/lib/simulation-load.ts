/**
 * RNF-008: cuántas generaciones admite una grilla, del lado del cliente.
 *
 * Vive en su propio módulo y no en `App.tsx` por dos razones: exportar algo
 * que no es un componente desde un archivo de componentes rompe Fast Refresh
 * (oxlint lo marca), y es lógica pura que conviene poder testear sin
 * renderizar nada.
 */

/**
 * Debe coincidir con `MAX_SIMULATION_LOAD` en
 * `apps/api/src/api/rest/config-request.ts`, donde está el razonamiento y la
 * medición (339 MB retenidos en el peor caso que los límites campo a campo
 * permitían, lineal a ~42,4 MB por millón de carga).
 *
 * Se duplica el literal, igual que con `CLIMATE_VARIANCE_AMPLITUDE_MAX`:
 * `@camevo/shared-types` es solo-tipos y no puede exportar valores (su
 * `exports` tiene únicamente la condición `types`, y un export de valor
 * typechequea pero falla en runtime con `ERR_PACKAGE_PATH_NOT_EXPORTED`).
 * Un test lee la fuente del backend para que la desincronización se detecte.
 *
 * El servidor es la autoridad: si este número quedara desactualizado hacia
 * arriba, el formulario dejaría enviar y el servidor contestaría 422, que el
 * formulario muestra igual. El costo es un aviso tardío, no una corrida que el
 * servidor no pueda sostener.
 */
export const MAX_SIMULATION_LOAD = 3_000_000;

/**
 * Tope absoluto de `updates`, igual que en `LIMITS` del servidor. Manda sobre
 * la fórmula de carga: para 10x10 la carga permitiría 30.000 generaciones,
 * pero el servidor rechaza con 400 cualquier `updates` por encima de 5000. Sin
 * este `min`, el formulario ofrecería un máximo que el servidor no acepta —
 * peor que el problema que el máximo dinámico viene a resolver.
 */
export const ABSOLUTE_MAX_GENERATIONS = 5000;

/**
 * Recién desde 25x25 (625 celdas) la carga es el límite activo, con 4800; por
 * debajo manda el tope absoluto. 40x40 da 1875.
 */
export function maxGenerationsFor(gridWidth: number, gridHeight: number): number {
  const cells = gridWidth * gridHeight;
  if (cells <= 0) return ABSOLUTE_MAX_GENERATIONS;
  return Math.min(Math.floor(MAX_SIMULATION_LOAD / cells), ABSOLUTE_MAX_GENERATIONS);
}
