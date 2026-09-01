/**
 * climate/policy es intencionalmente autocontenido: no reutiliza el PRNG
 * de simulation/orchestrator (crearía una dependencia climate→simulation,
 * y ya es simulation quien depende de climate) ni ninguna utilidad de
 * engine/*. Esta función hash es la única fuente de "azar" del módulo, y
 * es puramente determinista: la misma terna (seed, generación, taskId)
 * siempre produce el mismo valor en [0, 1).
 */
export function deterministicUnit(seed: number, generation: number, key: string): number {
  const input = `${seed >>> 0}:${generation}:${key}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}
