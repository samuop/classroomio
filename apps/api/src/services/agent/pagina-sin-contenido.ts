import { AppError } from '@api/utils/errors';

/**
 * ¿Lo que devolvió el lector es la página, o lo que la página pone delante?
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * El lector (Jina) contesta 200 aunque no haya podido leer nada, y lo que
 * devuelve se parece a un éxito. Medido en producción: una docente pegó el
 * enlace de su planilla de Google en Fuentes → Página web, el diálogo se cerró
 * sin aviso y quedó una fuente «Google Sheets: Sign-in» de 256 palabras —
 * «Sign in / to continue to Google Sheets / Email or phone / Forgot email?» más
 * la lista de unos 90 idiomas del selector. La planilla era privada, y lo que
 * entró al curso fue la pantalla de inicio de sesión.
 *
 * El único filtro que había (`isUnreadablePage`) corría sólo en la
 * investigación, y tampoco la paraba: está calibrado para muros hechos de
 * ENLACES (Facebook, Instagram), y el de Google trae los idiomas como texto
 * plano — medía 1148 caracteres de «prosa» contra un umbral de 400.
 *
 * ── Qué mira ─────────────────────────────────────────────────────────────────
 *
 *   1. El aviso del lector («Warning: Target URL returned error 401»): el sitio
 *      contestó con un error y lo que sigue es su cáscara.
 *   2. Las señales de un muro de inicio de sesión — el título o las frases del
 *      formulario — PERO sólo junto con poca prosa, medida en renglones de 8
 *      palabras o más. El muro medido tiene 55 caracteres de eso; las diez
 *      páginas reales del mismo curso, entre 978 y 10 426. La medida de prosa
 *      nunca va sola: sola descartaría las tablas de referencia, que la
 *      investigación busca a propósito y que son todas renglones cortos. Y las
 *      señales tampoco van solas: una página de AYUDA sobre cómo iniciar sesión
 *      tiene «Sign in» en el título y es un buen material.
 *   3. Una página que volvió vacía.
 *
 * Es de todos los caminos que leen una página —la ruta de Fuentes, la
 * herramienta del agente, la investigación y la relectura— porque cada uno por
 * su lado era el agujero de los otros.
 */

export type CodigoDePaginaSinContenido = 'SOURCE_NEEDS_LOGIN' | 'SOURCE_UNREADABLE';

export interface PaginaSinContenido {
  code: CodigoDePaginaSinContenido;
  /** Qué se vio, en una frase: va al log y al mensaje que lee el modelo. */
  motivo: string;
}

/** Palabras que hacen falta para que un renglón cuente como prosa. */
const PALABRAS_DE_UN_RENGLON_DE_PROSA = 8;

/**
 * Con señales de inicio de sesión, cuánta prosa hace falta para que igual sea
 * una página de verdad. Con los datos medidos separa 55 (el muro) de 978 (la
 * página real más corta del curso).
 */
export const PROSA_MINIMA_CON_SENALES_DE_LOGIN = 300;

/**
 * Menos texto visible que esto es una página que no volvió: «Loading…», «You
 * need to enable JavaScript to run this app.» o directamente nada. Bajo a
 * propósito: una portada de documentación hecha casi sólo de enlaces es legítima
 * para la herramienta del agente, que la usa para navegar.
 */
const TEXTO_VISIBLE_MINIMO = 60;

/** Los avisos del lector están arriba; mirar más abajo confundiría una nota que los cite. */
const CABECERA_DEL_LECTOR_CHARS = 1_500;

/** Lo que el lector agrega arriba de la página, y el sobre con que la guardamos. */
const SOBRE = /<external_untrusted_document[^>]*>|<\/external_untrusted_document>/g;
const PREAMBULO = /^\s*(Title|URL Source|Markdown Content|Published Time|Warning):.*$/gim;

const AVISO_DEL_LECTOR = /^\s*Warning:\s*Target URL returned error\s*(\d{3})/im;

/**
 * El título de una pantalla de inicio de sesión: uno de sus tramos ES la frase
 * («Google Sheets: Sign-in», «Sign in - Cuentas», «Hojas de cálculo: Acceder»).
 *
 * Antes bastaba con que el título la CONTUVIERA, y «acceder» es un verbo común
 * en castellano: «Acceder a las funciones de Excel: tabla de referencia» —justo
 * el tipo de página que la investigación busca— se leía como un muro.
 */
const FRASE_DE_LOGIN = /^(?:sign[\s-]?in|log[\s-]?in|login|iniciar sesi[oó]n|inicia sesi[oó]n|acceder|ingresar)$/i;

function esTituloDeLogin(titulo: string): boolean {
  return titulo.split(/\s*[:|–—]\s*|\s+-\s+/).some((tramo) => FRASE_DE_LOGIN.test(tramo.trim()));
}

/**
 * ¿El nombre de una fuente guardada es el de un muro de inicio de sesión?
 *
 * Una página se guarda como «Título (dominio)»: se mira el título sin el
 * dominio. Es lo que decide si releerla le puede cambiar el nombre (ver
 * `reemplazarLecturaWeb`): «Google Sheets: Sign-in» sí tiene que cambiar.
 */
export function esNombreDeMuro(fileName: string): boolean {
  return esTituloDeLogin(fileName.replace(/\s*\([^()]*\)\s*$/, '').trim());
}

/**
 * Frases de un formulario de inicio de sesión. Las de Google en inglés y en
 * castellano son las medidas; el resto son sus equivalentes directos.
 *
 * El tercer campo dice si la frase alcanza sola. «to continue to» no: aparece en
 * el pie de cualquier tabla larga («Scroll down to continue to the next
 * table»). Cuenta sólo junto con otra señal.
 */
const FRASES_DE_LOGIN: ReadonlyArray<[RegExp, string, boolean]> = [
  [/\bto continue to\b/i, '"to continue to"', false],
  [/\bemail or phone\b/i, '"Email or phone"', true],
  [/correo electr[oó]nico o tel[eé]fono/i, '"Correo electrónico o teléfono"', true],
  [/\bforgot (your )?email\b/i, '"Forgot email"', true],
  [/olvid(aste|ado) (el|tu) correo/i, '"¿Olvidaste el correo?"', true]
];

const SENALES_QUE_NO_ALCANZAN_SOLAS = new Set(
  FRASES_DE_LOGIN.filter(([, , sola]) => !sola).map(([, nombre]) => nombre)
);

/** Si las señales alcanzan para sospechar un muro: una fuerte, o dos cualesquiera. */
function senalesSuficientes(senales: string[]): boolean {
  return senales.some((senal) => !SENALES_QUE_NO_ALCANZAN_SOLAS.has(senal)) || senales.length >= 2;
}

function sinSobre(markdown: string): string {
  return markdown.replace(SOBRE, '');
}

/**
 * Los renglones que son oraciones: 8 palabras o más, sin contar enlaces.
 *
 * Una palabra tiene que tener alguna letra: una fila de tabla («| 1500 | 2024 |»)
 * no es prosa aunque tenga ocho columnas, y un menú o una lista de idiomas son
 * renglones de una o dos palabras.
 */
export function renglonesDeProsa(markdown: string): string[] {
  return sinSobre(markdown)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(PREAMBULO, '')
    .split('\n')
    .map((renglon) => renglon.replace(/^[\s*#>|+-]+/, '').trim())
    .filter(
      (renglon) =>
        renglon.split(/\s+/).filter((palabra) => /\p{L}/u.test(palabra)).length >= PALABRAS_DE_UN_RENGLON_DE_PROSA
    );
}

/** Cuánta prosa tiene la página, en caracteres. Ver `renglonesDeProsa`. */
export function prosaEnRenglones(markdown: string): number {
  return renglonesDeProsa(markdown).join(' ').length;
}

/** El texto que una persona vería: sin preámbulo, sin imágenes, los enlaces por su texto. */
function textoVisible(markdown: string): string {
  return sinSobre(markdown)
    .replace(PREAMBULO, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#>*_`|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Qué señales de un muro de inicio de sesión tiene la página. Vacío si ninguna.
 *
 * Todo en la cabecera: un muro es lo primero que se ve, y una frase del
 * formulario citada más abajo en un artículo no lo es.
 */
export function senalesDeLogin(markdown: string): string[] {
  const cabecera = sinSobre(markdown).slice(0, CABECERA_DEL_LECTOR_CHARS);
  const senales: string[] = [];

  const titulo = cabecera.match(/^\s*Title:\s*(.*)$/im)?.[1]?.trim() ?? '';

  if (titulo && esTituloDeLogin(titulo)) senales.push(`title "${titulo.slice(0, 80)}"`);

  for (const [frase, nombre] of FRASES_DE_LOGIN) {
    if (frase.test(cabecera)) senales.push(nombre);
  }

  return senales;
}

/**
 * ¿Esta página es un muro, un error o nada? `null` cuando hay algo que leer.
 *
 * Es el diagnóstico estricto, el que corre en `fetchDocumentationUrl` para todo
 * el que lee una página. No descarta una página por ser casi toda enlaces: la
 * herramienta del agente lee portadas de documentación justamente para seguir
 * sus enlaces. Para guardar una página como FUENTE está `diagnosticarFuente`,
 * que además exige prosa.
 */
export function diagnosticarPagina(markdown: string): PaginaSinContenido | null {
  const cabecera = sinSobre(markdown).slice(0, CABECERA_DEL_LECTOR_CHARS);
  const aviso = cabecera.match(AVISO_DEL_LECTOR);

  if (aviso) {
    const estado = Number(aviso[1]);

    // 401 y 403 son «quién sos» y «no podés»: un documento privado o detrás de
    // un inicio de sesión. Lo demás (404, 500…) es que la página no está.
    return estado === 401 || estado === 403
      ? { code: 'SOURCE_NEEDS_LOGIN', motivo: `the site answered ${estado}: it asks to sign in or the document is private` }
      : { code: 'SOURCE_UNREADABLE', motivo: `the site answered ${estado}` };
  }

  const senales = senalesDeLogin(markdown);

  if (senalesSuficientes(senales)) {
    const prosa = prosaEnRenglones(markdown);

    if (prosa < PROSA_MINIMA_CON_SENALES_DE_LOGIN) {
      return {
        code: 'SOURCE_NEEDS_LOGIN',
        motivo: `it is a sign-in screen (${senales.join(', ')}; ${prosa} characters of prose)`
      };
    }
  }

  if (textoVisible(markdown).length < TEXTO_VISIBLE_MINIMO) {
    return { code: 'SOURCE_UNREADABLE', motivo: 'the page came back empty' };
  }

  return null;
}

/** Una página que no aporta más que ruido a un curso. */
const MIN_USEFUL_CHARS = 400;

/**
 * Whether a fetched page carries prose or just furniture.
 *
 * Two failures look like success to the reader and were both observed on the
 * first real run:
 *
 *  - Jina returns 200 with `Warning: Target URL returned error 401` and then the
 *    page chrome, so a YouTube video became a "source" made of comment counts.
 *  - A login wall is a genuine page: Facebook and Instagram both came back as
 *    5-22 KB of "Log in / Sign Up" and navigation links.
 *
 * Length alone cannot tell these apart from an article — the Instagram reel was
 * larger than three of the good sources. What separates them is that almost all
 * of their bytes are links, so the prose left after stripping markdown link
 * syntax is what gets measured.
 */
export function readableProseLength(markdown: string): number {
  return markdown
    .replace(/<external_untrusted_document[^>]*>|<\/external_untrusted_document>/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(Title|URL Source|Markdown Content|Published Time):.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function isUnreadablePage(markdown: string): boolean {
  if (/Warning:\s*Target URL returned error\s*\d+/i.test(markdown)) {
    return true;
  }

  return readableProseLength(markdown) < MIN_USEFUL_CHARS;
}

/**
 * ¿Sirve esta página como FUENTE de un curso?
 *
 * El diagnóstico estricto más la exigencia de prosa de `isUnreadablePage`: una
 * página hecha casi sólo de enlaces le sirve al agente para navegar, pero como
 * material del curso es ruido. Es lo que usan la ruta de Fuentes, la
 * investigación y la relectura, los tres caminos que GUARDAN la página.
 */
export function diagnosticarFuente(markdown: string): PaginaSinContenido | null {
  const diagnostico = diagnosticarPagina(markdown);

  if (diagnostico) return diagnostico;

  if (isUnreadablePage(markdown)) {
    return {
      code: 'SOURCE_UNREADABLE',
      motivo: `too little text to be course material (${readableProseLength(markdown)} characters outside links)`
    };
  }

  return null;
}

/**
 * El error que devuelven la ruta de Fuentes, la relectura y la herramienta.
 *
 * 422 y no 502: el sitio contestó y el lector también; lo que no sirve es lo
 * que había. En inglés como el resto de los mensajes del servidor, porque lo
 * lee el modelo cuando falla su herramienta; a la docente le llega por el
 * `code`, que el panel traduce.
 */
export function errorDePaginaSinContenido(diagnostico: PaginaSinContenido, url: string): AppError {
  const mensaje =
    diagnostico.code === 'SOURCE_NEEDS_LOGIN'
      ? `${url} could not be read: ${diagnostico.motivo}. The document is private or restricted to an organization, so nothing was read from it. ` +
        'To use it, share it as "anyone with the link can view" and add it again, or download it as a PDF and upload the file.'
      : `${url} has no readable text (${diagnostico.motivo}), so nothing was read from it. If the content is in a file, upload the file instead.`;

  return new AppError(mensaje, diagnostico.code, 422);
}

/**
 * Las primeras letras de prosa de una fuente, para orientar sin resumir.
 *
 * Es lo que muestra el índice mientras el resumen de una fuente todavía no
 * existe. Prefiere los renglones de prosa porque una página web empieza casi
 * siempre por su menú; si no hay ninguno (un organigrama transcripto, una
 * tabla), se queda con el texto que haya. Los avisos entre corchetes —el de la
 * lectura por visión, el del recorte— no son contenido y se saltean.
 */
export function extractoDeProsa(texto: string, max: number): string {
  const sinAvisos = texto
    .split('\n')
    .filter((renglon) => !/^\s*\[[^\]]*\]\s*$/.test(renglon))
    .join('\n');

  const base = (renglonesDeProsa(sinAvisos).join(' ') || textoVisible(sinAvisos)).replace(/\s+/g, ' ').trim();

  if (base.length <= max) return base;

  const corte = base.slice(0, max);
  const ultimoEspacio = corte.lastIndexOf(' ');

  return `${(ultimoEspacio > max / 2 ? corte.slice(0, ultimoEspacio) : corte).trimEnd()}…`;
}
