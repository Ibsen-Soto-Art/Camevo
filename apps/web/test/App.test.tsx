import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

/**
 * Base mínima de testing para apps/web (deuda anotada al cerrar la
 * Fase 2): estos tests existen para que un bug de cableado — un campo
 * de formulario que ya no coincide con lo que la API espera, un
 * mensaje de WebSocket mal manejado — se note en `npm test`, sin
 * depender de que alguien abra el navegador. No reemplazan el smoke
 * test end-to-end contra servicios reales (ver README y
 * test/e2e/smoke.spec.ts): ese sigue siendo el único que hubiera
 * atrapado el bug real de CORS o la dependencia faltante de
 * `react-is`, porque ambos solo se manifiestan contra un backend/build
 * real, no contra mocks.
 */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;

  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  private readonly listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  close(): void {}
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<App />", () => {
  it("renderiza el formulario con valores por defecto razonables", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Camevo/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Ancho de grilla")).toHaveValue(20);
    expect(screen.getByLabelText("Alto de grilla")).toHaveValue(20);
    expect(screen.getByRole("button", { name: "Iniciar corrida" })).toBeEnabled();
  });

  it("al iniciar una corrida, llama a POST /runs con la configuración del formulario y abre el WebSocket del runId devuelto", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runId: "run-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Iniciar corrida" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/runs");
    expect(JSON.parse(options.body as string)).toMatchObject({ gridWidth: 20, gridHeight: 20 });

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0]?.url).toContain("/runs/run-123/stream");
    expect(await screen.findByText(/run-123/)).toBeInTheDocument();
  });

  it("muestra el fitness y termina en estado 'done' al recibir los mensajes del WebSocket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ runId: "run-456" }) }),
    );

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Iniciar corrida" }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    socket.emit("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: {
          generation: 0,
          populationSize: 10,
          births: 5,
          averageFitness: 0.5,
          tasksSolvedThisUpdate: 0,
          climate: [{ taskId: "NOT", rewardMultiplier: 2 }],
          organisms: [],
          geneticDiversity: 0.1,
        },
      }),
    });
    socket.emit("message", { data: JSON.stringify({ type: "done" }) });

    await waitFor(() => {
      expect(document.querySelector(".status-line")).toHaveTextContent(/estado:\s*done/i);
    });

    // RF-026: el panel explicativo aparece una vez que hay snapshots.
    expect(document.querySelector(".explanatory-panel")).toBeInTheDocument();
  });

  it("muestra un mensaje de error si la creación de la corrida falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ errors: ["gridWidth inválido"] }) }),
    );

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Iniciar corrida" }));

    expect(await screen.findByText(/gridWidth inválido/)).toBeInTheDocument();
  });

  it("incluye la velocidad climática elegida en el body de POST /runs (RF-012)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ runId: "run-speed" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.selectOptions(screen.getByLabelText("Velocidad del cambio climático"), "fast");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar corrida" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toMatchObject({ climateChangeSpeed: "fast", climateEnabled: true });
  });

  it("modo comparación: arranca dos corridas con velocidades distintas y muestra dos paneles (RF-025)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ runId: "run-a" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ runId: "run-b" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(screen.getByRole("checkbox", { name: /modo comparación/i }));

    expect(screen.getByLabelText(/velocidad climática — corrida a/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/velocidad climática — corrida b/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Iniciar ambas corridas" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string) as { climateChangeSpeed: string });
    const speeds = bodies.map((b) => b.climateChangeSpeed).sort();
    expect(speeds).toEqual(["fast", "slow"]);

    expect(await screen.findByText(/run-a/)).toBeInTheDocument();
    expect(await screen.findByText(/run-b/)).toBeInTheDocument();
  });
});
