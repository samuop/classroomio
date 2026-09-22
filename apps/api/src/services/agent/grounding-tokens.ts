/**
 * La mitad determinista del chequeo de fundamento: los datos que se pueden
 * buscar en la fuente sin preguntarle a nadie.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `grounding.ts` le pregunta a un modelo si la lección afirma cosas que la
 * fuente no sostiene. Medido contra una sección real cuyas invenciones estaban
 * identificadas una por una —tres corridas por lección, mismo modelo que
 * producción— marcó 6 de 13 familias alguna vez y sólo 2 en las tres corridas.
 * En una de las tres, la lección más inventada del conjunto no disparó nada.
 *
 * No es un defecto de calibración: su instrucción le dice explícitamente que
 * ante la duda se calle, porque una falsa alarma enseña a ignorar el canal. Esa
 * decisión es correcta para lo que ese chequeo juzga, que son AFIRMACIONES.
 *
 * Pero siete de las familias que deja pasar no son afirmaciones discutibles:
 * son TOKENS. Una población de 800.000, una temperatura de 40 °C, una marca
 * llamada Arlux, una carta de colores Pantone, una cita a una sección
 * «SOBRE NOSOTROS» que en la fuente se llama de otra manera. Para cada una la
 * pregunta no admite duda: el token está en el texto de la fuente o no está.
 * Eso se contesta con una búsqueda, no con un juicio — y una búsqueda no
 * alucina, no varía entre corridas y no cuesta una llamada.
 *
 * Los dos chequeos son complementarios exactamente donde hace falta: este caza
 * tokens, el otro caza afirmaciones. La misión y la visión inventadas de aquel
 * caso son prosa sin tokens distintivos y este archivo no las ve; el
 * verificador con modelo sí las vio. Ninguno de los dos reemplaza al otro.
 *
 * ── A dónde van los hallazgos ────────────────────────────────────────────────
 *
 * Al informe del docente Y, desde el 2026-09-22, de vuelta al modelo como
 * compuerta. Esto cambió a propósito y el motivo por el que NO iba al bucle
 * sigue siendo cierto: un falso positivo en el bucle enseña al modelo a
 * desconfiar del canal, que es el daño que no se puede deshacer.
 *
 * Lo que cambió es que ahora hay una salida correcta que antes no existía.
 * Medido sobre cinco lecciones: cero marcas `data-sin-fuente` y hallazgos de
 * tokens en todas, casi todos dentro de los EJEMPLOS —el nombre y el legajo de
 * un empleado, un «Error 404», un «24/7»—. Con una sola marca disponible, la
 * única respuesta a «este número no está en la fuente» era borrar el ejemplo, y
 * devolver eso habría sido pedirle al escritor que enseñara peor. Con
 * `data-ejemplo` la respuesta es de una palabra: declararlo. Y lo declarado se
 * saca del texto ANTES de contar (`quitarPasajesMarcados`), así que un ejemplo
 * marcado no vuelve a aparecer — el aviso se apaga solo cuando se lo atiende,
 * que es la condición para que un canal así no se vuelva ruido.
 *
 * El informe se queda con la lista larga (hasta `MAX_HALLAZGOS`), que la lee
 * una persona de una sentada; al modelo van pocos y formateados
 * (`redactarTokens`), porque ahí cada aviso compite por su atención en el medio
 * de una construcción.
 */

/** Una fuente tal como la vio quien escribió la lección. */
export interface FuenteParaTokens {
  fileName: string;
  text: string;
}

/** Etiquetas que cierran un bloque: donde termina una frase, aunque no haya punto. */
const CIERRA_BLOQUE = /<\/(?:p|h[1-6]|li|div|td|th|tr|blockquote|figcaption)\s*>|<br\s*\/?>/gi;

/**
 * La lección aplanada para este chequeo, que NO es la misma que para el otro.
 *
 * `textoDeLeccion` reemplaza cada etiqueta por un espacio, y para un modelo que
 * lee prosa eso alcanza. Acá no: un título y el párrafo siguiente quedaban
 * pegados sin ningún punto en el medio, así que «…en Acción» + «Los valores
 * son…» se leía como una sola frase y producía un nombre propio llamado
 * «Acción Los», que nadie escribió. El límite de bloque ES el límite de frase,
 * y este chequeo depende de saber dónde empieza una para distinguir la mayúscula
 * gramatical de un nombre.
 *
 * Los diagramas se conservan igual que allá —etiquetas separadas por `·`— porque
 * el caso que originó todo esto era una caja inventada en un organigrama.
 */
export function textoParaTokens(html: string): string {
  const conDiagramas = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => {
    const etiquetas = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return etiquetas.length > 0 ? ` [diagram: ${etiquetas.join(' · ')}] ` : ' ';
  });

  return conDiagramas
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(CIERRA_BLOQUE, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export type TipoDeHallazgo = 'numero' | 'nombre' | 'cita';

export interface HallazgoDeToken {
  tipo: TipoDeHallazgo;
  /** El token tal como aparece en la lección. */
  valor: string;
  /** Un tramo corto alrededor, para que el docente lo ubique. */
  contexto: string;
  /**
   * Si el token vive dentro de una etiqueta de diagrama (`[diagram: …]`).
   *
   * Lo necesita el filtro del canal al modelo (`redactarTokens`) y no el
   * informe: un nombre que está en una caja de un SVG no se puede «marcar»
   * —`data-ejemplo` va en un elemento del HTML, y adentro del diagrama no hay
   * ninguno—, así que pedírselo al modelo es pedirle algo imposible. Medido el
   * 2026-09-22: el aviso volvía en cada edición y el modelo terminó
   * reescribiendo la lección entera para satisfacerlo, perdiendo tres ejemplos
   * ya marcados.
   */
  enDiagrama: boolean;
}

/**
 * Tope de hallazgos que se guardan.
 *
 * Más alto que el del verificador con modelo (cinco) porque el destinatario es
 * distinto: allá cada aviso compite por la atención del modelo en el medio de
 * una construcción, acá es una lista que alguien recorre una vez. Cortar en
 * cinco escondería el dato más importante de todos, que es CUÁNTOS son: una
 * lección con veinte tokens sin respaldo no es una lección con un error.
 */
export const MAX_HALLAZGOS = 20;

/**
 * Cuántos hallazgos vuelven al MODELO.
 *
 * Cinco, igual que el verificador con modelo, y por el mismo motivo: alcanzan
 * para que entienda que el problema es sistemático sin convertir el resultado de
 * la herramienta en un informe. Con más, el aviso pesa más que la lección que
 * está escribiendo y lo que hace es reescribirla entera — que es exactamente la
 * salida que no queremos.
 */
export const MAX_TOKENS_AL_MODELO = 5;

/** Caracteres a cada lado del token que se guardan como contexto. */
const CONTEXTO_CHARS = 45;

/**
 * Forma comparable de un texto: sin acentos, sin puntuación, en minúsculas.
 *
 * Igual de tolerante que la de `grounding.ts`, y por el mismo motivo: lo que se
 * comprueba no es que la lección copie las tildes de la fuente, es que el dato
 * ESTÉ. Marcar «Ángela» porque la fuente escribió «Angela» sería el falso
 * positivo más tonto posible.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Los dígitos de un número, sin separadores de miles ni decimales. */
function soloDigitos(numero: string): string {
  return numero.replace(/[.,\s]/g, '');
}

/**
 * Unidades que convierten un número en un dato.
 *
 * Un número suelto y chico casi nunca es una afirmación sobre la empresa: «tres
 * pilares», «las 4 unidades de negocio», «paso 2». Un número CON unidad sí lo
 * es, siempre: una temperatura, un plazo, un precio, un porcentaje. La unidad
 * es lo que separa el andamiaje pedagógico del dato verificable, y por eso es el
 * filtro y no el tamaño.
 *
 * El orden importa: la alternativa más larga va primero.
 *
 * Con `°` antes de `°c`, la expresión casaba «45 °» y dejaba la C afuera — el
 * hallazgo salía con un valor que no era el de la lección, y un hallazgo que
 * cita mal lo que critica es el que enseña a desconfiar del chequeo. El `\b`
 * final rescata los casos de letras (`l` no come `litros`, porque después de la
 * `l` sigue una letra), pero no rescata al grado, que no es carácter de palabra.
 */
const UNIDADES =
  '%|°c|°f|°|km2|km|m2|m²|m3|cm|mm|kg|grs|gr|g|tn|lts|lt|litros?|l|ml|hs|horas?|h|minutos?|segundos?|d[íi]as?|semanas?|meses?|a[ñn]os?|usd|ars|eur|pesos?|d[óo]lares?|personas?|habitantes?|empleados?|sucursales?|puntos?';

/**
 * Un número con su unidad opcional, tal como se escribe en español.
 *
 * El cierre NO es `\b`. Con `\b`, una unidad que termina en un signo —«%», «°»,
 * «m²»— no podía ir seguida de un espacio ni de una coma: entre dos caracteres
 * que no son de palabra no hay límite de palabra, así que la expresión soltaba
 * la unidad, se quedaba con el número pelado y, por debajo de MAGNITUD_MINIMA,
 * lo descartaba. «El 30% restante» no se marcaba nunca, aunque la regla de
 * arriba dice que un porcentaje es un dato siempre. Medido: una lección
 * reescrita que inventó «el 30% restante» y «el 100% de cobertura» pasó sin un
 * solo aviso.
 *
 * Lo que `\b` sí hacía bien se conserva: la unidad no puede ser el comienzo de
 * una palabra más larga («10 gramos» no es «10 g»).
 */
const NUMERO = new RegExp(
  String.raw`(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(${UNIDADES})?(?![\p{L}\p{N}])`,
  'giu'
);

/** Desde cuánto un número sin unidad ya es un dato por su tamaño. */
const MAGNITUD_MINIMA = 1000;

/**
 * Hasta cuántas palabras una cita entrecomillada se lee como el NOMBRE de algo.
 *
 * Más largo que esto es una frase, y una lección tiene todo el derecho de
 * inventar la frase que dice un cliente en un ejemplo.
 */
const MAX_PALABRAS_CITA = 6;

/**
 * Palabras que aparecen en mayúscula sin ser nombres propios.
 *
 * La lista es corta a propósito. El trabajo pesado lo hace la regla de posición
 * —una palabra sólo es candidata si alguna vez aparece en mayúscula SIN estar
 * al principio de una oración— y una lista larga acabaría tapando justamente los
 * nombres inventados que se quieren encontrar.
 */
const NO_SON_NOMBRES = new Set([
  'pitfalls',
  'tips',
  'ok',
  'html',
  'pdf',
  'svg',
  'url',
  'iva',
  'dni',
  'cuit',
  'cuil',
  'importante',
  'atencion',
  'nota',
  'ejemplo',
  'caso',
  'clave',
  'claves',
  'resumen',
  'objetivo',
  'objetivos',
  'referencias',
  'references',
  // Sustantivos de ESTRUCTURA del texto. Encabezan un título o una viñeta
  // («Ejemplos de aplicación», «Casos frecuentes», «Paso 3», «Vía WhatsApp») y
  // nunca nombran nada. Estaban afuera y se pagó caro: «Ejemplos» en un título
  // que seguía a un diagrama se marcó en las cinco lecciones de una corrida.
  'ejemplos',
  'casos',
  'situacion',
  'situaciones',
  'escenario',
  'escenarios',
  'paso',
  'pasos',
  'via',
  'puntos',
  'bloque',
  'bloques',
  // Interrogativos y marcadores de discurso. Aparecen en mayúscula dentro de
  // una viñeta o una pregunta al lector, nunca son nombres, y no hay caso
  // ambiguo: ninguna empresa se llama «Cuál».
  'que',
  'cual',
  'cuales',
  'como',
  'donde',
  'cuando',
  'quien',
  'quienes',
  'cuanto',
  'dato',
  'datos',
  'ojo',
  'ademas',
  'ahora',
  'entonces',
  'tambien',
  'finalmente',
  'primero',
  'segundo',
  'tercero',
  // Sustantivos de CATEGORÍA: lo que va pegado a un nombre sin ser el nombre.
  // «Provincia de Maipú» y «Sucursal Maipú» salían marcados aunque Maipú sí
  // está en la fuente: lo que la lección agregó fue la categoría, no el dato.
  // Se recortan del borde de la racha (ver `recortarCategorias`) y se juzga lo
  // que queda, que es el nombre de verdad.
  'provincia',
  'provincias',
  'sucursal',
  'sucursales',
  'direccion',
  'telefono',
  'email',
  'correo',
  'codigo',
  'postal',
  'ciudad',
  'localidad',
  'capital',
  'zona',
  'area',
  'sector',
  'propuesta',
  'posicionamiento'
]);

/**
 * Una palabra capitalizada, y una sigla.
 *
 * Los límites van como anticipos de letra Unicode y NO como `\b`, que es el
 * bug que esto arregla: `\b` mira caracteres de palabra ASCII, así que en
 * «Paraná» cortaba entre la `n` y la `á` y el hallazgo salía como «Paran» — un
 * aviso que cita mal lo que critica, sobre un río que además existe. Con
 * `\p{L}` el corte cae donde termina la palabra de verdad.
 */
const PALABRA_CAPITALIZADA = /(?<!\p{L})(\p{Lu}[\p{L}]*(?:-\p{Lu}[\p{L}]*)*)(?!\p{L})/gu;
const SIGLA = /(?<!\p{L})(\p{Lu}{3,})(?!\p{L})/gu;

/**
 * Nexos que unen las partes de un nombre compuesto: «Paso de los Libres».
 *
 * `y` NO está, y es la exclusión que importa: con ella, una enumeración de tres
 * marcas inventadas —«Arlux y Tenova»— se fusionaba en un hallazgo con un nombre
 * que nadie escribió, en vez de dos hallazgos con los nombres reales.
 */
const NEXOS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'da', 'do']);

/**
 * ¿Esta posición del texto arranca una oración?
 *
 * Importa porque en español toda oración empieza en mayúscula, así que una
 * palabra capitalizada al principio no dice nada sobre si es un nombre.
 *
 * El separador de etiquetas de un diagrama (`·`) y el de viñetas NO cuentan como
 * fin de oración, a propósito. Una etiqueta no es una oración: es una frase
 * nominal, y su primera palabra suele ser parte del nombre («Planta Rosalía»,
 * «Gerencia General»). Tratarla como comienzo de oración descartaba justo la
 * palabra más informativa de la caja — que es donde apareció el problema que
 * originó todo esto.
 *
 * El `]` que CIERRA un diagrama sí abre oración, y es lo contrario del caso de
 * arriba: lo que viene después del diagrama es el título o el párrafo
 * siguiente, no la continuación de la última etiqueta. Sin esta línea, «…
 * Cierre] Ejemplos de aplicación» dejaba a «Ejemplos» «a mitad de oración»,
 * o sea candidata a nombre propio. Medido el 2026-09-22: ese falso positivo
 * salió en las cinco lecciones de una construcción y en cada edición de otra.
 */
function arrancaOracion(texto: string, indice: number): boolean {
  for (let i = indice - 1; i >= 0; i--) {
    const c = texto[i];

    if (c === ' ' || c === '\n' || c === '\t' || c === '"' || c === '«' || c === '(' || c === '[') continue;

    return c === '.' || c === '!' || c === '?' || c === ':' || c === ';' || c === ']';
  }

  return true;
}

/**
 * ¿Lo que hay entre dos palabras capitalizadas las une en un solo nombre?
 *
 * Sólo espacios («Villa Clara») o sólo nexos en minúscula («Paso de los
 * Libres»). Cualquier otra cosa —una coma, un `·`, un verbo— corta: son dos
 * nombres distintos, y unirlos produciría un hallazgo con un nombre que nadie
 * escribió.
 */
function une(texto: string, izquierda: { indice: number; valor: string }, derecha: { indice: number }): boolean {
  const entre = texto.slice(izquierda.indice + izquierda.valor.length, derecha.indice);

  if (/^\s+$/.test(entre)) return true;
  if (!/^[\sa-záéíóúüñ]+$/.test(entre)) return false;

  return entre
    .trim()
    .split(/\s+/)
    .every((palabra) => NEXOS.has(palabra));
}

interface Candidato {
  valor: string;
  indice: number;
}

/**
 * Los nombres propios de un texto: rachas de palabras capitalizadas.
 *
 * Devuelve la racha completa («Presidencia Roque Sáenz Peña») y no sus palabras
 * por separado, porque el dato que se verifica es la localidad, no cada término.
 * Reportar cuatro hallazgos donde hay uno inflaría el conteo, que es lo único
 * que este chequeo le pide al docente que mire.
 */
export function extraerNombres(texto: string): Candidato[] {
  const piezas: Array<{ valor: string; indice: number; inicial: boolean }> = [];

  for (const m of texto.matchAll(PALABRA_CAPITALIZADA)) {
    const valor = m[1];
    const indice = m.index ?? 0;

    // Una sola letra («A», «Y») no es un nombre y ensucia las rachas.
    if (valor.length < 2) continue;

    piezas.push({ valor, indice, inicial: arrancaOracion(texto, indice) });
  }

  /**
   * Una palabra cuenta como nombre sólo si ALGUNA VEZ, en esta lección, aparece
   * en mayúscula sin estar al principio de una oración.
   *
   * Es la regla que reemplaza a un diccionario, y la que hace falta para no
   * necesitar una lista de las palabras con las que se puede empezar una frase
   * en español — lista que nunca estaría completa. «Con Arlux trabajamos» daba
   * un hallazgo llamado «Con Arlux»: `Con` sólo aparece al principio de una
   * oración, así que no es un nombre; `Arlux` aparece en el medio, así que sí.
   */
  const enMedio = new Set(piezas.filter((p) => !p.inicial).map((p) => normalizar(p.valor)));
  const admitidas = piezas.filter((p) => enMedio.has(normalizar(p.valor)));

  const candidatos: Candidato[] = [];
  let i = 0;

  while (i < admitidas.length) {
    let fin = i;

    while (fin + 1 < admitidas.length && une(texto, admitidas[fin], admitidas[fin + 1])) fin += 1;

    const siguiente = fin + 1;

    // Un artículo capitalizado en el borde no es parte del nombre: viene de que
    // el bloque de al lado empieza con «Los…» o «La…». Se recorta en vez de
    // cortar la racha, para no perder el nombre que sí está en el medio.
    let desde = i;
    let hasta = fin;

    while (desde < hasta && NEXOS.has(normalizar(admitidas[desde].valor))) desde += 1;
    while (hasta > desde && NEXOS.has(normalizar(admitidas[hasta].valor))) hasta -= 1;

    const primera = admitidas[desde];
    const ultima = admitidas[hasta];
    const valor = texto.slice(primera.indice, ultima.indice + ultima.valor.length);
    const unaSola = hasta === desde;
    const descartable = NO_SON_NOMBRES.has(normalizar(primera.valor)) || NEXOS.has(normalizar(primera.valor));

    if (!(unaSola && descartable)) {
      candidatos.push({ valor, indice: primera.indice });
    }

    i = siguiente;
  }

  return candidatos;
}

/**
 * Las siglas: tres o más letras en mayúscula seguidas.
 *
 * Van por separado de los nombres porque la regla de posición no les sirve —una
 * sigla al principio de una oración sigue siendo una sigla— y porque son el caso
 * donde la invención es más barata de producir y más difícil de notar leyendo.
 */
export function extraerSiglas(texto: string): Candidato[] {
  const encontradas: Candidato[] = [];

  for (const m of texto.matchAll(SIGLA)) {
    if (NO_SON_NOMBRES.has(normalizar(m[1]))) continue;

    encontradas.push({ valor: m[1], indice: m.index ?? 0 });
  }

  return encontradas;
}

/**
 * Lo que la lección pone entre comillas.
 *
 * Un fragmento entrecomillado se lee como una cita de la fuente, y ahí una
 * invención es peor que en el cuerpo: la lección vieja citaba una sección
 * «SOBRE NOSOTROS» que en la web se llama «QUIENES SOMOS». El lector que va a
 * verificar no encuentra nada y concluye que se inventó todo, incluso la parte
 * que estaba bien.
 */
export function extraerCitas(texto: string): Candidato[] {
  const entrecomillado = /[«"“]([^«»"“”]{8,90})[»"”]/g;
  const encontradas: Candidato[] = [];

  for (const m of texto.matchAll(entrecomillado)) {
    const valor = m[1].trim();

    // Sólo lo que tiene forma de NOMBRE de algo —una sección, un programa, un
    // título—, no una frase entre comillas.
    //
    // Medido: de catorce hallazgos en una sección, tres eran parlamentos
    // inventados dentro de un ejemplo de rol («Llevate este látex interior de 4
    // litros…»), que es justamente lo que una lección tiene que poder escribir.
    // Las citas que sí importaban eran cortas y eran nombres: la lección
    // remitía a una sección «SOBRE NOSOTROS» que en la fuente se llama de otra
    // manera, y el lector que va a verificar no encuentra nada.
    if (valor.split(/\s+/).length > MAX_PALABRAS_CITA) continue;

    encontradas.push({ valor, indice: (m.index ?? 0) + 1 });
  }

  return encontradas;
}

/**
 * Los tramos del texto que son etiquetas de un diagrama.
 *
 * Hacen falta porque ahí la mayúscula NO significa nada: una etiqueta se
 * escribe en capital por convención tipográfica («Diagnóstico», «Sinergia»,
 * «Mejora continua»), así que una palabra sola capitalizada dentro de un
 * diagrama no es evidencia de nombre propio. Las de dos o más sí —«Casa
 * Central», «Planta Rosalía»— y ésas son las cajas inventadas que importan.
 */
function tramosDeDiagrama(texto: string): Array<[number, number]> {
  return [...texto.matchAll(/\[diagram:[^\]]*\]/g)].map((m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length
  ]);
}

/**
 * Quita del borde de un nombre las palabras que son categoría y no nombre.
 *
 * Sólo de los bordes, y nunca del medio: «Centro de Colorimetría» pierde
 * «Centro» y queda «Colorimetría», que es el dato a verificar; «Paso de los
 * Libres» no pierde nada porque ninguna de sus partes es una categoría.
 * Devuelve cadena vacía cuando el nombre era categoría de punta a punta.
 */
export function recortarCategorias(nombre: string): string {
  const partes = nombre.split(/\s+/);

  let desde = 0;
  let hasta = partes.length - 1;

  const esCategoria = (p: string) => {
    const n = normalizar(p);

    return NO_SON_NOMBRES.has(n) || NEXOS.has(n);
  };

  while (desde <= hasta && esCategoria(partes[desde])) desde += 1;
  while (hasta >= desde && esCategoria(partes[hasta])) hasta -= 1;

  return desde > hasta ? '' : partes.slice(desde, hasta + 1).join(' ');
}

function contexto(texto: string, indice: number, largo: number): string {
  const desde = Math.max(0, indice - CONTEXTO_CHARS);
  const hasta = Math.min(texto.length, indice + largo + CONTEXTO_CHARS);

  return (desde > 0 ? '…' : '') + texto.slice(desde, hasta).trim() + (hasta < texto.length ? '…' : '');
}

/**
 * Contrasta los tokens de una lección contra el texto de sus fuentes.
 *
 * `texto` es la lección ya aplanada — se espera la salida de `textoDeLeccion`,
 * que conserva las etiquetas de los diagramas como `[diagram: …]`. Eso es a
 * propósito: el caso que originó todo este trabajo era una caja inventada
 * adentro de un organigrama, y un chequeo que no mire los diagramas no mira
 * donde apareció el problema.
 */
export function verificarTokens(params: {
  texto: string;
  fuentes: FuenteParaTokens[];
  /** Sólo para medir: `Infinity` devuelve todo, para poder contar sin el corte. */
  tope?: number;
}): HallazgoDeToken[] {
  const { texto, fuentes } = params;
  const tope = params.tope ?? MAX_HALLAZGOS;

  // Sin fuentes no hay nada contra qué contrastar, y marcar la lección entera
  // sería el aviso que se aprende a ignorar. Una lección escrita desde el
  // conocimiento general es legítima y se declara como tal en otro lugar.
  if (fuentes.length === 0) return [];

  const crudo = fuentes.map((f) => f.text).join(' ');
  const material = normalizar(crudo);

  if (material.length === 0) return [];

  /**
   * ¿Este nombre está en la fuente, como palabra y no como pedazo de otra?
   *
   * La comparación por subcadena daba un falso NEGATIVO silencioso y del peor
   * tipo: la sigla «NEA» pasaba como respaldada porque la fuente dice «LINEA DE
   * PRODUCTOS», y «nea» está dentro de «linea». La región inventada era
   * justamente uno de los datos que se repetía veintiuna veces en la sección.
   * Con los límites de palabra el cotejo dice lo que se quería preguntar.
   */
  const materialConBordes = ` ${material} `;
  const apareceEnFuente = (valor: string) => materialConBordes.includes(` ${normalizar(valor)} `);

  /**
   * Los números de la fuente, como conjunto exacto.
   *
   * Buscarlos como subcadena del texto daba un falso NEGATIVO silencioso: la
   * fuente traía un teléfono «4555 7000» y la lección afirmaba «45 °C», que
   * pasaba porque «45» está dentro de «4555». Un chequeo de datos que se rompe
   * justo con los datos es peor que no tenerlo, así que se comparan números
   * contra números y no cadenas contra cadenas.
   */
  const numerosDeLaFuente = new Set(
    [...crudo.matchAll(/\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?/g)].map((m) => soloDigitos(m[0]))
  );

  /**
   * Las palabras que la lección escribe TAMBIÉN en minúscula.
   *
   * Es la regla que separa un nombre de una palabra común sin necesitar un
   * diccionario. «Servicio», «Calidad», «Cobertura» aparecían marcadas por
   * encabezar una viñeta en negrita, y la misma lección dice «vocación de
   * servicio» y «radio de cobertura» dos párrafos más arriba: si el texto la
   * usa en minúscula, la mayúscula era del formato, no del nombre. Una marca
   * inventada como «Arlux» nunca aparece en minúscula, y por eso sobrevive.
   */
  const enMinuscula = new Set(
    [...texto.matchAll(/(?<!\p{L})(\p{Ll}[\p{L}]*)/gu)].map((m) => normalizar(m[1])).filter(Boolean)
  );

  const diagramas = tramosDeDiagrama(texto);
  const hallazgos: HallazgoDeToken[] = [];
  const registrados: string[] = [];

  function registrar(tipo: TipoDeHallazgo, valor: string, indice: number) {
    const clave = normalizar(valor);

    // Contención en los dos sentidos, y no igualdad: «SOBRE NOSOTROS» salía tres
    // veces —como nombre, como dos siglas y como cita— y tres avisos del mismo
    // token hacen parecer sistemático lo que es un solo error.
    if (registrados.some((r) => r.includes(clave) || clave.includes(r))) return;

    registrados.push(clave);
    hallazgos.push({
      tipo,
      valor,
      contexto: contexto(texto, indice, valor.length),
      enDiagrama: diagramas.some(([desde, hasta]) => indice >= desde && indice < hasta)
    });
  }

  for (const m of texto.matchAll(NUMERO)) {
    const escrito = m[1];
    const unidad = m[2];
    const indice = m.index ?? 0;
    const magnitud = Number.parseFloat(soloDigitos(escrito));

    const esDato = Boolean(unidad) || (Number.isFinite(magnitud) && magnitud >= MAGNITUD_MINIMA);
    if (!esDato) continue;

    const buscado = soloDigitos(escrito);

    /**
     * Un teléfono no se escribe igual en los dos lados.
     *
     * La lección pone «+54 9 362 4545151» y la fuente lo trae pegado dentro de
     * un enlace, «5493624545151». Son el mismo número y marcarlo sería acusar a
     * la lección de inventar el teléfono que copió bien. Por eso un número
     * largo también vale si es parte de un número de la fuente — largo, para
     * que «45» no se cuele dentro de un «4555» cualquiera, que es exactamente
     * el falso negativo que este chequeo ya tuvo una vez.
     */
    const esParteDeUnoDeLaFuente =
      buscado.length >= 5 && [...numerosDeLaFuente].some((n) => n.length > buscado.length && n.includes(buscado));

    if (numerosDeLaFuente.has(buscado) || esParteDeUnoDeLaFuente) continue;

    registrar('numero', unidad ? `${escrito} ${unidad}` : escrito, indice);
  }

  for (const candidato of [...extraerNombres(texto), ...extraerSiglas(texto)]) {
    const buscado = normalizar(candidato.valor);

    if (buscado.length < 3) continue;
    if (apareceEnFuente(buscado)) continue;

    const unaSolaPalabra = !buscado.includes(' ');
    if (unaSolaPalabra && enMinuscula.has(buscado)) continue;

    // Una palabra sola dentro de una etiqueta de diagrama: la mayúscula es
    // tipográfica, no un nombre. Las de dos o más siguen contando, que son las
    // cajas inventadas por las que existe todo esto.
    if (unaSolaPalabra && diagramas.some(([desde, hasta]) => candidato.indice >= desde && candidato.indice < hasta)) {
      continue;
    }

    // «Provincia de Maipú»: lo que la lección puso de más es la categoría, y
    // el nombre que queda al recortarla sí está en la fuente. Se juzga el
    // nombre, no la etiqueta que lo precede.
    const nombre = recortarCategorias(candidato.valor);
    if (nombre.length === 0) continue;
    if (apareceEnFuente(nombre)) continue;

    registrar('nombre', nombre, candidato.indice + candidato.valor.indexOf(nombre));
  }

  for (const candidato of extraerCitas(texto)) {
    const buscado = normalizar(candidato.valor);

    if (buscado.length < 8) continue;
    if (apareceEnFuente(buscado)) continue;

    registrar('cita', candidato.valor, candidato.indice);
  }

  return Number.isFinite(tope) ? hallazgos.slice(0, tope) : hallazgos;
}

/**
 * ¿Este hallazgo se le puede pedir al modelo que lo atienda?
 *
 * El informe del docente y el canal al modelo NO llevan lo mismo, y esa
 * asimetría es deliberada. El informe lo lee una persona que puede juzgar:
 * ahí va todo. Al modelo sólo puede ir lo que tiene una salida posible, porque
 * un aviso que no se puede satisfacer se atiende igual — y lo que hace el
 * modelo cuando no puede satisfacerlo por bloques es reescribir la lección
 * entera. Medido el 2026-09-22: en las dos lecciones de una actualización, el
 * aviso imposible («Vía WhatsApp», «Incidentes Críticos», etiquetas de un
 * diagrama) terminó en un `update_lesson_content` que borró tres ejemplos ya
 * marcados y los reemplazó por otra cosa.
 *
 * Lo que queda:
 *
 * - Los NÚMEROS, siempre. Un plazo o un teléfono equivocado es el daño que este
 *   chequeo existe para encontrar, esté donde esté — y adentro de un diagrama
 *   un número sigue siendo corregible reemplazando el SVG.
 * - Los nombres y las citas que están en la PROSA, que es donde el modelo puede
 *   marcar el elemento que los contiene.
 *
 * Lo que se cae: nombres y citas dentro de un `[diagram: …]`. Una etiqueta en
 * mayúscula no es un nombre propio, y aunque lo fuera no hay ningún elemento
 * HTML adentro del SVG al que ponerle `data-ejemplo`.
 */
function vaAlModelo(hallazgo: HallazgoDeToken): boolean {
  return hallazgo.tipo === 'numero' || !hallazgo.enDiagrama;
}

/**
 * Los hallazgos tal como los lee el modelo: «valor» — contexto.
 *
 * Con el contexto y no pelados. Un aviso que dice sólo «4471» lo manda a buscar
 * el número por toda la lección; con el tramo que lo rodea sabe cuál de los tres
 * párrafos tiene que tocar, y puede decidir en el acto si es un ejemplo suyo o
 * un dato que creyó copiar.
 */
export function redactarTokens(hallazgos: HallazgoDeToken[], tope = MAX_TOKENS_AL_MODELO): string[] {
  return hallazgos
    .filter(vaAlModelo)
    .slice(0, tope)
    .map((hallazgo) => `«${hallazgo.valor}» — ${hallazgo.contexto}`);
}
