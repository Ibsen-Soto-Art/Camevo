import { useEffect, useMemo, useRef } from "react";
import type { GenerationSnapshot } from "../lib/camevo-client";

const EMPTY_CELL_COLOR = "#2a2a2a";
const CANVAS_SIZE = 400;
const CATASTROPHE_BORDER_COLOR = "#8b0000";
const CATASTROPHE_BORDER_WIDTH = 8;

export interface PopulationGridProps {
  readonly snapshots: readonly GenerationSnapshot[];
  readonly gridWidth: number;
  readonly gridHeight: number;
}

/** Verde saludable → rojo apagado a medida que el fitness normalizado baja de 1 a 0. */
function fitnessColor(normalized: number): string {
  const clamped = Math.max(0, Math.min(1, normalized));
  const hue = 120 * clamped; // 0 = rojo, 120 = verde
  return `hsl(${hue}, 70%, 45%)`;
}

/**
 * RF-024: grilla poblacional estilo Avida-ED. Canvas, no SVG — hasta 1600
 * celdas (grilla máxima 40x40) actualizándose en cada snapshot de
 * WebSocket harían que SVG reconciliara 1600 nodos DOM por generación;
 * canvas dibuja píxeles directo. Redibuja la grilla COMPLETA en cada
 * snapshot en vez de diffear qué celdas cambiaron: medido con un
 * benchmark real (canvas real vía Playwright, no cálculo de escritorio),
 * un redibujado completo de 40x40 tarda ~0.88ms — muy por debajo de
 * cualquier presupuesto de frame y de la cadencia real de generaciones,
 * así que diffear agregaría complejidad sin beneficio medible.
 *
 * Desacoplado de RunView/RunHandle (mismo tipo de entrada que RunChart:
 * solo `snapshots` + las dimensiones de la grilla), así que sirve igual
 * para una corrida en vivo que para una ya guardada (RF-025).
 */
export default function PopulationGrid({ snapshots, gridWidth, gridHeight }: PopulationGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = snapshots.at(-1);

  /**
   * Máximo histórico de ESTA corrida hasta el snapshot actual, no el
   * máximo de cada snapshot individual — decisión deliberada, no la
   * opción obvia. `fitness` (offspringProduced) es un contador que crece
   * con la duración de la corrida, no con qué tan "sana" está (medido:
   * max=9 en la generación 10, max=1779 en la generación 1999 de la
   * MISMA corrida sin clima). Normalizar por snapshot haría que el mismo
   * valor de fitness se vea "peor" con el correr de las generaciones sin
   * ninguna razón real, y peor aún: en una corrida rumbo al colapso, el
   * organismo más fuerte de un snapshot tardío (aunque objetivamente
   * débil comparado con el pico histórico de esa corrida) se pintaría
   * como "saludable" — la señal visual opuesta a la real, justo antes de
   * la extinción. El máximo corrido evita ambos problemas: el color de
   * una celda es comparable de una generación a la siguiente DENTRO de
   * la misma corrida (no entre corridas distintas — eso es aceptable,
   * corridas distintas ya son comparaciones cualitativas, no de escala
   * numérica compartida).
   */
  const historicalMaxFitness = useMemo(() => {
    let max = 1; // evita división por cero si todos los organismos siguen en fitness 0
    for (const snapshot of snapshots) {
      for (const organism of snapshot.organisms) {
        if (organism.fitness > max) max = organism.fitness;
      }
    }
    return max;
  }, [snapshots]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !latest) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellWidth = canvas.width / gridWidth;
    const cellHeight = canvas.height / gridHeight;

    ctx.fillStyle = EMPTY_CELL_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const organism of latest.organisms) {
      ctx.fillStyle = fitnessColor(organism.fitness / historicalMaxFitness);
      ctx.fillRect(organism.x * cellWidth, organism.y * cellHeight, cellWidth, cellHeight);
    }

    // RF-015 (marcadores visuales): un "destello" de un solo frame — como
    // cada snapshot nuevo redibuja la grilla completa desde cero (ver
    // comentario de arriba), este borde aparece exactamente en el
    // redibujado de la generación con `catastropheOccurred` y desaparece
    // solo en el siguiente, sin necesidad de timers ni animación CSS.
    if (latest.catastropheOccurred) {
      ctx.strokeStyle = CATASTROPHE_BORDER_COLOR;
      ctx.lineWidth = CATASTROPHE_BORDER_WIDTH;
      ctx.strokeRect(
        CATASTROPHE_BORDER_WIDTH / 2,
        CATASTROPHE_BORDER_WIDTH / 2,
        canvas.width - CATASTROPHE_BORDER_WIDTH,
        canvas.height - CATASTROPHE_BORDER_WIDTH,
      );
    }
  }, [latest, gridWidth, gridHeight, historicalMaxFitness]);

  if (!latest) {
    return null;
  }

  return (
    <div className="population-grid">
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} role="img" aria-label="Grilla poblacional" />
      <p className="population-grid-caption">
        Cada celda es un organismo, coloreado de rojo a verde según cuántas crías produjo en relación con el mejor
        organismo que tuvo esta corrida hasta ahora. Las celdas oscuras son hábitat vacío — un organismo murió y
        todavía no fue reemplazado. Un borde rojo alrededor de la grilla marca la generación exacta de un evento
        catastrófico (RF-015) — dura solo esa generación, distinto de un clima que se pone desfavorable de forma
        gradual (RF-011).
      </p>
    </div>
  );
}
