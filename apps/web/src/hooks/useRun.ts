import { useCallback, useRef, useState } from "react";
import { connectToRunStream, createRun, type GenerationSnapshot, type RunFormValues } from "../lib/camevo-client";

export type RunStatus = "idle" | "running" | "done" | "error";

export interface RunHandle {
  readonly status: RunStatus;
  readonly runId: string | null;
  readonly snapshots: readonly GenerationSnapshot[];
  readonly errorMessage: string | null;
  readonly start: (values: RunFormValues) => Promise<void>;
}

/** Crea una corrida y acumula sus snapshots en vivo — una instancia por panel (RF-025: 1 o 2 en paralelo). */
export function useRun(): RunHandle {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<GenerationSnapshot[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const start = useCallback(async (values: RunFormValues) => {
    closeRef.current?.();
    setStatus("running");
    setErrorMessage(null);
    setSnapshots([]);
    setRunId(null);

    try {
      const { runId: newRunId } = await createRun(values);
      setRunId(newRunId);

      closeRef.current = connectToRunStream(newRunId, (message) => {
        if (message.type === "snapshot") {
          setSnapshots((prev) => [...prev, message.snapshot]);
        } else if (message.type === "done") {
          setStatus("done");
        } else if (message.type === "error") {
          setStatus("error");
          setErrorMessage(message.message);
        }
      });
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
    }
  }, []);

  return { status, runId, snapshots, errorMessage, start };
}
