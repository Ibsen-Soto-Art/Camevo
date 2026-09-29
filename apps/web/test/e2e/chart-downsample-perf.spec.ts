import { expect, type Page, test } from "@playwright/test";
import { DOWNSAMPLE_TARGET } from "../../src/lib/downsample";

/**
 * Medición de rendimiento del gráfico con una corrida GUARDADA de 1500
 * generaciones (RF-025), el peor caso real de la aplicación.
 *
 * Por qué acá y no en un test unitario: el costo es el trabajo de
 * layout/paint de Recharts sobre ~1500 categorías del eje X y 6 series,
 * y eso solo existe en un navegador de verdad — jsdom nunca monta el
 * `<svg>` (ver test/RunChart.test.tsx).
 *
 * Las métricas están elegidas para NO medir la red, que no cambia con el
 * submuestreo (el backend sigue devolviendo los 1500 snapshots):
 *
 * 1. `longtaskTotalMs` — suma de las tareas largas (>50ms) del hilo
 *    principal entre que se selecciona la corrida y que aparece la
 *    primera curva. Esperar el `fetch` no genera longtasks, así que
 *    esto aísla el trabajo de renderizado del tiempo de espera de red.
 * 2. `hoverP50Ms` — latencia percibida al mover el mouse: desde
 *    `page.mouse.move()` hasta que el panel de valores muestra otra
 *    generación. Se mide con mouse REAL, no con un `MouseEvent`
 *    despachado a mano: medido, un evento sintético sobre
 *    `.recharts-wrapper` no actualiza el panel (el test devolvía
 *    exactamente 2 frames y "Generación" nunca aparecía), así que
 *    habría medido dos `requestAnimationFrame` vacíos. Incluye el
 *    ida y vuelta del protocolo de Playwright, igual en ambas
 *    mediciones, así que el número absoluto está inflado pero la
 *    comparación antes/después es válida.
 *
 * Sobre los eventos catastróficos: hasta que RF-015 pasó a ser una
 * dimensión propia (checkbox `catastropheEnabled`, intensidad
 * proporcional a la velocidad), no existía vía UI una corrida que fuera
 * larga Y tuviera catástrofes — se configuraban solo con
 * `climateChangeSpeed === "fast"`, que además usa `FAST_RESOURCE_POOL` y
 * extingue la población alrededor de la generación 60 (medido: una
 * primera versión de este test con ese preset dibujó 61 puntos, no
 * 1500). Con el preset lento las catástrofes ahora son ocasionales
 * (cada 150 generaciones, 15%) y la corrida llega igual a 1500, así que
 * el anclaje forzado del submuestreo SÍ se puede verificar en navegador
 * real — ver el segundo test de este archivo.
 */
const GENERATIONS = 1500;
const HOVER_SAMPLES = 15;

const CATASTROPHE_INTERVAL_SLOW = 150;

interface ChartMetrics {
  readonly longtaskTotalMs: number;
  readonly longtaskMaxMs: number;
  readonly timeToChartMs: number;
  readonly renderedPoints: number;
  readonly hoverP50Ms: number;
  readonly lastGeneration: number;
}

async function saveLongRun(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "¿Puede la vida adaptarse?" }).click();
  await page.getByText("Configuración de la corrida").click();
  await page.getByLabel("Generaciones").fill(String(GENERATIONS));
  await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
  await page.getByRole("button", { name: "Iniciar corrida" }).click();
  await expect(page.locator(".status-line")).toContainText("done", { timeout: 180_000 });

  await page.getByRole("button", { name: "Guardar esta corrida" }).click();
  await expect(page.getByRole("button", { name: "Guardada ✓" })).toBeVisible({ timeout: 30_000 });
}

/** Última generación que el panel de valores llegó a mostrar, o 0 si nunca mostró ninguna. */
async function hoveredGeneration(page: Page): Promise<number> {
  const text = (await page.locator(".chart-hover-panel").first().textContent()) ?? "";
  return Number(/Generación (\d+)/.exec(text)?.[1] ?? 0);
}

async function measureSavedRunChart(page: Page): Promise<ChartMetrics> {
  await page.getByLabel("Modo").selectOption("saved-compare");
  const selectA = page.getByLabel(/corrida guardada a/i);
  const runId = await selectA.locator("option").nth(1).getAttribute("value");
  expect(runId, "debe existir al menos una corrida guardada para medir").toBeTruthy();

  await page.evaluate(() => {
    const w = window as unknown as { __longtasks: number[]; __t0: number };
    w.__longtasks = [];
    w.__t0 = performance.now();
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longtasks.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
  });

  await selectA.selectOption(runId!);
  await page.waitForSelector(".chart-container .recharts-line path", { timeout: 60_000 });

  const timing = await page.evaluate(() => {
    const w = window as unknown as { __longtasks: number[]; __t0: number };
    return {
      timeToChartMs: performance.now() - w.__t0,
      longtaskTotalMs: w.__longtasks.reduce((a, b) => a + b, 0),
      longtaskMaxMs: w.__longtasks.length > 0 ? Math.max(...w.__longtasks) : 0,
    };
  });

  // Cuántos vértices dibuja realmente la curva: el conteo de comandos del
  // atributo `d` del <path>, que es el dato directo de cuántos puntos
  // llegaron a Recharts.
  const renderedPoints = await page.evaluate(() => {
    const path = document.querySelector(".chart-container .recharts-line path");
    return ((path?.getAttribute("d") ?? "").match(/[MLC]/g) ?? []).length;
  });

  const wrapper = page.locator(".chart-container .recharts-wrapper").first();
  // `page.mouse.move` usa coordenadas de viewport: sin esto el gráfico
  // queda debajo del pliegue y los movimientos caen fuera de la ventana
  // (el hover nunca se dispara y el test expira sin explicar por qué).
  await wrapper.scrollIntoViewIfNeeded();
  const box = (await wrapper.boundingBox())!;
  /*
   * El rectángulo de trazado NO es el del wrapper: medido acá, un wrapper
   * de 554px de ancho contenía un área de líneas de ~294px, así que
   * barrer el wrapper de 0.15 a 0.85 se pasaba del final de los datos y
   * el hover dejaba de cambiar. La grilla cartesiana ocupa exactamente el
   * área de trazado — misma técnica que chart-legend-toggle.spec.ts.
   */
  const plot = (await page.locator(".chart-container .recharts-cartesian-grid-horizontal line").first().boundingBox())!;
  const samples: number[] = [];
  let previous = await hoveredGeneration(page);
  for (let i = 0; i < HOVER_SAMPLES; i++) {
    const x = plot.x + plot.width * (0.05 + (0.9 * i) / HOVER_SAMPLES);
    const y = box.y + box.height * 0.5;
    const t0 = performance.now();
    await page.mouse.move(x, y);
    await page.waitForFunction(
      (prev) => {
        const text = document.querySelector(".chart-hover-panel")?.textContent ?? "";
        const match = /Generación (\d+)/.exec(text);
        return match !== null && Number(match[1]) !== prev;
      },
      previous,
      { timeout: 10_000 },
    ).catch(async (err: unknown) => {
      console.log(`[hover] FALLÓ en i=${i} x=${Math.round(x)} prev=${previous} panel=${JSON.stringify((await page.locator(".chart-hover-panel").first().textContent())?.slice(0, 80))}`);
      throw err;
    });
    samples.push(performance.now() - t0);
    previous = await hoveredGeneration(page);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const hoverP50Ms = sorted[Math.floor(sorted.length / 2)]!;

  // Extremo derecho del área de trazado.
  await page.mouse.move(plot.x + plot.width - 2, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  const lastGeneration = await hoveredGeneration(page);

  return { ...timing, renderedPoints, hoverP50Ms, lastGeneration };
}

test("rendimiento del gráfico con una corrida guardada de 1500 generaciones", async ({ page }) => {
  test.setTimeout(300_000);

  await saveLongRun(page);
  const metrics = await measureSavedRunChart(page);

  console.log(`[perf] generaciones simuladas : ${GENERATIONS}`);
  console.log(`[perf] puntos dibujados       : ${metrics.renderedPoints}`);
  console.log(`[perf] longtask total         : ${metrics.longtaskTotalMs.toFixed(1)} ms`);
  console.log(`[perf] longtask máxima        : ${metrics.longtaskMaxMs.toFixed(1)} ms`);
  console.log(`[perf] tiempo hasta la curva  : ${metrics.timeToChartMs.toFixed(1)} ms`);
  console.log(`[perf] hover p50              : ${metrics.hoverP50Ms.toFixed(1)} ms`);
  console.log(`[perf] última generación      : ${metrics.lastGeneration}`);

  // Guard contra medir en silencio una corrida más corta de la que se cree
  // (ya pasó una vez: 61 puntos en vez de 1500, por extinción temprana).
  expect(metrics.lastGeneration, "la corrida medida debe llegar cerca de 1500 generaciones").toBeGreaterThan(1400);

  /*
   * Además de medir, este test es el guard de regresión del submuestreo:
   * si alguien lo desactiva o lo saltea, acá vuelven a dibujarse 1500
   * puntos. Es la única verificación en navegador real de que el
   * submuestreo se aplica — la garantía de QUÉ puntos sobreviven vive en
   * test/downsample.test.ts, sobre la función pura.
   */
  expect(metrics.renderedPoints).toBeGreaterThan(0);
  expect(metrics.renderedPoints, "una corrida de 1500 generaciones no debe dibujar más de DOWNSAMPLE_TARGET puntos").toBeLessThanOrEqual(
    DOWNSAMPLE_TARGET,
  );
});

test("el submuestreo conserva TODAS las generaciones catastróficas, verificado en navegador real", async ({ page }) => {
  /*
   * La garantía de qué puntos sobreviven al LTTB vive en la función pura
   * (test/downsample.test.ts), pero lo que importa de verdad es que los
   * marcadores de RF-015 se sigan DIBUJANDO: el eje X es categórico, así
   * que una `<ReferenceLine>` sobre una generación que no quedó en los
   * datos simplemente no aparece — no falla ruidosamente. Con 1500
   * generaciones reducidas a 300 puntos, este test es la única
   * comprobación de punta a punta de que eso no pasa.
   */
  test.setTimeout(300_000);

  await saveLongRun(page);
  await page.getByLabel("Modo").selectOption("saved-compare");
  const selectA = page.getByLabel(/corrida guardada a/i);
  const runId = await selectA.locator("option").nth(1).getAttribute("value");
  await selectA.selectOption(runId!);
  await page.waitForSelector(".chart-container .recharts-line path", { timeout: 60_000 });

  const chart = page.locator(".chart-container").first();
  const renderedPoints = await page.evaluate(() => {
    const path = document.querySelector(".chart-container .recharts-line path");
    return ((path?.getAttribute("d") ?? "").match(/[MLC]/g) ?? []).length;
  });
  const referenceLines = await chart.locator(".recharts-reference-line").count();

  // El preset lento dispara una catástrofe cada 150 generaciones; con 1500
  // son 9 (las generaciones 150, 300, ... 1350 — la 0 no cuenta, y la 1500
  // queda fuera porque la corrida termina en la 1499).
  const expectedCatastrophes = Math.floor((1500 - 1) / CATASTROPHE_INTERVAL_SLOW);
  expect(expectedCatastrophes).toBe(9);

  console.log(`[anclaje] puntos dibujados ${renderedPoints} · ReferenceLine ${referenceLines} · esperadas ${expectedCatastrophes}`);

  // Submuestreo activo Y marcadores intactos: es la combinación que el
  // anclaje forzado tiene que garantizar.
  expect(renderedPoints).toBeLessThanOrEqual(DOWNSAMPLE_TARGET);
  expect(referenceLines).toBe(expectedCatastrophes);
  await expect(chart.getByText(/evento catastrófico/i)).toBeVisible();
});
