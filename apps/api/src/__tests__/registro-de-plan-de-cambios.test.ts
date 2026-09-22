import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El registro de un plan de cambios: la línea de base se fija UNA sola vez.
 *
 * ── Por qué esto tiene su propio test ────────────────────────────────────────
 *
 * La línea de base es lo único del registro que no se puede recalcular: mide
 * cómo estaba la lección ANTES de que la ronda la tocara. Si cada sincronización
 * la volviera a escribir, quedaría igual al contenido de ahora, y entonces un
 * ítem `rewrite` ya hecho volvería a leerse como pendiente en la ronda
 * siguiente — para siempre. El ancla lo ordenaría reescribir una y otra vez,
 * que es el mismo defecto que producía las lecciones duplicadas, con otro
 * disfraz.
 *
 * El plan se sincroniza en CADA ronda (ver `agent.ts`), así que la segunda vez
 * es el caso normal y no el raro.
 */

/** Una fila de `ai_agent_run_step`, como la guarda la base. */
type Fila = {
  runId: string;
  stepKey: string;
  stepType: string;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  createdAt: string;
};

const filas: Fila[] = [];
let reloj = 0;

/** Un encadenado de drizzle: `where`/`orderBy`/`limit` devuelven lo mismo, y el final se espera. */
function consulta(cargar: () => unknown[]) {
  const encadenado: Record<string, unknown> = {
    where: () => encadenado,
    orderBy: () => encadenado,
    limit: () => encadenado,
    then: (resolver: (v: unknown) => unknown, rechazar: (e: unknown) => unknown) =>
      Promise.resolve(cargar()).then(resolver, rechazar)
  };

  return encadenado;
}

vi.mock('@cio/db/drizzle', async () => {
  const schema = await import('@cio/db/schema');

  const db = {
    select: () => ({
      from: (tabla: unknown) =>
        tabla === schema.aiAgentRun
          ? consulta(() => [{ id: 'corrida-1' }])
          : consulta(() => filas.map((fila) => ({ ...fila })))
    }),
    insert: () => ({
      values: (valores: Fila) => ({
        onConflictDoUpdate: ({ set }: { set: Partial<Fila> }) => {
          const existente = filas.find((fila) => fila.stepKey === valores.stepKey);

          // `output` NO está en el `set` a propósito: re-sincronizar un plan
          // nunca puede soltar una atadura. La base se comporta igual.
          if (existente) Object.assign(existente, set);
          else filas.push({ ...valores, createdAt: `t${reloj++}` });

          return Promise.resolve();
        }
      })
    }),
    update: () => ({
      set: (valores: Partial<Fila>) => ({
        where: () => {
          for (const fila of filas) Object.assign(fila, valores);
          return Promise.resolve();
        }
      })
    })
  };

  return { db };
});

import { syncPlanRegistry } from '@cio/db/queries/agent/plan-registry';

const CORRIDA = { orgId: 'org', courseId: 'curso', conversationId: 'conversacion', userId: 'usuario' };
const LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const planConBaseline = (contentHash: string) => ({
  sections: [
    {
      title: 'Mesa de Ayuda',
      entityId: '22222222-2222-4222-8222-222222222222',
      items: [
        {
          type: 'lesson' as const,
          title: 'Quién atiende cada reclamo',
          action: 'rewrite' as const,
          entityId: LECCION,
          baseline: { contentHash }
        }
      ]
    }
  ]
});

beforeEach(() => {
  filas.length = 0;
  reloj = 0;
});

describe('sincronizar un plan de cambios', () => {
  it('guarda la acción, la línea de base y la atadura de cada orden', async () => {
    const entradas = await syncPlanRegistry({ ...CORRIDA, plan: planConBaseline('hash-del-lunes') });
    const orden = entradas.find((entrada) => entrada.kind === 'lesson');

    expect(orden).toMatchObject({
      action: 'rewrite',
      baseline: { contentHash: 'hash-del-lunes' },
      entityId: LECCION
    });

    // La atadura viaja en `output`, que es donde la busca quien lee el registro.
    const fila = filas.find((f) => f.stepKey === orden!.key);
    expect(fila?.output).toEqual({ entityId: LECCION });
    expect(fila?.input).toMatchObject({ action: 'rewrite', baseline: { contentHash: 'hash-del-lunes' } });
  });

  it('la segunda sincronización NO pisa la línea de base', async () => {
    await syncPlanRegistry({ ...CORRIDA, plan: planConBaseline('hash-del-lunes') });
    // La ronda escribió: el contenido ya es otro, y con él el hash que el
    // servidor calcularía ahora.
    const entradas = await syncPlanRegistry({ ...CORRIDA, plan: planConBaseline('hash-del-martes') });

    const orden = entradas.find((entrada) => entrada.kind === 'lesson');
    expect(orden?.baseline).toEqual({ contentHash: 'hash-del-lunes' });

    const fila = filas.find((f) => f.stepKey === orden!.key);
    expect(fila?.input).toMatchObject({ baseline: { contentHash: 'hash-del-lunes' } });
  });

  /** Un plan de construcción común no lleva nada de esto y tiene que seguir igual. */
  it('un plan sin órdenes de cambio no guarda ni acción ni línea de base', async () => {
    const entradas = await syncPlanRegistry({
      ...CORRIDA,
      plan: { sections: [{ title: 'Arranque', items: [{ type: 'lesson', title: 'Bienvenida' }] }] }
    });

    const item = entradas.find((entrada) => entrada.kind === 'lesson');
    expect(item?.baseline).toBeUndefined();
    expect(item?.action).toBeUndefined();
    expect(item?.entityId).toBeNull();
    expect(filas.find((f) => f.stepKey === item!.key)?.output).toBeUndefined();
  });
});
