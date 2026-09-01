import { describe, expect, it, vi } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { Instruction } from "../../src/engine/organism/instruction-set";
import { createOrganism, harvestOffspring, step } from "../../src/engine/organism/vm";
import { sequenceRng } from "../helpers/sequence-rng";

describe("VM — instrucciones aritméticas y de registro", () => {
  it("inc incrementa el registro indicado (con wraparound de 32 bits)", () => {
    const organism = createOrganism([{ opcode: "inc", reg: "A" }], { mutationRate: 0, id: "test-organism" });
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.registers.A).toBe(1);
  });

  it("dec en 0 envuelve a 2^32 - 1", () => {
    const organism = createOrganism([{ opcode: "dec", reg: "A" }], { mutationRate: 0, id: "test-organism" });
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.registers.A).toBe(0xffffffff);
  });

  it("swap intercambia A con el registro indicado", () => {
    const organism = createOrganism([{ opcode: "swap", reg: "B" }], { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 5;
    organism.registers.B = 9;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.registers.A).toBe(9);
    expect(organism.registers.B).toBe(5);
  });

  it("add suma el registro indicado sobre A", () => {
    const organism = createOrganism([{ opcode: "add", reg: "B" }], { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 10;
    organism.registers.B = 5;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.registers.A).toBe(15);
  });

  it("nand calcula NAND bit a bit entre A y el registro indicado", () => {
    const organism = createOrganism([{ opcode: "nand", reg: "B" }], { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 0b1100;
    organism.registers.B = 0b1010;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.registers.A).toBe((~0b1000) >>> 0);
  });
});

describe("VM — io", () => {
  it("emite el valor actual del registro y luego carga un nuevo input aleatorio", () => {
    const organism = createOrganism([{ opcode: "io", reg: "A" }], { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 42;
    const onOutput = vi.fn();
    step(organism, { onOutput }, sequenceRng([0.5]));

    expect(onOutput).toHaveBeenCalledWith(42, []);
    const expectedInput = Math.floor(0.5 * 0x1_0000_0000) >>> 0;
    expect(organism.registers.A).toBe(expectedInput);
    expect(organism.inputHistory).toEqual([expectedInput]);
  });

  it("conserva como máximo los 2 inputs más recientes, el más nuevo primero", () => {
    const organism = createOrganism([{ opcode: "io", reg: "A" }], { mutationRate: 0, id: "test-organism" });
    const rng = sequenceRng([0.1, 0.2, 0.3]);
    step(organism, { onOutput: () => {} }, rng);
    step(organism, { onOutput: () => {} }, rng);
    step(organism, { onOutput: () => {} }, rng);
    expect(organism.inputHistory).toHaveLength(2);

    const third = Math.floor(0.3 * 0x1_0000_0000) >>> 0;
    const second = Math.floor(0.2 * 0x1_0000_0000) >>> 0;
    expect(organism.inputHistory).toEqual([third, second]);
  });
});

describe("VM — control de flujo", () => {
  it("if_n_equ salta la siguiente instrucción cuando A es igual al registro comparado", () => {
    const genome = [
      { opcode: "if_n_equ", reg: "B" },
      { opcode: "inc", reg: "A" },
      { opcode: "inc", reg: "C" },
    ] as const;
    const organism = createOrganism(genome, { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 5;
    organism.registers.B = 5;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.ip).toBe(2);
  });

  it("if_n_equ no salta cuando los registros difieren", () => {
    const genome = [
      { opcode: "if_n_equ", reg: "B" },
      { opcode: "inc", reg: "A" },
      { opcode: "inc", reg: "C" },
    ] as const;
    const organism = createOrganism(genome, { mutationRate: 0, id: "test-organism" });
    organism.registers.A = 5;
    organism.registers.B = 3;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.ip).toBe(1);
  });

  it("jmp mueve el instruction pointer según el valor del registro (con envoltura)", () => {
    const genome = createUniformGenome("nop", 5);
    const withJmp: Instruction[] = [{ opcode: "jmp", reg: "B" }, ...genome.slice(1)];
    const organism = createOrganism(withJmp, { mutationRate: 0, id: "test-organism" });
    organism.registers.B = 2;
    step(organism, { onOutput: () => {} }, sequenceRng([0]));
    expect(organism.ip).toBe(2);
  });
});

describe("VM — replicate y harvestOffspring (RF-002, RF-003)", () => {
  it("copia el genoma instrucción por instrucción y marca readyToDivide al completar", () => {
    const genome = createUniformGenome("replicate", 3);
    const organism = createOrganism(genome, { mutationRate: 0, id: "test-organism" });
    const rng = sequenceRng([0.9]);

    step(organism, { onOutput: () => {} }, rng);
    expect(organism.readyToDivide).toBe(false);
    expect(organism.parentReadPos).toBe(1);

    step(organism, { onOutput: () => {} }, rng);
    step(organism, { onOutput: () => {} }, rng);

    expect(organism.readyToDivide).toBe(true);
    expect(organism.offspringBuffer).toHaveLength(3);
  });

  it("harvestOffspring devuelve la cría y reinicia el ciclo de copia del padre", () => {
    const genome = createUniformGenome("replicate", 2);
    const organism = createOrganism(genome, { mutationRate: 0, id: "test-organism" });
    const rng = sequenceRng([0.9]);
    step(organism, { onOutput: () => {} }, rng);
    step(organism, { onOutput: () => {} }, rng);

    const offspring = harvestOffspring(organism);
    expect(offspring).toEqual(genome);
    expect(organism.readyToDivide).toBe(false);
    expect(organism.parentReadPos).toBe(0);
    expect(organism.offspringBuffer).toHaveLength(0);
  });

  it("harvestOffspring devuelve null si no se ha copiado nada todavía", () => {
    const organism = createOrganism(createUniformGenome("nop", 2), { mutationRate: 0, id: "test-organism" });
    expect(harvestOffspring(organism)).toBeNull();
  });
});
