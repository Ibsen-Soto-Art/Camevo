import type { ReproducibilityMode } from "@camevo/shared-types";
import { RandomSource } from "../../engine/organism/genome";

export type { ReproducibilityMode };

/** PRNG determinista (mulberry32): misma semilla → misma secuencia siempre. */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * RF-007 / RNF-003: en modo "reproducible" la semilla se deriva de forma
 * determinista de la huella de configuración (nunca se expone el número
 * crudo al usuario final); en modo "experimental" se genera una semilla
 * nueva en cada llamada a partir de una fuente no determinista.
 */
export function resolveSeed(mode: ReproducibilityMode, configFingerprint: string): number {
  if (mode === "experimental") {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  return fnv1a(configFingerprint);
}
