/**
 * Purga del registro de auditoría.
 *
 * Corre una vez por día y borra lo anterior a la retención definida (un año por
 * defecto). Sin esto las tablas crecerían para siempre: no tanto por volumen
 * —con el criterio del mapa son cientos de filas por día, no millones— sino
 * porque guardar IPs y actividad de personas identificadas de forma indefinida
 * es difícil de justificar bajo la Ley 25.326, y una tabla que sólo crece
 * termina haciendo lentas sus propias consultas.
 *
 * Va en el proceso de la API y no en el worker de BullMQ a propósito: es una
 * sola sentencia DELETE por día y no necesita cola, reintentos ni Redis
 * levantado. La API corre en `fork` con una instancia (ver
 * `infra/ecosystem.config.cjs`), así que no hay dos procesos compitiendo.
 *
 * El primer tick se demora unos minutos también a propósito: al arrancar hay
 * cosas más urgentes (conectar Redis, precargar dominios, atender requests) que
 * un DELETE masivo.
 */

import { AUDIT_RETENTION_DAYS, purgeAudit } from '@api/services/audit';
import { env } from '@api/config/env';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;

/**
 * Los DOS temporizadores en vuelo, no sólo el intervalo.
 *
 * El arranque programa una primera pasada demorada y recién después el
 * intervalo diario. Guardar sólo el segundo hacía que `stopAuditPurge()`
 * frenara el ciclo pero dejara viva esa primera pasada: la purga volvía a
 * dispararse hasta cinco minutos después de haberla frenado, y un
 * stop → start seguido (una recarga de configuración, un test) terminaba con
 * dos purgas encoladas.
 */
let firstRun: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function startAuditPurge(intervalMs: number = ONE_DAY_MS): void {
  if (timer) return;

  if (env.AUDIT_PURGE_DISABLED === '1') {
    console.log('[audit-purge] desactivado por AUDIT_PURGE_DISABLED=1');
    return;
  }

  console.log(`[audit-purge] activo (cada ${intervalMs}ms, retención ${AUDIT_RETENTION_DAYS} días)`);

  const run = () => {
    void purgeAudit()
      .then((result) => {
        // Sólo se loguea si borró algo: en régimen normal casi nunca hay nada
        // que sacar, y una línea diaria de "borré 0" es ruido.
        if (result && (result.events > 0 || result.incidents > 0)) {
          console.log('[audit-purge] purga', result);
        }
      })
      // `purgeAudit` ya traga sus errores, pero esto corre desde el callback de
      // un `setInterval`: si alguna vez dejara de tragarlos, el rechazo saldría
      // acá, donde no lo atrapa nadie, y tumbaría el proceso de la API una vez
      // por día. No se depende de una promesa que hace otro archivo.
      .catch((error: unknown) => {
        console.error('[audit-purge] la purga rechazó', error);
      });
  };

  firstRun = setTimeout(run, INITIAL_DELAY_MS);
  firstRun.unref?.();

  timer = setInterval(run, intervalMs);
  timer.unref?.();
}

export function stopAuditPurge(): void {
  if (firstRun) {
    clearTimeout(firstRun);
    firstRun = null;
  }

  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
