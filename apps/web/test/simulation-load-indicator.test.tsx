import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

/*
 * RNF-008: el aviso de carga del formulario y el botón deshabilitado. Mismo
 * problema de constante duplicada que `climate-variance-limit.test.tsx`, y la
 * misma solución: `@camevo/shared-types` es solo-tipos y no puede exportar
 * valores, así que el único guard automático contra la desincronización es
 * leer la fuente del backend.
 */
function monorepoRoot(): string {
  let dir = resolve(process.cwd());
  while (!existsSync(join(dir, "packages", "shared-types", "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("No se encontró la raíz del monorepo desde " + process.cwd());
    dir = parent;
  }
  return dir;
}

function constantFrom(file: string, name: string): number {
  const source = readFileSync(join(monorepoRoot(), file), "utf8");
  const match = new RegExp(`const ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(source);
  if (!match) {
    throw new Error(
      `No se encontró ${name} en ${file} — si se renombró o se movió, actualizá este test: es el ` +
        "único guard de que el aviso del formulario y la validación del servidor no se separen.",
    );
  }
  return Number(match[1].replace(/_/g, ""));
}

const backendMax = () => constantFrom("apps/api/src/api/rest/config-request.ts", "MAX_SIMULATION_LOAD");
const frontendMax = () => constantFrom("apps/web/src/App.tsx", "MAX_SIMULATION_LOAD");

function setGrid(width: number, height: number, updates: number) {
  fireEvent.change(screen.getByLabelText("Ancho de grilla"), { target: { value: String(width) } });
  fireEvent.change(screen.getByLabelText("Alto de grilla"), { target: { value: String(height) } });
  fireEvent.change(screen.getByLabelText("Generaciones"), { target: { value: String(updates) } });
}

const indicator = () => document.querySelector(".load-indicator")!;
const startButton = () => screen.getByRole("button", { name: /Iniciar corrida/ });

describe("aviso de carga: formulario vs. validación del servidor", () => {
  it("las dos constantes coinciden", () => {
    expect(frontendMax()).toBe(backendMax());
  });
});

describe("indicador de carga del formulario", () => {
  it("informa células, generaciones y carga con los valores actuales", () => {
    render(<App />);
    setGrid(20, 20, 300);
    expect(indicator()).toHaveTextContent("400 células × 300 generaciones = carga 120.000");
  });

  it("se recalcula al cambiar cualquiera de los tres campos", () => {
    render(<App />);
    setGrid(10, 10, 100);
    expect(indicator()).toHaveTextContent("carga 10.000");
    fireEvent.change(screen.getByLabelText("Generaciones"), { target: { value: "200" } });
    expect(indicator()).toHaveTextContent("carga 20.000");
    fireEvent.change(screen.getByLabelText("Ancho de grilla"), { target: { value: "20" } });
    expect(indicator()).toHaveTextContent("carga 40.000");
  });

  describe("umbrales de color", () => {
    it("por debajo del 70% del tope está en estado normal", () => {
      render(<App />);
      // 40×40×1300 = 2.080.000 = 69,3% de 3.000.000
      setGrid(40, 40, 1300);
      expect(indicator().className).toContain("load-indicator-ok");
      expect(indicator().className).not.toContain("load-indicator-near");
    });

    it("al alcanzar el 70% pasa a aviso, sin decir que es un error", () => {
      render(<App />);
      // 40×40×1313 = 2.100.800 = 70,03%
      setGrid(40, 40, 1313);
      expect(indicator().className).toContain("load-indicator-near");
      expect(indicator()).toHaveTextContent(/cerca del máximo/);
      // Sigue siendo una configuración válida: el botón NO se bloquea.
      expect(startButton()).not.toBeDisabled();
    });

    it("al superar el tope pasa a error y explica por qué", () => {
      render(<App />);
      setGrid(40, 40, 5000);
      expect(indicator().className).toContain("load-indicator-over");
      expect(indicator()).toHaveTextContent(/supera el máximo/);
    });

    it("el borde exacto todavía NO es error", () => {
      render(<App />);
      setGrid(40, 40, 1875); // exactamente 3.000.000
      expect(indicator().className).not.toContain("load-indicator-over");
      expect(startButton()).not.toBeDisabled();
    });
  });

  describe("botón de iniciar", () => {
    it("se deshabilita cuando la carga supera el tope, con un título que dice qué reducir", () => {
      render(<App />);
      setGrid(40, 40, 5000);
      const button = startButton();
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringContaining("supera el máximo"));
      expect(button.getAttribute("title")).toMatch(/Reducí el tamaño de la grilla o la cantidad de generaciones/);
    });

    it("vuelve a habilitarse al bajar la carga, sin recargar nada", () => {
      render(<App />);
      setGrid(40, 40, 5000);
      expect(startButton()).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Generaciones"), { target: { value: "1500" } });
      expect(startButton()).not.toBeDisabled();
      expect(startButton()).not.toHaveAttribute("title");
    });

    it("con una carga válida no lleva título: el tooltip solo existe para explicar el bloqueo", () => {
      render(<App />);
      setGrid(20, 20, 300);
      expect(startButton()).not.toHaveAttribute("title");
    });
  });
});
