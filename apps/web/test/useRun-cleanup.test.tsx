import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRun } from "../src/hooks/useRun";

/*
 * Se mockea el cliente para observar el handle del stream sin abrir un socket
 * real: lo que se verifica es el CONTRATO de desmontaje del hook, no la red.
 */
const close = vi.fn();
const send = vi.fn();
vi.mock("../src/lib/camevo-client", () => ({
  createRun: vi.fn().mockResolvedValue({ runId: "run-1" }),
  saveRun: vi.fn(),
  connectToRunStream: vi.fn(() => ({ close, send })),
}));

function Harness() {
  const run = useRun();
  return (
    <button type="button" onClick={() => void run.start({} as never)}>
      arrancar
    </button>
  );
}

afterEach(() => {
  close.mockClear();
  send.mockClear();
});

describe("useRun — liberación al desmontar", () => {
  it("cierra el stream si el hook se desmonta con una corrida en curso", async () => {
    const { getByRole, unmount } = render(<Harness />);
    await act(async () => {
      getByRole("button").click();
    });
    expect(close).not.toHaveBeenCalled(); // nada se cerró todavía

    unmount();

    // Sin el cleanup, el socket y su watchdog quedan vivos y el servidor
    // sigue calculando generaciones que nadie va a recibir.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("desmontar sin haber arrancado ninguna corrida no falla", () => {
    const { unmount } = render(<Harness />);
    expect(() => unmount()).not.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});
