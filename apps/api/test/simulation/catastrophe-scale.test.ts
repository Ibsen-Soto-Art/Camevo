import { describe, expect, it } from "vitest";
import { buildSimulationConfig, parseCreateRunRequest } from "../../src/api/rest/config-request";
import { runSimulation } from "../../src/simulation/orchestrator/run";
import type { ClimateChangeSpeed } from "@camevo/shared-types";

/**
 * RF-015 con intensidad proporcional a la velocidad climática: la
 * propiedad que hay que proteger no es un número de fitness, es que
 * activar catástrofes por defecto en "slow"/"moderate" NO convierta esas
 * velocidades en escenarios de extinción — su rol pedagógico es mostrar
 * adaptación y punto de quiebre, no colapso, que es lo que demuestra
 * "fast".
 *
 * La evidencia completa —5 semillas, 1500 generaciones, 20x20, vía
 * buildSimulationConfig: 0/5 extinciones en slow y en moderate, ningún
 * snapshot con población 0 ni `nearExtinct`— está en el comentario de
 * CLIMATE_CHANGE_SPEED_RATIOS, no acá. Este test es el GUARD barato de
 * esa propiedad, no su demostración: una corrida por velocidad, 600
 * generaciones.
 *
 * Por qué 600 y no 1500: activar catástrofes por defecto ya encareció la
 * suite de por sí (los eventos liberan celdas, la población se reproduce
 * mucho más, y el motor hace ~4x más trabajo por generación — medido, el
 * tiempo total de tests de apps/api pasó de 46.7s a 78.9s solo por la
 * feature). Vitest corre los archivos en paralelo, así que una versión
 * anterior de este archivo con 6 corridas de 1500 generaciones hacía
 * expirar por timeout a tests de otros archivos sin relación
 * (tasks-reward.test.ts pasaba de 3.2s a 5.3s, sobre el límite default de
 * 5s). 600 generaciones siguen cubriendo 3 eventos en slow y 9 en
 * moderate, con la población ya estabilizada en la grilla llena.
 *
 * Corre contra la ruta REAL (parseCreateRunRequest → buildSimulationConfig),
 * no contra una SimulationConfig armada a mano: lo que se verifica es la
 * escala que el usuario va a recibir de verdad.
 */
function runWithCatastrophes(climateChangeSpeed: ClimateChangeSpeed) {
  const parsed = parseCreateRunRequest({
    gridWidth: 20,
    gridHeight: 20,
    mutationRate: 0.05,
    updates: 600,
    climateEnabled: true,
    climateChangeSpeed,
    catastropheEnabled: true,
  });
  if ("errors" in parsed) throw new Error(parsed.errors.join("; "));
  return runSimulation(buildSimulationConfig(parsed.config)).snapshots;
}

describe("RF-015: catástrofes activas en slow/moderate no producen extinción", () => {
  it.each<[ClimateChangeSpeed, number]>([
    ["slow", 150],
    ["moderate", 60],
  ])(
    "%s: llega al final de la corrida sin extinguirse, y las catástrofes efectivamente ocurren",
    (speed, intervalGenerations) => {
      const snapshots = runWithCatastrophes(speed);

      expect(snapshots).toHaveLength(600);
      expect(snapshots.some((s) => s.populationSize === 0)).toBe(false);
      expect(snapshots.some((s) => s.extinct)).toBe(false);
      expect(snapshots.at(-1)?.extinct).toBe(false);

      // Sin esto, lo de arriba pasaría igual si las catástrofes se
      // desactivaran por accidente — "no se extinguió" sería trivial.
      const events = snapshots.filter((s) => s.catastropheOccurred).length;
      expect(events).toBe(Math.floor((600 - 1) / intervalGenerations));
      expect(events).toBeGreaterThan(0);
    },
    20_000,
  );
});
