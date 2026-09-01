import { Instruction, OPCODES, Opcode, Register, REGISTERS } from "./instruction-set";

export type Genome = readonly Instruction[];

export type RandomSource = () => number;

function pick<T>(items: readonly T[], rng: RandomSource): T {
  const index = Math.floor(rng() * items.length);
  return items[Math.min(index, items.length - 1)] as T;
}

export function randomInstruction(rng: RandomSource): Instruction {
  const opcode: Opcode = pick(OPCODES, rng);
  const reg: Register = pick(REGISTERS, rng);
  return { opcode, reg };
}

export function createUniformGenome(opcode: Opcode, length: number, reg: Register = "A"): Genome {
  if (length < 1) {
    throw new Error("El genoma debe tener al menos una instrucción");
  }
  return Array.from({ length }, () => ({ opcode, reg }));
}

export type MutationKind = "none" | "substitution" | "insertion" | "deletion";

/**
 * La tasa de mutación (RF-003) se evalúa una vez por instrucción copiada; si
 * se dispara, el tipo (sustitución/inserción/eliminación) se elige con
 * probabilidad uniforme entre las tres, en vez de exponer tres tasas
 * independientes — mantiene la configuración a un único número (RF-007).
 */
export function decideMutationKind(rng: RandomSource, mutationRate: number): MutationKind {
  if (rng() >= mutationRate) {
    return "none";
  }
  const roll = rng();
  if (roll < 1 / 3) return "substitution";
  if (roll < 2 / 3) return "insertion";
  return "deletion";
}

export interface CopyStepResult {
  readonly appended: Instruction | null;
  readonly consumedParentInstruction: boolean;
  readonly mutation: MutationKind;
}

/**
 * Un paso de copia del mecanismo de autorreplicación (ver instruction-set.ts
 * para la justificación de por qué `replicate` reemplaza al mecanismo de
 * cabezas de Avida). `parentReadPos` y el buffer de la cría se mantienen en
 * el estado de la VM (vm.ts); esta función es la lógica pura de un paso,
 * separable para poder testearla sin ejecutar una VM completa.
 */
export function copyStep(
  parentGenome: Genome,
  parentReadPos: number,
  mutationRate: number,
  rng: RandomSource,
): CopyStepResult {
  const sourceInstruction = parentGenome[parentReadPos];
  if (!sourceInstruction) {
    throw new Error("parentReadPos fuera de rango del genoma parental");
  }

  const mutation = decideMutationKind(rng, mutationRate);

  switch (mutation) {
    case "none":
      return { appended: sourceInstruction, consumedParentInstruction: true, mutation };
    case "substitution":
      return { appended: randomInstruction(rng), consumedParentInstruction: true, mutation };
    case "insertion":
      return { appended: randomInstruction(rng), consumedParentInstruction: false, mutation };
    case "deletion":
      return { appended: null, consumedParentInstruction: true, mutation };
  }
}
