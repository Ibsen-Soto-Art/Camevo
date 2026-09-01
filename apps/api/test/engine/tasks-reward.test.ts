import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { DEFAULT_TASKS } from "../../src/engine/tasks/task-registry";
import { TaskSolvedEvent, runSimulation } from "../../src/simulation/orchestrator/run";

/**
 * Cierra el cabo suelto de la Fase 1: confirma de punta a punta que el
 * camino "mutación → resuelve tarea lógica → recompensa de CPU" (RF-006)
 * está realmente conectado, no solo que `evaluateOutput` detecta la tarea
 * en aislamiento (eso ya lo cubre tasks.test.ts). Esto importa porque el
 * mecanismo climático central del proyecto (RF-011) funciona modulando
 * exactamente esta recompensa — si nunca se activara en la práctica, no
 * habría nada que climate/policy pudiera modular.
 *
 * El ancestro sigue siendo puro `replicate` (sin ninguna instrucción de
 * tarea de partida): cualquier NOT/AND/OR resuelto aquí solo pudo llegar
 * por mutación durante la autorreplicación, nunca por diseño del genoma
 * semilla.
 *
 * Nota de calibración: con la grilla/duración usadas en
 * fitness-trend.test.ts (10x10, 300 actualizaciones) esto solo se observó
 * en 3 de 5 semillas al explorar el espacio de parámetros — no es
 * imposible, pero sí poco confiable para un test determinista. Con una
 * población mayor (20x20 = 400 organismos) y más actualizaciones (2000)
 * se observó en 5 de 5 semillas probadas, en menos de 1 segundo por
 * corrida — de ahí la configuración usada abajo.
 */
function runUntilTaskSolved(seed: number) {
  const events: TaskSolvedEvent[] = [];
  const result = runSimulation({
    gridWidth: 20,
    gridHeight: 20,
    baseCyclesPerUpdate: 20,
    mutationRate: 0.05,
    ancestorGenomes: [createUniformGenome("replicate", 24)],
    placementMode: "near-parent",
    updates: 2000,
    seed,
    onTaskSolved: (event) => events.push(event),
  });
  return { result, events };
}

describe("Camino mutación → tarea resuelta → recompensa de CPU (RF-006)", () => {
  const seeds = [1, 2, 3, 4, 5];

  it.each(seeds)("semilla %i: al menos un organismo resuelve NOT/AND/OR por mutación", (seed) => {
    const { events } = runUntilTaskSolved(seed);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(["NOT", "AND", "OR"]).toContain(event.taskId);
    }
  });

  it.each(seeds)("semilla %i: la recompensa de CPU otorgada coincide con la jerarquía de dificultad definida", (seed) => {
    const { events } = runUntilTaskSolved(seed);
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      const definition = DEFAULT_TASKS.find((t) => t.id === event.taskId);
      expect(definition).toBeDefined();
      expect(event.multiplier).toBe(definition?.multiplier);

      const expectedBonus = Math.round(20 * ((definition?.multiplier as number) - 1));
      expect(event.bonusCycles).toBe(expectedBonus);
      expect(event.bonusCycles).toBeGreaterThan(0);
    }
  });
});
