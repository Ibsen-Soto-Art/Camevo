import { ClimatePolicyConfig } from "../../climate/policy/types";
import { createUniformGenome } from "../../engine/organism/genome";
import { PlacementMode } from "../../engine/population/placement";
import { DEFAULT_TASKS } from "../../engine/tasks/task-registry";
import { ReproducibilityMode, resolveSeed } from "../../simulation/orchestrator/rng";
import { SimulationConfig } from "../../simulation/orchestrator/run";

export interface CreateRunRequestBody {
  gridWidth?: unknown;
  gridHeight?: unknown;
  baseCyclesPerUpdate?: unknown;
  mutationRate?: unknown;
  updates?: unknown;
  placementMode?: unknown;
  ancestorGenomeLength?: unknown;
  numAncestors?: unknown;
  reproducibilityMode?: unknown;
  climateEnabled?: unknown;
}

interface NumericLimit {
  readonly field: keyof CreateRunRequestBody;
  readonly min: number;
  readonly max: number;
}

/** RNF-008: valores fuera de rango podrían colgar el servidor (grillas o corridas enormes). */
const LIMITS: readonly NumericLimit[] = [
  { field: "gridWidth", min: 2, max: 40 },
  { field: "gridHeight", min: 2, max: 40 },
  { field: "baseCyclesPerUpdate", min: 1, max: 500 },
  { field: "mutationRate", min: 0, max: 1 },
  { field: "updates", min: 1, max: 5000 },
  { field: "ancestorGenomeLength", min: 1, max: 200 },
  { field: "numAncestors", min: 1, max: 20 },
];

const DEFAULTS = {
  gridWidth: 10,
  gridHeight: 10,
  baseCyclesPerUpdate: 20,
  mutationRate: 0.05,
  updates: 300,
  placementMode: "near-parent" as PlacementMode,
  ancestorGenomeLength: 24,
  numAncestors: 1,
  reproducibilityMode: "reproducible" as ReproducibilityMode,
  climateEnabled: true,
};

function validationErrors(body: CreateRunRequestBody): string[] {
  const errors: string[] = [];

  for (const { field, min, max } of LIMITS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${field} debe ser un número`);
      continue;
    }
    if (value < min || value > max) {
      errors.push(`${field} debe estar entre ${min} y ${max}`);
    }
  }

  if (body.placementMode !== undefined && body.placementMode !== "near-parent" && body.placementMode !== "random") {
    errors.push('placementMode debe ser "near-parent" o "random"');
  }

  if (
    body.reproducibilityMode !== undefined &&
    body.reproducibilityMode !== "reproducible" &&
    body.reproducibilityMode !== "experimental"
  ) {
    errors.push('reproducibilityMode debe ser "reproducible" o "experimental"');
  }

  if (body.climateEnabled !== undefined && typeof body.climateEnabled !== "boolean") {
    errors.push("climateEnabled debe ser booleano");
  }

  return errors;
}

function buildDefaultClimateConfig(seed: number): ClimatePolicyConfig {
  return {
    seed,
    trendPeriodGenerations: 150,
    varianceAmplitude: 0.15,
    resources: DEFAULT_TASKS.map((task) => ({
      taskId: task.id,
      minMultiplier: 1,
      maxMultiplier: task.multiplier * 2,
    })),
  };
}

export type ParseResult = { readonly config: SimulationConfig } | { readonly errors: readonly string[] };

/**
 * Traduce el body de POST /runs (JSON sin tipar) a un SimulationConfig
 * completo, incluyendo la resolución de semilla (RF-007) y, si
 * corresponde, la config de climate/policy (RF-011) con constantes
 * internas de tendencia/varianza — RF-012/RF-013 (exponerlas como control
 * de usuario) quedan para la Fase 3.
 */
export function parseCreateRunRequest(body: CreateRunRequestBody): ParseResult {
  const errors = validationErrors(body);
  if (errors.length > 0) {
    return { errors };
  }

  const gridWidth = (body.gridWidth as number | undefined) ?? DEFAULTS.gridWidth;
  const gridHeight = (body.gridHeight as number | undefined) ?? DEFAULTS.gridHeight;
  const baseCyclesPerUpdate = (body.baseCyclesPerUpdate as number | undefined) ?? DEFAULTS.baseCyclesPerUpdate;
  const mutationRate = (body.mutationRate as number | undefined) ?? DEFAULTS.mutationRate;
  const updates = (body.updates as number | undefined) ?? DEFAULTS.updates;
  const placementMode = (body.placementMode as PlacementMode | undefined) ?? DEFAULTS.placementMode;
  const ancestorGenomeLength = (body.ancestorGenomeLength as number | undefined) ?? DEFAULTS.ancestorGenomeLength;
  const numAncestors = (body.numAncestors as number | undefined) ?? DEFAULTS.numAncestors;
  const reproducibilityMode = (body.reproducibilityMode as ReproducibilityMode | undefined) ?? DEFAULTS.reproducibilityMode;
  const climateEnabled = (body.climateEnabled as boolean | undefined) ?? DEFAULTS.climateEnabled;

  if (numAncestors > gridWidth * gridHeight) {
    return { errors: ["numAncestors no puede superar el tamaño de la grilla (gridWidth * gridHeight)"] };
  }

  const fingerprint = JSON.stringify({
    gridWidth,
    gridHeight,
    baseCyclesPerUpdate,
    mutationRate,
    updates,
    placementMode,
    ancestorGenomeLength,
    numAncestors,
    climateEnabled,
  });
  const seed = resolveSeed(reproducibilityMode, fingerprint);

  const ancestorGenomes = Array.from({ length: numAncestors }, () => createUniformGenome("replicate", ancestorGenomeLength));

  const config: SimulationConfig = {
    gridWidth,
    gridHeight,
    baseCyclesPerUpdate,
    mutationRate,
    ancestorGenomes,
    placementMode,
    updates,
    seed,
    ...(climateEnabled ? { climate: buildDefaultClimateConfig(seed) } : {}),
  };

  return { config };
}
