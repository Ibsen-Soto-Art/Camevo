import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { GenerationSnapshot, SimulationConfig, runSimulation } from "../../src/simulation/orchestrator/run";

/**
 * Verificación automatizada del criterio de salida de la Fase 1
 * (docs/04-roadmap-fases.md): "el fitness promedio de la población mejora
 * consistentemente entre corridas repetidas con distinta semilla, sin que
 * el código decida quién sobrevive".
 *
 * Nada en `run.ts` conoce de antemano qué organismo debe ganar: la única
 * regla de selección es RF-004 ("el más débil" = quien menos descendencia
 * ha producido), aplicada por igual a cualquier organismo. El genoma
 * ancestral (puro `replicate`) es deliberadamente más largo que los ciclos
 * de CPU base por actualización, así que el ancestro tarda 2 actualizaciones
 * en completar una copia; las deleciones que acortan el genoma (RF-003)
 * permiten a algunos linajes terminar en 1 sola actualización — el doble de
 * rápido — y ese es el único motivo por el que deberían desplazar al resto.
 */
function baseConfig(seed: number): SimulationConfig {
  return {
    gridWidth: 10,
    gridHeight: 10,
    baseCyclesPerUpdate: 20,
    mutationRate: 0.05,
    ancestorGenomes: [createUniformGenome("replicate", 24)],
    placementMode: "near-parent",
    updates: 300,
    seed,
  };
}

function averageFitness(snapshots: readonly GenerationSnapshot[]): number {
  const sum = snapshots.reduce((acc, s) => acc + s.averageFitness, 0);
  return sum / snapshots.length;
}

describe("Criterio de salida de la Fase 1: la selección natural emerge", () => {
  const seeds = [1, 2, 3, 42, 12345];

  it.each(seeds)("semilla %i: el fitness del último cuarto de la corrida supera al del primero", (seed) => {
    const { snapshots } = runSimulation(baseConfig(seed));
    const quarter = Math.floor(snapshots.length / 4);

    const early = averageFitness(snapshots.slice(0, quarter));
    const late = averageFitness(snapshots.slice(-quarter));

    expect(late).toBeGreaterThan(early);
  });

  it("con la misma semilla, dos corridas producen exactamente la misma trayectoria de fitness (RNF-003)", () => {
    const runA = runSimulation(baseConfig(7));
    const runB = runSimulation(baseConfig(7));
    expect(runA.snapshots).toEqual(runB.snapshots);
  });

  it("la población nunca excede el tamaño de la grilla", () => {
    const { snapshots, grid } = runSimulation(baseConfig(9));
    for (const snapshot of snapshots) {
      expect(snapshot.populationSize).toBeLessThanOrEqual(grid.size);
    }
  });
});
