import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import { maxGenerationsFor } from "../src/lib/simulation-load";

/*
 * RNF-008: máximo dinámico de generaciones según el tamaño de la grilla, el
 * aviso que lo informa y el bloqueo del botón.
 *
 * Mismo problema de constante duplicada que `climate-variance-limit.test.tsx`
 * y la misma solución: `@camevo/shared-types` es solo-tipos y no puede
 * exportar valores, así que el único guard automático contra la
 * desincronización es leer la fuente del backend.
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
        "único guard de que el formulario y la validación del servidor no se separen.",
    );
  }
  return Number(match[1].replace(/_/g, ""));
}

const backendMax = () => constantFrom("apps/api/src/api/rest/config-request.ts", "MAX_SIMULATION_LOAD");
const frontendMax = () => constantFrom("apps/web/src/lib/simulation-load.ts", "MAX_SIMULATION_LOAD");
const backendMaxUpdates = () => {
  const src = readFileSync(join(monorepoRoot(), "apps/api/src/api/rest/config-request.ts"), "utf8");
  const m = /\{ field: "updates", min: \d+, max: (\d+) \}/.exec(src);
  if (!m) throw new Error("No se encontró el límite de `updates` en LIMITS");
  return Number(m[1]);
};

const gen = () => screen.getByLabelText("Generaciones") as HTMLInputElement;
const ancho = () => screen.getByLabelText("Ancho de grilla") as HTMLInputElement;
const alto = () => screen.getByLabelText("Alto de grilla") as HTMLInputElement;
const indicator = () => document.querySelector(".load-indicator")!;
const startButton = () => screen.getByRole("button", { name: /Iniciar corrida/ });

describe("maxGenerationsFor", () => {
  it("deriva el máximo de la carga: 3.000.000 / celdas", () => {
    expect(maxGenerationsFor(40, 40)).toBe(1875); // 3.000.000 / 1600
    expect(maxGenerationsFor(30, 30)).toBe(3333); // 3.000.000 / 900, truncado
    expect(maxGenerationsFor(25, 25)).toBe(4800); // 3.000.000 / 625
  });

  it("el tope absoluto de 5000 manda cuando la fórmula daría más", () => {
    // 20x20 daría 7500 y 10x10 daría 30.000, pero LIMITS valida updates <= 5000
    // y el servidor rechazaría con 400 cualquier valor por encima.
    expect(maxGenerationsFor(20, 20)).toBe(backendMaxUpdates());
    expect(maxGenerationsFor(10, 10)).toBe(backendMaxUpdates());
    expect(maxGenerationsFor(2, 2)).toBe(backendMaxUpdates());
  });

  it("25x25 es el punto donde la carga pasa a ser el límite activo", () => {
    expect(maxGenerationsFor(24, 24)).toBe(backendMaxUpdates()); // 5208 → topeado
    expect(maxGenerationsFor(25, 25)).toBeLessThan(backendMaxUpdates()); // 4800
  });

  it("no es simétrico por dimensión sino por celdas: 40x20 y 20x40 dan lo mismo", () => {
    expect(maxGenerationsFor(40, 20)).toBe(maxGenerationsFor(20, 40));
  });

  it("nunca permite una carga por encima del tope del servidor", () => {
    for (const [w, h] of [[2, 2], [10, 10], [25, 25], [40, 40], [40, 20], [37, 29]] as const) {
      expect(w * h * maxGenerationsFor(w, h)).toBeLessThanOrEqual(backendMax());
    }
  });
});

describe("constantes sincronizadas con el servidor", () => {
  it("MAX_SIMULATION_LOAD coincide en los dos lados", () => {
    expect(frontendMax()).toBe(backendMax());
  });

  it("el tope absoluto del formulario coincide con el de LIMITS", () => {
    expect(maxGenerationsFor(1, 1)).toBe(backendMaxUpdates());
  });
});

describe("atributo max del input de generaciones", () => {
  it("al cargar la página refleja el máximo de la grilla por defecto", () => {
    render(<App />);
    expect(gen().max).toBe(String(maxGenerationsFor(Number(ancho().value), Number(alto().value))));
  });

  it("se recalcula al cambiar el ancho de la grilla", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    expect(gen().max).toBe("1875");
    fireEvent.change(ancho(), { target: { value: "20" } });
    expect(gen().max).toBe("3750"); // 3.000.000 / 800
  });

  it("se recalcula al cambiar el alto de la grilla", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "10" } });
    expect(gen().max).toBe("5000"); // 400 celdas: topeado por el absoluto
    fireEvent.change(alto(), { target: { value: "40" } });
    expect(gen().max).toBe("1875");
  });
});

describe("clampeo al ampliar la grilla", () => {
  it("ampliar de 20x20 a 40x40 con 5000 generaciones baja el valor a 1875", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "20" } });
    fireEvent.change(alto(), { target: { value: "20" } });
    fireEvent.change(gen(), { target: { value: "5000" } });
    expect(gen().value).toBe("5000");

    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    expect(gen().value).toBe("1875");
    // Es un ajuste silencioso esperado: no se muestra ningún error.
    expect(indicator().className).not.toContain("load-indicator-over");
    expect(startButton()).not.toBeDisabled();
  });

  it("reducir la grilla sube el máximo pero NO toca el valor", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "1875" } });

    fireEvent.change(ancho(), { target: { value: "20" } });
    fireEvent.change(alto(), { target: { value: "20" } });
    expect(gen().max).toBe("5000");
    expect(gen().value).toBe("1875"); // no hay clampeo hacia arriba
  });

  it("tipear en generaciones NO clampea: destruiría el valor a mitad de camino", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    // Con máximo 1875, escribir "5000" deja 5000 — el input lo acepta y el
    // aviso + el botón explican el problema. Clampear acá dejaría 1875 antes
    // de que el usuario termine de escribir.
    fireEvent.change(gen(), { target: { value: "5000" } });
    expect(gen().value).toBe("5000");
  });
});

describe("el aviso junto al botón", () => {
  it("informa las celdas y el máximo de esta grilla, sin el número de carga", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "20" } });
    fireEvent.change(alto(), { target: { value: "20" } });
    // Intl en español NO agrupa números de 4 dígitos (minimumGroupingDigits: 2
    // en CLDR): 5000 va sin punto, 120.000 con punto.
    expect(indicator()).toHaveTextContent("400 células · máx. 5000 generaciones con esta grilla");
    // "carga N" era una magnitud abstracta y se retiró.
    expect(indicator().textContent).not.toMatch(/carga/i);
  });

  it("se actualiza al cambiar la grilla", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    expect(indicator()).toHaveTextContent("1600 células · máx. 1875 generaciones");
  });

  it("no tiene tramo de aviso intermedio: cerca del máximo es un estado legítimo", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "1874" } }); // 99,9% del máximo
    expect(indicator().className).toBe("load-indicator");
    expect(startButton()).not.toBeDisabled();
  });

  it("el borde exacto todavía no es error", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "1875" } });
    expect(indicator().className).not.toContain("load-indicator-over");
    expect(startButton()).not.toBeDisabled();
  });

  it("al pasarse pasa a error y dice con qué valor se pasó", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "1876" } });
    expect(indicator().className).toContain("load-indicator-over");
    expect(indicator()).toHaveTextContent("1876 es más de lo que el servidor sostiene");
  });
});

describe("botón de iniciar", () => {
  it("se deshabilita al pasar el máximo, con un título que dice cuál es", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "5000" } });
    const button = startButton();
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toMatch(/1600 células el máximo es 1875 generaciones/);
    expect(button.getAttribute("title")).toMatch(/Reducí el tamaño de la grilla o la cantidad de generaciones/);
  });

  it("vuelve a habilitarse al bajar el valor, sin recargar nada", () => {
    render(<App />);
    fireEvent.change(ancho(), { target: { value: "40" } });
    fireEvent.change(alto(), { target: { value: "40" } });
    fireEvent.change(gen(), { target: { value: "5000" } });
    expect(startButton()).toBeDisabled();
    fireEvent.change(gen(), { target: { value: "1500" } });
    expect(startButton()).not.toBeDisabled();
    expect(startButton()).not.toHaveAttribute("title");
  });

  it("con una configuración válida no lleva título", () => {
    render(<App />);
    expect(startButton()).not.toHaveAttribute("title");
  });
});
