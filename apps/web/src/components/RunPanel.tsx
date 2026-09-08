import type { ClimateChangeSpeed } from "../lib/camevo-client";
import type { RunView } from "../hooks/useRun";
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
  readonly chartHeight?: number;
}

/** Un run en curso: título, estado, gráfico, grilla poblacional y panel explicativo — la unidad que se repite en modo comparación (RF-025). */
export default function RunPanel({ title, climateEnabled, climateChangeSpeed, run, gridWidth, gridHeight, chartHeight }: RunPanelProps) {
  return (
    <div className="run-panel">
      <h2>{title}</h2>
      {run.runId && (
        <p className="status-line">
          Corrida <code>{run.runId}</code> — estado: <strong>{run.status}</strong>
        </p>
      )}
      {run.errorMessage && <p className="error">{run.errorMessage}</p>}
      <div className="chart-container">
        <RunChart snapshots={run.snapshots} height={chartHeight} />
      </div>
      {run.snapshots.length > 0 && (
        <>
          <PopulationGrid snapshots={run.snapshots} gridWidth={gridWidth} gridHeight={gridHeight} />
          <ExplanatoryPanel climateEnabled={climateEnabled} climateChangeSpeed={climateChangeSpeed} snapshots={run.snapshots} />
        </>
      )}
    </div>
  );
}
