import type { SimulationState } from "../simulation/orchestrator/run";

/**
 * RF-027: puente entre `api/ws` (dueño del `SimulationState` mientras una
 * corrida transmite en vivo) y `api/rest` (que necesita leerlo bajo demanda
 * para el detalle de un organismo al hacer click). Módulo hoja a propósito
 * — no importa nada de `api/ws` ni de `api/rest`, así que ninguno de los
 * dos depende del otro: `api/server.ts` crea una sola instancia y se la
 * inyecta a ambos, el mismo patrón que ya se usa con `RunRepository`.
 *
 * Guarda una REFERENCIA al `SimulationState` en curso, no una copia
 * derivada: `state.grid` se muta in-place en cada generación
 * (`advanceGeneration`), así que leerlo más tarde siempre refleja el
 * estado actual sin necesidad de reescribir el registro generación a
 * generación.
 *
 * Deliberadamente solo cubre corridas EN VIVO (mientras `streamRunLive`
 * sigue corriendo) — no corridas guardadas (RF-025) ni generaciones
 * pasadas de una corrida ya terminada. Un `Map` en memoria no sobrevive
 * un reinicio del servidor (pasa en cada deploy): eso es intencional, no
 * un olvido — un proceso nuevo arranca con el registro vacío, así que una
 * corrida de una vida anterior del proceso simplemente no está, sin
 * necesitar código especial para detectar "el servidor se reinició".
 */
export interface LiveRunRegistry {
  register(runId: string, state: SimulationState): void;
  unregister(runId: string): void;
  get(runId: string): SimulationState | undefined;
}

export function createLiveRunRegistry(): LiveRunRegistry {
  const runs = new Map<string, SimulationState>();
  return {
    register(runId, state) {
      runs.set(runId, state);
    },
    unregister(runId) {
      runs.delete(runId);
    },
    get(runId) {
      return runs.get(runId);
    },
  };
}
