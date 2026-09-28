import { describe, expect, it } from "vitest";
import { DOWNSAMPLE_TARGET, downsampleSnapshots, lttb } from "../src/lib/downsample";
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

/**
 * Corrida sintética del largo real por defecto (1500 generaciones,
 * `DEFAULT_BASE_FORM.updates`), con una catástrofe cada `every`
 * generaciones — el mismo intervalo que `FAST_CATASTROPHE` en el backend.
 */
function longRun(length = 1500, every = 10): GenerationSnapshot[] {
  return Array.from({ length }, (_, generation) =>
    snapshot({
      generation,
      // Sierra con un colapso brusco: la forma que el submuestreo tiene
      // que conservar, no una recta donde cualquier algoritmo acierta.
      populationSize: generation % 137 === 0 ? 20 : 300 + (generation % 50),
      averageFitness: 1 + generation / 1000,
      catastropheOccurred: generation > 0 && generation % every === 0,
    }),
  );
}

describe("downsampleSnapshots — umbral de activación", () => {
  it("con exactamente 300 snapshots devuelve el MISMO array, sin copiar ni modificar nada", () => {
    const snapshots = longRun(DOWNSAMPLE_TARGET);
    const result = downsampleSnapshots(snapshots);
    expect(result).toBe(snapshots); // misma referencia: no hubo submuestreo
    expect(result).toHaveLength(DOWNSAMPLE_TARGET);
  });

  it("con menos de 300 snapshots tampoco toca nada", () => {
    const snapshots = longRun(42);
    expect(downsampleSnapshots(snapshots)).toBe(snapshots);
  });

  it("con 301 snapshots (uno más que el umbral) sí submuestrea, a exactamente 300", () => {
    expect(downsampleSnapshots(longRun(301))).toHaveLength(DOWNSAMPLE_TARGET);
  });

  it("un array vacío no rompe", () => {
    expect(downsampleSnapshots([])).toEqual([]);
  });
});

describe("downsampleSnapshots — 1500 puntos de entrada", () => {
  it("devuelve exactamente 300 puntos, anclas INCLUIDAS (no 300 + anclas)", () => {
    const snapshots = longRun();
    const result = downsampleSnapshots(snapshots);
    expect(result).toHaveLength(DOWNSAMPLE_TARGET);
  });

  it("todos los snapshots con catastropheOccurred=true están presentes en la salida, sin excepción", () => {
    const snapshots = longRun();
    const expected = snapshots.filter((s) => s.catastropheOccurred).map((s) => s.generation);
    expect(expected).toHaveLength(149); // 1500 generaciones, una cada 10, sin contar la 0

    const sampledGenerations = new Set(downsampleSnapshots(snapshots).map((s) => s.generation));
    const missing = expected.filter((generation) => !sampledGenerations.has(generation));
    expect(missing).toEqual([]);
  });

  it("conserva la primera y la última generación — el gráfico empieza y termina donde la corrida", () => {
    const result = downsampleSnapshots(longRun());
    expect(result[0]?.generation).toBe(0);
    expect(result.at(-1)?.generation).toBe(1499);
  });

  it("la salida queda ordenada por generación, sin duplicados", () => {
    const generations = downsampleSnapshots(longRun()).map((s) => s.generation);
    expect(generations).toEqual([...generations].sort((a, b) => a - b));
    expect(new Set(generations).size).toBe(generations.length);
  });

  it("devuelve los snapshots originales por referencia, no copias parciales", () => {
    const snapshots = longRun();
    const result = downsampleSnapshots(snapshots);
    for (const sampled of result) {
      expect(snapshots).toContain(sampled);
    }
  });
});

describe("downsampleSnapshots — conflicto entre anclas y presupuesto", () => {
  it("si las anclas solas superan el target, ganan las anclas: el total se pasa antes que perder un marcador de RF-015", () => {
    // 400 generaciones, TODAS catastróficas menos la 0: 399 anclas contra
    // un target de 300.
    const snapshots = Array.from({ length: 400 }, (_, generation) =>
      snapshot({ generation, catastropheOccurred: generation > 0 }),
    );
    const result = downsampleSnapshots(snapshots);

    expect(result.length).toBeGreaterThan(DOWNSAMPLE_TARGET);
    const sampled = new Set(result.map((s) => s.generation));
    for (const s of snapshots.filter((x) => x.catastropheOccurred)) {
      expect(sampled.has(s.generation)).toBe(true);
    }
  });

  it("respeta un target explícito distinto del default", () => {
    // Sin catástrofes: `longRun()` trae 149 anclas + primera + última =
    // 151 forzadas, así que un target de 50 caería en la rama de arriba.
    const noCatastrophes = Array.from({ length: 1500 }, (_, generation) =>
      snapshot({ generation, populationSize: 300 + (generation % 50) }),
    );
    expect(downsampleSnapshots(noCatastrophes, 50)).toHaveLength(50);
    expect(downsampleSnapshots(noCatastrophes, 1000)).toHaveLength(1000);
    // Y con anclas, mientras entren en el presupuesto, el total sigue siendo exacto.
    expect(downsampleSnapshots(longRun(), 400)).toHaveLength(400);
  });
});

describe("downsampleSnapshots — fidelidad de la forma", () => {
  it("conserva el colapso de población: sin catástrofes marcadas, el mínimo global sobrevive al muestreo", () => {
    // Un único desplome en la generación 900, sin ninguna ancla que lo
    // salve — si aparece en la salida es porque LTTB lo eligió por su
    // área, que es exactamente lo que lo distingue de tomar uno cada N.
    const snapshots = Array.from({ length: 1500 }, (_, generation) =>
      snapshot({ generation, populationSize: generation === 900 ? 1 : 400 }),
    );
    const result = downsampleSnapshots(snapshots);
    expect(result.map((s) => s.generation)).toContain(900);
  });

  it("un submuestreo uniforme (uno cada N) se pierde ese mismo colapso — es la razón de usar LTTB", () => {
    // Contraste explícito, para que la elección del algoritmo quede
    // justificada por una diferencia medible y no por reputación.
    const step = Math.floor(1500 / DOWNSAMPLE_TARGET); // 5
    const uniform = Array.from({ length: DOWNSAMPLE_TARGET }, (_, i) => i * step);
    expect(uniform).not.toContain(900 - 1);
    const collapseAt = 901; // primo respecto del paso: nunca cae en la muestra uniforme
    expect(uniform).not.toContain(collapseAt);

    const snapshots = Array.from({ length: 1500 }, (_, generation) =>
      snapshot({ generation, populationSize: generation === collapseAt ? 1 : 400 }),
    );
    expect(downsampleSnapshots(snapshots).map((s) => s.generation)).toContain(collapseAt);
  });
});

describe("lttb (núcleo del algoritmo)", () => {
  const ramp = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }));

  it("si el umbral es mayor o igual que la cantidad de puntos, devuelve todos los índices", () => {
    expect(lttb(ramp, 100)).toHaveLength(100);
    expect(lttb(ramp, 500)).toHaveLength(100);
  });

  it("devuelve exactamente `threshold` índices cuando submuestrea", () => {
    expect(lttb(ramp, 10)).toHaveLength(10);
    expect(lttb(ramp, 3)).toHaveLength(3);
  });

  it("siempre conserva el primer y el último punto", () => {
    const indices = lttb(ramp, 10);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(99);
  });

  it("devuelve índices estrictamente crecientes, sin repetir", () => {
    const indices = lttb(ramp, 25);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it("casos degenerados de umbral: 0, 1 y 2", () => {
    expect(lttb(ramp, 0)).toEqual([]);
    expect(lttb(ramp, 1)).toEqual([0]);
    expect(lttb(ramp, 2)).toEqual([0, 99]);
  });

  it("es determinista: la misma entrada da la misma salida", () => {
    expect(lttb(ramp, 17)).toEqual(lttb(ramp, 17));
  });
});
