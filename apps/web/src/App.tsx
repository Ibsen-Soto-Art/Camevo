import { useState, type FormEvent } from "react";
import "./App.css";
import RunPanel from "./components/RunPanel";
import { useRun } from "./hooks/useRun";
import type { ClimateChangeSpeed, RunFormValues } from "./lib/camevo-client";

interface BaseFormValues {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly mutationRate: number;
  readonly updates: number;
  readonly placementMode: RunFormValues["placementMode"];
  readonly reproducibilityMode: RunFormValues["reproducibilityMode"];
  readonly climateVarianceAmplitude: number;
}

const DEFAULT_BASE_FORM: BaseFormValues = {
  gridWidth: 20,
  gridHeight: 20,
  mutationRate: 0.05,
  updates: 1500,
  placementMode: "near-parent",
  reproducibilityMode: "reproducible",
  climateVarianceAmplitude: 0.15,
};

const SPEED_OPTIONS: { value: ClimateChangeSpeed; label: string }[] = [
  { value: "slow", label: "Lenta" },
  { value: "moderate", label: "Moderada" },
  { value: "fast", label: "Rápida" },
];

function toRunFormValues(base: BaseFormValues, climateChangeSpeed: ClimateChangeSpeed, climateEnabled: boolean): RunFormValues {
  return { ...base, climateEnabled, climateChangeSpeed };
}

export default function App() {
  const [base, setBase] = useState<BaseFormValues>(DEFAULT_BASE_FORM);
  const [climateEnabled, setClimateEnabled] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [speedSingle, setSpeedSingle] = useState<ClimateChangeSpeed>("moderate");
  const [speedA, setSpeedA] = useState<ClimateChangeSpeed>("slow");
  const [speedB, setSpeedB] = useState<ClimateChangeSpeed>("fast");

  const runSingle = useRun();
  const runA = useRun();
  const runB = useRun();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (compareMode) {
      await Promise.all([
        runA.start(toRunFormValues(base, speedA, true)),
        runB.start(toRunFormValues(base, speedB, true)),
      ]);
    } else {
      await runSingle.start(toRunFormValues(base, speedSingle, climateEnabled));
    }
  }

  const running = compareMode ? runA.status === "running" || runB.status === "running" : runSingle.status === "running";

  return (
    <main className="camevo-app">
      <h1>Camevo — Fase 3</h1>
      <p className="subtitle">
        Rescate evolutivo vs. deuda de extinción: mové la velocidad del cambio climático y observá si la población se
        adapta o se estanca.
      </p>

      <form className="run-form" onSubmit={handleSubmit}>
        <label>
          Ancho de grilla
          <input
            type="number"
            min={2}
            max={40}
            value={base.gridWidth}
            onChange={(e) => setBase({ ...base, gridWidth: Number(e.target.value) })}
          />
        </label>
        <label>
          Alto de grilla
          <input
            type="number"
            min={2}
            max={40}
            value={base.gridHeight}
            onChange={(e) => setBase({ ...base, gridHeight: Number(e.target.value) })}
          />
        </label>
        <label>
          Tasa de mutación
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={base.mutationRate}
            onChange={(e) => setBase({ ...base, mutationRate: Number(e.target.value) })}
          />
        </label>
        <label>
          Generaciones
          <input
            type="number"
            min={1}
            max={5000}
            value={base.updates}
            onChange={(e) => setBase({ ...base, updates: Number(e.target.value) })}
          />
        </label>
        <label>
          Colocación de la cría
          <select
            value={base.placementMode}
            onChange={(e) => setBase({ ...base, placementMode: e.target.value as BaseFormValues["placementMode"] })}
          >
            <option value="near-parent">Cerca del padre</option>
            <option value="random">Aleatoria</option>
          </select>
        </label>
        <label>
          Repetibilidad
          <select
            value={base.reproducibilityMode}
            onChange={(e) => setBase({ ...base, reproducibilityMode: e.target.value as BaseFormValues["reproducibilityMode"] })}
          >
            <option value="reproducible">Reproducible</option>
            <option value="experimental">Experimental</option>
          </select>
        </label>
        <label>
          Intensidad/varianza climática
          <input
            type="number"
            min={0}
            max={0.5}
            step={0.01}
            value={base.climateVarianceAmplitude}
            onChange={(e) => setBase({ ...base, climateVarianceAmplitude: Number(e.target.value) })}
          />
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
          Modo comparación (2 corridas en paralelo)
        </label>

        {!compareMode && (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={climateEnabled} onChange={(e) => setClimateEnabled(e.target.checked)} />
              Módulo climático activo
            </label>
            <label>
              Velocidad del cambio climático
              <select value={speedSingle} onChange={(e) => setSpeedSingle(e.target.value as ClimateChangeSpeed)} disabled={!climateEnabled}>
                {SPEED_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {compareMode && (
          <>
            <label>
              Velocidad climática — Corrida A
              <select value={speedA} onChange={(e) => setSpeedA(e.target.value as ClimateChangeSpeed)}>
                {SPEED_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Velocidad climática — Corrida B
              <select value={speedB} onChange={(e) => setSpeedB(e.target.value as ClimateChangeSpeed)}>
                {SPEED_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <button type="submit" disabled={running}>
          {running ? "Corriendo…" : compareMode ? "Iniciar ambas corridas" : "Iniciar corrida"}
        </button>
      </form>

      {compareMode ? (
        <div className="compare-grid">
          <RunPanel title={`Corrida A — velocidad ${speedA}`} climateChangeSpeed={speedA} run={runA} chartHeight={320} />
          <RunPanel title={`Corrida B — velocidad ${speedB}`} climateChangeSpeed={speedB} run={runB} chartHeight={320} />
        </div>
      ) : (
        <RunPanel title="Corrida" climateChangeSpeed={speedSingle} run={runSingle} />
      )}
    </main>
  );
}
