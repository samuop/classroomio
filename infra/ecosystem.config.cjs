// PM2 process manager — ClassroomIO en VPS (deploy nativo).
//
// Tres procesos Node: API, dashboard SSR y jobs-worker. MinIO va en Docker
// aparte (ver infra/minio-compose.yaml), no acá.
//
// Usar en el VPS:  pm2 startOrReload infra/ecosystem.config.cjs --env production
// Ver estado:      pm2 ls
// Logs:            pm2 logs cio-api | cio-dashboard | cio-jobs
//
// Cada proceso lee su propio .env vía dotenv desde su cwd:
//   - apps/api/.env       (API)
//   - apps/dashboard/.env  (dashboard)
//   - apps/jobs/.env       (symlink → ../api/.env)
// Acá solo fijamos NODE_ENV/PORT como respaldo; el resto sale del .env.

const APP_DIR = '/var/www/classroomio';

// Heap acotado: fuerza un GC más agresivo en el VPS. Ajustable si se ve presión
// de memoria en la medición.
const NODE_HEAP = '--max-old-space-size=384';

// El build del dashboard (adapter-node) y el worker NO cargan .env por sí solos:
// leen del entorno del proceso. `-r dotenv/config` precarga dotenv, que lee el
// .env del cwd de cada app. Sin esto: "PRIVATE_SERVER_KEY is not configured" y
// 500 SSR. (El API ya hace `import 'dotenv/config'` en su código, pero incluirlo
// acá es idempotente y homogéneo.) PM2 7.0.1 no soporta `env_file`, por eso esto.
const WITH_DOTENV = `${NODE_HEAP} -r dotenv/config`;

// La API, con más margen que los otros dos. Con Node 24 una ronda del asistente
// la llevó a 484 MB de memoria y PM2 la reinició por pasar el techo de 450M: la
// ronda murió a los 100 segundos y a todo el que estaba usando la API se le
// cortó el pedido. Pasó dos veces seguidas; con Node 20 no había pasado nunca
// (el log de PM2 lo dice desde junio). Quieta ronda los 310 MB. El VPS tiene
// 8 GB y en reposo quedan 6 libres.
const API_HEAP = '--max-old-space-size=768';

module.exports = {
  apps: [
    {
      name: 'cio-api',
      cwd: `${APP_DIR}/apps/api`,
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      node_args: `${API_HEAP} -r dotenv/config`,
      max_memory_restart: '1024M',
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      out_file: '/var/log/classroomio/api-out.log',
      error_file: '/var/log/classroomio/api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'development', PORT: 3081 },
      env_production: { NODE_ENV: 'production', PORT: 3081 }
    },
    {
      name: 'cio-dashboard',
      cwd: `${APP_DIR}/apps/dashboard`,
      script: 'build/index.js',
      exec_mode: 'fork',
      instances: 1,
      node_args: WITH_DOTENV,
      max_memory_restart: '450M',
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      out_file: '/var/log/classroomio/dashboard-out.log',
      error_file: '/var/log/classroomio/dashboard-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'development', PORT: 3082 },
      env_production: { NODE_ENV: 'production', PORT: 3082 }
    },
    // cio-jobs: worker BullMQ (cola de emails → invitaciones a alumnos; media →
    // thumbnails/transcode de video). Reactivado tras implementar ffmpegProbeLuma
    // (utils/ffmpeg.ts), el bug que impedía compilar el worker. Lee apps/jobs/.env
    // (symlink → ../api/.env), así comparte SMTP/DB/Redis con la API.
    {
      name: 'cio-jobs',
      cwd: `${APP_DIR}/apps/jobs`,
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      node_args: WITH_DOTENV,
      max_memory_restart: '600M',
      autorestart: true,
      watch: false,
      kill_timeout: 30000,
      out_file: '/var/log/classroomio/jobs-out.log',
      error_file: '/var/log/classroomio/jobs-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' }
    }
  ]
};
