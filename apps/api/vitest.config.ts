import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    /**
     * Varios tests de esta suite corren simulaciones completas del motor
     * (cientos o miles de generaciones sobre una grilla de 20x20): son
     * CPU-bound y su duración depende de cuánta carga tenga la máquina,
     * porque vitest ejecuta los archivos en paralelo.
     *
     * El default de 5s no dejaba margen y ya era frágil antes de notarlo:
     * `tasks-reward.test.ts` tardaba 3.2s en aislamiento, o sea el 64% del
     * presupuesto. Al activarse los eventos catastróficos por defecto
     * (RF-015), cada evento libera celdas, la población se reproduce
     * bastante más y el motor hace varias veces más trabajo por
     * generación — medido, el tiempo total de tests pasó de 46.7s a
     * ~79-90s. Con eso, esos mismos tests llegaban a 5.3s bajo carga y
     * expiraban de forma intermitente, sin que nada estuviera roto.
     *
     * 20s no oculta un test lento (los tiempos siguen reportándose): evita
     * que un test correcto falle por competir con otro archivo.
     */
    testTimeout: 20_000,
  },
});
