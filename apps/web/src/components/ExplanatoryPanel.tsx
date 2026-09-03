import { useMemo } from "react";
import type { ClimateChangeSpeed, GenerationSnapshot } from "../lib/camevo-client";

const SPEED_LABELS: Record<ClimateChangeSpeed, string> = {
  slow: "lenta",
  moderate: "moderada",
  fast: "rápida",
};

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * RF-026: conecta lo que se ve en el gráfico con su análogo real
 * (01-vision-general.md §9: rescate evolutivo / deuda de extinción).
 * La lectura ("sube"/"estancada") se basa en el fitness medido de la
 * propia corrida (primer cuarto vs. último cuarto, la misma técnica de
 * test/simulation/fitness-trend.test.ts), no solo en qué preset se
 * eligió — un preset "rápida" con suerte también puede mostrar mejora.
 *
 * Nota de limitación, declarada aquí y no solo en el código del motor:
 * "estancada" describe que el fitness deja de mejorar, no que la
 * población muera — no existe todavía un mecanismo de colapso
 * poblacional real (eso es RF-014/015, Fase 4).
 */
export interface ExplanatoryPanelProps {
  readonly climateChangeSpeed: ClimateChangeSpeed;
  readonly snapshots: readonly GenerationSnapshot[];
}

export default function ExplanatoryPanel({ climateChangeSpeed, snapshots }: ExplanatoryPanelProps) {
  const { ratio, hasEnoughData } = useMemo(() => {
    const quarter = Math.floor(snapshots.length / 4);
    if (quarter < 1) return { ratio: 1, hasEnoughData: false };
    const early = average(snapshots.slice(0, quarter).map((s) => s.averageFitness));
    const late = average(snapshots.slice(-quarter).map((s) => s.averageFitness));
    return { ratio: early > 0 ? late / early : 1, hasEnoughData: true };
  }, [snapshots]);

  const speedLabel = SPEED_LABELS[climateChangeSpeed];

  let message: string;
  if (!hasEnoughData) {
    message = `Corriendo con velocidad climática ${speedLabel}... todavía no hay suficientes generaciones para leer una tendencia.`;
  } else if (ratio > 1.08) {
    message =
      `Con velocidad climática ${speedLabel}, el fitness promedio subió respecto al comienzo de la corrida. ` +
      "Esto es rescate evolutivo: la mutación y la selección natural alcanzaron a generar adaptaciones antes de que " +
      "el ambiente cambiara demasiado — la población no solo sobrevive, mejora.";
  } else if (ratio < 0.95) {
    message =
      `Con velocidad climática ${speedLabel}, el fitness promedio dejó de mejorar (o bajó) hacia el final de la corrida. ` +
      "Esto es deuda de extinción: el clima cambia más rápido de lo que la mutación puede generar variantes útiles, " +
      "así que las adaptaciones quedan obsoletas antes de consolidarse. No significa que la población haya muerto " +
      "— significa que dejó de adaptarse, que es el primer paso hacia el colapso si la tendencia sigue.";
  } else {
    message =
      `Con velocidad climática ${speedLabel}, el fitness se mantuvo relativamente estable: ni una mejora clara ni un ` +
      "declive claro — un punto intermedio entre rescate evolutivo y deuda de extinción.";
  }

  return (
    <div className="explanatory-panel">
      <p>{message}</p>
    </div>
  );
}
