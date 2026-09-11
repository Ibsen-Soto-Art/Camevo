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

describe("getClimateParameters — RF-014 (pool de CPU global, separado de los recursos)", () => {
  it("sin resourcePool configurado, el multiplicador del pool siempre es 1 (comportamiento de fases anteriores intacto)", () => {
    const config = baseConfig(7);
    for (const params of sequence(config, 100)) {
      expect(params.resourcePoolMultiplier).toBe(1);
    }
  });

  it("con resourcePool configurado, el multiplicador se mantiene dentro de sus propios límites", () => {
    const config: ClimatePolicyConfig = { ...baseConfig(7), resourcePool: { minMultiplier: 0.15, maxMultiplier: 1 } };
    for (const params of sequence(config, 400)) {
      expect(params.resourcePoolMultiplier).toBeGreaterThanOrEqual(0.15);
      expect(params.resourcePoolMultiplier).toBeLessThanOrEqual(1);
    }
  });

  it("el pool oscila de forma independiente de los recursos por tarea (no es un cuarto recurso disfrazado)", () => {
    const config: ClimatePolicyConfig = { ...baseConfig(7), resourcePool: { minMultiplier: 0.15, maxMultiplier: 1 } };
    const params = sequence(config, 200);
    const poolValues = params.map((p) => p.resourcePoolMultiplier);
    const notValues = params.map((p) => p.resources.find((r) => r.taskId === "NOT")!.rewardMultiplier);

    // Si compartieran la misma fase/ruido, normalizados se moverían en lockstep; no es el caso.
    const diverged = poolValues.some((pool, i) => {
      const notNormalized = (notValues[i] as number) / 4; // techo de NOT en baseConfig
      return Math.abs(pool - notNormalized) > 0.05;
    });
    expect(diverged).toBe(true);
  });
});

describe("getClimateParameters — Fase 6 (trendSource: historical)", () => {
  it("sin trendSource (u omitido), el comportamiento sintético de siempre no cambia", () => {
    const config = baseConfig(7);
    expect(sequence(config, 50)).toEqual(sequence({ ...config, trendSource: "synthetic" }, 50));
  });

  it("con trendSource historical, todas las tareas se mueven sincronizadas (una sola curva real, no una por tarea)", () => {
    const config: ClimatePolicyConfig = {
      ...baseConfig(7),
      varianceAmplitude: 0,
      trendSource: "historical",
      totalGenerations: 100,
    };
    // Normalizado a [0,1] sobre el rango propio de cada recurso ((valor-min)/(max-min),
    // no simplemente valor/max — los `min` no son 0 en baseConfig), deberían coincidir
    // exactamente: sin fase propia ni ruido, las tres comparten la misma forma real.
    const bounds = { NOT: { min: 1, max: 4 }, AND: { min: 1, max: 8 }, OR: { min: 1, max: 8 } };
    for (const params of sequence(config, 100)) {
      const normalized = params.resources.map((r) => {
        const { min, max } = bounds[r.taskId as keyof typeof bounds];
        return (r.rewardMultiplier - min) / (max - min);
      });
      expect(normalized[0]).toBeCloseTo(normalized[1]!, 6);
      expect(normalized[0]).toBeCloseTo(normalized[2]!, 6);
    }
  });

  it("con trendSource historical, el resultado difiere del sintético para la misma config (usa una fuente de tendencia distinta)", () => {
    const historical = sequence({ ...baseConfig(7), varianceAmplitude: 0, trendSource: "historical", totalGenerations: 300 }, 300);
    const synthetic = sequence({ ...baseConfig(7), varianceAmplitude: 0 }, 300);
    expect(historical).not.toEqual(synthetic);
  });

  it("se mantiene dentro de los límites de cada recurso, igual que en modo sintético", () => {
    const config: ClimatePolicyConfig = { ...baseConfig(7), trendSource: "historical", totalGenerations: 200 };
    for (const params of sequence(config, 200)) {
      for (const resource of params.resources) {
        const bounds = config.resources.find((r) => r.taskId === resource.taskId);
        expect(resource.rewardMultiplier).toBeGreaterThanOrEqual(bounds!.minMultiplier);
        expect(resource.rewardMultiplier).toBeLessThanOrEqual(bounds!.maxMultiplier);
      }
    }
  });
});
