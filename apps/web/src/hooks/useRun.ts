import { useCallback, useRef, useState } from "react";
import { connectToRunStream, createRun, type GenerationSnapshot, type RunFormValues, type RunStreamHandle } from "../lib/camevo-client";

export type RunStatus = "idle" | "running" | "paused" | "done" | "error";

/**
 * Forma mínima que necesita RunPanel para renderizar una corrida — sin el
 * método `start`, que solo tiene sentido para una corrida en vivo. RF-025:
 * useHistoricalRun expone esta misma forma (con status ya en "done" desde
 * el primer render) para reusar RunPanel/ExplanatoryPanel sin duplicar la
 * lógica de narración entre comparación en vivo e histórica.
 */
export interface RunView {
  readonly status: RunStatus;
  readonly runId: string | null;
  readonly snapshots: readonly GenerationSnapshot[];
  readonly errorMessage: string | null;
}

export interface RunHandle extends RunView {
  readonly start: (values: RunFormValues) => Promise<void>;
  /** RF-023: solo tiene efecto mientras status === "running". */
  readonly pause: () => void;
  /** RF-023: solo tiene efecto mientras status === "paused". */
  readonly resume: () => void;
  /** RF-023: ajusta el ritmo de una corrida ya en curso (running o paused). */
  readonly setSpeed: (msPerGeneration: number) => void;
}

/** Crea una corrida y acumula sus snapshots en vivo — una instancia por panel (RF-025: 1 o 2 en paralelo). */
export function useRun(): RunHandle {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<GenerationSnapshot[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const statusRef = useRef<RunStatus>("idle");
  const streamRef = useRef<RunStreamHandle | null>(null);

  const updateStatus = useCallback((next: RunStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const start = useCallback(
    async (values: RunFormValues) => {
      streamRef.current?.close();
      updateStatus("running");
      setErrorMessage(null);
      setSnapshots([]);
      setRunId(null);

      try {
        const { runId: newRunId } = await createRun(values);
        setRunId(newRunId);

        streamRef.current = connectToRunStream(newRunId, (message) => {
          if (message.type === "snapshot") {
            setSnapshots((prev) => [...prev, message.snapshot]);
          } else if (message.type === "done") {
            updateStatus("done");
          } else if (message.type === "error") {
            updateStatus("error");
            setErrorMessage(message.message);
          }
        });
      } catch (error) {
        updateStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
      }
    },
    [updateStatus],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== "running") return;
    streamRef.current?.send({ type: "pause" });
    updateStatus("paused");
  }, [updateStatus]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    streamRef.current?.send({ type: "resume" });
    updateStatus("running");
  }, [updateStatus]);

  const setSpeed = useCallback((msPerGeneration: number) => {
    streamRef.current?.send({ type: "setSpeed", msPerGeneration });
  }, []);

  return { status, runId, snapshots, errorMessage, start, pause, resume, setSpeed };
}
