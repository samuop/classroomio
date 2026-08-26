#!/usr/bin/env bash
# setup-vps.sh — Provisioning INICIAL de ClassroomIO en el VPS Hostinger.
#
# Correr UNA SOLA VEZ como root, después de clonar el repo en el VPS:
#   sudo bash infra/setup-vps.sh
#
# Es idempotente: se puede re-correr sin romper nada (chequea antes de instalar).
# NO toca saas-rrhh: reusa Node/PM2/Nginx si ya están, y agrega server blocks
# de Nginx separados por server_name.
#
# Qué instala/configura:
#   - Node 20.19.3 (si falta) + corepack/pnpm 10.19.0
#   - PostgreSQL 16 + pgvector  → DB `classroomio` + usuario `cio`
#   - Redis (broker de BullMQ, OBLIGATORIO para el worker)
#   - ffmpeg/ffprobe (media worker)
#   - Docker + compose (solo para MinIO) → levanta infra/minio-compose.yaml
#   - PM2 (si falta) + arranque al boot
#   - Nginx server blocks (learn / learn-api)
#   - Postgres tuning para RAM baja
#   - /var/www/classroomio y /var/log/classroomio

set -euo pipefail

# ── Config (ajustar si hace falta) ───────────────────────────────────────────
APP_DIR="/var/www/classroomio"
LOG_DIR="/var/log/classroomio"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
NODE_MAJOR="20"
PNPM_VERSION="10.19.0"
PG_VERSION="16"
DB_NAME="classroomio"
DB_USER="cio"
# Password de la DB: pasar por env o se genera uno. Guardarlo para el .env.
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"

log() { echo -e "\n[setup] $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Este script debe correr como root (sudo bash infra/setup-vps.sh)." >&2
  exit 1
fi

# ── 1. Sistema ───────────────────────────────────────────────────────────────
log "[1/10] Actualizando índices de paquetes..."
apt-get update -q

# ── 2. Node 20 + pnpm ────────────────────────────────────────────────────────
log "[2/10] Node.js ${NODE_MAJOR} + pnpm ${PNPM_VERSION}..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "Node ya presente: $(node -v)"
fi
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
echo "pnpm: $(pnpm -v)"

# ── 3. PostgreSQL 16 + pgvector ──────────────────────────────────────────────
log "[3/10] PostgreSQL ${PG_VERSION} + pgvector..."
if ! command -v psql >/dev/null 2>&1; then
  # Repo PGDG para asegurar PG 16 en cualquier Ubuntu soportado.
  apt-get install -y curl ca-certificates gnupg
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -y "postgresql-${PG_VERSION}"
else
  echo "PostgreSQL ya presente."
fi
# pgvector: nombre del paquete varía; intentar ambos.
apt-get install -y "postgresql-${PG_VERSION}-pgvector" 2>/dev/null \
  || apt-get install -y "postgresql-${PG_VERSION}-vector" 2>/dev/null \
  || echo "AVISO: no se pudo instalar pgvector por apt. La app igual arranca (fallback a text search). Resolver luego con PGDG."

systemctl enable postgresql
systemctl start postgresql

# Crear DB + usuario (idempotente).
log "Creando DB '${DB_NAME}' y usuario '${DB_USER}' (si no existen)..."
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
# pgvector necesita superuser para CREATE EXTENSION la primera vez; db:setup lo
# intenta como ${DB_USER}. Pre-habilitamos la extensión como postgres por las dudas.
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS vector;" \
  || echo "AVISO: no se pudo habilitar pgvector ahora (¿paquete ausente?). db:setup reintentará."

# Tuning de RAM baja (drop-in, no pisa el default).
PG_CONFD="/etc/postgresql/${PG_VERSION}/main/conf.d"
if [[ -d "$PG_CONFD" ]]; then
  cp "${APP_DIR}/infra/postgres-tuning.conf" "${PG_CONFD}/classroomio-tuning.conf"
  systemctl restart postgresql
  echo "Tuning de Postgres aplicado."
else
  echo "AVISO: ${PG_CONFD} no existe; aplicar tuning manualmente."
fi

# ── 4. Redis ─────────────────────────────────────────────────────────────────
log "[4/10] Redis (broker BullMQ — obligatorio)..."
if ! command -v redis-server >/dev/null 2>&1; then
  apt-get install -y redis-server
fi
systemctl enable redis-server
systemctl start redis-server
redis-cli ping || echo "AVISO: Redis no respondió ping."

# ── 5. ffmpeg ────────────────────────────────────────────────────────────────
log "[5/10] ffmpeg + ffprobe (media worker)..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get install -y ffmpeg
fi
ffmpeg -version | head -n1 || true

# ── 6. Docker (solo para MinIO) ──────────────────────────────────────────────
log "[6/10] Docker + compose (solo para MinIO)..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "Docker ya presente: $(docker --version)"
fi

# ── 7. PM2 ───────────────────────────────────────────────────────────────────
log "[7/10] PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
echo "PM2: $(pm2 --version)"

# ── 8. Usuario deploy + directorios ──────────────────────────────────────────
log "[8/10] Usuario '${DEPLOY_USER}' y directorios..."
if ! id -u "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
fi
# El usuario deploy necesita usar Docker (MinIO).
usermod -aG docker "$DEPLOY_USER" || true
mkdir -p "$APP_DIR" "$LOG_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR" "$LOG_DIR"

# ── 9. Nginx ─────────────────────────────────────────────────────────────────
log "[9/10] Nginx server blocks (learn / learn-api)..."
if ! command -v nginx >/dev/null 2>&1; then
  apt-get install -y nginx
  systemctl enable nginx
fi
if [[ -f "${APP_DIR}/infra/nginx-classroomio.conf" ]]; then
  cp "${APP_DIR}/infra/nginx-classroomio.conf" /etc/nginx/sites-available/classroomio
  ln -sf /etc/nginx/sites-available/classroomio /etc/nginx/sites-enabled/classroomio

  # Clientes con dominio propio: un .conf por empresa en infra/clientes/, que
  # está gitignoreada porque el repositorio es público (un `server_name` con el
  # dominio real publica quién es cliente de quién). Se copian tal cual.
  #
  # `nullglob` para que, si no hay ninguno, el for no reciba el patrón literal
  # y trate de copiar un archivo llamado "*.conf".
  shopt -s nullglob
  clientes=("${APP_DIR}"/infra/clientes/*.conf)
  shopt -u nullglob

  for conf in "${clientes[@]}"; do
    nombre="$(basename "${conf}" .conf)"
    cp "${conf}" "/etc/nginx/sites-available/classroomio-${nombre}"
    ln -sf "/etc/nginx/sites-available/classroomio-${nombre}" "/etc/nginx/sites-enabled/classroomio-${nombre}"
    echo "  + cliente con dominio propio: ${nombre}"
  done

  if [[ ${#clientes[@]} -eq 0 ]]; then
    echo "  (sin clientes con dominio propio; ver infra/clientes/cliente.conf.ejemplo)"
  fi

  nginx -t && systemctl reload nginx
  echo "Nginx configurado (no se tocó saas-rrhh)."
else
  echo "AVISO: falta infra/nginx-classroomio.conf en ${APP_DIR}."
fi

# ── 10. PM2 al boot ──────────────────────────────────────────────────────────
log "[10/10] PM2 startup..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" || true

# ── Resumen ──────────────────────────────────────────────────────────────────
cat <<RESUMEN

========================================================================
 Setup de ClassroomIO completo.
========================================================================

 Credenciales de la base de datos (GUARDALAS — van en apps/api/.env):
   DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}

 Próximos pasos:
   1. Crear infra/minio.env con MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.
   2. Configurar los secrets en GitHub Actions (ver infra/README.md):
        VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_CIO_API_ENV, VPS_CIO_DASHBOARD_ENV
      Usar la DATABASE_URL de arriba en VPS_CIO_API_ENV.
   3. DNS en Cloudflare: A learn → IP del VPS (proxied),
                         A learn-api → IP del VPS (proxied).
   4. Disparar el workflow (push a main o workflow_dispatch).
   5. Verificar: pm2 ls / docker ps / curl http://127.0.0.1:3081/

 saas-rrhh NO fue modificado.
========================================================================
RESUMEN
