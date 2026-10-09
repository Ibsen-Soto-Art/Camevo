import { useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCatastropheGenerations } from "../lib/catastrophe";
import { downsampleSnapshots } from "../lib/downsample";
import type { GenerationSnapshot } from "../lib/camevo-client";

/**
 * Debe calzar con `margin` del `<LineChart>` de abajo — es el mismo
 * rectángulo de trazado que Recharts usa internamente, y del que depende
 * el cálculo táctil (`handleTouchPosition`).
 *
 * `right` es dinámico a propósito: con el eje de "Población" visible hay
 * DOS columnas de ticks apiladas a la derecha (Clima + Población) y hacen
 * falta 60px; si el usuario oculta "Población viva" desde la leyenda ese
 * eje deja de renderizarse, y mantener los 60px dejaría una franja vacía
 * a la derecha del gráfico. 30 es el valor que tenía antes de que
 * existiera el tercer eje.
 */
/** dataKey de la serie de población — el eje `yAxisId="population"` solo existe mientras esta serie esté visible. */
const POPULATION_KEY = "populationSize";

/** Clave de fila SIN serie asociada: alimenta la línea de catástrofe del panel de valores, no una `<Line>`. */
export const CATASTROPHE_DEATHS_KEY = "catastropheDeaths";

/**
 * Tareas lógicas resueltas en la generación. Tampoco es una serie del
 * gráfico: es el contrapeso de "Fitness promedio" en el panel de valores.
 *
 * Existe porque `averageFitness` (nacimientos / población) puede estar
 * ANTI-correlacionado con la adaptación funcional. Medido en 20x20,
 * Moderada, catástrofes activas, 1500 generaciones y misma semilla: con
 * mutación 1.0 el fitness tardío/temprano da 2.03 —el más alto de toda la
 * tabla— mientras el 87% de las generaciones resuelven CERO tareas; y con
 * mutación 0 da 1.01 —el más chato— con la mejor adaptación funcional de
 * todas (108.276 tareas, mediana 72 por generación). Un visitante que solo
 * mire la curva subir se lleva la conclusión opuesta a la real.
 */
export const TASKS_SOLVED_KEY = "tasksSolvedThisUpdate";

/**
 * Ancho que Recharts necesita por cada columna de ticks a la derecha.
 * "Clima" y "Población" son los dos ejes `orientation="right"` y se
 * apilan hacia afuera, así que el margen derecho depende de CUÁNTOS hay
 * visibles, no de uno solo.
 */
const RIGHT_MARGIN_PER_AXIS = 30;

/** Las claves climáticas son dinámicas (`climateTaskIds`, derivadas de los snapshots), nunca una lista fija de AND/NOT/OR. */
export function hasVisibleClimateSeries(hiddenKeys: ReadonlySet<string>, climateKeys: readonly string[]): boolean {
  return climateKeys.some((key) => !hiddenKeys.has(key));
}

/**
 * El margen derecho sigue a los ejes que realmente se renderizan. Con
 * los dos visibles son 60px (el valor histórico); con uno, 30; con
 * ninguno se mantiene el piso de 30 para que la última etiqueta del eje
 * X no quede recortada contra el borde del SVG.
 *
 * Recibe `climateKeys` en vez de asumir ["AND","NOT","OR"]: esos ids
 * salen de DEFAULT_TASKS en el backend vía los snapshots, así que
 * hardcodearlos acá haría que una tarea nueva tuviera línea climática
 * sin contar para su propio eje — el mismo bug que este patrón resolvió
 * para Población en v0.20.1, al revés.
 */
export function resolveChartMargin(hiddenKeys: ReadonlySet<string>, climateKeys: readonly string[] = []) {
  const rightAxes = (hiddenKeys.has(POPULATION_KEY) ? 0 : 1) + (hasVisibleClimateSeries(hiddenKeys, climateKeys) ? 1 : 0);
  return { top: 10, right: RIGHT_MARGIN_PER_AXIS * Math.max(1, rightAxes), left: 20, bottom: 0 };
}

const CLIMATE_COLORS = ["#d62728", "#2ca02c", "#9467bd"];

/**
 * Grupo 2 (rediseño visual): estos SÍ son colores de tema de UI, no de
 * datos — a diferencia de CLIMATE_COLORS/los strokes de cada `<Line>`
 * (que identifican una métrica y no deben cambiar), grid/ejes/cursor solo
 * existen para que el gráfico se lea sobre el nuevo fondo oscuro. Se
 * hardcodean (no `var(--color-...)`) porque Recharts renderiza a SVG
 * plano, no hereda custom properties de forma confiable en todos los
 * casos — mismo criterio que ya usa CLIMATE_COLORS como const acá arriba.
 */
const CHART_GRID_COLOR = "#24352f";
const CHART_AXIS_TEXT_COLOR = "#8fa39c";

/** Formatea un valor para el panel de valores: sin decimales innecesarios (población/multiplicadores suelen ser enteros). */
function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Metadata de cada serie, en un solo lugar — de acá salen tanto los
 * `<Line>` del gráfico como los ítems de la leyenda custom y las
 * entradas del panel de valores fijo, para que agregar/quitar una serie
 * nunca requiera tocar tres lugares por separado y arriesgar que se
 * desincronicen.
 */
interface SeriesMeta {
  readonly dataKey: string;
  readonly name: string;
  readonly color: string;
  readonly yAxisId: "fitness" | "climate" | "population";
  readonly strokeDasharray?: string;
}

/** Aplana los snapshots a filas {generation, averageFitness, geneticDiversity, populationSize, [taskId]: multiplier} para Recharts. */
export function toChartRows(snapshots: readonly GenerationSnapshot[]): Record<string, number>[] {
  return snapshots.map((snapshot) => {
    const row: Record<string, number> = {
      generation: snapshot.generation,
      averageFitness: snapshot.averageFitness,
      geneticDiversity: snapshot.geneticDiversity,
      populationSize: snapshot.populationSize,
      /*
       * `?? 0` porque las corridas guardadas antes de v0.21.x no tienen
       * este campo en su JSONB: al cargarlas por GET /runs/:id llega
       * `undefined` donde el tipo declara `number`. 0 es el valor correcto
       * para ellas — no se sabe cuántos murieron, y "0" hace que el panel
       * no muestre la línea de catástrofe en vez de mostrar "murieron
       * undefined organismos".
       *
       * Agregar esta clave a la fila NO crea una serie en el gráfico: las
       * series salen de `buildSeriesList`, y Recharts solo dibuja las
       * claves referenciadas por un `<Line dataKey>`.
       */
      [CATASTROPHE_DEATHS_KEY]: snapshot.catastropheDeaths ?? 0,
      /*
       * `?? 0` por intención, no por compatibilidad: este campo existe en
       * `GenerationSnapshot` desde el principio, así que ninguna corrida
       * guardada puede traerlo ausente. Se deja igual porque la fila es un
       * `Record<string, number>` y un `undefined` que se colara mostraría
       * "Tareas lógicas resueltas: undefined" en vez de un número — el
       * mismo defecto que el `?? 0` de catastropheDeaths previene de
       * verdad. Es una red de seguridad explícita, no un parche histórico.
       */
      [TASKS_SOLVED_KEY]: snapshot.tasksSolvedThisUpdate ?? 0,
    };
    for (const resource of snapshot.climate) {
      row[resource.taskId] = resource.rewardMultiplier;
    }
    return row;
  });
}

/** Fitness/diversidad/población son siempre las mismas tres series; el clima es dinámico según DEFAULT_TASKS (RF-022). */
export function buildSeriesList(climateTaskIds: readonly string[]): SeriesMeta[] {
  return [
    { dataKey: "averageFitness", name: "Fitness promedio", color: "#1f77b4", yAxisId: "fitness" },
    { dataKey: "populationSize", name: "Población viva", color: "#2dd4bf", yAxisId: "population" },
    { dataKey: "geneticDiversity", name: "Diversidad genética (aprox.)", color: "#ff7f0e", yAxisId: "fitness", strokeDasharray: "4 3" },
    ...climateTaskIds.map((taskId, index) => ({
      dataKey: taskId,
      name: `Clima: ${taskId}`,
      color: CLIMATE_COLORS[index % CLIMATE_COLORS.length],
      yAxisId: "climate" as const,
    })),
  ];
}

/** Las 4 series ocultas por defecto (Mejora 2): clima + diversidad — Fitness y Población son las dos más intuitivas para un visitante nuevo. */
export const DEFAULT_HIDDEN_KEYS = ["AND", "NOT", "OR", "geneticDiversity"];

export interface RunChartProps {
  readonly snapshots: readonly GenerationSnapshot[];
  readonly height?: number;
  /**
   * Se avisa cada vez que cambia la generación bajo el cursor (o el dedo),
   * para que la grilla poblacional pueda mostrar ESA generación en vez de
   * la última. Sin esto, leer "murieron 60 organismos" en el panel
   * mientras la grilla seguía dibujando la generación final era una
   * desconexión visible, sobre todo en generaciones catastróficas.
   *
   * Nunca se llama con `null`: no hay `onMouseLeave` que limpie el estado
   * (decisión de v0.20.0 — el panel de valores persiste a propósito), así
   * que una vez que el usuario miró una generación, esa queda como la
   * última conocida.
   */
  readonly onHoverGeneration?: (generation: number) => void;
  /**
   * Generación que el panel de valores debe mostrar, manejada desde
   * afuera. Con esta prop presente el gráfico queda CONTROLADO: deja de
   * usar su estado interno y solo avisa hacia arriba, así que el slider de
   * generaciones de la grilla (y el hover de la propia gráfica) escriben en
   * un único lugar. `undefined` — no `null` — mantiene el modo no
   * controlado, que es el que usan los tests que montan el gráfico solo.
   */
  readonly hoveredGeneration?: number | null;
}

/**
 * Fitness promedio (RF-020) + diversidad genética (RF-021) + curva
 * climática por tarea (RF-022), superpuestas.
 *
 * La leyenda de diversidad dice "(aprox.)" y hay una nota debajo del
 * gráfico a propósito: la métrica (engine/population/diversity.ts)
 * mide, medido en diversity.test.ts, que el ruido por desalineamiento
 * de indels puede ser ~27% de una señal de heterogeneidad real
 * comparable (0.031 de 0.115) — no es despreciable, así que no basta
 * con dejarlo documentado solo en comentarios de código/tests que el
 * usuario nunca ve.
 */
export default function RunChart({ snapshots, height = 380, onHoverGeneration, hoveredGeneration }: RunChartProps) {
  const climateTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      for (const resource of snapshot.climate) ids.add(resource.taskId);
    }
    return [...ids];
  }, [snapshots]);

  /*
   * Submuestreo adaptativo antes de que los datos lleguen a Recharts: una
   * corrida completa son 1500 generaciones (`DEFAULT_BASE_FORM.updates`) y
   * dibujar las 1500 cuesta, medido en navegador real sobre una corrida
   * guardada, ~208ms de tareas largas del hilo principal. Por debajo de
   * `DOWNSAMPLE_TARGET` la función devuelve el mismo array sin tocarlo, así
   * que las corridas cortas no pierden ni un punto.
   *
   * Va acá adentro y no en RunPanel/useRun a propósito: `PopulationGrid` y
   * `ExplanatoryPanel` reciben los MISMOS `run.snapshots` y necesitan todos
   * — `historicalMaxFitness` recorre cada organismo de cada snapshot para
   * normalizar el color de las celdas, así que submuestrear aguas arriba le
   * cambiaría en silencio la escala de color a la grilla.
   */
  const sampledSnapshots = useMemo(() => downsampleSnapshots(snapshots), [snapshots]);
  const chartRows = useMemo(() => toChartRows(sampledSnapshots), [sampledSnapshots]);
  const seriesList = useMemo(() => buildSeriesList(climateTaskIds), [climateTaskIds]);

  // En la práctica son pocas por corrida: Fase 4 midió extinción real entre
  // las generaciones 21 y 131 con severity=0.9/interval=10, así que no es
  // una cantidad de líneas que vaya a saturar el gráfico.
  //
  // Se deriva de `sampledSnapshots`, no de `snapshots`: el eje X es
  // CATEGÓRICO (`dataKey="generation"` sin `type="number"`), así que una
  // `<ReferenceLine x={...}>` sobre una generación que no quedó en
  // `chartRows` no tendría categoría donde posicionarse. `downsampleSnapshots`
  // garantiza que ninguna se pierda — leer de la misma lista que el gráfico
  // hace que esa garantía no pueda desincronizarse en silencio.
  const catastropheGenerations = useMemo(() => getCatastropheGenerations(sampledSnapshots), [sampledSnapshots]);

  // Mejora 1 (panel de valores fijo, no un tooltip flotante): a
  // diferencia del tooltip default de Recharts, ya NO hay `onMouseLeave`
  // que limpie `hoveredGeneration` — el panel se queda mostrando los
  // últimos valores vistos hasta que el mouse (o el dedo, en mobile)
  // entra a una generación distinta.
  const [uncontrolledHover, setUncontrolledHover] = useState<number | null>(null);
  const isControlled = hoveredGeneration !== undefined;
  const activeGeneration = isControlled ? hoveredGeneration : uncontrolledHover;

  /** Único punto que mueve el hover: mantiene el estado local y el aviso hacia afuera siempre en el mismo valor. */
  function updateHoveredGeneration(generation: number) {
    if (!isControlled) setUncontrolledHover(generation);
    onHoverGeneration?.(generation);
  }

  /*
   * La fila MÁS CERCANA, no la exacta. Con el hover del mouse da lo mismo
   * (la generación sale de `chartRows`, así que la coincidencia exacta
   * existe siempre), pero el slider de la grilla recorre los snapshots
   * COMPLETOS: en una corrida de 1500 generaciones `chartRows` tiene 300
   * puntos, así que una búsqueda exacta no encontraría nada en ~4 de cada 5
   * posiciones del slider y el panel se vaciaría al cambiar de pestaña.
   */
  const hoveredRow = useMemo(() => {
    if (activeGeneration === null || chartRows.length === 0) return null;
    let nearest = chartRows[0]!;
    let nearestDistance = Math.abs(nearest.generation - activeGeneration);
    for (const row of chartRows) {
      if (row.generation === activeGeneration) return row;
      const distance = Math.abs(row.generation - activeGeneration);
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [chartRows, activeGeneration]);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  /*
   * Tras un `touchend`, el navegador emite eventos de mouse SINTÉTICOS
   * (~300ms después) para compatibilidad con páginas que solo manejan
   * mouse. Esos eventos llegan al `onMouseMove` de Recharts y le hacen
   * recalcular `activeLabel` por su cuenta, pisando lo que el handler
   * táctil ya había fijado — medido en mobile: el panel mostraba una
   * generación y un instante después cambiaba a otra sin que nadie
   * tocara nada. Ignorar el mouse durante esta ventana elimina la
   * carrera, en vez de depender de que los dos cálculos coincidan.
   */
  const lastTouchAtRef = useRef(0);
  const SYNTHETIC_MOUSE_WINDOW_MS = 700;

  // Mejora 2 (leyenda interactiva): Fitness y Población son las dos
  // métricas más intuitivas para un visitante nuevo sin conocimientos
  // técnicos — clima y diversidad quedan disponibles para quien quiera
  // profundizar, sin saturar la vista inicial.
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_HIDDEN_KEYS));
  const visibleSeries = useMemo(() => seriesList.filter((s) => !hiddenKeys.has(s.dataKey)), [seriesList, hiddenKeys]);

  /*
   * Restaurar el foco al ítem recién alternado. Medido con Playwright:
   * al cambiar `hiddenKeys`, Recharts vuelve a invocar el `content` de
   * su `<Legend>` y el `<li>` enfocado se destruye — el foco caía a
   * `<body>`, y la siguiente pulsación de Espacio scrolleaba la página
   * en vez de alternar otra serie. Con esto, un usuario de teclado puede
   * encadenar varios toggles sin volver a tabular, y si oculta TODAS las
   * series sigue teniendo un punto de partida visible para reactivar
   * alguna (que de otro modo sería un callejón sin salida).
   */
  const legendRef = useRef<HTMLUListElement>(null);
  const [lastToggledKey, setLastToggledKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (lastToggledKey === null) return;
    const item = legendRef.current?.querySelector<HTMLLIElement>(`[data-series-key="${CSS.escape(lastToggledKey)}"]`);
    if (item && document.activeElement !== item) item.focus();
  }, [lastToggledKey, hiddenKeys]);

  function toggleSeries(dataKey: string) {
    setLastToggledKey(dataKey);
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  }

  // Los ejes derechos y el margen van juntos: un eje cuya serie está
  // oculta no se renderiza, y el margen se ajusta para no dejar una
  // franja vacía a la derecha (ver resolveChartMargin).
  const climateKeys = useMemo(
    () => seriesList.filter((s) => s.yAxisId === "climate").map((s) => s.dataKey),
    [seriesList],
  );
  const showPopulationAxis = !hiddenKeys.has(POPULATION_KEY);
  const showClimateAxis = hasVisibleClimateSeries(hiddenKeys, climateKeys);
  const chartMargin = resolveChartMargin(hiddenKeys, climateKeys);

  /**
   * Verificado con Playwright (touch real, no asumido): un primer toque
   * SÍ dispara `onMouseMove` de `<LineChart>` y muestra valores reales
   * — pero toques independientes SIGUIENTES (levantar el dedo y tocar de
   * nuevo en otra posición, no arrastrar) no vuelven a actualizar
   * `activeLabel` de forma confiable; quedan pegados al primer punto
   * tocado. Confirmado además que esto no es un problema de mouse en
   * general (con `page.mouse.move` real, moverse a distintas posiciones
   * SÍ actualiza cada vez) — es específico de gestos de touch discretos.
   * Este handler calcula la generación más cercana directamente a partir
   * de la coordenada del toque, en paralelo al `onMouseMove` de Recharts
   * (que sigue sirviendo al mouse real sin cambios) — corre en la fase de
   * bubble, después de cualquier manejo interno de Recharts, así que su
   * resultado (correcto) es el que termina aplicándose.
   */
  function handleTouchPosition(clientX: number) {
    const container = chartContainerRef.current;
    if (!container || chartRows.length === 0) return;

    /*
     * El rectángulo de trazado se LEE del DOM, no se calcula a partir del
     * margen. La grilla cartesiana ocupa exactamente el área de líneas,
     * mientras que `rect.width - margin.left - margin.right` ignora el
     * ancho que los propios ejes Y ocupan dentro de ese rectángulo —
     * medido, un contenedor de 554px puede tener un área de líneas de
     * ~294px, así que la aproximación por margen desplazaba el mapeo.
     *
     * Eso importa más desde que los ejes derechos son condicionales: al
     * desaparecer el de "Clima", el área de trazado se ensancha y la vieja
     * aproximación quedaba desfasada respecto del hit-testing real de
     * Recharts. Medido en mobile: el toque fijaba una generación y ~300ms
     * después el evento de mouse sintético que el navegador emite tras el
     * touchend la cambiaba por otra, porque los dos cálculos no coincidían.
     * Leyendo la grilla no hay dos fuentes de verdad que puedan discrepar.
     */
    const gridLine = container.querySelector(".recharts-cartesian-grid-horizontal line");
    const plotRect = gridLine?.getBoundingClientRect();
    const rect = container.getBoundingClientRect();
    const plotLeft = plotRect && plotRect.width > 0 ? plotRect.left : rect.left + chartMargin.left;
    const plotWidth = plotRect && plotRect.width > 0 ? plotRect.width : rect.width - chartMargin.left - chartMargin.right;
    if (plotWidth <= 0) return;

    const fraction = Math.min(1, Math.max(0, (clientX - plotLeft) / plotWidth));
    const minGeneration = chartRows[0]!.generation;
    const maxGeneration = chartRows[chartRows.length - 1]!.generation;
    const targetGeneration = minGeneration + fraction * (maxGeneration - minGeneration);

    let nearest = chartRows[0]!;
    let nearestDistance = Math.abs(nearest.generation - targetGeneration);
    for (const row of chartRows) {
      const distance = Math.abs(row.generation - targetGeneration);
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    updateHoveredGeneration(nearest.generation);
  }

  function handleTouch(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (touch) {
      lastTouchAtRef.current = Date.now();
      handleTouchPosition(touch.clientX);
    }
  }

  return (
    <div>
      {/*
        Ajuste 1 (re-auditoría post-producción, ver docs/04-roadmap-fases.md):
        el fix anterior (left:0→left:20) resolvió un déficit HORIZONTAL real
        en el eje izquierdo, pero el recorte que seguía viéndose en
        producción era VERTICAL, en ambos ejes — causa distinta, nunca antes
        medida. Recharts centra el label rotado (`angle`, `text-anchor:
        middle`) en el punto medio vertical del área del eje y lo extiende
        por igual arriba y abajo desde ese punto; si la mitad de la longitud
        renderizada del texto supera la distancia de ese centro al borde
        superior del SVG (que se achica cuando la leyenda crece a 5 líneas,
        o cuando el alto del gráfico baja a 320px en modo comparación), el
        SVG recorta la mitad de arriba por su `overflow: hidden` default.
        Medido con Playwright en los tres escenarios reales (sin corrida,
        corrida con leyenda completa, comparación a 320px): con el texto
        largo original el recorte iba de 13 a 111px según el escenario. Una
        primera abreviación ("Fitness / div." / "Mult. climático") resolvió
        los dos escenarios de 380px pero NO el de comparación a 320px
        (seguía cortado 22-42px, medido) — el texto todavía era demasiado
        largo para ese caso más ajustado. "Fitness" / "Clima" a secas sí da
        margen de sobra en los tres (-24px / -36px en el peor caso,
        confirmado): el significado completo ("diversidad", "climático")
        ya no se pierde porque vive en la leyenda de abajo y en el tooltip
        (Ajuste 3) — no hacía falta que también cupiera, rotado, en el
        propio título del eje. Reafinar el margen de nuevo no se eligió
        porque ya falló una vez al no generalizar a leyendas/alturas
        distintas.
      */}
      <div ref={chartContainerRef} onTouchStart={handleTouch} onTouchMove={handleTouch}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={chartRows}
            margin={chartMargin}
            onMouseMove={(state) => {
              if (Date.now() - lastTouchAtRef.current < SYNTHETIC_MOUSE_WINDOW_MS) return;
              if (state?.activeLabel !== undefined) updateHoveredGeneration(Number(state.activeLabel));
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            {/*
              Ajuste 4 (auditoría de interfaz, ronda 3): el label "Generación"
              como "insideBottom" del eje X y la leyenda de abajo competían
              por un presupuesto de espacio vertical FIJO (~29.5px, medido)
              entre el fondo del área de líneas y el techo de la leyenda —
              ni `margin.bottom` en el LineChart ni `wrapperStyle` en el
              Legend lo cambiaron (probado con valores grandes, efecto cero).
              Con el label de 24px de alto, no quedaba margen para separar
              ambos lados al menos 8px cada uno bajo ningún reparto. Se saca
              el label del `<svg>` (mismo principio que el panel de hover del
              Ajuste 1: la geometría interna de Recharts es frágil para texto
              custom) y se renderiza como texto HTML plano debajo del
              gráfico, con margen CSS normal — ver `.chart-x-axis-label`.
            */}
            <XAxis
              dataKey="generation"
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            <YAxis
              yAxisId="fitness"
              domain={[0, "auto"]}
              label={{ value: "Fitness", angle: -90, position: "insideLeft", fill: CHART_AXIS_TEXT_COLOR }}
              tick={{ fill: CHART_AXIS_TEXT_COLOR }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={{ stroke: CHART_GRID_COLOR }}
            />
            {/*
              Mismo patrón que el eje de Población (v0.20.1), aplicado al
              caso que quedó afuera: las series climáticas están OCULTAS
              por defecto (DEFAULT_HIDDEN_KEYS), así que sin esto la
              primera pantalla mostraba un eje "Clima" con escala
              numérica y ninguna línea que lo usara. También cubre una
              corrida sin módulo climático, donde `climateKeys` viene
              vacío y no existe ninguna serie para ese eje.
            */}
            {showClimateAxis && (
              <YAxis
                yAxisId="climate"
                orientation="right"
                domain={[0, "auto"]}
                label={{ value: "Clima", angle: 90, position: "insideRight", fill: CHART_AXIS_TEXT_COLOR }}
                tick={{ fill: CHART_AXIS_TEXT_COLOR }}
                axisLine={{ stroke: CHART_GRID_COLOR }}
                tickLine={{ stroke: CHART_GRID_COLOR }}
              />
            )}
            {/*
              Tercer eje (población): NO comparte escala con "Fitness" (~0-3) ni
              con "Clima" (0-16) — el máximo teórico real es gridWidth*gridHeight
              (hasta 1600, RNF-008), un orden de magnitud por encima de ambos.
              Recharts apila un segundo eje "right" hacia afuera del primero
              automáticamente; `margin.right` vale 60 mientras este eje existe,
              para darle espacio a esa segunda columna de ticks sin recortarla
              (mismo tipo de bug ya cazado con Playwright para el eje
              izquierdo/derecho originales — ver el comentario grande arriba).

              Solo se renderiza si "Población viva" está visible en la leyenda:
              su `<Line>` usa `hide={hiddenKeys.has(...)}` sobre el MISMO
              `hiddenKeys`, así que eje y línea se apagan siempre juntos —
              Recharts nunca queda con una serie apuntando a un eje inexistente.
            */}
            {showPopulationAxis && (
              <YAxis
                yAxisId="population"
                orientation="right"
                domain={[0, "auto"]}
                label={{ value: "Población", angle: 90, position: "insideRight", fill: CHART_AXIS_TEXT_COLOR }}
                tick={{ fill: CHART_AXIS_TEXT_COLOR }}
                axisLine={{ stroke: CHART_GRID_COLOR }}
                tickLine={{ stroke: CHART_GRID_COLOR }}
              />
            )}
            {/*
              Ajuste 1 (auditoría de interfaz post-producción) + Mejora 1
              (panel fijo que no desaparece al hacer scroll): el tooltip
              flotante de Recharts tapaba justo las líneas que el usuario
              quería ver, y además desaparecía apenas el mouse salía del SVG
              (imposible de leer si hacía falta scrollear). Se suprime el
              cuadro flotante por completo (`content={() => null}`, se
              mantiene solo la línea guía del cursor) y el panel de valores
              vive fuera del `<svg>` (`.chart-hover-panel`, debajo de la
              leyenda) — nunca puede taparse, y con `onMouseLeave` sin
              limpiar el estado, se queda mostrando los últimos valores
              vistos en vez de desaparecer.
            */}
            <Tooltip content={() => null} cursor={{ stroke: CHART_AXIS_TEXT_COLOR, strokeDasharray: "3 3" }} />
            {/*
              Mejora 2 (leyenda interactiva): `content` custom en vez del
              render default de Recharts — necesitamos control exacto sobre
              la opacidad de una línea oculta (~30%, un valor de producto
              específico) y el `onClick` de toggle, en vez de confiar en el
              estilo "inactive" que Recharts aplica por defecto (pensado
              para tachar texto, no para esta paleta oscura). Sigue siendo
              el mismo `<Legend>` de Recharts — solo se le reemplaza el
              contenido, no el componente.
            */}
            <Legend
              content={() => (
                <ul className="chart-legend" ref={legendRef}>
                  {seriesList.map((s) => {
                    const isHidden = hiddenKeys.has(s.dataKey);
                    return (
                      <li
                        key={s.dataKey}
                        data-series-key={s.dataKey}
                        className="chart-legend-item"
                        style={{ opacity: isHidden ? 0.3 : 1 }}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSeries(s.dataKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSeries(s.dataKey);
                          }
                        }}
                      >
                        <span className="chart-legend-swatch" style={{ background: s.color }} />
                        {s.name}
                      </li>
                    );
                  })}
                </ul>
              )}
            />
            {/*
              RNF-004 (2ª verificación con persona real, "Cambio 2"): la
              persona buscó los eventos catastróficos visualmente y no los
              encontró — con stroke fino (1px default) y punteado chico
              (2 2), esta línea se perdía entre las 5 líneas de colores
              saturados del gráfico. Más gruesa, más sólida (dash más largo)
              y un rojo más vívido para que lea como "marcador de alerta",
              no como una grilla de fondo más.
            */}
            {catastropheGenerations.map((generation) => (
              <ReferenceLine
                key={generation}
                x={generation}
                yAxisId="fitness"
                stroke="#d90429"
                strokeWidth={2.5}
                strokeDasharray="6 3"
                ifOverflow="extendDomain"
              />
            ))}
            {/* Mejora 2: `hide` mantiene el ítem en la leyenda (atenuado) sin dibujar la línea — ocultar el <Line> por completo también le haría desaparecer de la leyenda, que no es lo pedido. */}
            {seriesList.map((s) => (
              <Line
                key={s.dataKey}
                yAxisId={s.yAxisId}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                isAnimationActive={false}
                hide={hiddenKeys.has(s.dataKey)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-x-axis-label">Generación</p>
      {/*
        Mejora 1: panel de valores fijo, no un tooltip flotante — vive
        fuera del `<svg>`, así que hacer scroll para leerlo nunca lo hace
        desaparecer (a diferencia del tooltip original de Recharts, que
        se ocultaba apenas el mouse salía del área del gráfico). Solo
        muestra las series actualmente VISIBLES (Mejora 2): si el usuario
        ocultó "Clima: AND" desde la leyenda, ese valor no aparece acá,
        aunque el snapshot lo tenga.
      */}
      <div className="chart-hover-panel">
        {visibleSeries.length === 0 ? (
          <p className="chart-hover-placeholder">Activá al menos una línea en la leyenda para ver los valores.</p>
        ) : hoveredRow ? (
          <div className="chart-values-panel">
            <p className="chart-values-generation">Generación {hoveredRow.generation}</p>
            {/*
              RF-015: en Lenta y Moderada la catástrofe ocurre antes del
              ciclo de reproducción de la misma generación, así que la
              grilla se rellena y la curva de población queda plana — las
              líneas verticales rojas parecían no tener consecuencia. La
              segunda oración existe por eso: el número solo dice QUÉ pasó,
              y la duda real del usuario es por qué no lo ve en la curva.
            */}
            {(hoveredRow[CATASTROPHE_DEATHS_KEY] ?? 0) > 0 && (
              <p className="chart-values-catastrophe">
                ⚡ Catástrofe: murieron {hoveredRow[CATASTROPHE_DEATHS_KEY]} organismos. La población se rellenó en la
                misma generación, así que la curva no baja.
              </p>
            )}
            {(() => {
              const primary = visibleSeries.filter((s) => s.dataKey === "averageFitness" || s.dataKey === "populationSize");
              const climate = visibleSeries.filter((s) => s.yAxisId === "climate");
              const diversity = visibleSeries.filter((s) => s.dataKey === "geneticDiversity");
              return (
                <>
                  {primary.length > 0 && (
                    <p className="chart-values-row">
                      {primary.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: {formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                  {/*
                    Va INMEDIATAMENTE después de la fila de Fitness y
                    Población, no al final: su razón de existir es que la
                    contradicción con "Fitness promedio" sea inevitable en
                    la misma mirada. Se muestra siempre que haya una
                    generación bajo el cursor, sin depender de la leyenda:
                    no es una serie del gráfico y no se puede ocultar.
                  */}
                  <p className="chart-values-tasks">
                    Tareas lógicas resueltas: {hoveredRow[TASKS_SOLVED_KEY] ?? 0}
                    {(hoveredRow[TASKS_SOLVED_KEY] ?? 0) === 0 &&
                      " — ningún organismo resolvió AND, NOT u OR en esta generación."}
                  </p>
                  {climate.length > 0 && (
                    <p className="chart-values-row">
                      {climate.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: ×{formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                  {diversity.length > 0 && (
                    <p className="chart-values-row">
                      {diversity.map((s) => (
                        <span key={s.dataKey} style={{ color: s.color }}>
                          {s.name}: {formatMetricValue(hoveredRow[s.dataKey] ?? 0)}
                        </span>
                      ))}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <p className="chart-hover-placeholder">Pasá el mouse sobre el gráfico para ver los valores.</p>
        )}
      </div>
      {/*
        CAMBIO 2 de la revisión de terminología. El pedido original hablaba
        de la descripción de "Fitness promedio" en FIXED_METRIC_DESCRIPTIONS,
        pero esa constante no existe: las descripciones por métrica se
        eliminaron en v0.20.0 junto con `describeMetric` y `ChartTooltip`,
        porque el tooltip flotante tapaba justamente las líneas que el
        usuario quería leer.

        Va como caption, que es donde ya viven las aclaraciones del gráfico
        (diversidad, eventos catastróficos) — y tiene una ventaja sobre el
        tooltip que reemplaza: se lee sin tener que descubrir que hay que
        pasar el mouse.
      */}
      <p className="chart-caption">
        <strong>Fitness promedio</strong>: tasa de nacimientos por organismo en esta generación — indica qué tan bien se
        está adaptando la POBLACIÓN en este momento. No confundir con el éxito reproductivo individual que muestra la
        grilla, que es acumulado desde que nació cada organismo.
      </p>
      {/*
        CAMBIO 3: no existía ninguna descripción de esta métrica en el
        gráfico — la única mención a tareas lógicas en toda la UI estaba en
        el panel de inspección de un organismo. Va junto a la definición de
        "Fitness promedio" porque las dos se leen en el mismo panel y es la
        comparación entre ambas la que importa.
      */}
      <p className="chart-caption">
        <strong>Tareas lógicas resueltas</strong>: cantidad de veces que algún organismo resolvió correctamente una tarea
        lógica en esta generación. Puede quedar en cero mientras el fitness promedio sube — son dos cosas distintas.
      </p>
      <p className="chart-caption">
        La diversidad genética es una aproximación: compara genomas por posición sin alinearlos, así que una parte del
        número (hasta ~27% de una diferencia real comparable, medido) puede venir de que los genomas tienen distinta
        longitud, no solo de que sean funcionalmente distintos.
      </p>
      {catastropheGenerations.length > 0 && (
        <p className="chart-caption">
          Las líneas verticales punteadas marcan generaciones con un evento catastrófico (RF-015) — una caída puntual
          de la población, distinta de un clima que simplemente se puso desfavorable de forma gradual (RF-011).
        </p>
      )}
    </div>
  );
}
