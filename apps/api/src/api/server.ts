import type { ControlMessage, PersistedRunConfig } from "@camevo/shared-types";
import http from "node:http";
import { WebSocketServer } from "ws";
import { RunRepository } from "../persistence/repository/types";
import { createApp, resolveAllowedOrigins } from "./rest/app";
import { buildSimulationConfig } from "./rest/config-request";
import { streamRunLive } from "./ws/live-run";
import { PlaybackControl } from "./ws/playback-control";

const STREAM_PATH = /^\/runs\/([^/]+)\/stream$/;

/**
 * Ensambla api/rest + api/ws sobre un mismo servidor HTTP. Separado de
 * main.ts (que sí conecta a Postgres real) para poder testear las rutas y
 * el streaming en memoria, sin Docker.
 *
 * RF-023: el ritmo de reproducción ya no es un parámetro del servidor
 * (antes `msPerGeneration` acá) — es un campo de cada corrida
 * (`PersistedRunConfig.msPerGeneration`, con default en config-request.ts),
 * ajustable en vivo por el propio cliente vía `ControlMessage`. Los tests
 * que antes usaban este parámetro para correr rápido ahora lo piden por
 * corrida en el body de `POST /runs`.
 */
export function createServer(repository: RunRepository): http.Server {
  const app = createApp(repository);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // El middleware `cors` de Express solo protege las rutas REST — un
    // handshake de WebSocket nunca pasa por ahí, así que sin esto
    // cualquier sitio podría abrir conexiones directas a `/runs/:id/stream`
    // pese a que la API REST ya rechace su origen.
    const origin = req.headers.origin;
    if (origin && !resolveAllowedOrigins().includes(origin)) {
      socket.destroy();
      return;
    }

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
      const control = new PlaybackControl(persistedConfig.msPerGeneration);

      // RF-023: mensajes de control del cliente sobre el mismo socket ya
      // abierto. Un mensaje malformado se ignora en silencio — no hay
      // razón para tumbar el streaming en curso por un JSON inválido.
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as ControlMessage;
          if (message.type === "pause") control.pause();
          else if (message.type === "resume") control.resume();
          else if (message.type === "setSpeed") control.setSpeed(message.msPerGeneration);
        } catch {
          /* mensaje malformado: se ignora */
        }
      });

      await streamRunLive(runId, config, repository, ws, control);
    })();
  });

  return server;
}
