import { CoursePlanSchema } from '@cio/ai-assistant';
import type { CoursePlan } from './course-plan';

/**
 * Las lecciones del plan que no tienen material atrás, y cómo sacarlas.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * Al armar el plan el servidor marca qué lecciones no tienen ninguna fuente, y
 * el agente tenía que preguntarle a la docente qué hacer con ellas. Medido: lo
 * preguntó, ella no contestó, apretó «Aprobar y construir», y la construcción
 * arrancó igual; al escritor se le iba a decir que ella había aceptado que esas
 * lecciones se escribieran de conocimiento general, cosa que nunca dijo.
 *
 * Ahora la pregunta la hace la pantalla, en el momento en que decide: al tocar
 * aprobar. Una de las tres respuestas es sacarlas del plan, y eso lo resuelve
 * el cliente antes de mandar la aprobación.
 */

export interface LeccionSinFuente {
  /** Posición en el plan: sección e ítem. Estable mientras se edita el texto. */
  seccion: number;
  item: number;
  /** El título como se ve ahora (el docente pudo haberlo editado). */
  titulo: string;
  /** El título con que la nombra la cobertura. */
  tituloOriginal: string;
  /**
   * Las fuentes que cita, cuando cita alguna que apenas nombra el tema. Ausente
   * cuando no tiene ninguna fuente.
   */
  fuentesDebiles?: string[];
}

/**
 * Las lecciones que la cobertura marcó sin material, ubicadas por POSICIÓN.
 *
 * Son dos listas del servidor: las que no tienen ninguna fuente, y las que
 * citan una fuente que sólo nombra el tema (un temario). Las dos valen como
 * lecciones sin material: el servidor le dice al agente que las trate igual, y
 * dejar afuera las segundas era construirlas sin que nadie le preguntara nada
 * a la docente (medido: las lecciones de tablas dinámicas citaban un temario).
 *
 * La cobertura las nombra por título, y el docente puede editar los títulos
 * antes de aprobar: se buscan en el plan tal como llegó (`original`) y se
 * devuelven con el título de la versión editada. Sólo cuentan las lecciones
 * que se crean de cero, que son las únicas que el servidor midió.
 */
export function leccionesSinFuente(original: CoursePlan, editado: CoursePlan = original): LeccionSinFuente[] {
  // Por título, la cola de lo que dijo la cobertura: `null` = sin ninguna fuente.
  const pendientes = new Map<string, Array<string[] | null>>();
  const encolar = (titulo: string, fuentes: string[] | null) => {
    pendientes.set(titulo, [...(pendientes.get(titulo) ?? []), fuentes]);
  };

  for (const titulo of original.coverage?.lessonsWithoutSource ?? []) encolar(titulo, null);
  for (const debil of original.coverage?.lessonsWithWeakSource ?? []) {
    if (typeof debil?.lesson === 'string') encolar(debil.lesson, Array.isArray(debil.sources) ? debil.sources : []);
  }

  if (pendientes.size === 0) return [];

  const encontradas: LeccionSinFuente[] = [];

  original.sections.forEach((seccion, s) => {
    seccion.items.forEach((item, i) => {
      if (item.type !== 'lesson' || (item.action ?? 'create') !== 'create') return;

      const cola = pendientes.get(item.title);

      if (!cola || cola.length === 0) return;

      const fuentes = cola.shift() ?? null;

      encontradas.push({
        seccion: s,
        item: i,
        titulo: editado.sections[s]?.items[i]?.title ?? item.title,
        tituloOriginal: item.title,
        ...(fuentes ? { fuentesDebiles: fuentes } : {})
      });
    });
  });

  return encontradas;
}

export type ResultadoDeQuitar = { ok: true; plan: CoursePlan } | { ok: false };

/** Renumera `order` sin huecos, arrancando desde el menor que ya había. */
function renumerar<T extends { order: number }>(lista: T[]): T[] {
  if (lista.length === 0) return lista;

  const base = Math.min(...lista.map((elemento) => elemento.order));

  return lista.map((elemento, indice) => ({ ...elemento, order: base + indice }));
}

/**
 * El plan sin esas lecciones, validado con el mismo esquema que usa el servidor.
 *
 * Una sección que se queda sin ítems se va entera: el esquema no admite
 * secciones vacías. Sólo se sacan lecciones, así que el ejercicio del examen
 * final sigue en la última sección; el esquema lo vuelve a comprobar igual,
 * porque un plan de curso sin examen final no se puede construir.
 *
 * Si el resultado no pasa el esquema (por ejemplo, todas las lecciones de un
 * plan de cambios estaban sin fuente), no se aprueba nada: `ok: false`.
 */
export function quitarLeccionesSinFuente(plan: CoursePlan, quitar: LeccionSinFuente[]): ResultadoDeQuitar {
  if (quitar.length === 0) return { ok: true, plan };

  const marcadas = new Set(quitar.map((leccion) => `${leccion.seccion}.${leccion.item}`));

  const secciones = plan.sections
    .map((seccion, s) => ({
      ...seccion,
      items: renumerar(seccion.items.filter((_item, i) => !marcadas.has(`${s}.${i}`)))
    }))
    .filter((seccion) => seccion.items.length > 0);

  // La cobertura que viaja con la aprobación ya no nombra lo que se sacó.
  const siguen = [...(plan.coverage?.lessonsWithoutSource ?? [])];
  const siguenDebiles = [...(plan.coverage?.lessonsWithWeakSource ?? [])];

  for (const quitada of quitar) {
    if (quitada.fuentesDebiles) {
      const posicion = siguenDebiles.findIndex((debil) => debil.lesson === quitada.tituloOriginal);

      if (posicion >= 0) siguenDebiles.splice(posicion, 1);
      continue;
    }

    const posicion = siguen.indexOf(quitada.tituloOriginal);

    if (posicion >= 0) siguen.splice(posicion, 1);
  }

  const resultado: CoursePlan = {
    ...plan,
    sections: renumerar(secciones),
    ...(plan.coverage
      ? {
          coverage: {
            ...plan.coverage,
            lessonsWithoutSource: siguen,
            ...(plan.coverage.lessonsWithWeakSource ? { lessonsWithWeakSource: siguenDebiles } : {})
          }
        }
      : {})
  };

  return CoursePlanSchema.safeParse(resultado).success ? { ok: true, plan: resultado } : { ok: false };
}
