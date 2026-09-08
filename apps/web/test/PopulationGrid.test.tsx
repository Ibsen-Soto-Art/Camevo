import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PopulationGrid from "../src/components/PopulationGrid";
import type { GenerationSnapshot } from "../src/lib/camevo-client";

function snapshot(overrides: Partial<GenerationSnapshot>): GenerationSnapshot {
  return {
    generation: 0,
    populationSize: 0,
    births: 0,
    averageFitness: 0,
    tasksSolvedThisUpdate: 0,
    climate: [],
    organisms: [],
    geneticDiversity: 0,
    extinct: false,
    nearExtinct: false,
    ...overrides,
  };
}

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** Mock de canvas propio (no el no-op global de test/setup.ts): registra cada fillRect con el fillStyle vigente en ese momento. */
function mockCanvasContext() {
  const calls: FillRectCall[] = [];
  let currentFillStyle = "";
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ x, y, w, h, color: currentFillStyle });
    }),
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    get fillStyle() {
      return currentFillStyle;
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return calls;
}

describe("<PopulationGrid /> (RF-024)", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("no renderiza nada si todavía no hay ningún snapshot", () => {
    const { container } = render(<PopulationGrid snapshots={[]} gridWidth={5} gridHeight={5} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("pinta una celda por cada organismo vivo, y deja las demás como vacías", () => {
    const calls = mockCanvasContext();
    const snap = snapshot({
      organisms: [
        { id: "a", x: 0, y: 0, fitness: 5 },
        { id: "b", x: 2, y: 1, fitness: 3 },
      ],
    });

    render(<PopulationGrid snapshots={[snap]} gridWidth={3} gridHeight={2} />);

    // 1 fillRect para el fondo completo (todo "vacío" primero) + 1 por organismo vivo.
    expect(calls.length).toBe(1 + 2);
    const backgroundFill = calls[0];
    expect(backgroundFill.w).toBeGreaterThan(0); // el fondo cubre todo el canvas, no una celda

    const organismFills = calls.slice(1);
    expect(organismFills).toHaveLength(2);
    // Ningún organismo comparte exactamente el color del fondo vacío.
    for (const fill of organismFills) {
      expect(fill.color).not.toBe(backgroundFill.color);
    }
  });

  it("normaliza el color contra el máximo HISTÓRICO de la corrida, no el del snapshot actual", () => {
    const calls1 = mockCanvasContext();
    // Snapshot temprano: el mejor organismo de la corrida hasta ahora tiene fitness 10.
    const early = snapshot({ generation: 0, organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[early]} gridWidth={1} gridHeight={1} />);
    const earlyColor = calls1.at(-1)?.color;

    const calls2 = mockCanvasContext();
    // Mismo snapshot final visualmente (mismo organismo, fitness 10), pero esta vez la
    // corrida YA vio un pico histórico de 100 en un snapshot anterior — mismo valor
    // absoluto de fitness, pero relativamente mucho más débil que lo mejor que esa
    // corrida logró. Con normalización por snapshot (la opción rechazada), ambos
    // colores serían idénticos (siempre el máximo de su propio snapshot); con el
    // máximo histórico, el segundo debe verse más apagado.
    const peak = snapshot({ generation: 1, organisms: [{ id: "b", x: 0, y: 0, fitness: 100 }] });
    const later = snapshot({ generation: 2, organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[early, peak, later]} gridWidth={1} gridHeight={1} />);
    const laterColor = calls2.at(-1)?.color;

    expect(laterColor).not.toBe(earlyColor);
  });

  it("un organismo con el fitness histórico máximo se pinta con el color más saludable (verde)", () => {
    const calls = mockCanvasContext();
    const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} />);

    const organismColor = calls.at(-1)?.color ?? "";
    expect(organismColor).toContain("hsl(120"); // hue=120 = verde puro, extremo saludable de la escala
  });
});
