import { bitwiseAnd, bitwiseNot, bitwiseOr } from "./logic-tasks";

export interface TaskDefinition {
  readonly id: string;
  /** Multiplicador de la jerarquía de dificultad de RF-006 (fácil ×2, moderada ×4, ...). */
  readonly multiplier: number;
  readonly requiredInputs: 1 | 2;
  compute(inputs: readonly number[]): number;
}

/**
 * Fase 1 (04-roadmap-fases.md) pide empezar solo con NOT, AND y OR; el
 * registro admite ampliarse con XOR/EQU en fases posteriores sin tocar
 * `evaluateOutput`.
 */
export const DEFAULT_TASKS: readonly TaskDefinition[] = [
  { id: "NOT", multiplier: 2, requiredInputs: 1, compute: ([a]) => bitwiseNot(a as number) },
  { id: "AND", multiplier: 4, requiredInputs: 2, compute: ([a, b]) => bitwiseAnd(a as number, b as number) },
  { id: "OR", multiplier: 4, requiredInputs: 2, compute: ([a, b]) => bitwiseOr(a as number, b as number) },
];

export interface SolvedTask {
  readonly id: string;
  readonly multiplier: number;
}

/**
 * Un organismo resuelve una tarea cuando el valor que emite por `io`
 * coincide con una función lógica de sus últimos inputs consumidos
 * (los más recientes primero). Cada tarea solo recompensa una vez por
 * vida del organismo (`alreadySolved`, ver vm.ts/tasksSolved).
 */
export function evaluateOutput(
  outputValue: number,
  recentInputs: readonly number[],
  alreadySolved: ReadonlySet<string>,
  tasks: readonly TaskDefinition[] = DEFAULT_TASKS,
): SolvedTask[] {
  const solved: SolvedTask[] = [];
  const output = outputValue >>> 0;
  for (const task of tasks) {
    if (alreadySolved.has(task.id)) continue;
    if (recentInputs.length < task.requiredInputs) continue;
    const expected = task.compute(recentInputs) >>> 0;
    if (expected === output) {
      solved.push({ id: task.id, multiplier: task.multiplier });
    }
  }
  return solved;
}
