import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunPanel from "../src/components/RunPanel";
import type { RunHandle } from "../src/hooks/useRun";
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

    render(<RunPanel title="Corrida histórica" climateEnabled climateChangeSpeed="fast" run={historicalRunHandle(snapshots)} />);

    expect(screen.getByText(/se extinguió en la generación 4/i)).toBeInTheDocument();
    expect(screen.getByText(/deuda de extinción/i)).toBeInTheDocument();
  });

  it("narra la cuasi-extinción correctamente en la misma condición de un solo render", () => {
    const snapshots = [
      snapshot({ generation: 0, averageFitness: 1 }),
      snapshot({ generation: 1, averageFitness: 1 }),
      snapshot({ generation: 2, populationSize: 5, nearExtinct: true }),
    ];

    render(<RunPanel title="Corrida histórica" climateEnabled climateChangeSpeed="fast" run={historicalRunHandle(snapshots)} />);

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

    render(<RunPanel title="Corrida histórica" climateEnabled climateChangeSpeed="slow" run={historicalRunHandle(snapshots)} />);

    expect(screen.getAllByText(/rescate evolutivo/i).length).toBeGreaterThan(0);
    expect(document.querySelector(".status-line")).toHaveTextContent(/estado:\s*done/i);
  });
});
