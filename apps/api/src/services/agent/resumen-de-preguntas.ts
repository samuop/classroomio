/**
 * Qué cambió en las preguntas, dicho para la docente.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El resumen de la ronda decía «Cambió las preguntas de «Examen final» (3
 * veces)». En producción (2026-11-07) eso fueron doce preguntas nuevas en un
 * examen que cincuenta alumnos ya habían rendido, y nadie lo pudo ver. En la
 * misma ronda, una pregunta reescrita pasó a afirmar lo contrario que antes con
 * la misma respuesta correcta, mientras el chat le contaba a la docente otra
 * cosa. Esto pone en el resumen lo que el servidor guardó: cuántas, cuántos
 * puntos, y el enunciado antes y después.
 */

/** Lo mínimo de una pregunta para describir un cambio. */
export interface PreguntaParaResumir {
  id?: number | string;
  /** El enunciado: `title` en la base, `question` en lo que se manda. */
  title?: string | null;
  question?: string | null;
  points?: number | null;
  settings?: Record<string, unknown> | null;
  options?: Array<{ label?: string | null; isCorrect?: boolean | null }> | null;
}

const LARGO_DE_UNA_CITA = 70;
/** Cuánto contexto se deja antes del punto donde dos enunciados se separan. */
const CONTEXTO_ANTES_DE_LA_DIFERENCIA = 20;

const limpiar = (texto: string) => texto.replace(/\s+/g, ' ').trim();

function cita(texto: string, desde = 0): string {
  const recortado = limpiar(texto).slice(desde);
  const inicio = desde > 0 ? '…' : '';

  return `«${inicio}${recortado.length > LARGO_DE_UNA_CITA ? `${recortado.slice(0, LARGO_DE_UNA_CITA - 1)}…` : recortado}»`;
}

/**
 * Antes → después, empezando cerca de donde difieren.
 *
 * Dos enunciados largos que comparten el comienzo, recortados desde el
 * principio, se ven iguales: medido con una pregunta real, los dos quedaban en
 * «…se le cobra sól…» y «…se le cobra el …», y lo único que había cambiado —qué
 * se cobra— quedaba afuera.
 */
function antesYDespues(antes: string, despues: string): string {
  const a = limpiar(antes);
  const b = limpiar(despues);
  let comun = 0;

  while (comun < a.length && comun < b.length && a[comun] === b[comun]) comun += 1;

  const desde = comun > CONTEXTO_ANTES_DE_LA_DIFERENCIA ? comun - CONTEXTO_ANTES_DE_LA_DIFERENCIA : 0;

  return `${cita(a, desde)} → ${cita(b, desde)}`;
}

const enunciado = (pregunta: PreguntaParaResumir) => (pregunta.question ?? pregunta.title ?? '').trim();

/** La respuesta correcta como se lee: las opciones marcadas, o el valor de una numérica. */
function correcta(pregunta: PreguntaParaResumir): string {
  const marcadas = (pregunta.options ?? []).filter((opcion) => opcion.isCorrect).map((opcion) => (opcion.label ?? '').trim());

  if (marcadas.length > 0) return marcadas.join(' + ');

  const valor = pregunta.settings?.correctValue;

  return valor === undefined || valor === null ? '' : String(valor);
}

/** Cuántas preguntas y cuántos puntos se agregan. */
export function resumenDeAgregadas(preguntas: ReadonlyArray<{ points?: number | null }>): { cantidad: number; puntos: number } {
  return {
    cantidad: preguntas.length,
    puntos: preguntas.reduce((suma, pregunta) => suma + Number(pregunta.points ?? 0), 0)
  };
}

/**
 * Una línea por pregunta que cambió de verdad: enunciado, correcta, puntos.
 *
 * La correcta va SIEMPRE que cambió el enunciado, aunque no haya cambiado ella:
 * una afirmación invertida con la misma respuesta es justamente lo que hay que
 * poder leer.
 */
export function cambiosDePreguntas(
  antes: ReadonlyArray<PreguntaParaResumir>,
  despues: ReadonlyArray<PreguntaParaResumir>
): string[] {
  const porId = new Map(antes.map((pregunta) => [String(pregunta.id), pregunta] as const));

  return despues.flatMap((nueva) => {
    const vieja = porId.get(String(nueva.id));

    if (!vieja) return [];

    const partes: string[] = [];
    const cambioElEnunciado = enunciado(vieja) !== enunciado(nueva);
    const correctaVieja = correcta(vieja);
    const correctaNueva = correcta(nueva);

    if (cambioElEnunciado) partes.push(antesYDespues(enunciado(vieja), enunciado(nueva)));
    if (correctaVieja !== correctaNueva) {
      partes.push(`correcta: ${correctaVieja || '—'} → ${correctaNueva || '—'}`);
    } else if (cambioElEnunciado && correctaNueva) {
      partes.push(`correcta: ${correctaNueva}`);
    }
    if (Number(vieja.points ?? 0) !== Number(nueva.points ?? 0)) {
      partes.push(`puntos: ${Number(vieja.points ?? 0)} → ${Number(nueva.points ?? 0)}`);
    }

    return partes.length > 0 ? [partes.join(', ')] : [];
  });
}
