import { Instruction } from "../organism/instruction-set";
import { OrganismState } from "../organism/vm";

function instructionKey(instruction: Instruction): string {
  return `${instruction.opcode}:${instruction.reg}`;
}

/**
 * Fracción promedio de "no coincide con la moda" por posición, indexando
 * el genoma en la dirección dada (1 = desde el inicio, -1 = desde el
 * final). O(N·L): construye, por posición, un conteo de qué instrucción
 * es más común entre los organismos suficientemente largos para llegar
 * ahí, y promedia la fracción que no coincide con esa moda.
 */
function positionalDiversity(organisms: readonly OrganismState[], direction: 1 | -1): number {
  const maxLength = Math.max(...organisms.map((o) => o.genome.length));
  let sumMismatchFraction = 0;
  let countedPositions = 0;

  for (let offset = 0; offset < maxLength; offset++) {
    const counts = new Map<string, number>();
    let present = 0;
    for (const organism of organisms) {
      const length = organism.genome.length;
      if (offset >= length) continue;
      const position = direction === 1 ? offset : length - 1 - offset;
      const instruction = organism.genome[position];
      if (!instruction) continue;
      present += 1;
      const key = instructionKey(instruction);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (present === 0) continue;
    const modeCount = Math.max(...counts.values());
    sumMismatchFraction += (present - modeCount) / present;
    countedPositions += 1;
  }

  return countedPositions > 0 ? sumMismatchFraction / countedPositions : 0;
}

/**
 * Diversidad genética de la población (RF-021): 0 = población idéntica,
 * más cerca de 1 = más heterogénea.
 *
 * Los genomas tienen longitud variable (inserciones/eliminaciones,
 * RF-003), así que una distancia de edición real por par de genomas
 * (correcta ante indels) sería O(N²·L) por generación — demasiado cara
 * para poblaciones de cientos de organismos corriendo miles de
 * generaciones (ver climate-integration/tasks-reward tests). Esta
 * métrica es O(N·L): mira, por posición del genoma, qué fracción de la
 * población no coincide con la instrucción más común ahí, y promedia
 * sobre posiciones.
 *
 * El costo de esta aproximación es que compara por posición SIN alinear
 * secuencias: una sola inserción/eliminación cerca del inicio desplaza
 * todo lo que sigue frente a un genoma que no mutó ahí, así el
 * contenido sea funcionalmente idéntico. Se mitiga calculando la
 * diversidad tanto indexando desde el inicio como desde el final y
 * quedándose con el mínimo: un indel pegado a un extremo dado se
 * "realinea solo" al medirlo desde ese extremo (ver
 * test/engine/diversity.test.ts, que mide esto empíricamente). Un indel
 * en el MEDIO del genoma no se corrige del todo por este truco — sigue
 * quedando algo de ruido de desalineamiento, documentado y medido en el
 * mismo test, no es una alineación real tipo bioinformática.
 */
export function computeGeneticDiversity(organisms: readonly OrganismState[]): number {
  if (organisms.length <= 1) return 0;
  return Math.min(positionalDiversity(organisms, 1), positionalDiversity(organisms, -1));
}
