import { useEffect, useState } from "react";
import { getRun, type PersistedRunConfig } from "../lib/camevo-client";
import type { RunView } from "./useRun";

export interface HistoricalRunHandle {
  readonly view: RunView;
  /** null mientras status="idle" (nada seleccionado) o "running" (todavía cargando). */
  readonly config: PersistedRunConfig | null;
}

/**
 * RF-025: carga de una sola vez el config + snapshots completos de una
 * corrida ya guardada (vía GET /runs/:id) y los expone como un RunView, para
 * reusar RunPanel/ExplanatoryPanel sin duplicar su lógica de narración entre
 * comparación en vivo (streaming, useRun) e histórica (estática, aquí).
 * Confirmado con test (RunPanel.test.tsx) que esa lógica es una función pura
 * del array de snapshots, sin estado interno acumulado, así que entregarlo
 * completo de una sola vez en el primer render funciona igual que en vivo.
 */
export function useHistoricalRun(runId: string | null): HistoricalRunHandle {
  const [view, setView] = useState<RunView>({ status: "idle", runId: null, snapshots: [], errorMessage: null });
  const [config, setConfig] = useState<PersistedRunConfig | null>(null);

  useEffect(() => {
    if (!runId) {
      setView({ status: "idle", runId: null, snapshots: [], errorMessage: null });
      setConfig(null);
      return;
    }

    let cancelled = false;
    setView({ status: "running", runId, snapshots: [], errorMessage: null });
    setConfig(null);

    getRun(runId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setView({ status: "done", runId, snapshots: response.snapshots, errorMessage: null });
        setConfig(response.run.config);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setView({
          status: "error",
          runId,
          snapshots: [],
          errorMessage: error instanceof Error ? error.message : "Error desconocido",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { view, config };
}
