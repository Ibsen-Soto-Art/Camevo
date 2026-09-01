import { describe, expect, it } from "vitest";
import { mulberry32, resolveSeed } from "../../src/simulation/orchestrator/rng";

describe("mulberry32 (RNF-003: reproducibilidad)", () => {
  it("la misma semilla produce siempre la misma secuencia", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const sequenceA = Array.from({ length: 10 }, () => a());
    const sequenceB = Array.from({ length: 10 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("semillas distintas producen secuencias distintas", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("produce siempre valores en [0, 1)", () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("resolveSeed (RF-007: modo reproducible/experimental)", () => {
  it("modo reproducible: la misma configuración siempre resuelve la misma semilla", () => {
    const seedA = resolveSeed("reproducible", "grid=10;mutation=0.05");
    const seedB = resolveSeed("reproducible", "grid=10;mutation=0.05");
    expect(seedA).toBe(seedB);
  });

  it("modo reproducible: configuraciones distintas resuelven semillas distintas", () => {
    const seedA = resolveSeed("reproducible", "grid=10;mutation=0.05");
    const seedB = resolveSeed("reproducible", "grid=20;mutation=0.05");
    expect(seedA).not.toBe(seedB);
  });

  it("modo experimental: no depende de la huella de configuración", () => {
    const seed = resolveSeed("experimental", "cualquier-cosa");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });
});
