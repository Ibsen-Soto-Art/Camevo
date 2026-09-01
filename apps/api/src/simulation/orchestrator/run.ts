import { getClimateParameters } from "../../climate/policy";
import { ClimatePolicyConfig, ResourceSupply } from "../../climate/policy/types";
import { Genome, RandomSource } from "../../engine/organism/genome";
import { OrganismState, VmHooks, createOrganism, harvestOffspring, step } from "../../engine/organism/vm";
import { Grid } from "../../engine/population/grid";
import { seedPopulation } from "../../engine/population/seeding";
import { PlacementMode, chooseBirthTargetIndex } from "../../engine/population/placement";
import { DEFAULT_TASKS, TaskDefinition, evaluateOutput } from "../../engine/tasks/task-registry";
import { mulberry32 } from "./rng";

export interface SimulationConfig {
  gridWidth: number;
  gridHeight: number;
  baseCyclesPerUpdate: number;
  mutationRate: number;
  ancestorGenomes: readonly Genome[];
  placementMode: PlacementMode;
  updates: number;
  seed: number;
  tasks?: readonly TaskDefinition[];
  /**
   * RF-010/RF-011: si se omite, el comportamiento es idéntico al de la
   * Fase 1 (recompensas fijas, `task.multiplier` estático). Si se provee,
   * su `seed` debe ser la misma que `seed` de arriba (ver
   * climate/policy/types.ts) para que "misma corrida" implique también
   * "misma curva climática" (RNF-003).
   */
  climate?: ClimatePolicyConfig;
  /** Observador opcional de cada recompensa de tarea otorgada (para pruebas/instrumentación). */
  onTaskSolved?: (event: TaskSolvedEvent) => void;
  /** Observador opcional de cada snapshot generado (para streaming en vivo por api/ws). */
  onSnapshot?: (snapshot: GenerationSnapshot) => void;
}

export interface TaskSolvedEvent {
  readonly generation: number;
  readonly taskId: string;
  readonly multiplier: number;
  readonly bonusCycles: number;
}

/** Snapshot liviano por organismo: sin genoma (docs/03-arquitectura.md §4.1). */
export interface OrganismSummary {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly fitness: number;
}

export interface GenerationSnapshot {
  generation: number;
  populationSize: number;
  births: number;
  /** Tasa de reemplazo generacional de la población: nacimientos / tamaño de población. */
  averageFitness: number;
  tasksSolvedThisUpdate: number;
  climate: readonly ResourceSupply[];
  organisms: readonly OrganismSummary[];
}

export interface SimulationResult {
  seed: number;
  snapshots: GenerationSnapshot[];
  grid: Grid;
}

/** Estado mutable de una corrida, para poder avanzarla generación a generación (api/ws en vivo). */
export interface SimulationState {
  readonly config: SimulationConfig;
  readonly rng: RandomSource;
  readonly grid: Grid;
  readonly tasks: readonly TaskDefinition[];
  generation: number;
  organismIdCounter: number;
}

function shuffledInPlace<T>(items: T[], rng: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = temp;
  }
  return items;
}

function nextOrganismId(state: SimulationState): string {
  const id = String(state.organismIdCounter);
  state.organismIdCounter += 1;
  return id;
}

function makeTaskHooks(
  organism: OrganismState,
  baseCycles: number,
  tasks: readonly TaskDefinition[],
  generation: number,
  climateMultipliers: ReadonlyMap<string, number>,
  onTaskSolved: (event: TaskSolvedEvent) => void,
): VmHooks {
  return {
    onOutput(outputValue, recentInputs) {
      const solved = evaluateOutput(outputValue, recentInputs, organism.tasksSolved, tasks);
      for (const task of solved) {
        organism.tasksSolved.add(task.id);
        const multiplier = climateMultipliers.get(task.id) ?? task.multiplier;
        const bonusCycles = Math.round(baseCycles * (multiplier - 1));
        organism.cyclesRemaining += bonusCycles;
        onTaskSolved({ generation, taskId: task.id, multiplier, bonusCycles });
      }
    },
  };
}

export function createSimulationState(config: SimulationConfig): SimulationState {
  const rng = mulberry32(config.seed);
  const grid = new Grid({ width: config.gridWidth, height: config.gridHeight });
  const tasks = config.tasks ?? DEFAULT_TASKS;
  const state: SimulationState = { config, rng, grid, tasks, generation: 0, organismIdCounter: 0 };
  seedPopulation(grid, config.ancestorGenomes, config.mutationRate, rng, () => nextOrganismId(state));
  return state;
}

/**
 * Avanza la corrida exactamente una generación y devuelve su snapshot.
 * Es el punto que usa tanto `runSimulation` (loop síncrono, para tests y
 * el motor standalone) como api/ws (loop asíncrono con pausas entre
 * generaciones, para que el streaming en vivo sea perceptible).
 */
export function advanceGeneration(state: SimulationState): GenerationSnapshot {
  const { config, grid, rng, tasks, generation } = state;

  const climateParams = config.climate ? getClimateParameters(generation, config.climate) : null;
  const climateMultipliers = new Map(climateParams?.resources.map((r) => [r.taskId, r.rewardMultiplier]) ?? []);

  const order = shuffledInPlace(grid.occupiedIndices(), rng);

  let births = 0;
  let tasksSolvedThisUpdate = 0;

  for (const index of order) {
    const organism = grid.cells[index];
    if (!organism) continue;

    organism.cyclesRemaining = config.baseCyclesPerUpdate;
    const hooks = makeTaskHooks(organism, config.baseCyclesPerUpdate, tasks, generation, climateMultipliers, (event) => {
      tasksSolvedThisUpdate += 1;
      config.onTaskSolved?.(event);
    });

    while (organism.cyclesRemaining > 0) {
      step(organism, hooks, rng);
      organism.cyclesRemaining -= 1;

      if (organism.readyToDivide) {
        const offspringGenome = harvestOffspring(organism);
        if (offspringGenome && offspringGenome.length > 0) {
          const targetIndex = chooseBirthTargetIndex(grid, index, config.placementMode, rng);
          grid.cells[targetIndex] = createOrganism(offspringGenome, {
            mutationRate: config.mutationRate,
            id: nextOrganismId(state),
          });
          organism.offspringProduced += 1;
          births += 1;
        }
      }
    }
  }

  const populationSize = grid.populationSize();
  const organisms: OrganismSummary[] = grid.cells.flatMap((organism, index) => {
    if (!organism) return [];
    const { x, y } = grid.coordsOf(index);
    return [{ id: organism.id, x, y, fitness: organism.offspringProduced }];
  });

  const snapshot: GenerationSnapshot = {
    generation,
    populationSize,
    births,
    averageFitness: populationSize > 0 ? births / populationSize : 0,
    tasksSolvedThisUpdate,
    climate: climateParams?.resources ?? [],
    organisms,
  };

  state.generation += 1;
  config.onSnapshot?.(snapshot);
  return snapshot;
}

/**
 * Loop de simulación síncrono: corre `config.updates` generaciones de una
 * sola vez. `climate/policy` se consulta aquí (vía `advanceGeneration`) si
 * `config.climate` está presente; si no, el comportamiento es idéntico al
 * de la Fase 1 (parámetros fijos).
 */
export function runSimulation(config: SimulationConfig): SimulationResult {
  const state = createSimulationState(config);
  const snapshots: GenerationSnapshot[] = [];
  for (let i = 0; i < config.updates; i++) {
    snapshots.push(advanceGeneration(state));
  }
  return { seed: config.seed, snapshots, grid: state.grid };
}
