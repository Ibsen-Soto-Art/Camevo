import { Genome, RandomSource } from "../organism/genome";
import { createOrganism } from "../organism/vm";
import { Grid } from "./grid";

/**
 * RF-008: siembra la grilla con varios organismos ancestrales distintos
 * simultáneamente (no un único genotipo semilla), en celdas distintas
 * elegidas al azar, para que la competencia entre linajes empiece desde
 * el inicio de la corrida.
 */
export function seedPopulation(
  grid: Grid,
  ancestorGenomes: readonly Genome[],
  mutationRate: number,
  rng: RandomSource,
  nextId: () => string,
): void {
  if (ancestorGenomes.length === 0) {
    throw new Error("Se requiere al menos un genoma ancestral");
  }
  if (ancestorGenomes.length > grid.size) {
    throw new Error("No hay suficientes celdas en la grilla para todos los ancestros");
  }

  const usedIndices = new Set<number>();
  for (const genome of ancestorGenomes) {
    let index: number;
    do {
      index = Math.floor(rng() * grid.size);
    } while (usedIndices.has(index));
    usedIndices.add(index);
    grid.cells[index] = createOrganism(genome, { mutationRate, id: nextId() });
  }
}
