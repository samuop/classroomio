# Deploy de ClassroomIO en VPS (nativo) — Runbook

Despliegue de ClassroomIO en un VPS Hostinger (KVM1, 4GB), **conviviendo con saas-rrhh sin
tocarlo**. Build en GitHub Actions, runtime nativo (Node + Postgres + Redis), MinIO en Docker.

> Esto es una **prueba de recursos**: ver si el KVM1 aguanta la app completa antes de decidir si
> hace falta un KVM2 (8GB). Ver el plan en `~/.claude/plans/` para el análisis.

## Arquitectura

```
Cloudflare (TLS)
  ├── learn.tensor.com.ar     → :80 Nginx → 127.0.0.1:3082  (dashboard SSR)
  └── learn-api.tensor.com.ar → :80 Nginx → 127.0.0.1:3081  (API Hono)

VPS (nativo, PM2):           cio-api(3081) · cio-dashboard(3082) · cio-jobs(worker)
VPS (nativo, systemd):       PostgreSQL 16 + pgvector(5432) · Redis(6379)
VPS (Docker):                MinIO(9000 API / 9001 consola)
VPS (sin tocar):             saas-rrhh + MySQL  ← intacto
```

## Archivos de esta carpeta

| Archivo | Qué hace |
|---|---|
| `setup-vps.sh` | Provisioning idempotente (correr 1 vez como root en el VPS). |
| `deploy-remote.sh` | Pasos post-rsync (install + db:setup + MinIO + PM2). Lo llama el workflow. |
| `ecosystem.config.cjs` | PM2: 3 procesos Node con límites de RAM. |
| `nginx-classroomio.conf` | 2 server blocks (dashboard + API). No toca saas-rrhh. |
| `postgres-tuning.conf` | Tuning de Postgres para RAM baja (drop-in conf.d). |
| `minio-compose.yaml` | MinIO + init de buckets (único contenedor Docker). |
| `minio.env` | **Crear a mano** — credenciales y límite de RAM de MinIO. |

## Puesta en marcha (una vez)

### 1. Provisioning del VPS
```bash
# En el VPS, como root:
git clone https://github.com/samuop/classroomio.git /var/www/classroomio
cd /var/www/classroomio
sudo bash infra/setup-vps.sh
```
Guardá la `DATABASE_URL` que imprime al final (la necesitás para el `.env` de la API).

### 2. Credenciales de MinIO
```bash
# En el VPS:
cat > /var/www/classroomio/infra/minio.env <<EOF
MINIO_ROOT_USER=cio-minio
MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)
MINIO_MEM_LIMIT=256m
EOF
```
Usá estos mismos valores como `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY`
en el `.env` de la API.

### 3. DNS en Cloudflare
Dos registros **A**, ambos *proxied* (nube naranja), apuntando a la IP del VPS:
- `learn` → `<IP_VPS>`
- `learn-api` → `<IP_VPS>`

**Modo TLS:** empezá con *Flexible* (Cloudflare↔origin en HTTP:80, que es lo que sirve Nginx).
Para *Full (strict)* hay que instalar un Cloudflare Origin Certificate en Nginx (listen 443 ssl) —
no necesario para la prueba.

### 4. Secrets en GitHub Actions
`Settings → Secrets and variables → Actions → New repository secret`:

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o host del VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | clave SSH privada con acceso al VPS (la pública va en `~deploy/.ssh/authorized_keys`) |
| `VPS_CIO_API_ENV` | contenido completo del `.env` de la API (plantilla abajo) |
| `VPS_CIO_DASHBOARD_ENV` | contenido completo del `.env` del dashboard (plantilla abajo) |

#### Plantilla `VPS_CIO_API_ENV`
```
NODE_ENV=production
PORT=3081
PUBLIC_IS_SELFHOSTED=true
PUBLIC_SERVER_URL=https://learn-api.tensor.com.ar
PUBLIC_TENANT_ROOT_DOMAIN=tensor.com.ar
TRUSTED_ORIGINS=https://learn.tensor.com.ar
DASHBOARD_ORIGIN=https://learn.tensor.com.ar
BETTER_AUTH_SECRET=<openssl rand -hex 32>
AUTH_COOKIE_DOMAIN=.tensor.com.ar
AUTH_BEARER_TOKEN=<TOKEN_A: openssl rand -hex 32>
PRIVATE_SERVER_KEY=<TOKEN_A: el MISMO de arriba>
DATABASE_URL=postgresql://cio:<DB_PASS>@127.0.0.1:5432/classroomio
PRIVATE_DATABASE_URL=postgresql://cio:<DB_PASS>@127.0.0.1:5432/classroomio
REDIS_URL=redis://127.0.0.1:6379
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_PUBLIC_ENDPOINT=http://<IP_VPS>:9000
OBJECT_STORAGE_ACCESS_KEY_ID=cio-minio
OBJECT_STORAGE_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_BUCKET_VIDEOS=videos
OBJECT_STORAGE_BUCKET_DOCUMENTS=documents
OBJECT_STORAGE_BUCKET_MEDIA=media
OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL=http://<IP_VPS>:9000/media
```
> `OBJECT_STORAGE_PUBLIC_ENDPOINT` / `MEDIA_PUBLIC_BASE_URL` deben ser alcanzables por el
> **navegador**. Para servir media por dominio en vez de IP:9000, descomentar el tercer server
> block de `nginx-classroomio.conf` y usar `https://learn-files.tensor.com.ar`.

> **`PUBLIC_TENANT_ROOT_DOMAIN` (dominio raíz de los subdominios de empresa):** los subdominios
> `<empresa>.tensor.com.ar` se generan a partir del `siteName` de cada org usando esta variable.
> ⚠️ En el **dashboard** se hornea en el **build** (el workflow la pasa como env en el step Build —
> ver `deploy-classroomio.yml`), porque el bundle del browser la incrusta como literal; ponerla solo
> en el `.env` del VPS NO alcanza para el lado cliente. Se incluye igual en ambos `.env` para el SSR
> y el server. Requiere el A record wildcard `*.tensor.com.ar` en Cloudflare + el server block wildcard
> de Nginx.

#### Plantilla `VPS_CIO_DASHBOARD_ENV`
```
NODE_ENV=production
PORT=3082
PUBLIC_IS_SELFHOSTED=true
ORIGIN=https://learn.tensor.com.ar
PUBLIC_SERVER_URL=https://learn-api.tensor.com.ar
PUBLIC_TENANT_ROOT_DOMAIN=tensor.com.ar
PRIVATE_SERVER_URL=http://127.0.0.1:3081
PRIVATE_SERVER_KEY=<TOKEN_A: el MISMO de la API>
AUTH_BEARER_TOKEN=<TOKEN_A: el MISMO de la API>
PRIVATE_APP_HOST=tensor.com.ar
PRIVATE_APP_SUBDOMAINS=learn
```

### 5. Primer deploy
Push a `main` (o `Actions → Deploy ClassroomIO to VPS → Run workflow`). El workflow buildea,
hace rsync, escribe los `.env`, y corre `deploy-remote.sh`.

## Verificación

```bash
# En el VPS:
pm2 ls                                   # cio-api, cio-dashboard, cio-jobs → online
docker ps                                # cio-minio arriba
curl -sS  http://127.0.0.1:3081/         # API responde JSON
curl -I   http://127.0.0.1:3082/         # dashboard 200
curl -I   http://127.0.0.1:9000/minio/health/live
pm2 logs cio-jobs --lines 20             # 'all-workers-running' + 'ffmpeg-binaries-resolved'
sudo -u postgres psql -d classroomio -c "\dx"   # extensión 'vector' presente

# saas-rrhh sigue intacto:
pm2 describe saas-rrhh-backend && curl -sS http://127.0.0.1:4000/health
```

Luego en el navegador: `https://learn.tensor.com.ar` → crear org, login (verifica cookie
cross-subdominio), crear curso + lección, **subir un video corto** y ver en `pm2 logs cio-jobs`
que corren probe/thumbnail.

## Medición de recursos (el objetivo de la prueba)

```bash
free -h          # RAM total/usada — esperado ~2GB en reposo con saas-rrhh
pm2 monit        # RAM por proceso Node
docker stats --no-stream cio-minio
htop             # mirar el pico durante una transcodificación de video
```
Anotar: reposo, bajo navegación, y **durante el pico de ffmpeg**. Con eso se decide KVM1 vs KVM2.

## Optimizaciones activas
- Postgres tuning RAM baja (`postgres-tuning.conf`).
- PM2 `max_memory_restart` (api/dashboard 450M, jobs 600M) + heap `--max-old-space-size=384`.
- **Concurrencia de media = 1**: para limitar el pico de ffmpeg, agregar al `.env` de la API
  (lo hereda el worker por el symlink):
  ```
  MEDIA_WORKER_CONCURRENCY=1
  TRANSCRIBE_WORKER_CONCURRENCY=1
  ```
- MinIO con `mem_limit` (256m por defecto, en `minio.env`).

## Troubleshooting

| Síntoma | Causa probable / fix |
|---|---|
| Workflow falla en `db:setup` por `drizzle-kit` | `deploy-remote.sh` instala con devDeps (sin `--prod`) justo por esto. Si falla igual, revisar que el rsync no excluyó algo del workspace. |
| `cio-jobs` se reinicia en loop | Falta `REDIS_URL` (obligatorio para el worker) o Redis caído: `systemctl status redis-server`. |
| `ffmpeg-binaries-missing` en logs | `apt install ffmpeg` no corrió: re-ejecutar `setup-vps.sh` o instalar a mano. |
| Login no setea cookie | `AUTH_COOKIE_DOMAIN=.tensor.com.ar` y `ORIGIN`/`TRUSTED_ORIGINS` con `https://`. Revisar modo TLS de Cloudflare. |
| pgvector ausente | App funciona igual (fallback a text search). Para habilitarlo: instalar `postgresql-16-pgvector` (PGDG) y `CREATE EXTENSION vector`. |
| "No space left on device" | `docker system df`, `docker builder prune`. Vigilar el volumen de MinIO (videos). |

## Apagar la prueba sin afectar saas-rrhh
```bash
pm2 delete cio-api cio-dashboard cio-jobs && pm2 save
docker compose -f /var/www/classroomio/infra/minio-compose.yaml down
sudo rm /etc/nginx/sites-enabled/classroomio && sudo systemctl reload nginx
# (opcional) DROP DATABASE classroomio;  y borrar /var/www/classroomio
```
Postgres/Redis/Nginx quedan instalados pero ociosos; saas-rrhh sigue corriendo.
