import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/rest/app";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";

describe("api/rest", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const repository = new InMemoryRunRepository();
    const app = createApp(repository);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function postRun(body: unknown) {
    return fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("POST /runs crea una corrida con valores por defecto razonables", async () => {
    const res = await postRun({});
    expect(res.status).toBe(201);

    const body = (await res.json()) as { runId: string; seed: number };
    expect(body.runId).toBeTruthy();
    expect(typeof body.seed).toBe("number");
  });

  it("modo reproducible: la misma configuración produce siempre la misma semilla (RF-007/RNF-003)", async () => {
    const payload = { gridWidth: 8, gridHeight: 8, reproducibilityMode: "reproducible" };
    const res1 = await postRun(payload);
    const res2 = await postRun(payload);
    const body1 = (await res1.json()) as { seed: number };
    const body2 = (await res2.json()) as { seed: number };
    expect(body1.seed).toBe(body2.seed);
  });

  it("rechaza parámetros fuera de rango (RNF-008)", async () => {
    const res = await postRun({ gridWidth: 100000, updates: 10_000_000 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("rechaza un placementMode inválido", async () => {
    const res = await postRun({ placementMode: "teletransporte" });
    expect(res.status).toBe(400);
  });

  it("GET /runs/:id devuelve 404 si no existe", async () => {
    const res = await fetch(`${baseUrl}/runs/no-existe`);
    expect(res.status).toBe(404);
  });

  it("GET /runs/:id devuelve la corrida recién creada, sin snapshots todavía", async () => {
    const createRes = await postRun({});
    const { runId } = (await createRes.json()) as { runId: string };

    const res = await fetch(`${baseUrl}/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string }; snapshots: unknown[] };
    expect(body.run.id).toBe(runId);
    expect(body.snapshots).toEqual([]);
  });
});
