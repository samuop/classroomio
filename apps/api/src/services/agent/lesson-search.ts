import { listLessonBlocks, type LessonBlock } from '@api/services/agent/lesson-blocks';

/**
 * Buscar DENTRO de las lecciones del curso, en vez de traerlas enteras.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Medido en producción el 2026-09-12. Una ronda para sacar unas afirmaciones
 * inventadas de tres lecciones gastó 17 llamadas a `get_lesson_content` —más de
 * cinco por lección— y llegó a hacer 2 de las 8 ediciones que le faltaban antes
 * de que el techo de pasos la cortara.
 *
 * El modelo no estaba dando vueltas por tonto: estaba BUSCANDO. Le pedimos
 * «saquen la palabra tal de donde aparezca» y la única herramienta para el
 * contenido del curso es «dame la lección entera». `search_document` no sirve
 * para esto: busca en las FUENTES adjuntas, no en lo que el curso ya dice.
 *
 * Antes de esto intentamos convencerlo: avisarle en cada resultado en qué paso
 * iba y que dejara de leer. Llegó, lo leyó quince veces, y siguió leyendo. Un
 * bucle no se arregla pidiéndole al modelo que se contenga; se arregla dándole
 * la herramienta que le faltaba.
 *
 * ── El principio del diseño ──────────────────────────────────────────────────
 *
 * Lo caro NO es que el servidor lea, es que el MODELO lea. Acá el servidor
 * recorre el contenido completo de todas las lecciones y devuelve fragmentos:
 * una búsqueda cuesta un paso y unas pocas líneas de contexto, contra trece
 * llamadas de veinte mil caracteres cada una.
 */

/** Caracteres de contexto a cada lado del fragmento encontrado. */
export const CONTEXTO = 90;

/** Tope de coincidencias por lección, para que una palabra común no tape el resto. */
export const MAX_POR_LECCION = 3;

/** Tope total: esto va al contexto del modelo y tiene que seguir siendo chico. */
export const MAX_COINCIDENCIAS = 24;

/** Con menos que esto, cualquier cosa coincide con todo. */
export const MIN_LARGO_BUSQUEDA = 3;

export interface LeccionParaBuscar {
  id: string;
  title: string;
  content: string;
}

export interface CoincidenciaEnLeccion {
  lessonId: string;
  title: string;
  /** El bloque que la contiene, si lo tiene: sirve para `replace_lesson_block`. */
  blockId?: string;
  /** El texto alrededor de la coincidencia, para decidir sin abrir la lección. */
  fragmento: string;
  /**
   * El mismo tramo pero TEXTUAL, listo para pasar como `oldString`.
   *
   * Medido: con sólo `fragmento`, el modelo encontraba las cinco lecciones y
   * después abría diecinueve veces `get_lesson_content` igual. Y tenía razón —
   * `fragmento` colapsa los espacios y corta con puntos suspensivos, así que no
   * coincide con nada: le decía DÓNDE estaba y no le alcanzaba para ACTUAR.
   *
   * Nunca cruza una etiqueta, así que es texto puro y se puede buscar y
   * reemplazar tal cual viene.
   */
  textoExacto: string;
}

/**
 * Texto visible y el mapa de vuelta al HTML.
 *
 * Se busca sobre el texto que el alumno LEE, no sobre el HTML: si no, una
 * búsqueda de "img" coincide con cada etiqueta de imagen y "class" con media
 * lección. Y hace falta el camino de vuelta porque el `blockId` que le sirve al
 * modelo está en el HTML, no en el texto.
 *
 * `indices[i]` es la posición en el HTML original del carácter visible `i`.
 */
function textoVisibleConMapa(html: string): { texto: string; indices: number[] } {
  let texto = '';
  const indices: number[] = [];
  let dentroDeEtiqueta = false;

  for (let i = 0; i < html.length; i += 1) {
    const c = html[i];

    if (c === '<') {
      dentroDeEtiqueta = true;
      continue;
    }

    if (c === '>') {
      dentroDeEtiqueta = false;
      // Un límite de etiqueta separa palabras: sin esto un encabezado se pega
      // al párrafo siguiente y aparecen coincidencias que nadie escribió.
      if (texto.length > 0 && texto[texto.length - 1] !== ' ') {
        texto += ' ';
        indices.push(i);
      }
      continue;
    }

    if (dentroDeEtiqueta) continue;

    texto += c;
    indices.push(i);
  }

  return { texto, indices };
}

/**
 * Forma comparable, carácter por carácter.
 *
 * Sin tildes y en minúscula, porque buscar "taman" tiene que encontrar "Tamán"
 * — quien busca no va a escribir la tilde, y una tanda de patrones que no
 * coincidían por un acento ya costó una vuelta entera de trabajo.
 *
 * Se plega de a un carácter y NO de un saque sobre todo el texto, para que las
 * posiciones sigan valiendo: `normalize('NFD')` cambia los largos, y un índice
 * calculado sobre el texto plegado apuntaría al lugar equivocado del original.
 */
function plegar(texto: string): { plegado: string; indices: number[] } {
  let plegado = '';
  const indices: number[] = [];

  for (let i = 0; i < texto.length; i += 1) {
    const limpio = texto[i]
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

    // Un carácter puede plegarse a varios (o a ninguno, si era una tilde
    // suelta): cada uno apunta al mismo origen.
    for (const _ of limpio) indices.push(i);
    plegado += limpio;
  }

  return { plegado, indices };
}

/**
 * El bloque que CONTIENE esa posición del HTML, si hay alguno.
 *
 * ── Por qué mira dónde termina el bloque y no sólo dónde empieza ─────────────
 *
 * Antes devolvía el último `data-block-id` cuyo índice fuera menor o igual a la
 * posición, sin mirar si ese bloque seguía abierto ahí. Para un valor que vive
 * DENTRO de un elemento sin id —el caso real: una lección escrita antes de que
 * el servidor le pusiera id al `<svg>`, con el plazo viejo adentro del
 * diagrama— eso devolvía el id del PÁRRAFO de arriba. Y ese id viaja: la orden
 * de trabajo decía «still present: block <el párrafo>», el modelo reemplazaba
 * ese párrafo por «párrafo + svg corregido» y el servidor terminaba con dos
 * diagramas al lado. Es la jugada medida el 2026-09-22 (8 y 9 copias seguidas).
 *
 * Un id equivocado es peor que ninguno: sin id, quien lee sabe que no lo sabe.
 * Así que si la posición cae fuera de todo bloque, esto devuelve `undefined`.
 */
function bloqueQueContiene(bloques: readonly LessonBlock[], posicion: number): string | undefined {
  return bloques.find((bloque) => bloque.start <= posicion && posicion < bloque.end)?.blockId;
}

/** Hasta dónde se estira el tramo textual a cada lado, si no aparece un corte antes. */
export const MAX_TRAMO = 140;

/**
 * El tramo TEXTUAL del HTML alrededor de la coincidencia, para usar de
 * `oldString`.
 *
 * Se estira sobre el HTML y no sobre el texto visible a propósito: así lo que
 * se devuelve son bytes que están de verdad en el contenido guardado, y un
 * reemplazo exacto no puede fallar por un espacio.
 *
 * Se detiene en `<` y en `>` —o sea que nunca cruza una etiqueta— y en un final
 * de oración, que es la unidad que suele ser única dentro de una lección. Un
 * tramo demasiado corto coincidiría en varios lugares y el reemplazo sería
 * ambiguo; uno demasiado largo se lleva media lección al contexto.
 */
function tramoExacto(html: string, inicio: number, fin: number): string {
  const corta = (c: string) => c === '<' || c === '>';
  let izq = inicio;
  let der = fin;

  while (izq > 0 && inicio - izq < MAX_TRAMO) {
    const previo = html[izq - 1];
    if (corta(previo)) break;
    if (previo === '.' || previo === '!' || previo === '?') break;
    izq -= 1;
  }

  while (der < html.length && der - fin < MAX_TRAMO) {
    const actual = html[der];
    if (corta(actual)) break;
    der += 1;
    // El punto entra en el tramo: cortar justo antes dejaría un `oldString`
    // que el reemplazo tiene que volver a pegar.
    if (actual === '.' || actual === '!' || actual === '?') break;
  }

  return html.slice(izq, der).trim();
}

function recortar(texto: string, desde: number, hasta: number): string {
  const inicio = Math.max(0, desde - CONTEXTO);
  const fin = Math.min(texto.length, hasta + CONTEXTO);

  return (
    (inicio > 0 ? '…' : '') +
    texto
      .slice(inicio, fin)
      .replace(/\s+/g, ' ')
      .trim() +
    (fin < texto.length ? '…' : '')
  );
}

/**
 * Las coincidencias de `texto` en las lecciones dadas, en orden.
 *
 * Cuenta pura: sin base y sin modelo, así que los bordes —el acento, el límite
 * de etiqueta, la palabra demasiado corta— se pueden fijar en tests.
 */
export function buscarEnLecciones(params: {
  lecciones: LeccionParaBuscar[];
  texto: string;
  maxPorLeccion?: number;
  maxTotal?: number;
}): CoincidenciaEnLeccion[] {
  const buscado = params.texto.trim();

  if (buscado.length < MIN_LARGO_BUSQUEDA) return [];

  const { plegado: aguja } = plegar(buscado);
  const maxPorLeccion = params.maxPorLeccion ?? MAX_POR_LECCION;
  const maxTotal = params.maxTotal ?? MAX_COINCIDENCIAS;
  const coincidencias: CoincidenciaEnLeccion[] = [];

  for (const leccion of params.lecciones) {
    if (coincidencias.length >= maxTotal) break;
    if (!leccion.content) continue;

    const { texto: visible, indices: aHtml } = textoVisibleConMapa(leccion.content);
    const { plegado, indices: aVisible } = plegar(visible);
    // Una sola vez por lección: el barrido de un plan de cambios puede pedir
    // veinte coincidencias de la misma lección, y volver a parsear el HTML en
    // cada una sería parsearlo veinte veces para la misma respuesta.
    const bloques = listLessonBlocks(leccion.content);

    let desde = 0;
    let enEstaLeccion = 0;

    while (enEstaLeccion < maxPorLeccion && coincidencias.length < maxTotal) {
      const pos = plegado.indexOf(aguja, desde);

      if (pos === -1) break;

      const inicioVisible = aVisible[pos] ?? 0;
      const finVisible = (aVisible[pos + aguja.length - 1] ?? inicioVisible) + 1;
      const inicioHtml = aHtml[inicioVisible] ?? 0;
      const finHtml = (aHtml[finVisible - 1] ?? inicioHtml) + 1;
      const blockId = bloqueQueContiene(bloques, inicioHtml);

      coincidencias.push({
        lessonId: leccion.id,
        title: leccion.title,
        ...(blockId ? { blockId } : {}),
        fragmento: recortar(visible, inicioVisible, finVisible),
        textoExacto: tramoExacto(leccion.content, inicioHtml, finHtml)
      });

      enEstaLeccion += 1;
      desde = pos + aguja.length;
    }
  }

  return coincidencias;
}
