export interface ResourceBounds {
  readonly taskId: string;
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
}

export interface ResourceSupply {
  readonly taskId: string;
  readonly rewardMultiplier: number;
}

export interface ClimateParameters {
  readonly generation: number;
  readonly resources: readonly ResourceSupply[];
}
