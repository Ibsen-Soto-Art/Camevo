# Contexto de build: la raíz del monorepo (docker-compose.prod.yml lo invoca
# con `context: .`), igual que apps/api/Dockerfile — necesario para resolver
# el workspace @camevo/shared-types.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci --workspace=@camevo/web

FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
WORKDIR /app/apps/web
# Vite inlina las variables VITE_* en el bundle en tiempo de BUILD, no de
# ejecución — a diferencia de apps/api, esto no puede resolverse con una
# variable de entorno del contenedor en producción, tiene que ser un
# build-arg (docker-compose.prod.yml lo pasa como `build.args`).
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
