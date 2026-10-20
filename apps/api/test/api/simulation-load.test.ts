import { describe, expect, it } from "vitest";
import {
  MAX_SIMULATION_LOAD,
  SIMULATION_LIMITS,
  parseCreateRunRequest,
  simulationLoad,
} from "../../src/api/rest/config-request";

/**
 * RNF-008: tope de la carga TOTAL (células × generaciones), el producto que
 * los límites campo a campo no pueden acotar. Medido con GC forzado: el peor
 * caso que la validación por campo permite hoy (40×40×5000) retiene 339 MB de
 * snapshots serializados, y el modo comparación lanza dos corridas a la vez.
 */
describe("simulationLoad", () => {
  it("multiplica ancho × alto × generaciones", () => {
    expect(simulationLoad({ gridWidth: 40, gridHeight: 40, updates: 1500 })).toBe(2_400_000);
    expect(simulationLoad({ gridWidth: 20, gridHeight: 20, updates: 300 })).toBe(120_000);
    expect(simulationLoad({ gridWidth: 2, gridHeight: 2, updates: 1 })).toBe(4);
  });

  it("no es simétrico en el sentido equivocado: una grilla chica con muchas generaciones cuenta igual que una grande con pocas", () => {
    // Es la propiedad que justifica acotar el PRODUCTO y no cada campo: las
    // dos configuraciones retienen la misma cantidad de snapshots × celdas.
    expect(simulationLoad({ gridWidth: 40, gridHeight: 40, updates: 1000 })).toBe(
      simulationLoad({ gridWidth: 20, gridHeight: 20, updates: 4000 }),
    );
  });
});

describe("SIMULATION_LIMITS", () => {
  it("deriva los topes por campo de LIMITS en vez de repetir los números", () => {
    // Si alguien cambia el máximo de gridWidth en LIMITS, esto lo sigue.
    expect(SIMULATION_LIMITS.maxCells).toBe(1600); // 40 × 40
    expect(SIMULATION_LIMITS.maxGenerations).toBe(5000);
    expect(SIMULATION_LIMITS.maxLoad).toBe(MAX_SIMULATION_LOAD);
  });

  it("el peor caso que permiten los límites por campo SUPERA el tope de carga — que es la razón de que el tope exista", () => {
    const worstAllowedByFields = SIMULATION_LIMITS.maxCells * SIMULATION_LIMITS.maxGenerations;
    expect(worstAllowedByFields).toBe(8_000_000);
    expect(worstAllowedByFields).toBeGreaterThan(MAX_SIMULATION_LOAD);
  });
});

describe("el tope de carga no invalida las configuraciones de uso real", () => {
  it("40×40×1500 (la grilla máxima con la duración habitual) entra", () => {
    expect(simulationLoad({ gridWidth: 40, gridHeight: 40, updates: 1500 })).toBeLessThanOrEqual(MAX_SIMULATION_LOAD);
  });

  it("los valores por defecto del formulario entran con mucho margen", () => {
    const parsed = parseCreateRunRequest({});
    if ("errors" in parsed) throw new Error(parsed.errors.join(", "));
    const load = simulationLoad(parsed.config);
    expect(load).toBeLessThanOrEqual(MAX_SIMULATION_LOAD);
    expect(load).toBeLessThan(MAX_SIMULATION_LOAD * 0.7); // ni siquiera entra en zona de aviso
  });

  it("40×40×1875 es el borde exacto: entra", () => {
    expect(simulationLoad({ gridWidth: 40, gridHeight: 40, updates: 1875 })).toBe(MAX_SIMULATION_LOAD);
  });

  it("una generación más que el borde ya no entra", () => {
    expect(simulationLoad({ gridWidth: 40, gridHeight: 40, updates: 1876 })).toBeGreaterThan(MAX_SIMULATION_LOAD);
  });
});
