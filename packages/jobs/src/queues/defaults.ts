import type { JobsOptions, QueueOptions } from 'bullmq';

import { QUEUE_NAMES, type QueueName } from './names';

/**
 * Per-queue defaults. Tuned roughly for the workload:
 *
 * - Heavy/external work (media, transcription, webhooks): more attempts,
 *   longer backoff, longer retention so we can replay.
 * - Light/internal work (emails, notifications, outbox): faster retry,
 *   short retention.
 */
export const QUEUE_DEFAULTS: Record<QueueName, JobsOptions> = {
  [QUEUE_NAMES.media]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 7 * 86_400 }
  },
  [QUEUE_NAMES.mediaTranscribe]: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 14 * 86_400 }
  },
  // Reintentos largos a propósito: lo que más hace fallar un correo es el tope
  // por hora del servidor SMTP de la empresa, y con 5 intentos en 75 s el correo
  // moría antes de que el tope se renovara. Con 8 desde 1 min (1, 2, 4… 64 min)
  // la ventana cubre unas 2 horas.
  [QUEUE_NAMES.emails]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 6 * 3_600, count: 5_000 },
    removeOnFail: { age: 7 * 86_400 }
  },
  [QUEUE_NAMES.notifications]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 6 * 3_600, count: 5_000 },
    removeOnFail: { age: 7 * 86_400 }
  },
  [QUEUE_NAMES.webhooks]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 14 * 86_400 }
  },
  [QUEUE_NAMES.courseImports]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 86_400, count: 500 },
    removeOnFail: { age: 14 * 86_400 }
  },
  [QUEUE_NAMES.onboardingBootstrap]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 86_400, count: 500 },
    removeOnFail: { age: 14 * 86_400 }
  },
  [QUEUE_NAMES.maintenance]: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 7 * 86_400 }
  }
};

export function buildQueueOptions(name: QueueName, override?: Partial<QueueOptions>): QueueOptions {
  return {
    ...override,
    defaultJobOptions: {
      ...QUEUE_DEFAULTS[name],
      ...(override?.defaultJobOptions ?? {})
    }
  } as QueueOptions;
}
