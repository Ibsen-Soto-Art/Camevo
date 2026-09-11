/**
 * Anomalía de temperatura media global anual (°C, respecto a la media
 * 1951-1980) — serie "Land-Ocean Temperature Index" (L-OTI) de NASA
 * GISTEMP v4, columna "J-D" (media enero-diciembre) de:
 *   https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv
 * Descargado una sola vez (no en tiempo de ejecución del servidor) el
 * 2026-09-11. Cubre 1880-2025 (146 años): 2026 se excluye porque el año
 * todavía no está completo en la fuente al momento de la descarga.
 *
 * Atribución requerida por NASA GISS: acreditar "NASA's Goddard Institute
 * for Space Studies" o "NASA GISS/GISTEMP" (ver data.giss.nasa.gov/gistemp).
 *
 * Fase 6: fuente real opcional para la curva climática (ClimateTrendSource
 * "historical") — ver historical.ts para cómo se mapea generación→año.
 */
export const GISTEMP_FIRST_YEAR = 1880;

export const GISTEMP_ANNUAL_ANOMALY_C: readonly number[] = [
  -0.18, -0.09, -0.12, -0.18, -0.29, -0.34, -0.32, -0.37, -0.18, -0.11,
  -0.36, -0.23, -0.28, -0.32, -0.31, -0.23, -0.12, -0.12, -0.28, -0.18,
  -0.09, -0.16, -0.29, -0.38, -0.48, -0.27, -0.23, -0.39, -0.43, -0.49,
  -0.44, -0.45, -0.37, -0.36, -0.17, -0.15, -0.37, -0.46, -0.30, -0.28,
  -0.28, -0.19, -0.29, -0.27, -0.27, -0.22, -0.11, -0.22, -0.20, -0.36,
  -0.16, -0.09, -0.16, -0.29, -0.13, -0.20, -0.15, -0.03, -0.01, -0.02,
  0.12, 0.18, 0.06, 0.09, 0.20, 0.09, -0.07, -0.03, -0.11, -0.11,
  -0.18, -0.07, 0.01, 0.08, -0.13, -0.14, -0.19, 0.05, 0.06, 0.03,
  -0.02, 0.06, 0.03, 0.05, -0.20, -0.11, -0.06, -0.02, -0.08, 0.05,
  0.03, -0.08, 0.01, 0.16, -0.07, -0.01, -0.10, 0.18, 0.07, 0.16,
  0.26, 0.32, 0.14, 0.31, 0.16, 0.12, 0.18, 0.32, 0.39, 0.27,
  0.45, 0.41, 0.22, 0.23, 0.32, 0.45, 0.33, 0.47, 0.61, 0.38,
  0.39, 0.53, 0.63, 0.62, 0.53, 0.68, 0.64, 0.66, 0.54, 0.66,
  0.72, 0.61, 0.65, 0.68, 0.75, 0.90, 1.01, 0.92, 0.85, 0.98,
  1.01, 0.85, 0.89, 1.17, 1.29, 1.19,
];
