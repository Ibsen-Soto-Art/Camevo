import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_TIMEOUT_MS, connectToRunStream } from "../src/lib/camevo-client";
import type { LiveMessage } from "../src/lib/camevo-client";

/**
 * Detección de desconexión y latido. Nace de un incidente real: una corrida
 * 40x40 se detuvo en la generación 1194 de 1500 y la interfaz siguió
 * mostrando "en curso" indefinidamente, porque `connectToRunStream` tenía
 * un único listener ("message") — si la conexión moría a nivel TCP/WS no
 * llegaba ningún mensaje y nadie se enteraba.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.OPEN;
  readonly sent: unknown[] = [];
  closeCalls = 0;
  private readonly listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  /** Mensaje servidor → cliente. */
  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }
}

function openStream() {
  const received: LiveMessage[] = [];
  const handle = connectToRunStream("run-1", (m) => received.push(m));
  const socket = FakeWebSocket.instances.at(-1)!;
  return { received, handle, socket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectToRunStream — desconexión inesperada", () => {
  it("emite 'disconnected' cuando el socket cierra SIN haber recibido 'done'", () => {
    const { received, socket } = openStream();
    socket.receive({ type: "snapshot", snapshot: { generation: 7 } });
    socket.emit("close");

    expect(received.map((m) => m.type)).toEqual(["snapshot", "disconnected"]);
  });

  it("NO emite 'disconnected' cuando el socket cierra DESPUÉS de 'done' — el cierre normal de toda corrida exitosa", () => {
    // Sin la bandera `receivedDone`, cada corrida que termina bien mostraría
    // "Conexión perdida": el servidor cierra el socket justo después del
    // "done", así que el evento close llega siempre.
    const { received, socket } = openStream();
    socket.receive({ type: "done" });
    socket.emit("close");

    expect(received.map((m) => m.type)).toEqual(["done"]);
  });

  it("tampoco lo emite después de un 'error' del servidor — ese mensaje ya explica qué pasó", () => {
    const { received, socket } = openStream();
    socket.receive({ type: "error", message: "Corrida no encontrada" });
    socket.emit("close");

    expect(received.map((m) => m.type)).toEqual(["error"]);
  });

  it("el evento 'error' del socket también lo emite", () => {
    const { received, socket } = openStream();
    socket.emit("error");
    expect(received.map((m) => m.type)).toEqual(["disconnected"]);
  });

  it("no lo emite dos veces si llegan 'error' y 'close' seguidos", () => {
    const { received, socket } = openStream();
    socket.emit("error");
    socket.emit("close");
    expect(received.filter((m) => m.type === "disconnected")).toHaveLength(1);
  });

  it("cerrar desde el cliente (handle.close) no cuenta como desconexión", () => {
    const { received, handle, socket } = openStream();
    handle.close();
    socket.emit("close");

    expect(received).toEqual([]);
    expect(socket.closeCalls).toBe(1);
  });
});

describe("connectToRunStream — latido (heartbeat)", () => {
  it("responde 'pong' a cada 'ping' y no propaga el ping a la UI", () => {
    const { received, socket } = openStream();
    socket.receive({ type: "ping" });
    socket.receive({ type: "ping" });

    expect(socket.sent).toEqual([{ type: "pong" }, { type: "pong" }]);
    expect(received).toEqual([]);
  });

  it("emite 'disconnected' si pasa el timeout sin recibir ningún ping", () => {
    const { received, socket } = openStream();
    socket.receive({ type: "ping" });
    expect(received).toEqual([]);

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);
    expect(received).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(received.map((m) => m.type)).toEqual(["disconnected"]);
  });

  it("cada ping reinicia el reloj: una corrida larga con latido no se declara muerta", () => {
    const { received, socket } = openStream();
    for (let i = 0; i < 10; i++) {
      socket.receive({ type: "ping" });
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1_000); // llega el siguiente ping antes del límite
    }
    expect(received).toEqual([]);
  });

  it("el reloj arranca con el primer ping, no al conectar — un servidor sin latido no se declara muerto solo", () => {
    // Compatibilidad: si el cliente nuevo habla con un servidor viejo que
    // no manda pings, la corrida no debe morir a los 60s por eso.
    const { received } = openStream();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 3);
    expect(received).toEqual([]);
  });

  it("tras 'done' el reloj se desarma: no emite 'disconnected' pasado el timeout", () => {
    const { received, socket } = openStream();
    socket.receive({ type: "ping" });
    socket.receive({ type: "done" });
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);

    expect(received.map((m) => m.type)).toEqual(["done"]);
  });

  it("el timeout del cliente es el doble del intervalo del servidor (30s), para tolerar un latido perdido", () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBe(60_000);
  });
});
