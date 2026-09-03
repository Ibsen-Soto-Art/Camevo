import { describe, expect, it } from "vitest";
import { applyCatastrophicEvent } from "../../src/engine/population/catastrophe";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { createOrganism } from "../../src/engine/organism/vm";
import { Grid } from "../../src/engine/population/grid";
import { mulberry32 } from "../../src/simulation/orchestrator/rng";

function populatedGrid(width: number, height: number): Grid {
  const grid = new Grid({ width, height });
  const genome = createUniformGenome("replicate", 5);
  grid.cells.forEach((_, i) => {
    grid.cells[i] = createOrganism(genome, { mutationRate: 0, id: `o${i}` });
  });
  return grid;
}

describe("applyCatastrophicEvent (RF-015)", () => {
  it("elimina aproximadamente la fracción pedida de la población", () => {
    const grid = populatedGrid(10, 10); // 100 organismos
    const killed = applyCatastrophicEvent(grid, 0.3, mulberry32(1));

    expect(killed).toBe(30);
    expect(grid.populationSize()).toBe(70);
  });

  it("severidad 0 no mata a nadie", () => {
    const grid = populatedGrid(5, 5);
    const killed = applyCatastrophicEvent(grid, 0, mulberry32(1));
    expect(killed).toBe(0);
    expect(grid.populationSize()).toBe(25);
  });

  it("severidad 1 mata a toda la población (extinción total en un solo evento)", () => {
    const grid = populatedGrid(4, 4);
    const killed = applyCatastrophicEvent(grid, 1, mulberry32(1));
    expect(killed).toBe(16);
    expect(grid.populationSize()).toBe(0);
  });

  it("no falla si la severidad excede la población disponible (redondeo)", () => {
    const grid = new Grid({ width: 3, height: 3 });
    grid.cells[0] = createOrganism(createUniformGenome("replicate", 5), { mutationRate: 0, id: "solo" });
    const killed = applyCatastrophicEvent(grid, 0.9, mulberry32(1));
    expect(killed).toBe(1);
    expect(grid.populationSize()).toBe(0);
  });

  it("es determinista: misma semilla, mismo conjunto de víctimas", () => {
    const gridA = populatedGrid(6, 6);
    const gridB = populatedGrid(6, 6);
    applyCatastrophicEvent(gridA, 0.4, mulberry32(42));
    applyCatastrophicEvent(gridB, 0.4, mulberry32(42));

    const survivorsA = gridA.occupiedIndices();
    const survivorsB = gridB.occupiedIndices();
    expect(survivorsA).toEqual(survivorsB);
  });

  it("no mata dos veces la misma celda (sin duplicados en las víctimas)", () => {
    const grid = populatedGrid(10, 10);
    applyCatastrophicEvent(grid, 0.5, mulberry32(7));
    // Si hubiera duplicados, killCount contaría más de lo realmente eliminado;
    // en cambio, el tamaño final debe coincidir exactamente con lo esperado.
    expect(grid.populationSize()).toBe(50);
  });
});
