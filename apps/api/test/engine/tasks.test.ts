import { describe, expect, it } from "vitest";
import { evaluateOutput } from "../../src/engine/tasks/task-registry";

describe("evaluateOutput (RF-006)", () => {
  it("reconoce NOT sobre el input más reciente", () => {
    const input = 0b1010;
    const output = (~input) >>> 0;
    const solved = evaluateOutput(output, [input], new Set());
    expect(solved.map((t) => t.id)).toContain("NOT");
  });

  it("reconoce AND sobre los dos inputs más recientes", () => {
    const [a, b] = [0b1100, 0b1010];
    const output = (a & b) >>> 0;
    const solved = evaluateOutput(output, [a, b], new Set());
    expect(solved.map((t) => t.id)).toContain("AND");
  });

  it("reconoce OR sobre los dos inputs más recientes", () => {
    const [a, b] = [0b1100, 0b1010];
    const output = (a | b) >>> 0;
    const solved = evaluateOutput(output, [a, b], new Set());
    expect(solved.map((t) => t.id)).toContain("OR");
  });

  it("no reconoce una tarea si no hay inputs suficientes", () => {
    const solved = evaluateOutput(0b1100, [0b1100], new Set());
    expect(solved.map((t) => t.id)).not.toContain("AND");
  });

  it("no vuelve a recompensar una tarea ya resuelta por el mismo organismo", () => {
    const input = 0b1010;
    const output = (~input) >>> 0;
    const solved = evaluateOutput(output, [input], new Set(["NOT"]));
    expect(solved).toHaveLength(0);
  });

  it("respeta una jerarquía de dificultad graduada (AND/OR más difíciles que NOT)", () => {
    const not = evaluateOutput((~1) >>> 0, [1], new Set()).find((t) => t.id === "NOT");
    const and = evaluateOutput((1 & 1) >>> 0, [1, 1], new Set()).find((t) => t.id === "AND");
    expect(not?.multiplier).toBeLessThan(and?.multiplier as number);
  });

  it("una salida que no coincide con ninguna función lógica no resuelve tareas", () => {
    const solved = evaluateOutput(123456, [1, 2], new Set());
    expect(solved).toHaveLength(0);
  });
});
