/**
 * El libro de Excel de una fuente del curso, listo para consultar.
 *
 * El texto de la fuente es el mapa; el libro entero sólo está en el archivo
 * original, guardado aparte. Bajarlo y leerlo cuesta un par de segundos en una
 * planilla grande, y el asistente consulta de a varias veces seguidas (rastrear
 * un total, después ver quién usa una celda), así que el último par de libros
 * leídos queda en memoria un rato.
 */
import { getCourseSource } from '@cio/db/queries/agent';
import { bajarArchivoOriginal } from '@api/services/agent/document';

import { ConsultaDePlanilla } from './consulta';
import { LectorDeLibro } from './leer-libro';
import { esPlanilla } from './tipos';

/**
 * Cuántos libros quedan en memoria. Dos: cada uno retiene sus celdas guardadas
 * y el zip para releer filas (el archivo entero, hasta 25 MB), y la API corre
 * con 384 MB.
 */
const EN_MEMORIA = 2;
const VIGENCIA_MS = 20 * 60 * 1000;

const cache = new Map<string, { consulta: ConsultaDePlanilla; hasta: number }>();

export class FuenteQueNoEsPlanillaError extends Error {}

/**
 * La consulta de la planilla de una fuente, o un error que el modelo puede leer:
 * la fuente no es de este curso, o no es una planilla.
 */
export async function planillaDeLaFuente(documentId: string, courseId: string): Promise<{ fileName: string; consulta: ConsultaDePlanilla }> {
  const doc = await getCourseSource(documentId, courseId);

  if (!doc) throw new FuenteQueNoEsPlanillaError(`No source with id "${documentId}" belongs to this course.`);
  if (!esPlanilla(doc.mimeType)) {
    throw new FuenteQueNoEsPlanillaError(`The source "${doc.fileName}" is not an Excel workbook: read it with read_source.`);
  }

  const clave = `${documentId}:${doc.assetId ?? ''}`;
  const guardada = cache.get(clave);

  if (guardada && guardada.hasta > Date.now()) {
    // Al final de la fila: es la más reciente.
    cache.delete(clave);
    cache.set(clave, guardada);
    return { fileName: doc.fileName, consulta: guardada.consulta };
  }

  // El lector queda abierto dentro de la consulta: una fila que el libro leído
  // no guardó se relee del archivo cuando se la pide.
  const lector = await LectorDeLibro.abrir(await bajarArchivoOriginal(doc));
  const consulta = new ConsultaDePlanilla(await lector.leer(), (hoja, rect) => lector.celdasDe(hoja, rect));

  cache.set(clave, { consulta, hasta: Date.now() + VIGENCIA_MS });
  while (cache.size > EN_MEMORIA) cache.delete(cache.keys().next().value!);

  return { fileName: doc.fileName, consulta };
}

/** Para las pruebas. */
export function olvidarPlanillas(): void {
  cache.clear();
}
