import { useState } from "react";
import type { ClimateChangeSpeed } from "../lib/camevo-client";
import type { RunStatus, RunView, SaveStatus } from "../hooks/useRun";
import ExplanatoryPanel from "./ExplanatoryPanel";
import PopulationGrid from "./PopulationGrid";
import RunChart from "./RunChart";

export interface RunPanelProps {
  readonly title: string;
  readonly climateEnabled: boolean;
  readonly climateChangeSpeed: ClimateChangeSpeed;
  readonly run: RunView;
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** RF-008: numAncestors SOLICITADO — ver ExplanatoryPanel para cómo se resuelve al conteo real sembrado. */
  readonly numAncestors: number;
  readonly chartHeight?: number;
  /**
   * Grupo 1 (Cambio 1B): solo se pasan para una corrida EN VIVO (useRun) —
   * nunca para una histórica (useHistoricalRun), que ya está guardada por
   * definición (llegó acá vía GET /runs/:id, que solo devuelve corridas
   * guardadas). Sin `onSave`, este panel no muestra el botón.
   */
  readonly onSave?: () => void;
  readonly saveStatus?: SaveStatus;
  readonly saveError?: string | null;
}

/**
 * RNF-004: `RunStatus` es vocabulario interno en inglés, y hasta ahora se
 * imprimía crudo — "estado: running" era la ÚNICA cadena en inglés
 * visible en toda la interfaz (verificado recorriendo los nodos de texto
 * de la página). "idle" no aparece en esta tabla a propósito: una corrida
 * que no arrancó no tiene nada que informar, así que no se muestra la
 * línea de estado (ver abajo).
 */
const STATUS_LABEL: Record<Exclude<RunStatus, "idle">, string> = {
  running: "en curso",
  paused: "pausada",
  done: "finalizada",
  error: "error",
};

/** Un run en curso: título, estado, gráfico, grilla poblacional y panel explicativo — la unidad que se repite en modo comparación (RF-025). */
export default function RunPanel({
  title,
  climateEnabled,
  climateChangeSpeed,
  run,
  gridWidth,
  gridHeight,
  numAncestors,
  chartHeight,
  onSave,
  saveStatus,
  saveError,
}: RunPanelProps) {
  /*
   * El hover del gráfico vive acá, no en RunChart, porque lo consumen DOS
   * hijos: el panel de valores (dentro de RunChart) y la grilla
   * poblacional. Es estado local del panel a propósito: en modo
   * comparación hay dos <RunPanel> montados y cada uno tiene el suyo, así
   * que mover el mouse sobre el gráfico de la corrida A no mueve la grilla
   * de la B.
   */
  const [hoveredGeneration, setHoveredGeneration] = useState<number | null>(null);

  return (
    <div className="run-panel">
      <h2>{title}</h2>
      {run.runId && run.status !== "idle" && (
        <p className="status-line">
          Corrida{" "}
          <code className="run-id" title={run.runId}>
            {run.runId}
          </code>{" "}
          — estado: <strong>{STATUS_LABEL[run.status]}</strong>
        </p>
      )}
      {run.errorMessage && <p className="error">{run.errorMessage}</p>}
      <div className="chart-container">
        <RunChart snapshots={run.snapshots} height={chartHeight} onHoverGeneration={setHoveredGeneration} />
      </div>
      {run.snapshots.length > 0 && (
        <>
          {/*
            "running" y "paused" son los dos estados en los que la corrida
            sigue abierta en el LiveRunRegistry del servidor. "done" cubre
            tanto una corrida recién terminada como una guardada que se
            cargó con useHistoricalRun (que entrega status="done"), y en
            ninguno de los dos el endpoint de organismos responde.
          */}
          <PopulationGrid
            snapshots={run.snapshots}
            gridWidth={gridWidth}
            gridHeight={gridHeight}
            runId={run.runId}
            inspectable={run.status === "running" || run.status === "paused"}
            hoveredGeneration={hoveredGeneration}
          />
          <ExplanatoryPanel
            climateEnabled={climateEnabled}
            climateChangeSpeed={climateChangeSpeed}
            snapshots={run.snapshots}
            numAncestors={numAncestors}
            isRunning={run.status === "running"}
          />
        </>
      )}
      {/*
        Grupo 2 (layout aprobado): "Guardar esta corrida" se mueve al
        cierre de la narrativa — después de que el usuario ya vio el
        gráfico, la grilla y la explicación del resultado, no antes (donde
        vivía en la implementación original de Grupo 1, pegado al
        status-line, antes de que hubiera nada que "cerrar").
      */}
      {onSave && run.status === "done" && (
        <div className="save-run">
          {saveStatus === "saved" ? (
            <>
              <button type="button" disabled>
                Guardada ✓
              </button>
              <p className="save-confirmation">Vas a poder encontrarla en "Comparar dos corridas guardadas".</p>
            </>
          ) : (
            <button type="button" onClick={onSave} disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? "Guardando…" : "Guardar esta corrida"}
            </button>
          )}
          {saveStatus === "error" && saveError && <p className="error">{saveError}</p>}
        </div>
      )}
    </div>
  );
}
