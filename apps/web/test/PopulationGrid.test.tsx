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
    catastropheOccurred: false,
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

interface StrokeRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  lineWidth: number;
}

/** Mock de canvas propio (no el no-op global de test/setup.ts): registra cada fillRect/strokeRect con el estilo vigente en ese momento. */
function mockCanvasContext() {
  const fills: FillRectCall[] = [];
  const strokes: StrokeRectCall[] = [];
  let currentFillStyle = "";
  let currentStrokeStyle = "";
  let currentLineWidth = 1;
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fills.push({ x, y, w, h, color: currentFillStyle });
    }),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      strokes.push({ x, y, w, h, color: currentStrokeStyle, lineWidth: currentLineWidth });
    }),
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    get fillStyle() {
      return currentFillStyle;
    },
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
    },
    get strokeStyle() {
      return currentStrokeStyle;
    },
    set lineWidth(value: number) {
      currentLineWidth = value;
    },
    get lineWidth() {
      return currentLineWidth;
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return { fills, strokes };
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
    const { fills } = mockCanvasContext();
    const snap = snapshot({
      organisms: [
        { id: "a", x: 0, y: 0, fitness: 5 },
        { id: "b", x: 2, y: 1, fitness: 3 },
      ],
    });

    render(<PopulationGrid snapshots={[snap]} gridWidth={3} gridHeight={2} />);

    // 1 fillRect para el fondo completo (todo "vacío" primero) + 1 por organismo vivo.
    expect(fills.length).toBe(1 + 2);
    const backgroundFill = fills[0];
    expect(backgroundFill.w).toBeGreaterThan(0); // el fondo cubre todo el canvas, no una celda

    const organismFills = fills.slice(1);
    expect(organismFills).toHaveLength(2);
    // Ningún organismo comparte exactamente el color del fondo vacío.
    for (const fill of organismFills) {
      expect(fill.color).not.toBe(backgroundFill.color);
    }
  });

  it("normaliza el color contra el máximo HISTÓRICO de la corrida, no el del snapshot actual", () => {
    const render1 = mockCanvasContext();
    // Snapshot temprano: el mejor organismo de la corrida hasta ahora tiene fitness 10.
    const early = snapshot({ generation: 0, organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[early]} gridWidth={1} gridHeight={1} />);
    const earlyColor = render1.fills.at(-1)?.color;

    const render2 = mockCanvasContext();
    // Mismo snapshot final visualmente (mismo organismo, fitness 10), pero esta vez la
    // corrida YA vio un pico histórico de 100 en un snapshot anterior — mismo valor
    // absoluto de fitness, pero relativamente mucho más débil que lo mejor que esa
    // corrida logró. Con normalización por snapshot (la opción rechazada), ambos
    // colores serían idénticos (siempre el máximo de su propio snapshot); con el
    // máximo histórico, el segundo debe verse más apagado.
    const peak = snapshot({ generation: 1, organisms: [{ id: "b", x: 0, y: 0, fitness: 100 }] });
    const later = snapshot({ generation: 2, organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[early, peak, later]} gridWidth={1} gridHeight={1} />);
    const laterColor = render2.fills.at(-1)?.color;

    expect(laterColor).not.toBe(earlyColor);
  });

  it("un organismo con el fitness histórico máximo se pinta con el color más saludable (verde)", () => {
    const { fills } = mockCanvasContext();
    const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} />);

    const organismColor = fills.at(-1)?.color ?? "";
    expect(organismColor).toContain("hsl(120"); // hue=120 = verde puro, extremo saludable de la escala
  });

  describe("destello de borde en eventos catastróficos (RF-015)", () => {
    it("sin catastropheOccurred, no dibuja ningún borde", () => {
      const { strokes } = mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} />);
      expect(strokes).toHaveLength(0);
    });

    it("con catastropheOccurred=true en el último snapshot, dibuja un borde alrededor de todo el canvas", () => {
      const { strokes } = mockCanvasContext();
      const before = snapshot({ generation: 0, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const event = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      render(<PopulationGrid snapshots={[before, event]} gridWidth={1} gridHeight={1} />);

      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.lineWidth).toBeGreaterThan(0);
    });

    it("el destello es de un solo frame: el snapshot SIGUIENTE sin evento no repite el borde", () => {
      const { strokes } = mockCanvasContext();
      const event = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      const after = snapshot({ generation: 2, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });

      const { rerender } = render(<PopulationGrid snapshots={[event]} gridWidth={1} gridHeight={1} />);
      expect(strokes).toHaveLength(1);

      rerender(<PopulationGrid snapshots={[event, after]} gridWidth={1} gridHeight={1} />);
      expect(strokes).toHaveLength(1); // sigue en 1: el redibujado de "after" no agregó un borde nuevo
    });
  });
});
