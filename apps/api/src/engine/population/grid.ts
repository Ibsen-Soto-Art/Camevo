import { OrganismState } from "../organism/vm";

export interface GridConfig {
  width: number;
  height: number;
}

/** Grilla poblacional toroidal (los bordes se envuelven) — RF-004. */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: (OrganismState | null)[];

  constructor(config: GridConfig) {
    if (config.width < 1 || config.height < 1) {
      throw new Error("El tamaño de la grilla debe ser al menos 1x1");
    }
    this.width = config.width;
    this.height = config.height;
    this.cells = new Array(config.width * config.height).fill(null);
  }

  get size(): number {
    return this.cells.length;
  }

  indexOf(x: number, y: number): number {
    const wrappedX = ((x % this.width) + this.width) % this.width;
    const wrappedY = ((y % this.height) + this.height) % this.height;
    return wrappedY * this.width + wrappedX;
  }

  coordsOf(index: number): { x: number; y: number } {
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }

  /** Vecindad de Moore (8 celdas) con envoltura toroidal. */
  neighborIndices(index: number): number[] {
    const { x, y } = this.coordsOf(index);
    const neighbors: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        neighbors.push(this.indexOf(x + dx, y + dy));
      }
    }
    return neighbors;
  }

  occupiedIndices(): number[] {
    const result: number[] = [];
    this.cells.forEach((cell, index) => {
      if (cell) result.push(index);
    });
    return result;
  }

  populationSize(): number {
    return this.cells.reduce((count: number, cell) => count + (cell ? 1 : 0), 0);
  }
}
