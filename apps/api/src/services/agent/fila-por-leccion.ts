/**
 * Las herramientas que tocan la MISMA lección corren de a una.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-11-10, pedido «sacá el apartado X» sobre una lección de un curso real: el
 * modelo mandó cinco `replace_lesson_block` en el mismo paso, uno por bloque del
 * apartado. El SDK corre en paralelo las llamadas de un paso. Cada una leyó la
 * lección entera, sacó SU bloque y guardó la lección entera: la última en
 * guardar pisó a las otras cuatro. Las cinco devolvieron `updated: true`, en la
 * base se borró un bloque solo, y el asistente le dijo a la docente «eliminé el
 * apartado completo».
 *
 * No es del modelo: mandar las cinco juntas es lo razonable. Es de quien guarda
 * —leer, cambiar y escribir la lección entera sin que nadie más pueda meterse
 * en el medio—, así que se arregla acá y no en el prompt.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * Una fila por lección, en el proceso: toda llamada que nombra una lección
 * (`lessonId`) espera a que termine la anterior sobre esa misma lección. Las
 * lecturas también entran en la fila: `get_lesson_content` estampa ids la
 * primera vez (escribe), y leída detrás de un cambio del mismo paso devuelve lo
 * que ese cambio dejó. Lecciones distintas siguen en paralelo.
 *
 * La fila es del proceso, no de la ronda: dos conversaciones que cambian la
 * misma lección a la vez tampoco se pisan. No cubre al editor de la docente,
 * que guarda por otra ruta, ni a dos procesos de la API.
 */
import type { ToolSet } from 'ai';

/** Por lección, la última tarea encolada (ya sin su error: sólo marca el turno). */
const filas = new Map<string, Promise<void>>();

/** Corre `tarea` cuando terminó todo lo anterior con la misma `clave`. */
export function enFila<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
  const anterior = filas.get(clave) ?? Promise.resolve();
  // La que falla no frena a la que sigue: cada llamada informa su propio error.
  const resultado = anterior.then(tarea);
  const turno = resultado.then(
    () => undefined,
    () => undefined
  );

  filas.set(clave, turno);
  void turno.then(() => {
    // Sin nadie esperando detrás, la fila se tira: no crece con cada lección.
    if (filas.get(clave) === turno) filas.delete(clave);
  });

  return resultado;
}

/**
 * Envuelve las herramientas: la que recibe un `lessonId` entra en la fila de
 * esa lección.
 *
 * `resolver` lleva la manija (`S1.L3`) o el id al id de la lección, para que las
 * dos formas de nombrarla caigan en la misma fila. Si no resuelve —un id
 * inventado—, la llamada corre suelta y la herramienta da su propio error.
 */
export function conFilaPorLeccion(herramientas: ToolSet, resolver: (valor: string) => Promise<string>): ToolSet {
  const envueltas: ToolSet = {};

  for (const [nombre, herramienta] of Object.entries(herramientas)) {
    const original = (herramienta as { execute?: (...args: never[]) => Promise<unknown> }).execute;

    if (typeof original !== 'function') {
      envueltas[nombre] = herramienta;
      continue;
    }

    envueltas[nombre] = {
      ...herramienta,
      execute: async (...args: never[]) => {
        const pedida = (args[0] as { lessonId?: unknown } | undefined)?.lessonId;

        if (typeof pedida !== 'string' || !pedida.trim()) return original(...args);

        const leccion = await resolver(pedida).catch(() => undefined);

        return leccion ? enFila(leccion, () => original(...args)) : original(...args);
      }
    } as ToolSet[string];
  }

  return envueltas;
}
