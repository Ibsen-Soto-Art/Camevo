import { useMemo } from "react";
import type { TooltipContentProps } from "recharts";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCatastropheGenerations } from "../lib/catastrophe";
import type { GenerationSnapshot } from "../lib/camevo-client";

const CLIMATE_COLORS = ["#d62728", "#2ca02c", "#9467bd"];

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
        <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="generation" label={{ value: "Generación", position: "insideBottom", offset: -5 }} />
          <YAxis yAxisId="fitness" domain={[0, "auto"]} label={{ value: "Fitness", angle: -90, position: "insideLeft" }} />
          <YAxis
            yAxisId="climate"
            orientation="right"
            domain={[0, "auto"]}
            label={{ value: "Clima", angle: 90, position: "insideRight" }}
          />
          <Tooltip content={ChartTooltip} />
          <Legend />
          {catastropheGenerations.map((generation) => (
            <ReferenceLine
              key={generation}
              x={generation}
              yAxisId="fitness"
              stroke="#8b0000"
              strokeDasharray="2 2"
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
