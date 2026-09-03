import cors from "cors";
import express, { Express } from "express";
import { RunRepository } from "../../persistence/repository/types";
import { SimulationConfig } from "../../simulation/orchestrator/run";
import { CreateRunRequestBody, parseCreateRunRequest } from "./config-request";

/**
 * api/rest mínima de la Fase 2: crear una corrida y consultarla (config +
 * snapshots persistidos hasta el momento). El streaming en vivo generación
 * a generación es responsabilidad de api/ws (ver ../ws/live-run.ts); esta
 * ruta solo deja la corrida creada y lista para que un cliente abra el
 * WebSocket correspondiente.
 */
export function createApp(repository: RunRepository): Express {
  const app = express();
  // Sin esto, apps/web (puerto de Vite) no puede llamar a la API (otro
  // origen) — el navegador bloquea la respuesta por CORS. Abierto para
  // esta fase de desarrollo local; restringir por origen es tarea de la
  // Fase 5 (despliegue) si conviene, según cómo quede Nginx.
  app.use(cors());
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

  app.get("/runs/:id", async (req, res) => {
    const run = await repository.getRun(req.params.id as string);
    if (!run) {
      res.status(404).json({ error: "Corrida no encontrada" });
      return;
    }

    const snapshots = await repository.listSnapshots(run.id);
    res.json({ run, snapshots: snapshots.map((s) => s.snapshot) });
  });

  return app;
}

/** Reconstruye el SimulationConfig persistido (JSON plano) para reanudar/streamear una corrida. */
export function configFromRecord(config: Record<string, unknown>): SimulationConfig {
  return config as unknown as SimulationConfig;
}
