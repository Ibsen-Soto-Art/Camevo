import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

/*
 * Test inusual: lee la fuente del backend para verificar que el límite del
 * formulario coincide con el de la validación del servidor. No hay forma de
 * compartir esta constante en runtime sin convertir shared-types en un
 * paquete con build — verificado y descartado por medición
 * (ERR_PACKAGE_PATH_NOT_EXPORTED en tsx). Este test es la única forma de
 * que la duplicación sea detectada automáticamente.
 *
 * El lado del frontend NO se lee con una expresión regular sobre App.tsx:
 * se renderiza el formulario y se lee el atributo `max` real del input, que
 * es lo que efectivamente limita al usuario. Un regex sobre la fuente
 * pasaría en verde si el JSX cambiara de forma sin cambiar el número.
 */
/*
 * La ruta se resuelve subiendo hasta la raíz del monorepo en vez de usar
 * `import.meta.url`: bajo el entorno jsdom de vitest esa URL no es de
 * esquema `file:` y readFileSync la rechaza (medido). Buscar un marcador de
 * la raíz también hace que el test no dependa de desde qué directorio se
 * invoque vitest.
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

function backendLimit(): number {
  const source = readFileSync(join(monorepoRoot(), "apps/api/src/api/rest/config-request.ts"), "utf8");
  const match = /export const CLIMATE_VARIANCE_AMPLITUDE_MAX\s*=\s*([\d.]+)\s*;/.exec(source);
  if (!match) {
    throw new Error(
      "No se encontró CLIMATE_VARIANCE_AMPLITUDE_MAX en config-request.ts — si se renombró o se movió, " +
        "actualizá este test: es el único guard de que el formulario y la validación del servidor no se separen.",
    );
  }
  return Number(match[1]);
}

describe("límite de climateVarianceAmplitude: formulario vs. validación del servidor", () => {
  it("el backend declara el techo como una constante exportada y parseable", () => {
    expect(backendLimit()).toBeGreaterThan(0);
    expect(Number.isFinite(backendLimit())).toBe(true);
  });

  it("el atributo max del input coincide exactamente con el techo del servidor", () => {
    render(<App />);
    const input = screen.getByLabelText("Intensidad/varianza climática");
    expect(input).toHaveAttribute("max", String(backendLimit()));
  });

  it("el mínimo del input es 0, igual que en LIMITS del servidor", () => {
    render(<App />);
    expect(screen.getByLabelText("Intensidad/varianza climática")).toHaveAttribute("min", "0");
  });

  it("el valor por defecto del formulario está dentro del rango permitido", () => {
    render(<App />);
    const input = screen.getByLabelText("Intensidad/varianza climática") as HTMLInputElement;
    const value = Number(input.value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(backendLimit());
  });

  it("la nota explica el efecto decreciente con los números medidos, no en abstracto", () => {
    render(<App />);
    const note = screen.getByText(/Controla cuánto oscila el clima/i);
    expect(note).toHaveTextContent(/efecto\s+decreciente/i);
    expect(note).toHaveTextContent("~18%");
    expect(note).toHaveTextContent("~33%");
    expect(note).toHaveTextContent("0.15");
    expect(note).toHaveTextContent("0.5");
  });
});
