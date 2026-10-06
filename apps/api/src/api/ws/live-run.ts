import type { LiveMessage } from "@camevo/shared-types";
import type { WebSocket } from "ws";
import { LiveRunRegistry } from "../live-run-registry";
import { SimulationConfig, advanceGeneration, createSimulationState } from "../../simulation/orchestrator/run";
import { PlaybackControl } from "./playback-control";

export type { LiveMessage };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Avanza una corrida generación a generación, con una pausa entre cada
 * una, transmitiendo cada snapshot por el socket y persistiéndolo — así
 * el streaming es perceptible en tiempo real (docs/03-arquitectura.md,
 * flujo de datos) en vez de recibirse todo de golpe al terminar.
 *
 * Simplificación deliberada de esta fase: cada conexión WS conduce su
 * propia ejecución desde la generación 0 (no hay reanudar-donde-quedó ni
 * múltiples espectadores compartiendo una corrida en curso) — coherente
 * con el supuesto de bajo volumen de usuarios concurrentes de
 * 02-requisitos.md §4.
 *
 * Fase 4: si la población se extingue (`snapshot.extinct`), el loop
 * corta ahí mismo — igual que `runSimulation` — en vez de seguir
 * transmitiendo generaciones vacías hasta `config.updates`. El socket
 * cierra igual con el mensaje "done" normal: la razón del corte ya es
 * explícita en el último snapshot recibido (`extinct: true`), no hace
 * falta un tipo de mensaje aparte.
 *
 * RF-023: `control.waitIfPaused()` se consulta ANTES de llamar a
 * `advanceGeneration` en cada vuelta — mientras está pausado, el motor
 * literalmente no avanza (ver playback-control.ts para la garantía de
 * determinismo). El chequeo de `closed` se repite después de esperar,
 * por si el socket se cerró mientras estaba pausado.
 *
 * Grupo 1 (guardado intencional, identidad por navegador): esta función
 * YA NO escribe a Postgres en absoluto — antes (Fase 5) guardaba cada
 * snapshot automáticamente generación a generación (con un fix de
 * causalidad confirmada para que esa escritura no bloqueara el envío;
 * ver el historial en docs/04-roadmap-fases.md). Ese mecanismo entero
 * dejó de existir, no solo se optimizó: las corridas ya no se persisten
 * solas, solo cuando el usuario hace click en "Guardar esta corrida"
 * (`POST /runs/:id/save`, ver api/rest/app.ts). Acá, cada snapshot se
 * acumula en el `LiveRunRegistry` (memoria, barato) en vez de escribirse
 * a la base — `registry.appendSnapshot` reemplaza a `repository.saveSnapshot`.
 *
 * `registry.attachState(runId, state)` expone el `SimulationState` en
 * vivo (con el genoma y `tasksSolved` reales de cada organismo, que
 * nunca se persisten ni viajan por WS — ver RF-027 en live-run-registry.ts)
 * para que `api/rest` pueda servir el detalle de un organismo bajo
 * demanda. `registry.markFinished(runId)` en el `finally` es la garantía
 * real: sin importar CÓMO termine esta función (corrida completa,
 * extinción, socket cerrado a mitad de camino, una excepción), queda
 * registrado que el streaming terminó — desde ahí arranca el reloj de
 * limpieza si nadie guarda la corrida (ver el TTL en live-run-registry.ts).
 */
/** 30s: por debajo de los cortes por inactividad habituales (~60s) y con margen para perder un latido antes de que el cliente, que espera el doble, declare la conexión muerta. */
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function streamRunLive(
  runId: string,
  config: SimulationConfig,
  socket: WebSocket,
  control: PlaybackControl,
  registry: LiveRunRegistry,
): Promise<void> {
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });

  const state = createSimulationState(config);
  registry.attachState(runId, state);

  /*
   * Latido cada HEARTBEAT_INTERVAL_MS, independiente del bucle de
   * generaciones: sigue latiendo mientras la corrida está PAUSADA, que es
   * el único momento en que no hay ningún otro tráfico y un intermediario
   * puede cortar por inactividad. Mientras transmite, los snapshots ya son
   * tráfico de sobra — el ping es irrelevante ahí (un frame cada 30s
   * contra ~12 snapshots por segundo).
   *
   * Es un mensaje de aplicación, no `socket.ping()` del protocolo: la API
   * WebSocket del navegador no expone los pings de protocolo a JavaScript,
   * así que el cliente no podría detectar su ausencia.
   */
  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      const ping: LiveMessage = { type: "ping" };
      socket.send(JSON.stringify(ping));
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    for (let i = 0; i < config.updates && !closed; i++) {
      await control.waitIfPaused();
      if (closed) break;

      const snapshot = advanceGeneration(state);
      /*
       * Se retiene el snapshot SERIALIZADO, no el objeto: medido en una
       * corrida 40x40 x 1500, el registro pasa de 162 MB a 98 MB de heap
       * retenido (-40%). El array de `organisms` es el 99% de ese peso —
       * 1600 organismos por 1500 generaciones son 2.4 millones de objetos.
       *
       * El mismo string se reusa para el envío, concatenado dentro del
       * sobre del mensaje en vez de volver a serializar los 68 KB. (No
       * había doble serialización antes de este cambio: había una sola, y
       * la ganancia es de memoria, no de CPU.)
       */
      const snapshotJson = JSON.stringify(snapshot);
      registry.appendSnapshot(runId, snapshotJson);

      if (socket.readyState === socket.OPEN) {
        socket.send(`{"type":"snapshot","snapshot":${snapshotJson}}`);
      }

      if (snapshot.extinct) break;

      await sleep(control.msPerGeneration);
    }

    if (!closed && socket.readyState === socket.OPEN) {
      const message: LiveMessage = { type: "done" };
      socket.send(JSON.stringify(message));
      socket.close();
    }
  } finally {
    clearInterval(heartbeat);
    registry.markFinished(runId);
  }
}
