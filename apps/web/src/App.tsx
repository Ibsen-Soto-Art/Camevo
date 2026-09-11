import { useEffect, useState, type FormEvent } from "react";
import "./App.css";
import RunPanel from "./components/RunPanel";
import { useHistoricalRun } from "./hooks/useHistoricalRun";
import { useRun, type RunHandle } from "./hooks/useRun";
import { listRuns, type ClimateChangeSpeed, type ClimateTrendSource, type RunFormValues, type RunSummary } from "./lib/camevo-client";
import { effectiveLineageCount } from "./lib/lineage";

/**
 * RF-023: pausar/reanudar y ajustar el ritmo de una corrida ya en curso —
 * no aplica a corridas guardadas (ya terminadas). `initialSpeed` alimenta
 * el `defaultValue` del slider; el llamador debe pasar `key={run.runId}`
 * para que una corrida nueva no herede la posición del slider de la
 * anterior. `label` identifica de cuál corrida es el control cuando hay
 * más de una visible a la vez (modo comparación en vivo).
 */
function PlaybackControls({ run, initialSpeed, label }: { readonly run: RunHandle; readonly initialSpeed: number; readonly label?: string }) {
  if (run.status !== "running" && run.status !== "paused") {
    return null;
  }
  return (
    <div className="playback-controls">
      {label && <h3>{label}</h3>}
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
  /** Fase 6: curva sintética (default) o anclada a datos reales de NASA GISTEMP. */
  readonly climateTrendSource: ClimateTrendSource;
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
  climateTrendSource: "synthetic",
  msPerGeneration: 80,
};

/**
 * Fase 6 (RNF-004): en vez de que un usuario sin conocimientos previos
 * llegue a un formulario vacío, tres escenarios con narrativa en lenguaje
 * de divulgación autocompletan velocidad climática + modo de
 * repetibilidad — el resto de los campos queda en su default ya validado
 * (Fases 3/4, ver config-request.ts). No son modos nuevos: son solo
 * presets sobre el mismo formulario, editable después de elegir uno.
 *
 * "El punto de quiebre" usa `reproducibilityMode: "experimental"` (semilla
 * aleatoria) a propósito, a diferencia de los otros dos: la velocidad
 * "moderate" es justo la que la Fase 3 midió en el límite entre rescate y
 * estancamiento (fitness tardío/temprano ≈1.01-1.03) — el punto es que el
 * resultado varíe de corrida en corrida, no que sea reproducible.
 */
interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly narrative: string;
  readonly speed: ClimateChangeSpeed;
  readonly reproducibilityMode: BaseFormValues["reproducibilityMode"];
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "rescue",
    name: "¿Puede la vida adaptarse?",
    narrative:
      "Vas a ver una población de organismos digitales enfrentar un cambio climático LENTO: el entorno cambia, pero da tiempo. " +
      "Prestá atención al gráfico de fitness — si sube con las generaciones, eso es rescate evolutivo: la selección natural " +
      "encontró, dentro de la variación genética que la población ya tenía, a los mejor adaptados al nuevo clima.",
    speed: "slow",
    reproducibilityMode: "reproducible",
  },
  {
    id: "collapse",
    name: "Cambio climático acelerado",
    narrative:
      "Misma población, mismas reglas — pero ahora el clima cambia RÁPIDO. El fitness deja de mejorar y, en algún punto, la " +
      "población entra en deuda de extinción (se debilita generación tras generación) hasta colapsar. No es que la selección " +
      "natural 'falle': es que no le da tiempo de actuar antes de que el entorno vuelva a cambiar.",
    speed: "fast",
    reproducibilityMode: "reproducible",
  },
  {
    id: "tipping-point",
    name: "El punto de quiebre",
    narrative:
      "Esta es la velocidad más interesante: ni tan lenta como para garantizar adaptación, ni tan rápida como para garantizar " +
      "colapso. Es el punto donde el resultado depende de la suerte de esta corrida en particular — probá iniciarla varias " +
      "veces y vas a ver que no siempre termina igual. Esa incertidumbre no es un defecto del simulador: es real.",
    speed: "moderate",
    reproducibilityMode: "experimental",
  },
];

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
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const selectedScenario = SCENARIOS.find((s) => s.id === selectedScenarioId) ?? null;

  function applyScenario(scenario: Scenario) {
    setBase({ ...base, reproducibilityMode: scenario.reproducibilityMode });
    setSpeedSingle(scenario.speed);
    setClimateEnabled(true);
    setSelectedScenarioId(scenario.id);
  }

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

  // RF-023/rediseño responsive: el formulario colapsa solo la PRIMERA vez
  // que arranca una corrida, o (RNF-004, re-auditoría) apenas se elige un
  // escenario preconfigurado — no son booleanos de estado nuevos, es un
  // `key` derivado de ambas cosas. Al cambiar de "sin corrida"/"sin
  // preset" a "con corrida" o "con preset", React remonta el <details>
  // con `open` inicial recalculado; con la misma key en renders
  // posteriores, `open` nunca vuelve a cambiar de valor, así que el
  // usuario controla el toggle libremente sin que React le pelee los
  // clicks (no hay riesgo de "fight" entre React y el DOM nativo porque
  // nunca reafirmamos un `open` distinto sin también cambiar la key). En
  // modo comparación no hay presets, así que ese key/open sigue exactamente
  // como antes.
  const singleConfigOpen = !runSingle.runId && !selectedScenarioId;
  const configStartedKey = compareMode
    ? String(Boolean(runA.runId || runB.runId))
    : `${String(Boolean(runSingle.runId))}-${selectedScenarioId ?? "custom"}`;

  return (
    <main className="camevo-app">
      <h1>Camevo</h1>
      {/*
        RNF-004 (re-auditoría): "rescate evolutivo" y "deuda de extinción" ya
        aparecen con contexto en el panel explicativo después de la corrida
        — no hacía falta repetirlos acá, sin explicación, en lo primero que
        lee un visitante nuevo. Este subtítulo describe la ACCIÓN en
        lenguaje llano; los términos técnicos se ganan su lugar más
        adelante, cuando ya hay una corrida real que los sostiene.
      */}
      <p className="subtitle">
        Controlá qué tan rápido cambia el clima y observá si la vida logra adaptarse — o si el cambio llega demasiado
        rápido.
      </p>

      <div className="mode-select">
        <label>
          Modo
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="single">Una corrida</option>
            <option value="live-compare">Comparar dos corridas nuevas (en vivo)</option>
            <option value="saved-compare">Comparar dos corridas guardadas</option>
          </select>
        </label>
      </div>

      {mode === "single" && (
        <div className="scenario-picker">
          <p className="form-note">
            Si no sabés por dónde empezar, elegí uno de estos tres escenarios — cada uno autocompleta la configuración y te
            explica qué vas a ver y por qué importa. Podés seguir ajustando cualquier valor después.
          </p>
          <div className="scenario-cards">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={`scenario-card${scenario.id === selectedScenarioId ? " selected" : ""}`}
                onClick={() => applyScenario(scenario)}
              >
                {scenario.name}
              </button>
            ))}
          </div>
          {selectedScenario && <p className="scenario-narrative">{selectedScenario.narrative}</p>}
        </div>
      )}

      {mode === "saved-compare" ? (
        <>
          <div className="saved-compare-header">
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
          </div>

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
        </>
      ) : (
        <div className="app-layout">
          <div className="controls-column">
            <details
              className="config-details"
              key={configStartedKey}
              open={compareMode ? !(runA.runId || runB.runId) : singleConfigOpen}
            >
              <summary>Configuración de la corrida</summary>
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
                    onChange={(e) =>
                      setBase({ ...base, reproducibilityMode: e.target.value as BaseFormValues["reproducibilityMode"] })
                    }
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
                      <input
                        type="checkbox"
                        checked={climateEnabled}
                        onChange={(e) => {
                          setClimateEnabled(e.target.checked);
                          setSelectedScenarioId(null);
                        }}
                      />
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
                        onChange={(e) => {
                          setSpeedSingle(e.target.value as ClimateChangeSpeed);
                          setSelectedScenarioId(null);
                        }}
                        disabled={!climateEnabled}
                      >
                        {SPEED_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Fuente de la tendencia climática
                      <select
                        value={base.climateTrendSource}
                        onChange={(e) => setBase({ ...base, climateTrendSource: e.target.value as ClimateTrendSource })}
                        disabled={!climateEnabled}
                      >
                        <option value="synthetic">Sintética (onda paramétrica)</option>
                        <option value="historical">Datos reales (NASA GISTEMP, 1880-2025)</option>
                      </select>
                    </label>
                    {climateEnabled && base.climateTrendSource === "historical" && (
                      <p className="form-note">
                        La curva sigue la anomalía de temperatura global real medida por NASA GISTEMP — incluida la
                        aceleración del calentamiento desde ~1980. En este modo, todas las tareas comparten la misma curva
                        (con datos reales solo existe un clima, no uno distinto por tarea).
                      </p>
                    )}
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
              </form>
            </details>

            {compareMode ? (
              <>
                <PlaybackControls key={runA.runId ?? "A"} run={runA} initialSpeed={base.msPerGeneration} label="Corrida A" />
                <PlaybackControls key={runB.runId ?? "B"} run={runB} initialSpeed={base.msPerGeneration} label="Corrida B" />
              </>
            ) : (
              <PlaybackControls key={runSingle.runId ?? "single"} run={runSingle} initialSpeed={base.msPerGeneration} />
            )}
          </div>

          <div className="content-column">
            {compareMode ? (
              <div className="compare-grid">
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
              </div>
            ) : (
              <RunPanel
                title="Corrida"
                climateEnabled={climateEnabled}
                climateChangeSpeed={speedSingle}
                run={runSingle}
                gridWidth={base.gridWidth}
                gridHeight={base.gridHeight}
                numAncestors={DEFAULT_NUM_ANCESTORS}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
