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

  it("sin climateEnabled, no arma ningún ClimatePolicyConfig", () => {
    const persisted = samplePersistedConfig({ climateEnabled: false });
    const config = buildSimulationConfig(persisted);

    expect(config.climate).toBeUndefined();
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
});
