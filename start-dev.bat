@echo off
REM ============================================================
REM  ClassroomIO - arranque en MODO DESARROLLO (hot-reload)
REM  Usa mas RAM que el modo compilado. Conviene cerrar VS Code
REM  antes de correr esto para liberar memoria.
REM  Docker (Postgres+Redis+MinIO) debe estar corriendo.
REM ============================================================

set ROOT=%~dp0
cd /d "%ROOT%"

echo.
echo [1/4] Levantando Postgres + Redis + MinIO en Docker...
docker compose -f docker/docker-compose.yaml --profile minio up -d postgres redis minio minio-init
if errorlevel 1 (
  echo ERROR: no se pudo iniciar Docker. Abri Docker Desktop y reintenta.
  pause
  exit /b 1
)

echo.
echo [2/4] Esperando a que Postgres este listo...
:waitpg
docker exec cio-postgres pg_isready -U postgres -d classroomio >nul 2>&1
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto waitpg
)
echo      Postgres OK.

echo.
echo [3/4] Iniciando API (puerto 3002) en una ventana nueva...
start "ClassroomIO API" cmd /k "cd /d %ROOT%apps\api && node --import tsx ./src/index.ts"

REM Dar unos segundos a que el API levante antes del dashboard
timeout /t 6 /nobreak >nul

echo.
echo [4/4] Iniciando Dashboard en modo DEV (puerto 5173) en una ventana nueva...
echo      (La primera carga tarda ~20-30s mientras Vite compila)
start "ClassroomIO Dashboard DEV" cmd /k "cd /d %ROOT% && pnpm --filter=@cio/dashboard run dev"

echo.
echo ============================================================
echo  Listo. Espera ~30s y abri el navegador en:
echo     http://localhost:5173/login
echo  Usuario: samuelocta215@gmail.com   Pass: 123456789-dev-only
echo.
echo  MODO DEV: los cambios en el codigo se ven al instante,
echo  pero usa mas RAM. Si va lento, usa start-local.bat
echo  (modo compilado, mas liviano).
echo.
echo  Para apagar: cerra las ventanas API y Dashboard.
echo  Liberar RAM de Docker:  docker compose -f docker/docker-compose.yaml stop
echo ============================================================
echo.
pause
