import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { createLiveRunRegistry, type LiveRunRegistry } from "../../src/api/live-run-registry";
import { parseCreateRunRequest } from "../../src/api/rest/config-request";
import { streamRunLive } from "../../src/api/ws/live-run";
import { PlaybackControl } from "../../src/api/ws/playback-control";
import { SimulationConfig } from "../../src/simulation/orchestrator/run";
import type { LiveMessage } from "@camevo/shared-types";

/**
 * WebSocket falso mínimo: solo lo que streamRunLive realmente usa.
 *
 * `bufferedAmount` es parte de ese mínimo desde que existe el backpressure:
 * sin ella, el doble devolvía `undefined`, y como `undefined <= N` es `false`
 * el servidor saltearía todos los envíos no críticos. El default de 0 es "el
 * socket drena al instante", que es el caso de un enlace rápido.
 */
class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  readonly OPEN = FakeSocket.OPEN;
  readyState = FakeSocket.OPEN;
  readonly sent: LiveMessage[] = [];
  closed = false;
  /** Sobrescribible por los tests de backpressure para simular congestión. */
  bufferedAmount = 0;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as LiveMessage);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }
}

/**
 * Grupo 1 (guardado intencional): `streamRunLive` ya no recibe un
 * `RunRepository` — lee/escribe todo en `LiveRunRegistry` (memoria). En
 * producción, la entrada "pending" siempre existe antes de que
 * `streamRunLive` arranque (la crea `POST /runs`, y el propio handshake
 * de WS se niega a arrancar el streaming si no la encuentra — ver
 * server.ts). Estos tests llaman a `streamRunLive` directo, sin pasar
 * por el handshake, así que tienen que replicar esa misma precondición
 * a mano con `registerPending`.
 */
function registerPending(registry: LiveRunRegistry, runId: string, browserId = "test-browser"): void {
  const parsed = parseCreateRunRequest({});
  if ("errors" in parsed) throw new Error("config de prueba inválida");
  registry.createPending(runId, browserId, parsed.config);
}

describe("streamRunLive — corte temprano por extinción (Fase 4)", () => {
  it("termina antes de config.updates cuando la población se extingue, y cierra el socket con 'done'", async () => {
    const config: SimulationConfig = {
      gridWidth: 5,
      gridHeight: 5,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 5)],
      placementMode: "near-parent",
      updates: 50, // límite alto a propósito: no debería llegar ahí
      seed: 1,
      catastrophe: { intervalGenerations: 1, severity: 1 }, // extinción garantizada en la generación 1 (no dispara en la 0)
    };

    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, config, socket as any, new PlaybackControl(0), registry);

    const snapshotMessages = socket.sent.filter((m) => m.type === "snapshot");
    expect(snapshotMessages.length).toBeLessThan(50);
    expect(snapshotMessages.length).toBeGreaterThan(0);

    const lastSnapshotMessage = snapshotMessages.at(-1);
    expect(lastSnapshotMessage?.type === "snapshot" && lastSnapshotMessage.snapshot.extinct).toBe(true);

    expect(socket.sent.at(-1)).toEqual({ type: "done" });
    expect(socket.closed).toBe(true);

    // Se acumuló en el registro exactamente lo que se transmitió, no más.
    expect(registry.get(runId)?.snapshots).toHaveLength(snapshotMessages.length);
  });
});

describe("streamRunLive — pausar congela el motor, no solo el envío (RF-023/RNF-003)", () => {
  function buildConfig(seed: number): SimulationConfig {
    return {
      gridWidth: 6,
      gridHeight: 6,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 12)],
      placementMode: "near-parent",
      updates: 15,
      seed,
    };
  }

  it("una espera REAL de reloj mientras está pausado no cambia ni un snapshot del resultado final", async () => {
    const seed = 777;

    // Corrida A: control de referencia, de punta a punta sin pausar.
    const runA = randomUUID();
    const registryA = createLiveRunRegistry();
    registerPending(registryA, runA);
    const socketA = new FakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runA, buildConfig(seed), socketA as any, new PlaybackControl(0), registryA);

    // Corrida B: misma config y semilla, pero arranca YA pausada (antes de
    // que streamRunLive calcule la generación 0) y solo se reanuda después
    // de una espera real de setTimeout — no una espera simulada/mockeada.
    // Si pausar no congelara advanceGeneration de verdad, esta espera real
    // introduciría una fuente de no-determinismo (RNF-003) que este test
    // detectaría como una diferencia entre A y B.
    const runB = randomUUID();
    const registryB = createLiveRunRegistry();
    registerPending(registryB, runB);
    const socketB = new FakeSocket();
    const controlB = new PlaybackControl(0);
    controlB.pause();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromiseB = streamRunLive(runB, buildConfig(seed), socketB as any, controlB, registryB);

    expect(socketB.sent.filter((m) => m.type === "snapshot")).toHaveLength(0); // nada avanzó todavía, sigue en pausa

    await new Promise((resolve) => setTimeout(resolve, 300)); // espera real de reloj
    controlB.resume();
    await streamPromiseB;

    const snapshotsA = socketA.sent.filter((m) => m.type === "snapshot");
    const snapshotsB = socketB.sent.filter((m) => m.type === "snapshot");
    expect(snapshotsA).toHaveLength(15);
    expect(snapshotsB).toEqual(snapshotsA);
  });

  it("una pausa a mitad de corrida tampoco cambia el resto de las generaciones", async () => {
    const seed = 888;

    const runA = randomUUID();
    const registryA = createLiveRunRegistry();
    registerPending(registryA, runA);
    const socketA = new FakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runA, buildConfig(seed), socketA as any, new PlaybackControl(0), registryA);

    const runB = randomUUID();
    const registryB = createLiveRunRegistry();
    registerPending(registryB, runB);
    const socketB = new FakeSocket();
    const controlB = new PlaybackControl(5); // pacing chico pero no-cero, para poder pausar "a mitad de camino"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromiseB = streamRunLive(runB, buildConfig(seed), socketB as any, controlB, registryB);

    // Espera a que hayan llegado algunas generaciones, pausa, espera de
    // verdad, y reanuda — igual que un usuario pausando a mitad de corrida.
    while (socketB.sent.filter((m) => m.type === "snapshot").length < 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controlB.pause();
    const pausedCount = socketB.sent.filter((m) => m.type === "snapshot").length;

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socketB.sent.filter((m) => m.type === "snapshot")).toHaveLength(pausedCount); // nada avanzó durante la pausa

    controlB.resume();
    await streamPromiseB;

    const snapshotsA = socketA.sent.filter((m) => m.type === "snapshot");
    const snapshotsB = socketB.sent.filter((m) => m.type === "snapshot");
    expect(snapshotsB).toEqual(snapshotsA);
  });
});

// Nota histórica: acá vivía "streamRunLive — saveSnapshot no bloquea el
// envío (Fase 5)", el fix de causalidad confirmada que hacía que la
// escritura a Postgres por generación no bloqueara el envío del
// snapshot (ver docs/04-roadmap-fases.md para la tabla completa). Ese
// mecanismo entero (pendingWrites, pool.query por generación) dejó de
// existir con el Grupo 1: ya no hay NINGUNA escritura a Postgres
// mientras una corrida transmite — el guardado es intencional, no
// automático (ver la nueva describe de abajo y api/rest/app.ts,
// POST /runs/:id/save). El test queda documentado acá, no restaurado:
// no hay nada que "no bloquee" si no hay escritura en absoluto.

describe("streamRunLive — acumula en LiveRunRegistry en vez de escribir a Postgres (Grupo 1 + RF-027)", () => {
  function buildConfig(seed: number, updates: number): SimulationConfig {
    return {
      gridWidth: 5,
      gridHeight: 5,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 5)],
      placementMode: "near-parent",
      updates,
      seed,
    };
  }

  it("acumula el SimulationState y cada snapshot mientras transmite, y marca la entrada como terminada al final (sin borrarla)", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId, "browser-x");
    const socket = new FakeSocket();

    expect(registry.get(runId)?.state).toBeNull(); // pending: todavía no arrancó el streaming

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromise = streamRunLive(runId, buildConfig(1, 5), socket as any, new PlaybackControl(20), registry);

    // A mitad de camino (ritmo real, no 0), el estado debe estar adjunto.
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(registry.get(runId)?.state).not.toBeNull();

    await streamPromise;
    const entry = registry.get(runId);
    expect(entry).toBeDefined(); // Grupo 1: a diferencia de RF-027 solo, la entrada NO se borra al terminar — hace falta para poder guardarla después
    expect(entry?.snapshots.length).toBeGreaterThan(0);
    expect(entry?.finishedAt).not.toBeNull();
    expect(entry?.saved).toBe(false);
    expect(entry?.browserId).toBe("browser-x");
  });

  it("marca finishedAt incluso si el socket se cierra a mitad de la corrida (no solo al completarse normalmente)", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromise = streamRunLive(runId, buildConfig(2, 50), socket as any, new PlaybackControl(20), registry);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(registry.get(runId)?.finishedAt).toBeNull();

    socket.emit("close");
    await streamPromise;
    expect(registry.get(runId)?.finishedAt).not.toBeNull();
  });
});

/**
 * Retención de memoria del registro. Medido en una corrida 40x40 x 1500:
 * retener los objetos cuesta 162 MB de heap, los strings 98 MB (-40%), y el
 * array de `organisms` es el 99% de ese peso. En un VPS de 1.9 GB con 1.4 GB
 * en swap, eso importa.
 */
describe("LiveRunRegistry — retención de snapshots (string, y liberación tras guardar)", () => {
  function buildConfig(seed: number, updates: number): SimulationConfig {
    return {
      gridWidth: 5,
      gridHeight: 5,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 5)],
      placementMode: "near-parent",
      updates,
      seed,
    };
  }

  it("retiene los snapshots SERIALIZADOS, no los objetos", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, buildConfig(1, 4), socket as any, new PlaybackControl(0), registry);

    const retained = registry.get(runId)!.snapshots;
    expect(retained.length).toBeGreaterThan(0);
    for (const item of retained) {
      expect(typeof item).toBe("string");
    }
  });

  it("el string retenido es el snapshot completo y parseable, con los organismos incluidos", () => {
    // El guardado lo parsea para escribirlo a Postgres: si el string no
    // fuera un snapshot válido, las corridas guardadas quedarían corruptas.
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    registry.appendSnapshot(
      runId,
      JSON.stringify({ generation: 3, populationSize: 2, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] }),
    );

    const parsed = JSON.parse(registry.get(runId)!.snapshots[0]!) as {
      generation: number;
      organisms: { id: string }[];
    };
    expect(parsed.generation).toBe(3);
    expect(parsed.organisms).toHaveLength(1);
  });

  it("el mismo string que se retiene es el que viaja por el socket — una sola serialización", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, buildConfig(2, 3), socket as any, new PlaybackControl(0), registry);

    const sentSnapshots = socket.sent.filter((m): m is Extract<LiveMessage, { type: "snapshot" }> => m.type === "snapshot");
    const retained = registry.get(runId)!.snapshots.map((json) => JSON.parse(json) as unknown);
    expect(retained).toEqual(sentSnapshots.map((m) => m.snapshot));
  });

  it("markSaved libera los snapshots pero conserva la entrada — `saved` tiene que seguir consultable", () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId, "browser-y");
    registry.appendSnapshot(runId, JSON.stringify({ generation: 0 }));
    registry.appendSnapshot(runId, JSON.stringify({ generation: 1 }));
    registry.markFinished(runId);
    expect(registry.get(runId)?.snapshots).toHaveLength(2);

    registry.markSaved(runId);

    const entry = registry.get(runId);
    expect(entry).toBeDefined();
    expect(entry?.snapshots).toEqual([]); // 162 MB liberados en vez de esperar 15 min de TTL
    expect(entry?.saved).toBe(true);
    expect(entry?.browserId).toBe("browser-y"); // los metadatos siguen, para responder alreadySaved y el 403
  });

  it("markSaved sobre un runId inexistente no revienta", () => {
    const registry = createLiveRunRegistry();
    expect(() => registry.markSaved(randomUUID())).not.toThrow();
  });
});

describe("streamRunLive — latido (heartbeat)", () => {
  it("no manda ningún ping en una corrida que termina antes del primer intervalo de 30s", async () => {
    // Las corridas de los tests duran milisegundos: el ping no debe
    // contaminar el stream ni los conteos de mensajes de los otros tests.
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(
      runId,
      {
        gridWidth: 5,
        gridHeight: 5,
        baseCyclesPerUpdate: 20,
        mutationRate: 0.05,
        ancestorGenomes: [createUniformGenome("replicate", 5)],
        placementMode: "near-parent",
        updates: 3,
        seed: 9,
      },
      socket as any,
      new PlaybackControl(0),
      registry,
    );

    expect(socket.sent.filter((m) => m.type === "ping")).toHaveLength(0);
    expect(socket.sent.at(-1)?.type).toBe("done");
  });
});

/**
 * Backpressure (ver BACKPRESSURE_HIGH_WATER_MARK en ws/live-run.ts). Lo que
 * se verifica acá es la decisión de ENVIAR o SALTEAR según el buffer de
 * salida del socket, y que saltear nunca pierda una generación crítica ni una
 * generación del registro — la corrida guardada tiene que seguir completa.
 */
describe("streamRunLive — backpressure", () => {
  /**
   * Socket cuyo `bufferedAmount` sigue un guion: una entrada por lectura, y
   * `streamRunLive` lo lee exactamente una vez por generación. Así el test
   * fija la congestión en generaciones concretas en vez de depender de
   * tiempos reales, que serían inestables.
   */
  class ScriptedSocket extends FakeSocket {
    reads = 0;
    constructor(plan: readonly number[]) {
      super();
      /*
       * `defineProperty` y no un getter de clase: `FakeSocket` declara
       * `bufferedAmount` como CAMPO, y un campo crea una propiedad propia en
       * la instancia que tapa cualquier accessor del prototipo de la
       * subclase. Definirla acá, después de `super()`, reemplaza esa
       * propiedad propia. (Primera versión de este test: el guion se
       * ignoraba y no se salteaba nada.)
       */
      Object.defineProperty(this, "bufferedAmount", {
        get: () => {
          const value = plan[this.reads] ?? 0;
          this.reads += 1;
          return value;
        },
      });
    }
  }

  function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
    return {
      gridWidth: 6,
      gridHeight: 6,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 12)],
      placementMode: "near-parent",
      updates: 10,
      seed: 99,
      ...overrides,
    };
  }

  function sentGenerations(socket: FakeSocket): number[] {
    return socket.sent
      .filter((m): m is Extract<LiveMessage, { type: "snapshot" }> => m.type === "snapshot")
      .map((m) => m.snapshot.generation);
  }

  const CONGESTED = 512 * 1024;

  it("saltea los envíos mientras el buffer está por encima del tope, y los retoma cuando drena", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    // Buffer: holgado hasta la generación 3, congestionado en 4-6, drenado en 7.
    const socket = new ScriptedSocket([0, 0, 0, 0, CONGESTED, CONGESTED, CONGESTED, 0, 0, 0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, config(), socket as any, new PlaybackControl(0), registry);

    const sent = sentGenerations(socket);
    expect(sent).not.toContain(4);
    expect(sent).not.toContain(5);
    expect(sent).not.toContain(6);
    expect(sent).toContain(3);
    expect(sent).toContain(7);
    // Y el registro conserva TODAS: es lo que persiste "Guardar esta corrida".
    expect(registry.get(runId)!.snapshots).toHaveLength(10);
  });

  it("una generación con catástrofe se envía igual, con el buffer por encima del tope", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new ScriptedSocket([0, 0, 0, 0, CONGESTED, CONGESTED, CONGESTED, 0, 0, 0]);

    await streamRunLive(
      runId,
      // Catástrofe cada 5 generaciones y severidad baja: cae en la generación
      // 5, en plena ventana congestionada, sin extinguir la población.
      config({ catastrophe: { intervalGenerations: 5, severity: 0.1 } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket as any,
      new PlaybackControl(0),
      registry,
    );

    const snapshots = socket.sent.filter((m): m is Extract<LiveMessage, { type: "snapshot" }> => m.type === "snapshot");
    const gen5 = snapshots.find((m) => m.snapshot.generation === 5);
    expect(gen5, "la generación con catástrofe no puede saltearse").toBeDefined();
    expect(gen5!.snapshot.catastropheOccurred).toBe(true);
    // Sus vecinas no críticas de la misma ventana sí se saltean.
    const sent = sentGenerations(socket);
    expect(sent).not.toContain(4);
    expect(sent).not.toContain(6);
  });

  it("la última generación pedida se envía igual, con el buffer por encima del tope", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    // Congestión sostenida justo sobre el final de la corrida.
    const socket = new ScriptedSocket([0, 0, 0, 0, 0, 0, 0, CONGESTED, CONGESTED, CONGESTED]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, config({ updates: 10 }), socket as any, new PlaybackControl(0), registry);

    const sent = sentGenerations(socket);
    expect(sent).toContain(9); // updates - 1: el cierre de la narrativa
    expect(sent).not.toContain(8);
    // Y el "done" llega siempre: no pasa por el chequeo de buffer.
    expect(socket.sent.some((m) => m.type === "done")).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it("con el buffer siempre holgado no saltea nada — el enlace rápido se comporta igual que antes", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new ScriptedSocket([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, config(), socket as any, new PlaybackControl(0), registry);

    expect(sentGenerations(socket)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(registry.get(runId)!.snapshots).toHaveLength(10);
  });

  it("un socket sin `bufferedAmount` envía todo en vez de saltear todo", async () => {
    const runId = randomUUID();
    const registry = createLiveRunRegistry();
    registerPending(registry, runId);
    const socket = new FakeSocket();
    /*
     * Se BORRA la propiedad en vez de asignarle `undefined`: con
     * `exactOptionalPropertyTypes` esa asignación no typechequea, y además
     * borrarla reproduce mejor el caso real — un socket que simplemente no
     * expone `bufferedAmount`. `undefined <= N` es false, así que sin el
     * guardia de tipo del servidor esto saltearía cada snapshot no crítico
     * en silencio.
     */
    delete (socket as Partial<FakeSocket>).bufferedAmount;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runId, config(), socket as any, new PlaybackControl(0), registry);

    expect(sentGenerations(socket)).toHaveLength(10);
  });
});
