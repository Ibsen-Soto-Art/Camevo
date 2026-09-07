# Contexto de build: la raíz del monorepo (docker-compose.prod.yml lo invoca
# con `context: .`, no `context: apps/api`) — necesario para que `npm ci`
# resuelva el workspace @camevo/shared-types (packages/shared-types) tal
# como lo hace en desarrollo.
#
# Se corre con `tsx` en vez de compilar con `tsc` + ejecutar el JS resultante
# con `node`: el código fuente usa imports relativos sin extensión
# (`from "./server"`, no `from "./server.js"`), válido bajo
# moduleResolution "Bundler" (pensado para herramientas como tsx/vite, ver
# tsconfig.json) pero que Node ESM real rechaza sin un paso de bundling
# aparte. tsx ya es como corren dev:api y demo:fase1 en este proyecto —
# se reutiliza la misma estrategia en producción en vez de introducir un
# bundler nuevo (esbuild/rollup) solo para este Dockerfile.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci --workspace=@camevo/api --workspace=@camevo/shared-types --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["npx", "tsx", "src/api/main.ts"]
