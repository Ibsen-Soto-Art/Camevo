import { describe, expect, it } from "vitest";
import { ClimatePolicyConfig } from "../../src/climate/policy/types";
import { Instruction } from "../../src/engine/organism/instruction-set";
import { TaskSolvedEvent, runSimulation } from "../../src/simulation/orchestrator/run";

/**
 * Verifica el cableado orchestrator ↔ climate/policy en sí (no la
 * emergencia por mutación, que ya cubre tasks-reward.test.ts): cuando hay
 * `config.climate`, el bono de CPU otorgado debe usar el multiplicador
 * vigente según el clima, no el multiplicador estático de
 * engine/tasks/task-registry.
 *
 * El ancestro resuelve NOT de forma determinista desde su primer ciclo
 * (io A → nand A → io A calcula NOT sobre cualquier input), para no
 * depender de que la mutación la descubra — eso ya está probado aparte.
 */
const NOT_SOLVING_GENOME: readonly Instruction[] = [
  { opcode: "io", reg: "A" },
  { opcode: "nand", reg: "A" },
  { opcode: "io", reg: "A" },
  ...Array.from({ length: 10 }, () => ({ opcode: "replicate" as const, reg: "A" as const })),
];

describe("Integración simulation/orchestrator ↔ climate/policy", () => {
  it("usa el multiplicador vigente según el clima en vez del multiplicador estático de la tarea", () => {
    const climate: ClimatePolicyConfig = {
      seed: 1,
      trendPeriodGenerations: 150,
      varianceAmplitude: 0,
      resources: [{ taskId: "NOT", minMultiplier: 10, maxMultiplier: 10 }],
    };

    const events: TaskSolvedEvent[] = [];
    runSimulation({
      gridWidth: 3,
      gridHeight: 3,
      baseCyclesPerUpdate: 20,
      mutationRate: 0,
      ancestorGenomes: [NOT_SOLVING_GENOME],
      placementMode: "near-parent",
      updates: 1,
      seed: 1,
      climate,
      onTaskSolved: (event) => events.push(event),
    });

    const notEvent = events.find((e) => e.taskId === "NOT");
    expect(notEvent).toBeDefined();
    expect(notEvent?.multiplier).toBe(10);
    expect(notEvent?.bonusCycles).toBe(Math.round(20 * (10 - 1)));
  });

  it("sin config.climate, usa el multiplicador estático de engine/tasks (comportamiento de Fase 1 intacto)", () => {
    const events: TaskSolvedEvent[] = [];
    runSimulation({
      gridWidth: 3,
      gridHeight: 3,
      baseCyclesPerUpdate: 20,
      mutationRate: 0,
      ancestorGenomes: [NOT_SOLVING_GENOME],
      placementMode: "near-parent",
      updates: 1,
      seed: 1,
      onTaskSolved: (event) => events.push(event),
    });

    const notEvent = events.find((e) => e.taskId === "NOT");
    expect(notEvent?.multiplier).toBe(2); // multiplicador estático de DEFAULT_TASKS
  });

  it("el snapshot lleva la curva climática vigente por generación (RF-022)", () => {
    const climate: ClimatePolicyConfig = {
      seed: 1,
      trendPeriodGenerations: 150,
      varianceAmplitude: 0.1,
      resources: [
        { taskId: "NOT", minMultiplier: 1, maxMultiplier: 4 },
        { taskId: "AND", minMultiplier: 1, maxMultiplier: 8 },
      ],
    };

    const { snapshots } = runSimulation({
      gridWidth: 3,
      gridHeight: 3,
      baseCyclesPerUpdate: 20,
      mutationRate: 0,
      ancestorGenomes: [NOT_SOLVING_GENOME],
      placementMode: "near-parent",
      updates: 5,
      seed: 1,
      climate,
    });

    for (const snapshot of snapshots) {
      expect(snapshot.climate.map((r) => r.taskId)).toEqual(["NOT", "AND"]);
    }
  });

  it("sin config.climate, el snapshot no lleva curva climática", () => {
    const { snapshots } = runSimulation({
      gridWidth: 3,
      gridHeight: 3,
      baseCyclesPerUpdate: 20,
      mutationRate: 0,
      ancestorGenomes: [NOT_SOLVING_GENOME],
      placementMode: "near-parent",
      updates: 1,
      seed: 1,
    });

    expect(snapshots[0]?.climate).toEqual([]);
  });
});
