import { GISTEMP_ANNUAL_ANOMALY_C } from "./gistemp-annual-anomaly";

const MIN_ANOMALY = Math.min(...GISTEMP_ANNUAL_ANOMALY_C);
const MAX_ANOMALY = Math.max(...GISTEMP_ANNUAL_ANOMALY_C);
const ANOMALY_RANGE = MAX_ANOMALY - MIN_ANOMALY;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fase 6 (ClimateTrendSource "historical"): mapea una generación de la
 * corrida linealmente sobre TODA la serie 1880-2025 (generación 0 → 1880,
 * última generación → 2025) y normaliza la anomalía real de ese año a
 * [0,1] con el mínimo/máximo de la propia serie — así la FORMA real de la
 * curva (incluida la aceleración de la tendencia desde ~1980 que
 * 01-vision-general.md usa como ejemplo) se preserva, no solo sus
 * extremos. Reemplaza al `trendUnit` senoidal de `oscillate()` en
 * policy.ts; el resto (varianza determinista, límites por recurso) no
 * cambia.
 */
export function historicalTrendUnit(generation: number, totalGenerations: number): number {
  const fraction = totalGenerations > 1 ? clamp(generation / (totalGenerations - 1), 0, 1) : 0;
  const index = Math.round(fraction * (GISTEMP_ANNUAL_ANOMALY_C.length - 1));
  const anomaly = GISTEMP_ANNUAL_ANOMALY_C[index]!;
  return ANOMALY_RANGE > 0 ? (anomaly - MIN_ANOMALY) / ANOMALY_RANGE : 0;
}
