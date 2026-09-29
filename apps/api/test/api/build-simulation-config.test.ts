import type { PersistedRunConfig } from "@camevo/shared-types";
import { describe, expect, it } from "vitest";
import { buildSimulationConfig, getCatastropheConfig, parseCreateRunRequest } from "../../src/api/rest/config-request";

/**
 * Pedido explícito antes de implementar: POST /runs (persistencia) y
 * api/ws (ejecución en vivo) deben producir exactamente el mismo
 * SimulationConfig a partir del mismo PersistedRunConfig — ambos pasan
 * por `buildSimulationConfig`, así que "exactamente el mismo" debería
 * ser trivialmente cierto por construcción, pero se verifica en vez de
 * asumirse: si alguien introduce una fuente de no-determinismo (un
 * Math.random suelto, un Date.now(), un id generado distinto en cada
 * llamada) este test lo nota.
 */
function samplePersistedConfig(overrides: Partial<PersistedRunConfig> = {}): PersistedRunConfig {
  const parsed = parseCreateRunRequest({ climateEnabled: true, ...overrides });
  if ("errors" in parsed) {
    throw new Error(`Config de prueba inválida: ${parsed.errors.join(", ")}`);
  }
  return parsed.config;
}

describe("buildSimulationConfig", () => {
  it("es determinista: el mismo PersistedRunConfig produce exactamente el mismo SimulationConfig en llamadas separadas", () => {
    const persisted = samplePersistedConfig();

    const configA = buildSimulationConfig(persisted);
    const configB = buildSimulationConfig(persisted);

    expect(configA).toEqual(configB);
  });

  it("simula la ruta real: PersistedRunConfig serializado a JSON y reconstruido (como pasa por la DB) sigue dando el mismo SimulationConfig", () => {
    const persisted = samplePersistedConfig({ climateChangeSpeed: "fast", updates: 500 });

    // api/rest arma `config` en memoria; api/ws lo lee de vuelta desde
    // el repositorio (JSONB en Postgres, o el mismo objeto en el
    // repositorio en memoria) — el roundtrip por JSON es lo que
    // realmente separa "persistir" de "ejecutar en vivo".
    const roundTripped = JSON.parse(JSON.stringify(persisted)) as PersistedRunConfig;

    const configFromCreate = buildSimulationConfig(persisted);
    const configFromWs = buildSimulationConfig(roundTripped);

    expect(configFromWs).toEqual(configFromCreate);
  });

  it("el ClimatePolicyConfig expandido usa la MISMA semilla que el SimulationConfig (RNF-003)", () => {
    const persisted = samplePersistedConfig({ climateEnabled: true });
    const config = buildSimulationConfig(persisted);

    expect(config.climate?.seed).toBe(config.seed);
    expect(config.seed).toBe(persisted.seed);
  });

  it("sin climateEnabled, no arma ningún ClimatePolicyConfig ni CatastropheConfig (Fase 4)", () => {
    const persisted = samplePersistedConfig({ climateEnabled: false });
    const config = buildSimulationConfig(persisted);

    expect(config.climate).toBeUndefined();
    expect(config.catastrophe).toBeUndefined();
  });

  it("RF-014 (escasez de pool) sigue siendo exclusivo de 'fast' — slow/moderate quedan como la Fase 3 los validó", () => {
    // Esta mitad de la decisión de la Fase 4 NO cambió: aplicar escasez de
    // pool incluso suave a slow/moderate alteraba de forma significativa el
    // fitness ya validado y cerrado en la Fase 3 (ver config-request.ts).
    const slow = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "slow", updates: 1000 }));
    const moderate = buildSimulationConfig(
      samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "moderate", updates: 1000 }),
    );
    const fast = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "fast", updates: 1000 }));

    expect(slow.climate?.resourcePool).toBeUndefined();
    expect(moderate.climate?.resourcePool).toBeUndefined();
    expect(fast.climate?.resourcePool).toEqual({ minMultiplier: 0.01, maxMultiplier: 0.1 });
  });

  it("RF-015 ya NO es exclusivo de 'fast': con catastropheEnabled hay catástrofes en las tres velocidades, con intensidad proporcional", () => {
    const configFor = (climateChangeSpeed: PersistedRunConfig["climateChangeSpeed"]) =>
      buildSimulationConfig(
        samplePersistedConfig({ climateEnabled: true, climateChangeSpeed, catastropheEnabled: true, updates: 1000 }),
      );

    expect(configFor("slow").catastrophe).toEqual({ intervalGenerations: 150, severity: 0.15 });
    expect(configFor("moderate").catastrophe).toEqual({ intervalGenerations: 60, severity: 0.15 });
    // "fast" conserva exactamente los valores de la Fase 4: son los que dan
    // extinción consistente junto con FAST_RESOURCE_POOL.
    expect(configFor("fast").catastrophe).toEqual({ intervalGenerations: 10, severity: 0.9 });
  });

  it("la intensidad crece con la velocidad: estrictamente más frecuentes, y nunca menos severas", () => {
    /*
     * La FRECUENCIA es la escalera real (150 → 60 → 10). La severidad no
     * crece de slow a moderate: las dos usan 0.15, decidido tras medir.
     * Subir la severidad de "moderate" resultaba en una selección mucho
     * más fuerte por velocidad de replicación (fitness tardío/temprano
     * saltaba a ≈3.7 con 0.25, ≈10 con 0.60) y el escenario "punto de
     * quiebre" pasaba a leerse como éxito rotundo — ver el comentario de
     * getCatastropheConfig. Lo que distingue a "moderate" de "slow" es
     * que los eventos llegan 2.5 veces más seguido, no que peguen más
     * fuerte.
     */
    const config = (climateChangeSpeed: PersistedRunConfig["climateChangeSpeed"]) =>
      getCatastropheConfig(climateChangeSpeed);

    expect(config("slow").intervalGenerations).toBeGreaterThan(config("moderate").intervalGenerations);
    expect(config("moderate").intervalGenerations).toBeGreaterThan(config("fast").intervalGenerations);

    expect(config("moderate").severity).toBeGreaterThanOrEqual(config("slow").severity);
    expect(config("fast").severity).toBeGreaterThan(config("moderate").severity);
  });

  it("con catastropheEnabled en false no hay catástrofes en NINGUNA velocidad, ni siquiera en 'fast'", () => {
    for (const climateChangeSpeed of ["slow", "moderate", "fast"] as const) {
      const config = buildSimulationConfig(
        samplePersistedConfig({ climateEnabled: true, climateChangeSpeed, catastropheEnabled: false, updates: 1000 }),
      );
      expect(config.catastrophe, climateChangeSpeed).toBeUndefined();
    }
  });

  it("sin clima activo no hay catástrofes aunque catastropheEnabled sea true — son una dimensión del módulo climático", () => {
    const config = buildSimulationConfig(
      samplePersistedConfig({ climateEnabled: false, catastropheEnabled: true, climateChangeSpeed: "fast" }),
    );
    expect(config.catastrophe).toBeUndefined();
  });

  it("el intervalo de catástrofe de 'fast' es absoluto, no escala con updates (medido: escalarlo rompía la extinción consistente)", () => {
    const short = buildSimulationConfig(
      samplePersistedConfig({ climateEnabled: true, catastropheEnabled: true, climateChangeSpeed: "fast", updates: 1500 }),
    );
    const long = buildSimulationConfig(
      samplePersistedConfig({ climateEnabled: true, catastropheEnabled: true, climateChangeSpeed: "fast", updates: 3000 }),
    );

    expect(short.catastrophe?.intervalGenerations).toBe(long.catastrophe?.intervalGenerations);
  });

  it("quasiExtinction siempre está presente, con o sin clima activo", () => {
    const withClimate = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true }));
    const withoutClimate = buildSimulationConfig(samplePersistedConfig({ climateEnabled: false }));

    expect(withClimate.quasiExtinction).toEqual({ thresholdFraction: 0.1, sustainedGenerations: 20 });
    expect(withoutClimate.quasiExtinction).toEqual({ thresholdFraction: 0.1, sustainedGenerations: 20 });
  });

  it("con climateEnabled, siempre incluye un ancestro que ya resuelve NOT (ver createNotSolvingGenome)", () => {
    const persisted = samplePersistedConfig({ climateEnabled: true, numAncestors: 1 });
    const config = buildSimulationConfig(persisted);

    expect(config.ancestorGenomes.length).toBeGreaterThanOrEqual(2);
    const [adapted] = config.ancestorGenomes;
    expect(adapted?.[0]).toMatchObject({ opcode: "io", reg: "A" });
    expect(adapted?.[1]).toMatchObject({ opcode: "nand", reg: "A" });
    expect(adapted?.[2]).toMatchObject({ opcode: "io", reg: "A" });
  });

  it("Fase 6: sin climateTrendSource, el default es 'synthetic' (compatibilidad hacia atrás)", () => {
    const persisted = samplePersistedConfig({ climateEnabled: true });
    expect(persisted.climateTrendSource).toBe("synthetic");

    const config = buildSimulationConfig(persisted);
    expect(config.climate?.trendSource).toBe("synthetic");
  });

  it("Fase 6: climateTrendSource 'historical' se propaga a ClimatePolicyConfig junto con updates como totalGenerations", () => {
    const persisted = samplePersistedConfig({ climateEnabled: true, climateTrendSource: "historical", updates: 777 });
    const config = buildSimulationConfig(persisted);

    expect(config.climate?.trendSource).toBe("historical");
    expect(config.climate?.totalGenerations).toBe(777);
  });

  it("Fase 6: un climateTrendSource inválido se rechaza igual que un climateChangeSpeed inválido", () => {
    const parsed = parseCreateRunRequest({ climateTrendSource: "made-up" as never });
    expect("errors" in parsed).toBe(true);
  });
});
