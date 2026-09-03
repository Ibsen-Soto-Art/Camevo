# Camevo — apps/web (Fase 2)

Frontend mínimo: un formulario para crear una corrida y una gráfica que
superpone el fitness promedio (RF-020) con la curva climática por tarea
(RF-022), actualizada en tiempo real vía WebSocket.

## Desarrollo local

Requiere `apps/api` corriendo (ver su propio README/reporte de fase) y
Postgres levantado (`docker compose up -d camevo-db` desde la raíz del
repo).

```bash
npm install
VITE_API_URL=http://localhost:3001 npm run dev
```

`VITE_API_URL` apunta al backend REST/WebSocket; si no se define, usa
`http://localhost:3001` por defecto (`src/lib/camevo-client.ts`).
