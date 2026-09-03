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
 * (01-vision-general.md §9: rescate evolutivo / deuda de extinción, y
 * la nota sobre variación genética en pie que se agrega ahí mismo). La
 * lectura ("sube"/"estancada") se basa en el fitness medido de la
 * propia corrida (primer cuarto vs. último cuarto, la misma técnica de
 * test/simulation/fitness-trend.test.ts), no solo en qué preset se
 * eligió — un preset "rápida" con suerte también puede mostrar mejora.
 *
 * Aclaración metodológica importante, pedida explícitamente antes de
 * cerrar la Fase 3: el segundo ancestro ya adaptado
 * (createNotSolvingGenome, sembrado cuando climateEnabled) significa
 * que lo que este demo prueba es selección sobre VARIACIÓN GENÉTICA YA
 * PRESENTE en la población desde el inicio ("standing genetic
 * variation"), no una mutación nueva apareciendo justo a tiempo bajo
 * presión climática en tiempo real. Es, de hecho, más fiel a cómo
 * funciona el rescate evolutivo real (rara vez depende de que aparezca
 * una mutación nueva en el momento exacto en que se la necesita) — pero
 * el mensaje se lo dice al usuario explícitamente, no lo deja implícito.
 */
export interface ExplanatoryPanelProps {
  readonly climateEnabled: boolean;
  readonly climateChangeSpeed: ClimateChangeSpeed;
  readonly snapshots: readonly GenerationSnapshot[];
}

export default function ExplanatoryPanel({ climateEnabled, climateChangeSpeed, snapshots }: ExplanatoryPanelProps) {
  const { ratio, hasEnoughData } = useMemo(() => {
    const quarter = Math.floor(snapshots.length / 4);
    if (quarter < 1) return { ratio: 1, hasEnoughData: false };
    const early = average(snapshots.slice(0, quarter).map((s) => s.averageFitness));
    const late = average(snapshots.slice(-quarter).map((s) => s.averageFitness));
    return { ratio: early > 0 ? late / early : 1, hasEnoughData: true };
  }, [snapshots]);

  if (!climateEnabled) {
    return (
      <div className="explanatory-panel">
        <p>Módulo climático desactivado: el fitness solo refleja selección sobre eficiencia de replicación (Fase 1), sin presión climática.</p>
      </div>
    );
  }

  const speedLabel = SPEED_LABELS[climateChangeSpeed];

  let message: string;
  if (!hasEnoughData) {
    message = `Corriendo con velocidad climática ${speedLabel}... todavía no hay suficientes generaciones para leer una tendencia.`;
  } else if (ratio > 1.08) {
    message =
      `Con velocidad climática ${speedLabel}, el fitness promedio subió respecto al comienzo de la corrida. ` +
      "Esto es rescate evolutivo: la selección natural tuvo tiempo de favorecer, dentro de la variación genética que " +
      "ya existía en la población, a los organismos mejor adaptados al clima vigente — la población no solo sobrevive, mejora.";
  } else if (ratio < 0.95) {
    message =
      `Con velocidad climática ${speedLabel}, el fitness promedio dejó de mejorar (o bajó) hacia el final de la corrida. ` +
      "Esto es deuda de extinción: el clima cambia más rápido de lo que la selección alcanza a consolidar una ventaja " +
      "sobre el resto de la población antes de que el clima vuelva a cambiar qué es adaptativo. No significa que la " +
      "población haya muerto — significa que dejó de adaptarse, que es el primer paso hacia el colapso si la tendencia sigue.";
  } else {
    message =
      `Con velocidad climática ${speedLabel}, el fitness se mantuvo relativamente estable: ni una mejora clara ni un ` +
      "declive claro — un punto intermedio entre rescate evolutivo y deuda de extinción.";
  }

  return (
    <div className="explanatory-panel">
      <p>{message}</p>
      <p className="panel-note">
        Nota metodológica: la población parte con un organismo ya capaz de resolver una tarea (variación genética "en
        pie", presente desde la generación 0), no con la esperanza de que una mutación nueva aparezca justo a tiempo —
        así funciona también el rescate evolutivo real con más frecuencia.
      </p>
    </div>
  );
}
