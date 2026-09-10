import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * jsdom no implementa HTMLCanvasElement.getContext (PopulationGrid, RF-024)
 * — sin este mock, cada render llena la consola con "Not implemented" y
 * el componente no puede dibujar nada en los tests. Un no-op por defecto
 * alcanza para los tests que no inspeccionan el canvas; los que sí lo
 * hacen (test/PopulationGrid.test.tsx) sobreescriben esto localmente con
 * un mock propio que sí registra las llamadas.
 */
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  strokeRect: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
});
