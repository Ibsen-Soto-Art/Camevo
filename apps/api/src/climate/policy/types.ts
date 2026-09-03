import type { ResourceSupply } from "@camevo/shared-types";

export type { ResourceSupply };

export interface ResourceBounds {
  readonly taskId: string;
  readonly minMultiplier: number;
  readonly maxMultiplier: number;
}

/**
 * RF-014: límites del pool de CPU global, SEPARADO de los recursos por
 * tarea (`ResourceBounds`) — representa "cuánta CPU base hay disponible
 * en total", no "qué tan rentable es resolver una tarea". `maxMultiplier`
 * se espera en 1.0 (RF-014 es "reducción", nunca otorga más que la línea
 * base); `minMultiplier` es el piso de escasez. Opcional: si se omite,
 * el pool nunca se reduce (multiplicador siempre 1).
 */
export interface ResourcePoolBounds {
  readonly minMultiplier: number;
  readonly maxMultiplier: number;
}

export interface ClimatePolicyConfig {
  /** La MISMA semilla que simulation/orchestrator resuelve para RF-007/RNF-003 — no una propia. */
  readonly seed: number;
  readonly resources: readonly ResourceBounds[];
  readonly trendPeriodGenerations: number;
  /** Fracción del rango [minMultiplier, maxMultiplier] que puede añadir/quitar el ruido. */
  readonly varianceAmplitude: number;
  readonly resourcePool?: ResourcePoolBounds;
}

export interface ClimateParameters {
  readonly generation: number;
  readonly resources: readonly ResourceSupply[];
  /** RF-014: multiplicador vigente sobre baseCyclesPerUpdate. 1 si no hay resourcePool configurado. */
  readonly resourcePoolMultiplier: number;
}
