import type { LiveMessage } from "@camevo/shared-types";
import type { WebSocket } from "ws";
import { RunRepository } from "../../persistence/repository/types";
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
 * Fase 5 (cierre de la prueba de carga contra el VPS real): `saveSnapshot`
 * NO se espera antes de enviar cada snapshot — se acumula su promesa en
 * `pendingWrites` y se espera UNA sola vez, al final, no una vez por
 * generación. Medido con causalidad confirmada (no solo sospechado): con
 * el await bloqueante por generación, 5 conexiones concurrentes a grilla
 * máxima contra Postgres real tenían un peor caso de ~1.9s de atraso
 * entre snapshots; con la escritura fuera del camino crítico, bajó a
 * ~0.96s (2x mejor), con el promedio prácticamente sin cambios — porque
 * el trabajo total (cómputo + escritura) sigue siendo el mismo, solo que
 * una escritura lenta ya no bloquea EL ENVÍO de ese mensaje en particular
 * (ver docs/04-roadmap-fases.md para la tabla completa). Se descartó
 * batchear escrituras: hubiera agregado estado nuevo (buffer por
 * conexión, vaciarlo al cerrar/extinguirse) para atacar la CANTIDAD de
 * round-trips, cuando el problema confirmado era la LATENCIA de
 * bloquear, no cuántas escrituras se hacían.
 *
 * Un fallo de escritura NUNCA se pierde en silencio: se loguea con
 * runId + generación (único rastro disponible hoy — el proyecto no tiene
 * otro mecanismo de logging/alertas). Esperar `pendingWrites` al final
 * (después de "done", no antes) preserva la garantía de que cuando esta
 * función resuelve, cada snapshot ya fue persistido o su fallo ya quedó
 * registrado — sin que ese vaciado final bloquee el cierre del socket
 * que sí ve el usuario.
 */
export async function streamRunLive(
  runId: string,
  config: SimulationConfig,
  repository: RunRepository,
  socket: WebSocket,
  control: PlaybackControl,
): Promise<void> {
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });

  const state = createSimulationState(config);
  const pendingWrites: Promise<void>[] = [];

  for (let i = 0; i < config.updates && !closed; i++) {
    await control.waitIfPaused();
    if (closed) break;

    const snapshot = advanceGeneration(state);

    pendingWrites.push(
      repository.saveSnapshot(runId, snapshot.generation, snapshot as unknown as Record<string, unknown>).catch((err: unknown) => {
        console.error(`No se pudo persistir el snapshot ${snapshot.generation} de la corrida ${runId}:`, err);
      }),
    );

    if (socket.readyState === socket.OPEN) {
      const message: LiveMessage = { type: "snapshot", snapshot };
      socket.send(JSON.stringify(message));
    }

    if (snapshot.extinct) break;

    await sleep(control.msPerGeneration);
  }

  if (!closed && socket.readyState === socket.OPEN) {
    const message: LiveMessage = { type: "done" };
    socket.send(JSON.stringify(message));
    socket.close();
  }

  await Promise.all(pendingWrites);
}
