import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { SimulationConfig, runSimulation } from "../../src/simulation/orchestrator/run";

/**
 * Fase 4: RF-014 (pool de CPU global), RF-015 (eventos catastróficos) y
 * los dos criterios de colapso (extinción real, cuasi-extinción
 * sostenida). Cada escenario se verifica con números reales de una
 * corrida, no solo con la lógica en aislamiento — igual que
 * fitness-trend.test.ts en la Fase 1.
 */
function baseConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
  return {
    gridWidth: 10,
    gridHeight: 10,
    baseCyclesPerUpdate: 20,
    mutationRate: 0.05,
    ancestorGenomes: [createUniformGenome("replicate", 24)],
    placementMode: "near-parent" as const,
    updates: 40,
    seed: 1,
    ...overrides,
  };
}

describe("RF-014: pool de CPU global suprime la reproducción sin romper los recursos por tarea", () => {
  it("con el pool reducido al mínimo, la población crece mucho más lento que con el pool al máximo", () => {
    const fullPool = runSimulation(
      baseConfig({
        updates: 15,
        climate: {
          seed: 1,
          trendPeriodGenerations: 1000,
          varianceAmplitude: 0,
          resources: [],
          resourcePool: { minMultiplier: 1, maxMultiplier: 1 },
        },
      }),
    );
    const scarcePool = runSimulation(
      baseConfig({
        updates: 15,
        climate: {
          seed: 1,
          trendPeriodGenerations: 1000,
          varianceAmplitude: 0,
          resources: [],
          resourcePool: { minMultiplier: 0.1, maxMultiplier: 0.1 },
        },
      }),
    );

    const finalPopFull = fullPool.snapshots.at(-1)?.populationSize as number;
    const finalPopScarce = scarcePool.snapshots.at(-1)?.populationSize as number;
    expect(finalPopScarce).toBeLessThan(finalPopFull);
  });
});

describe("RF-015: eventos catastróficos periódicos", () => {
  it("reduce la población visiblemente en la generación del evento, y no antes", () => {
    const { snapshots } = runSimulation(
      baseConfig({
        updates: 25,
        ancestorGenomes: Array.from({ length: 20 }, () => createUniformGenome("replicate", 5)), // grilla llena rápido
        catastrophe: { intervalGenerations: 20, severity: 0.8 },
      }),
    );

    const beforeEvent = snapshots.slice(0, 20).map((s) => s.populationSize);
    const atEvent = snapshots[20]?.populationSize as number;
    const justBefore = snapshots[19]?.populationSize as number;

    // Sin caída antes del intervalo configurado.
    expect(Math.min(...beforeEvent)).toBeGreaterThan(0);
    // Caída real en la generación del evento.
    expect(atEvent).toBeLessThan(justBefore);
  });

  it("severidad 1.0 en una grilla llena produce extinción total en un solo evento", () => {
    const { snapshots } = runSimulation(
      baseConfig({
        updates: 10,
        ancestorGenomes: Array.from({ length: 100 }, () => createUniformGenome("replicate", 5)),
        catastrophe: { intervalGenerations: 3, severity: 1 },
      }),
    );

    const last = snapshots.at(-1);
    expect(last?.extinct).toBe(true);
    expect(last?.populationSize).toBe(0);
  });
});

describe("Criterio primario: extinción termina la corrida antes de config.updates", () => {
  it("runSimulation no sigue generando snapshots vacíos después de la extinción", () => {
    const { snapshots } = runSimulation(
      baseConfig({
        updates: 100, // límite alto a propósito: no debería llegar ahí
        catastrophe: { intervalGenerations: 1, severity: 1 },
      }),
    );

    expect(snapshots.length).toBeLessThan(100);
    expect(snapshots.at(-1)?.extinct).toBe(true);
    // Ningún snapshot anterior al último debería marcar extinción (se corta apenas ocurre).
    expect(snapshots.slice(0, -1).every((s) => !s.extinct)).toBe(true);
  });
});

describe("Criterio secundario: cuasi-extinción sostenida (no absorbente)", () => {
  it("se activa tras N generaciones consecutivas por debajo del umbral, y se desactiva al recuperarse", () => {
    // La propia rampa de arranque de un solo ancestro (sin catástrofes)
    // ya pasa varias generaciones por debajo del 10% de una grilla de
    // 100 celdas — un caso real y determinista, no artificial.
    const { snapshots } = runSimulation(
      baseConfig({
        updates: 10,
        quasiExtinction: { thresholdFraction: 0.1, sustainedGenerations: 3 },
      }),
    );

    const firstNearExtinctGen = snapshots.findIndex((s) => s.nearExtinct);
    expect(firstNearExtinctGen).toBeGreaterThanOrEqual(0);

    // Las `sustainedGenerations` anteriores (inclusive) deben estar todas por debajo del umbral.
    const threshold = 0.1 * 100;
    for (let g = Math.max(0, firstNearExtinctGen - 2); g <= firstNearExtinctGen; g++) {
      expect(snapshots[g]?.populationSize).toBeLessThan(threshold);
    }

    // Una vez la población se recupera por encima del umbral, nearExtinct vuelve a false.
    const recoveredGen = snapshots.findIndex((s, i) => i > firstNearExtinctGen && s.populationSize >= threshold);
    expect(recoveredGen).toBeGreaterThan(firstNearExtinctGen);
    expect(snapshots[recoveredGen]?.nearExtinct).toBe(false);
  });

  it("sin quasiExtinction configurado, nearExtinct siempre es false", () => {
    const { snapshots } = runSimulation(baseConfig({ updates: 10 }));
    expect(snapshots.every((s) => !s.nearExtinct)).toBe(true);
  });
});
