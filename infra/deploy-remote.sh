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
pnpm --filter @cio/db db:setup

echo "==> [4/5] Asegurando MinIO arriba (Docker)"
# Idempotente: si ya corre, compose no hace nada. minio.env tiene las credenciales.
if [[ -f infra/minio.env ]]; then
  docker compose -f infra/minio-compose.yaml --env-file infra/minio.env up -d
else
  echo "AVISO: falta infra/minio.env — levantando MinIO con credenciales por defecto."
  docker compose -f infra/minio-compose.yaml up -d
fi

echo "==> [5/5] (Re)cargando procesos PM2"
# startOrReload arranca si no existen, o recarga si ya corrían. --update-env
# relee NODE_ENV. Los .env de cada app los lee dotenv en runtime.
pm2 startOrReload infra/ecosystem.config.cjs --env production --update-env
pm2 save

echo "==> Deploy remoto completado."
echo "    Verificá: pm2 ls && docker ps && curl -sS http://127.0.0.1:3081/"
