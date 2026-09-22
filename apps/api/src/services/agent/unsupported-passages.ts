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

/**
 * El atributo con el que el escritor marca un ejemplo que se inventó a propósito.
 *
 * ── Por qué hacen falta dos marcas y no una ──────────────────────────────────
 *
 * Medido el 2026-09-21/22 sobre cinco lecciones: cero marcas `data-sin-fuente`,
 * y sin embargo el chequeo determinista encontraba inventos en todas. Casi
 * todos vivían en los EJEMPLOS — el nombre y el legajo de un empleado, un
 * «Error 404», un «24/7»—, que es justo donde el escritor NO tiene que marcar
 * `data-sin-fuente`: un ejemplo inventado no es una afirmación falsa sobre la
 * empresa, es la manera normal de enseñar algo.
 *
 * Con una sola marca el escritor quedaba entre dos cosas mal: marcar el ejemplo
 * y decir que le falta material que no le falta, o no marcar nada y que el dato
 * inventado quedara indistinguible de uno copiado del manual. Por eso son dos:
 *
 * - `data-sin-fuente` = una afirmación sobre ESTA organización que el material
 *   no dice. Es un pendiente del docente: confirmarla o subir el documento.
 * - `data-ejemplo` = una ilustración inventada a propósito. No es un pendiente;
 *   es una declaración de que ese nombre y ese número no salieron de ningún lado
 *   y nadie debería buscarlos.
 *
 * Las dos juntas son lo que convierte el chequeo de tokens en una compuerta
 * utilizable: sin ellas, el único resultado posible de «este número no está en
 * la fuente» era pedirle al escritor que borrara el ejemplo.
 */
export const ATRIBUTO_EJEMPLO = 'data-ejemplo';

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
  return extraerMarcados(html, ATRIBUTO_SIN_FUENTE);
}

/**
 * Los ejemplos que el escritor declaró como propios, en orden.
 *
 * Misma forma que los pasajes sin fuente porque se leen igual —el docente ve
 * qué párrafo y por qué— pero significan cosas distintas: acá `porque` es para
 * qué sirve el ejemplo, no qué falta. Van al informe en su propia lista, sin
 * mezclarse: un informe que sumara las dos volvería a perder la distinción que
 * las dos marcas existen para hacer.
 */
export function extraerEjemplos(html: string): PasajeSinFuente[] {
  return extraerMarcados(html, ATRIBUTO_EJEMPLO);
}

function extraerMarcados(html: string, atributo: string): PasajeSinFuente[] {
  return listElementsWithAttribute(html, atributo)
    .map((elemento) => ({
      texto: textoVisible(elemento.html),
      porque: decodificar(elemento.value).trim()
    }))
    // Un pasaje marcado que quedó sin texto no le dice nada al docente: no
    // puede ubicarlo en la lección ni decidir nada sobre él.
    .filter((pasaje) => pasaje.texto.length > 0);
}

/**
 * La lección sin lo que el escritor marcó, para contrastar sólo el resto.
 *
 * Es la contracara de que las marcas existan. Un ejemplo inventado a propósito
 * y declarado como tal no puede seguir contando como un dato sin respaldo: si
 * contara, marcarlo no serviría de nada y el escritor aprendería que da igual
 * —y entonces las dos mitades del chequeo de fundamento estarían gritando por
 * lo mismo que el sistema le pidió que hiciera—.
 *
 * Lo que devuelve NO se guarda nunca: es la entrada de los dos chequeos y nada
 * más. Por eso puede permitirse cortar rangos sin cuidar el markup.
 */
export function quitarPasajesMarcados(html: string): string {
  if (!html) return html;

  const marcados = [
    ...listElementsWithAttribute(html, ATRIBUTO_SIN_FUENTE),
    ...listElementsWithAttribute(html, ATRIBUTO_EJEMPLO)
  ].sort((a, b) => a.start - b.start);

  if (marcados.length === 0) return html;

  // Las dos listas son de primer nivel cada una POR SEPARADO, así que un ejemplo
  // adentro de un pasaje sin fuente aparece en las dos y sus tramos se solapan.
  // Se fusionan antes de cortar: cortar dos veces el mismo tramo se comería
  // texto que no estaba marcado.
  const rangos: Array<{ start: number; end: number }> = [];

  for (const marcado of marcados) {
    const ultimo = rangos[rangos.length - 1];

    if (ultimo && marcado.start < ultimo.end) {
      ultimo.end = Math.max(ultimo.end, marcado.end);
      continue;
    }

    rangos.push({ start: marcado.start, end: marcado.end });
  }

  let resultado = html;

  // De atrás para adelante: cortar de adelante correría los tramos que faltan.
  for (let i = rangos.length - 1; i >= 0; i -= 1) {
    // Un espacio y no nada: los dos chequeos aplanan el HTML a texto, y pegar
    // lo de antes con lo de después inventaría una palabra que nadie escribió.
    resultado = `${resultado.slice(0, rangos[i].start)} ${resultado.slice(rangos[i].end)}`;
  }

  return resultado;
}
