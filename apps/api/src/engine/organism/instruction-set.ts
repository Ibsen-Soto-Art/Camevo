export type Register = "A" | "B" | "C";

export const REGISTERS: readonly Register[] = ["A", "B", "C"];

/**
 * Set de instrucciones simplificado (decisión de diseño registrada en
 * docs/03-arquitectura.md, sección 5): la autorreplicación se expone al
 * genoma como una única instrucción `replicate` respaldada por un cursor
 * de copia interno de la VM, en vez del mecanismo de cabezas
 * lectura/escritura de Avida. Esto mantiene la propiedad esencial que
 * exige RF-002/RF-003 (autorreplicación con mutación) y el criterio de
 * éxito de la visión (la selección debe emerger, no programarse), sin
 * portar la maquinaria de direccionamiento por templates.
 */
export const OPCODES = [
  "nop",
  "inc",
  "dec",
  "swap",
  "add",
  "sub",
  "nand",
  "io",
  "if_n_equ",
  "jmp",
  "replicate",
] as const;

export type Opcode = (typeof OPCODES)[number];

export interface Instruction {
  readonly opcode: Opcode;
  /**
   * Operando de registro para instrucciones que lo requieren (inc, dec,
   * swap, add, sub, nand, io, if_n_equ). Instrucciones sin operando
   * (nop, jmp, replicate) lo ignoran.
   */
  readonly reg: Register;
}

export function isOpcode(value: string): value is Opcode {
  return (OPCODES as readonly string[]).includes(value);
}
