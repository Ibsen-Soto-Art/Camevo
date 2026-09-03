import { describe, expect, it } from "vitest";
import { copyStep, createNotSolvingGenome, createUniformGenome, decideMutationKind } from "../../src/engine/organism/genome";
import { createOrganism, step } from "../../src/engine/organism/vm";
import { sequenceRng } from "../helpers/sequence-rng";

describe("createUniformGenome", () => {
  it("crea un genoma con la instrucción repetida N veces", () => {
    const genome = createUniformGenome("replicate", 5);
    expect(genome).toHaveLength(5);
    expect(genome.every((instr) => instr.opcode === "replicate")).toBe(true);
  });

  it("rechaza longitudes menores a 1", () => {
    expect(() => createUniformGenome("nop", 0)).toThrow();
  });
});

describe("createNotSolvingGenome", () => {
  it("tiene el largo total pedido, con replicate rellenando el resto", () => {
    const genome = createNotSolvingGenome(13);
    expect(genome).toHaveLength(13);
    expect(genome.slice(3).every((instr) => instr.opcode === "replicate")).toBe(true);
  });

  it("funciona con el largo mínimo (solo el cassette, sin relleno)", () => {
    expect(createNotSolvingGenome(3)).toHaveLength(3);
  });

  it("rechaza un largo menor al cassette", () => {
    expect(() => createNotSolvingGenome(2)).toThrow();
  });

  it("efectivamente resuelve NOT desde su primera ejecución, para cualquier input", () => {
    const genome = createNotSolvingGenome(13);
    const organism = createOrganism(genome, { mutationRate: 0, id: "not-ancestor" });
    const outputs: { value: number; inputs: readonly number[] }[] = [];

    step(organism, { onOutput: (value, inputs) => outputs.push({ value, inputs }) }, sequenceRng([0.37]));
    step(organism, { onOutput: (value, inputs) => outputs.push({ value, inputs }) }, sequenceRng([0.37]));
    step(organism, { onOutput: (value, inputs) => outputs.push({ value, inputs }) }, sequenceRng([0.37]));

    const solvingOutput = outputs.find((o) => o.inputs.length > 0);
    expect(solvingOutput).toBeDefined();
    expect(solvingOutput?.value).toBe((~(solvingOutput?.inputs[0] as number)) >>> 0);
  });
});

describe("decideMutationKind", () => {
  it("no muta cuando el sorteo cae por encima de la tasa", () => {
    const rng = sequenceRng([0.9]);
    expect(decideMutationKind(rng, 0.1)).toBe("none");
  });

  it("elige sustitución/inserción/eliminación según el segundo sorteo", () => {
    expect(decideMutationKind(sequenceRng([0.0, 0.0]), 0.5)).toBe("substitution");
    expect(decideMutationKind(sequenceRng([0.0, 0.5]), 0.5)).toBe("insertion");
    expect(decideMutationKind(sequenceRng([0.0, 0.99]), 0.5)).toBe("deletion");
  });
});

describe("copyStep (RF-003: sustitución, inserción, eliminación)", () => {
  const parentGenome = createUniformGenome("replicate", 3);

  it("sin mutación: copia la instrucción exacta y avanza la lectura", () => {
    const rng = sequenceRng([0.9]);
    const result = copyStep(parentGenome, 0, 0.1, rng);
    expect(result.mutation).toBe("none");
    expect(result.appended).toEqual(parentGenome[0]);
    expect(result.consumedParentInstruction).toBe(true);
  });

  it("sustitución: reemplaza la instrucción copiada pero sí avanza la lectura", () => {
    const rng = sequenceRng([0.0, 0.0, 0.1, 0.1]);
    const result = copyStep(parentGenome, 0, 1, rng);
    expect(result.mutation).toBe("substitution");
    expect(result.consumedParentInstruction).toBe(true);
    expect(result.appended).not.toBeNull();
  });

  it("inserción: añade una instrucción extra sin consumir la posición del padre", () => {
    const rng = sequenceRng([0.0, 0.5, 0.1, 0.1]);
    const result = copyStep(parentGenome, 0, 1, rng);
    expect(result.mutation).toBe("insertion");
    expect(result.consumedParentInstruction).toBe(false);
    expect(result.appended).not.toBeNull();
  });

  it("eliminación: no añade nada pero sí consume la posición del padre", () => {
    const rng = sequenceRng([0.0, 0.99]);
    const result = copyStep(parentGenome, 0, 1, rng);
    expect(result.mutation).toBe("deletion");
    expect(result.consumedParentInstruction).toBe(true);
    expect(result.appended).toBeNull();
  });

  it("lanza si parentReadPos está fuera de rango", () => {
    expect(() => copyStep(parentGenome, 99, 0.1, sequenceRng([0.9]))).toThrow();
  });
});
