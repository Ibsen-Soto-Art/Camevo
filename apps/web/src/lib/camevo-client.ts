import type { ControlMessage, CreateRunRequest, GetRunResponse, ListRunsResponse, LiveMessage } from "@camevo/shared-types";

export type {
  ClimateChangeSpeed,
  ControlMessage,
  GenerationSnapshot,
  GetRunResponse,
  ListRunsResponse,
  LiveMessage,
  PersistedRunConfig,
  ResourceSupply,
  RunMetadata,
  RunSummary,
} from "@camevo/shared-types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

/**
 * Subconjunto de CreateRunRequest que expone el formulario mínimo de esta
 * fase — derivado del contrato compartido (no repetido a mano) para que
 * un campo renombrado en shared-types se note aquí en tiempo de
 * compilación, no en tiempo de ejecución contra la API real.
 */
export type RunFormValues = Required<
  Pick<
    CreateRunRequest,
    | "gridWidth"
    | "gridHeight"
    | "mutationRate"
    | "updates"
    | "placementMode"
    | "reproducibilityMode"
    | "climateEnabled"
    | "climateChangeSpeed"
    | "climateVarianceAmplitude"
    | "msPerGeneration"
  >
>;

export async function createRun(values: RunFormValues): Promise<{ runId: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
    throw new Error(body.errors?.join(", ") ?? `No se pudo crear la corrida (HTTP ${res.status})`);
  }
  return (await res.json()) as { runId: string };
}

/** RF-023: además de cerrar, `send` manda mensajes de control (pause/resume/setSpeed) por el mismo socket ya abierto. */
export interface RunStreamHandle {
  readonly close: () => void;
  readonly send: (message: ControlMessage) => void;
}

export function connectToRunStream(runId: string, onMessage: (message: LiveMessage) => void): RunStreamHandle {
  const socket = new WebSocket(`${WS_BASE}/runs/${runId}/stream`);
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    onMessage(JSON.parse(event.data) as LiveMessage);
  });
  return {
    close: () => socket.close(),
    send: (message) => socket.send(JSON.stringify(message)),
  };
}

/** RF-025: corridas guardadas más recientes primero, para el selector de comparación histórica. */
export async function listRuns(limit = 50, offset = 0): Promise<ListRunsResponse> {
  const res = await fetch(`${API_BASE}/runs?limit=${limit}&offset=${offset}`);
  if (!res.ok) {
    throw new Error(`No se pudo listar las corridas guardadas (HTTP ${res.status})`);
  }
  return (await res.json()) as ListRunsResponse;
}

/** RF-025: config + snapshots completos de una corrida ya guardada, para comparación histórica. */
export async function getRun(id: string): Promise<GetRunResponse> {
  const res = await fetch(`${API_BASE}/runs/${id}`);
  if (!res.ok) {
    throw new Error(`No se pudo cargar la corrida ${id} (HTTP ${res.status})`);
  }
  return (await res.json()) as GetRunResponse;
}
