import { describe, expect, it } from "vitest";
import { getClimateParameters } from "../../src/climate/policy";
import { ClimatePolicyConfig } from "../../src/climate/policy/types";

function baseConfig(seed: number): ClimatePolicyConfig {
  return {
    seed,
    trendPeriodGenerations: 150,
    varianceAmplitude: 0.15,
    resources: [
      { taskId: "NOT", minMultiplier: 1, maxMultiplier: 4 },
      { taskId: "AND", minMultiplier: 1, maxMultiplier: 8 },
      { taskId: "OR", minMultiplier: 1, maxMultiplier: 8 },
    ],
  };
}

function sequence(config: ClimatePolicyConfig, generations: number) {
  return Array.from({ length: generations }, (_, g) => getClimateParameters(g, config));
}

describe("getClimateParameters — determinismo (RNF-003)", () => {
  it("misma semilla de corrida → misma secuencia climática entre ejecuciones", () => {
    const runSeed = 20260901;
    const a = sequence(baseConfig(runSeed), 300);
    const b = sequence(baseConfig(runSeed), 300);
    expect(a).toEqual(b);
  });

  it("semilla distinta (modo experimental) → secuencia climática distinta", () => {
    const a = sequence(baseConfig(1), 50);
    const b = sequence(baseConfig(2), 50);
    expect(a).not.toEqual(b);
  });

  it("misma generación y config siempre da el mismo resultado (función pura)", () => {
    const config = baseConfig(42);
    expect(getClimateParameters(77, config)).toEqual(getClimateParameters(77, config));
  });
});

describe("getClimateParameters — RF-019 (suministro por recurso, no pool global)", () => {
  it("el multiplicador de cada tarea se mantiene dentro de sus propios límites", () => {
    const config = baseConfig(7);
    for (const params of sequence(config, 400)) {
      for (const resource of params.resources) {
        const bounds = config.resources.find((r) => r.taskId === resource.taskId);
        expect(resource.rewardMultiplier).toBeGreaterThanOrEqual(bounds!.minMultiplier);
        expect(resource.rewardMultiplier).toBeLessThanOrEqual(bounds!.maxMultiplier);
      }
    }
  });

  it("devuelve un nivel de suministro independiente por cada tarea, no un único valor global", () => {
    const config = baseConfig(7);
    const params = getClimateParameters(0, config);
    expect(params.resources.map((r) => r.taskId)).toEqual(["NOT", "AND", "OR"]);
  });
});

describe("getClimateParameters — RF-011 (tendencia + varianza, desfasadas por tarea)", () => {
  it("dos tareas con los mismos límites no se mueven en perfecto lockstep (fases distintas)", () => {
    const config: ClimatePolicyConfig = {
      seed: 7,
      trendPeriodGenerations: 100,
      varianceAmplitude: 0,
      resources: [
        { taskId: "A", minMultiplier: 1, maxMultiplier: 4 },
        { taskId: "B", minMultiplier: 1, maxMultiplier: 4 },
      ],
    };

    const diverged = sequence(config, 100).some((params) => {
      const [a, b] = params.resources;
      return Math.abs(a!.rewardMultiplier - b!.rewardMultiplier) > 0.01;
    });

    expect(diverged).toBe(true);
  });

  it("con varianza en 0, la tendencia es puramente cíclica: se repite tras un período completo", () => {
    const config = { ...baseConfig(7), varianceAmplitude: 0 };
    const a = getClimateParameters(10, config);
    const b = getClimateParameters(10 + config.trendPeriodGenerations, config);
    a.resources.forEach((resource, i) => {
      expect(resource.rewardMultiplier).toBeCloseTo(b.resources[i]!.rewardMultiplier, 9);
    });
  });

  it("la varianza introduce diferencia frente a la tendencia pura en al menos algunas generaciones", () => {
    const withNoise = sequence(baseConfig(7), 50);
    const withoutNoise = sequence({ ...baseConfig(7), varianceAmplitude: 0 }, 50);

    const anyDifference = withNoise.some((params, g) =>
      params.resources.some((r, i) => Math.abs(r.rewardMultiplier - withoutNoise[g]!.resources[i]!.rewardMultiplier) > 1e-9),
    );

    expect(anyDifference).toBe(true);
  });
});
