#!/usr/bin/env bash
# podar-trozos-viejos.sh — Borra los trozos del dashboard que ningún deploy tocó
# en más de una semana. Lo llama deploy-remote.sh desde /var/www/classroomio.
#
# El rsync del workflow los protege del --delete: una pestaña abierta desde
# antes del deploy sigue pidiendo los de su build. La fecha sirve de marca
# porque rsync -a les deja la hora del build, así que los del build actual
# siempre son nuevos.
#
# Nunca corta el deploy: es limpieza, y salir con error acá dejaría corriendo
# los procesos viejos con los archivos nuevos ya en disco.
set -uo pipefail

DIR=apps/dashboard/build/client/_app/immutable

if [[ ! -d "$DIR" ]]; then
  echo "    No existe $DIR: nada que podar."
  exit 0
fi

antes=$(find "$DIR" -type f | wc -l)
if ! find "$DIR" -type f -mtime +7 -delete; then
  echo "    AVISO: quedaron trozos viejos sin borrar (¿archivos de otro usuario?)."
fi
find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
despues=$(find "$DIR" -type f | wc -l)
echo "    Podados $((antes - despues)) trozos; quedan $despues."
exit 0
