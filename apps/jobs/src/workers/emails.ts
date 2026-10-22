import './../bootstrap';

import { Worker } from 'bullmq';

import { recordDeadLetterJob } from '@cio/db/queries';
import { JOB_NAMES, QUEUE_NAMES, createRedisConnection } from '@cio/jobs';

import { errorMessage } from '../utils/cancel';
import { env } from '../config/env';
import { log } from '../utils/logger';
import { processSendEmail } from '../processors/emails';

const concurrency = Number.parseInt(env.EMAIL_WORKER_CONCURRENCY ?? '5', 10) || 5;

/**
 * Freno de envío. Una invitación masiva encola cientos de correos de golpe, y el
 * servidor SMTP de una empresa (un hosting compartido) suele tener un tope por
 * hora que no publica: pasado el tope rechaza, y sin freno la cola lo alcanzaba
 * en un par de minutos. A un correo cada 4 s, cien invitaciones tardan unos 7
 * minutos en salir. Lo que igual choque contra el tope lo absorben los reintentos
 * largos de la cola (`QUEUE_DEFAULTS.emails`).
 */
const rateMax = Number.parseInt(env.EMAIL_WORKER_RATE_MAX ?? '1', 10) || 1;
const rateDurationMs = Number.parseInt(env.EMAIL_WORKER_RATE_DURATION_MS ?? '4000', 10) || 4000;

const connection = createRedisConnection();

const worker = new Worker(
  QUEUE_NAMES.emails,
  async (job) => {
    log.info('email-job-start', {
      jobName: job.name,
      bullmqJobId: job.id,
      attempt: job.attemptsMade + 1
    });

    switch (job.name) {
      case JOB_NAMES.emails.send:
        return processSendEmail(job.data);
      default:
        throw new Error(`Unknown emails job: ${job.name}`);
    }
  },
  { connection, concurrency, limiter: { max: rateMax, duration: rateDurationMs } }
);

worker.on('failed', async (job, err) => {
  if (!job) return;

  log.error('email-job-failed', {
    jobName: job.name,
    bullmqJobId: job.id,
    attempt: job.attemptsMade,
    error: errorMessage(err)
  });

  const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
  if (!isFinalAttempt) return;

  // BullMQ exhausted retries — write a dead-letter row so an operator can
  // inspect the payload + error and replay if needed.
  await recordDeadLetterJob({
    organizationId: null,
    domain: 'emails',
    runId: null,
    queueName: QUEUE_NAMES.emails,
    jobName: job.name,
    bullmqJobId: job.id ?? null,
    payload: job.data as Record<string, unknown>,
    error: { code: 'WORKER_EXHAUSTED_RETRIES', message: errorMessage(err), stack: err.stack },
    attempts: job.attemptsMade
  });
});

worker.on('ready', () =>
  log.info('email-worker-ready', { concurrency, rateMax, rateDurationMs, queue: QUEUE_NAMES.emails })
);
worker.on('error', (err) => log.error('email-worker-error', { error: errorMessage(err) }));

const shutdown = async (signal: string) => {
  log.info('email-worker-shutdown', { signal });
  await worker.close();
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
