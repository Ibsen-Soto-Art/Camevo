import type { GenerationSnapshot } from "./camevo-client";

/**
 * RF-015 (marcadores visuales): generaciones donde ocurrió un evento
 * catastrófico, ya calculadas por el servidor (`catastropheOccurred`,
 * GenerationSnapshot) — no se re-deriva ningún intervalo acá.
 */
export function getCatastropheGenerations(snapshots: readonly GenerationSnapshot[]): number[] {
  return snapshots.filter((s) => s.catastropheOccurred).map((s) => s.generation);
}
