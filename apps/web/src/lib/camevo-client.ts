const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export interface ResourceSupply {
  readonly taskId: string;
  readonly rewardMultiplier: number;
}

export interface GenerationSnapshot {
  readonly generation: number;
  readonly populationSize: number;
  readonly births: number;
  readonly averageFitness: number;
  readonly tasksSolvedThisUpdate: number;
  readonly climate: readonly ResourceSupply[];
}

export type LiveMessage =
  | { readonly type: "snapshot"; readonly snapshot: GenerationSnapshot }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

export interface RunFormValues {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly mutationRate: number;
  readonly updates: number;
  readonly placementMode: "near-parent" | "random";
  readonly reproducibilityMode: "reproducible" | "experimental";
  readonly climateEnabled: boolean;
}

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
