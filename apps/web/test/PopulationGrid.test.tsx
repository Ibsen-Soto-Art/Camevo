import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PopulationGrid from "../src/components/PopulationGrid";
import type { GenerationSnapshot } from "../src/lib/camevo-client";

/** jsdom devuelve un rect todo en cero por defecto — sin esto, cellWidth/cellHeight darían 0 y el click no podría mapear a ninguna celda. */
function mockCanvasRect(size = 400) {
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
    () => ({ left: 0, top: 0, right: size, bottom: size, width: size, height: size, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
}

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

/** Mock de canvas propio (no el no-op global de test/setup.ts): registra cada fillRect con el estilo vigente en ese momento. */
function mockCanvasContext() {
  const fills: FillRectCall[] = [];
  let currentFillStyle = "";
  const ctx = {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fills.push({ x, y, w, h, color: currentFillStyle });
    }),
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    get fillStyle() {
      return currentFillStyle;
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return { fills };
}

describe("<PopulationGrid /> (RF-024)", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalGetBoundingClientRect = HTMLCanvasElement.prototype.getBoundingClientRect;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.unstubAllGlobals();
  });

  it("no renderiza nada si todavía no hay ningún snapshot", () => {
    const { container } = render(<PopulationGrid snapshots={[]} gridWidth={5} gridHeight={5} runId="test-run" />);
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

    render(<PopulationGrid snapshots={[snap]} gridWidth={3} gridHeight={2} runId="test-run" />);

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
    render(<PopulationGrid snapshots={[early]} gridWidth={1} gridHeight={1} runId="test-run" />);
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
    render(<PopulationGrid snapshots={[early, peak, later]} gridWidth={1} gridHeight={1} runId="test-run" />);
    const laterColor = render2.fills.at(-1)?.color;

    expect(laterColor).not.toBe(earlyColor);
  });

  it("un organismo con el fitness histórico máximo se pinta con el color más saludable (verde)", () => {
    const { fills } = mockCanvasContext();
    const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 10 }] });
    render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);

    const organismColor = fills.at(-1)?.color ?? "";
    expect(organismColor).toContain("hsl(120"); // hue=120 = verde puro, extremo saludable de la escala
  });

  describe("overlay de evento catastrófico (RF-015, Ajuste 2 — segunda ronda)", () => {
    // El borde perimetral rojo se reemplazó por un overlay ámbar sobre TODA
    // la grilla (fillRect, no strokeRect) + un texto flotante en el DOM —
    // ver el comentario de CATASTROPHE_OVERLAY_COLOR en PopulationGrid.tsx
    // para el porqué del color: el rojo ya significaba "fitness bajo".
    it("sin catastropheOccurred, no pinta el overlay ni muestra el texto del evento", () => {
      const { fills } = mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);

      // fondo + 1 organismo, nada más — ningún fillRect extra de overlay.
      expect(fills).toHaveLength(2);
      expect(screen.queryByText(/Evento catastrófico — gen/)).not.toBeInTheDocument();
    });

    it("con catastropheOccurred=true en el último snapshot, pinta un overlay ámbar sobre toda la grilla y muestra el texto", () => {
      const { fills } = mockCanvasContext();
      const before = snapshot({ generation: 0, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const event = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      render(<PopulationGrid snapshots={[before, event]} gridWidth={1} gridHeight={1} runId="test-run" />);

      // fondo + 1 organismo + el overlay del evento (el último fillRect).
      expect(fills).toHaveLength(3);
      const overlayFill = fills.at(-1)!;
      expect(overlayFill.color).toMatch(/245,\s*158,\s*11/); // rgba(245, 158, 11, ...) = #f59e0b, ámbar
      expect(overlayFill.w).toBeGreaterThan(0); // cubre TODO el canvas, no un borde delgado

      expect(screen.getByText(/Evento catastrófico — gen 1/)).toBeInTheDocument();
    });

    // RNF-004 (2ª verificación con persona real): el destello original
    // duraba un solo frame (80ms a ritmo default) — medido, imperceptible
    // en reproducción real. Se mantiene CATASTROPHE_FLASH_HOLD_GENERATIONS
    // generaciones desde el catastropheOccurred más reciente.
    it("el overlay persiste varias generaciones después del evento, no solo en la generación exacta", () => {
      mockCanvasContext();
      const event = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      const after = snapshot({ generation: 2, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });

      const { rerender } = render(<PopulationGrid snapshots={[event]} gridWidth={1} gridHeight={1} runId="test-run" />);
      expect(screen.getByText(/Evento catastrófico — gen 1/)).toBeInTheDocument();

      rerender(<PopulationGrid snapshots={[event, after]} gridWidth={1} gridHeight={1} runId="test-run" />);
      expect(screen.getByText(/Evento catastrófico — gen 1/)).toBeInTheDocument(); // "after" está dentro de la ventana de persistencia
    });

    it("el overlay deja de mostrarse una vez que pasó la ventana de persistencia", () => {
      mockCanvasContext();
      const event = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      const farAfter = snapshot({ generation: 50, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });

      render(<PopulationGrid snapshots={[event, farAfter]} gridWidth={1} gridHeight={1} runId="test-run" />);
      expect(screen.queryByText(/Evento catastrófico — gen/)).not.toBeInTheDocument(); // generación 50 está muy lejos del evento en generación 1
    });

    it("con dos eventos catastróficos, el overlay se ancla siempre al más reciente, no al primero", () => {
      mockCanvasContext();
      const firstEvent = snapshot({ generation: 1, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });
      const farAfterFirst = snapshot({ generation: 20, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const secondEvent = snapshot({ generation: 21, organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }], catastropheOccurred: true });

      const { rerender } = render(<PopulationGrid snapshots={[firstEvent, farAfterFirst]} gridWidth={1} gridHeight={1} runId="test-run" />);
      expect(screen.queryByText(/Evento catastrófico — gen/)).not.toBeInTheDocument(); // ya pasó la ventana del primer evento

      rerender(<PopulationGrid snapshots={[firstEvent, farAfterFirst, secondEvent]} gridWidth={1} gridHeight={1} runId="test-run" />);
      expect(screen.getByText(/Evento catastrófico — gen 21/)).toBeInTheDocument(); // el segundo evento reabre la ventana, con SU generación
    });
  });

  describe("leyenda visual (Ajuste 2, auditoría de interfaz post-producción)", () => {
    it("muestra las tres referencias: gradiente de fitness, hábitat vacío y evento catastrófico", () => {
      mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);
      const legend = within(container.querySelector(".population-grid-legend") as HTMLElement);

      expect(legend.getByText(/Fitness bajo/)).toBeInTheDocument();
      expect(legend.getByText(/Fitness alto/)).toBeInTheDocument();
      expect(legend.getByText(/Hábitat vacío/i)).toBeInTheDocument();
      expect(legend.getByText(/Evento catastrófico/i)).toBeInTheDocument();
    });

    it("RNF-004 (re-auditoría): 'fitness' se define en lenguaje llano la primera vez que aparece en el flujo visual", () => {
      mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);

      expect(screen.getByText("Fitness bajo (pocas crías)")).toBeInTheDocument();
      expect(screen.getByText("Fitness alto (muchas crías)")).toBeInTheDocument();
    });

    it("la barra de gradiente va de rojo (fitness bajo) a verde (fitness alto), igual que las celdas reales", () => {
      mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);

      const bar = container.querySelector(".grid-legend-bar") as HTMLElement;
      expect(bar.style.background).toContain("hsl(0, 70%, 45%)"); // mismo fitnessColor(0) que pinta las celdas
      expect(bar.style.background).toContain("hsl(120, 70%, 45%)"); // mismo fitnessColor(1)
    });

    it("Ajuste 5: la etiqueta 'Fitness alto' usa el mismo azul (#1f77b4) que la línea de fitness de RunChart — puente visual entre ambas leyendas", () => {
      mockCanvasContext();
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="test-run" />);

      expect(screen.getByText(/Fitness alto/)).toHaveClass("grid-legend-label-fitness-high");
    });
  });

  describe("click en una celda → detalle del organismo (RF-027)", () => {
    it("celda vacía: muestra el mensaje sin llamar al servidor", () => {
      mockCanvasContext();
      mockCanvasRect();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      // Grilla 2x1: un organismo en (0,0), la celda (1,0) queda vacía.
      const snap = snapshot({ organisms: [{ id: "a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={2} gridHeight={1} runId="run-1" />);

      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      fireEvent.click(canvas, { clientX: 300, clientY: 200 }); // mitad derecha → celda (1,0), vacía

      expect(container.querySelector(".organism-inspect-empty")).toHaveTextContent(/Hábitat vacío/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("celda con organismo: muestra 'consultando' y después los cuatro campos en lenguaje llano", async () => {
      mockCanvasContext();
      mockCanvasRect();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ generation: 12, x: 0, y: 0, fitness: 4, tasksSolved: ["NOT", "AND"] }),
        }),
      );

      const snap = snapshot({ organisms: [{ id: "org-a", x: 0, y: 0, fitness: 4 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="run-1" />);

      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      fireEvent.click(canvas, { clientX: 200, clientY: 200 });

      expect(screen.getByText(/Consultando el organismo/i)).toBeInTheDocument();

      await waitFor(() => expect(screen.getByText(/Produjo 4 crías/)).toBeInTheDocument());
      expect(screen.getByText(/Tareas lógicas que resuelve: NOT, AND/)).toBeInTheDocument();
      expect(screen.getByText(/Generación 12/)).toBeInTheDocument();
      expect(screen.getByText(/Posición en la grilla: \(0, 0\)/)).toBeInTheDocument();
    });

    it("sin tareas resueltas todavía, lo dice explícitamente en vez de mostrar una lista vacía", async () => {
      mockCanvasContext();
      mockCanvasRect();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ generation: 1, x: 0, y: 0, fitness: 0, tasksSolved: [] }) }),
      );

      const snap = snapshot({ organisms: [{ id: "org-a", x: 0, y: 0, fitness: 0 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="run-1" />);
      fireEvent.click(container.querySelector("canvas") as HTMLCanvasElement, { clientX: 200, clientY: 200 });

      await waitFor(() => expect(screen.getByText(/Todavía no resuelve ninguna tarea lógica/)).toBeInTheDocument());
    });

    it("404 de corrida no activa: muestra ese mensaje específico, tal cual lo manda el servidor", async () => {
      mockCanvasContext();
      mockCanvasRect();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ error: "La corrida ya no está activa en el servidor" }) }),
      );

      const snap = snapshot({ organisms: [{ id: "org-a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="run-1" />);
      fireEvent.click(container.querySelector("canvas") as HTMLCanvasElement, { clientX: 200, clientY: 200 });

      await waitFor(() => expect(screen.getByText("La corrida ya no está activa en el servidor")).toBeInTheDocument());
    });

    it("404 de organismo puntual: muestra un mensaje DISTINTO al de corrida no activa", async () => {
      mockCanvasContext();
      mockCanvasRect();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Este organismo ya no existe — fue reemplazado o murió antes de que pudieras inspeccionarlo" }),
        }),
      );

      const snap = snapshot({ organisms: [{ id: "org-a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId="run-1" />);
      fireEvent.click(container.querySelector("canvas") as HTMLCanvasElement, { clientX: 200, clientY: 200 });

      await waitFor(() =>
        expect(
          screen.getByText("Este organismo ya no existe — fue reemplazado o murió antes de que pudieras inspeccionarlo"),
        ).toBeInTheDocument(),
      );
    });

    it("sin runId (corrida sin id asignado todavía), no llama al servidor y avisa en vez de fallar en silencio", () => {
      mockCanvasContext();
      mockCanvasRect();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const snap = snapshot({ organisms: [{ id: "org-a", x: 0, y: 0, fitness: 1 }] });
      const { container } = render(<PopulationGrid snapshots={[snap]} gridWidth={1} gridHeight={1} runId={null} />);
      fireEvent.click(container.querySelector("canvas") as HTMLCanvasElement, { clientX: 200, clientY: 200 });

      expect(screen.getByText(/No se puede inspeccionar/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
