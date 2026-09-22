import { normalizarParaComparar } from '@api/services/agent/grounding';

/**
 * La evidencia de una pregunta: la frase de la lección que esa pregunta evalúa.
 *
 * ── Qué reemplaza ────────────────────────────────────────────────────────────
 *
 * Hasta acá el control era «leíste estas lecciones en esta ronda»
 * (`exercise-reading.ts`, borrado con este cambio). Verificaba el PROCESO, no el
 * resultado: haber leído no es haber usado. Medido el 2026-09-21 en una
 * autoevaluación de producción, con la lectura hecha y el control en verde, 4 de
 * 8 preguntas no salían de la lección que decían evaluar.
 *
 * El principio es el mismo que el del verificador de fundamento y el de las
 * citas: lo que se puede verificar, se verifica, y se verifica el RESULTADO. Una
 * pregunta inventada puede sonar impecable; su evidencia no puede — o la frase
 * está en la lección o no está, y eso lo decide una búsqueda, no un juicio.
 *
 * ── Por qué es tolerante ─────────────────────────────────────────────────────
 *
 * Se compara sin tildes, sin puntuación y sin mayúsculas, con el mismo
 * normalizador que usa `citaAparece` en `grounding.ts` — reusado y no copiado,
 * porque dos normalizadores que tienen que coincidir terminan no coincidiendo.
 * Lo que se comprueba no es que el modelo copie bien las comillas tipográficas:
 * es que la frase EXISTA. Una exigencia literal carácter por carácter
 * rechazaría preguntas buenas, y un control que rechaza lo correcto se termina
 * apagando.
 */

/**
 * Largo mínimo de una evidencia ya normalizada.
 *
 * Doce caracteres son media frase corta. Por debajo, una evidencia empieza a
 * coincidir con cualquier lección por casualidad («el cliente», «la caja»), y
 * un control que acepta cualquier cosa no es un control.
 */
export const MIN_CARACTERES_EVIDENCIA = 12;

/** Una lección que el ejercicio cubre, tal como se la nombra en los avisos. */
export interface LeccionObjetivo {
  id: string;
  title: string | null;
}

export interface PreguntaConEvidencia {
  question: string;
  evidence?: string | null;
}

export interface EvidenciaRechazada {
  /** Posición en la lista que llegó, 0-based: el aviso la muestra como N+1. */
  indice: number;
  question: string;
  evidence: string;
}

/**
 * El tramo más largo de la evidencia, ya normalizado.
 *
 * Una evidencia cortada con puntos suspensivos («el encargado … firma el
 * remito») no existe entera en ninguna lección. Se busca el tramo más largo,
 * que es el que lleva el contenido — igual que `citaAparece`.
 */
function tramoBuscable(evidence: string): string | undefined {
  const tramo = evidence
    .split(/…|\.\.\./)
    .map((parte) => normalizarParaComparar(parte))
    .sort((a, b) => b.length - a.length)[0];

  return tramo && tramo.length >= MIN_CARACTERES_EVIDENCIA ? tramo : undefined;
}

/** ¿La evidencia aparece en alguno de estos textos? */
export function evidenciaAparece(evidence: string, textosPlanos: readonly string[]): boolean {
  const tramo = tramoBuscable(evidence);

  if (!tramo) return false;

  return textosPlanos.some((texto) => normalizarParaComparar(texto).includes(tramo));
}

/**
 * Separa las preguntas cuya evidencia está en las lecciones de las que no.
 *
 * Los textos se normalizan UNA vez acá y no una vez por pregunta: un ejercicio
 * de diez preguntas sobre cuatro lecciones haría cuarenta pasadas sobre el
 * mismo texto.
 */
export function verificarEvidencias<T extends PreguntaConEvidencia>(
  preguntas: readonly T[],
  textosPlanos: readonly string[]
): { validas: T[]; rechazadas: EvidenciaRechazada[] } {
  const normalizados = textosPlanos.map((texto) => normalizarParaComparar(texto));
  const validas: T[] = [];
  const rechazadas: EvidenciaRechazada[] = [];

  preguntas.forEach((pregunta, indice) => {
    const evidence = pregunta.evidence?.trim() ?? '';
    const tramo = evidence ? tramoBuscable(evidence) : undefined;

    if (tramo && normalizados.some((texto) => texto.includes(tramo))) {
      validas.push(pregunta);
      return;
    }

    rechazadas.push({ indice, question: pregunta.question, evidence });
  });

  return { validas, rechazadas };
}

/** Un recorte de la evidencia para nombrarla en un aviso sin volcarla entera. */
function recortar(texto: string, largo = 80): string {
  const limpio = texto.trim();

  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio || '(empty)';
}

/**
 * El rechazo, escrito para que el paso siguiente sea obvio.
 *
 * Dice qué pregunta, qué evidencia, qué lecciones se miraron y cuál es la
 * salida — copiar la frase de `read_lessons` o dejar la pregunta afuera. Un
 * aviso sin salida es un aviso que se aprende a ignorar, y acá la salida
 * incorrecta sería inventar otra evidencia.
 */
export function avisoDeEvidencia(rechazadas: readonly EvidenciaRechazada[], lecciones: readonly LeccionObjetivo[]): string {
  const cuales = rechazadas
    .map((r) => `question ${r.indice + 1} ("${recortar(r.question, 60)}") gives evidence "${recortar(r.evidence)}"`)
    .join('; ');
  const cubre =
    lecciones.length > 0
      ? lecciones.map((l) => `"${l.title ?? '(untitled)'}"`).join(', ')
      : '(this exercise covers no lesson with content)';

  return (
    `Nothing was created. The evidence of ${rechazadas.length === 1 ? 'one question does' : `${rechazadas.length} questions do`} not appear in any lesson this exercise covers (${cubre}): ${cuales}. ` +
    `A question has to test what a lesson actually says. Read those lessons with read_lessons, copy the sentence VERBATIM from the text you get back as \`evidence\`, or drop the question. ` +
    `Do not reword the evidence to make it fit, and do not invent one.`
  );
}
