import type { PersistedRunConfig } from "@camevo/shared-types";
import http from "node:http";
import { WebSocketServer } from "ws";
import { RunRepository } from "../persistence/repository/types";
import { createApp } from "./rest/app";
import { buildSimulationConfig } from "./rest/config-request";
import { streamRunLive } from "./ws/live-run";

const STREAM_PATH = /^\/runs\/([^/]+)\/stream$/;

/**
 * Ensambla api/rest + api/ws sobre un mismo servidor HTTP. Separado de
 * main.ts (que sí conecta a Postgres real) para poder testear las rutas y
 * el streaming en memoria, sin Docker.
 */
export function createServer(repository: RunRepository, msPerGeneration = 80): http.Server {
  const app = createApp(repository);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const match = STREAM_PATH.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const runId = match[1] as string;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, runId);
    });
  });

  wss.on("connection", (ws, runId: string) => {
    void (async () => {
      const run = await repository.getRun(runId);
      if (!run) {
        ws.send(JSON.stringify({ type: "error", message: "Corrida no encontrada" }));
        ws.close();
        return;
      }

      const persistedConfig = run.config as unknown as PersistedRunConfig;
      const config = buildSimulationConfig(persistedConfig);
      await streamRunLive(runId, config, repository, ws, msPerGeneration);
    })();
  });

  return server;
}
