import { RandomSource } from "../organism/genome";
import { Grid } from "./grid";

export type PlacementMode = "near-parent" | "random";

function pickWeakestIndex(grid: Grid, indices: readonly number[], rng: RandomSource): number {
  let weakestScore = Number.POSITIVE_INFINITY;
  let candidates: number[] = [];
  for (const index of indices) {
    const organism = grid.cells[index];
    if (!organism) continue;
    if (organism.offspringProduced < weakestScore) {
      weakestScore = organism.offspringProduced;
      candidates = [index];
    } else if (organism.offspringProduced === weakestScore) {
      candidates.push(index);
    }
  }
  if (candidates.length === 0) {
    throw new Error("No hay vecinos ocupados entre los que elegir al más débil");
  }
  return candidates[Math.floor(rng() * candidates.length)] as number;
}

/**
 * RF-009 (modo de colocación) y RF-004 (regla de reemplazo) resueltos
 * juntos, tal como pide 03-arquitectura.md: una estrategia intercambiable
 * dentro del módulo, no un `if` disperso en el motor.
 *
 * - "random": la cría cae en cualquier celda de la grilla (población bien
 *   mezclada); si está ocupada, su ocupante es reemplazado directamente,
 *   sin comparar méritos — coherente con no tener estructura espacial.
 * - "near-parent": la cría intenta ocupar una celda vacía vecina; si todas
 *   las vecinas están ocupadas, reemplaza al vecino "más débil" (el que
 *   menos descendencia ha producido en su vida — RF-004), con empates
 *   resueltos al azar para no introducir un sesgo determinista.
 */
export function chooseBirthTargetIndex(
  grid: Grid,
  parentIndex: number,
  mode: PlacementMode,
  rng: RandomSource,
): number {
  if (mode === "random") {
    return Math.floor(rng() * grid.size);
  }

  const neighbors = grid.neighborIndices(parentIndex);
  const emptyNeighbors = neighbors.filter((index) => grid.cells[index] === null);
  if (emptyNeighbors.length > 0) {
    return emptyNeighbors[Math.floor(rng() * emptyNeighbors.length)] as number;
  }
  return pickWeakestIndex(grid, neighbors, rng);
}
