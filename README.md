# Camevo

Simulador de evolución digital bajo cambio climático. Ver `docs/` para
la documentación completa (visión, requisitos, arquitectura, roadmap).

## Requisitos previos

- Node.js 22+
- Docker + Docker Compose (para Postgres)

## Entorno local

```bash
cp .env.example .env    # variables de Postgres/API (ver .env.example)
docker compose up -d camevo-db
```

### Motor + API (`apps/api`)

```bash
cd apps/api
npm install
npm test                # engine/*, climate/policy/*, api/*, persistence/*
npm run lint             # regla de frontera climate/policy → engine (ver eslint.config.mjs)
```

Levantar la API (REST + WebSocket) contra Postgres:

```bash
DATABASE_URL=postgres://camevo:camevo@localhost:5432/camevo API_PORT=3001 \
  npx tsx src/api/main.ts
```

### Frontend (`apps/web`)

```bash
cd apps/web
npm install
VITE_API_URL=http://localhost:3001 npm run dev
```

## Demo end-to-end de la Fase 2

Con `camevo-db`, `apps/api` y `apps/web` corriendo (pasos de arriba):

1. Abrir `http://localhost:5173`.
2. Dejar los valores por defecto (o ajustar tamaño de grilla/generaciones)
   y hacer clic en **Iniciar corrida**. Esto crea la corrida
   (`POST /runs`, persistida en Postgres) y abre un WebSocket
   (`/runs/:id/stream`) que transmite un snapshot por generación.
3. Observar la gráfica en vivo: la línea de **fitness promedio** (RF-020)
   y una línea por tarea (**NOT/AND/OR**) con el multiplicador de
   recompensa vigente según `climate/policy` (RF-022). Al estar
   desfasadas entre sí (RF-011), se ve claramente cómo en un momento dado
   una tarea está "abundante" mientras otra está "escaseando" — y cómo el
   fitness reacciona cuando cambia cuál tarea es más rentable en ese
   momento.
4. Al terminar (`estado: done`), `GET /runs/:id` devuelve la
   configuración persistida y todos los snapshots guardados —
   verificable con:
   ```bash
   curl http://localhost:3001/runs/<runId>
   ```
5. Para comparar con/sin clima, repetir con la casilla **Módulo
   climático activo** desactivada: las líneas de tarea desaparecen y el
   fitness deja de reaccionar a un multiplicador cambiante (usa el
   multiplicador fijo de `engine/tasks`, como en la Fase 1).

**Reproducibilidad (RNF-003):** con "Repetibilidad: Reproducible" y la
misma configuración, dos corridas producen exactamente la misma semilla
y la misma curva climática — verificado en
`apps/api/test/api/rest.test.ts` y `apps/api/test/climate/policy.test.ts`.
