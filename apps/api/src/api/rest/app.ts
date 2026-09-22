import type { GetRunResponse, ListRunsResponse, PersistedRunConfig, RunMetadata, RunSummary } from "@camevo/shared-types";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { Express, Request, Response } from "express";
import { LiveRunRegistry } from "../live-run-registry";
import { RunRepository } from "../../persistence/repository/types";
import { CreateRunRequestBody, parseCreateRunRequest } from "./config-request";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * Grupo 1 (identidad por navegador): el frontend genera un UUID v4 en
 * localStorage y lo manda en cada request como header `X-Browser-ID` —
 * nunca en el body, para que no sea un campo que el cliente pueda
 * "escribir" arbitrariamente vía `CreateRunRequest` (ver shared-types:
 * `browserId` deliberadamente NO existe ahí). Se valida acá con el mismo
 * criterio de RNF-008 (límites contra abuso/recursos, no formato UUID
 * estricto — un valor "razonable" alcanza, no hace falta que sea
 * exactamente un UUID v4 para que el aislamiento por navegador funcione).
 *
 * Aclaración honesta, no solo técnica: esto NO es autenticación. Es
 * aislamiento casual entre navegadores distintos — cualquiera con las
 * devtools abiertas puede mandar cualquier valor en este header,
 * incluido el de otra persona si lo llegara a conocer. No hay login, no
 * hay verificación criptográfica; es exactamente lo que se pidió (sin
 * cuentas, sin email), no una barrera de seguridad real contra alguien
 * decidido.
 */
const MIN_BROWSER_ID_LENGTH = 8;
const MAX_BROWSER_ID_LENGTH = 128;

function isValidBrowserId(value: string): boolean {
  return value.length >= MIN_BROWSER_ID_LENGTH && value.length <= MAX_BROWSER_ID_LENGTH;
}

/** Devuelve el browser_id del header, o responde 400 y `null` si falta/es inválido — el llamador debe cortar ahí (`if (!browserId) return`). */
function requireBrowserId(req: Request, res: Response): string | null {
  const raw = req.header("X-Browser-ID");
  if (!raw || !isValidBrowserId(raw)) {
    res.status(400).json({ error: "Falta o es inválido el header X-Browser-ID" });
    return null;
  }
  return raw;
}

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

  /**
   * Grupo 1 (guardado intencional): esta ruta YA NO escribe a Postgres —
   * antes creaba la fila de `runs` acá mismo. Ahora solo valida la
   * config, resuelve la semilla, y deja todo "pending" en
   * `liveRunRegistry` (memoria) bajo un runId nuevo — el streaming en
   * vivo arranca desde ahí (ver server.ts) sin que la corrida haya
   * tocado la base todavía. Recién se persiste si el usuario hace click
   * en "Guardar esta corrida" (`POST /runs/:id/save`, más abajo).
   */
  app.post("/runs", (req, res) => {
    const browserId = requireBrowserId(req, res);
    if (!browserId) return;

    const parsed = parseCreateRunRequest((req.body ?? {}) as CreateRunRequestBody);
    if ("errors" in parsed) {
      res.status(400).json({ errors: parsed.errors });
      return;
    }

    const { config } = parsed;
    const runId = randomUUID();
    registry.createPending(runId, browserId, config);

    res.status(201).json({ runId, seed: config.seed, config });
  });

  /** RF-025 + Grupo 1: corridas GUARDADAS de ESTE navegador, más recientes primero — nunca las de otros (aislamiento por browser_id). */
  app.get("/runs", async (req, res) => {
    const browserId = requireBrowserId(req, res);
    if (!browserId) return;

    const limit = clampQueryNumber(req.query.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const offset = clampQueryNumber(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const { runs, hasMore } = await repository.listRuns({ limit, offset, browserId });
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

  /** Grupo 1: 403 (no 404) si la corrida existe pero es de OTRO browser_id — distinguir "no existe" de "no es tuya" es deliberado, no una fuga de info: ambos casos ya requieren conocer el id exacto (un UUID), así que no hay nada que "descubrir" confirmando que existe. */
  app.get("/runs/:id", async (req, res) => {
    const browserId = requireBrowserId(req, res);
    if (!browserId) return;

    const run = await repository.getRun(req.params.id as string);
    if (!run) {
      res.status(404).json({ error: "Corrida no encontrada" });
      return;
    }
    if (run.browserId !== browserId) {
      res.status(403).json({ error: "Esta corrida no te pertenece" });
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
   * Grupo 1 (guardado intencional): único punto donde una corrida
   * realmente llega a Postgres. Lee lo que `streamRunLive` acumuló en
   * `liveRunRegistry` (config + snapshots, todo en memoria hasta ahora)
   * y lo persiste de una vez — nunca antes de este click.
   *
   * Un click repetido (doble click, F5) no es un error: si ya estaba
   * guardada, responde 200 con `alreadySaved: true` en vez de fallar o
   * duplicar snapshots.
   */
  app.post("/runs/:runId/save", async (req, res) => {
    const browserId = requireBrowserId(req, res);
    if (!browserId) return;

    const runId = req.params.runId as string;
    const entry = registry.get(runId);
    if (!entry) {
      res.status(404).json({
        error: "Esta corrida ya no está disponible para guardar — pasó demasiado tiempo, o el servidor se reinició",
      });
      return;
    }
    if (entry.browserId !== browserId) {
      res.status(403).json({ error: "Esta corrida no te pertenece" });
      return;
    }
    if (entry.saved) {
      res.status(200).json({ runId, alreadySaved: true });
      return;
    }

    await repository.createRun({
      id: runId,
      config: entry.persistedConfig as unknown as Record<string, unknown>,
      seed: entry.persistedConfig.seed,
      browserId,
    });
    for (const snapshot of entry.snapshots) {
      await repository.saveSnapshot(runId, snapshot.generation, snapshot as unknown as Record<string, unknown>);
    }

    registry.markSaved(runId);
    res.status(201).json({ runId, alreadySaved: false });
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
    // Grupo 1: registry.get() ahora devuelve la entrada completa del
    // ciclo de vida (pending/en vivo/terminada/guardada), no directo el
    // SimulationState. El alcance de RF-027 sigue siendo el mismo de
    // siempre — solo una corrida que sigue TRANSMITIENDO en este momento
    // (ver el comentario grande más abajo) — así que acá cuentan como
    // "no activa" tanto "pending" (`.state` todavía null, el streaming no
    // arrancó) como "terminada" (`finishedAt` ya no es null): Grupo 1
    // mantiene la entrada viva más tiempo después de terminar (para poder
    // guardarla), pero eso no debería resucitar el detalle de un
    // organismo de una corrida que ya no está en curso.
    const entry = registry.get(req.params.runId as string);
    if (!entry || entry.finishedAt !== null || !entry.state) {
      res.status(404).json({ error: "La corrida ya no está activa en el servidor" });
      return;
    }
    const state = entry.state;

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
