import type { GenerationSnapshot } from "./camevo-client";

/**
 * Cantidad máxima de puntos que llegan a Recharts, INCLUYENDO los
 * anclados. Es a la vez el objetivo y el umbral de activación: una
 * corrida de 300 generaciones o menos se dibuja entera, sin pérdida
 * ninguna.
 *
 * Medido en navegador real sobre una corrida guardada de 1500
 * generaciones (test/e2e/chart-downsample-perf.spec.ts) — ver el reporte
 * de esa medición para los números antes/después.
 */
export const DOWNSAMPLE_TARGET = 300;

export interface DownsamplePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * LTTB (Largest Triangle Three Buckets, Steinarsson 2013): reduce una
 * serie a `threshold` puntos eligiendo, en cada bucket, el punto que
 * forma el triángulo de mayor área con el punto ya elegido del bucket
 * anterior y el promedio del bucket siguiente. Conserva la SILUETA de la
 * curva mucho mejor que tomar uno cada N, que puede caer sistemáticamente
 * al lado de cada pico.
 *
 * Implementado acá en vez de instalar una dependencia: las dos opciones
 * de npm (`downsample@1.4.0`, `lttb@0.0.1`, ambas sin publicar desde
 * 2022) resuelven series de una sola dimensión `[x, y]`, mientras que
 * nuestro gráfico dibuja 6 series sobre un único array de filas planas
 * (`toChartRows`). La decisión difícil — qué serie manda el muestreo
 * cuando todas comparten el eje X — queda igual de nuestro lado, así que
 * la dependencia aportaría solo estas ~35 líneas.
 *
 * Devuelve ÍNDICES dentro de `points`, no los puntos: quien llama
 * necesita volver al snapshot completo, no al par (x, y).
 */
export function lttb(points: readonly DownsamplePoint[], threshold: number): number[] {
  const n = points.length;
  if (threshold >= n) return points.map((_, index) => index);
  if (threshold <= 0) return [];
  if (threshold === 1) return [0];
  if (threshold === 2) return [0, n - 1];

  const selected: number[] = [0];
  const bucketSize = (n - 2) / (threshold - 2);
  let anchor = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket++) {
    // Promedio del bucket SIGUIENTE — el tercer vértice del triángulo.
    const avgStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const avgEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let i = avgStart; i < avgEnd; i++) {
      avgX += points[i]!.x;
      avgY += points[i]!.y;
    }
    const avgLength = avgEnd - avgStart;
    if (avgLength > 0) {
      avgX /= avgLength;
      avgY /= avgLength;
    } else {
      avgX = points[n - 1]!.x;
      avgY = points[n - 1]!.y;
    }

    // Bucket actual: se queda el punto de mayor área.
    const rangeStart = Math.floor(bucket * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, n);
    const anchorX = points[anchor]!.x;
    const anchorY = points[anchor]!.y;

    let maxArea = -1;
    let maxIndex = rangeStart;
    for (let i = rangeStart; i < rangeEnd; i++) {
      const area =
        Math.abs((anchorX - avgX) * (points[i]!.y - anchorY) - (anchorX - points[i]!.x) * (avgY - anchorY)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIndex = i;
      }
    }

    selected.push(maxIndex);
    anchor = maxIndex;
  }

  selected.push(n - 1);
  return selected;
}

/**
 * Submuestreo adaptativo de los snapshots ANTES de que lleguen a
 * Recharts (RunChart). Función pura: misma entrada, misma salida, sin
 * estado ni dependencia de React — por eso vive acá y no dentro del
 * componente, donde solo sería verificable en navegador real.
 *
 * Tres garantías, en orden de prioridad:
 *
 * 1. `catastropheOccurred === true` SIEMPRE entra en la muestra. No es
 *    una preferencia estética: el eje X usa `dataKey="generation"` sin
 *    `type="number"`, o sea que Recharts lo trata como eje CATEGÓRICO, y
 *    una `<ReferenceLine x={generation}>` (RF-015) solo se posiciona si
 *    esa generación existe como categoría. Un ancla perdida no dibuja
 *    una línea corrida: no dibuja ninguna.
 * 2. Primera y última generación siempre presentes — el gráfico tiene
 *    que empezar y terminar donde termina la corrida, y
 *    `handleTouchPosition` (RunChart) interpola entre ambos extremos.
 * 3. El total nunca supera `target`, para que el costo de renderizado
 *    sea predecible.
 *
 * Cuando (1) y (3) entran en conflicto — más generaciones catastróficas
 * que el target — gana (1) y el total puede pasarse: perder marcadores
 * de RF-015 sería un error de datos visible, pasarse del presupuesto es
 * solo más lento. Hoy no es alcanzable desde la UI (las catástrofes
 * requieren `climateChangeSpeed === "fast"`, que extingue la población
 * alrededor de la generación 60), pero la función no depende de eso.
 *
 * Serie conductora: `populationSize`. LTTB está definido para UNA serie,
 * y acá seis comparten el eje X, así que hay que elegir. Población es la
 * que tiene las transiciones más abruptas (colapsos), es visible por
 * defecto junto con fitness, y fitness es una curva suave que sobrevive
 * a casi cualquier muestreo. Consecuencia asumida: clima y diversidad
 * (ocultos por defecto, `DEFAULT_HIDDEN_KEYS`) quedan muestreados en las
 * posiciones que eligió la curva de población, así que pueden perder
 * extremos locales propios.
 */
export function downsampleSnapshots(
  snapshots: readonly GenerationSnapshot[],
  target: number = DOWNSAMPLE_TARGET,
): readonly GenerationSnapshot[] {
  if (snapshots.length <= target) return snapshots;

  const anchored = new Set<number>([0, snapshots.length - 1]);
  for (let i = 0; i < snapshots.length; i++) {
    if (snapshots[i]!.catastropheOccurred) anchored.add(i);
  }

  const budget = target - anchored.size;
  if (budget <= 0) {
    // Conflicto (1) vs (3): ganan las anclas.
    return [...anchored].sort((a, b) => a - b).map((index) => snapshots[index]!);
  }

  // LTTB corre SOLO sobre los no anclados; las anclas se reinsertan
  // después en su posición por generación, no se le pasan al algoritmo
  // (si no, podría descartarlas).
  const candidates: number[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    if (!anchored.has(i)) candidates.push(i);
  }

  const points = candidates.map((index) => ({
    x: snapshots[index]!.generation,
    y: snapshots[index]!.populationSize,
  }));
  const picked = lttb(points, budget).map((position) => candidates[position]!);

  return [...anchored, ...picked].sort((a, b) => a - b).map((index) => snapshots[index]!);
}
