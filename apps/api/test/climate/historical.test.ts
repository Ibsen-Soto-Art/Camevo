import { describe, expect, it } from "vitest";
import { GISTEMP_ANNUAL_ANOMALY_C } from "../../src/climate/policy/gistemp-annual-anomaly";
import { historicalTrendUnit } from "../../src/climate/policy/historical";

describe("historicalTrendUnit — mapeo generación→año real (Fase 6)", () => {
  // El mínimo real del dataset es 1909 (-0.49°C) y el máximo es 2024
  // (+1.29°C), NO los extremos de la serie (1880 y 2025) — por eso este
  // test verifica los valores normalizados exactos de esos dos años, en
  // vez de asumir que generación 0 / última generación dan 0 / 1.
  it("la generación 0 mapea al primer año de la serie (1880) con su anomalía real normalizada", () => {
    expect(historicalTrendUnit(0, 1000)).toBeCloseTo(0.1742, 4);
  });

  it("la última generación mapea al último año de la serie (2025) con su anomalía real normalizada", () => {
    expect(historicalTrendUnit(999, 1000)).toBeCloseTo(0.9438, 4);
  });

  it("devuelve siempre un valor dentro de [0, 1]", () => {
    for (let g = 0; g < 1000; g += 7) {
      const unit = historicalTrendUnit(g, 1000);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThanOrEqual(1);
    }
  });

  it("es monótonamente no decreciente en promedio: la segunda mitad de la corrida está, en conjunto, más cerca de 1 que la primera", () => {
    const totalGenerations = 1460; // una generación por año del dataset, para una comparación 1:1 limpia
    const firstHalf: number[] = [];
    const secondHalf: number[] = [];
    for (let g = 0; g < totalGenerations; g++) {
      const unit = historicalTrendUnit(g, totalGenerations);
      (g < totalGenerations / 2 ? firstHalf : secondHalf).push(unit);
    }
    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    // El calentamiento observado (GISTEMP) hace que la segunda mitad del
    // dataset (años más recientes) sea, en promedio, más cálida que la
    // primera — no una garantía punto a punto (el clima real tiene ruido
    // año a año), pero sí en el agregado, que es lo que este test verifica.
    expect(avg(secondHalf)).toBeGreaterThan(avg(firstHalf));
  });

  it("es una función pura: misma generación y mismo total siempre dan el mismo resultado", () => {
    expect(historicalTrendUnit(500, 1500)).toBe(historicalTrendUnit(500, 1500));
  });

  it("el dataset embebido tiene 146 años (1880-2025), sin huecos", () => {
    expect(GISTEMP_ANNUAL_ANOMALY_C).toHaveLength(146);
    expect(GISTEMP_ANNUAL_ANOMALY_C.every((v) => Number.isFinite(v))).toBe(true);
  });
});
