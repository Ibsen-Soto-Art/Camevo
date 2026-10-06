import type { ControlMessage, CreateRunRequest, GetRunResponse, ListRunsResponse, LiveMessage } from "@camevo/shared-types";
import { getBrowserId } from "./browser-id";

export type {
  ClimateChangeSpeed,
  ClimateTrendSource,
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
    | "climateTrendSource"
    | "catastropheEnabled"
    | "msPerGeneration"
  >
>;

export async function createRun(values: RunFormValues): Promise<{ runId: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Browser-ID": getBrowserId() },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
    throw new Error(body.errors?.join(", ") ?? `No se pudo crear la corrida (HTTP ${res.status})`);
  }
  return (await res.json()) as { runId: string };
}

/**
 * Grupo 1 (Cambio 1B): el guardado es intencional, no automático — esta es
 * la única llamada que hace que una corrida llegue a Postgres. Un click
 * repetido (doble click, F5) no es un error: el servidor responde
 * `alreadySaved: true` en vez de fallar o duplicar snapshots.
 */
export interface SaveRunResponse {
  readonly runId: string;
  readonly alreadySaved: boolean;
}

export async function saveRun(runId: string): Promise<SaveRunResponse> {
  const res = await fetch(`${API_BASE}/runs/${runId}/save`, {
    method: "POST",
    headers: { "X-Browser-ID": getBrowserId() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `No se pudo guardar la corrida (HTTP ${res.status})`);
  }
  return (await res.json()) as SaveRunResponse;
}

/** RF-023: además de cerrar, `send` manda mensajes de control (pause/resume/setSpeed) por el mismo socket ya abierto. */
export interface RunStreamHandle {
  readonly close: () => void;
  readonly send: (message: ControlMessage) => void;
}

/**
 * Cuánto espera el cliente un "ping" antes de dar la conexión por muerta.
 * El doble del intervalo del servidor (HEARTBEAT_INTERVAL_MS en
 * api/ws/live-run.ts): hacen falta DOS latidos perdidos seguidos para
 * declararla caída, lo que evita falsos positivos por una demora puntual.
 */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * RF-023 + detección de desconexión: hasta ahora el único listener era
 * "message", así que si la conexión moría a nivel TCP/WS no llegaba ningún
 * mensaje, no había handler de cierre, y la UI quedaba en "en curso" para
 * siempre — el síntoma exacto que se reportó en una corrida 40x40 que se
 * detuvo en la generación 1194.
 *
 * Ahora se escuchan también "close" y "error", y se vigila el latido. Los
 * tres casos desembocan en el mismo `{ type: "disconnected" }` sintético.
 */
export function connectToRunStream(runId: string, onMessage: (message: LiveMessage) => void): RunStreamHandle {
  const socket = new WebSocket(`${WS_BASE}/runs/${runId}/stream`);

  /*
   * Distingue el cierre NORMAL del inesperado: "close" llega también
   * después de un "done" (el servidor cierra el socket al terminar), así
   * que sin esta bandera toda corrida exitosa terminaría mostrando
   * "Conexión perdida".
   */
  let receivedDone = false;
  /** Evita emitir "disconnected" dos veces (p. ej. error seguido de close). */
  let notifiedDisconnect = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

  function clearHeartbeat() {
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  function notifyDisconnected() {
    if (receivedDone || notifiedDisconnect) return;
    notifiedDisconnect = true;
    clearHeartbeat();
    onMessage({ type: "disconnected" });
  }

  /** Se reinicia con cada latido recibido; si expira, la conexión está muerta aunque el socket siga “abierto”. */
  function armHeartbeatWatchdog() {
    clearHeartbeat();
    heartbeatTimer = setTimeout(notifyDisconnected, HEARTBEAT_TIMEOUT_MS);
  }

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as LiveMessage;

    if (message.type === "ping") {
      armHeartbeatWatchdog();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "pong" } satisfies ControlMessage));
      // El latido no es información para la UI: no se propaga hacia arriba.
      return;
    }

    if (message.type === "done" || message.type === "error") {
      receivedDone = true;
      clearHeartbeat();
    }
    onMessage(message);
  });

  socket.addEventListener("close", notifyDisconnected);
  socket.addEventListener("error", notifyDisconnected);

  return {
    close: () => {
      // Cierre pedido por el propio cliente: no es una desconexión.
      receivedDone = true;
      clearHeartbeat();
      socket.close();
    },
    send: (message) => socket.send(JSON.stringify(message)),
  };
}

/** RF-025 + Grupo 1: corridas guardadas de ESTE navegador, más recientes primero, para el selector de comparación histórica. */
export async function listRuns(limit = 50, offset = 0): Promise<ListRunsResponse> {
  const res = await fetch(`${API_BASE}/runs?limit=${limit}&offset=${offset}`, {
    headers: { "X-Browser-ID": getBrowserId() },
  });
  if (!res.ok) {
    throw new Error(`No se pudo listar las corridas guardadas (HTTP ${res.status})`);
  }
  return (await res.json()) as ListRunsResponse;
}

/**
 * RF-025: config + snapshots completos de una corrida ya guardada, para
 * comparación histórica. Grupo 1: un 403 acá significa que la corrida es
 * de OTRO navegador — se propaga el mensaje que ya manda el servidor
 * (`{error}`), no un genérico "HTTP 403", para que quien lo vea entienda
 * qué pasó en vez de ver un código sin explicación.
 */
export async function getRun(id: string): Promise<GetRunResponse> {
  const res = await fetch(`${API_BASE}/runs/${id}`, {
    headers: { "X-Browser-ID": getBrowserId() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `No se pudo cargar la corrida ${id} (HTTP ${res.status})`);
  }
  return (await res.json()) as GetRunResponse;
}

/** RF-027: detalle de un organismo puntual — solo disponible mientras la corrida sigue en vivo en el servidor (ver docs/03-arquitectura.md §4.1). */
export interface OrganismDetail {
  readonly generation: number;
  readonly x: number;
  readonly y: number;
  readonly fitness: number;
  readonly tasksSolved: readonly string[];
}

/**
 * El servidor ya devuelve el mensaje final en español para los dos casos
 * de 404 (corrida no activa / organismo puntual ya no existe) — se
 * propaga tal cual, no se reinterpreta acá, para no duplicar ese texto
 * en dos lugares que podrían desalinearse.
 */
export async function getOrganismDetail(runId: string, organismId: string): Promise<OrganismDetail> {
  const res = await fetch(`${API_BASE}/runs/${runId}/organisms/${organismId}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `No se pudo obtener el detalle del organismo (HTTP ${res.status})`);
  }
  return (await res.json()) as OrganismDetail;
}
