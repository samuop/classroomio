import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * El plan de cambios se ata y se sincroniza UNA vez: en la ronda de aprobación.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22: el bloque `if (approvedPlan)` de `agent.ts` corría
 * `estadoDelContenido` + `atarPlanDeCambios` + `syncPlanRegistry` también en las
 * rondas de continuación. `syncPlanRegistry` conserva el `baseline` viejo pero
 * toma los `replacements` del atado NUEVO — y el atado nuevo los calcula
 * barriendo el contenido de AHORA. O sea: apenas el modelo hacía desaparecer un
 * valor del texto, el ítem perdía sus reemplazos en el registro.
 *
 * En producción salió inocuo (ahí la medida cae en el hash), pero es un registro
 * que se borra solo, y encima cuesta un barrido y una escritura por ronda.
 *
 * Lo que se fija:
 *   1. cuál es la ronda de aprobación y cuál no (es la decisión de la que cuelga
 *      todo esto);
 *   2. que volver a atar DESPUÉS de editar borra los reemplazos del registro —
 *      el defecto, escrito como test para que no vuelva disfrazado;
 *   3. que leer el registro sin re-sincronizar los conserva.
 *
 * Curso inventado, de una mesa de ayuda que no existe.
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

/**
 * Los valores literales de una condición de drizzle (`and(eq(col, v), …)`).
 *
 * Hace falta porque acá se prueba una escritura POR CLAVE: un `where` que el
 * arnés ignora convierte «actualizá la fila s1.2» en «actualizá todas», y
 * entonces el test pasaría con una consulta que en producción pisa el registro
 * entero. Es la regla de que el arnés tiene que armar el mismo contexto que la
 * app, aplicada a la única parte del `where` que este test necesita.
 */
function literalesDe(condicion: unknown, profundidad = 0): string[] {
  if (profundidad > 8 || condicion == null) return [];
  if (Array.isArray(condicion)) return condicion.flatMap((parte) => literalesDe(parte, profundidad + 1));
  if (typeof condicion !== 'object') return [];

  const nodo = condicion as Record<string, unknown>;

  return [
    ...(typeof nodo.value === 'string' ? [nodo.value] : []),
    ...(Array.isArray(nodo.queryChunks) ? literalesDe(nodo.queryChunks, profundidad + 1) : [])
  ];
}

/** La forma de una clave del registro: `s1`, `s1.2`. Ver `syncPlanRegistry`. */
const CLAVE_DE_ITEM = /^s\d+(\.\d+)*$/;

/**
 * Las filas que una condición alcanza.
 *
 * Sólo se interpreta el `stepKey`, que es lo único por lo que estas consultas
 * apuntan a una fila concreta: una condición que nombra una clave alcanza a esa
 * fila y a ninguna otra —aunque no exista, que es justo el caso que hay que
 * poder probar—, y una que no nombra ninguna alcanza a toda la corrida.
 */
function alcanzadas<T extends { stepKey: string }>(lista: T[], condicion: unknown): T[] {
  const claves = literalesDe(condicion).filter((literal) => CLAVE_DE_ITEM.test(literal));

  return claves.length > 0 ? lista.filter((fila) => claves.includes(fila.stepKey)) : lista;
}

function consulta(cargar: () => unknown[]) {
  let condicion: unknown;

  const encadenado: Record<string, unknown> = {
    where: (valor: unknown) => {
      condicion = valor;
      return encadenado;
    },
    orderBy: () => encadenado,
    limit: () => encadenado,
    then: (resolver: (v: unknown) => unknown, rechazar: (e: unknown) => unknown) =>
      Promise.resolve(cargar())
        .then((crudas) => {
          const lista = crudas as Array<{ stepKey?: string }>;

          return lista[0]?.stepKey === undefined
            ? lista
            : alcanzadas(lista as Array<{ stepKey: string }>, condicion);
        })
        .then(resolver, rechazar)
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

          if (existente) Object.assign(existente, set);
          else filas.push({ ...valores, createdAt: `t${reloj++}` });

          return Promise.resolve();
        }
      })
    }),
    update: () => ({
      set: (valores: Partial<Fila>) => ({
        where: (condicion: unknown) => {
          for (const fila of alcanzadas(filas, condicion)) Object.assign(fila, valores);
          return Promise.resolve();
        }
      })
    })
  };

  return { db };
});

import { confirmarItemDelPlan, readPlanRegistry, syncPlanRegistry } from '@cio/db/queries/agent/plan-registry';
import { atarPlanDeCambios } from '@api/services/agent/plan-de-cambios';
import { esRondaDeAprobacionDelPlan } from '@api/services/agent/chat-context';

const CORRIDA = { orgId: 'org', courseId: 'curso', conversationId: 'conversacion', userId: 'usuario' };

const ID = {
  seccion: '22222222-2222-4222-8222-222222222222',
  leccion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const SECCIONES = [{ id: ID.seccion, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.leccion,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.seccion,
    order: 0
  }
];

const CON_EL_INTERNO = '<p data-block-id="b7">El reclamo se toma por el interno 4400.</p>';
const YA_CORREGIDA = '<p data-block-id="b7">El reclamo se toma por WhatsApp 11 5555-0101.</p>';

const ANALISIS = [
  {
    sourceId: 'fuente-1',
    fileName: 'circular.pdf',
    cambios: [
      {
        valorViejo: 'interno 4400',
        valorNuevo: 'WhatsApp 11 5555-0101',
        motivo: 'La circular reemplaza el interno por el WhatsApp.',
        clave: '4400'
      }
    ]
  }
];

const PLAN = {
  title: 'Actualización de la circular',
  description: 'd',
  scope: 'changes' as const,
  sections: [
    {
      title: 'Mesa de Ayuda',
      description: 'd',
      order: 0,
      sectionId: 'S1',
      items: [
        {
          type: 'lesson' as const,
          title: 'Quién atiende cada reclamo',
          description: 'd',
          order: 0,
          hasExercise: false,
          action: 'edit' as const,
          target: 'S1.L1',
          changes: 'El interno pasa a WhatsApp.'
        }
      ]
    }
  ]
};

function atarContra(contenido: string) {
  return atarPlanDeCambios({
    plan: PLAN as never,
    secciones: SECCIONES,
    items: ITEMS,
    lecciones: [{ id: ID.leccion, title: 'Quién atiende cada reclamo', content: contenido }],
    preguntasPorEjercicio: new Map(),
    analisis: ANALISIS as never
  }).registro;
}

beforeEach(() => {
  filas.length = 0;
  reloj = 0;
});

describe('cuál es la ronda de aprobación', () => {
  const aprobacion = {
    role: 'user',
    metadata: { plan: { action: 'implement_course_plan', payload: PLAN } }
  };

  it('el último mensaje del docente con la metadata del plan: sí', () => {
    expect(esRondaDeAprobacionDelPlan([{ role: 'assistant' }, aprobacion])).toBe(true);
  });

  it('una continuación, aunque el plan siga aprobado más atrás: no', () => {
    const continuacion = { role: 'user', content: 'Continue implementing the plan from where you left off' };

    expect(esRondaDeAprobacionDelPlan([aprobacion, { role: 'assistant' }, continuacion])).toBe(false);
  });

  it('una conversación sin plan aprobado: no', () => {
    expect(esRondaDeAprobacionDelPlan([{ role: 'user', content: 'Armame un curso' }])).toBe(false);
  });
});

describe('el registro de una orden de edición', () => {
  it('guarda los reemplazos en la ronda de aprobación', async () => {
    const entradas = await syncPlanRegistry({ ...CORRIDA, plan: atarContra(CON_EL_INTERNO) });
    const orden = entradas.find((entrada) => entrada.kind === 'lesson');

    expect(orden?.replacements).toMatchObject([{ old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }]);
  });

  /**
   * El defecto, escrito como test: volver a atar DESPUÉS de que el modelo editó
   * deja el ítem sin reemplazos, porque el barrido ya no encuentra el valor.
   * El arreglo es no volver a atar — ver `agent.ts`.
   */
  it('volver a atar después de editar BORRA los reemplazos del registro', async () => {
    await syncPlanRegistry({ ...CORRIDA, plan: atarContra(CON_EL_INTERNO) });
    const entradas = await syncPlanRegistry({ ...CORRIDA, plan: atarContra(YA_CORREGIDA) });

    expect(entradas.find((entrada) => entrada.kind === 'lesson')?.replacements).toBeUndefined();

    // Y no es sólo lo que devuelve: la fila guardada los perdió.
    const guardado = await readPlanRegistry(CORRIDA);
    expect(guardado.find((entrada) => entrada.kind === 'lesson')?.replacements).toBeUndefined();
  });

  it('leer el registro sin volver a atar los conserva', async () => {
    await syncPlanRegistry({ ...CORRIDA, plan: atarContra(CON_EL_INTERNO) });

    // La ronda de continuación: el modelo ya editó, y el servidor sólo LEE.
    const guardado = await readPlanRegistry(CORRIDA);

    expect(guardado.find((entrada) => entrada.kind === 'lesson')?.replacements).toMatchObject([
      { old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }
    ]);
    expect(guardado.find((entrada) => entrada.kind === 'lesson')?.baseline).toBeDefined();
  });
});

/**
 * La declaración del modelo (`confirm_change_applied`) se guarda en el mismo
 * registro y tiene que sobrevivir a lo que venga después: no sale del plan, sale
 * de algo que el asistente ya dijo. Borrarla volvería a reclamar un ítem que ya
 * explicó — o sea el bucle que la declaración existe para cortar.
 */
describe('la confirmación de un ítem', () => {
  const claveDeLaOrden = async () => {
    const entradas = await syncPlanRegistry({ ...CORRIDA, plan: atarContra(CON_EL_INTERNO) });

    return entradas.find((entrada) => entrada.kind === 'lesson')!.key;
  };

  it('se guarda con su motivo, sin pisar la línea de base ni los reemplazos', async () => {
    const clave = await claveDeLaOrden();

    expect(await confirmarItemDelPlan({ ...CORRIDA, planKey: clave, reason: 'La 2 horas que queda es la del P1.' })).toBe(
      true
    );

    const entrada = (await readPlanRegistry(CORRIDA)).find((fila) => fila.key === clave);

    expect(entrada?.confirmed).toMatchObject({ reason: 'La 2 horas que queda es la del P1.' });
    expect(entrada?.baseline).toBeDefined();
    expect(entrada?.replacements).toMatchObject([{ old: 'interno 4400' }]);
  });

  it('sobrevive a una sincronización posterior', async () => {
    const clave = await claveDeLaOrden();
    await confirmarItemDelPlan({ ...CORRIDA, planKey: clave, reason: 'La 2 horas que queda es la del P1.' });

    await syncPlanRegistry({ ...CORRIDA, plan: atarContra(YA_CORREGIDA) });

    expect((await readPlanRegistry(CORRIDA)).find((fila) => fila.key === clave)?.confirmed).toMatchObject({
      reason: 'La 2 horas que queda es la del P1.'
    });
  });

  it('una clave que no existe devuelve false en vez de escribir en otra fila', async () => {
    const clave = await claveDeLaOrden();

    expect(await confirmarItemDelPlan({ ...CORRIDA, planKey: 's9.9', reason: 'un motivo cualquiera' })).toBe(false);
    expect((await readPlanRegistry(CORRIDA)).find((fila) => fila.key === clave)?.confirmed).toBeUndefined();
  });
});
