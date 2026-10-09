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

/**
 * Tope del buffer de salida del socket antes de empezar a saltear envíos.
 *
 * 256 KB son ~4 snapshots de una grilla 40x40 (66,1 KB cada uno, medido), o
 * ~15 de una 20x20 (16,9 KB). Es la cota del atraso que puede acumular la
 * vista en vivo: a los 166 KB/s que mide un enlace congestionado, drenar 256
 * KB toma ~1,5s, muy por debajo del timeout de 60s del watchdog del cliente.
 *
 * El problema que esto resuelve: el `ping` del heartbeat viaja por el MISMO
 * stream TCP ordenado que los snapshots, así que queda bloqueado detrás de
 * cualquier atraso. Sin este tope el atraso no está acotado — reproducido
 * contra producción con grilla 40x40 y enlace de 2 Mbps: el servidor ofrece
 * 6,8 Mbps a ritmo 80ms, el cliente recibió 428 de 1500 snapshots, de los 5
 * pings enviados llegó UNO solo, y el watchdog declaró "Conexión perdida"
 * sobre una conexión viva mientras ~71 MB esperaban en el buffer. Subir el
 * timeout del cliente no arregla eso: el atraso crece mientras el servidor
 * produzca más rápido de lo que el enlace entrega.
 */
const BACKPRESSURE_HIGH_WATER_MARK = 256 * 1024;

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

  /** Estado del log de congestión: se reporta la transición, no cada snapshot. */
  let congested = false;
  let skippedWhileCongested = 0;
  let skippedTotal = 0;

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

      /*
       * Generaciones que se envían SIEMPRE, sin importar el buffer: las que
       * el usuario no puede reconstruir si se las saltea.
       *
       * - `catastropheOccurred`: es el evento puntual de RF-015, y el
       *   marcador de la gráfica y el destello de la grilla dependen de que
       *   ese snapshot exista del lado del cliente. Ocurre cada 10/60/150
       *   generaciones según la velocidad, así que en el peor caso (Rápida)
       *   fuerza el 10% de los envíos — no desarma el backpressure.
       * - `extinct`: el loop corta justo después, así que es el último
       *   snapshot de la corrida. Saltearlo dejaría al cliente sin la razón
       *   del corte.
       * - la última generación pedida: el cierre de la narrativa, y el punto
       *   que ancla la gráfica y el estado final de la grilla.
       *
       * `nearExtinct` NO está en la lista a propósito: su contrato
       * (shared-types) dice que se mantiene mientras la población siga bajo
       * el umbral, o sea potencialmente cientos de generaciones seguidas.
       * Marcarlo crítico desactivaría el backpressure entero justo en la
       * fase de población baja, que es la más lenta y la más interesante.
       */
      const criticalGeneration = snapshot.catastropheOccurred || snapshot.extinct || i === config.updates - 1;

      if (socket.readyState === socket.OPEN) {
        /*
         * `?? 0` no es paranoia: una implementación de socket que no exponga
         * `bufferedAmount` daría `undefined`, y `undefined <= N` es `false`,
         * así que TODO snapshot no crítico se saltearía en silencio. Ante la
         * duda, el comportamiento correcto es el de siempre (enviar), no el
         * degradado. Lo detectó el FakeSocket de los tests, que no la tenía.
         *
         * Se lee UNA sola vez a una variable: en `ws` esta propiedad es un
         * getter que recorre la cola de envío, así que leerla dos veces (una
         * para el `typeof` y otra para el valor) costaría el doble y las dos
         * lecturas podrían no coincidir.
         */
        const reported: unknown = socket.bufferedAmount;
        const buffered = typeof reported === "number" ? reported : 0;
        if (criticalGeneration || buffered <= BACKPRESSURE_HIGH_WATER_MARK) {
          socket.send(`{"type":"snapshot","snapshot":${snapshotJson}}`);
          if (congested) {
            console.log(
              `[camevo] run ${runId}: fin de congestión en la generación ${snapshot.generation} ` +
                `(buffer ${buffered} B, ${skippedWhileCongested} snapshots salteados)`,
            );
            congested = false;
            skippedWhileCongested = 0;
          }
        } else {
          /*
           * Se saltea el ENVÍO, no la generación: `registry.appendSnapshot`
           * ya guardó este snapshot más arriba, así que "Guardar esta
           * corrida" persiste las 1500 generaciones completas. Lo que
           * submuestrea es la vista en vivo, y solo mientras el enlace no da.
           *
           * Se loguea al ENTRAR y al SALIR de la congestión en vez de una
           * línea por snapshot: con un enlace lento esto último son miles de
           * líneas por corrida, en un VPS de 2 vCPU donde el disco y el
           * propio I/O de log compiten con el motor.
           */
          if (!congested) {
            congested = true;
            console.log(
              `[camevo] run ${runId}: congestión en la generación ${snapshot.generation} ` +
                `(buffer ${buffered} B > ${BACKPRESSURE_HIGH_WATER_MARK} B) — se saltean envíos hasta que drene`,
            );
          }
          skippedWhileCongested += 1;
          skippedTotal += 1;
        }
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
    if (skippedTotal > 0) {
      console.log(
        `[camevo] run ${runId}: ${skippedTotal} envíos salteados por backpressure ` +
          `(la corrida guardada conserva todas las generaciones)`,
      );
    }
  }
}
