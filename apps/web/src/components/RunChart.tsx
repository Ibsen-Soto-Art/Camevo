import { useMemo, useState } from "react";
import type { TooltipContentProps } from "recharts";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCatastropheGenerations } from "../lib/catastrophe";
import type { GenerationSnapshot } from "../lib/camevo-client";

type TooltipPayloadEntry = NonNullable<TooltipContentProps["payload"]>[number];

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

const FIXED_METRIC_DESCRIPTIONS: Record<string, string> = {
  averageFitness: "Promedio de crías producidas por organismo — indica qué tan bien se está adaptando la población.",
  geneticDiversity:
    'Variación en los genomas de la población — alta diversidad significa más "material" disponible para la evolución.',
};

/** Cualquier dataKey que no sea una de las dos métricas fijas de arriba es un taskId climático (RF-022, dinámico según DEFAULT_TASKS). */
function describeMetric(dataKey: string): string {
  return (
    FIXED_METRIC_DESCRIPTIONS[dataKey] ??
    `Multiplicador de energía para organismos que resuelven la tarea ${dataKey} — cuando sube, esa habilidad es más valiosa para sobrevivir.`
  );
}

/**
 * Ajuste 3 (auditoría de interfaz post-producción): el tooltip default de
 * Recharts solo mostraba nombre + valor numérico — sin significado para
 * alguien sin conocimientos previos de qué es "Diversidad genética" o por
 * qué "Clima: AND" sube y baja. Reemplaza el contenido del tooltip
 * existente (no un panel aparte) agregando una descripción en lenguaje
 * humano por línea, debajo del valor.
 */
export function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">Generación {label}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="chart-tooltip-entry">
          <p className="chart-tooltip-name" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
          </p>
          <p className="chart-tooltip-description">{describeMetric(String(entry.dataKey))}</p>
        </div>
      ))}
    </div>
  );
}

/** Aplana los snapshots a filas {generation, averageFitness, geneticDiversity, [taskId]: multiplier} para Recharts. */
function toChartRows(snapshots: readonly GenerationSnapshot[]): Record<string, number>[] {
  return snapshots.map((snapshot) => {
    const row: Record<string, number> = {
      generation: snapshot.generation,
      averageFitness: snapshot.averageFitness,
      geneticDiversity: snapshot.geneticDiversity,
    };
    for (const resource of snapshot.climate) {
      row[resource.taskId] = resource.rewardMultiplier;
    }
    return row;
  });
}

/**
 * Ajuste 1 (re-auditoría post-producción): reconstruye a mano el mismo
 * `payload` que Recharts le pasaría a un tooltip flotante, a partir de
 * una fila ya aplanada — así el panel externo de abajo puede reusar
 * `ChartTooltip` tal cual (mismo componente, mismas descripciones), sin
 * depender del tooltip flotante de Recharts para nada.
 */
function buildHoverPayload(row: Record<string, number>, climateTaskIds: readonly string[]): TooltipPayloadEntry[] {
  const entries: TooltipPayloadEntry[] = [
    { dataKey: "averageFitness", name: "Fitness promedio", value: row.averageFitness, color: "#1f77b4", graphicalItemId: "averageFitness" },
    {
      dataKey: "geneticDiversity",
      name: "Diversidad genética (aprox.)",
      value: row.geneticDiversity,
      color: "#ff7f0e",
      graphicalItemId: "geneticDiversity",
    },
  ];
  climateTaskIds.forEach((taskId, index) => {
    entries.push({
      dataKey: taskId,
      name: `Clima: ${taskId}`,
      value: row[taskId],
      color: CLIMATE_COLORS[index % CLIMATE_COLORS.length],
      graphicalItemId: taskId,
    });
  });
  return entries;
}

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

  // En la práctica son pocas por corrida: Fase 4 midió extinción real entre
  // las generaciones 21 y 131 con severity=0.9/interval=10, así que no es
  // una cantidad de líneas que vaya a saturar el gráfico.
  const catastropheGenerations = useMemo(() => getCatastropheGenerations(snapshots), [snapshots]);

  const [hoveredGeneration, setHoveredGeneration] = useState<number | null>(null);
  const hoveredRow = hoveredGeneration === null ? null : chartRows.find((row) => row.generation === hoveredGeneration);

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
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={chartRows}
          margin={{ top: 10, right: 30, left: 20, bottom: 0 }}
          onMouseMove={(state) => {
            if (state?.activeLabel !== undefined) setHoveredGeneration(Number(state.activeLabel));
          }}
          onMouseLeave={() => setHoveredGeneration(null)}
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
            Ajuste 1 (auditoría de interfaz post-producción): el tooltip
            flotante de Recharts tapaba justo las líneas que el usuario
            quería ver — con las 5 métricas activas, el cuadro de
            descripciones (ver ChartTooltip) es alto y ancho, y sigue al
            cursor sobre el propio SVG. En vez de reposicionarlo dentro del
            SVG (ninguna esquina queda libre de forma confiable con datos
            que ocupan todo el rango 0-1 o 0-16), se suprime el cuadro
            flotante (`content={() => null}`, se mantiene la línea guía del
            cursor) y el detalle se levanta a un panel HTML fijo debajo del
            gráfico (`chart-hover-panel`, fuera del `<svg>` — nunca puede
            tapar una línea) usando `onMouseMove`/`onMouseLeave` del propio
            LineChart + los datos que el componente ya tiene (`chartRows`),
            reconstruyendo el mismo payload que Recharts le pasaría
            (`buildHoverPayload`) para reusar `ChartTooltip` sin duplicar
            el markup ni las descripciones.
          */}
          <Tooltip content={() => null} cursor={{ stroke: CHART_AXIS_TEXT_COLOR, strokeDasharray: "3 3" }} />
          <Legend />
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
          <Line
            yAxisId="fitness"
            type="monotone"
            dataKey="averageFitness"
            name="Fitness promedio"
            stroke="#1f77b4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="fitness"
            type="monotone"
            dataKey="geneticDiversity"
            name="Diversidad genética (aprox.)"
            stroke="#ff7f0e"
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
          {climateTaskIds.map((taskId, index) => (
            <Line
              key={taskId}
              yAxisId="climate"
              type="monotone"
              dataKey={taskId}
              name={`Clima: ${taskId}`}
              stroke={CLIMATE_COLORS[index % CLIMATE_COLORS.length]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="chart-x-axis-label">Generación</p>
      <div className="chart-hover-panel">
        {hoveredRow ? (
          <ChartTooltip
            active
            payload={buildHoverPayload(hoveredRow, climateTaskIds)}
            label={hoveredRow.generation}
            coordinate={undefined}
            accessibilityLayer={false}
            activeIndex={undefined}
          />
        ) : (
          <p className="chart-tooltip chart-hover-placeholder">
            Pasá el mouse sobre el gráfico para ver el detalle de cada línea en esa generación.
          </p>
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
