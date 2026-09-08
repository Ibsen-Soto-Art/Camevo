import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ExplanatoryPanel from "../src/components/ExplanatoryPanel";
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

function risingSnapshots(): GenerationSnapshot[] {
  return [
    ...Array.from({ length: 4 }, (_, i) => snapshot({ generation: i, averageFitness: 1 })),
    ...Array.from({ length: 4 }, (_, i) => snapshot({ generation: 4 + i, averageFitness: 2 })),
  ];
}

describe("<ExplanatoryPanel /> — Fase 4: colapso/extinción tienen prioridad sobre la lectura de tendencia", () => {
  it("módulo climático desactivado: mensaje neutro, sin mencionar velocidad climática", () => {
    render(<ExplanatoryPanel climateEnabled={false} climateChangeSpeed="fast" snapshots={risingSnapshots()} numAncestors={1} />);
    expect(screen.getByText(/desactivado/i)).toBeInTheDocument();
    expect(screen.queryByText(/rápida/i)).not.toBeInTheDocument();
  });

  it("población extinguida: describe el hecho (generación exacta), no una interpretación de tendencia", () => {
    const snapshots = [...risingSnapshots(), snapshot({ generation: 8, populationSize: 0, averageFitness: 0, extinct: true })];
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="fast" snapshots={snapshots} numAncestors={1} />);

    expect(screen.getByText(/se extinguió en la generación 8/i)).toBeInTheDocument();
    expect(screen.getByText(/no puede recuperarse/i)).toBeInTheDocument();
    // El mensaje debe explicar QUE el tiempo hasta la extinción varía según
    // la adaptación de partida (deuda de extinción), no solo el hecho binario.
    expect(screen.getByText(/deuda de extinción/i)).toBeInTheDocument();
    expect(screen.getByText(/compra tiempo/i)).toBeInTheDocument();
    // No debe caer en el mensaje de "rescate evolutivo" solo porque el fitness venía subiendo antes de la extinción.
    expect(screen.queryByText(/rescate evolutivo/i)).not.toBeInTheDocument();
  });

  it("cuasi-extinción sostenida: reporta la población actual, y aclara que no es extinción total", () => {
    const snapshots = [...risingSnapshots(), snapshot({ generation: 8, populationSize: 7, nearExtinct: true })];
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="fast" snapshots={snapshots} numAncestors={1} />);

    expect(screen.getByText(/7 organismos/)).toBeInTheDocument();
    expect(screen.getByText(/todavía no es\s*extinción total/i)).toBeInTheDocument();
  });

  it("ni extinct ni nearExtinct: cae en la lectura de tendencia de fitness normal (rescate evolutivo)", () => {
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="slow" snapshots={risingSnapshots()} numAncestors={1} />);
    expect(screen.getAllByText(/rescate evolutivo/i).length).toBeGreaterThan(0);
  });

  it("extinct tiene prioridad sobre nearExtinct si por algún motivo ambos vinieran true en el último snapshot", () => {
    const snapshots = [snapshot({ generation: 3, populationSize: 0, extinct: true, nearExtinct: true })];
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="fast" snapshots={snapshots} numAncestors={1} />);
    expect(screen.getByText(/se extinguió/i)).toBeInTheDocument();
  });
});

describe("<ExplanatoryPanel /> — RF-008: visibilizar el sembrado de múltiples ancestros", () => {
  it("con clima activo y numAncestors=1 (el único valor que ofrece la UI hoy), dice 2 linajes — el mínimo real que siembra el servidor", () => {
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="slow" snapshots={risingSnapshots()} numAncestors={1} />);
    expect(screen.getByText(/2 linajes ancestrales distintos/i)).toBeInTheDocument();
  });

  it("con clima activo y numAncestors=3, respeta el valor pedido (no lo trunca al mínimo de 2)", () => {
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="slow" snapshots={risingSnapshots()} numAncestors={3} />);
    expect(screen.getByText(/3 linajes ancestrales distintos/i)).toBeInTheDocument();
  });

  it("con clima DESACTIVADO, no aplica el mínimo de 2 — respeta numAncestors=1 tal cual", () => {
    render(<ExplanatoryPanel climateEnabled={false} climateChangeSpeed="slow" snapshots={risingSnapshots()} numAncestors={1} />);
    expect(screen.queryByText(/linajes ancestrales distintos/i)).not.toBeInTheDocument();
  });

  it("la corrida terminó en extinción: la nota de linajes sigue presente, no desaparece justo cuando más importa", () => {
    const snapshots = [...risingSnapshots(), snapshot({ generation: 8, populationSize: 0, averageFitness: 0, extinct: true })];
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="fast" snapshots={snapshots} numAncestors={1} />);
    expect(screen.getByText(/2 linajes ancestrales distintos/i)).toBeInTheDocument();
  });

  it("cuasi-extinción: la nota de linajes también está presente", () => {
    const snapshots = [...risingSnapshots(), snapshot({ generation: 8, populationSize: 7, nearExtinct: true })];
    render(<ExplanatoryPanel climateEnabled climateChangeSpeed="fast" snapshots={snapshots} numAncestors={1} />);
    expect(screen.getByText(/2 linajes ancestrales distintos/i)).toBeInTheDocument();
  });
});
