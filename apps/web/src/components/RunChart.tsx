import { useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCatastropheGenerations } from "../lib/catastrophe";
import type { GenerationSnapshot } from "../lib/camevo-client";

/** Debe calzar con `margin` del `<LineChart>` de abajo — es el mismo rectángulo de trazado que Recharts usa internamente. */
const CHART_MARGIN = { top: 10, right: 60, left: 20, bottom: 0 };

const CLIMATE_COLORS = ["#d62728", "#2ca02c", "#9467bd"];

/**
 * Grupo 2 (rediseño visual): estos SÍ son colores de tema de UI, no de
 * datos — a diferencia de CLIMATE_COLORS/los strokes de cada `<Line>`
 * (que identifican una métrica y no deben cambiar), grid/ejes/cursor solo
 * existen para que el gráfico se lea sobre el nuevo fondo oscuro. Se
 * hardcodean (no `var(--color-...)`) porque Recharts renderiza a SVG
 * plano, no hereda custom properties de forma confiable en todos los
 * casos — mismo criterio que ya usa CLIMATE_COLORS como const acá arriba.
 */
const CHART_GRID_COLOR = "#24352f";
const CHART_AXIS_TEXT_COLOR = "#8fa39c";

/** Formatea un valor para el panel de valores: sin decimales innecesarios (población/multiplicadores suelen ser enteros). */
function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Metadata de cada serie, en un solo lugar — de acá salen tanto los
 * `<Line>` del gráfico como los ítems de la leyenda custom y las
 * entradas del panel de valores fijo, para que agregar/quitar una serie
 * nunca requiera tocar tres lugares por separado y arriesgar que se
 * desincronicen.
 */
interface SeriesMeta {
  readonly dataKey: string;
  readonly name: string;
  readonly color: string;
  readonly yAxisId: "fitness" | "climate" | "population";
  readonly strokeDasharray?: string;
}

/** Aplana los snapshots a filas {generation, averageFitness, geneticDiversity, populationSize, [taskId]: multiplier} para Recharts. */
export function toChartRows(snapshots: readonly GenerationSnapshot[]): Record<string, number>[] {
  return snapshots.map((snapshot) => {
    const row: Record<string, number> = {
      generation: snapshot.generation,
      averageFitness: snapshot.averageFitness,
      geneticDiversity: snapshot.geneticDiversity,
      populationSize: snapshot.populationSize,
    };
    for (const resource of snapshot.climate) {
      row[resource.taskId] = resource.rewardMultiplier;
    }
    return row;
  });
}

/** Fitness/diversidad/población son siempre las mismas tres series; el clima es dinámico según DEFAULT_TASKS (RF-022). */
export function buildSeriesList(climateTaskIds: readonly string[]): SeriesMeta[] {
  return [
    { dataKey: "averageFitness", name: "Fitness promedio", color: "#1f77b4", yAxisId: "fitness" },
    { dataKey: "populationSize", name: "Población viva", color: "#2dd4bf", yAxisId: "population" },
    { dataKey: "geneticDiversity", name: "Diversidad genética (aprox.)", color: "#ff7f0e", yAxisId: "fitness", strokeDasharray: "4 3" },
    ...climateTaskIds.map((taskId, index) => ({
      dataKey: taskId,
      name: `Clima: ${taskId}`,
      color: CLIMATE_COLORS[index % CLIMATE_COLORS.length],
      yAxisId: "climate" as const,
    })),
  ];
}

/** Las 4 series ocultas por defecto (Mejora 2): clima + diversidad — Fitness y Población son las dos más intuitivas para un visitante nuevo. */
export const DEFAULT_HIDDEN_KEYS = ["AND", "NOT", "OR", "geneticDiversity"];

export interface RunChartProps {
  readonly snapshots: readonly GenerationSnapshot[];
  readonly height?: number;
}

/**
 * Fitness promedio (RF-020) + diversidad genética (RF-021) + curva
 * climática por tarea (RF-022), superpuestas.
 *
 * La leyenda de diversidad dice "(aprox.)" y hay una nota debajo del
 * gráfico a propósito: la métrica (engine/population/diversity.ts)
 * mide, medido en diversity.test.ts, que el ruido por desalineamiento
 * de indels puede ser ~27% de una señal de heterogeneidad real
 * comparable (0.031 de 0.115) — no es despreciable, así que no basta
 * con dejarlo documentado solo en comentarios de código/tests que el
 * usuario nunca ve.
 */
export default function RunChart({ snapshots, height = 380 }: RunChartProps) {
  const climateTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      for (const resource of snapshot.climate) ids.add(resource.taskId);
    }
    return [...ids];
  }, [snapshots]);

  const chartRows = useMemo(() => toChartRows(snapshots), [snapshots]);
  const seriesList = useMemo(() => buildSeriesList(climateTaskIds), [climateTaskIds]);

  // En la práctica son pocas por corrida: Fase 4 midió extinción real entre
  // las generaciones 21 y 131 con severity=0.9/interval=10, así que no es
  // una cantidad de líneas que vaya a saturar el gráfico.
  const catastropheGenerations = useMemo(() => getCatastropheGenerations(snapshots), [snapshots]);

  // Mejora 1 (panel de valores fijo, no un tooltip flotante): a
  // diferencia del tooltip default de Recharts, ya NO hay `onMouseLeave`
  // que limpie `hoveredGeneration` — el panel se queda mostrando los
  // últimos valores vistos hasta que el mouse (o el dedo, en mobile)
  // entra a una generación distinta.
  const [hoveredGeneration, setHoveredGeneration] = useState<number | null>(null);
  const hoveredRow = hoveredGeneration === null ? null : chartRows.find((row) => row.generation === hoveredGeneration);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Verificado con Playwright (touch real, no asumido): un primer toque
   * SÍ dispara `onMouseMove` de `<LineChart>` y muestra valores reales
   * — pero toques independientes SIGUIENTES (levantar el dedo y tocar de
   * nuevo en otra posición, no arrastrar) no vuelven a actualizar
   * `activeLabel` de forma confiable; quedan pegados al primer punto
   * tocado. Confirmado además que esto no es un problema de mouse en
   * general (con `page.mouse.move` real, moverse a distintas posiciones
   * SÍ actualiza cada vez) — es específico de gestos de touch discretos.
   * Este handler calcula la generación más cercana directamente a partir
   * de la coordenada del toque, en paralelo al `onMouseMove` de Recharts
   * (que sigue sirviendo al mouse real sin cambios) — corre en la fase de
   * bubble, después de cualquier manejo interno de Recharts, así que su
   * resultado (correcto) es el que termina aplicándose.
   */
  function handleTouchPosition(clientX: number) {
    const container = chartContainerRef.current;
    if (!container || chartRows.length === 0) return;

    const rect = container.getBoundingClientRect();
    const plotLeft = rect.left + CHART_MARGIN.left;
    const plotWidth = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
    if (plotWidth <= 0) return;

    const fraction = Math.min(1, Math.max(0, (clientX - plotLeft) / plotWidth));
    const minGeneration = chartRows[0]!.generation;
    const maxGeneration = chartRows[chartRows.length - 1]!.generation;
    const targetGeneration = minGeneration + fraction * (maxGeneration - minGeneration);

    let nearest = chartRows[0]!;
    let nearestDistance = Math.abs(nearest.generation - targetGeneration);
    for (const row of chartRows) {
      const distance = Math.abs(row.generation - targetGeneration);
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    setHoveredGeneration(nearest.generation);
  }

  function handleTouch(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (touch) handleTouchPosition(touch.clientX);
  }

  // Mejora 2 (leyenda interactiva): Fitness y Población son las dos
  // métricas más intuitivas para un visitante nuevo sin conocimientos
  // técnicos — clima y diversidad quedan disponibles para quien quiera
  // profundizar, sin saturar la vista inicial.
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_HIDDEN_KEYS));
  const visibleSeries = useMemo(() => seriesList.filter((s) => !hiddenKeys.has(s.dataKey)), [seriesList, hiddenKeys]);

  function toggleSeries(dataKey: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  }

  return (
    <div>
      {/*
        Ajuste 1 (re-auditoría post-producción, ver docs/04-roadmap-fases.md):
        el fix anterior (left:0→left:20) resolvió un déficit HORIZONTAL real
        en el eje izquierdo, pero el recorte que seguía viéndose en
        producción era VERTICAL, en ambos ejes — causa distinta, nunca antes
        medida. Recharts centra el label rotado (`angle`, `text-anchor:
        middle`) en el punto medio vertical del área del eje y lo extiende
        por igual arriba y abajo desde ese punto; si la mitad de la longitud
        renderizada del texto supera la distancia de ese centro al borde
        superior del SVG (que se achica cuando la leyenda crece a 5 líneas,
        o cuando el alto del gráfico baja a 320px en modo comparación), el
        SVG recorta la mitad de arriba por su `overflow: hidden` default.
        Medido con Playwright en los tres escenarios reales (sin corrida,
        corrida con leyenda completa, comparación a 320px): con el texto
        largo original el recorte iba de 13 a 111px según el escenario. Una
        primera abreviación ("Fitness / div." / "Mult. climático") resolvió
        los dos escenarios de 380px pero NO el de comparación a 320px
        (seguía cortado 22-42px, medido) — el texto todavía era demasiado
        largo para ese caso más ajustado. "Fitness" / "Clima" a secas sí da
        margen de sobra en los tres (-24px / -36px en el peor caso,
        confirmado): el significado completo ("diversidad", "climático")
        ya no se pierde porque vive en la leyenda de abajo y en el tooltip
        (Ajuste 3) — no hacía falta que también cupiera, rotado, en el
        propio título del eje. Reafinar el margen de nuevo no se eligió
        porque ya falló una vez al no generalizar a leyendas/alturas
        distintas.
      */}
      <div ref={chartContainerRef} onTouchStart={handleTouch} onTouchMove={handleTouch}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={chartRows}
            margin={CHART_MARGIN}
            onMouseMove={(state) => {
              if (state?.activeLabel !== undefined) setHoveredGeneration(Number(state.activeLabel));
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            {/*
              Ajuste 4 (auditoría de interfaz, ronda 3): el label "Generación"
              como "insideBottom" del eje X y la leyenda de abajo competían
              por un presupuesto de espacio vertical FIJO (~29.5px, medido)
              entre el fondo del área de líneas y el techo de la leyenda —
              ni `margin.bottom` en el LineChart ni `wrapperStyle` en el
              Legend lo cambiaron (probado con valores grandes, efecto cero).
              Con el label de 24px de alto, no quedaba margen para separar
              ambos lados al menos 8px cada uno bajo ningún reparto. Se saca
              el label del `<svg>` (mismo principio que el panel de hover del
              Ajuste 1: la geometría interna de Recharts es frágil para texto
              custom) y se renderiza como texto HTML plano debajo del
              gráfico, con margen CSS normal — ver `.chart-x-axis-label`.
            */}
            <XAxis
              dataKey="generation"
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            <YAxis
              yAxisId="fitness"
              domain={[0, "auto"]}
              label={{ value: "Fitness", angle: -90, position: "insideLeft", fill: CHART_AXIS_TEXT_COLOR }}
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            <YAxis
              yAxisId="climate"
              orientation="right"
              domain={[0, "auto"]}
              label={{ value: "Clima", angle: 90, position: "insideRight", fill: CHART_AXIS_TEXT_COLOR }}
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            {/*
              Tercer eje (población): NO comparte escala con "Fitness" (~0-3) ni
              con "Clima" (0-16) — el máximo teórico real es gridWidth*gridHeight
              (hasta 1600, RNF-008), un orden de magnitud por encima de ambos.
              Recharts apila un segundo eje "right" hacia afuera del primero
              automáticamente; `margin.right` se amplió de 30 a 60 para darle
              espacio a esta segunda columna de ticks sin recortarla (mismo tipo
              de bug ya cazado con Playwright para el eje izquierdo/derecho
              originales — ver el comentario grande más arriba).
            */}
            <YAxis
              yAxisId="population"
              orientation="right"
              domain={[0, "auto"]}
              label={{ value: "Población", angle: 90, position: "insideRight", fill: CHART_AXIS_TEXT_COLOR }}
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            {/*
              Ajuste 1 (auditoría de interfaz post-producción) + Mejora 1
              (panel fijo que no desaparece al hacer scroll): el tooltip
              flotante de Recharts tapaba justo las líneas que el usuario
              quería ver, y además desaparecía apenas el mouse salía del SVG
              (imposible de leer si hacía falta scrollear). Se suprime el
              cuadro flotante por completo (`content={() => null}`, se
              mantiene solo la línea guía del cursor) y el panel de valores
              vive fuera del `<svg>` (`.chart-hover-panel`, debajo de la
              leyenda) — nunca puede taparse, y con `onMouseLeave` sin
              limpiar el estado, se queda mostrando los últimos valores
              vistos en vez de desaparecer.
            */}
            <Tooltip content={() => null} cursor={{ stroke: CHART_AXIS_TEXT_COLOR, strokeDasharray: "3 3" }} />
            {/*
              Mejora 2 (leyenda interactiva): `content` custom en vez del
              render default de Recharts — necesitamos control exacto sobre
              la opacidad de una línea oculta (~30%, un valor de producto
              específico) y el `onClick` de toggle, en vez de confiar en el
              estilo "inactive" que Recharts aplica por defecto (pensado
              para tachar texto, no para esta paleta oscura). Sigue siendo
              el mismo `<Legend>` de Recharts — solo se le reemplaza el
              contenido, no el componente.
            */}
            <Legend
              content={() => (
                <ul className="chart-legend">
                  {seriesList.map((s) => {
                    const isHidden = hiddenKeys.has(s.dataKey);
                    return (
                      <li
                        key={s.dataKey}
                        className="chart-legend-item"
                        style={{ opacity: isHidden ? 0.3 : 1 }}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSeries(s.dataKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSeries(s.dataKey);
                          }
                        }}
                      >
                        <span className="chart-legend-swatch" style={{ background: s.color }} />
                        {s.name}
                      </li>
                    );
                  })}
                </ul>
              )}
            />
            {/*
              RNF-004 (2ª verificación con persona real, "Cambio 2"): la
              persona buscó los eventos catastróficos visualmente y no los
              encontró — con stroke fino (1px default) y punteado chico
              (2 2), esta línea se perdía entre las 5 líneas de colores
              saturados del gráfico. Más gruesa, más sólida (dash más largo)
              y un rojo más vívido para que lea como "marcador de alerta",
              no como una grilla de fondo más.
            */}
            {catastropheGenerations.map((generation) => (
              <ReferenceLine
                key={generation}
                x={generation}
                yAxisId="fitness"
                stroke="#d90429"
                strokeWidth={2.5}
                strokeDasharray="6 3"
                ifOverflow="extendDomain"
              />
            ))}
            {/* Mejora 2: `hide` mantiene el ítem en la leyenda (atenuado) sin dibujar la línea — ocultar el <Line> por completo también le haría desaparecer de la leyenda, que no es lo pedido. */}
            {seriesList.map((s) => (
              <Line
                key={s.dataKey}
                yAxisId={s.yAxisId}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                isAnimationActive={false}
                hide={hiddenKeys.has(s.dataKey)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-x-axis-label">Generación</p>
      {/*
        Mejora 1: panel de valores fijo, no un tooltip flotante — vive
        fuera del `<svg>`, así que hacer scroll para leerlo nunca lo hace
        desaparecer (a diferencia del tooltip original de Recharts, que
        se ocultaba apenas el mouse salía del área del gráfico). Solo
        muestra las series actualmente VISIBLES (Mejora 2): si el usuario
        ocultó "Clima: AND" desde la leyenda, ese valor no aparece acá,
        aunque el snapshot lo tenga.
      */}
      <div className="chart-hover-panel">
        {hoveredRow ? (
          <div className="chart-values-panel">
            <p className="chart-values-generation">Generación {hoveredRow.generation}</p>
            {(() => {
              const primary = visibleSeries.filter((s) => s.dataKey === "averageFitness" || s.dataKey === "populationSize");
              const climate = visibleSeries.filter((s) => s.yAxisId === "climate");
              const diversity = visibleSeries.filter((s) => s.dataKey === "geneticDiversity");
              return (
                <>
                  {primary.length > 0 && (
                    <p className="chart-values-row">
                      {primary.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: {formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                  {climate.length > 0 && (
                    <p className="chart-values-row">
                      {climate.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: ×{formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                  {diversity.length > 0 && (
                    <p className="chart-values-row">
                      {diversity.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: {formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <p className="chart-hover-placeholder">Pasá el mouse sobre el gráfico para ver los valores.</p>
        )}
      </div>
      <p className="chart-caption">
        La diversidad genética es una aproximación: compara genomas por posición sin alinearlos, así que una parte del
        número (hasta ~27% de una diferencia real comparable, medido) puede venir de que los genomas tienen distinta
        longitud, no solo de que sean funcionalmente distintos.
      </p>
      {catastropheGenerations.length > 0 && (
        <p className="chart-caption">
          Las líneas verticales punteadas marcan generaciones con un evento catastrófico (RF-015) — una caída puntual
          de la población, distinta de un clima que simplemente se puso desfavorable de forma gradual (RF-011).
        </p>
      )}
    </div>
  );
}
