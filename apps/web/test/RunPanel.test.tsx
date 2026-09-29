import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunPanel from "../src/components/RunPanel";
import type { RunHandle, RunStatus, SaveStatus } from "../src/hooks/useRun";
import type { GenerationSnapshot } from "../src/lib/camevo-client";

function snapshot(overrides: Partial<GenerationSnapshot>): GenerationSnapshot {
  return {
    generation: 0,
    populationSize: 100,
    births: 50,
    averageFitness: 1,
    tasksSolvedThisUpdate: 0,
    climate: [],
    organisms: [],
    geneticDiversity: 0.1,
    extinct: false,
    nearExtinct: false,
    catastropheOccurred: false,
    ...overrides,
  };
}

/**
 * Pedido explícito antes de implementar useHistoricalRun: confirmar CON
 * UN TEST (no de memoria/lectura de código) que ExplanatoryPanel narra
 * correctamente el desenlace de extinción cuando recibe el array
 * COMPLETO de snapshots de una corrida ya guardada en una sola pasada
 * (como hará useHistoricalRun, vía GET /runs/:id), no evento a evento
 * como el streaming en vivo con cierre "done" (useRun).
 *
 * Este objeto simula exactamente eso: un `RunHandle`-shape con
 * status="done" y `snapshots` ya completo desde el primer render, sin
 * ninguna actualización incremental posterior — ningún setState
 * progresivo, ningún mensaje "done" llegando después. Si la lógica de
 * ExplanatoryPanel dependiera implícitamente de recibir los snapshots
 * uno a uno (algo que la lectura del código no sugiere: es una función
 * pura de `snapshots.at(-1)`/`.slice()`, sin estado acumulado propio),
 * este test lo hubiera revelado.
 */
function historicalRunHandle(snapshots: GenerationSnapshot[]): RunHandle {
  return {
    status: "done",
    runId: "historical-run-id",
    snapshots,
    errorMessage: null,
    start: async () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
    save: async () => {},
    saveStatus: "unsaved",
    saveError: null,
  };
}

describe("<RunPanel /> — alimentado con un array completo de una sola vez (patrón de corrida histórica)", () => {
  it("narra la extinción correctamente cuando todos los snapshots llegan juntos en el primer render", () => {
    const snapshots = [
      snapshot({ generation: 0, averageFitness: 1 }),
      snapshot({ generation: 1, averageFitness: 1 }),
      snapshot({ generation: 2, averageFitness: 1 }),
      snapshot({ generation: 3, averageFitness: 1 }),
      snapshot({ generation: 4, populationSize: 0, averageFitness: 0, extinct: true }),
    ];

    render(
      <RunPanel
        title="Corrida histórica"
        climateEnabled
        climateChangeSpeed="fast"
        run={historicalRunHandle(snapshots)}
        gridWidth={10}
        gridHeight={10}
        numAncestors={1}
      />,
    );

    expect(screen.getByText(/se extinguió en la generación 4/i)).toBeInTheDocument();
    expect(screen.getByText(/deuda de extinción/i)).toBeInTheDocument();
  });

  it("narra la cuasi-extinción correctamente en la misma condición de un solo render", () => {
    const snapshots = [
      snapshot({ generation: 0, averageFitness: 1 }),
      snapshot({ generation: 1, averageFitness: 1 }),
      snapshot({ generation: 2, populationSize: 5, nearExtinct: true }),
    ];

    render(
      <RunPanel
        title="Corrida histórica"
        climateEnabled
        climateChangeSpeed="fast"
        run={historicalRunHandle(snapshots)}
        gridWidth={10}
        gridHeight={10}
        numAncestors={1}
      />,
    );

    expect(screen.getByText(/5 organismos/)).toBeInTheDocument();
    expect(screen.getByText(/todavía no es\s*extinción total/i)).toBeInTheDocument();
  });

  it("narra rescate evolutivo normal cuando no hay extinción, también en un solo render", () => {
    const snapshots = [
      snapshot({ generation: 0, averageFitness: 1 }),
      snapshot({ generation: 1, averageFitness: 1 }),
      snapshot({ generation: 2, averageFitness: 1 }),
      snapshot({ generation: 3, averageFitness: 1 }),
      snapshot({ generation: 4, averageFitness: 2 }),
      snapshot({ generation: 5, averageFitness: 2 }),
      snapshot({ generation: 6, averageFitness: 2 }),
      snapshot({ generation: 7, averageFitness: 2 }),
    ];

    render(
      <RunPanel
        title="Corrida histórica"
        climateEnabled
        climateChangeSpeed="slow"
        run={historicalRunHandle(snapshots)}
        gridWidth={10}
        gridHeight={10}
        numAncestors={1}
      />,
    );

    expect(screen.getAllByText(/rescate evolutivo/i).length).toBeGreaterThan(0);
    expect(document.querySelector(".status-line")).toHaveTextContent(/estado:\s*finalizada/i);
  });
});

/**
 * Grupo 1 (Cambio 1B), pregunta de re-auditoría: confirmar con un test —
 * no solo con lectura del código — que "Guardar esta corrida" (1) nunca
 * aparece mientras la corrida sigue corriendo, solo una vez "done", y
 * (2) tras guardarla pasa a un botón "Guardada ✓" deshabilitado, no a un
 * botón que se pueda volver a clickear (esa es la protección real contra
 * doble guardado del lado de la UI, además del `alreadySaved` idempotente
 * del backend).
 */
function liveRunHandle(status: RunStatus, saveStatus: SaveStatus): RunHandle {
  return {
    status,
    runId: "live-run-id",
    snapshots: [],
    errorMessage: null,
    start: async () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
    save: async () => {},
    saveStatus,
    saveError: saveStatus === "error" ? "No se pudo guardar la corrida (HTTP 500)" : null,
  };
}

describe("<RunPanel /> — botón 'Guardar esta corrida' (Grupo 1)", () => {
  it("no aparece mientras la corrida sigue en curso (running)", () => {
    render(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="moderate"
        run={liveRunHandle("running", "unsaved")}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
        onSave={() => {}}
        saveStatus="unsaved"
        saveError={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Guardar esta corrida" })).not.toBeInTheDocument();
  });

  it("aparece una vez que la corrida llegó a 'done', y pasa a 'Guardada ✓' deshabilitado tras guardar", () => {
    const { rerender } = render(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="moderate"
        run={liveRunHandle("done", "unsaved")}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
        onSave={() => {}}
        saveStatus="unsaved"
        saveError={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Guardar esta corrida" })).toBeEnabled();

    rerender(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="moderate"
        run={liveRunHandle("done", "saved")}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
        onSave={() => {}}
        saveStatus="saved"
        saveError={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Guardar esta corrida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardada ✓" })).toBeDisabled();
  });

  it("sin onSave (corrida histórica: ya está guardada por definición) nunca muestra el botón, aunque status sea 'done'", () => {
    render(
      <RunPanel
        title="Corrida histórica"
        climateEnabled
        climateChangeSpeed="moderate"
        run={historicalRunHandle([])}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
      />,
    );

    expect(screen.queryByRole("button", { name: "Guardar esta corrida" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardada ✓" })).not.toBeInTheDocument();
  });
});

/**
 * El predicado que decide si la grilla invita al click vive acá, en
 * RunPanel — PopulationGrid solo recibe el booleano ya resuelto. Estos
 * tests recorren los cuatro estados reales de RunStatus que pueden
 * llegar con snapshots, porque un predicado mal escrito (p. ej.
 * `status === "running"` a secas, que apagaría la inspección al pausar)
 * no lo atraparía ningún test sobre PopulationGrid.
 */
describe("<RunPanel /> — click-to-inspect solo mientras la corrida sigue abierta en el servidor", () => {
  const INERT_TEXT = "La inspección de organismos solo está disponible durante una corrida en vivo.";
  const INVITE_TEXT = "Hacé click en una celda para ver el detalle de ese organismo.";

  function renderWithStatus(status: RunStatus) {
    return render(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="moderate"
        run={{ ...historicalRunHandle([snapshot({ generation: 0 })]), status }}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
      />,
    );
  }

  it.each<RunStatus>(["running", "paused"])(
    "status '%s': la corrida sigue viva en el LiveRunRegistry, así que la grilla invita al click",
    (status) => {
      const { container } = renderWithStatus(status);
      expect(container.querySelector(".population-grid-hint")).toHaveTextContent(INVITE_TEXT);
      expect(container.querySelector("canvas")?.className).not.toContain("population-grid-canvas-inert");
    },
  );

  it.each<RunStatus>(["done", "error"])(
    "status '%s': el registro ya cerró esa corrida, así que la grilla deja de invitar",
    (status) => {
      const { container } = renderWithStatus(status);
      expect(container.querySelector(".population-grid-hint")).toHaveTextContent(INERT_TEXT);
      expect(container.querySelector("canvas")?.className).toContain("population-grid-canvas-inert");
    },
  );

  it("una corrida extinta (done + extinct) tampoco invita al click", () => {
    const { container } = render(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="fast"
        run={historicalRunHandle([snapshot({ generation: 4, populationSize: 0, extinct: true })])}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
      />,
    );
    expect(container.querySelector(".population-grid-hint")).toHaveTextContent(INERT_TEXT);
  });

  it("pausar NO apaga la inspección: es la diferencia concreta entre el predicado correcto y `status === \"running\"` a secas", () => {
    const { container: running } = renderWithStatus("running");
    const { container: paused } = renderWithStatus("paused");
    expect(paused.querySelector(".population-grid-hint")?.textContent).toBe(
      running.querySelector(".population-grid-hint")?.textContent,
    );
  });
});

/**
 * RNF-004: "estado: running" era la única cadena en inglés visible en
 * toda la interfaz (verificado recorriendo los nodos de texto de la
 * página en una auditoría exploratoria).
 */
describe("<RunPanel /> — el estado de la corrida se muestra en español", () => {
  function renderWithStatus(status: RunStatus) {
    return render(
      <RunPanel
        title="Corrida"
        climateEnabled
        climateChangeSpeed="moderate"
        run={{ ...historicalRunHandle([snapshot({ generation: 0 })]), status }}
        gridWidth={5}
        gridHeight={5}
        numAncestors={1}
      />,
    );
  }

  it.each<[RunStatus, string]>([
    ["running", "en curso"],
    ["paused", "pausada"],
    ["done", "finalizada"],
    ["error", "error"],
  ])("status '%s' se muestra como '%s'", (status, label) => {
    const { container } = renderWithStatus(status);
    const line = container.querySelector(".status-line")!;
    expect(line).toHaveTextContent(`estado: ${label}`);
    expect(line.textContent).not.toMatch(/\b(running|paused|done|idle)\b/);
  });

  it("status 'idle': no se muestra la línea de estado — una corrida que no arrancó no tiene nada que informar", () => {
    const { container } = renderWithStatus("idle");
    expect(container.querySelector(".status-line")).toBeNull();
  });
});
