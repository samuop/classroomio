import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import type { MapaDelCurso } from '@api/services/agent/manijas';

/**
 * Los enlaces que el agente escribe en el chat, resueltos por el servidor.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22: TRES UUIDs inventados en los enlaces de un solo
 * resumen (`@[Escalamiento](lesson:63f84ceb-…)`). No es descuido: desde que las
 * herramientas devuelven MANIJAS y ya casi no devuelven ids, el modelo no tiene
 * de dónde copiar un UUID — y cuando el formato del enlace le pide uno, lo
 * inventa. El servidor lo registraba («enlace a contenido inexistente») y
 * guardaba el texto con el id malo igual.
 *
 * ── El arreglo ───────────────────────────────────────────────────────────────
 *
 * Que el enlace acepte lo que el modelo SÍ tiene: `@[Título](lesson:S1.L1)`. El
 * servidor lo traduce a UUID antes de que el texto salga. Y para los ids que
 * igual se inventen, dos escalones más:
 *
 * - si el título nombra exactamente una pieza de ese tipo, el enlace va a ésa
 *   (es la misma reparación que el dashboard ya hace al dibujar, hecha acá para
 *   que también quede bien lo que se guarda);
 * - si no, el enlace se degrada a TEXTO PLANO. Un enlace que no lleva a ningún
 *   lado le miente al docente dos veces: le promete una pieza y le rompe el
 *   clic. El título suelto no promete nada.
 */

/** Una pieza enlazable del curso, como la devuelve `getCourseContentItems`. */
export interface PiezaEnlazable {
  id: string;
  /** `LESSON` / `lesson` / `EXERCISE`…: llega en los dos vocabularios. */
  type: string;
  title: string | null;
}

export type TipoDeEnlace = 'lesson' | 'exercise' | 'section';

/**
 * El mismo formato que lee el dashboard, con una diferencia: acá el id puede
 * traer PUNTOS, porque una manija los tiene (`S1.L1`). El dashboard no los
 * acepta, y por eso un enlace por manija que llegara sin traducir se vería como
 * texto crudo en vez de como enlace.
 */
const ENLACE = /@\[([^\]]+)\]\((lesson|exercise|section):([A-Za-z0-9_.-]+)\)/gi;

/** Lo que hay que retener cuando un enlace podría estar empezando en el borde de un trozo. */
export const INICIO_DE_ENLACE = /@\[[^\]]*(?:\]\([^)]*)?$/;

/** Misma normalización que el dashboard: si difirieran, una repararía donde la otra no. */
function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface EnlaceReparado {
  tipo: TipoDeEnlace;
  titulo: string;
  /** Lo que el modelo escribió. */
  escrito: string;
  /** `handle` si era una manija, `title` si se reparó por título, `dropped` si quedó en texto plano. */
  como: 'handle' | 'title' | 'dropped';
}

/**
 * Traduce cada enlace del texto a un id real del curso, o lo deja en texto plano.
 *
 * Devuelve también qué pasó con cada uno, para poder MEDIRLO: sin eso, no hay
 * forma de saber si el prompt de las manijas sirvió o si lo único que cambió es
 * que ahora el servidor tapa los inventos.
 */
export function repararEnlaces(
  texto: string,
  curso: { mapa: MapaDelCurso; items: readonly PiezaEnlazable[] }
): { texto: string; cambios: EnlaceReparado[] } {
  if (!texto.includes('@[')) return { texto, cambios: [] };

  const cambios: EnlaceReparado[] = [];

  const resuelto = texto.replace(ENLACE, (completo, titulo: string, tipoCrudo: string, valor: string) => {
    const tipo = tipoCrudo.toLowerCase() as TipoDeEnlace;
    const item = curso.items.find((pieza) => pieza.id === valor);

    // Un id de verdad, del tipo que dice: no se toca nada.
    if (item && item.type.toLowerCase() === tipo) return completo;

    const porManija = curso.mapa.idPorManija.get(valor.toUpperCase());

    if (porManija && porManija.tipo === tipo) {
      cambios.push({ tipo, titulo, escrito: valor, como: 'handle' });

      return `@[${titulo}](${tipo}:${porManija.id})`;
    }

    // El id no es de nada conocido: se repara por título, como hace el
    // dashboard al dibujar. Dos piezas con el mismo título serían una adivinanza
    // en cualquier caso, así que no se adivina.
    const buscado = normalizarTitulo(titulo);
    const coincidencias = buscado
      ? curso.items.filter(
          (pieza) => pieza.type.toLowerCase() === tipo && normalizarTitulo(pieza.title ?? '') === buscado
        )
      : [];

    if (coincidencias.length === 1) {
      cambios.push({ tipo, titulo, escrito: valor, como: 'title' });

      return `@[${titulo}](${tipo}:${coincidencias[0].id})`;
    }

    cambios.push({ tipo, titulo, escrito: valor, como: 'dropped' });

    return titulo;
  });

  return { texto: resuelto, cambios };
}

/**
 * Hasta dónde se puede emitir de lo acumulado sin partir un enlace.
 *
 * El texto llega en trozos y un `@[Título](lesson:S1.L1)` puede caer en tres de
 * ellos. Emitir el trozo suelto haría que la traducción no lo viera nunca, así
 * que se retiene desde el último `@[` que todavía no cerró. Lo demás sale al
 * instante: el docente sigue viendo la respuesta escribirse.
 */
export function cortarEnElBorde(acumulado: string): { listo: string; pendiente: string } {
  const abierto = acumulado.search(INICIO_DE_ENLACE);

  if (abierto === -1) return { listo: acumulado, pendiente: '' };

  return { listo: acumulado.slice(0, abierto), pendiente: acumulado.slice(abierto) };
}

export interface CursoParaEnlaces {
  mapa: MapaDelCurso;
  items: readonly PiezaEnlazable[];
}

/** Lo mínimo de una parte del stream del AI SDK que esto mira. */
type ParteDeTexto = { type: string; id?: string; text?: string };

/**
 * La traducción, aplicada al texto MIENTRAS sale.
 *
 * Tiene que ser acá y no al guardar: el texto del asistente viaja en streaming
 * al panel y lo guarda el dashboard, así que un arreglo posterior llegaría
 * después de que el docente ya vio (y clickeó) el enlace roto.
 *
 * El curso se carga una sola vez y recién en el primer enlace: la enorme
 * mayoría de las rondas no escribe ninguno, y cobrarles dos consultas por si
 * acaso sería pagar por nada.
 */
export function transformarEnlacesDelChat(
  cargarCurso: () => Promise<CursoParaEnlaces>,
  alReparar?: (cambios: EnlaceReparado[]) => void
): StreamTextTransform<ToolSet> {
  return () => {
    /** Lo retenido de cada bloque de texto: un enlace puede caer partido en tres trozos. */
    const pendientePorId = new Map<string, string>();
    let curso: Promise<CursoParaEnlaces> | null = null;

    type Parte = TextStreamPart<ToolSet>;

    const emitir = async (
      controller: TransformStreamDefaultController<Parte>,
      plantilla: ParteDeTexto,
      texto: string
    ): Promise<void> => {
      if (!texto) return;

      let salida = texto;

      if (texto.includes('@[')) {
        try {
          curso ??= cargarCurso();
          const reparado = repararEnlaces(texto, await curso);

          salida = reparado.texto;
          if (reparado.cambios.length > 0) alReparar?.(reparado.cambios);
        } catch (error) {
          // Falla abierto: un enlace sin traducir es un defecto; una respuesta
          // que se corta a la mitad porque no se pudo leer la estructura, uno
          // peor.
          console.error('[enlaces-del-chat] no se pudo resolver los enlaces del mensaje:', error);
        }
      }

      controller.enqueue({ ...plantilla, text: salida } as unknown as Parte);
    };

    const volcarRetenido = async (controller: TransformStreamDefaultController<Parte>): Promise<void> => {
      for (const [id, resto] of [...pendientePorId]) {
        pendientePorId.delete(id);
        await emitir(controller, { type: 'text-delta', ...(id ? { id } : {}) }, resto);
      }
    };

    return new TransformStream<Parte, Parte>({
      async transform(chunk, controller) {
        const parte = chunk as unknown as ParteDeTexto;

        if (parte.type === 'text-delta' && typeof parte.text === 'string') {
          const id = parte.id ?? '';
          const { listo, pendiente } = cortarEnElBorde((pendientePorId.get(id) ?? '') + parte.text);

          pendientePorId.set(id, pendiente);
          await emitir(controller, parte, listo);

          return;
        }

        // Lo retenido sale ANTES de cualquier marca de cierre: una parte de
        // texto emitida después de su `text-end` llegaría fuera de lugar.
        if (parte.type === 'text-end' || parte.type === 'finish' || parte.type === 'abort' || parte.type === 'error') {
          await volcarRetenido(controller);
        }

        controller.enqueue(chunk);
      },
      async flush(controller) {
        await volcarRetenido(controller);
      }
    });
  };
}
