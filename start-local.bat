@echo off
REM ============================================================
REM  ClassroomIO - arranque local (modo liviano / compilado)
REM  Docker solo para Postgres + Redis. API y dashboard en Node.
REM  Doble clic para levantar todo en orden.
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
timeout /t 5 /nobreak >nul

echo.
echo [4/4] Iniciando Dashboard compilado (puerto 5173) en una ventana nueva...
start "ClassroomIO Dashboard" cmd /k "cd /d %ROOT%apps\dashboard && set NODE_ENV=production&& set PORT=5173&& set ORIGIN=http://localhost:5173&& set PUBLIC_IS_SELFHOSTED=true&& set PUBLIC_SERVER_URL=http://localhost:3002&& set PRIVATE_SERVER_URL=http://localhost:3002&& set PRIVATE_SERVER_KEY=9LSaloK4YqxJVklOc5CdX+w5ULLm5AgyZPt3ksWHFLA=&& set PRIVATE_APP_HOST=localhost&& set PRIVATE_APP_SUBDOMAINS=app&& node build\index.js"

echo.
echo ============================================================
echo  Listo. Abri el navegador en:  http://localhost:5173/login
echo  Usuario: admin@test.com   Password: 123456
echo.
echo  Para apagar: cerra las dos ventanas (API y Dashboard) y,
echo  si queres liberar RAM, corre:
echo     docker compose -f docker/docker-compose.yaml stop
echo ============================================================
echo.
pause
