import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunChart from "../src/components/RunChart";
import type { GenerationSnapshot } from "../src/lib/camevo-client";
import { getCatastropheGenerations } from "../src/lib/catastrophe";

function snapshot(overrides: Partial<GenerationSnapshot>): GenerationSnapshot {
  return {
    generation: 0,
    populationSize: 100,
    births: 50,
    averageFitness: 1,
    tasksSolvedThisUpdate: 0,
    climate: [],
    organisms: [],
    geneticDiversity: 0.1,
    extinct: false,
    nearExtinct: false,
    catastropheOccurred: false,
    ...overrides,
  };
}

describe("getCatastropheGenerations (RF-015)", () => {
  it("devuelve vacío si ningún snapshot tuvo un evento catastrófico", () => {
    const snapshots = [snapshot({ generation: 0 }), snapshot({ generation: 1 }), snapshot({ generation: 2 })];
    expect(getCatastropheGenerations(snapshots)).toEqual([]);
  });

  it("devuelve exactamente las generaciones marcadas, en el orden en que aparecen los snapshots", () => {
    const snapshots = [
      snapshot({ generation: 0 }),
      snapshot({ generation: 1, catastropheOccurred: true }),
      snapshot({ generation: 2 }),
      snapshot({ generation: 3, catastropheOccurred: true }),
      snapshot({ generation: 4 }),
    ];
    expect(getCatastropheGenerations(snapshots)).toEqual([1, 3]);
  });
});

describe("<RunChart /> — nota de la leyenda de eventos catastróficos (RF-015)", () => {
  // La verificación de que Recharts efectivamente DIBUJA la ReferenceLine
  // es en navegador real (Playwright): jsdom no implementa
  // getComputedTextLength/getBBox, de las que depende el layout de ejes
  // de Recharts, así que su SVG nunca termina de montarse acá. Lo que sí
  // es verificable en jsdom es la nota de texto, que vive fuera del SVG.
  it("sin ningún catastropheOccurred, no muestra la nota de eventos catastróficos", () => {
    const snapshots = [snapshot({ generation: 0 }), snapshot({ generation: 1 })];
    const { container } = render(<RunChart snapshots={snapshots} />);
    expect(container.textContent).not.toMatch(/evento catastrófico/i);
  });

  it("con al menos un catastropheOccurred, muestra la nota explicando el marcador", () => {
    const snapshots = [snapshot({ generation: 0 }), snapshot({ generation: 1, catastropheOccurred: true })];
    const { container } = render(<RunChart snapshots={snapshots} />);
    expect(container.textContent).toMatch(/evento catastrófico/i);
  });
});
