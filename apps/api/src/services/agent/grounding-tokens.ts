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

/**
 * Dónde apareció un token que NO está en las fuentes de la lección.
 *
 * ── Por qué hay un segundo alcance ───────────────────────────────────────────
 *
 * Medido en producción el 2026-09-29, en un curso de planillas: el chequeo
 * buscaba sólo en las una o dos fuentes que el plan le había asignado a cada
 * lección, y así marcaba como inventado el «24 hs» que la docente escribió en
 * su propio pedido (el público eran vendedores de un comercio que no cierra),
 * y las teclas y pestañas del programa que
 * figuraban en OTRAS tres fuentes del mismo curso. El rebote hizo lo único que
 * la consigna le dejaba —borrarlos o copiar el formato de la fuente— y el curso
 * perdió hechos ciertos.
 *
 * Un nombre que está en el pedido de la docente, en el plan que aprobó o en
 * cualquier fuente del curso no es un invento: el invento que esto persigue
 * («Arlux», «4471», un teléfono) no aparece en ninguno de esos lugares. Lo que
 * se encuentra acá va al informe con su rótulo y NO vuelve al modelo.
 *
 * El orden es el de la lista: si está en el pedido, eso es lo que le sirve
 * saber a la docente, aunque también figure en una fuente.
 */
export type RespaldoAmpliado = 'pedido' | 'plan' | 'curso';

/** Lo que lee la docente al lado de cada token encontrado fuera de la lección. */
export const ROTULO_DE_RESPALDO: Record<RespaldoAmpliado, string> = {
  pedido: 'está en tu pedido',
  plan: 'está en el plan',
  curso: 'figura en otra fuente del curso'
};

/** Qué decidió el escritor sobre un token en el parche del rebote. Ver `marcas-del-rebote.ts`. */
export type DecisionSobreToken = 'ejemplo' | 'sin-fuente' | 'mantener';

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
  /** No está en las fuentes de la lección pero sí acá. Ausente = en ningún lado. */
  respaldo?: RespaldoAmpliado;
  /** El rótulo que lee la docente: el de `respaldo`, o el de lo que decidió el escritor. */
  rotulo?: string;
  /**
   * Va al informe y NO al modelo.
   *
   * Es el caso de una cita que empieza en minúscula: «más aireada», «en vez
   * de», «hacer solamente mi parte». Son muletillas, la forma normal de
   * escribir con voz rioplatense, y nunca van a estar en una fuente — el
   * rebote las borraba una por una. Se siguen mostrando porque una minúscula
   * también puede ser el nombre real de un estado de un procedimiento
   * («observado»), y eso lo juzga la docente, no el modelo.
   */
  soloInforme?: boolean;
  /** El bloque de la lección donde está, cuando se sabe: es lo que se marca. */
  blockId?: string;
  /** Lo que decidió el escritor en el parche del rebote. */
  decision?: DecisionSobreToken;
  /** Por qué, en palabras del escritor, para la docente. */
  motivo?: string;
}

/**
 * Los lugares, además de las fuentes de la lección, donde un token no es un
 * invento. Ver `RespaldoAmpliado`.
 */
export interface ReferenciasAmpliadas {
  /** Lo que la docente escribió en la conversación. */
  pedido?: string;
  /** El título y la descripción del ítem aprobado del plan. */
  plan?: string;
  /** Todas las fuentes del curso. */
  curso?: FuenteParaTokens[];
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
 * Cuántos hallazgos vuelven al CONSTRUCTOR.
 *
 * Cinco, igual que el verificador con modelo, y por el mismo motivo: alcanzan
 * para que entienda que el problema es sistemático sin convertir el resultado de
 * la herramienta en un informe. Con más, el aviso pesa más que la lección que
 * está escribiendo y lo que hace es reescribirla entera — que es exactamente la
 * salida que no queremos.
 *
 * El parche del rebote (`marcas-del-rebote.ts`) NO usa este tope: ahí van todos,
 * porque la única respuesta posible es poner una marca y no hay texto que se
 * pueda perder.
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
  return numero.replace(/\D/g, '');
}

/**
 * Una cifra tal como se escribe: agrupada de a tres, o corrida.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Sólo se reconocían los miles con PUNTO. Una fuente que decía «1,048,576
 * filas» quedaba partida en «1,048» y «576», así que el «1.048.576» correcto de
 * una lección en castellano no aparecía y rebotaba — y el rebote lo empujó a
 * escribir «1,048,576», que en Argentina se lee «uno coma cero cuarenta y
 * ocho». El chequeo castigaba el formato bien escrito y premiaba el otro.
 *
 * Ahora un grupo de miles puede ir separado por punto, coma, espacio, espacio
 * duro o espacio fino — «1.048.576», «1,048,576», «1 048 576» son el mismo
 * número —, siempre con el MISMO separador entre grupos y con el primer grupo
 * sin cero adelante («0,125» es un decimal, no ciento veinticinco). Después
 * pueden venir uno o dos decimales con el otro separador («1.500,50»).
 *
 * Lo que no es agrupado es un número corrido con decimales opcionales: «150.50»
 * y «25,00» son precios con centavos, no quince mil ni dos mil quinientos.
 */
const CIFRA = String.raw`(?:[1-9]\d{0,2}(?<sep>[.,\u0020\u00a0\u2009\u202f])\d{3}(?:\k<sep>\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)(?!\d)`;

/**
 * El valor de una cifra, comparable entre formatos: «1.048.576», «1,048,576» y
 * «1 048 576» valen "1048576"; «150.50» vale "150.5"; «25,00» vale "25".
 *
 * Como texto y no como `number`: un teléfono de trece dígitos se compara igual,
 * sin redondeos.
 */
export function valorDeCifra(escrito: string): string {
  const texto = escrito.replace(/[\u00a0\u2009\u202f]/g, ' ').trim();
  const agrupado = texto.match(/^([1-9]\d{0,2})([., ])(\d{3}(?:\2\d{3})*)(?:[.,](\d{1,2}))?$/);

  let entero: string;
  let decimales: string;

  if (agrupado) {
    entero = agrupado[1] + agrupado[3].replace(/\D/g, '');
    decimales = agrupado[4] ?? '';
  } else {
    const partes = texto.match(/^(\d+)(?:[.,](\d+))?$/);

    if (!partes) return soloDigitos(texto);

    entero = partes[1];
    decimales = partes[2] ?? '';
  }

  entero = entero.replace(/^0+(?=\d)/, '');
  decimales = decimales.replace(/0+$/, '');

  return decimales ? `${entero}.${decimales}` : entero;
}

/**
 * Los números de un texto de referencia, en sus dos lecturas.
 *
 * - La de la cifra entera: «1 048 576» → 1048576, «1,5» → 1.5.
 * - La de las partes: cada tramo de dígitos suelto, «1 048 576» → 1, 48 y 576.
 *
 * Las dos a la vez, del lado de la fuente, porque la fuente no se elige: un
 * teléfono «4555 7000» no es un número agrupado y sus partes sí son datos. Lo
 * que NO se hace es comparar por subcadena: «45 °C» no está respaldado por un
 * «4555» cualquiera, que es el falso negativo que este chequeo ya tuvo.
 *
 * `digitos` son las cifras como tiras de dígitos, para reconocer un número largo
 * que la fuente trae pegado dentro de otro (un teléfono dentro de un enlace).
 */
function numerosDe(texto: string): { valores: Set<string>; digitos: Set<string> } {
  const valores = new Set<string>();
  const digitos = new Set<string>();

  for (const m of texto.matchAll(new RegExp(CIFRA, 'gu'))) {
    valores.add(valorDeCifra(m[0]));
    digitos.add(soloDigitos(m[0]));
  }

  for (const m of texto.matchAll(/\d+/g)) {
    valores.add(valorDeCifra(m[0]));
    digitos.add(m[0]);
  }

  return { valores, digitos };
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
 *
 * La cifra es `CIFRA`: agrupada con cualquier separador de miles, o corrida con
 * decimales. Ver ahí lo que se midió.
 */
const NUMERO = new RegExp(String.raw`(?<cifra>${CIFRA})\s*(?<unidad>${UNIDADES})?(?![\p{L}\p{N}])`, 'giu');

/**
 * La forma comparable de una unidad: «hs», «hora» y «horas» son la misma.
 *
 * Hace falta para ampliar el alcance sin abrir la puerta a los inventos. Un
 * número del pedido o de otra fuente respalda al de la lección sólo si dice lo
 * mismo CON la misma unidad: comparar sólo los dígitos contra el curso entero
 * dejaba pasar «45 °C» por un «45 personas» de cualquier taller — medido, con
 * once fuentes quedaban respaldados 65 de los enteros del 1 al 100.
 */
const UNIDADES_EQUIVALENTES: Array<[RegExp, string]> = [
  [/^%$/, '%'],
  [/^°c$/, '°c'],
  [/^°f$/, '°f'],
  [/^°$/, '°'],
  [/^km2$/, 'km2'],
  [/^(?:m2|m²)$/, 'm2'],
  [/^m3$/, 'm3'],
  [/^km$/, 'km'],
  [/^cm$/, 'cm'],
  [/^mm$/, 'mm'],
  [/^kg$/, 'kg'],
  [/^(?:grs|gr|g)$/, 'g'],
  [/^tn$/, 'tn'],
  [/^(?:lts|lt|litros?|l)$/, 'l'],
  [/^ml$/, 'ml'],
  [/^(?:hs|horas?|h)$/, 'h'],
  [/^minutos?$/, 'min'],
  [/^segundos?$/, 's'],
  [/^dias?$/, 'dia'],
  [/^semanas?$/, 'semana'],
  [/^mes(?:es)?$/, 'mes'],
  [/^anos?$/, 'ano'],
  [/^(?:usd|dolares?)$/, 'usd'],
  [/^(?:ars|pesos?)$/, 'ars'],
  [/^eur$/, 'eur'],
  [/^personas?$/, 'persona'],
  [/^habitantes?$/, 'habitante'],
  [/^empleados?$/, 'empleado'],
  [/^sucursal(?:es)?$/, 'sucursal'],
  [/^puntos?$/, 'punto']
];

function unidadCanonica(unidad: string): string {
  const plana = unidad.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  return UNIDADES_EQUIVALENTES.find(([forma]) => forma.test(plana))?.[1] ?? plana;
}

/** «45°» y «45 °C» son el mismo dato; «45 °C» y «45 °F», no. */
function unidadesCompatibles(a: string, b: string): boolean {
  if (a === b) return true;

  return (a === '°' && b.startsWith('°')) || (b === '°' && a.startsWith('°'));
}

/** Los números de un texto de referencia con su unidad, para ampliar el alcance. */
function numerosConUnidad(texto: string): Array<{ valor: string; unidad: string | null; escrito: string }> {
  return [...texto.matchAll(NUMERO)].map((m) => ({
    valor: valorDeCifra(m.groups?.cifra ?? m[0]),
    unidad: m.groups?.unidad ? unidadCanonica(m.groups.unidad) : null,
    escrito: m.groups?.cifra ?? m[0]
  }));
}

/** Una cifra escrita con separador de miles: «2.024», «10 000». Un año no se escribe así. */
const CON_SEPARADOR_DE_MILES = /\d[.,\s]\d{3}(?!\d)/;

/** Un año tal como se escribe: cuatro cifras pegadas, de 1800 a 2099. */
const ANIO = /^(?:1[89]|20)\d{2}$/;

/**
 * Si un número de una referencia respalda al de la lección.
 *
 * Mismo valor, y la unidad tiene que acompañar: con unidad, una compatible; SIN
 * unidad, también sin unidad. Antes un número sin unidad de la lección quedaba
 * respaldado por el mismo valor con cualquier unidad o por un año: un «2.024
 * productos» inventado lo respaldaba el 2024 de cualquier fuente del curso.
 */
function respaldaAlNumero(
  deLaReferencia: { valor: string; unidad: string | null; escrito: string },
  deLaLeccion: { valor: string; unidad: string | null; escrito: string }
): boolean {
  if (deLaReferencia.valor !== deLaLeccion.valor) return false;

  if (deLaLeccion.unidad !== null) {
    return deLaReferencia.unidad !== null && unidadesCompatibles(deLaReferencia.unidad, deLaLeccion.unidad);
  }

  if (deLaReferencia.unidad !== null) return false;

  return !(CON_SEPARADOR_DE_MILES.test(deLaLeccion.escrito) && ANIO.test(deLaReferencia.escrito.trim()));
}

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
  const encontradas: Candidato[] = [];

  /**
   * Las comillas se emparejan de izquierda a derecha, y un par se consume
   * ENTERO antes de buscar el siguiente.
   *
   * Con una expresión regular sola, un par demasiado corto para contar dejaba
   * su comilla de CIERRE libre, y la búsqueda arrancaba ahí y la emparejaba con
   * la apertura del par siguiente. Medido: en `" Tarde " en vez de "Tarde"` el
   * primer par tiene siete caracteres, así que la «cita» reportada fue
   * «en vez de» — el texto que está justamente AFUERA de las comillas.
   */
  const CIERRES: Record<string, string> = { '«': '»', '“': '”"', '"': '"”' };
  let i = 0;

  while (i < texto.length) {
    const cierres = CIERRES[texto[i]];

    if (!cierres) {
      i += 1;
      continue;
    }

    let fin = -1;

    for (let j = i + 1; j < texto.length; j += 1) {
      if (cierres.includes(texto[j])) {
        fin = j;
        break;
      }
    }

    // Una comilla que no cierra no es una cita: se saltea y se sigue buscando.
    // Cortar acá —como hacía— apagaba el chequeo de citas para el resto de la
    // lección con una sola comilla recta suelta (una pulgada, «24"», o el signo
    // explicado en el texto), y dejaba pasar la «sección» inventada de después.
    if (fin === -1) {
      i += 1;
      continue;
    }

    const dentro = texto.slice(i + 1, fin);
    const valor = dentro.trim();

    // Sólo lo que tiene forma de NOMBRE de algo —una sección, un programa, un
    // título—, no una frase entre comillas.
    //
    // Medido: de catorce hallazgos en una sección, tres eran parlamentos
    // inventados dentro de un ejemplo de rol («Llevate este látex interior de 4
    // litros…»), que es justamente lo que una lección tiene que poder escribir.
    // Las citas que sí importaban eran cortas y eran nombres: la lección
    // remitía a una sección «SOBRE NOSOTROS» que en la fuente se llama de otra
    // manera, y el lector que va a verificar no encuentra nada.
    const cuenta =
      dentro.length >= 8 &&
      dentro.length <= 90 &&
      !/[«»"“”]/.test(dentro) &&
      valor.split(/\s+/).length <= MAX_PALABRAS_CITA;

    if (cuenta) encontradas.push({ valor, indice: i + 1 + dentro.indexOf(valor) });

    i = fin + 1;
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
  /**
   * La lección entera, CON lo marcado adentro, aplanada igual que `texto`.
   *
   * Sirve sólo para una cosa: saber qué palabras la lección escribe también en
   * minúscula. Se calculaba sobre `texto`, que ya viene sin lo marcado, y eso
   * se medía mal: en una lección, la única «rubro» en minúscula quedó adentro de
   * un `<li>` marcado como ejemplo, y «Rubro» en mayúscula pasó a leerse como
   * un nombre propio sin respaldo — el constructor terminó cambiándolo por
   * «Categoría». Los candidatos se siguen sacando de `texto`: lo marcado ya
   * está declarado y no se vuelve a contar.
   */
  textoCompleto?: string;
  /** Dónde más buscar lo que no está en `fuentes`. Ver `RespaldoAmpliado`. */
  ampliacion?: ReferenciasAmpliadas;
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
  const conBordes = (textoPlano: string) => ` ${normalizar(textoPlano)} `;
  const materialConBordes = ` ${material} `;
  const apareceEn = (donde: string, valor: string) => donde.includes(` ${normalizar(valor)} `);
  const apareceEnFuente = (valor: string) => apareceEn(materialConBordes, valor);

  /**
   * Los números de la fuente, como conjunto exacto de VALORES.
   *
   * Buscarlos como subcadena del texto daba un falso NEGATIVO silencioso: la
   * fuente traía un teléfono «4555 7000» y la lección afirmaba «45 °C», que
   * pasaba porque «45» está dentro de «4555». Un chequeo de datos que se rompe
   * justo con los datos es peor que no tenerlo, así que se comparan números
   * contra números y no cadenas contra cadenas — y por valor, no por dígitos:
   * «1.048.576» es «1,048,576», y «150.50» no es «15050». Ver `CIFRA`.
   */
  const numerosDeLaFuente = numerosDe(crudo);

  /**
   * El alcance ampliado, preparado una sola vez.
   *
   * Los nombres y las citas se buscan como en las fuentes de la lección. Los
   * números, por valor Y unidad: ver `UNIDADES_EQUIVALENTES`, donde está medido
   * por qué ampliar comparando sólo dígitos dejaría pasar los inventos.
   */
  const ampliadas = (['pedido', 'plan', 'curso'] as const)
    .map((respaldo) => {
      const ampliacion = params.ampliacion;
      const textoDeReferencia =
        respaldo === 'curso'
          ? (ampliacion?.curso ?? []).map((f) => f.text).join(' ')
          : (ampliacion?.[respaldo] ?? '');

      return { respaldo, texto: textoDeReferencia };
    })
    .filter((referencia) => referencia.texto.trim().length > 0)
    .map((referencia) => ({
      respaldo: referencia.respaldo,
      conBordes: conBordes(referencia.texto),
      numeros: numerosConUnidad(referencia.texto)
    }));

  const respaldoDeNombre = (valor: string): RespaldoAmpliado | undefined =>
    ampliadas.find((referencia) => apareceEn(referencia.conBordes, valor))?.respaldo;

  const respaldoDeNumero = (deLaLeccion: {
    valor: string;
    unidad: string | null;
    escrito: string;
  }): RespaldoAmpliado | undefined =>
    ampliadas.find((referencia) => referencia.numeros.some((n) => respaldaAlNumero(n, deLaLeccion)))?.respaldo;

  /**
   * Las palabras que la lección escribe TAMBIÉN en minúscula.
   *
   * Es la regla que separa un nombre de una palabra común sin necesitar un
   * diccionario. «Servicio», «Calidad», «Cobertura» aparecían marcadas por
   * encabezar una viñeta en negrita, y la misma lección dice «vocación de
   * servicio» y «radio de cobertura» dos párrafos más arriba: si el texto la
   * usa en minúscula, la mayúscula era del formato, no del nombre. Una marca
   * inventada como «Arlux» nunca aparece en minúscula, y por eso sobrevive.
   *
   * Sobre la lección ENTERA (`textoCompleto`), marcados incluidos: ver ahí.
   */
  const enMinuscula = new Set(
    [...(params.textoCompleto ?? texto).matchAll(/(?<!\p{L})(\p{Ll}[\p{L}]*)/gu)]
      .map((m) => normalizar(m[1]))
      .filter(Boolean)
  );

  const diagramas = tramosDeDiagrama(texto);
  const hallazgos: HallazgoDeToken[] = [];
  const registrados: string[] = [];

  function registrar(
    tipo: TipoDeHallazgo,
    valor: string,
    indice: number,
    extra: { respaldo?: RespaldoAmpliado; soloInforme?: boolean } = {}
  ) {
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
      enDiagrama: diagramas.some(([desde, hasta]) => indice >= desde && indice < hasta),
      ...(extra.respaldo ? { respaldo: extra.respaldo, rotulo: ROTULO_DE_RESPALDO[extra.respaldo] } : {}),
      ...(extra.soloInforme ? { soloInforme: true } : {})
    });
  }

  for (const m of texto.matchAll(NUMERO)) {
    const escrito = m.groups?.cifra ?? m[0];
    const unidad = m.groups?.unidad;
    const indice = m.index ?? 0;
    const valor = valorDeCifra(escrito);

    // La magnitud respeta el decimal: «150.50» es un precio de ciento
    // cincuenta, no un dato de quince mil. Con los dígitos pelados, todo precio
    // con centavos pasaba el umbral y rebotaba («950,00», «25,00»).
    const magnitud = Number.parseFloat(valor);

    const esDato = Boolean(unidad) || (Number.isFinite(magnitud) && magnitud >= MAGNITUD_MINIMA);
    if (!esDato) continue;

    if (numerosDeLaFuente.valores.has(valor)) continue;

    /**
     * Un teléfono no se escribe igual en los dos lados.
     *
     * La lección pone «+54 9 362 4545151» y la fuente lo trae pegado dentro de
     * un enlace, «5493624545151». Son el mismo número y marcarlo sería acusar a
     * la lección de inventar el teléfono que copió bien. Por eso un número
     * largo también vale si es parte de un número de la fuente — largo, para
     * que «45» no se cuele dentro de un «4555» cualquiera, que es exactamente
     * el falso negativo que este chequeo ya tuvo una vez. Sólo enteros: un
     * decimal no es un pedazo de un teléfono.
     */
    const digitos = soloDigitos(escrito);
    const esParteDeUnoDeLaFuente =
      !valor.includes('.') &&
      digitos.length >= 5 &&
      [...numerosDeLaFuente.digitos].some((n) => n.length > digitos.length && n.includes(digitos));

    if (esParteDeUnoDeLaFuente) continue;

    registrar('numero', unidad ? `${escrito} ${unidad}` : escrito, indice, {
      respaldo: respaldoDeNumero({ valor, unidad: unidad ? unidadCanonica(unidad) : null, escrito })
    });
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

    registrar('nombre', nombre, candidato.indice + candidato.valor.indexOf(nombre), {
      respaldo: respaldoDeNombre(candidato.valor) ?? respaldoDeNombre(nombre)
    });
  }

  for (const candidato of extraerCitas(texto)) {
    const buscado = normalizar(candidato.valor);

    if (buscado.length < 8) continue;
    if (apareceEnFuente(buscado)) continue;

    registrar('cita', candidato.valor, candidato.indice, {
      respaldo: respaldoDeNombre(candidato.valor),
      // Una cita que arranca en minúscula es una frase, no el nombre de algo:
      // va al informe y no al modelo. Ver `HallazgoDeToken.soloInforme`.
      soloInforme: /^\p{Ll}/u.test(candidato.valor)
    });
  }

  // Lo que no está en ningún lado va primero: es lo que importa, y el tope no
  // puede dejarlo afuera por lo que sí estaba en el pedido o en otra fuente.
  const ordenados = [...hallazgos.filter((h) => !h.respaldo), ...hallazgos.filter((h) => h.respaldo)];

  return Number.isFinite(tope) ? ordenados.slice(0, tope) : ordenados;
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
 *
 * Y tampoco va lo que ya tiene dueño: lo que figura en el pedido, el plan u
 * otra fuente del curso (no es un invento), las citas en minúscula (son frases,
 * no nombres) y lo que el escritor ya decidió mantener. Todo eso queda en el
 * informe, con su rótulo, para la docente.
 */
export function vaAlModelo(hallazgo: HallazgoDeToken): boolean {
  if (hallazgo.respaldo || hallazgo.soloInforme || hallazgo.decision === 'mantener') return false;

  return hallazgo.tipo === 'numero' || !hallazgo.enDiagrama;
}

/**
 * Los hallazgos tal como los lee el modelo: «valor» (bloque) — contexto.
 *
 * Con el contexto y no pelados. Un aviso que dice sólo «4471» lo manda a buscar
 * el número por toda la lección; con el tramo que lo rodea sabe cuál de los tres
 * párrafos tiene que tocar, y puede decidir en el acto si es un ejemplo suyo o
 * un dato que creyó copiar. Con el bloque, además, la herramienta que lo marca
 * (`replace_lesson_block`) ya tiene el id que necesita.
 */
export function redactarTokens(hallazgos: HallazgoDeToken[], tope = MAX_TOKENS_AL_MODELO): string[] {
  return hallazgos
    .filter(vaAlModelo)
    .slice(0, tope)
    .map(
      (hallazgo) =>
        `«${hallazgo.valor}»${hallazgo.blockId ? ` (block ${hallazgo.blockId})` : ''} — ${hallazgo.contexto}`
    );
}
