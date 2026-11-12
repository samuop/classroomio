/**
 * Las «reglas de la docente» de un plan: sólo las que ella escribió.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-11-11, un curso armado desde un documento. La docente no
 * dictó ninguna regla: contestó el formulario (una palabra en el campo libre,
 * el nombre de una aplicación de mensajería) y pidió el curso. El plan salió
 * con cinco reglas «de la docente»:
 *
 *   - «usar <esa aplicación> como canal oficial para coordinar…» — de esa
 *     única palabra;
 *   - «escribir siempre los roles en lugar de nombres propios» — de nadie;
 *   - tres datos copiados del documento.
 *
 * Una regla de la docente viaja a todos los que escriben con la frase «ganan
 * sobre todo lo demás, incluida la fuente». El curso salió con esa aplicación
 * como canal oficial en casi todas las lecciones, con una regla que el
 * documento da para UNA tarea aplicada también a otra, y con «mencionar roles
 * en lugar de nombres» enseñado como procedimiento de la empresa y evaluado en
 * el examen. Reconstruido dos veces en local con el mismo plan y revisado
 * contra el documento, entre el 40 y el 50 % de los defectos apuntaban a esas
 * reglas.
 *
 * El campo se había hecho OBLIGATORIO para que el modelo no lo dejara vacío, y
 * lo llenó. `remember_teacher_rule` y `update_plan` ya exigían las palabras de
 * la docente por lo mismo; el plan era el único camino sin comprobar.
 *
 * ── Cómo ─────────────────────────────────────────────────────────────────────
 *
 * Cada regla llega con las palabras de ella que la sostienen, y acá se buscan
 * en lo que ELLA escribió. La que no está se descarta: no entra al plan, no se
 * le muestra como suya y no le llega a ningún escritor. No es una negativa —el
 * plan sale igual—: un plan es demasiado caro de rehacer por una regla de más.
 */
import { lasEscribioLaDocente } from '@api/services/agent/plan-vivo';

export interface ReglaDeclarada {
  rule: string;
  teacherWords: string;
}

export interface ReglasDelPlan {
  /** Las que la docente escribió: son las que quedan en el plan. */
  aceptadas: string[];
  /** Las que el modelo declaró sin que ella las dijera. */
  descartadas: ReglaDeclarada[];
}

/**
 * Lo que la docente ESCRIBIÓ en la conversación: sus mensajes, sin los que arma
 * un botón.
 *
 * `textosDeLaDocente` (`plan-vivo.ts`) toma el texto de todos sus mensajes, y
 * para una enmienda del plan alcanza. Para una regla no: el mensaje con que el
 * panel manda el formulario trae las PREGUNTAS, que redactó el asistente
 * («¿Qué herramientas o canales usan habitualmente?: <una palabra>»), y
 * citarlo entero convertía una pregunta suya en palabras de ella.
 *
 * - Del formulario cuentan sólo las respuestas, una por una. Un valor de opción
 *   («operativa_documentacion») o una palabra suelta no alcanzan para citar una
 *   regla (`lasEscribioLaDocente` pide una frase); una oración que ella tecleó
 *   en un campo libre, sí.
 * - La aprobación del plan no cuenta: su texto es el del botón.
 */
export function textosEscritosPorLaDocente(mensajes: readonly unknown[]): string[] {
  return mensajes.flatMap((mensaje) => {
    const m = mensaje as { role?: unknown; parts?: unknown; metadata?: unknown } | null;

    if (m?.role !== 'user') return [];

    const metadata = (m.metadata ?? {}) as { plan?: { action?: unknown }; discovery?: { answers?: unknown } };

    if (metadata.plan?.action) return [];

    if (metadata.discovery) {
      const respuestas = metadata.discovery.answers;

      return respuestas && typeof respuestas === 'object'
        ? Object.values(respuestas).filter((valor): valor is string => typeof valor === 'string' && valor.trim().length > 0)
        : [];
    }

    if (!Array.isArray(m.parts)) return [];

    const texto = m.parts
      .filter((parte): parte is { type: 'text'; text: string } => {
        const p = parte as { type?: unknown; text?: unknown } | null;

        return p?.type === 'text' && typeof p.text === 'string';
      })
      .map((parte) => parte.text)
      .join('\n')
      .trim();

    return texto ? [texto] : [];
  });
}

/** De las reglas que declara un plan, cuáles escribió la docente. */
export function reglasQueDijoLaDocente(declaradas: readonly ReglaDeclarada[], escritos: readonly string[]): ReglasDelPlan {
  const aceptadas: string[] = [];
  const descartadas: ReglaDeclarada[] = [];

  for (const declarada of declaradas) {
    const rule = declarada.rule.trim();

    if (!rule) continue;

    if (lasEscribioLaDocente(declarada.teacherWords, escritos)) {
      if (!aceptadas.includes(rule)) aceptadas.push(rule);
    } else {
      descartadas.push({ rule, teacherWords: declarada.teacherWords.trim() });
    }
  }

  return { aceptadas, descartadas };
}

/**
 * Lo que se le dice al modelo cuando se le cayó alguna regla.
 *
 * Dice dónde SÍ va lo que quiso poner: si no, lo vuelve a intentar por la
 * consigna de cada lección con el mismo «la docente pidió».
 */
export function avisoDeReglasDescartadas(descartadas: readonly ReglaDeclarada[]): string | undefined {
  if (descartadas.length === 0) return undefined;

  const lista = descartadas.map((regla) => `- "${regla.rule}"`).join('\n');

  return (
    `${descartadas.length} of the teacher rules you listed are NOT in this plan, because the words you quoted for them are not in anything the teacher typed in this conversation:\n${lista}\n\n` +
    'They were not shown to the teacher as theirs and no writer will receive them as rules. Do not tell the teacher they stated them, and do not list them again. ' +
    'If one of them is a fact, deadline or procedure the SOURCE states, it is not a rule: it is content, and it belongs only in the lessons that teach it — with the scope the source gives it, not wider. ' +
    'If one is a writing choice of yours, it is not the teacher\'s either: do not present it in a lesson as something the company requires.'
  );
}
