import { extraerEjemplos } from '@api/services/agent/unsupported-passages';
import { deduplicarDiagramas } from '@api/services/agent/lesson-blocks';

/**
 * Una escritura no puede llevarse puesto contenido que ya estaba.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. El riel contra la pérdida de ejemplos existía, pero
 * SÓLO en los dos caminos quirúrgicos (`replace_lesson_block`,
 * `edit_lesson_content`). Los caminos que guardan el cuerpo ENTERO —el rebote
 * del escritor, `write_lesson` con `lessonId`, `update_lesson_content`— pasaban
 * de largo: `writeLessonBody` guardaba lo que le dieran. En esa misma corrida
 * rebotaron 5 de 5 lecciones, o sea que la superficie no es teórica, y el
 * mecanismo de la pérdida es siempre el mismo: la consigna pide cambiar UN
 * dato, y la forma más corta de hacerlo desaparecer es devolver una lección sin
 * el elemento que lo contenía.
 *
 * ── Por qué una sola función ─────────────────────────────────────────────────
 *
 * Porque el criterio tiene que ser uno. Con dos —uno para los bloques y otro
 * para las lecciones— el primer arreglo llega a uno solo, y el que queda atrás
 * es el que nadie mira. `negarPerdidaDeEjemplos` quedó como un caso particular
 * de ésta: mismo conteo, mismo mensaje, mismo lugar donde agregar una clase
 * nueva de pieza el día que haga falta.
 *
 * ── Por qué es una NEGATIVA y no un aviso ────────────────────────────────────
 *
 * Un aviso después de guardar llega tarde: el contenido ya no está y nadie
 * tiene el texto viejo para reponerlo. Un borrado explícito (reemplazo vacío)
 * sí se permite: borrar es una decisión, no un accidente.
 */

/** Las clases de pieza que se cuentan, con el nombre que lee el modelo. */
const CLASES = [
  { clave: 'ejemplos', singular: 'marked example', plural: 'marked examples' },
  { clave: 'diagramas', singular: 'diagram', plural: 'diagrams' },
  { clave: 'imagenes', singular: 'image', plural: 'images' },
  { clave: 'figuras', singular: 'figure', plural: 'figures' },
  { clave: 'tablas', singular: 'table', plural: 'tables' },
  { clave: 'preformateados', singular: 'code block', plural: 'code blocks' }
] as const;

export type ClaseDePieza = (typeof CLASES)[number]['clave'];

export type ConteoDePiezas = Record<ClaseDePieza, number>;

function contarTag(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
}

/**
 * Cuántas piezas de cada clase tiene este HTML.
 *
 * Los diagramas se cuentan DESPUÉS de deduplicar: una lección que hoy tiene
 * ocho copias del mismo dibujo —las hay, ver `quitarDiagramasDuplicados`— no
 * puede quedar congelada porque la versión buena trae una sola. Lo que se
 * compara es contenido distinto, no cuántas veces está pegado.
 */
export function contarPiezas(html: string): ConteoDePiezas {
  // La versión muda: esto CUENTA, no guarda, y el log de «eliminados» tiene que
  // salir sólo cuando algo se eliminó de verdad. Ver `deduplicarDiagramas`.
  const sinCopias = deduplicarDiagramas(html ?? '').contenido;

  return {
    ejemplos: extraerEjemplos(html ?? '').length,
    diagramas: contarTag(sinCopias, 'svg'),
    imagenes: contarTag(sinCopias, 'img'),
    figuras: contarTag(sinCopias, 'figure'),
    tablas: contarTag(sinCopias, 'table'),
    preformateados: contarTag(sinCopias, 'pre')
  };
}

export interface PerdidaDePiezas {
  clase: ClaseDePieza;
  faltan: number;
  /** «3 marked examples», ya en singular o plural. */
  texto: string;
}

/** Qué clases bajaron, y en cuánto. Vacío = no se pierde nada. */
export function piezasPerdidas(antes: string, despues: string): PerdidaDePiezas[] {
  const previo = contarPiezas(antes);
  const nuevo = contarPiezas(despues);

  return CLASES.flatMap((clase) => {
    const faltan = previo[clase.clave] - nuevo[clase.clave];

    if (faltan <= 0) return [];

    return [
      {
        clase: clase.clave,
        faltan,
        texto: `${faltan} ${faltan === 1 ? clase.singular : clase.plural}`
      }
    ];
  });
}

/** El error que levanta la guardia: se distingue para poder tratarlo aparte. */
export class PerdidaEstructural extends Error {
  readonly perdidas: PerdidaDePiezas[];

  constructor(mensaje: string, perdidas: PerdidaDePiezas[]) {
    super(mensaje);
    this.name = 'PerdidaEstructural';
    this.perdidas = perdidas;
  }

  /** Lo que se pierde, para contarlo en un log o en el resultado de una herramienta. */
  get resumen(): string {
    return this.perdidas.map((perdida) => perdida.texto).join(' + ');
  }
}

function describirEjemplo(ejemplo: { texto: string; porque: string }): string {
  const descripcion = ejemplo.porque.trim() || ejemplo.texto.trim();

  return descripcion.length > 60 ? `${descripcion.slice(0, 60)}…` : descripcion;
}

function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  if (partes.length === 2) return `${partes[0]} and ${partes[1]}`;

  return `${partes.slice(0, -1).join(', ')} and ${partes[partes.length - 1]}`;
}

export type AlcanceDeLaEscritura = 'block' | 'lesson';

/**
 * El aviso que lee el modelo: qué se pierde, y cómo hacerlo bien.
 *
 * Nombrar lo que se pierde no es cortesía: medido el 2026-09-22, una negativa
 * sin motivo hace que el modelo pruebe otra cosa peor. Y la salida se dice
 * ANTES que la prohibición, porque lo que hace falta es que haga el cambio
 * chico, no que se quede quieto.
 */
export function avisoDePerdida(params: {
  alcance: AlcanceDeLaEscritura;
  perdidas: PerdidaDePiezas[];
  ejemplosDeAntes: ReturnType<typeof extraerEjemplos>;
}): string {
  const donde = params.alcance === 'block' ? 'this block' : 'the current lesson';
  const que = params.alcance === 'block' ? 'This replacement' : 'This rewrite';
  const pierdeEjemplos = params.perdidas.some((perdida) => perdida.clase === 'ejemplos');
  const detalle =
    pierdeEjemplos && params.ejemplosDeAntes.length > 0
      ? ` (the marked examples are: ${params.ejemplosDeAntes.map(describirEjemplo).join('; ')})`
      : '';

  const comoHacerlo =
    params.alcance === 'block'
      ? 'Send the SAME block back with only the value changed, keeping every element marked data-ejemplo and every <svg>, <img>, <table> and <pre> it had.'
      : 'Do NOT rewrite the whole lesson for this. Change the piece that is wrong: replace_lesson_block on its data-block-id — a diagram has one too — or edit_lesson_content with the exact old fragment, keeping every element marked data-ejemplo.';

  return (
    `${que} drops ${enumerar(params.perdidas.map((perdida) => perdida.texto))} of ${donde}${detalle}, ` +
    `so nothing was saved: that content is what the teacher keeps. ${comoHacerlo} ` +
    'To delete one of them on purpose, replace exactly that block with an empty html.'
  );
}

/**
 * La guardia: si la escritura pierde piezas, no se guarda nada.
 *
 * Se llama desde el único punto que guarda un cuerpo entero (`writeLessonBody`)
 * y desde los dos que empalman un pedazo, así que ningún camino nuevo puede
 * nacer sin ella por descuido.
 */
export function negarPerdidaEstructural(params: {
  alcance: AlcanceDeLaEscritura;
  antes: string;
  despues: string;
  /** Un reemplazo vacío: el modelo pidió BORRAR, y eso es una decisión. */
  esBorrado: boolean;
}): void {
  if (params.esBorrado) return;
  if (!params.antes?.trim()) return;

  const perdidas = piezasPerdidas(params.antes, params.despues);

  if (perdidas.length === 0) return;

  throw new PerdidaEstructural(
    avisoDePerdida({
      alcance: params.alcance,
      perdidas,
      ejemplosDeAntes: extraerEjemplos(params.antes)
    }),
    perdidas
  );
}
