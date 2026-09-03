import { describe, expect, it } from "vitest";
import { computeGeneticDiversity } from "../../src/engine/population/diversity";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { Instruction } from "../../src/engine/organism/instruction-set";
import { createOrganism } from "../../src/engine/organism/vm";

/**
 * Cordura pedida antes de integrar RF-021 al demo central: separar
 * heterogeneidad real de ruido de desalineamiento por indels, con
 * números concretos, no solo teoría. Ver el comentario de
 * computeGeneticDiversity para el porqué del enfoque (min de ambas
 * direcciones) y sus límites.
 */
function organismsFrom(genomes: readonly (readonly Instruction[])[]) {
  return genomes.map((genome, i) => createOrganism(genome, { mutationRate: 0, id: `o${i}` }));
}

describe("computeGeneticDiversity — cordura", () => {
  it("población de un solo organismo: diversidad 0 (nada con qué comparar)", () => {
    expect(computeGeneticDiversity(organismsFrom([createUniformGenome("replicate", 24)]))).toBe(0);
  });

  it("copias idénticas del ancestro, sin mutación: diversidad ≈ 0", () => {
    const ancestor = createUniformGenome("replicate", 24);
    const population = organismsFrom(Array.from({ length: 40 }, () => ancestor));
    expect(computeGeneticDiversity(population)).toBe(0);
  });

  it("misma heterogeneidad REAL (mitad con NOT resuelto, mitad sin): diversidad refleja la diferencia funcional real", () => {
    const withNot: Instruction[] = [
      { opcode: "io", reg: "A" },
      { opcode: "nand", reg: "A" },
      { opcode: "io", reg: "A" },
      ...Array.from({ length: 10 }, () => ({ opcode: "replicate" as const, reg: "A" as const })),
    ];
    const withoutNot = createUniformGenome("replicate", withNot.length);

    const population = organismsFrom([
      ...Array.from({ length: 20 }, () => withNot),
      ...Array.from({ length: 20 }, () => withoutNot),
    ]);

    const diversity = computeGeneticDiversity(population);
    // 3 de 13 posiciones difieren (io/nand/io vs. replicate); en cada una
    // de esas 3, la mitad de la población no coincide con la moda (split
    // 50/50) → mismatch 0.5 por posición, no 1.0. (3 * 0.5) / 13 ≈ 0.1154.
    expect(diversity).toBeCloseTo((3 * 0.5) / 13, 5);
    expect(diversity).toBeGreaterThan(0.1);
  });

  describe("ruido de desalineamiento por un indel temprano, SIN diferencia funcional real", () => {
    it("inserción de un nop justo al inicio (mitad de la población): el mínimo por-ambas-direcciones lo cancela casi del todo", () => {
      const cassette: Instruction[] = [
        { opcode: "io", reg: "A" },
        { opcode: "nand", reg: "A" },
        { opcode: "io", reg: "A" },
        ...Array.from({ length: 10 }, () => ({ opcode: "replicate" as const, reg: "A" as const })),
      ];
      const shifted: Instruction[] = [{ opcode: "nop", reg: "A" }, ...cassette];

      const population = organismsFrom([
        ...Array.from({ length: 20 }, () => cassette),
        ...Array.from({ length: 20 }, () => shifted),
      ]);

      const diversity = computeGeneticDiversity(population);

      // Documentado empíricamente: SOLO indexando desde el inicio (sin el
      // mínimo por-ambas-direcciones), este mismo caso da ~0.143 — un
      // indel pegado al inicio "parece" ~14% de diversidad genética
      // aunque las dos mitades son funcionalmente idénticas. El mínimo
      // con la dirección inversa lo corrige a (casi) 0 en este caso,
      // porque el indel está pegado al extremo que la medición inversa
      // realinea sola.
      expect(diversity).toBeLessThan(0.02);
    });

    it("el mismo indel, pero en el MEDIO del genoma: el truco de las 2 direcciones ya no lo cancela del todo — ruido residual real", () => {
      const before = createUniformGenome("replicate", 6);
      const cassette: Instruction[] = [
        { opcode: "io", reg: "A" },
        { opcode: "nand", reg: "A" },
        { opcode: "io", reg: "A" },
      ];
      const after = createUniformGenome("replicate", 6);
      const genomeA = [...before, ...cassette, ...after];
      const genomeB = [...before, { opcode: "nop", reg: "A" } as Instruction, ...cassette, ...after];

      const population = organismsFrom([
        ...Array.from({ length: 20 }, () => genomeA),
        ...Array.from({ length: 20 }, () => genomeB),
      ]);

      const diversity = computeGeneticDiversity(population);

      // No es 0: un indel en el medio no se "realinea solo" desde
      // ningún extremo. Es la limitación real de esta métrica, medida
      // en vez de asumida — significativamente más baja que la señal
      // funcional real de la prueba anterior ((3*0.5)/13 ≈ 0.115), pero
      // no despreciable frente a cambios reales pequeños.
      expect(diversity).toBeGreaterThan(0.02);
      expect(diversity).toBeLessThan((3 * 0.5) / 13);
    });
  });
});
