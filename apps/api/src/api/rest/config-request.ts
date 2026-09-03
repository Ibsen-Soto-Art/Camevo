import type { ClimateChangeSpeed, CreateRunRequest, PersistedRunConfig } from "@camevo/shared-types";
import { ClimatePolicyConfig } from "../../climate/policy/types";
import { Genome, createNotSolvingGenome, createUniformGenome } from "../../engine/organism/genome";
import { PlacementMode } from "../../engine/population/placement";
import { DEFAULT_TASKS } from "../../engine/tasks/task-registry";
import { ReproducibilityMode, resolveSeed } from "../../simulation/orchestrator/rng";
import { SimulationConfig } from "../../simulation/orchestrator/run";

/**
 * El body de POST /runs es JSON sin tipar hasta que `validationErrors`
 * lo confirma: cada campo se trata como `unknown` a propósito. Derivar
 * las claves de `CreateRunRequest` (shared-types) en vez de repetirlas
 * asegura que esta validación nunca quede desalineada en los NOMBRES de
 * campo del contrato real que espera apps/web.
 */
export type CreateRunRequestBody = { [K in keyof CreateRunRequest]?: unknown };

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
  { field: "climateVarianceAmplitude", min: 0, max: 0.5 },
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
  climateChangeSpeed: "moderate" as ClimateChangeSpeed,
  climateVarianceAmplitude: 0.15,
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

  if (
    body.climateChangeSpeed !== undefined &&
    body.climateChangeSpeed !== "slow" &&
    body.climateChangeSpeed !== "moderate" &&
    body.climateChangeSpeed !== "fast"
  ) {
    errors.push('climateChangeSpeed debe ser "slow", "moderate" o "fast"');
  }

  return errors;
}

export type ParseResult = { readonly config: PersistedRunConfig } | { readonly errors: readonly string[] };

/**
 * Traduce el body de POST /runs (JSON sin tipar) a un PersistedRunConfig
 * completo (defaults aplicados + semilla resuelta, RF-007) — la forma
 * limpia y JSON-segura que se persiste y se le muestra al usuario
 * (RF-025). NO expande genomas ni arma el ClimatePolicyConfig completo:
 * eso es responsabilidad de `buildSimulationConfig`, que cualquier
 * consumidor (api/rest al crear, api/ws al transmitir) puede llamar con
 * el mismo PersistedRunConfig para obtener siempre el mismo
 * SimulationConfig (ver test/api/build-simulation-config.test.ts).
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
  const climateChangeSpeed = (body.climateChangeSpeed as ClimateChangeSpeed | undefined) ?? DEFAULTS.climateChangeSpeed;
  const climateVarianceAmplitude = (body.climateVarianceAmplitude as number | undefined) ?? DEFAULTS.climateVarianceAmplitude;

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
    climateChangeSpeed,
    climateVarianceAmplitude,
  });
  const seed = resolveSeed(reproducibilityMode, fingerprint);

  const config: PersistedRunConfig = {
    gridWidth,
    gridHeight,
    baseCyclesPerUpdate,
    mutationRate,
    updates,
    placementMode,
    ancestorGenomeLength,
    numAncestors,
    reproducibilityMode,
    climateEnabled,
    climateChangeSpeed,
    climateVarianceAmplitude,
    seed,
  };

  return { config };
}

/**
 * RF-012: la "velocidad del cambio climático" que ve el usuario es un
 * preset con nombre, no un período crudo en generaciones (RNF-004). El
 * período real es una RAZÓN sobre `updates`, no un número absoluto —
 * "lenta" significa "no completa ni un ciclo dentro de esta corrida",
 * "rápida" significa "completa muchos ciclos" — validado empíricamente
 * (Fase 3): con período absoluto fijo, una corrida larga ve pasar varias
 * vueltas completas incluso en el preset "lenta" (auge y caída dentro de
 * la misma corrida), mientras que una corta apenas nota el "rápida".
 * Las tres razones de abajo se midieron en 20x20/mut=0.05, 5 semillas,
 * en corridas de 1500 Y 3000 generaciones (misma razón, mismo resultado
 * cualitativo en ambas): lenta ⇒ fitness tardío/temprano ≈ 1.25-1.26
 * (sube), moderada ⇒ ≈ 1.01-1.03 (estable), rápida ⇒ ≈ 0.98-1.00
 * (estancada/leve declive) — ver el reporte de cierre de la Fase 3 para
 * los números completos.
 */
const CLIMATE_CHANGE_SPEED_RATIOS: Record<ClimateChangeSpeed, number> = {
  slow: 8 / 3,
  moderate: 4 / 15,
  fast: 1 / 37.5,
};

function climateChangeSpeedToPeriod(speed: ClimateChangeSpeed, updates: number): number {
  return Math.max(1, Math.round(updates * CLIMATE_CHANGE_SPEED_RATIOS[speed]));
}

/**
 * RF-006/RF-011 con un techo real: 16 (el propio nivel "muy difícil ×16"
 * que ya documenta 02-requisitos.md), no un valor inventado. Con el
 * techo pequeño de la Fase 2 (task.multiplier*2, o sea 4-8) el bono de
 * CPU por tarea resuelta terminaba siendo ~0.05-0.1% del total de ciclos
 * que consume la población solo replicándose — estadísticamente
 * invisible sin importar qué tan rápido cambiara el clima (medido,
 * Fase 3). Con 16 para las tres tareas, la velocidad del cambio
 * climático sí produce una diferencia medible (ver arriba).
 */
const CLIMATE_MAX_MULTIPLIER = 16;

function buildClimateConfig(persisted: PersistedRunConfig): ClimatePolicyConfig {
  return {
    seed: persisted.seed,
    trendPeriodGenerations: climateChangeSpeedToPeriod(persisted.climateChangeSpeed, persisted.updates),
    varianceAmplitude: persisted.climateVarianceAmplitude,
    resources: DEFAULT_TASKS.map((task) => ({
      taskId: task.id,
      minMultiplier: 1,
      maxMultiplier: CLIMATE_MAX_MULTIPLIER,
    })),
  };
}

/**
 * Con clima activo, además de los ancestros `replicate` puros de
 * siempre (RF-008), se siembra uno que ya resuelve NOT (RF-021 del
 * reporte de la Fase 3): sin esto, observar el efecto de la velocidad
 * climática requeriría esperar a que la mutación descubra un
 * cassette de tarea por su cuenta, lo que en la Fase 1 tardó cientos a
 * miles de generaciones y en algunas semillas no ocurrió en absoluto
 * dentro de la corrida — no es viable para un demo en vivo. Es una
 * simplificación deliberada y declarada (ver createNotSolvingGenome),
 * no algo que "emerja" de forma natural en cada corrida.
 */
function buildAncestorGenomes(persisted: PersistedRunConfig): Genome[] {
  if (!persisted.climateEnabled) {
    return Array.from({ length: persisted.numAncestors }, () =>
      createUniformGenome("replicate", persisted.ancestorGenomeLength),
    );
  }

  const totalAncestors = Math.max(persisted.numAncestors, 2);
  const adaptedAncestor = createNotSolvingGenome(Math.max(persisted.ancestorGenomeLength, 13));
  const plainAncestors = Array.from({ length: totalAncestors - 1 }, () =>
    createUniformGenome("replicate", persisted.ancestorGenomeLength),
  );
  return [adaptedAncestor, ...plainAncestors];
}

/**
 * Expande un PersistedRunConfig (JSON plano, ya resuelto) al
 * SimulationConfig completo que el motor necesita para correr — genomas
 * ancestrales y ClimatePolicyConfig incluidos. Es una función pura y
 * determinista: el mismo PersistedRunConfig siempre produce el mismo
 * SimulationConfig, así que api/rest (para validar/persistir) y api/ws
 * (para efectivamente correr la corrida en vivo) nunca pueden divergir
 * silenciosamente entre sí (test/api/build-simulation-config.test.ts).
 */
export function buildSimulationConfig(persisted: PersistedRunConfig): SimulationConfig {
  return {
    gridWidth: persisted.gridWidth,
    gridHeight: persisted.gridHeight,
    baseCyclesPerUpdate: persisted.baseCyclesPerUpdate,
    mutationRate: persisted.mutationRate,
    ancestorGenomes: buildAncestorGenomes(persisted),
    placementMode: persisted.placementMode,
    updates: persisted.updates,
    seed: persisted.seed,
    ...(persisted.climateEnabled ? { climate: buildClimateConfig(persisted) } : {}),
  };
}
