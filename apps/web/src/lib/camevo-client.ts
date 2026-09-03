import type { CreateRunRequest, LiveMessage } from "@camevo/shared-types";

export type { GenerationSnapshot, LiveMessage, ResourceSupply } from "@camevo/shared-types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

/**
 * Subconjunto de CreateRunRequest que expone el formulario mínimo de esta
 * fase — derivado del contrato compartido (no repetido a mano) para que
 * un campo renombrado en shared-types se note aquí en tiempo de
 * compilación, no en tiempo de ejecución contra la API real.
 */
export type RunFormValues = Required<
  Pick<CreateRunRequest, "gridWidth" | "gridHeight" | "mutationRate" | "updates" | "placementMode" | "reproducibilityMode" | "climateEnabled">
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

export function connectToRunStream(runId: string, onMessage: (message: LiveMessage) => void): () => void {
  const socket = new WebSocket(`${WS_BASE}/runs/${runId}/stream`);
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    onMessage(JSON.parse(event.data) as LiveMessage);
  });
  return () => socket.close();
}
