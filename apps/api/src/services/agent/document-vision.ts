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
 * Sólo cuando la extracción es implausible para el tamaño del documento, no en
 * cada subida: mirar cuesta plata y la enorme mayoría de los PDF traen su texto
 * perfectamente. El umbral se compara CONTRA LAS PÁGINAS, no contra un total
 * fijo: 300 caracteres son normales en un PDF de una página y son una falla
 * evidente en uno de veinte.
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

export type VisionDecision =
  | { leer: true }
  | { leer: false; motivo: 'texto_suficiente' | 'sin_paginas' | 'demasiadas_paginas' | 'archivo_muy_grande' };

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

  if (caracteres >= MIN_CHARS_PER_PAGE * pageCount) return { leer: false, motivo: 'texto_suficiente' };

  return { leer: true };
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

    return { texto: `${VISION_NOTICE}\n\n${transcripcion}`, modelo: modelo ?? 'default' };
  } catch (error) {
    console.error('[document-vision] no se pudo leer el documento:', error);
    return null;
  }
}
