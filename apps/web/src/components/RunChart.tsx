import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCatastropheGenerations } from "../lib/catastrophe";
import type { GenerationSnapshot } from "../lib/camevo-client";

const CLIMATE_COLORS = ["#d62728", "#2ca02c", "#9467bd"];

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
        left: 20, no 0 — el título rotado del eje Y izquierdo ("Fitness /
        diversidad", position "insideLeft") se recorta contra el borde del
        SVG sin este margen: medido con Playwright, el bounding box del
        label empieza ~6-8px a la izquierda del borde del SVG en left:0, en
        cualquier ancho de viewport probado (1280px y 420px, mismo déficit)
        — no es un problema de layout responsive, es un margen fijo
        insuficiente. El eje derecho ya tenía margen de sobra (right: 30) y
        no lo necesitó.
      */}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="generation" label={{ value: "Generación", position: "insideBottom", offset: -5 }} />
          <YAxis
            yAxisId="fitness"
            domain={[0, "auto"]}
            label={{ value: "Fitness / diversidad", angle: -90, position: "insideLeft" }}
          />
          <YAxis
            yAxisId="climate"
            orientation="right"
            domain={[0, "auto"]}
            label={{ value: "Multiplicador climático", angle: 90, position: "insideRight" }}
          />
          <Tooltip />
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
