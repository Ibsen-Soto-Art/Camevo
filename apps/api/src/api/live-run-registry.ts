import type { GenerationSnapshot, PersistedRunConfig } from "@camevo/shared-types";
import type { SimulationState } from "../simulation/orchestrator/run";

/**
 * Grupo 1 (guardado intencional) + RF-027 (detalle de organismo en vivo):
 * puente entre `api/ws` (dueño del `SimulationState` mientras una corrida
 * transmite en vivo) y `api/rest` (que lo lee bajo demanda, tanto para el
 * click-to-inspect de RF-027 como para el botón "Guardar esta corrida").
 * Módulo hoja a propósito — no importa nada de `api/ws` ni de `api/rest`,
 * así que ninguno de los dos depende del otro: `api/server.ts` crea una
 * sola instancia y se la inyecta a ambos, el mismo patrón que ya se usa
 * con `RunRepository`.
 *
 * Ciclo de vida de una entrada, ahora con tres etapas (antes RF-027 solo
 * tenía la del medio):
 * 1. "pending" — `POST /runs` la crea, con el browserId y la config ya
 *    resueltos, pero SIN `state` todavía (el streaming no arrancó). El
 *    handshake de WS la busca acá en vez de `repository.getRun` — ya no
 *    hay ninguna escritura a Postgres en este punto (Cambio 1B: el
 *    guardado es intencional, no automático).
 * 2. "en vivo" — `attachState` la completa cuando `streamRunLive` arranca
 *    el loop; `appendSnapshot` acumula cada generación según se calcula,
 *    para que exista algo que persistir si el usuario decide guardar
 *    después. Mientras `finishedAt` es null, la entrada NUNCA se limpia
 *    por TTL, sin importar cuánto dure la corrida.
 * 3. "terminada, sin guardar" — `markFinished` se llama una sola vez, al
 *    salir del loop de streaming (por cualquier motivo: corrida
 *    completa, extinción, socket cerrado a mitad de camino). Recién ACÁ
 *    arranca el reloj de limpieza (`FINISHED_RUN_TTL_MS`): si nadie hace
 *    click en "Guardar" antes de que venza, se libera la memoria sola.
 *    `markSaved` no borra la entrada de inmediato — un segundo click en
 *    "Guardar" (doble click, F5 antes de que actualice el estado) debe
 *    dar una respuesta clara de "ya estaba guardada", no un 404
 *    confuso — la limpieza por TTL se encarga de liberarla más tarde
 *    igual.
 *
 * Un `Map` en memoria no sobrevive un reinicio del servidor (pasa en
 * cada deploy): eso sigue siendo intencional, no un olvido — una corrida
 * de una vida anterior del proceso simplemente no está, sin necesitar
 * código especial para detectar "el servidor se reinició". El botón
 * "Guardar" de una corrida así falla con un mensaje explícito, nunca en
 * silencio (ver api/rest/app.ts).
 *
 * Límite conocido, aceptado por ahora (no resuelto acá): no hay un tope
 * al número de generaciones retenidas para guardar. En el peor caso
 * teórico permitido por RNF-008 (grilla 40x40, 5000 generaciones), el
 * array de snapshots de una sola corrida podría llegar a varios cientos
 * de MB — muy por encima de lo que un uso real típico genera (RNF-001:
 * 200-500 organismos, updates por default 300-1500), pero un caso límite
 * real en un VPS compartido de ~1.9GB de RAM. Se documenta como riesgo
 * conocido en vez de truncar snapshots en silencio (lo que produciría un
 * guardado incompleto sin avisar) — si se vuelve un problema real, la
 * solución es un tope explícito con un error claro al usuario, no un
 * truncamiento silencioso.
 */
export interface LiveRunEntry {
  readonly browserId: string;
  readonly persistedConfig: PersistedRunConfig;
  state: SimulationState | null;
  readonly snapshots: GenerationSnapshot[];
  saved: boolean;
  finishedAt: number | null;
}

export interface LiveRunRegistry {
  createPending(runId: string, browserId: string, persistedConfig: PersistedRunConfig): void;
  attachState(runId: string, state: SimulationState): void;
  appendSnapshot(runId: string, snapshot: GenerationSnapshot): void;
  markFinished(runId: string): void;
  markSaved(runId: string): void;
  get(runId: string): LiveRunEntry | undefined;
  /** Liberación explícita, sin esperar el TTL — no la usa ninguna ruta hoy, pero queda disponible (p. ej. para tests) en vez de forzar un id único como única forma de aislar casos. */
  remove(runId: string): void;
}

/** Cuánto se retiene una corrida YA TERMINADA sin guardar, antes de liberarse sola. */
const FINISHED_RUN_TTL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function createLiveRunRegistry(): LiveRunRegistry {
  const runs = new Map<string, LiveRunEntry>();

  // Nunca toca una entrada con finishedAt === null (streaming activo) sin
  // importar su antigüedad — solo barre corridas ya terminadas y sin
  // guardar que superaron el TTL. `.unref()` para que este timer de
  // fondo no le impida a Node salir solo (relevante en tests).
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [runId, entry] of runs) {
      if (entry.finishedAt !== null && now - entry.finishedAt > FINISHED_RUN_TTL_MS) {
        runs.delete(runId);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref?.();

  return {
    createPending(runId, browserId, persistedConfig) {
      runs.set(runId, { browserId, persistedConfig, state: null, snapshots: [], saved: false, finishedAt: null });
    },
    attachState(runId, state) {
      const entry = runs.get(runId);
      if (entry) entry.state = state;
    },
    appendSnapshot(runId, snapshot) {
      runs.get(runId)?.snapshots.push(snapshot);
    },
    markFinished(runId) {
      const entry = runs.get(runId);
      if (entry) entry.finishedAt = Date.now();
    },
    markSaved(runId) {
      const entry = runs.get(runId);
      if (entry) entry.saved = true;
    },
    get(runId) {
      return runs.get(runId);
    },
    remove(runId) {
      runs.delete(runId);
    },
  };
}
