import type { ClimateChangeSpeed, ClimateTrendSource, CreateRunRequest, PersistedRunConfig } from "@camevo/shared-types";
import { ClimatePolicyConfig } from "../../climate/policy/types";
import { Genome, createNotSolvingGenome, createUniformGenome } from "../../engine/organism/genome";
import { PlacementMode } from "../../engine/population/placement";
import { DEFAULT_TASKS } from "../../engine/tasks/task-registry";
import { ReproducibilityMode, resolveSeed } from "../../simulation/orchestrator/rng";
import { CatastropheConfig, QuasiExtinctionConfig, SimulationConfig } from "../../simulation/orchestrator/run";

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
  // RF-023: puramente de presentación (ver comentario en shared-types),
  // pero igual se valida por RNF-008 — un valor negativo rompería
  // setTimeout, uno absurdamente alto (además de inútil) mantendría el
  // socket abierto sin necesidad durante horas.
  { field: "msPerGeneration", min: 0, max: 5000 },
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
  climateTrendSource: "synthetic" as ClimateTrendSource,
  catastropheEnabled: true,
  msPerGeneration: 80,
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

  // RF-015: mismo trato que climateEnabled. Sin esto, `catastropheEnabled:
  // "sí"` pasaba la validación, entraba como truthy al gate de
  // buildSimulationConfig y se persistía TAL CUAL en el JSONB de la
  // corrida — un string donde PersistedRunConfig declara boolean, que
  // además vuelve al cliente en GET /runs/:id.
  if (body.catastropheEnabled !== undefined && typeof body.catastropheEnabled !== "boolean") {
    errors.push("catastropheEnabled debe ser booleano");
  }

  if (
    body.climateChangeSpeed !== undefined &&
    body.climateChangeSpeed !== "slow" &&
    body.climateChangeSpeed !== "moderate" &&
    body.climateChangeSpeed !== "fast"
  ) {
    errors.push('climateChangeSpeed debe ser "slow", "moderate" o "fast"');
  }

  if (
    body.climateTrendSource !== undefined &&
    body.climateTrendSource !== "synthetic" &&
    body.climateTrendSource !== "historical"
  ) {
    errors.push('climateTrendSource debe ser "synthetic" o "historical"');
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
  const climateTrendSource = (body.climateTrendSource as ClimateTrendSource | undefined) ?? DEFAULTS.climateTrendSource;
  // Las corridas guardadas ANTES de que existiera este campo no lo traen
  // en su JSONB: `?? DEFAULTS` les da `true`, que es el comportamiento
  // que tenían de hecho en "fast" y el que tendrían hoy por defecto.
  const catastropheEnabled = (body.catastropheEnabled as boolean | undefined) ?? DEFAULTS.catastropheEnabled;
  const msPerGeneration = (body.msPerGeneration as number | undefined) ?? DEFAULTS.msPerGeneration;

  if (numAncestors > gridWidth * gridHeight) {
    return { errors: ["numAncestors no puede superar el tamaño de la grilla (gridWidth * gridHeight)"] };
  }

  // msPerGeneration deliberadamente FUERA del fingerprint: es puramente de
  // presentación (RF-023, ver shared-types) y no debe cambiar la semilla
  // en modo reproducible — dos corridas idénticas salvo el ritmo de
  // reproducción son, a efectos de RNF-003, la misma corrida.
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
    climateTrendSource,
    // A diferencia de msPerGeneration, esto SÍ cambia el resultado de la
    // simulación, así que dos corridas que difieran solo en esto no son
    // la misma corrida y no deben compartir semilla (RNF-003). Agregar la
    // clave corre el hash de TODA configuración: las semillas
    // reproducibles anteriores a este cambio no se reproducen con los
    // mismos parámetros (las corridas ya guardadas no se ven afectadas,
    // guardan su semilla junto al resto de su config).
    catastropheEnabled,
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
    climateTrendSource,
    catastropheEnabled,
    msPerGeneration,
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
 *
 * Esos números siguen siendo los de una corrida SIN eventos
 * catastróficos. Desde que RF-015 pasó a ser activable en las tres
 * velocidades (default: activo), la misma medición con catástrofes da,
 * 5 semillas, 1500 generaciones, 20x20:
 *
 *   lenta    1.37-1.91 (mediana 1.41), 0/5 extinciones, 9 eventos
 *   moderada 1.32-1.64 (mediana 1.53), 0/5 extinciones, 24 eventos
 *   rápida   0.00-1.44 (mediana 0.10), 5/5 extinciones entre gen 21 y 41
 *
 * Qué significa esa suba, medido y no supuesto: NO es un artefacto del
 * denominador. Separando los términos de `averageFitness`
 * (= births / populationSize) en una corrida moderada, la población es
 * idéntica con y sin catástrofes (393.9 → 400.0 en ambos casos) y lo que
 * crece es el numerador — los nacimientos por generación pasan de
 * 489→508 (x1.04) sin catástrofes a 568→2034 (x3.58) con ellas a
 * severidad 0.25. Cada evento libera celdas al azar y las ocupan los
 * replicadores más rápidos, así que la corrida selecciona por velocidad
 * de replicación generación tras generación. Es selección real, y la
 * métrica la reporta bien.
 *
 * Por eso la severidad de "moderada" quedó en 0.15 y no más alta (ver
 * getCatastropheConfig): a 0.25 la mediana sube a 3.71 y a 0.60 a 10.4,
 * siempre con 0/5 extinciones — más selectivo, no más peligroso.
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

/**
 * RF-014 (escasez de pool) sigue siendo exclusivo de "fast" — decisión
 * tomada tras medir el efecto en las tres velocidades: aplicar incluso
 * una escasez de pool suave a "slow"/"moderate" alteraba de forma
 * significativa el fitness tardío/temprano que la Fase 3 ya había
 * validado y cerrado (v0.9.0/v0.9.1) — "slow" pasaba de ≈1.25 (sube) a
 * ≈1.0 (plano), y "moderate" de ≈1.02 (estable) a ≈3-4.6 (sube mucho,
 * un efecto lateral no buscado).
 *
 * RF-015 (eventos catastróficos) ya NO sigue esa regla: pasó a ser una
 * dimensión propia, activable por el usuario en cualquier velocidad, con
 * intensidad proporcional (ver getCatastropheConfig). Importante para no
 * confundir las dos cosas: la medición de arriba es sobre el POOL, no
 * sobre las catástrofes — y el aislamiento de mecanismos de la Fase 4
 * (test/simulation/collapse-mechanism-isolation.test.ts) midió que las
 * catástrofes SOLAS, incluso al ajuste más agresivo (interval=10,
 * severity=0.9) y con el pool normal, no extinguen la población en 1500
 * generaciones. Son un mecanismo de perturbación recuperable, no de
 * colapso; el colapso de "fast" lo produce la combinación con el pool.
 *
 * Los valores de abajo son ABSOLUTOS (no una razón sobre `updates`,
 * a diferencia de `CLIMATE_CHANGE_SPEED_RATIOS`): medido empíricamente
 * que la velocidad de recuperación de la población depende de cantidades
 * absolutas del motor (longitud del genoma, baseCyclesPerUpdate), no del
 * total de generaciones configuradas — con un intervalo expresado como
 * razón, duplicar `updates` le daba a la población el doble de
 * generaciones absolutas para recuperarse entre eventos, y la
 * extinción dejaba de ser consistente (2/5 semillas en vez de 5/5 al
 * pasar de 1500 a 3000 generaciones). Con estos valores fijos: 10/10
 * semillas (5 en 1500 gens, 5 en 3000 gens) llegan a extinción real,
 * entre las generaciones 21 y 131 — ver el reporte de cierre de la
 * Fase 4 para la tabla completa.
 */
const FAST_RESOURCE_POOL = { minMultiplier: 0.01, maxMultiplier: 0.1 };
const FAST_CATASTROPHE: CatastropheConfig = { intervalGenerations: 10, severity: 0.9 };

/** Criterio secundario de colapso (deuda de extinción): constantes fijas, no expuestas como control de usuario todavía. */
const QUASI_EXTINCTION_THRESHOLD_FRACTION = 0.1;
const QUASI_EXTINCTION_SUSTAINED_GENERATIONS = 20;

function buildClimateConfig(persisted: PersistedRunConfig): ClimatePolicyConfig {
  return {
    seed: persisted.seed,
    trendPeriodGenerations: climateChangeSpeedToPeriod(persisted.climateChangeSpeed, persisted.updates),
    varianceAmplitude: persisted.climateVarianceAmplitude,
    trendSource: persisted.climateTrendSource,
    totalGenerations: persisted.updates,
    resources: DEFAULT_TASKS.map((task) => ({
      taskId: task.id,
      minMultiplier: 1,
      maxMultiplier: CLIMATE_MAX_MULTIPLIER,
    })),
    ...(persisted.climateChangeSpeed === "fast" ? { resourcePool: FAST_RESOURCE_POOL } : {}),
  };
}

/**
 * RF-015: intensidad proporcional a la velocidad del cambio climático.
 * El usuario elige SI hay catástrofes (`catastropheEnabled`), no de qué
 * tamaño — traducir "severidad 0.4" a una expectativa concreta requiere
 * saber cómo funciona el motor, que es justo lo que RNF-004 no puede
 * asumir.
 *
 * La escalera real es la FRECUENCIA (150 → 60 → 10 generaciones).
 * "slow" y "moderate" comparten severidad (0.15) a propósito, no por
 * descuido: medido con 5 semillas sobre 1500 generaciones, subir la
 * severidad de "moderate" no hace el escenario más duro, lo hace más
 * SELECTIVO — cada evento libera celdas que ocupan los replicadores más
 * rápidos, y el fitness tardío/temprano se dispara (≈1.53 con 0.15,
 * ≈3.7 con 0.25, ≈10.4 con 0.60) sin que la población corra más riesgo
 * de extinguirse (0/5 en todos los casos). Un "punto de quiebre" cuyo
 * gráfico de fitness sube 4x se lee como éxito rotundo, que es lo
 * contrario de lo que ese escenario enseña. Lo que distingue a
 * "moderate" es que los eventos llegan 2.5 veces más seguido.
 *
 * "fast" es el único que sube la severidad, y ahí el salto sí es a
 * colapso: junto con FAST_RESOURCE_POOL extingue 5/5 semillas.
 *
 * "fast" conserva exactamente los valores de la Fase 4 (10 / 0.9): son
 * los que dan extinción consistente 10/10 semillas junto con
 * FAST_RESOURCE_POOL, medidos, y cambiarlos invalidaría ese cierre.
 */
export function getCatastropheConfig(speed: ClimateChangeSpeed): CatastropheConfig {
  switch (speed) {
    case "slow":
      return { intervalGenerations: 150, severity: 0.15 };
    case "moderate":
      return { intervalGenerations: 60, severity: 0.15 };
    case "fast":
      return FAST_CATASTROPHE;
  }
}

function buildQuasiExtinctionConfig(): QuasiExtinctionConfig {
  return { thresholdFraction: QUASI_EXTINCTION_THRESHOLD_FRACTION, sustainedGenerations: QUASI_EXTINCTION_SUSTAINED_GENERATIONS };
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
    quasiExtinction: buildQuasiExtinctionConfig(),
    ...(persisted.climateEnabled ? { climate: buildClimateConfig(persisted) } : {}),
    ...(persisted.climateEnabled && persisted.catastropheEnabled
      ? { catastrophe: getCatastropheConfig(persisted.climateChangeSpeed) }
      : {}),
  };
}
