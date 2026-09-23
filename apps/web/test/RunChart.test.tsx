import { render, screen } from "@testing-library/react";
import type { TooltipContentProps } from "recharts";
import { describe, expect, it } from "vitest";
import RunChart, { ChartTooltip, describeMetric, toChartRows } from "../src/components/RunChart";
import type { GenerationSnapshot } from "../src/lib/camevo-client";
import { getCatastropheGenerations } from "../src/lib/catastrophe";

/** Completa los campos de contexto de Recharts que ChartTooltip ignora, pero que el tipo TooltipContentProps exige. */
function renderTooltip(payload: TooltipContentProps["payload"], label: number, active = true) {
  return render(
    <ChartTooltip active={active} coordinate={undefined} accessibilityLayer={false} activeIndex={undefined} payload={payload} label={label} />,
  );
}

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

describe("toChartRows — incluye populationSize (nueva línea 'Población viva')", () => {
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

describe("describeMetric — descripción pedagógica de populationSize", () => {
  it("conecta la caída de población con RF-015 (evento catastrófico) y la contrasta con RF-011 (clima gradual)", () => {
    const description = describeMetric("populationSize");
    expect(description).toMatch(/organismos vivos/i);
    expect(description).toMatch(/RF-015/);
    expect(description).toMatch(/RF-011/);
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

/**
 * Ajuste 3 (auditoría de interfaz post-producción): el tooltip default de
 * Recharts (nombre + valor numérico, sin significado) se reemplazó por
 * `ChartTooltip`. Recharts necesita medición de layout SVG real
 * (getBBox/getComputedTextLength) para activar el tooltip vía hover — no
 * disponible en jsdom (ver el comentario de arriba) — así que se testea
 * `ChartTooltip` directo, con el payload que Recharts le pasaría, en vez
 * de simular el hover sobre el SVG completo.
 */
describe("<ChartTooltip /> — descripciones en lenguaje humano (Ajuste 3)", () => {
  it("no renderiza nada si el tooltip no está activo", () => {
    const { container } = renderTooltip(
      [{ dataKey: "averageFitness", name: "Fitness promedio", value: 1.2, graphicalItemId: "a" }],
      5,
      false,
    );
    expect(container.textContent).toBe("");
  });

  it("fitness promedio: describe qué mide, no solo el número", () => {
    renderTooltip([{ dataKey: "averageFitness", name: "Fitness promedio", value: 1.23, graphicalItemId: "a" }], 5);
    expect(screen.getByText(/Fitness promedio: 1.23/)).toBeInTheDocument();
    expect(screen.getByText(/crías producidas por organismo/i)).toBeInTheDocument();
  });

  it("diversidad genética: describe qué mide, no solo el número", () => {
    renderTooltip(
      [{ dataKey: "geneticDiversity", name: "Diversidad genética (aprox.)", value: 0.05, graphicalItemId: "b" }],
      5,
    );
    expect(screen.getByText(/variación en los genomas/i)).toBeInTheDocument();
  });

  it("población viva: describe qué mide y conecta con RF-015/RF-011, no solo el número", () => {
    renderTooltip([{ dataKey: "populationSize", name: "Población viva", value: 342, graphicalItemId: "e" }], 5);
    expect(screen.getByText("Población viva: 342")).toBeInTheDocument();
    expect(screen.getByText(/organismos vivos/i)).toBeInTheDocument();
  });

  it("una línea de clima (dataKey dinámico, ej. 'AND'): describe la tarea específica por su id", () => {
    renderTooltip([{ dataKey: "AND", name: "Clima: AND", value: 4.5, graphicalItemId: "c" }], 5);
    expect(screen.getByText(/tarea AND/i)).toBeInTheDocument();
    expect(screen.getByText(/más valiosa para sobrevivir/i)).toBeInTheDocument();
  });

  it("muestra una descripción por cada línea presente en el payload, no solo la primera", () => {
    renderTooltip(
      [
        { dataKey: "averageFitness", name: "Fitness promedio", value: 1, graphicalItemId: "a" },
        { dataKey: "NOT", name: "Clima: NOT", value: 2, graphicalItemId: "d" },
      ],
      7,
    );
    expect(screen.getByText(/crías producidas por organismo/i)).toBeInTheDocument();
    expect(screen.getByText(/tarea NOT/i)).toBeInTheDocument();
  });
});
