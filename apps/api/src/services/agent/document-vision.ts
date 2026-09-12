import { generateText } from 'ai';
import { AIProvider, createModel, getProviderConfigForProvider } from '@cio/ai-assistant';

/**
 * Leer un documento MIRÁNDOLO, cuando extraerle el texto no alcanzó.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `pdf-parse` sólo saca la capa de texto. Un organigrama, un diagrama de
 * proceso, una tabla escaneada o cualquier PowerPoint exportado a PDF son
 * IMÁGENES: la extracción devuelve casi nada y nadie se entera.
 *
 * Pasó en producción y es el caso que motivó esto. De un archivo llamado
 * "Organigrama actual.pptx.pdf" se extrajeron 104 caracteres — la frase
 * "ASESORES DE CAPITAL HUMANO" repetida tres veces. Y el paquete de fuentes se
 * lo pasó al modelo etiquetado como `full text`, o sea afirmándole que ese era
 * el documento completo. El modelo no tenía forma de saber que la extracción
 * había fallado, así que construyó una sección entera sobre una jerarquía que
 * inventó, y se la presentó a los ingresantes como la estructura real de su
 * empresa.
 *
 * La lección: cuando el documento no se puede leer, avisar es el segundo mejor
 * resultado. El mejor es leerlo. Gemini lee un PDF de forma nativa —páginas
 * como imágenes incluidas— así que el arreglo es mandárselo entero en vez de
 * mandarle lo que sobrevivió al parser.
 *
 * ── Cuándo se dispara ────────────────────────────────────────────────────────
 *
 * Por dos motivos distintos, y el segundo se agregó después de medir.
 *
 * 1. **Hay muy poco texto para el tamaño del documento.** El umbral se compara
 *    CONTRA LAS PÁGINAS, no contra un total fijo: 300 caracteres son normales
 *    en un PDF de una página y son una falla evidente en uno de veinte.
 *
 * 2. **Hay texto, pero el documento es un diagrama.** Este es el caso que el
 *    umbral por cantidad no ve, y es el más traicionero de los dos: un
 *    organigrama exportado de PowerPoint normalmente SÍ trae capa de texto con
 *    todas las etiquetas de las cajas. Contando caracteres, la extracción
 *    "funcionó" — cinco mil caracteres en siete páginas pasan cómodos el piso
 *    de doscientos por página— y la visión no corre nunca. Pero lo que el
 *    modelo recibe es una PILA DE ETIQUETAS SIN JERARQUÍA: los nombres de los
 *    puestos sin quién depende de quién. Y con eso escribe un organigrama que
 *    se parece al original y no es el original, que es peor que no tener nada,
 *    porque nada se nota.
 *
 *    El nuestro pasó por visión de casualidad: esa exportación dejó 104
 *    caracteres —un pie de página— y cayó del lado del umbral por cantidad. Con
 *    la capa de texto completa habríamos tenido las palabras y la estructura
 *    equivocada, sin un solo aviso.
 */

/**
 * Caracteres por página por debajo de los cuales la extracción se considera
 * fallida.
 *
 * Una página de texto real ronda los 1.500–3.000 caracteres. 200 es un piso
 * deliberadamente generoso: sólo atrapa páginas que son casi enteramente
 * imagen, así que la visión se paga en el caso que la necesita y no en el resto.
 */
export const MIN_CHARS_PER_PAGE = 200;

/**
 * Tope de páginas que se miran. No es un límite del modelo (Gemini lee cientos)
 * sino de gasto: un PDF de 300 páginas escaneadas costaría más que el curso.
 * Por encima de esto se conserva lo que haya y se avisa.
 */
export const MAX_VISION_PAGES = 40;

/** Límite de datos en línea de la API. Por encima habría que usar Files API. */
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

/** Marca dentro del texto para que se sepa de dónde salió. Viaja a todos lados. */
export const VISION_NOTICE =
  '[Este documento no tenía texto extraíble: fue leído visualmente y transcripto abajo.]';

/**
 * La misma marca para el otro motivo, y con otro texto porque el primero seria
 * MENTIRA acá: este documento sí tenía texto extraíble. Lo que no tenía era la
 * estructura, y eso es precisamente lo que hay que decirle al modelo para que
 * sepa cuánta confianza tenerle a la jerarquía que va a leer.
 *
 * El texto de `VISION_NOTICE` no se toca: hay documentos ya guardados que lo
 * llevan, y `comoSeLeyo` los tiene que seguir reconociendo.
 */
export const VISION_NOTICE_DIAGRAMA =
  '[Este documento es un diagrama: se leyó visualmente para conservar su estructura, y se transcribió abajo.]';

/** ¿Este texto salió de mirar el documento, por cualquiera de los dos motivos? */
export function esLecturaVisual(texto: string): boolean {
  return texto.startsWith(VISION_NOTICE) || texto.startsWith(VISION_NOTICE_DIAGRAMA);
}

export type MotivoParaMirar = 'poco_texto' | 'parece_diagrama';

export type VisionDecision =
  | { leer: true; porque: MotivoParaMirar }
  | { leer: false; motivo: 'texto_suficiente' | 'sin_paginas' | 'demasiadas_paginas' | 'archivo_muy_grande' };

/**
 * Cuántos finales de oración por cada mil caracteres separan la prosa de un
 * diagrama.
 *
 * La señal es el PUNTO, no el largo de la línea, y la diferencia importa: el
 * largo de la línea depende del maquetado —una columna angosta da renglones de
 * cuarenta caracteres, igual que una etiqueta— mientras que la puntuación
 * depende de si el documento dice frases. Un texto corrido cierra una oración
 * cada cien o ciento cincuenta caracteres, o sea entre siete y diez por mil.
 * Un organigrama no cierra ninguna.
 *
 * Dos por mil es «una oración cada quinientos caracteres»: nada que se escriba
 * en prosa baja de eso, y nada que sea un diagrama lo alcanza.
 */
export const MAX_ORACIONES_POR_MIL = 2;

/**
 * Largo medio de fragmento por encima del cual hay prosa, aunque falten puntos.
 *
 * Es la segunda condición y está para acotar: un índice o una portada también
 * tienen pocos puntos, y mirarlos no aporta nada. Las dos condiciones se exigen
 * juntas.
 */
export const MAX_LARGO_MEDIO_FRAGMENTO = 45;

/** Con menos que esto no hay muestra para decidir nada. */
const MIN_FRAGMENTOS = 6;
const MIN_CARACTERES_PARA_JUZGAR = 200;

/**
 * ¿Lo que se extrajo tiene forma de diagrama y no de texto?
 *
 * Cuenta pura, sin red y sin modelo, igual que el umbral por cantidad — porque
 * lo que decide gastar en visión tiene que poder testearse en los bordes.
 */
export function pareceDiagrama(params: { textoExtraido: string; pageCount: number }): boolean {
  const texto = params.textoExtraido.trim();
  const caracteres = texto.length;

  if (caracteres < MIN_CARACTERES_PARA_JUZGAR) return false;

  const fragmentos = texto
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  if (fragmentos.length < MIN_FRAGMENTOS) return false;

  const finalesDeOracion = (texto.match(/[.!?](?=\s|$)/g) ?? []).length;
  const porMil = (finalesDeOracion * 1000) / caracteres;
  const largoMedio = fragmentos.reduce((suma, f) => suma + f.length, 0) / fragmentos.length;

  return porMil < MAX_ORACIONES_POR_MIL && largoMedio <= MAX_LARGO_MEDIO_FRAGMENTO;
}

/**
 * ¿Vale la pena mirar este documento?
 *
 * Separada de la lectura a propósito: la decisión es una cuenta pura y se puede
 * testear sin tocar la red ni gastar un centavo, que es justo lo que hace falta
 * para fijar los bordes del umbral.
 */
export function decidirSiMirar(params: {
  textoExtraido: string;
  pageCount: number | null;
  bytes: number;
}): VisionDecision {
  const { textoExtraido, pageCount, bytes } = params;

  // Sin páginas no hay contra qué comparar, y un umbral absoluto castigaría al
  // documento corto legítimo. Preferimos no gastar antes que adivinar.
  if (!pageCount || pageCount < 1) return { leer: false, motivo: 'sin_paginas' };
  if (bytes > MAX_INLINE_BYTES) return { leer: false, motivo: 'archivo_muy_grande' };
  if (pageCount > MAX_VISION_PAGES) return { leer: false, motivo: 'demasiadas_paginas' };

  const caracteres = textoExtraido.trim().length;

  if (caracteres < MIN_CHARS_PER_PAGE * pageCount) return { leer: true, porque: 'poco_texto' };

  // Hay texto de sobra y aun así hay que mirar: la cantidad dice que la
  // extracción anduvo, y la forma dice que lo que trajo son etiquetas sueltas.
  if (pareceDiagrama({ textoExtraido, pageCount })) return { leer: true, porque: 'parece_diagrama' };

  return { leer: false, motivo: 'texto_suficiente' };
}

/**
 * Lo que se le pide al modelo.
 *
 * Transcribir, no resumir: este texto ES el documento para todo lo que venga
 * después (el paquete de fuentes, la búsqueda, la lección). Un resumen acá se
 * convertiría en la única versión que existe del organigrama.
 *
 * Y la instrucción que más importa es la última: decir qué NO se pudo leer. Un
 * hueco declarado es un hueco que el docente puede llenar; un hueco tapado con
 * algo verosímil es exactamente el fallo que este archivo vino a arreglar.
 */
const INSTRUCCION = `Transcribe this document completely and faithfully.

- Write out ALL text you can see, in reading order, including text inside images, diagrams, charts, stamps and handwriting.
- For an organisation chart, a flow diagram or any boxes-and-arrows figure: render the STRUCTURE as an indented outline, so the hierarchy and the direction of each relationship survive. Name every box exactly as it is written.
- For a table: render it as a Markdown table, keeping every row and column.
- For a photo or an illustration that carries meaning: describe what it shows in one or two factual sentences.
- Do NOT summarise, do NOT interpret, do NOT add anything that is not in the document. No preamble and no closing remarks — output only the transcription.
- If part of a page is illegible or ambiguous, write [ilegible] there. Never guess a name, a number or a relationship: an explicit gap is useful, an invented one is harmful.

Reply in the language of the document.`;

export interface VisionResult {
  texto: string;
  modelo: string;
}

/**
 * Manda el PDF entero al modelo y devuelve la transcripción.
 *
 * Devuelve `null` en vez de tirar: no poder mirar un documento nunca puede
 * tumbar una subida. Quien llama se queda con lo que haya extraído el parser,
 * que es exactamente donde estábamos antes.
 */
export async function leerDocumentoConVision(params: {
  buffer: Buffer;
  mediaType: string;
  fileName: string;
  /**
   * Por qué se lo está mirando. Elige el aviso que encabeza la transcripción, y
   * ese aviso viaja con el texto a todas partes: decirle al modelo «no tenía
   * texto extraíble» sobre un documento que sí lo tenía es empezar mintiéndole.
   */
  porque?: MotivoParaMirar;
}): Promise<VisionResult | null> {
  const config = getProviderConfigForProvider(AIProvider.GOOGLE);

  if (!config) {
    console.warn('[document-vision] sin GOOGLE_API_KEY: el documento se queda con el texto extraído');
    return null;
  }

  const modelo = process.env.DOCUMENT_VISION_MODEL?.trim() || undefined;

  try {
    const { text } = await generateText({
      model: createModel({ ...config, ...(modelo ? { model: modelo } : {}) }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: INSTRUCCION },
            { type: 'file', data: params.buffer, mediaType: params.mediaType, filename: params.fileName }
          ]
        }
      ]
    });

    const transcripcion = text?.trim();

    if (!transcripcion) return null;

    const aviso = params.porque === 'parece_diagrama' ? VISION_NOTICE_DIAGRAMA : VISION_NOTICE;

    return { texto: `${aviso}\n\n${transcripcion}`, modelo: modelo ?? 'default' };
  } catch (error) {
    console.error('[document-vision] no se pudo leer el documento:', error);
    return null;
  }
}
