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

const NOT_SOLVING_CASSETTE: readonly Instruction[] = [
  { opcode: "io", reg: "A" },
  { opcode: "nand", reg: "A" },
  { opcode: "io", reg: "A" },
];

/**
 * Genoma ancestral que ya resuelve NOT desde su primera ejecución
 * (io A → nand A → io A calcula el complemento de cualquier input que
 * reciba, sin importar cuál sea), rellenado con `replicate` hasta
 * `totalLength`.
 *
 * Se usa para sembrar un ancestro ya adaptado cuando hace falta
 * observar el efecto de climate/policy (RF-011/012/013) dentro de un
 * tiempo de corrida razonable: medido en la Fase 1
 * (tasks-reward.test.ts), dejar que la mutación descubra esta misma
 * secuencia por casualidad tarda cientos a miles de generaciones, y en
 * algunas semillas no ocurre en absoluto dentro de la corrida — no es
 * viable para un demo en vivo. Es una simplificación deliberada y
 * declarada, no algo que "emerja" de forma natural en cada corrida.
 */
export function createNotSolvingGenome(totalLength: number): Genome {
  if (totalLength < NOT_SOLVING_CASSETTE.length) {
    throw new Error(`totalLength debe ser al menos ${NOT_SOLVING_CASSETTE.length}`);
  }
  const tailLength = totalLength - NOT_SOLVING_CASSETTE.length;
  const tail = tailLength > 0 ? createUniformGenome("replicate", tailLength) : [];
  return [...NOT_SOLVING_CASSETTE, ...tail];
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
