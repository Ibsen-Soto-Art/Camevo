import { useEffect, useState, type FormEvent } from "react";
import "./App.css";
import RunPanel from "./components/RunPanel";
import { useHistoricalRun } from "./hooks/useHistoricalRun";
import { useRun, type RunHandle } from "./hooks/useRun";
import { listRuns, type ClimateChangeSpeed, type RunFormValues, type RunSummary } from "./lib/camevo-client";
import { effectiveLineageCount } from "./lib/lineage";

/**
 * RF-023: pausar/reanudar y ajustar el ritmo de una corrida ya en curso —
 * no aplica a corridas guardadas (ya terminadas). `initialSpeed` alimenta
 * el `defaultValue` del slider; usar `key={run.runId}` en el llamador para
 * que una corrida nueva no herede la posición del slider de la anterior.
 */
function PlaybackControls({ run, initialSpeed }: { readonly run: RunHandle; readonly initialSpeed: number }) {
  if (run.status !== "running" && run.status !== "paused") {
    return null;
  }
  return (
    <div className="playback-controls">
      <button type="button" onClick={() => (run.status === "paused" ? run.resume() : run.pause())}>
        {run.status === "paused" ? "Reanudar" : "Pausar"}
      </button>
      <label>
        Ritmo (ms/generación)
        <input
          type="range"
          min={0}
          max={500}
          step={10}
          defaultValue={initialSpeed}
          onChange={(e) => run.setSpeed(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

type Mode = "single" | "live-compare" | "saved-compare";

function formatRunSummary(run: RunSummary): string {
  const when = new Date(run.createdAt).toLocaleString();
  const outcome = run.endedInExtinction ? "extinta" : "sobrevivió";
  return `${when} — semilla ${run.seed} — clima ${run.config.climateChangeSpeed} — ${outcome}`;
}

interface BaseFormValues {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly mutationRate: number;
  readonly updates: number;
  readonly placementMode: RunFormValues["placementMode"];
  readonly reproducibilityMode: RunFormValues["reproducibilityMode"];
  readonly climateVarianceAmplitude: number;
  /** RF-023: ritmo inicial de reproducción — ajustable después en curso vía PlaybackControls. */
  readonly msPerGeneration: number;
}

const DEFAULT_BASE_FORM: BaseFormValues = {
  gridWidth: 20,
  gridHeight: 20,
  mutationRate: 0.05,
  updates: 1500,
  placementMode: "near-parent",
  reproducibilityMode: "reproducible",
  climateVarianceAmplitude: 0.15,
  msPerGeneration: 80,
};

/**
 * RF-008: el formulario no tiene todavía un control para numAncestors
 * (visibilizar el sembrado, no agregar la opción, era el pedido) — esto
 * mirra el default real de config-request.ts (`DEFAULTS.numAncestors`).
 * Corridas en vivo siempre piden este valor; el efectivamente sembrado
 * con clima activo es mayor (ver lib/lineage.ts, effectiveLineageCount).
 */
const DEFAULT_NUM_ANCESTORS = 1;

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
  const [mode, setMode] = useState<Mode>("single");
  const [speedSingle, setSpeedSingle] = useState<ClimateChangeSpeed>("moderate");
  const [speedA, setSpeedA] = useState<ClimateChangeSpeed>("slow");
  const [speedB, setSpeedB] = useState<ClimateChangeSpeed>("fast");

  const runSingle = useRun();
  const runA = useRun();
  const runB = useRun();

  const compareMode = mode === "live-compare";

  // RF-025: comparación de dos corridas ya guardadas, en vez de dos en vivo.
  const [savedRuns, setSavedRuns] = useState<readonly RunSummary[]>([]);
  const [savedRunsError, setSavedRunsError] = useState<string | null>(null);
  const [savedIdA, setSavedIdA] = useState<string | null>(null);
  const [savedIdB, setSavedIdB] = useState<string | null>(null);
  const historicalA = useHistoricalRun(savedIdA);
  const historicalB = useHistoricalRun(savedIdB);

  useEffect(() => {
    if (mode !== "saved-compare") {
      return;
    }
    let cancelled = false;
    listRuns(50, 0)
      .then((response) => {
        if (!cancelled) {
          setSavedRuns(response.runs);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSavedRunsError(error instanceof Error ? error.message : "Error desconocido");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === "live-compare") {
      await Promise.all([
        runA.start(toRunFormValues(base, speedA, true)),
        runB.start(toRunFormValues(base, speedB, true)),
      ]);
    } else if (mode === "single") {
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
          Modo
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="single">Una corrida</option>
            <option value="live-compare">Comparar dos corridas nuevas (en vivo)</option>
            <option value="saved-compare">Comparar dos corridas guardadas</option>
          </select>
        </label>

        {mode !== "saved-compare" && (
          <>
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
            <label>
              Ritmo de reproducción inicial (ms/generación)
              <input
                type="number"
                min={0}
                max={5000}
                step={10}
                value={base.msPerGeneration}
                onChange={(e) => setBase({ ...base, msPerGeneration: Number(e.target.value) })}
              />
            </label>

            {mode === "single" && (
              <>
                <label className="checkbox">
                  <input type="checkbox" checked={climateEnabled} onChange={(e) => setClimateEnabled(e.target.checked)} />
                  Módulo climático activo
                </label>
                {climateEnabled && (
                  <p className="form-note">
                    Con el módulo climático activo, la corrida siembra {effectiveLineageCount(DEFAULT_NUM_ANCESTORS, true)}{" "}
                    linajes ancestrales distintos desde la generación 0 (RF-008) — no un único genotipo semilla.
                  </p>
                )}
                <label>
                  Velocidad del cambio climático
                  <select
                    value={speedSingle}
                    onChange={(e) => setSpeedSingle(e.target.value as ClimateChangeSpeed)}
                    disabled={!climateEnabled}
                  >
                    {SPEED_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {mode === "live-compare" && (
              <>
                <p className="form-note">
                  El modo comparación siempre corre con el módulo climático activo — cada corrida siembra{" "}
                  {effectiveLineageCount(DEFAULT_NUM_ANCESTORS, true)} linajes ancestrales distintos desde la generación 0
                  (RF-008).
                </p>
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
              {running
                ? "Corriendo…"
                : compareMode
                  ? runA.runId || runB.runId
                    ? "Reiniciar ambas corridas"
                    : "Iniciar ambas corridas"
                  : runSingle.runId
                    ? "Reiniciar corrida"
                    : "Iniciar corrida"}
            </button>
          </>
        )}

        {mode === "saved-compare" && (
          <>
            {savedRunsError && <p className="error">{savedRunsError}</p>}
            <label>
              Corrida guardada A
              <select value={savedIdA ?? ""} onChange={(e) => setSavedIdA(e.target.value || null)}>
                <option value="">— seleccionar —</option>
                {savedRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatRunSummary(run)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corrida guardada B
              <select value={savedIdB ?? ""} onChange={(e) => setSavedIdB(e.target.value || null)}>
                <option value="">— seleccionar —</option>
                {savedRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatRunSummary(run)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </form>

      {mode === "live-compare" && (
        <div className="compare-grid">
          <div key={runA.runId ?? "A"}>
            <RunPanel
              title={`Corrida A — velocidad ${speedA}`}
              climateEnabled
              climateChangeSpeed={speedA}
              run={runA}
              gridWidth={base.gridWidth}
              gridHeight={base.gridHeight}
              numAncestors={DEFAULT_NUM_ANCESTORS}
              chartHeight={320}
            />
            <PlaybackControls run={runA} initialSpeed={base.msPerGeneration} />
          </div>
          <div key={runB.runId ?? "B"}>
            <RunPanel
              title={`Corrida B — velocidad ${speedB}`}
              climateEnabled
              climateChangeSpeed={speedB}
              run={runB}
              gridWidth={base.gridWidth}
              gridHeight={base.gridHeight}
              numAncestors={DEFAULT_NUM_ANCESTORS}
              chartHeight={320}
            />
            <PlaybackControls run={runB} initialSpeed={base.msPerGeneration} />
          </div>
        </div>
      )}

      {mode === "saved-compare" && (
        <div className="compare-grid">
          <RunPanel
            title="Corrida guardada A"
            climateEnabled={historicalA.config?.climateEnabled ?? false}
            climateChangeSpeed={historicalA.config?.climateChangeSpeed ?? "moderate"}
            run={historicalA.view}
            gridWidth={historicalA.config?.gridWidth ?? DEFAULT_BASE_FORM.gridWidth}
            gridHeight={historicalA.config?.gridHeight ?? DEFAULT_BASE_FORM.gridHeight}
            numAncestors={historicalA.config?.numAncestors ?? DEFAULT_NUM_ANCESTORS}
            chartHeight={320}
          />
          <RunPanel
            title="Corrida guardada B"
            climateEnabled={historicalB.config?.climateEnabled ?? false}
            climateChangeSpeed={historicalB.config?.climateChangeSpeed ?? "moderate"}
            run={historicalB.view}
            gridWidth={historicalB.config?.gridWidth ?? DEFAULT_BASE_FORM.gridWidth}
            gridHeight={historicalB.config?.gridHeight ?? DEFAULT_BASE_FORM.gridHeight}
            numAncestors={historicalB.config?.numAncestors ?? DEFAULT_NUM_ANCESTORS}
            chartHeight={320}
          />
        </div>
      )}

      {mode === "single" && (
        <div key={runSingle.runId ?? "single"}>
          <RunPanel
            title="Corrida"
            climateEnabled={climateEnabled}
            climateChangeSpeed={speedSingle}
            run={runSingle}
            gridWidth={base.gridWidth}
            gridHeight={base.gridHeight}
            numAncestors={DEFAULT_NUM_ANCESTORS}
          />
          <PlaybackControls run={runSingle} initialSpeed={base.msPerGeneration} />
        </div>
      )}
    </main>
  );
}
