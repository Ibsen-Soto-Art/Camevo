# Despliegue de Camevo (Fase 5)

Runbook para el VPS Hetzner (87.99.137.199) donde ya corren otros
proyectos con su propio Nginx del sistema. Camevo se agrega como un
dominio más, sin tocar los demás.

## 1. Preparar el `.env` de producción

En el servidor, dentro del checkout del repo:

```
cp .env.example .env
```

Editar `.env` con valores reales (ver comentarios en `.env.example`):
contraseña real de Postgres (no la de desarrollo), `CORS_ORIGIN` y
`VITE_API_URL` apuntando a `https://camevo.ibsen-soto.pro`, `DATABASE_URL`
usando `camevo-db` (nombre del servicio Docker) como host, no `localhost`.

## 2. Construir y levantar los contenedores

```
docker compose -f docker-compose.prod.yml up -d --build
```

`camevo-db` no publica su puerto al host; `camevo-api` y `camevo-web`
publican solo en `127.0.0.1` (ver comentarios en `docker-compose.prod.yml`)
— nada queda expuesto a Internet directamente, todo pasa por el Nginx
del host.

## 3. Instalar el Nginx del host

```
sudo cp deploy/nginx/camevo.conf /etc/nginx/sites-available/camevo.conf
sudo ln -s /etc/nginx/sites-available/camevo.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

En este punto `http://camevo.ibsen-soto.pro` debe responder (redirigiendo
a HTTPS, que todavía fallará hasta el paso 4 — es esperado).

## 4. Emitir el certificado (Let's Encrypt / Certbot)

Se usa `certonly --webroot`, no `--nginx`: así Certbot solo escribe los
archivos de certificado y `deploy/nginx/camevo.conf` sigue siendo la
única fuente de verdad de la configuración de Nginx (no queda editado a
mano por la herramienta).

```
sudo certbot certonly --webroot -w /var/www/certbot -d camevo.ibsen-soto.pro
sudo nginx -t && sudo systemctl reload nginx
```

### Renovación automática

Los paquetes de Certbot en la mayoría de distros ya instalan un timer de
systemd (`certbot.timer`) o una entrada en `/etc/cron.d/certbot` que
corre `certbot renew` dos veces al día — confirmar que está activo:

```
systemctl status certbot.timer
```

Si no existe, agregar un cron propio (renovación silenciosa + recarga de
Nginx solo si de verdad se renovó algo):

```
0 3 * * * certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

## 5. Verificar

- `https://camevo.ibsen-soto.pro` responde sin advertencia de certificado.
- `http://camevo.ibsen-soto.pro` redirige a HTTPS (301).
- Flujo completo contra el dominio real: crear una corrida, verla
  evolucionar en vivo (WebSocket a través del proxy), y comparar dos
  corridas guardadas (RF-025).

## Diferencias clave entre desarrollo y producción

| | `docker-compose.yml` (dev) | `docker-compose.prod.yml` |
|---|---|---|
| Credenciales Postgres | default `camevo`/`camevo` si `.env` no las fija | **requeridas** — arranque falla sin `.env` real |
| Puerto de Postgres | publicado al host (`5432`/`5433`) para que `npm test` conecte directo | no publicado — solo alcanzable por `camevo-api` dentro de la red Docker |
| CORS | sin `CORS_ORIGIN`, permite `localhost:5173`/`4173` | `CORS_ORIGIN` fijo a `https://camevo.ibsen-soto.pro` |
| `apps/web` | servido por Vite dev server | build estático de Vite servido por Nginx (dentro del contenedor) |
| Reverse proxy / TLS | ninguno (acceso directo a los puertos locales) | Nginx del host + Let's Encrypt, único punto de entrada público |
