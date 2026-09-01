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
    server = createServer(repository, 1); // 1ms entre generaciones para que el test sea rápido
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
      body: JSON.stringify({ gridWidth: 5, gridHeight: 5, updates }),
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
});
