import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
    </div>
  );
}
