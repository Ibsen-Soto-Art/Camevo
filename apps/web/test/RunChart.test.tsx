import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunChart, { DEFAULT_HIDDEN_KEYS, buildSeriesList, toChartRows } from "../src/components/RunChart";
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

describe("toChartRows — incluye populationSize (línea 'Población viva')", () => {
  it("copia populationSize de cada snapshot a la fila aplanada, junto al resto de las métricas fijas", () => {
    const snapshots = [
      snapshot({ generation: 0, populationSize: 400, averageFitness: 1, geneticDiversity: 0.1 }),
      snapshot({ generation: 1, populationSize: 42, averageFitness: 1.1, geneticDiversity: 0.12 }),
    ];
    const rows = toChartRows(snapshots);
    expect(rows).toEqual([
      { generation: 0, averageFitness: 1, geneticDiversity: 0.1, populationSize: 400 },
      { generation: 1, averageFitness: 1.1, geneticDiversity: 0.12, populationSize: 42 },
    ]);
  });

  it("refleja una caída abrupta de población (evento catastrófico) sin promediar ni suavizar el valor", () => {
    const snapshots = [
      snapshot({ generation: 9, populationSize: 400, catastropheOccurred: false }),
      snapshot({ generation: 10, populationSize: 40, catastropheOccurred: true }),
    ];
    const rows = toChartRows(snapshots);
    expect(rows[0]?.populationSize).toBe(400);
    expect(rows[1]?.populationSize).toBe(40);
  });
});

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
  // La verificación de que Recharts efectivamente DIBUJA el gráfico (línea de
  // referencia, leyenda, panel de valores en respuesta a hover/tap real) es
  // en navegador real (Playwright): jsdom no implementa
  // getComputedTextLength/getBBox/ResizeObserver de los que depende
  // ResponsiveContainer, así que ni el `<svg>` ni la leyenda custom llegan a
  // montarse acá — confirmado directamente (un render de prueba con
  // snapshots reales no encuentra ningún `.chart-legend-item` en el DOM).
  // Lo único verificable en jsdom es texto que vive fuera de ese árbol.
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

  it("estado inicial (sin hover todavía): muestra el placeholder del panel de valores", () => {
    const snapshots = [snapshot({ generation: 0 })];
    const { container } = render(<RunChart snapshots={snapshots} />);
    expect(container.textContent).toMatch(/pasá el mouse sobre el gráfico para ver los valores/i);
  });
});

/**
 * Mejora 2 (leyenda interactiva): el estado inicial y la lista de series
 * son lógica pura, exportada exactamente por este motivo — a diferencia
 * del hover/click real sobre la leyenda (que sí necesita navegador real,
 * ver test/e2e/chart-hover-and-catastrophe.spec.ts), esto no depende de
 * ningún layout de Recharts.
 */
describe("buildSeriesList + DEFAULT_HIDDEN_KEYS (Mejora 2: estado inicial de la leyenda)", () => {
  it("arma las 3 series fijas (fitness, población, diversidad) más una por cada taskId climático presente", () => {
    const series = buildSeriesList(["AND", "NOT"]);
    expect(series.map((s) => s.dataKey)).toEqual(["averageFitness", "populationSize", "geneticDiversity", "AND", "NOT"]);
  });

  it("cada serie climática tiene su propio color, en el mismo orden que climateTaskIds", () => {
    const series = buildSeriesList(["AND", "NOT", "OR"]);
    const climateColors = series.filter((s) => s.yAxisId === "climate").map((s) => s.color);
    expect(new Set(climateColors).size).toBe(3); // tres colores distintos, no repetidos
  });

  it("el estado inicial oculta exactamente clima (AND/NOT/OR) + diversidad genética — Fitness y Población quedan visibles", () => {
    expect(DEFAULT_HIDDEN_KEYS).toEqual(["AND", "NOT", "OR", "geneticDiversity"]);
    expect(DEFAULT_HIDDEN_KEYS).not.toContain("averageFitness");
    expect(DEFAULT_HIDDEN_KEYS).not.toContain("populationSize");
  });
});
