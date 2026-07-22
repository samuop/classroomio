#!/usr/bin/env bash
# deploy-remote.sh — Pasos que corren EN el VPS tras el rsync de artefactos.
#
# Lo invoca el workflow de GitHub Actions vía SSH. También se puede correr a mano:
#   cd /var/www/classroomio && bash infra/deploy-remote.sh
#
# Precondición: el workflow ya hizo rsync de dist/ + build/ + package.jsons +
# pnpm-lock.yaml + pnpm-workspace.yaml + infra/, y escribió los .env de api y
# dashboard. Este script NO buildea (eso pasa en el runner de GitHub).

set -euo pipefail

APP_DIR="/var/www/classroomio"
cd "$APP_DIR"

echo "==> [1/5] Instalando dependencias de runtime (pnpm)"
# NO usamos --prod: db:setup necesita drizzle-kit (devDep de @cio/db) para
# `drizzle-kit push`. Instalar el árbol completo es seguro acá porque el VPS no
# buildea — solo resuelve node_modules y los symlinks @cio/* del workspace.
# --frozen-lockfile garantiza reproducibilidad; --shamefully-hoist evita problemas
# de resolución con paquetes que esperan hoisting plano.
pnpm install --frozen-lockfile --shamefully-hoist

echo "==> [2/5] Enlazando .env del worker → apps/api/.env"
# El jobs-worker comparte settings con la API (lo recomienda su .env.example).
ln -sf ../api/.env apps/jobs/.env

echo "==> [3/5] Setup de base de datos (pgvector + drizzle push + seed esencial)"
# Habilita la extensión vector, sincroniza el schema y siembra roles/tipos base.
# Idempotente: se puede correr en cada deploy.
#
# db-setup.ts hace `import 'dotenv/config'`, que carga el .env del cwd
# (packages/db/) — que no existe acá; el DATABASE_URL vive en apps/api/.env. Lo
# exportamos al entorno del comando leyéndolo de ese .env (sin duplicar el
# archivo). `set -a` auto-exporta cada var; filtramos solo las de DB/Redis.
(
  set -a
  # shellcheck disable=SC1090
  grep -E '^(DATABASE_URL|PRIVATE_DATABASE_URL|BETTER_AUTH_SECRET|REDIS_URL)=' apps/api/.env > /tmp/cio-db-setup.env
  source /tmp/cio-db-setup.env
  set +a
  pnpm --filter @cio/db db:setup
  rm -f /tmp/cio-db-setup.env
)

echo "==> [4/5] Asegurando MinIO arriba (Docker)"
# infra/minio.env está gitignored y el rsync --delete del workflow lo borra en
# cada deploy. Lo recreamos desde las credenciales del .env de la API (que son la
# fuente de verdad y sí llegan por el secret). Así MinIO usa las MISMAS que la API.
if [[ ! -f infra/minio.env ]]; then
  MINIO_U=$(grep -E '^OBJECT_STORAGE_ACCESS_KEY_ID=' apps/api/.env | cut -d= -f2-)
  MINIO_P=$(grep -E '^OBJECT_STORAGE_SECRET_ACCESS_KEY=' apps/api/.env | cut -d= -f2-)
  cat > infra/minio.env <<EOF
MINIO_ROOT_USER=${MINIO_U}
MINIO_ROOT_PASSWORD=${MINIO_P}
MINIO_MEM_LIMIT=256m
EOF
  chmod 600 infra/minio.env
  echo "    infra/minio.env recreado desde apps/api/.env"
fi
# Idempotente: si ya corre, compose no hace nada.
docker compose -f infra/minio-compose.yaml --env-file infra/minio.env up -d

echo "==> [5/5] (Re)cargando procesos PM2"
# startOrReload arranca si no existen, o recarga si ya corrían. --update-env
# relee NODE_ENV. Los .env de cada app los lee dotenv en runtime.
pm2 startOrReload infra/ecosystem.config.cjs --env production --update-env
pm2 save

echo "==> Deploy remoto completado."
echo "    Verificá: pm2 ls && docker ps && curl -sS http://127.0.0.1:3081/"
