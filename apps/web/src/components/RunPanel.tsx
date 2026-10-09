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
  /**
   * Divide el contenido en pestañas "Gráfica" / "Población". Solo el modo
   * "Una corrida" las usa: en los dos modos de comparación hay dos paneles
   * lado a lado y partir cada uno en pestañas multiplicaría los clicks sin
   * resolver el scroll, que ahí ya está acotado por `chartHeight={320}`.
   */
  readonly tabbed?: boolean;
}

type PanelTab = "chart" | "population";

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
  tabbed = false,
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
  const [activeTab, setActiveTab] = useState<PanelTab>("chart");

  const hasSnapshots = run.snapshots.length > 0;
  /*
   * Las pestañas aparecen solo cuando hay algo que repartir: sin snapshots
   * la grilla no existe (nunca se montó), así que "Población" sería una
   * pestaña vacía en la que el usuario puede hacer click para no encontrar
   * nada. Hasta entonces el gráfico vacío se muestra suelto, como siempre.
   */
  const showTabs = tabbed && hasSnapshots;

  /*
   * La pestaña INACTIVA sale del flujo (`position: absolute`) pero sigue
   * montada y medible: `opacity: 0` no afecta al layout, así que el
   * ResizeObserver de PopulationGrid y el ResponsiveContainer de RunChart
   * siguen viendo su ancho real. Medido en navegador: con la grilla oculta,
   * un hover sobre el gráfico igual actualiza su generación interna, y al
   * revelarla ya muestra la correcta sin volver a pasar el mouse.
   *
   * `inert` acompaña a `opacity: 0` porque esa propiedad NO saca el
   * contenido del orden de tabulación ni del árbol de accesibilidad — sin
   * esto, los ítems de la leyenda (`tabIndex={0}`) y el botón de guardar
   * de la pestaña oculta seguirían siendo alcanzables con Tab, invisibles.
   */
  const panelProps = (tab: PanelTab) =>
    showTabs
      ? {
          role: "tabpanel" as const,
          id: `run-panel-${tab}`,
          "aria-labelledby": `run-tab-${tab}`,
          className: activeTab === tab ? "run-tabpanel" : "run-tabpanel run-tabpanel-inactive",
          inert: activeTab !== tab,
        }
      : { className: "run-tabpanel" };

  /*
   * Grupo 2 (layout aprobado): "Guardar esta corrida" cierra la narrativa
   * — después de que el usuario ya vio el gráfico y la explicación del
   * resultado, no antes. Con pestañas eso lo ubica al final de "Gráfica",
   * que es donde vive esa narrativa; se extrae a una variable para no
   * duplicar el bloque entre el modo con y sin pestañas.
   */
  const saveBlock =
    onSave && run.status === "done" ? (
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
    ) : null;

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
      {/*
        El estado de la corrida queda SIEMPRE fuera de las pestañas, y
        `.error` por una razón concreta: es por donde sale "Conexión
        perdida" (v0.24.0). Si viviera en una pestaña, alguien mirando la
        otra no se enteraría de que se cortó el WebSocket.
      */}
      {run.errorMessage && <p className="error">{run.errorMessage}</p>}

      {showTabs && (
        <div className="run-tabs" role="tablist" aria-label="Vistas de la corrida">
          {([
            ["chart", "Gráfica"],
            ["population", "Población"],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              id={`run-tab-${tab}`}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`run-panel-${tab}`}
              className={activeTab === tab ? "run-tab run-tab-active" : "run-tab"}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className={showTabs ? "run-tabpanels" : undefined}>
        <div {...panelProps("chart")}>
          <div className="chart-container">
            <RunChart snapshots={run.snapshots} height={chartHeight} onHoverGeneration={setHoveredGeneration} />
          </div>
          {hasSnapshots && (
            <ExplanatoryPanel
              climateEnabled={climateEnabled}
              climateChangeSpeed={climateChangeSpeed}
              snapshots={run.snapshots}
              numAncestors={numAncestors}
              isRunning={run.status === "running"}
            />
          )}
          {saveBlock}
        </div>

        {hasSnapshots && (
          <div {...panelProps("population")}>
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
          </div>
        )}
      </div>
    </div>
  );
}
