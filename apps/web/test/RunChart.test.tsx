import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunChart, {
  CATASTROPHE_DEATHS_KEY,
  DEFAULT_HIDDEN_KEYS,
  buildSeriesList,
  hasVisibleClimateSeries,
  resolveChartMargin,
  toChartRows,
} from "../src/components/RunChart";
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
    catastropheDeaths: 0,
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
    // `toEqual` exhaustivo a propósito: si el aplanado gana una clave sin
    // que nadie lo note, este test lo dice.
    expect(rows).toEqual([
      { generation: 0, averageFitness: 1, geneticDiversity: 0.1, populationSize: 400, catastropheDeaths: 0 },
      { generation: 1, averageFitness: 1.1, geneticDiversity: 0.12, populationSize: 42, catastropheDeaths: 0 },
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

/**
 * RF-015: `catastropheDeaths` tiene que sobrevivir al aplanado para que el
 * panel de valores pueda mostrarlo — el flag `catastropheOccurred` NO
 * sobrevive (no es un número), y por eso el panel no podía saber que hubo
 * catástrofe antes de este cambio.
 */
describe("toChartRows — preserva catastropheDeaths (RF-015)", () => {
  it("copia el conteo de muertes a la fila, y 0 en las generaciones sin evento", () => {
    const rows = toChartRows([
      snapshot({ generation: 0 }),
      snapshot({ generation: 1, catastropheOccurred: true, catastropheDeaths: 60 }),
      snapshot({ generation: 2 }),
    ]);
    expect(rows[0]?.[CATASTROPHE_DEATHS_KEY]).toBe(0);
    expect(rows[1]?.[CATASTROPHE_DEATHS_KEY]).toBe(60);
    expect(rows[2]?.[CATASTROPHE_DEATHS_KEY]).toBe(0);
  });

  it("compatibilidad: una corrida guardada antes de v0.21.x no trae el campo — se lee como 0, no undefined", () => {
    // Así llega un snapshot del JSONB viejo: el tipo dice `number`, el dato
    // no está. Sin el `?? 0` el panel mostraría "murieron undefined".
    const legacy = { ...snapshot({ generation: 7 }) } as Record<string, unknown>;
    delete legacy.catastropheDeaths;

    const rows = toChartRows([legacy as unknown as GenerationSnapshot]);
    expect(rows[0]?.[CATASTROPHE_DEATHS_KEY]).toBe(0);
    expect(Number.isNaN(rows[0]?.[CATASTROPHE_DEATHS_KEY])).toBe(false);
  });

  it("la clave no crea una serie: sigue habiendo exactamente las series de buildSeriesList", () => {
    // El riesgo concreto de meter una clave nueva en la fila sería que
    // Recharts dibujara una línea de más. No puede: las series salen de
    // buildSeriesList, no de las claves del dato.
    const keys = buildSeriesList(["AND", "NOT", "OR"]).map((s) => s.dataKey);
    expect(keys).not.toContain(CATASTROPHE_DEATHS_KEY);
    expect(DEFAULT_HIDDEN_KEYS).not.toContain(CATASTROPHE_DEATHS_KEY);
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

  it("sin hover no muestra la línea de catástrofe, aunque la corrida tenga eventos", () => {
    const { container } = render(
      <RunChart snapshots={[snapshot({ generation: 1, catastropheOccurred: true, catastropheDeaths: 60 })]} />,
    );
    expect(container.textContent).not.toMatch(/murieron \d+ organismos/i);
  });

  it("con las series por defecto visibles NO muestra el aviso de 'activá al menos una línea'", () => {
    const { container } = render(<RunChart snapshots={[snapshot({ generation: 0 })]} />);
    expect(container.textContent).not.toMatch(/activá al menos una línea/i);
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

/**
 * El eje Y de población existe solo mientras su serie esté visible. La
 * PRESENCIA del `<YAxis>` en el DOM se verifica en navegador real
 * (test/e2e/chart-legend-toggle.spec.ts) porque el SVG no se monta en
 * jsdom; acá se cubre la lógica pura que decide el margen derecho, que
 * es la parte que puede desincronizarse en silencio del eje.
 */
describe("resolveChartMargin — el margen derecho sigue a los ejes que realmente se renderizan", () => {
  const CLIMATE = ["AND", "NOT", "OR"];

  it("con ambos ejes derechos visibles (Población + al menos un clima), reserva 60px", () => {
    expect(resolveChartMargin(new Set(["geneticDiversity"]), CLIMATE).right).toBe(60);
  });

  it("estado inicial real (clima oculto por defecto, Población visible): un solo eje derecho → 30px", () => {
    // Antes del fix esto daba 60 y el eje "Clima" se dibujaba igual, sin
    // ninguna línea que lo usara — en la PRIMERA pantalla que ve todo
    // visitante, porque DEFAULT_HIDDEN_KEYS oculta las tres climáticas.
    expect(resolveChartMargin(new Set(DEFAULT_HIDDEN_KEYS), CLIMATE).right).toBe(30);
  });

  it("con 'Población viva' oculta pero clima visible, sigue habiendo un eje derecho → 30px", () => {
    expect(resolveChartMargin(new Set(["populationSize", "geneticDiversity"]), CLIMATE).right).toBe(30);
  });

  it("sin ningún eje derecho, se mantiene el piso de 30px para no recortar la última etiqueta del eje X", () => {
    expect(resolveChartMargin(new Set([...DEFAULT_HIDDEN_KEYS, "populationSize", "averageFitness"]), CLIMATE).right).toBe(30);
  });

  it("una corrida sin módulo climático no tiene claves climáticas: el eje no cuenta aunque no estén en hiddenKeys", () => {
    expect(resolveChartMargin(new Set<string>(), []).right).toBe(30);
  });

  it("solo cambia `right`: top/left/bottom son idénticos en todos los estados", () => {
    const a = resolveChartMargin(new Set<string>(), CLIMATE);
    const b = resolveChartMargin(new Set(["populationSize", ...CLIMATE]), CLIMATE);
    expect(b.top).toBe(a.top);
    expect(b.left).toBe(a.left);
    expect(b.bottom).toBe(a.bottom);
  });
});

/**
 * Los ids de tarea climática salen de DEFAULT_TASKS (backend) vía los
 * snapshots, no de una lista fija en el frontend — por eso la condición
 * recibe las claves reales en vez de asumir ["AND","NOT","OR"].
 */
describe("hasVisibleClimateSeries — la condición del eje 'Clima' usa claves dinámicas", () => {
  it("es falsa cuando TODAS las series climáticas presentes están ocultas", () => {
    expect(hasVisibleClimateSeries(new Set(["AND", "NOT", "OR"]), ["AND", "NOT", "OR"])).toBe(false);
  });

  it("basta con una visible para que el eje exista", () => {
    expect(hasVisibleClimateSeries(new Set(["AND", "OR"]), ["AND", "NOT", "OR"])).toBe(true);
  });

  it("sin claves climáticas (corrida sin clima) es falsa, sin importar hiddenKeys", () => {
    expect(hasVisibleClimateSeries(new Set<string>(), [])).toBe(false);
  });

  it("una tarea NUEVA en DEFAULT_TASKS cuenta para su propio eje — lo que una lista fija AND/NOT/OR se perdería", () => {
    // Con AND/NOT/OR ocultas y solo XOR visible, hardcodear las tres
    // originales habría quitado el eje dejando la línea de XOR apuntando
    // a un eje inexistente: el bug que este patrón evita.
    expect(hasVisibleClimateSeries(new Set(["AND", "NOT", "OR"]), ["AND", "NOT", "OR", "XOR"])).toBe(true);
  });
});

/**
 * CAMBIO 2 de la revisión de terminología: el gráfico tiene que decir qué
 * mide, porque "Fitness promedio" no se definía en ningún lugar de la UI
 * (el caption de la grilla sí definía el suyo). Va como caption y no como
 * tooltip: las descripciones por métrica se eliminaron en v0.20.0 con
 * `describeMetric`/`ChartTooltip`, y un caption se lee sin descubrir que
 * hay que pasar el mouse.
 */
describe("<RunChart /> — define qué mide 'Fitness promedio' y lo distingue de la grilla", () => {
  it("el caption explica que es una tasa de la población en esta generación", () => {
    const { container } = render(<RunChart snapshots={[snapshot({ generation: 0 })]} />);
    expect(container.textContent).toMatch(/tasa de nacimientos por organismo en esta generación/i);
    expect(container.textContent).toMatch(/qué tan bien se está adaptando la POBLACIÓN en este momento/);
  });

  it("advierte explícitamente que no es lo mismo que el éxito reproductivo acumulado de la grilla", () => {
    const { container } = render(<RunChart snapshots={[snapshot({ generation: 0 })]} />);
    expect(container.textContent).toMatch(/No confundir con el éxito reproductivo individual que muestra la grilla/);
    expect(container.textContent).toMatch(/acumulado desde que nació cada organismo/);
  });

  it("el caption está presente sin necesidad de hover — es lo que lo distingue del tooltip que reemplaza", () => {
    const { container } = render(<RunChart snapshots={[snapshot({ generation: 0 })]} />);
    // Sin ninguna interacción: el placeholder del panel de valores sigue ahí
    // y la definición ya se puede leer.
    expect(container.textContent).toMatch(/pasá el mouse sobre el gráfico para ver los valores/i);
    expect(container.querySelectorAll(".chart-caption").length).toBeGreaterThanOrEqual(1);
  });
});
