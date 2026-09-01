import { createUniformGenome } from "../../engine/organism/genome";
import { GenerationSnapshot, runSimulation } from "./run";

/**
 * Script de demostración de la Fase 1 (docs/04-roadmap-fases.md): corre el
 * motor sin módulo climático y confirma a ojo el criterio de salida —
 * el fitness promedio de la población mejora consistentemente entre
 * corridas con distinta semilla, sin que ningún código decida quién
 * sobrevive (ver test/simulation/fitness-trend.test.ts para la versión
 * automatizada de esta misma verificación).
 *
 * Uso: npm run demo:fase1 -- [semilla] [updates]
 */
function averageOf(snapshots: readonly GenerationSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  const sum = snapshots.reduce((acc, s) => acc + s.averageFitness, 0);
  return sum / snapshots.length;
}

function runOne(seed: number, updates: number): void {
  const ancestorGenomeLength = 24;
  const result = runSimulation({
    gridWidth: 10,
    gridHeight: 10,
    baseCyclesPerUpdate: 20,
    mutationRate: 0.05,
    ancestorGenomes: [createUniformGenome("replicate", ancestorGenomeLength)],
    placementMode: "near-parent",
    updates,
    seed,
  });

  const quarter = Math.max(1, Math.floor(result.snapshots.length / 4));
  const early = result.snapshots.slice(0, quarter);
  const late = result.snapshots.slice(-quarter);

  console.log(`\n--- Semilla ${seed} ---`);
  console.log(`Fitness promedio primer cuarto: ${averageOf(early).toFixed(4)}`);
  console.log(`Fitness promedio último cuarto: ${averageOf(late).toFixed(4)}`);
  console.log(`Población final: ${result.grid.populationSize()}`);
}

const [seedArg, updatesArg] = process.argv.slice(2);
const updates = updatesArg ? Number(updatesArg) : 300;

if (seedArg) {
  runOne(Number(seedArg), updates);
} else {
  for (const seed of [1, 2, 3, 42, 12345]) {
    runOne(seed, updates);
  }
}
