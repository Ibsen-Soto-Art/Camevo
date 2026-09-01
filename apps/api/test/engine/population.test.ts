import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { createOrganism } from "../../src/engine/organism/vm";
import { Grid } from "../../src/engine/population/grid";
import { seedPopulation } from "../../src/engine/population/seeding";
import { chooseBirthTargetIndex } from "../../src/engine/population/placement";
import { sequenceRng } from "../helpers/sequence-rng";

describe("Grid (RF-004: grilla poblacional)", () => {
  it("envuelve las coordenadas toroidalmente", () => {
    const grid = new Grid({ width: 3, height: 3 });
    expect(grid.indexOf(-1, 0)).toBe(grid.indexOf(2, 0));
    expect(grid.indexOf(3, 0)).toBe(grid.indexOf(0, 0));
  });

  it("devuelve los 8 vecinos de Moore, incluso en bordes", () => {
    const grid = new Grid({ width: 3, height: 3 });
    const neighbors = grid.neighborIndices(0);
    expect(neighbors).toHaveLength(8);
    expect(new Set(neighbors).size).toBe(8);
    expect(neighbors).not.toContain(0);
  });

  it("populationSize cuenta solo celdas ocupadas", () => {
    const grid = new Grid({ width: 2, height: 2 });
    expect(grid.populationSize()).toBe(0);
    grid.cells[0] = createOrganism(createUniformGenome("nop", 1), { mutationRate: 0 });
    expect(grid.populationSize()).toBe(1);
  });
});

describe("seedPopulation (RF-008: multi-ancestro)", () => {
  it("coloca cada genoma ancestral en una celda distinta", () => {
    const grid = new Grid({ width: 4, height: 4 });
    const genomeA = createUniformGenome("replicate", 5);
    const genomeB = createUniformGenome("nop", 5);
    seedPopulation(grid, [genomeA, genomeB], 0.05, sequenceRng([0.1, 0.1, 0.9]));

    const occupied = grid.occupiedIndices();
    expect(occupied).toHaveLength(2);
    const genomes = occupied.map((i) => grid.cells[i]?.genome);
    expect(genomes).toContainEqual(genomeA);
    expect(genomes).toContainEqual(genomeB);
  });

  it("lanza si hay más ancestros que celdas", () => {
    const grid = new Grid({ width: 1, height: 1 });
    const genome = createUniformGenome("nop", 1);
    expect(() => seedPopulation(grid, [genome, genome], 0.05, sequenceRng([0]))).toThrow();
  });
});

describe("chooseBirthTargetIndex (RF-009 + RF-004)", () => {
  it("modo random: puede elegir cualquier celda de la grilla", () => {
    const grid = new Grid({ width: 10, height: 10 });
    const target = chooseBirthTargetIndex(grid, 0, "random", sequenceRng([0.55]));
    expect(target).toBe(Math.floor(0.55 * 100));
  });

  it("modo near-parent: prefiere una celda vecina vacía", () => {
    const grid = new Grid({ width: 3, height: 3 });
    const parentIndex = 4; // centro
    grid.cells[parentIndex] = createOrganism(createUniformGenome("nop", 1), { mutationRate: 0 });

    const target = chooseBirthTargetIndex(grid, parentIndex, "near-parent", sequenceRng([0]));
    expect(grid.neighborIndices(parentIndex)).toContain(target);
    expect(grid.cells[target]).toBeNull();
  });

  it("modo near-parent: si todos los vecinos están ocupados, reemplaza al más débil", () => {
    const grid = new Grid({ width: 3, height: 3 });
    const parentIndex = 4;
    grid.cells[parentIndex] = createOrganism(createUniformGenome("nop", 1), { mutationRate: 0 });

    const neighbors = grid.neighborIndices(parentIndex);
    for (const [i, neighborIndex] of neighbors.entries()) {
      const organism = createOrganism(createUniformGenome("nop", 1), { mutationRate: 0 });
      organism.offspringProduced = i; // el índice 0 queda como el "más débil" (menor descendencia)
      grid.cells[neighborIndex] = organism;
    }

    const target = chooseBirthTargetIndex(grid, parentIndex, "near-parent", sequenceRng([0]));
    expect(target).toBe(neighbors[0]);
  });
});
