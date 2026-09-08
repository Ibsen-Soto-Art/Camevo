import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../src/api/server";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";
import { LiveMessage } from "../../src/api/ws/live-run";

describe("api/ws — streaming en vivo generación a generación", () => {
  let server: http.Server;
  let repository: InMemoryRunRepository;
  let baseHttpUrl: string;
  let baseWsUrl: string;

  beforeAll(async () => {
    repository = new InMemoryRunRepository();
    server = createServer(repository); // msPerGeneration ahora es por corrida, ver createRun() abajo
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseHttpUrl = `http://127.0.0.1:${port}`;
    baseWsUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function createRun(updates: number) {
    const res = await fetch(`${baseHttpUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 1ms entre generaciones para que el test sea rápido (RF-023: ahora es por corrida).
      body: JSON.stringify({ gridWidth: 5, gridHeight: 5, updates, msPerGeneration: 1 }),
    });
    const body = (await res.json()) as { runId: string };
    return body.runId;
  }

  function collectMessages(runId: string): Promise<LiveMessage[]> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${baseWsUrl}/runs/${runId}/stream`);
      const messages: LiveMessage[] = [];

      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as LiveMessage;
        messages.push(message);
        if (message.type === "done" || message.type === "error") {
          socket.close();
          resolve(messages);
        }
      });
      socket.on("error", reject);
    });
  }

  it("transmite un snapshot por generación, en orden, y termina con 'done'", async () => {
    const runId = await createRun(5);
    const messages = await collectMessages(runId);

    const snapshots = messages.filter((m) => m.type === "snapshot");
    expect(snapshots).toHaveLength(5);
    expect(snapshots.map((m) => (m.type === "snapshot" ? m.snapshot.generation : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("persiste cada snapshot a medida que se transmite (RF-030)", async () => {
    const runId = await createRun(3);
    await collectMessages(runId);

    const res = await fetch(`${baseHttpUrl}/runs/${runId}`);
    const body = (await res.json()) as { snapshots: { generation: number }[] };
    expect(body.snapshots.map((s) => s.generation)).toEqual([0, 1, 2]);
  });

  it("responde con error si la corrida no existe", async () => {
    const messages = await collectMessages("no-existe");
    expect(messages[0]).toEqual({ type: "error", message: "Corrida no encontrada" });
  });

  describe("control en vivo (RF-023): pause/resume/setSpeed sobre el WS ya abierto", () => {
    it("'pause' detiene la llegada de nuevos snapshots, y 'resume' la retoma", async () => {
      const runId = await createRun(200); // suficientes generaciones para poder pausar a mitad de camino
      const socket = new WebSocket(`${baseWsUrl}/runs/${runId}/stream`);
      const snapshots: number[] = [];

      await new Promise<void>((resolve) => socket.on("open", () => resolve()));

      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as LiveMessage;
        if (message.type === "snapshot") snapshots.push(message.snapshot.generation);
      });

      // Deja correr un poco, después pausa.
      while (snapshots.length < 3) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      socket.send(JSON.stringify({ type: "pause" }));
      // Da tiempo a que el mensaje viaje y a que termine cualquier
      // generación que ya estuviera en curso antes de que el servidor
      // procesara "pause" — la pausa aplica desde la SIGUIENTE generación,
      // no interrumpe una ya empezada.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const countAtPause = snapshots.length;

      // Espera real de reloj: no debería llegar NADA nuevo mientras está pausado.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(snapshots.length).toBe(countAtPause);

      socket.send(JSON.stringify({ type: "resume" }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(snapshots.length).toBeGreaterThan(countAtPause); // retomó, siguen llegando

      socket.close();
    });

    it("'setSpeed' cambia el ritmo de una corrida ya en curso", async () => {
      const runId = await createRun(200);
      const socket = new WebSocket(`${baseWsUrl}/runs/${runId}/stream`);
      const timestamps: number[] = [];

      await new Promise<void>((resolve) => socket.on("open", () => resolve()));

      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as LiveMessage;
        if (message.type === "snapshot") timestamps.push(Date.now());
      });

      // La corrida arranca a 1ms/gen (ver createRun) — la acelera un poco
      // más para confirmar que el cambio se aplica en vivo, no solo al crear.
      socket.send(JSON.stringify({ type: "setSpeed", msPerGeneration: 0 }));

      await new Promise((resolve) => setTimeout(resolve, 150));
      socket.close();

      expect(timestamps.length).toBeGreaterThan(20); // a ~0ms/gen en 150ms deberían entrar muchas más que a 1ms/gen
    });
  });
});
