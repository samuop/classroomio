/**
 * Buscar un tema DENTRO del texto de las fuentes del curso.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * Pedido: reconstruir una lección sobre un protocolo. El protocolo estaba en dos
 * de las siete fuentes del curso, siete presentaciones que se llaman «TALLER
 * [mes]» y arrancan todas igual. El índice da un resumen de 240 caracteres por
 * fuente, así que no había forma de saber cuál lo traía sin abrirlas.
 *
 * La ronda gastó 40 pasos: seis veces `search_document` —que sólo buscaba en un
 * documento adjunto al chat y contestaba «no hay documento»— y 31 `read_source`
 * releyendo cinco talleres desde la línea 1. Nunca abrió los dos que tenían el
 * tema. Después le escribió al escritor un encargo con el contenido de otras tres
 * lecciones y le pasó las siete fuentes.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * Por términos y no por significado: las fuentes del panel no tienen índice
 * semántico, y para «¿en qué fuente está esto?» encontrar las palabras alcanza.
 * Sin tildes ni mayúsculas, y tolerando plurales, porque quien busca escribe
 * «actualizacion estante» y la fuente dice «Actualización de los estantes».
 *
 * Parte cada fuente por diapositiva o párrafo, no en ventanas de largo fijo. Es
 * lo que hace que un bloque repetido en varias fuentes —estas presentaciones
 * repiten diapositivas enteras mes a mes— vuelva UNA vez con la lista de
 * fuentes que lo tienen. Esa lista es justo lo que hay que pasarle al escritor.
 *
 * Las líneas se cuentan como las cuenta `read_source` (`recortarLineas`): se parte
 * por salto de línea y se numera desde 1, así que `fromLine` sirve de `offset`.
 */

/** Largo máximo del pasaje que se devuelve: orienta, no reemplaza la lectura. */
export const MAX_PASAJE_CHARS = 500;

/** Un párrafo más largo que esto se parte en ventanas. */
export const MAX_BLOQUE_CHARS = 900;

/** Largo de cada ventana al partir un párrafo largo. Se pisan a la mitad. */
export const VENTANA_CHARS = 450;

/** Tramos por fuente, para que una fuente que repite un tema no tape a las otras. */
export const MAX_POR_FUENTE = 3;

export const MAX_PASAJES = 6;

/** Desde cuánto parecido dos tramos de fuentes distintas son el mismo bloque. */
const PARECIDO_MINIMO = 0.85;

const PALABRAS_VACIAS = new Set([
  'del', 'las', 'los', 'una', 'unos', 'unas', 'por', 'para', 'con', 'sin', 'que', 'sus', 'como', 'mas', 'muy',
  'este', 'esta', 'esto', 'the', 'and', 'for', 'with', 'from', 'that', 'this'
]);

export interface FuenteParaBuscar {
  id: string;
  fileName: string;
  text: string;
}

export interface UbicacionDelPasaje {
  sourceId: string;
  fileName: string;
  fromLine: number;
  toLine: number;
}

export interface PasajeEncontrado {
  passage: string;
  matchedTerms: string[];
  /** Todas las fuentes donde está este mismo bloque, con su línea en cada una. */
  locations: UbicacionDelPasaje[];
}

export interface FuenteConCoincidencias {
  sourceId: string;
  fileName: string;
  passages: number;
  /** Cuántos términos distintos tiene su mejor pasaje: la fuerza de la coincidencia. */
  bestMatchedTerms: number;
}

export interface ResultadoDeBusquedaEnFuentes {
  terms: string[];
  passages: PasajeEncontrado[];
  /** Qué fuentes tratan el tema, aunque el tope de pasajes haya dejado alguno afuera. */
  sourcesWithMatches: FuenteConCoincidencias[];
}

interface Tramo {
  /** Primera línea, contando desde 1. */
  desde: number;
  /** Última línea, inclusive. */
  hasta: number;
}

const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const palabrasDe = (texto: string) => plegar(texto).split(/[^a-z0-9]+/).filter(Boolean);

const esNumero = (palabra: string) => /^\d+$/.test(palabra);

/** Los términos que valen la pena: sin palabras vacías, sin repetidos. */
export function terminosDeBusqueda(consulta: string): string[] {
  const terminos = new Set<string>();

  for (const palabra of palabrasDe(consulta)) {
    if (!esNumero(palabra) && (palabra.length < 3 || PALABRAS_VACIAS.has(palabra))) continue;
    terminos.add(palabra);
  }

  return [...terminos];
}

/**
 * ¿La palabra de la fuente es este término?
 *
 * Un número tiene que ser exactamente ese número. Una palabra alcanza con que
 * empiece como el término: se recorta un poco el final para que el singular
 * encuentre el plural y al revés, sin llegar a que «pre» encuentre cualquier cosa.
 */
function coincide(termino: string, palabra: string): boolean {
  if (esNumero(termino)) return palabra === termino;

  const raiz = termino.length <= 4 ? termino : termino.slice(0, Math.max(4, Math.ceil(termino.length * 0.7)));

  return palabra.startsWith(raiz);
}

/**
 * Los tramos donde buscar: cada diapositiva o párrafo, y los largos partidos.
 *
 * Una línea vacía o una línea «---» separa. Un párrafo largo se parte en
 * ventanas que arrancan en su primera línea, así el mismo párrafo produce las
 * mismas ventanas en cualquier fuente donde aparezca.
 */
export function tramosDeBusqueda(lineas: string[]): Tramo[] {
  const parrafos: Tramo[] = [];
  let inicio: number | null = null;

  lineas.forEach((linea, i) => {
    const separa = linea.trim() === '' || linea.trim() === '---';

    if (separa) {
      if (inicio !== null) parrafos.push({ desde: inicio + 1, hasta: i });
      inicio = null;
    } else if (inicio === null) {
      inicio = i;
    }
  });

  if (inicio !== null) parrafos.push({ desde: inicio + 1, hasta: lineas.length });

  const largoDe = (desde: number, hasta: number) => {
    let largo = 0;
    for (let n = desde; n <= hasta; n++) largo += lineas[n - 1].length + 1;
    return largo;
  };

  const tramos: Tramo[] = [];

  for (const parrafo of parrafos) {
    if (largoDe(parrafo.desde, parrafo.hasta) <= MAX_BLOQUE_CHARS) {
      tramos.push(parrafo);
      continue;
    }

    let desde = parrafo.desde;

    while (desde <= parrafo.hasta) {
      let siguiente = desde;
      let acumulado = 0;

      while (siguiente <= parrafo.hasta && (acumulado < VENTANA_CHARS || siguiente === desde)) {
        acumulado += lineas[siguiente - 1].length + 1;
        siguiente++;
      }

      tramos.push({ desde, hasta: siguiente - 1 });

      if (siguiente > parrafo.hasta) break;

      let medio = desde;
      let recorrido = 0;
      while (medio < siguiente - 1 && recorrido < acumulado / 2) {
        recorrido += lineas[medio - 1].length + 1;
        medio++;
      }

      desde = Math.max(desde + 1, medio);
    }
  }

  return tramos;
}

function recortar(texto: string): string {
  return texto.length <= MAX_PASAJE_CHARS ? texto : `${texto.slice(0, MAX_PASAJE_CHARS).trimEnd()}…`;
}

function parecido(a: Set<string>, b: Set<string>): number {
  let comunes = 0;
  for (const palabra of a) if (b.has(palabra)) comunes++;
  const union = a.size + b.size - comunes;
  return union === 0 ? 1 : comunes / union;
}

interface Candidato {
  orden: number;
  fuente: FuenteParaBuscar;
  tramo: Tramo;
  texto: string;
  clave: string;
  palabras: Set<string>;
  encontrados: string[];
  aciertos: number;
}

const mejorPrimero = (a: Candidato, b: Candidato) =>
  b.encontrados.length - a.encontrados.length || b.aciertos - a.aciertos || a.orden - b.orden;

/**
 * Los pasajes de las fuentes que tratan la consulta, mejores primero.
 *
 * Cuenta pura: sin base y sin red, así que los bordes —la tilde, el plural, el
 * bloque repetido en varias fuentes— se fijan en tests.
 */
export function buscarEnFuentes(params: {
  fuentes: FuenteParaBuscar[];
  consulta: string;
  maxPasajes?: number;
}): ResultadoDeBusquedaEnFuentes {
  const terms = terminosDeBusqueda(params.consulta);

  if (terms.length === 0) return { terms, passages: [], sourcesWithMatches: [] };

  // Con varios términos, un tramo que nombra uno solo es ruido.
  const minimo = Math.min(2, terms.length);
  const candidatos: Candidato[] = [];
  const porFuente: FuenteConCoincidencias[] = [];
  let orden = 0;

  for (const fuente of params.fuentes) {
    const lineas = fuente.text.split('\n');
    const deEstaFuente: Candidato[] = [];

    for (const tramo of tramosDeBusqueda(lineas)) {
      const texto = lineas
        .slice(tramo.desde - 1, tramo.hasta)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const lista = palabrasDe(texto);
      const encontrados = terms.filter((termino) => lista.some((palabra) => coincide(termino, palabra)));

      if (encontrados.length < minimo) continue;

      deEstaFuente.push({
        orden: orden++,
        fuente,
        tramo,
        texto,
        clave: lista.join(' '),
        palabras: new Set(lista),
        encontrados,
        aciertos: lista.filter((palabra) => terms.some((termino) => coincide(termino, palabra))).length
      });
    }

    const elegidos: Candidato[] = [];

    for (const candidato of deEstaFuente.sort(mejorPrimero)) {
      if (elegidos.length >= MAX_POR_FUENTE) break;

      const pisaOtro = elegidos.some(
        (e) => candidato.tramo.desde <= e.tramo.hasta && e.tramo.desde <= candidato.tramo.hasta
      );
      if (!pisaOtro) elegidos.push(candidato);
    }

    if (elegidos.length > 0) {
      porFuente.push({
        sourceId: fuente.id,
        fileName: fuente.fileName,
        passages: elegidos.length,
        bestMatchedTerms: elegidos[0].encontrados.length
      });
    }

    candidatos.push(...elegidos);
  }

  const grupos: Array<{ mejor: Candidato; ubicaciones: UbicacionDelPasaje[] }> = [];

  for (const candidato of candidatos.sort(mejorPrimero)) {
    const ubicacion: UbicacionDelPasaje = {
      sourceId: candidato.fuente.id,
      fileName: candidato.fuente.fileName,
      fromLine: candidato.tramo.desde,
      toLine: candidato.tramo.hasta
    };

    const mismoBloque = grupos.find(
      (g) => g.mejor.clave === candidato.clave || parecido(g.mejor.palabras, candidato.palabras) >= PARECIDO_MINIMO
    );

    if (!mismoBloque) {
      grupos.push({ mejor: candidato, ubicaciones: [ubicacion] });
    } else if (!mismoBloque.ubicaciones.some((u) => u.sourceId === ubicacion.sourceId)) {
      mismoBloque.ubicaciones.push(ubicacion);
    }
  }

  grupos.sort(
    (a, b) =>
      b.mejor.encontrados.length - a.mejor.encontrados.length ||
      b.ubicaciones.length - a.ubicaciones.length ||
      mejorPrimero(a.mejor, b.mejor)
  );

  return {
    terms,
    passages: grupos.slice(0, params.maxPasajes ?? MAX_PASAJES).map((g) => ({
      passage: recortar(g.mejor.texto),
      matchedTerms: g.mejor.encontrados,
      locations: g.ubicaciones
    })),
    // Las más fuertes primero. En el orden de subida, una fuente que roza la
    // consulta con dos palabras sueltas quedaba antes que la que la trata entera,
    // y esta lista es la que el agente le pasa al escritor.
    sourcesWithMatches: porFuente.sort((a, b) => b.bestMatchedTerms - a.bestMatchedTerms)
  };
}
