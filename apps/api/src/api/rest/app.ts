import type { GetRunResponse, ListRunsResponse, PersistedRunConfig, RunMetadata, RunSummary } from "@camevo/shared-types";
import cors from "cors";
import express, { Express } from "express";
import { LiveRunRegistry } from "../live-run-registry";
import { RunRepository } from "../../persistence/repository/types";
import { CreateRunRequestBody, parseCreateRunRequest } from "./config-request";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * Fase 5: el `cors()` abierto de las fases de desarrollo local queda
 * restringido a una lista explícita de orígenes. Sin `CORS_ORIGIN`
 * (docker-compose.yml de desarrollo no la define), solo permite los
 * puertos donde corre `apps/web` localmente; producción la fija a
 * `https://camevo.ibsen-soto.pro` vía docker-compose.prod.yml.
 */
const DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

export function resolveAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    return DEFAULT_DEV_ORIGINS;
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Clampa un query param numérico de paginación, tolerando ausente/no-numérico/negativo. */
function clampQueryNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * api/rest mínima de la Fase 2: crear una corrida y consultarla (config +
 * snapshots persistidos hasta el momento). El streaming en vivo generación
 * a generación es responsabilidad de api/ws (ver ../ws/live-run.ts); esta
 * ruta solo deja la corrida creada y lista para que un cliente abra el
 * WebSocket correspondiente.
 */
export function createApp(repository: RunRepository, registry: LiveRunRegistry): Express {
  const app = express();
  app.use(cors({ origin: resolveAllowedOrigins() }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/runs", async (req, res) => {
    const parsed = parseCreateRunRequest((req.body ?? {}) as CreateRunRequestBody);
    if ("errors" in parsed) {
      res.status(400).json({ errors: parsed.errors });
      return;
    }

    const { config } = parsed;
    const run = await repository.createRun({
      config: config as unknown as Record<string, unknown>,
      seed: config.seed,
    });

    res.status(201).json({ runId: run.id, seed: run.seed, config: run.config });
  });

  /** RF-025: corridas guardadas más recientes primero, para el selector de comparación histórica. */
  app.get("/runs", async (req, res) => {
    const limit = clampQueryNumber(req.query.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const offset = clampQueryNumber(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const { runs, hasMore } = await repository.listRuns({ limit, offset });
    const body: ListRunsResponse = {
      runs: runs.map(
        (run): RunSummary => ({
          id: run.id,
          seed: run.seed,
          createdAt: run.createdAt,
          config: run.config as unknown as PersistedRunConfig,
          endedInExtinction: run.endedInExtinction,
          snapshotCount: run.snapshotCount,
        }),
      ),
      hasMore,
    };
    res.json(body);
  });

  app.get("/runs/:id", async (req, res) => {
    const run = await repository.getRun(req.params.id as string);
    if (!run) {
      res.status(404).json({ error: "Corrida no encontrada" });
      return;
    }

    const snapshots = await repository.listSnapshots(run.id);
    const runMetadata: RunMetadata = {
      id: run.id,
      seed: run.seed,
      createdAt: run.createdAt,
      config: run.config as unknown as PersistedRunConfig,
    };
    const body: GetRunResponse = {
      run: runMetadata,
      snapshots: snapshots.map((s) => s.snapshot) as unknown as GetRunResponse["snapshots"],
    };
    res.json(body);
  });

  /**
   * RF-027: detalle de un organismo puntual, bajo demanda (click en una
   * celda de la grilla) — no en cada snapshot de WS, para no inflar el
   * streaming en vivo (RNF-001, ver docs/03-arquitectura.md §4.1).
   *
   * Alcance reducido respecto a lo documentado originalmente: solo sirve
   * la generación ACTUAL de una corrida que sigue en vivo en ESTE
   * proceso — no generaciones pasadas ni corridas ya guardadas (RF-025).
   * El motivo es de raíz, no una limitación de esta ruta: el genoma y
   * `tasksSolved` de un organismo nunca se persisten (solo
   * `{id,x,y,fitness}` llega a la base — ver `OrganismSummary`), así que
   * no hay de dónde reconstruirlos una vez que la generación pasó. Por
   * eso la URL no lleva `:generation` como sugería el diseño original:
   * prometer esa ruta habría sido pedir algo que el servidor no puede
   * cumplir (ver la nota actualizada en 03-arquitectura.md §4.1).
   *
   * Dos 404 distintos, cada uno con su propio mensaje — no un genérico:
   * la corrida entera puede no estar en vivo (terminó, o el servidor se
   * reinició — el registro es un Map en memoria, no sobrevive un
   * restart), o la corrida SÍ está en vivo pero ESE organismo puntual ya
   * no existe (murió o fue reemplazado entre que el usuario vio el
   * snapshot y decidió hacer click).
   */
  app.get("/runs/:runId/organisms/:organismId", (req, res) => {
    const state = registry.get(req.params.runId as string);
    if (!state) {
      res.status(404).json({ error: "La corrida ya no está activa en el servidor" });
      return;
    }

    const index = state.grid.cells.findIndex((organism) => organism?.id === req.params.organismId);
    if (index === -1) {
      res.status(404).json({ error: "Este organismo ya no existe — fue reemplazado o murió antes de que pudieras inspeccionarlo" });
      return;
    }

    const organism = state.grid.cells[index]!;
    const { x, y } = state.grid.coordsOf(index);
    res.json({
      generation: state.generation,
      x,
      y,
      fitness: organism.offspringProduced,
      tasksSolved: [...organism.tasksSolved],
    });
  });

  return app;
}
