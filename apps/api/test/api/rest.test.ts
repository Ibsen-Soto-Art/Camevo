import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLiveRunRegistry, LiveRunRegistry } from "../../src/api/live-run-registry";
import { createApp, resolveAllowedOrigins } from "../../src/api/rest/app";
import { parseCreateRunRequest } from "../../src/api/rest/config-request";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";
import { SimulationConfig, SimulationState, advanceGeneration, createSimulationState } from "../../src/simulation/orchestrator/run";

const BROWSER_A = "browser-test-aaaaaaaa";
const BROWSER_B = "browser-test-bbbbbbbb";

describe("api/rest", () => {
  let server: http.Server;
  let baseUrl: string;
  let liveRunRegistry: LiveRunRegistry;

  beforeAll(async () => {
    const repository = new InMemoryRunRepository();
    liveRunRegistry = createLiveRunRegistry();
    const app = createApp(repository, liveRunRegistry);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function postRun(body: unknown, browserId: string = BROWSER_A) {
    return fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Browser-ID": browserId },
      body: JSON.stringify(body),
    });
  }

  async function saveRun(runId: string, browserId: string = BROWSER_A) {
    return fetch(`${baseUrl}/runs/${runId}/save`, {
      method: "POST",
      headers: { "X-Browser-ID": browserId },
    });
  }

  async function getRunById(runId: string, browserId: string = BROWSER_A) {
    return fetch(`${baseUrl}/runs/${runId}`, { headers: { "X-Browser-ID": browserId } });
  }

  async function listRuns(query = "", browserId: string = BROWSER_A) {
    return fetch(`${baseUrl}/runs${query}`, { headers: { "X-Browser-ID": browserId } });
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

  it("PersistedRunConfig no incluye una semilla de clima separada (RNF-003)", async () => {
    // PersistedRunConfig es deliberadamente plano: no expande el
    // ClimatePolicyConfig completo (ver config-request.ts). La garantía
    // real de "misma semilla" se verifica en
    // test/api/build-simulation-config.test.ts, donde SÍ se expande.
    const res = await postRun({ climateEnabled: true });
    const body = (await res.json()) as { seed: number; config: { climateEnabled: boolean; climate?: unknown } };

    expect(body.config.climateEnabled).toBe(true);
    expect(body.config.climate).toBeUndefined();
    expect(typeof body.seed).toBe("number");
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
    const res = await getRunById("no-existe");
    expect(res.status).toBe(404);
  });

  it("GET /runs/:id devuelve 404 para una corrida creada pero todavía NO guardada (Grupo 1: el guardado es intencional, no automático)", async () => {
    const { runId } = (await (await postRun({})).json()) as { runId: string };

    const res = await getRunById(runId);
    expect(res.status).toBe(404);
  });

  it("GET /runs/:id devuelve la corrida recién guardada, sin snapshots (nada transmitió nada en este test)", async () => {
    const { runId } = (await (await postRun({})).json()) as { runId: string };
    await saveRun(runId);

    const res = await getRunById(runId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string }; snapshots: unknown[] };
    expect(body.run.id).toBe(runId);
    expect(body.snapshots).toEqual([]);
  });

  it("GET /runs/:id no incluye endedInExtinction/snapshotCount en run (esos solo viven en RunSummary)", async () => {
    const { runId } = (await (await postRun({})).json()) as { runId: string };
    await saveRun(runId);

    const res = await getRunById(runId);
    const body = (await res.json()) as { run: Record<string, unknown> };
    expect(body.run).not.toHaveProperty("endedInExtinction");
    expect(body.run).not.toHaveProperty("snapshotCount");
  });

  it("GET /runs/:id devuelve 403 (no 404) si la corrida existe pero es de OTRO browser_id", async () => {
    const { runId } = (await (await postRun({}, BROWSER_A)).json()) as { runId: string };
    await saveRun(runId, BROWSER_A);

    const res = await getRunById(runId, BROWSER_B);
    expect(res.status).toBe(403);
  });

  describe("POST /runs/:runId/save (Grupo 1: guardado intencional)", () => {
    it("persiste la corrida y responde 201 con alreadySaved:false", async () => {
      const { runId } = (await (await postRun({})).json()) as { runId: string };

      const res = await saveRun(runId);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { runId: string; alreadySaved: boolean };
      expect(body.runId).toBe(runId);
      expect(body.alreadySaved).toBe(false);
    });

    it("un segundo click (ya guardada) responde 200 con alreadySaved:true, sin duplicar ni fallar", async () => {
      const { runId } = (await (await postRun({})).json()) as { runId: string };
      await saveRun(runId);

      const res = await saveRun(runId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runId: string; alreadySaved: boolean };
      expect(body.alreadySaved).toBe(true);
    });

    it("404 si el runId nunca existió en el registro (o ya se limpió por TTL / reinicio del servidor)", async () => {
      const res = await saveRun("run-que-nunca-existio");
      expect(res.status).toBe(404);
    });

    it("403 si la corrida es de OTRO browser_id", async () => {
      const { runId } = (await (await postRun({}, BROWSER_A)).json()) as { runId: string };

      const res = await saveRun(runId, BROWSER_B);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /runs (RF-025: selector de comparación histórica)", () => {
    it("lista las corridas GUARDADAS más recientes primero, con paginación por query params", async () => {
      // El repositorio se comparte entre todos los tests de este describe
      // (beforeAll), así que ya existen corridas guardadas de tests
      // anteriores: no podemos asumir un total exacto, solo que las dos
      // que creamos y guardamos aquí quedan al frente (más recientes) y
      // que hasMore refleja el total real.
      const { runId: firstId } = (await (await postRun({})).json()) as { runId: string };
      await saveRun(firstId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const { runId: secondId } = (await (await postRun({})).json()) as { runId: string };
      await saveRun(secondId);

      const totalBody = (await (await listRuns("?limit=1000")).json()) as { runs: unknown[] };
      const total = totalBody.runs.length;

      const res = await listRuns("?limit=1&offset=0");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runs: { id: string }[]; hasMore: boolean };

      expect(body.runs.length).toBe(1);
      expect(body.runs[0]?.id).toBe(secondId);
      expect(body.hasMore).toBe(total > 1);

      const page2 = (await (await listRuns("?limit=1&offset=1")).json()) as { runs: { id: string }[]; hasMore: boolean };
      expect(page2.runs[0]?.id).toBe(firstId);
      expect(page2.hasMore).toBe(total > 2);
    });

    it("cada entrada incluye endedInExtinction y snapshotCount", async () => {
      const { runId } = (await (await postRun({})).json()) as { runId: string };
      await saveRun(runId);

      const res = await listRuns("?limit=100");
      const body = (await res.json()) as { runs: { id: string; endedInExtinction: boolean; snapshotCount: number }[] };
      const entry = body.runs.find((r) => r.id === runId);

      expect(entry?.endedInExtinction).toBe(false);
      expect(entry?.snapshotCount).toBe(0);
    });

    it("ignora un limit fuera de rango o no numérico usando el default", async () => {
      const res = await listRuns("?limit=not-a-number");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runs: unknown[] };
      expect(Array.isArray(body.runs)).toBe(true);
    });

    // Grupo 1 (Cambio 1C): esto es lo que realmente hace nuevo el
    // aislamiento por navegador a nivel de API completa (no solo del
    // repositorio, ya cubierto en in-memory-repository.test.ts).
    it("nunca devuelve corridas guardadas de OTRO browser_id, aunque existan y sean más recientes", async () => {
      const { runId } = (await (await postRun({}, BROWSER_B)).json()) as { runId: string };
      await saveRun(runId, BROWSER_B);

      const res = await listRuns("?limit=1000", BROWSER_A);
      const body = (await res.json()) as { runs: { id: string }[] };
      expect(body.runs.some((r) => r.id === runId)).toBe(false);
    });
  });

  describe("X-Browser-ID (Grupo 1): requerido en las rutas que exponen datos de un navegador", () => {
    it("400 si falta el header, en cualquiera de las rutas que lo requieren", async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
        fetch(`${baseUrl}/runs`),
        fetch(`${baseUrl}/runs/algun-id`),
        fetch(`${baseUrl}/runs/algun-id/save`, { method: "POST" }),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(400);
      }
    });

    it("400 si el header es demasiado corto para ser un id razonable", async () => {
      const res = await postRun({}, "corto");
      expect(res.status).toBe(400);
    });
  });

  describe("CORS (Fase 5): origen restringido, no abierto", () => {
    afterEach(() => {
      delete process.env.CORS_ORIGIN;
    });

    it("resolveAllowedOrigins: sin CORS_ORIGIN, solo permite los puertos de desarrollo local", () => {
      delete process.env.CORS_ORIGIN;
      expect(resolveAllowedOrigins()).toEqual(["http://localhost:5173", "http://localhost:4173"]);
    });

    it("resolveAllowedOrigins: con CORS_ORIGIN, parsea una lista separada por comas y descarta espacios/vacíos", () => {
      process.env.CORS_ORIGIN = "https://camevo.ibsen-soto.pro, http://localhost:5173 ,,";
      expect(resolveAllowedOrigins()).toEqual(["https://camevo.ibsen-soto.pro", "http://localhost:5173"]);
    });

    it("responde con Access-Control-Allow-Origin para un origen permitido", async () => {
      const res = await fetch(`${baseUrl}/health`, { headers: { Origin: "http://localhost:5173" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });

    it("NO refleja un origen fuera de la lista permitida", async () => {
      const res = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://sitio-ajeno.example" } });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("GET /runs/:runId/organisms/:organismId (RF-027)", () => {
    // Alcance reducido (aprobado explícitamente): solo sirve la
    // generación ACTUAL de una corrida en vivo en ESTE proceso — nunca
    // generaciones pasadas ni corridas ya guardadas. El registro es un
    // Map en memoria (ver live-run-registry.ts), así que estos tests lo
    // pueblan a mano, simulando lo que POST /runs + streamRunLive harían
    // en producción (Grupo 1: ya no existe un `register` de una sola
    // llamada — hay que pasar por "pending" primero, como en producción).
    function buildLiveState() {
      const config: SimulationConfig = {
        gridWidth: 1,
        gridHeight: 1,
        baseCyclesPerUpdate: 20,
        mutationRate: 0,
        ancestorGenomes: [createUniformGenome("replicate", 5)],
        placementMode: "near-parent",
        updates: 5,
        seed: 42,
      };
      const state = createSimulationState(config);
      advanceGeneration(state); // deja el organismo sembrado en un estado real, no recién creado
      const organismId = state.grid.cells[0]!.id;
      return { state, organismId };
    }

    function registerLiveState(runId: string, state: SimulationState) {
      const parsed = parseCreateRunRequest({});
      if ("errors" in parsed) throw new Error("config de prueba inválida");
      liveRunRegistry.createPending(runId, BROWSER_A, parsed.config);
      liveRunRegistry.attachState(runId, state);
    }

    it("devuelve los cuatro campos acordados cuando la corrida está en vivo y el organismo existe", async () => {
      const { state, organismId } = buildLiveState();
      registerLiveState("run-viva", state);

      const res = await fetch(`${baseUrl}/runs/run-viva/organisms/${organismId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { generation: number; x: number; y: number; fitness: number; tasksSolved: string[] };

      expect(body).toMatchObject({ generation: state.generation, x: 0, y: 0 });
      expect(typeof body.fitness).toBe("number");
      expect(Array.isArray(body.tasksSolved)).toBe(true);

      liveRunRegistry.remove("run-viva");
    });

    it("404 con mensaje específico si la corrida no está activa en el servidor (terminada, o el servidor se reinició)", async () => {
      const res = await fetch(`${baseUrl}/runs/run-que-no-existe/organisms/algun-id`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("La corrida ya no está activa en el servidor");
    });

    it("404 con mensaje específico si la corrida ya TERMINÓ (Grupo 1: la entrada sigue en el registro para poder guardarla, pero eso no debe resucitar RF-027)", async () => {
      const { state, organismId } = buildLiveState();
      registerLiveState("run-terminada", state);
      liveRunRegistry.markFinished("run-terminada");

      const res = await fetch(`${baseUrl}/runs/run-terminada/organisms/${organismId}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("La corrida ya no está activa en el servidor");

      liveRunRegistry.remove("run-terminada");
    });

    it("404 con mensaje específico si la corrida existe pero sigue 'pending' (todavía no arrancó el streaming)", async () => {
      const parsed = parseCreateRunRequest({});
      if ("errors" in parsed) throw new Error("config de prueba inválida");
      liveRunRegistry.createPending("run-pendiente", BROWSER_A, parsed.config);

      const res = await fetch(`${baseUrl}/runs/run-pendiente/organisms/algun-id`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("La corrida ya no está activa en el servidor");

      liveRunRegistry.remove("run-pendiente");
    });

    it("404 con mensaje específico y DISTINTO si la corrida está viva pero ESE organismo puntual ya no existe", async () => {
      const { state } = buildLiveState();
      registerLiveState("run-viva-2", state);

      const res = await fetch(`${baseUrl}/runs/run-viva-2/organisms/id-que-nunca-existio`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Este organismo ya no existe — fue reemplazado o murió antes de que pudieras inspeccionarlo");

      liveRunRegistry.remove("run-viva-2");
    });
  });
});
