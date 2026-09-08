import { describe, expect, it } from "vitest";
import { createNotSolvingGenome, createUniformGenome } from "../../src/engine/organism/genome";
import { DEFAULT_TASKS } from "../../src/engine/tasks/task-registry";
import { ClimatePolicyConfig } from "../../src/climate/policy/types";
import { CatastropheConfig, runSimulation } from "../../src/simulation/orchestrator/run";

/**
 * Evidencia empírica del cierre de la Fase 4, pedida explícitamente para
 * que no quedara solo en el historial de la conversación: antes de fijar
 * `resourcePool: [0.01, 0.1]` + `catastrophe: {intervalGenerations: 10,
 * severity: 0.9}` como los valores de "fast" (config-request.ts), se
 * verificó que NINGUNO de los dos mecanismos por sí solo garantiza
 * extinción — si lo hiciera, el demo solo estaría mostrando "elegimos
 * números lo bastante extremos para matar a cualquier población", no un
 * verdadero desfase de adaptación.
 *
 * Parámetros de las pruebas: 20×20, mutationRate=0.05, mismos ancestros
 * que usa climateEnabled (uno `replicate` puro + uno que ya resuelve
 * NOT), climateChangeSpeed="fast" (trendPeriodGenerations=40,
 * varianceAmplitude=0.15, techo de recompensa por tarea=16 — igual que
 * config-request.ts), 1500 generaciones, 5 semillas.
 */
const SEEDS = [1, 2, 3, 4, 5];
const UPDATES = 1500;

/**
 * Timeout explícito, más generoso que el default de Vitest (5000ms): cada
 * caso corre 1500 generaciones reales de una grilla 20x20 con clima
 * activo (no un mock ni un cálculo simplificado) — 7500 generaciones en
 * total sumando las 5 semillas de un solo `it.each`. Es carga
 * computacional real y esperada, no una regresión de rendimiento: con el
 * timeout default, este archivo empezó a fallar por tiempo (no por
 * assertion) en una máquina bajo uso normal, mientras que a 15000ms se
 * verificó estable dos veces seguidas antes de fijar este valor. Si en el
 * futuro empieza a fallar de nuevo a 15s, es más probable que sea una
 * regresión de rendimiento real en el motor que otra casualidad de carga
 * de esta máquina — vale la pena investigarlo, no solo subir el número de nuevo.
 */
const HEAVY_TEST_TIMEOUT_MS = 15_000;

function fastClimate(seed: number, resourcePool?: ClimatePolicyConfig["resourcePool"]): ClimatePolicyConfig {
  return {
    seed,
    trendPeriodGenerations: 40,
    varianceAmplitude: 0.15,
    resources: DEFAULT_TASKS.map((t) => ({ taskId: t.id, minMultiplier: 1, maxMultiplier: 16 })),
    ...(resourcePool ? { resourcePool } : {}),
  };
}

const POOL_ONLY = { minMultiplier: 0.01, maxMultiplier: 0.1 };
const CATASTROPHE: CatastropheConfig = { intervalGenerations: 10, severity: 0.9 };
const ADAPTED_ANCESTORS = [createUniformGenome("replicate", 24), createNotSolvingGenome(24)];
const UNADAPTED_ANCESTORS = [createUniformGenome("replicate", 24), createUniformGenome("replicate", 24)];

function runScenario(seed: number, resourcePool?: ClimatePolicyConfig["resourcePool"], catastrophe?: CatastropheConfig, ancestorGenomes = ADAPTED_ANCESTORS) {
  return runSimulation({
    gridWidth: 20,
    gridHeight: 20,
    baseCyclesPerUpdate: 20,
    mutationRate: 0.05,
    ancestorGenomes,
    placementMode: "near-parent",
    updates: UPDATES,
    seed,
    climate: fastClimate(seed, resourcePool),
    ...(catastrophe ? { catastrophe } : {}),
  });
}

describe("Fase 4 — aislamiento de mecanismos: ¿qué causa la extinción, de verdad?", () => {
  it.each(SEEDS)(
    "semilla %i: SOLO resourcePool [0.01, 0.1], sin catastrophe → nunca se extingue en 1500 generaciones",
    (seed) => {
      const { snapshots } = runScenario(seed, POOL_ONLY, undefined);
      expect(snapshots.at(-1)?.extinct).toBe(false);
      expect(snapshots.at(-1)?.populationSize).toBe(400);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it.each(SEEDS)(
    "semilla %i: SOLO catastrophe (interval=10, severity=0.9), pool normal → nunca se extingue en 1500 generaciones",
    (seed) => {
      const { snapshots } = runScenario(seed, undefined, CATASTROPHE);
      expect(snapshots.at(-1)?.extinct).toBe(false);
      expect(snapshots.at(-1)?.populationSize).toBe(400);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it.each(SEEDS)(
    "semilla %i: AMBOS combinados → extinción real y reproducible",
    (seed) => {
      const { snapshots } = runScenario(seed, POOL_ONLY, CATASTROPHE);
      expect(snapshots.at(-1)?.extinct).toBe(true);
      expect(snapshots.at(-1)?.populationSize).toBe(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe("Fase 4 — el tiempo hasta la extinción depende de la capacidad adaptativa de partida (deuda de extinción)", () => {
  it.each(SEEDS)(
    "semilla %i: sin ninguna ventaja adaptativa, la población muere en el PRIMER evento catastrófico",
    (seed) => {
      const { snapshots } = runScenario(seed, POOL_ONLY, CATASTROPHE, UNADAPTED_ANCESTORS);
      const last = snapshots.at(-1);
      expect(last?.extinct).toBe(true);
      expect(last?.generation).toBe(CATASTROPHE.intervalGenerations);
    },
  );

  it.each(SEEDS)(
    "semilla %i: con una ventaja adaptativa de partida, sobrevive varias veces más generaciones antes de sucumbir igual",
    (seed) => {
      const withAdaptation = runScenario(seed, POOL_ONLY, CATASTROPHE, ADAPTED_ANCESTORS);
      const withoutAdaptation = runScenario(seed, POOL_ONLY, CATASTROPHE, UNADAPTED_ANCESTORS);

      const genWith = withAdaptation.snapshots.at(-1)?.generation as number;
      const genWithout = withoutAdaptation.snapshots.at(-1)?.generation as number;

      expect(withAdaptation.snapshots.at(-1)?.extinct).toBe(true);
      // Ambas terminan extintas — la adaptación compra tiempo, no garantiza
      // supervivencia indefinida ante un estrés lo bastante severo.
      expect(genWith).toBeGreaterThan(genWithout);
    },
  );
});
