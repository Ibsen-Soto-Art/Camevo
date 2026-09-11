import { historicalTrendUnit } from "./historical";
import { deterministicUnit } from "./noise";
import { ClimateParameters, ClimatePolicyConfig, ResourceSupply } from "./types";

const TWO_PI = Math.PI * 2;

function phaseFor(index: number, total: number): number {
  return total > 0 ? (index / total) * TWO_PI : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Tendencia + varianza (ruido determinista) sobre [min, max] — la misma
 * fórmula para cualquier cosa que climate/policy haga oscilar: recursos
 * por tarea (RF-011) o el pool de CPU global (RF-014). `key` distingue la
 * fuente de ruido (p. ej. el id de la tarea, o `"__pool__"` para el pool).
 *
 * Fase 6 (`trendSource: "historical"`): la tendencia deja de ser la onda
 * senoidal con fase propia por tarea y pasa a ser la serie real de
 * anomalía de temperatura global de NASA GISTEMP (ver historical.ts). Al
 * haber UNA sola curva real (no una por tarea), `phase` se ignora en este
 * modo — todos los recursos se mueven sincronizados con el mismo clima
 * real, a diferencia del desfase deliberado del modo sintético. Es una
 * simplificación honesta (solo existe una curva real), no un atajo: se
 * decidió así, en vez de inventar un desfase artificial sobre datos
 * reales, para no falsear la fuente.
 */
function oscillate(
  generation: number,
  config: ClimatePolicyConfig,
  key: string,
  phase: number,
  min: number,
  max: number,
): number {
  const range = max - min;
  const trendUnit =
    config.trendSource === "historical"
      ? historicalTrendUnit(generation, config.totalGenerations ?? config.trendPeriodGenerations)
      : (Math.sin(TWO_PI * (generation / config.trendPeriodGenerations) + phase) + 1) / 2;
  const noiseUnit = deterministicUnit(config.seed, generation, key) * 2 - 1;
  return clamp(min + trendUnit * range + noiseUnit * config.varianceAmplitude * range, min, max);
}

/**
 * RF-019 en esta fase: el "suministro por recurso" se modela como un
 * multiplicador de recompensa oscilante (tendencia + varianza) por tarea,
 * NO como un recurso agotable por consumo poblacional (el modelo
 * ilimitado/limitado estilo Avida-ED). Es la simplificación adoptada para
 * el alcance de la Fase 2: RF-019 queda PARCIALMENTE resuelto con esta
 * interpretación, no con agotamiento real por consumo — si una fase
 * posterior decide modelar eso, este módulo es el único punto a extender.
 *
 * RF-011: la tendencia es una onda senoidal lenta con una fase distinta
 * por tarea (para que no todas suban o bajen a la vez — el recurso de una
 * tarea puede estar cerca de su pico mientras el de otra está cerca de su
 * valle); la varianza es ruido determinista superpuesto a esa tendencia.
 * Se combinan ambas, siguiendo la definición de cambio climático usada en
 * el proyecto (01-vision-general.md: medias + variabilidad, no solo una
 * tendencia lineal).
 *
 * RF-014 (Fase 4): el pool de CPU global (`resourcePoolMultiplier`) usa
 * la MISMA fórmula de oscilación, con límites propios (`resourcePool`) y
 * fase fija (no compite por índice con las tareas) — representa escasez
 * de recursos independiente de qué tarea es rentable, no un cuarto
 * "recurso por tarea".
 *
 * Determinismo (RNF-003): usa la MISMA semilla que resuelve
 * simulation/orchestrator para el modo reproducible/experimental
 * (RF-007) — no una semilla propia — para que "misma corrida" implique
 * también "misma curva climática".
 */
export function getClimateParameters(generation: number, config: ClimatePolicyConfig): ClimateParameters {
  const resources: ResourceSupply[] = config.resources.map((resource, index) => ({
    taskId: resource.taskId,
    rewardMultiplier: oscillate(
      generation,
      config,
      resource.taskId,
      phaseFor(index, config.resources.length),
      resource.minMultiplier,
      resource.maxMultiplier,
    ),
  }));

  const resourcePoolMultiplier = config.resourcePool
    ? oscillate(generation, config, "__pool__", Math.PI, config.resourcePool.minMultiplier, config.resourcePool.maxMultiplier)
    : 1;

  return { generation, resources, resourcePoolMultiplier };
}
