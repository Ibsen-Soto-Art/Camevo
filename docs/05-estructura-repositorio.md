# CAMEVO — Estructura de Repositorio y Convenciones

**Versión 1.1 — Fase 0 (Documentación) — ver `CHANGELOG.md`**

## 1. Estructura propuesta (monorepo)

Se recomienda un **monorepo** con workspaces, dado que backend y frontend comparten tipos (contrato del snapshot de simulación, configuración de escenario), y es un proyecto de un solo desarrollador donde la sobrecarga de coordinar múltiples repos no aporta valor.

```
camevo/
├── docs/                          # Toda la documentación del proyecto
│   ├── CHANGELOG.md               # Registro de cambios de la documentación
│   ├── 01-vision-general.md
│   ├── 02-requisitos.md
│   ├── 03-arquitectura.md
│   ├── 04-roadmap-fases.md
│   └── 05-estructura-repositorio.md
├── apps/
│   ├── api/                       # Backend Node.js + TypeScript
│   │   ├── src/
│   │   │   ├── engine/
│   │   │   │   ├── organism/      # VM, genoma, instrucciones
│   │   │   │   ├── population/    # grilla, siembra multi-ancestro, colocación de descendencia
│   │   │   │   └── tasks/         # tareas lógicas, recompensas y recursos por tarea
│   │   │   ├── climate/
│   │   │   │   └── policy/        # módulo climático desacoplado (por recurso/tarea)
│   │   │   ├── simulation/
│   │   │   │   └── orchestrator/  # loop principal + gestión de semilla (reproducible/experimental)
│   │   │   ├── api/
│   │   │   │   ├── rest/          # endpoints REST (config, corridas, detalle de organismo)
│   │   │   │   └── ws/            # canal WebSocket
│   │   │   └── persistence/
│   │   │       └── repository/    # acceso a PostgreSQL
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                        # Frontend React + TypeScript + Vite
│       ├── src/
│       │   ├── components/
│       │   │   ├── grid/           # visualización de la grilla poblacional
│       │   │   ├── charts/         # fitness, diversidad, curva climática
│       │   │   ├── controls/       # panel de configuración de escenario
│       │   │   └── organism-detail/ # vista de organismo individual (genoma, tareas, fitness)
│       │   ├── hooks/
│       │   ├── services/           # cliente REST/WebSocket
│       │   └── pages/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   └── shared-types/               # Tipos TypeScript compartidos (snapshot, config, detalle de organismo)
│       └── src/
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── README.md
└── LICENSE
```

## 2. Convenciones de nomenclatura

- **Repositorio:** `camevo`
- **Dominio de despliegue:** `camevo.ibsen-soto.pro`
- **Servicios Docker:** `camevo-api`, `camevo-web`, `camevo-db`
- **Ramas Git** (Git Flow simplificado, adecuado para un solo desarrollador):
  - `main`: siempre desplegable, refleja producción.
  - `develop`: integración de trabajo en curso.
  - `feature/<nombre-corto>`: una rama por unidad de trabajo (ej. `feature/climate-policy-engine`, `feature/population-grid`).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Ejemplo: `feat(engine): implementar mutación por sustitución en genoma`.

## 3. Convenciones de código

- TypeScript en modo `strict` en ambos `apps/api` y `apps/web`.
- Los contratos de datos que cruzan la frontera backend↔frontend (snapshot de generación, configuración de escenario) se definen **una sola vez** en `packages/shared-types` y se importan desde ambos lados — nunca se duplican manualmente.
- El módulo `climate/policy` no debe importar nada de `engine/*`; la comunicación es unidireccional: el orquestador consulta la política climática y aplica el resultado al motor. Esto preserva el desacoplamiento definido en la arquitectura.
- Pruebas automatizadas obligatorias para `engine/*` y `climate/policy/*` por ser el núcleo crítico del proyecto (framework sugerido: Vitest, consistente con el ecosistema Vite).

## 4. Entorno de desarrollo local

- `docker-compose.yml` debe levantar los tres servicios (`api`, `web`, `db`) con hot-reload habilitado para desarrollo.
- Variables de entorno documentadas en `.env.example` (nunca commitear `.env` real).
- `README.md` en la raíz debe incluir: requisitos previos, comando único para levantar el entorno (`docker compose up`), y enlace a `docs/` para el resto de la documentación.

## 5. Próximo paso inmediato

Con esta documentación como base, el siguiente paso operativo es:

1. Renombrar/crear el repositorio como `camevo` (o renombrar el existente de `proVida`).
2. Actualizar el registro DNS del subdominio de `provida.ibsen-soto.pro` a `camevo.ibsen-soto.pro`.
3. Inicializar el monorepo con la estructura de carpetas descrita arriba (sin lógica de negocio todavía).
4. Comenzar la Fase 1 del roadmap: el motor de evolución digital sin clima.
