import { useEffect, useMemo, useRef, useState } from "react";
import type { GenerationSnapshot } from "../lib/camevo-client";

const EMPTY_CELL_COLOR = "#2a2a2a";
const DEFAULT_DISPLAY_SIZE = 400;
const MAX_DISPLAY_SIZE = 700;
const CATASTROPHE_BORDER_COLOR = "#8b0000";
const CATASTROPHE_BORDER_WIDTH = 8;
/**
 * RNF-004 (2ª verificación con persona real, "Cambio 2"): el destello
 * original duraba UN frame (80ms a ritmo default) — medido, era
 * imperceptible en reproducción real, aunque se viera grande en una
 * captura fija. 8 generaciones, no más, no menos: el preset "Cambio
 * climático acelerado" dispara catástrofes cada 10 generaciones
 * (`FAST_CATASTROPHE.intervalGenerations`), así que 8 da ~5x más tiempo
 * de exposición sin llegar a solaparse con el inicio del próximo evento
 * (que reiniciaría la ventana igual, mostrándose como continuo en vez de
 * como dos eventos distintos).
 */
const CATASTROPHE_FLASH_HOLD_GENERATIONS = 8;

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
 * Ajuste 2 (auditoría de interfaz post-producción): antes no había NINGÚN
 * elemento visual de leyenda, solo el párrafo de texto de abajo — alguien
 * sin conocimientos previos tenía que leer un párrafo entero para saber
 * qué significa un color. Los 5 stops se generan con la MISMA función
 * `fitnessColor` que pinta las celdas reales (no un gradiente CSS
 * inventado aparte), así que la leyenda nunca puede desincronizarse de
 * los colores que realmente se ven en la grilla.
 */
const GRADIENT_CSS = [0, 0.25, 0.5, 0.75, 1].map((t) => fitnessColor(t)).join(", ");

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
 *
 * Rediseño responsive: el tamaño de despliegue se mide del contenedor
 * real vía ResizeObserver, no un valor fijo puesto una sola vez al
 * montar — antes, con `<canvas width={400} height={400}>` y solo
 * `max-width:100%` en CSS, el canvas se achicaba bien en mobile pero
 * JAMÁS crecía más allá de 400px en desktop, dejando espacio vacío
 * sobrante en la columna derecha del nuevo layout (~65-70% del
 * viewport, bastante más ancha que 400px). `ResizeObserver` puede no
 * existir en jsdom (tests) — se degrada con gracia al tamaño por
 * defecto en vez de tirar un error, sin necesitar un mock específico.
 *
 * También corrige nitidez en pantallas de alta densidad (Retina, etc.):
 * el buffer interno del canvas ahora se escala por `devicePixelRatio`,
 * con las coordenadas de dibujo siempre en unidades CSS (`ctx.scale`) —
 * antes, un canvas de 400x400 píxeles físicos mostrado a 400 CSS px se
 * veía correcto en pantallas 1x pero ligeramente suave en 2x/3x.
 */
export default function PopulationGrid({ snapshots, gridWidth, gridHeight }: PopulationGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displaySize, setDisplaySize] = useState(DEFAULT_DISPLAY_SIZE);
  const latest = snapshots.at(-1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) {
        setDisplaySize(Math.min(Math.round(width), MAX_DISPLAY_SIZE));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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

  /** Generación del catastropheOccurred más reciente vista hasta ahora, o null si todavía no hubo ninguno. */
  const lastCatastropheGeneration = useMemo(() => {
    let last: number | null = null;
    for (const snapshot of snapshots) {
      if (snapshot.catastropheOccurred) last = snapshot.generation;
    }
    return last;
  }, [snapshots]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !latest) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // a partir de acá, todas las coordenadas son en px CSS, no físicos

    const cellWidth = displaySize / gridWidth;
    const cellHeight = displaySize / gridHeight;

    ctx.fillStyle = EMPTY_CELL_COLOR;
    ctx.fillRect(0, 0, displaySize, displaySize);

    for (const organism of latest.organisms) {
      ctx.fillStyle = fitnessColor(organism.fitness / historicalMaxFitness);
      ctx.fillRect(organism.x * cellWidth, organism.y * cellHeight, cellWidth, cellHeight);
    }

    // RF-015 (marcadores visuales): el borde se mantiene durante
    // CATASTROPHE_FLASH_HOLD_GENERATIONS generaciones desde el
    // catastropheOccurred más reciente, no solo en la generación exacta
    // — como cada snapshot nuevo redibuja la grilla completa desde cero
    // (ver comentario de arriba), esto simplemente significa "seguir
    // dibujando el borde mientras estemos dentro de la ventana", sin
    // necesidad de timers ni animación CSS.
    const showCatastropheBorder =
      lastCatastropheGeneration !== null && latest.generation - lastCatastropheGeneration < CATASTROPHE_FLASH_HOLD_GENERATIONS;
    if (showCatastropheBorder) {
      ctx.strokeStyle = CATASTROPHE_BORDER_COLOR;
      ctx.lineWidth = CATASTROPHE_BORDER_WIDTH;
      ctx.strokeRect(
        CATASTROPHE_BORDER_WIDTH / 2,
        CATASTROPHE_BORDER_WIDTH / 2,
        displaySize - CATASTROPHE_BORDER_WIDTH,
        displaySize - CATASTROPHE_BORDER_WIDTH,
      );
    }
  }, [latest, gridWidth, gridHeight, historicalMaxFitness, displaySize, lastCatastropheGeneration]);

  if (!latest) {
    return null;
  }

  return (
    <div className="population-grid" ref={containerRef}>
      <canvas ref={canvasRef} role="img" aria-label="Grilla poblacional" />
      <div className="population-grid-legend">
        <div className="grid-legend-item grid-legend-gradient">
          {/* RNF-004 (re-auditoría): "fitness" nunca se definía en texto plano en ningún punto del flujo principal — el tooltip lo explica, pero eso requiere que alguien piense en pasar el mouse. Acá, donde el usuario ya está mirando la grilla, es el lugar natural para la primera definición mínima. */}
          <span className="grid-legend-label">Fitness bajo (pocas crías)</span>
          <span className="grid-legend-bar" style={{ background: `linear-gradient(to right, ${GRADIENT_CSS})` }} />
          {/* Ajuste 5: mismo azul (#1f77b4) que "Fitness promedio" en RunChart — puente visual entre las dos representaciones de la misma variable, sin tocar el gradiente rojo→verde de la grilla en sí. */}
          <span className="grid-legend-label grid-legend-label-fitness-high">Fitness alto (muchas crías)</span>
        </div>
        <div className="grid-legend-item">
          <span className="grid-legend-swatch" style={{ background: EMPTY_CELL_COLOR }} />
          <span className="grid-legend-label">Hábitat vacío</span>
        </div>
        <div className="grid-legend-item">
          <span className="grid-legend-swatch grid-legend-swatch-outline" style={{ borderColor: CATASTROPHE_BORDER_COLOR }} />
          <span className="grid-legend-label">Evento catastrófico (borde)</span>
        </div>
      </div>
      <p className="population-grid-caption">
        Cada celda es un organismo, coloreado de rojo a verde según cuántas crías produjo en relación con el mejor
        organismo que tuvo esta corrida hasta ahora. Las celdas oscuras son hábitat vacío — un organismo murió y
        todavía no fue reemplazado. Un borde rojo alrededor de la grilla marca que hubo un evento catastrófico
        (RF-015) recientemente — se mantiene varias generaciones para que no pase desapercibido, distinto de un
        clima que se pone desfavorable de forma gradual (RF-011).
      </p>
    </div>
  );
}
