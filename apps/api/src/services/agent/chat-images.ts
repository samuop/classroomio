/**
 * Las imágenes que el docente adjunta en el chat.
 *
 * ── Por qué no viajan en todas las vueltas ──────────────────────────────────
 *
 * Cada vuelta le reenvía al modelo el historial reciente —hasta 16 mensajes,
 * `trimMessageHistory`—, así que una imagen adjunta al principio se volvería a
 * pagar en cada pregunta que siga. Una imagen cuesta del orden de mil fichas de
 * entrada, y cinco vueltas después el docente ya no está hablando de ella.
 *
 * Sólo las últimas vueltas del docente la llevan. Las anteriores la cambian por
 * una línea que dice qué era y dónde está: el agente sabe que existió y puede
 * pedir que la vuelvan a adjuntar si necesita mirarla otra vez.
 *
 * ── Por qué va la dirección ─────────────────────────────────────────────────
 *
 * El modelo ve la imagen, no su dirección. Sin la dirección, «poné esta foto en
 * la lección» no se puede cumplir: el agente describiría la foto en vez de
 * insertarla. Es la del bucket público de medios, permanente, la misma que usan
 * las ilustraciones generadas.
 */

/** Cuántas vueltas del docente, contando desde la última, llevan sus imágenes. */
export const VUELTAS_CON_IMAGEN = 2;

/** Lo que Gemini acepta como imagen. Un GIF o un SVG se suben, pero no se ven. */
export const TIPOS_DE_IMAGEN_DEL_CHAT = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function esTipoDeImagenDelChat(tipo: string): boolean {
  return (TIPOS_DE_IMAGEN_DEL_CHAT as readonly string[]).includes(tipo);
}

interface Parte {
  type?: unknown;
  mediaType?: unknown;
  url?: unknown;
  filename?: unknown;
}

interface Mensaje {
  role?: unknown;
  parts?: unknown;
}

function esImagenAdjunta(parte: Parte): boolean {
  return (
    parte?.type === 'file' &&
    typeof parte.mediaType === 'string' &&
    parte.mediaType.startsWith('image/') &&
    typeof parte.url === 'string'
  );
}

/** Una imagen incrustada como `data:` no tiene dirección que sirva: se nombra sin ella. */
function renglon(imagen: Parte, numero: number): string {
  const nombre = typeof imagen.filename === 'string' && imagen.filename.trim() ? imagen.filename : 'image';
  const url = imagen.url as string;

  return url.startsWith('data:') ? `${numero}. "${nombre}" (embedded, no URL)` : `${numero}. "${nombre}" — ${url}`;
}

function nota(imagenes: Parte[], visibles: boolean): string {
  const lista = imagenes.map((imagen, indice) => renglon(imagen, indice + 1)).join('\n');

  return visibles
    ? `[Images the teacher attached to this message — you can see them above:\n${lista}\n` +
        'To place one in a lesson, use that exact URL as the image source.]'
    : `[Earlier in this conversation the teacher attached:\n${lista}\n` +
        'They are no longer shown to you, to keep the context small. If you need to look at one again, ask the ' +
        'teacher to attach it again. The URL still works for placing it in a lesson.]';
}

/**
 * Baja una imagen del bucket propio y la devuelve incrustada, o null.
 *
 * `redirect: 'error'`: una redirección es la forma de convertir una dirección
 * permitida en una que no lo es. El tipo se toma de la cabecera cuando es una
 * imagen y, si el almacenamiento la sirve como binario genérico, del que declaró
 * el adjunto — que la ruta de subida ya validó.
 */
export async function descargarComoDataUrl(
  url: string,
  tipoDeclarado: string,
  maxBytes: number,
  timeoutMs = 10_000
): Promise<string | null> {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });

  if (!respuesta.ok) return null;

  const cabecera = respuesta.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const tipo = esTipoDeImagenDelChat(cabecera) ? cabecera : tipoDeclarado;

  if (!esTipoDeImagenDelChat(tipo)) return null;

  const bytes = Buffer.from(await respuesta.arrayBuffer());

  if (bytes.length === 0 || bytes.length > maxBytes) return null;

  return `data:${tipo};base64,${bytes.toString('base64')}`;
}

/**
 * Las imágenes como las recibe el modelo: con sus bytes, no con su dirección.
 *
 * ── Por qué no alcanza con pasarle la dirección ─────────────────────────────
 *
 * El SDK baja por su cuenta las direcciones de las partes de archivo y niega las
 * de `localhost` y redes privadas: con el bucket local, el chat contestaba «URL
 * with hostname localhost is not allowed» (medido en dev, 2026-09-13). Esa
 * negativa es la que corresponde, porque la dirección la manda el navegador, y
 * un servidor que baja lo que le pidan le abre su red interna a cualquiera.
 *
 * Así que se bajan acá, y SÓLO si son del bucket de medios propio. Una dirección
 * de otro lado no se baja nunca: la parte se cambia por una línea que lo dice.
 * El historial guardado no se toca y sigue con la dirección pública, que es la
 * que sirve para insertar la imagen en una lección.
 */
export async function imagenesParaElModelo<T extends Mensaje>(
  mensajes: T[],
  opciones: {
    basesPermitidas: Array<string | undefined | null>;
    descargar: (url: string, tipo: string) => Promise<string | null>;
  }
): Promise<T[]> {
  const bases = opciones.basesPermitidas
    .filter((base): base is string => typeof base === 'string' && base.trim().length > 0)
    .map((base) => `${base.trim().replace(/\/+$/, '')}/`);

  const esPropia = (url: string) => bases.some((base) => url.startsWith(base));

  return Promise.all(
    mensajes.map(async (mensaje) => {
      if (mensaje?.role !== 'user' || !Array.isArray(mensaje.parts)) return mensaje;

      const partes = mensaje.parts as Parte[];

      if (!partes.some(esImagenAdjunta)) return mensaje;

      const resueltas = await Promise.all(
        partes.map(async (parte) => {
          if (!esImagenAdjunta(parte)) return parte;

          const url = parte.url as string;

          if (url.startsWith('data:')) return parte;

          const datos = esPropia(url)
            ? await opciones.descargar(url, parte.mediaType as string).catch(() => null)
            : null;

          if (datos) return { ...parte, url: datos };

          const nombre = typeof parte.filename === 'string' && parte.filename ? parte.filename : 'image';

          return { type: 'text', text: `[The image "${nombre}" could not be loaded, so you cannot see it.]` };
        })
      );

      return { ...mensaje, parts: resueltas } as T;
    })
  );
}

/**
 * El historial tal como tiene que verlo el modelo en esta vuelta.
 *
 * No toca los mensajes sin imágenes ni las partes que no son imágenes (un PDF
 * adjunto sigue su propio camino), y no muta lo que recibe: el mismo arreglo se
 * guarda después como historial de la conversación.
 */
export function prepararImagenesAdjuntas<T extends Mensaje>(mensajes: T[], vueltasConImagen = VUELTAS_CON_IMAGEN): T[] {
  const delDocente = mensajes.flatMap((mensaje, indice) => (mensaje?.role === 'user' ? [indice] : []));
  // `slice(-0)` devuelve el arreglo entero: con cero vueltas no se ve ninguna.
  const conImagen = new Set(vueltasConImagen > 0 ? delDocente.slice(-vueltasConImagen) : []);

  return mensajes.map((mensaje, indice) => {
    if (mensaje?.role !== 'user' || !Array.isArray(mensaje.parts)) return mensaje;

    const partes = mensaje.parts as Parte[];
    const imagenes = partes.filter(esImagenAdjunta);

    if (imagenes.length === 0) return mensaje;

    const visibles = conImagen.has(indice);
    const quedan = visibles ? partes : partes.filter((parte) => !esImagenAdjunta(parte));

    return { ...mensaje, parts: [...quedan, { type: 'text', text: nota(imagenes, visibles) }] } as T;
  });
}
