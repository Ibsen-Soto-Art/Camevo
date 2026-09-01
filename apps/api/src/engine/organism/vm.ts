import { Instruction, Register } from "./instruction-set";
import { Genome, RandomSource, copyStep } from "./genome";

export interface OrganismState {
  genome: Genome;
  readonly registers: Record<Register, number>;
  ip: number;
  cyclesRemaining: number;
  /** Últimos valores leídos vía `io`, el más reciente primero (máx. 2). */
  inputHistory: number[];
  readonly tasksSolved: Set<string>;
  parentReadPos: number;
  offspringBuffer: Instruction[];
  readyToDivide: boolean;
  readonly mutationRate: number;
  offspringProduced: number;
}

export interface CreateOrganismOptions {
  mutationRate: number;
}

export function createOrganism(genome: Genome, options: CreateOrganismOptions): OrganismState {
  if (genome.length === 0) {
    throw new Error("No se puede crear un organismo con genoma vacío");
  }
  return {
    genome,
    registers: { A: 0, B: 0, C: 0 },
    ip: 0,
    cyclesRemaining: 0,
    inputHistory: [],
    tasksSolved: new Set(),
    parentReadPos: 0,
    offspringBuffer: [],
    readyToDivide: false,
    mutationRate: options.mutationRate,
    offspringProduced: 0,
  };
}

function wrap32(value: number): number {
  return value >>> 0;
}

function randomInput(rng: RandomSource): number {
  return Math.floor(rng() * 0x1_0000_0000) >>> 0;
}

export interface VmHooks {
  /** Se invoca cuando el organismo emite una salida vía `io`. */
  onOutput(outputValue: number, recentInputs: readonly number[]): void;
}

/**
 * Ejecuta una única instrucción y avanza el estado del organismo un ciclo.
 * No decide nada sobre supervivencia ni reproducción real: solo actualiza
 * registros/heads y, si `replicate` completa la copia, marca
 * `readyToDivide` para que `engine/population` decida cómo y dónde nace
 * la cría (grilla, reemplazo, colocación).
 */
export function step(state: OrganismState, hooks: VmHooks, rng: RandomSource): void {
  const genomeLength = state.genome.length;
  const instruction = state.genome[state.ip];
  if (!instruction) {
    throw new Error("Instruction pointer fuera de rango del genoma");
  }

  let nextIp = (state.ip + 1) % genomeLength;

  switch (instruction.opcode) {
    case "nop":
      break;
    case "inc":
      state.registers[instruction.reg] = wrap32(state.registers[instruction.reg] + 1);
      break;
    case "dec":
      state.registers[instruction.reg] = wrap32(state.registers[instruction.reg] - 1);
      break;
    case "swap": {
      const a = state.registers.A;
      state.registers.A = state.registers[instruction.reg];
      state.registers[instruction.reg] = a;
      break;
    }
    case "add":
      state.registers.A = wrap32(state.registers.A + state.registers[instruction.reg]);
      break;
    case "sub":
      state.registers.A = wrap32(state.registers.A - state.registers[instruction.reg]);
      break;
    case "nand":
      state.registers.A = wrap32(~(state.registers.A & state.registers[instruction.reg]));
      break;
    case "io": {
      const outputValue = state.registers[instruction.reg];
      hooks.onOutput(outputValue, state.inputHistory);
      const newInput = randomInput(rng);
      state.registers[instruction.reg] = newInput;
      state.inputHistory = [newInput, ...state.inputHistory].slice(0, 2);
      break;
    }
    case "if_n_equ":
      if (state.registers.A === state.registers[instruction.reg]) {
        nextIp = (nextIp + 1) % genomeLength;
      }
      break;
    case "jmp": {
      const offset = state.registers[instruction.reg] % genomeLength;
      nextIp = (((state.ip + offset) % genomeLength) + genomeLength) % genomeLength;
      break;
    }
    case "replicate": {
      if (state.parentReadPos < state.genome.length) {
        const result = copyStep(state.genome, state.parentReadPos, state.mutationRate, rng);
        if (result.appended) {
          state.offspringBuffer.push(result.appended);
        }
        if (result.consumedParentInstruction) {
          state.parentReadPos += 1;
        }
        if (state.parentReadPos >= state.genome.length) {
          state.readyToDivide = true;
        }
      }
      break;
    }
  }

  state.ip = nextIp;
}

/**
 * Extrae el genoma de la cría acumulado en `offspringBuffer` y reinicia el
 * ciclo de copia del organismo, que sigue vivo y puede volver a replicarse
 * (igual que en Avida, un organismo no “muere” al reproducirse).
 */
export function harvestOffspring(state: OrganismState): Genome | null {
  const offspring = state.offspringBuffer;
  state.offspringBuffer = [];
  state.parentReadPos = 0;
  state.readyToDivide = false;
  if (offspring.length === 0) {
    return null;
  }
  return offspring;
}
