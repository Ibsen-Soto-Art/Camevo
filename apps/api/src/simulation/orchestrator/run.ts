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
}

export interface GenerationSnapshot {
  generation: number;
  populationSize: number;
  births: number;
  /** Tasa de reemplazo generacional de la población: nacimientos / tamaño de población. */
  averageFitness: number;
  tasksSolvedThisUpdate: number;
}

export interface SimulationResult {
  seed: number;
  snapshots: GenerationSnapshot[];
  grid: Grid;
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

function makeTaskHooks(
  organism: OrganismState,
  baseCycles: number,
  tasks: readonly TaskDefinition[],
  onTaskSolved: () => void,
): VmHooks {
  return {
    onOutput(outputValue, recentInputs) {
      const solved = evaluateOutput(outputValue, recentInputs, organism.tasksSolved, tasks);
      for (const task of solved) {
        organism.tasksSolved.add(task.id);
        organism.cyclesRemaining += Math.round(baseCycles * (task.multiplier - 1));
        onTaskSolved();
      }
    },
  };
}

/**
 * Loop de simulación de la Fase 1 (sin `climate/policy`): los parámetros
 * ambientales son fijos durante toda la corrida. `simulation/orchestrator`
 * seguirá siendo el único punto que consulte al módulo climático cuando
 * se incorpore en Fase 2, sin cambiar la firma de este loop.
 */
export function runSimulation(config: SimulationConfig): SimulationResult {
  const rng = mulberry32(config.seed);
  const grid = new Grid({ width: config.gridWidth, height: config.gridHeight });
  seedPopulation(grid, config.ancestorGenomes, config.mutationRate, rng);
  const tasks = config.tasks ?? DEFAULT_TASKS;

  const snapshots: GenerationSnapshot[] = [];

  for (let generation = 0; generation < config.updates; generation++) {
    const order = shuffledInPlace(grid.occupiedIndices(), rng);

    let births = 0;
    let tasksSolvedThisUpdate = 0;

    for (const index of order) {
      const organism = grid.cells[index];
      if (!organism) continue;

      organism.cyclesRemaining = config.baseCyclesPerUpdate;
      const hooks = makeTaskHooks(organism, config.baseCyclesPerUpdate, tasks, () => {
        tasksSolvedThisUpdate += 1;
      });

      while (organism.cyclesRemaining > 0) {
        step(organism, hooks, rng);
        organism.cyclesRemaining -= 1;

        if (organism.readyToDivide) {
          const offspringGenome = harvestOffspring(organism);
          if (offspringGenome && offspringGenome.length > 0) {
            const targetIndex = chooseBirthTargetIndex(grid, index, config.placementMode, rng);
            grid.cells[targetIndex] = createOrganism(offspringGenome, { mutationRate: config.mutationRate });
            organism.offspringProduced += 1;
            births += 1;
          }
        }
      }
    }

    const populationSize = grid.populationSize();
    snapshots.push({
      generation,
      populationSize,
      births,
      averageFitness: populationSize > 0 ? births / populationSize : 0,
      tasksSolvedThisUpdate,
    });
  }

  return { seed: config.seed, snapshots, grid };
}
