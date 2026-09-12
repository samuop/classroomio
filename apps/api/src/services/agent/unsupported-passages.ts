import { listElementsWithAttribute } from '@api/services/agent/lesson-blocks';

/**
 * Los pasajes que el escritor marcó como propios: escritos por él, no sacados
 * de la fuente.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * El escritor de lecciones tenía exactamente dos salidas: escribir la lección
 * completa, o negarse entera con `<sin-material>`. Medido en producción, eso
 * deja sin representar el caso más común de todos — la lección que está bien en
 * su mayor parte y tiene un hueco adentro.
 *
 * El caso: una lección sobre las unidades de negocio de una empresa. Los cuatro
 * nombres estaban en la fuente, textuales. Lo que cada una HACE no estaba en
 * ninguna parte. Negarse habría sido incorrecto —habría tirado contenido bueno—
 * así que escribió, y describió las cuatro. Tres salieron bien por casualidad y
 * una salió materialmente mal: llamó «línea de impermeabilizantes» a una línea
 * de cuatro productos donde uno solo lo es.
 *
 * El prompt ya le pedía lo correcto («escribí lo que la fuente sostiene y poné
 * el hueco en la nota»), y no alcanzó. No por desobediencia: porque no existía
 * la jugada. La nota es prosa, a nivel lección, desprendida del párrafo — un
 * canal a nivel lección para un hecho a nivel párrafo no se usa.
 *
 * ── Cómo lo resuelve ─────────────────────────────────────────────────────────
 *
 * Una tercera jugada, del tamaño del problema: marcar EL PASAJE, ahí donde se
 * escribe, con lo que le falta. La lección se escribe igual —así que el ancla
 * de plan-vs-real queda satisfecha y marcar no le cuesta nada— y el docente
 * deja de tener que auditar la lección entera: ve dónde mirar.
 *
 * Es el mismo principio que la cobertura del plan y que los avisos de los
 * documentos mirados: una declaración que nadie contrasta es decoración, así
 * que el servidor la cuenta y la guarda al lado del contenido que describe.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * No juzga si el pasaje está bien marcado. Un pasaje marcado que la fuente sí
 * sostiene es timidez y es inofensivo. El que importa es el inverso —el pasaje
 * inventado SIN marcar— y ése no lo ve esto: lo persiguen los dos chequeos de
 * fundamento. Lo que esto agrega es que ahora tienen contra qué contrastar,
 * porque la pregunta pasa de «¿está fundada esta lección?», que es
 * incontestable, a «¿qué párrafo afirma algo específico y no está marcado?».
 */

/**
 * El atributo con el que el escritor marca un pasaje, y que lleva adentro lo
 * que falta.
 *
 * Tiene que estar en `ADD_ATTR` del saneador, que corre con
 * `ALLOW_DATA_ATTR: false`. Si no está, se borra sin un solo error y el pasaje
 * inventado queda indistinguible del fundado — o sea exactamente el fallo que
 * esto viene a arreglar, pero ahora con la apariencia de estar arreglado.
 */
export const ATRIBUTO_SIN_FUENTE = 'data-sin-fuente';

/** Hasta dónde se recorta el texto del pasaje en el informe. */
export const MAX_TEXTO_PASAJE = 240;

export interface PasajeSinFuente {
  /** El texto del pasaje, sin etiquetas, para ubicarlo en la lección. */
  texto: string;
  /** Lo que el escritor dijo que le falta. Puede venir vacío. */
  porque: string;
}

/** Las cinco que importan: el valor sale de un atributo HTML y lo lee una persona. */
function decodificar(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&amp;/g, '&');
}

function textoVisible(html: string): string {
  const plano = decodificar(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

  return plano.length > MAX_TEXTO_PASAJE ? `${plano.slice(0, MAX_TEXTO_PASAJE)}…` : plano;
}

/**
 * Los pasajes marcados de una lección, en orden.
 *
 * Sin tope a propósito. El tope existe en el chequeo de tokens porque ahí los
 * hallazgos los genera una heurística y pueden ser cien; acá los genera el
 * escritor a mano, y una lección con veinte marcas es una lección que debió
 * negarse — justo el caso donde esconder el número sería lo peor.
 */
export function extraerPasajesSinFuente(html: string): PasajeSinFuente[] {
  return listElementsWithAttribute(html, ATRIBUTO_SIN_FUENTE)
    .map((elemento) => ({
      texto: textoVisible(elemento.html),
      porque: decodificar(elemento.value).trim()
    }))
    // Un pasaje marcado que quedó sin texto no le dice nada al docente: no
    // puede ubicarlo en la lección ni decidir nada sobre él.
    .filter((pasaje) => pasaje.texto.length > 0);
}
