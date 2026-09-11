import type { PersistedRunConfig } from "@camevo/shared-types";
import { describe, expect, it } from "vitest";
import { buildSimulationConfig, parseCreateRunRequest } from "../../src/api/rest/config-request";

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

  it("RF-014/RF-015 solo se activan en velocidad 'fast' — 'slow'/'moderate' quedan exactamente como la Fase 3 las validó", () => {
    // Decisión tomada tras medir el efecto (ver config-request.ts): aplicar
    // escasez de pool incluso suave a slow/moderate alteraba de forma
    // significativa el fitness ya validado y cerrado en la Fase 3.
    const slow = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "slow", updates: 1000 }));
    const moderate = buildSimulationConfig(
      samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "moderate", updates: 1000 }),
    );
    const fast = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "fast", updates: 1000 }));

    expect(slow.catastrophe).toBeUndefined();
    expect(slow.climate?.resourcePool).toBeUndefined();
    expect(moderate.catastrophe).toBeUndefined();
    expect(moderate.climate?.resourcePool).toBeUndefined();

    expect(fast.catastrophe).toEqual({ intervalGenerations: 10, severity: 0.9 });
    expect(fast.climate?.resourcePool).toEqual({ minMultiplier: 0.01, maxMultiplier: 0.1 });
  });

  it("el intervalo de catástrofe de 'fast' es absoluto, no escala con updates (medido: escalarlo rompía la extinción consistente)", () => {
    const short = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "fast", updates: 1500 }));
    const long = buildSimulationConfig(samplePersistedConfig({ climateEnabled: true, climateChangeSpeed: "fast", updates: 3000 }));

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
