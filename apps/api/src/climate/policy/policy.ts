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
 * Determinismo (RNF-003): usa la MISMA semilla que resuelve
 * simulation/orchestrator para el modo reproducible/experimental
 * (RF-007) — no una semilla propia — para que "misma corrida" implique
 * también "misma curva climática".
 */
export function getClimateParameters(generation: number, config: ClimatePolicyConfig): ClimateParameters {
  const resources: ResourceSupply[] = config.resources.map((resource, index) => {
    const range = resource.maxMultiplier - resource.minMultiplier;
    const phase = phaseFor(index, config.resources.length);
    const trendUnit = (Math.sin(TWO_PI * (generation / config.trendPeriodGenerations) + phase) + 1) / 2;
    const noiseUnit = deterministicUnit(config.seed, generation, resource.taskId) * 2 - 1;

    const rewardMultiplier = clamp(
      resource.minMultiplier + trendUnit * range + noiseUnit * config.varianceAmplitude * range,
      resource.minMultiplier,
      resource.maxMultiplier,
    );

    return { taskId: resource.taskId, rewardMultiplier };
  });

  return { generation, resources };
}
