import type { FileUIPart } from 'ai';

/**
 * Las imágenes que el docente adjunta a un mensaje.
 *
 * Se suben apenas se eligen —con el clip, pegando o arrastrando— y el mensaje
 * lleva sólo la dirección. Mandarlas incrustadas inflaría el historial, que se
 * guarda entero en cada vuelta.
 *
 * Los límites espejan los del servidor (`chat-images.ts` y la ruta de adjuntos):
 * revisarlos acá es para decirlo en el momento, no para reemplazar aquel control.
 */

/** Lo que el modelo puede ver. Un GIF o un SVG se subirían y no se verían. */
export const TIPOS_DE_IMAGEN = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const TAMANO_MAXIMO_DE_IMAGEN = 5 * 1024 * 1024;

export const MAXIMO_DE_IMAGENES_POR_MENSAJE = 4;

export type MotivoDeRechazo = 'tipo' | 'tamano' | 'cantidad';

interface ArchivoLike {
  name: string;
  type: string;
  size: number;
}

export interface AdjuntoDeImagen {
  id: string;
  nombre: string;
  tipo: string;
  /** Dirección local (`blob:`) para la miniatura mientras sube, y después también. */
  vistaPrevia: string;
  estado: 'subiendo' | 'lista' | 'error';
  /** La dirección pública, cuando terminó de subir. */
  url?: string;
}

/** Separa lo que se puede adjuntar de lo que no, y dice por qué. */
export function revisarImagenes<T extends ArchivoLike>(
  archivos: T[],
  yaAdjuntas: number
): { aceptadas: T[]; rechazos: Array<{ archivo: T; motivo: MotivoDeRechazo }> } {
  const aceptadas: T[] = [];
  const rechazos: Array<{ archivo: T; motivo: MotivoDeRechazo }> = [];

  for (const archivo of archivos) {
    if (!(TIPOS_DE_IMAGEN as readonly string[]).includes(archivo.type)) {
      rechazos.push({ archivo, motivo: 'tipo' });
    } else if (archivo.size > TAMANO_MAXIMO_DE_IMAGEN) {
      rechazos.push({ archivo, motivo: 'tamano' });
    } else if (yaAdjuntas + aceptadas.length >= MAXIMO_DE_IMAGENES_POR_MENSAJE) {
      rechazos.push({ archivo, motivo: 'cantidad' });
    } else {
      aceptadas.push(archivo);
    }
  }

  return { aceptadas, rechazos };
}

/**
 * Las imágenes de un pegado o de algo soltado sobre el panel.
 *
 * Sólo las que son imágenes: pegar texto copiado de Word trae también una imagen
 * del texto en algunos navegadores, pero en ese caso viene con `text/plain` al
 * lado, y el docente quería pegar el texto.
 */
export function imagenesDe(datos: Pick<DataTransfer, 'files' | 'types'> | null): File[] {
  if (!datos) return [];

  const archivos = Array.from(datos.files ?? []).filter((archivo) => archivo.type.startsWith('image/'));
  const traeTexto = Array.from(datos.types ?? []).includes('text/plain');

  return traeTexto ? [] : archivos;
}

/** Lo que viaja en el mensaje: sólo las que terminaron de subir. */
export function partesDeArchivo(adjuntos: AdjuntoDeImagen[]): FileUIPart[] {
  return adjuntos.flatMap((adjunto) =>
    adjunto.estado === 'lista' && adjunto.url
      ? [{ type: 'file' as const, mediaType: adjunto.tipo, url: adjunto.url, filename: adjunto.nombre }]
      : []
  );
}

/**
 * ¿Se puede mandar?
 *
 * Una imagen sola alcanza —«¿qué le falta a esta planilla?» se entiende con la
 * foto—, pero no mientras otra sigue subiendo: saldría el mensaje sin ella.
 */
export function puedeEnviar(texto: string, adjuntos: AdjuntoDeImagen[]): boolean {
  if (adjuntos.some((adjunto) => adjunto.estado === 'subiendo')) return false;

  return texto.trim().length > 0 || adjuntos.some((adjunto) => adjunto.estado === 'lista');
}
