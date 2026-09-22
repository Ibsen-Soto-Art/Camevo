import type { ClimateChangeSpeed } from "../lib/camevo-client";
import type { RunView, SaveStatus } from "../hooks/useRun";
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
  return (
    <div className="run-panel">
      <h2>{title}</h2>
      {run.runId && (
        <p className="status-line">
          Corrida{" "}
          <code className="run-id" title={run.runId}>
            {run.runId}
          </code>{" "}
          — estado: <strong>{run.status}</strong>
        </p>
      )}
      {run.errorMessage && <p className="error">{run.errorMessage}</p>}
      <div className="chart-container">
        <RunChart snapshots={run.snapshots} height={chartHeight} />
      </div>
      {run.snapshots.length > 0 && (
        <>
          <PopulationGrid snapshots={run.snapshots} gridWidth={gridWidth} gridHeight={gridHeight} runId={run.runId} />
          <ExplanatoryPanel
            climateEnabled={climateEnabled}
            climateChangeSpeed={climateChangeSpeed}
            snapshots={run.snapshots}
            numAncestors={numAncestors}
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
