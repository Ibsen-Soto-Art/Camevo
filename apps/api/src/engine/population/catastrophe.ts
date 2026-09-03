import { RandomSource } from "../organism/genome";
import { Grid } from "./grid";

/**
 * RF-015: elimina una fracción (`severity`, 0-1) de la población viva,
 * elegida al azar sin reemplazo — un evento catastrófico. Determinista
 * dado el mismo `rng` de la corrida (RNF-003). Devuelve cuántos
 * organismos murieron.
 *
 * Partial Fisher-Yates: solo se necesitan `killCount` posiciones al
 * azar, no barajar toda la lista de ocupados.
 */
export function applyCatastrophicEvent(grid: Grid, severity: number, rng: RandomSource): number {
  const occupied = grid.occupiedIndices();
  const killCount = Math.min(occupied.length, Math.round(occupied.length * severity));

  for (let i = 0; i < killCount; i++) {
    const j = i + Math.floor(rng() * (occupied.length - i));
    const temp = occupied[i] as number;
    occupied[i] = occupied[j] as number;
    occupied[j] = temp;
    grid.kill(occupied[i] as number);
  }

  return killCount;
}
