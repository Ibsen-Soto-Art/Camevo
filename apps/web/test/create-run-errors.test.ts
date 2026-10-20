import { afterEach, describe, expect, it, vi } from "vitest";
import { createRun } from "../src/lib/camevo-client";

/**
 * RNF-008 / RNF-004: el servidor tiene DOS formas de error en POST /runs, y
 * antes solo una llegaba al usuario con sentido. Un 422 por carga total caía
 * en el genérico "No se pudo crear la corrida (HTTP 422)", que no dice qué
 * cambiar — el caso que estos tests fijan.
 */
function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );
}

const values = { gridWidth: 40, gridHeight: 40, updates: 5000 } as unknown as Parameters<typeof createRun>[0];

afterEach(() => vi.unstubAllGlobals());

describe("createRun — errores del servidor", () => {
  it("un 422 por carga llega con su mensaje y sus límites, no con el genérico", async () => {
    respond(422, {
      error: "simulation_too_large",
      message: "La configuración supera la capacidad del servidor.",
      limits: { maxCells: 1600, maxGenerations: 5000, maxLoad: 3_000_000 },
    });

    await expect(createRun(values)).rejects.toThrow(
      "La configuración supera la capacidad del servidor. Máximos: 1600 células, 5000 generaciones, carga 3000000.",
    );
  });

  it("un 422 sin `limits` igual muestra el mensaje del servidor", async () => {
    respond(422, { error: "simulation_too_large", message: "La configuración supera la capacidad del servidor." });
    await expect(createRun(values)).rejects.toThrow("La configuración supera la capacidad del servidor.");
  });

  it("un 400 por campo sigue mostrando los errores de campo, sin cambios", async () => {
    respond(400, { errors: ["gridWidth debe estar entre 2 y 40", "updates debe estar entre 1 y 5000"] });
    await expect(createRun(values)).rejects.toThrow(
      "gridWidth debe estar entre 2 y 40, updates debe estar entre 1 y 5000",
    );
  });

  it("un error sin cuerpo reconocible cae en el genérico con el código HTTP", async () => {
    respond(503, {});
    await expect(createRun(values)).rejects.toThrow("No se pudo crear la corrida (HTTP 503)");
  });

  it("un cuerpo que no es JSON tampoco rompe: cae en el genérico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error("no es json")) }),
    );
    await expect(createRun(values)).rejects.toThrow("No se pudo crear la corrida (HTTP 502)");
  });
});
