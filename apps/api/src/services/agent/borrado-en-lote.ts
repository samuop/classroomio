/**
 * Un borrado grande pasa por la docente antes de ejecutarse.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Medido el 2026-11-11: ante «eliminá todo el contenido de todas las secciones
 * excepto la 1», el asistente borró ocho piezas en la misma ronda y recién
 * después preguntó algo. Borrar no tiene vuelta atrás (no hay papelera), y un
 * pedido mal entendido —«excepto la 1 y la 4» leído como «la 1»— se lleva medio
 * curso sin que la docente haya visto la lista de lo que se iba.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * 1. Una ronda borra hasta `MAX_BORRADOS_SIN_LISTA` piezas sin más trámite: el
 *    «borrá esta lección» de todos los días no cambia.
 * 2. Para borrar más, el modelo declara la lista entera con
 *    `request_bulk_delete`. Esa llamada NO borra nada: guarda la lista y le
 *    devuelve al modelo qué mostrarle a la docente.
 * 3. Lo declarado se puede borrar recién en una ronda POSTERIOR, o sea después
 *    de que la docente tuvo un turno para contestar. Si dice que no, el modelo
 *    no borra; la lista vence sola.
 *
 * El servidor no interpreta el «sí» de la docente —eso lo hace el modelo—; lo
 * que garantiza es la pausa: entre declarar un borrado grande y ejecutarlo hay
 * siempre un mensaje de ella, y sólo se ejecuta lo que estaba en la lista.
 */

/** Cuántas piezas borra una ronda sin haber declarado la lista. */
export const MAX_BORRADOS_SIN_LISTA = 3;

/** Cuánto vale una lista declarada: lo que tarda una docente en contestar, no un día. */
const VIGENCIA_EN_SEGUNDOS = 30 * 60;

/** Lo que este módulo necesita de Redis; así los tests no levantan uno. */
export interface AlmacenDeListas {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, opciones: { EX: number }): Promise<unknown>;
}

const clave = (conversationId: string) => `agent:borrado:conversation:${conversationId}`;

export interface BorradoEnLote {
  /** Declara la lista: no borra nada, y lo declarado no se puede borrar en esta misma ronda. */
  declarar(ids: readonly string[]): Promise<void>;
  /**
   * Pide permiso para borrar una pieza. Si lo da, la cuenta como borrada: hay
   * que llamarlo justo antes de borrar, no para averiguar.
   */
  pedirPermiso(id: string): Promise<{ ok: true } | { ok: false; motivo: string }>;
}

const MOTIVO_SIN_LISTA = `This round already deleted ${MAX_BORRADOS_SIN_LISTA} items, the most a round may delete without the teacher confirming the full list. Nothing else was deleted. Call request_bulk_delete ONCE with every remaining item you intend to delete, show the teacher that list, and stop. Delete them in your next round, after the teacher answers.`;

const MOTIVO_RECIEN_DECLARADA =
  'You declared this bulk delete in THIS round: the teacher has not seen the list yet. Nothing was deleted. Show the teacher the list request_bulk_delete returned, ask them to confirm, and stop. Delete in your next round, after they answer.';

/**
 * El estado del borrado para UNA ronda.
 *
 * @param almacen Redis, o nada: sin él (o sin conversación) no hay dónde guardar
 *   una lista entre rondas, y la ronda queda con el tope y nada más.
 */
export function crearBorradoEnLote(params: {
  almacen?: AlmacenDeListas | null;
  conversationId?: string | null;
}): BorradoEnLote {
  const { almacen, conversationId } = params;
  const dondeGuardar = almacen && conversationId ? { almacen, clave: clave(conversationId) } : null;

  let sinLista = 0;
  let declaradaEnEstaRonda = false;
  /** Lo que una ronda anterior declaró. Se lee una vez, al primer borrado. */
  let pendientes: Promise<Set<string>> | null = null;

  const leerPendientes = (): Promise<Set<string>> => {
    pendientes ??= (async () => {
      if (!dondeGuardar) return new Set<string>();

      try {
        const crudo = await dondeGuardar.almacen.get(dondeGuardar.clave);
        const ids: unknown = crudo ? JSON.parse(crudo) : [];

        return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
      } catch {
        // Sin la lista, la ronda queda con el tope: falla hacia no borrar.
        return new Set<string>();
      }
    })();

    return pendientes;
  };

  return {
    async declarar(ids) {
      // Lo que quedara de una lista anterior se descarta: vale la última.
      pendientes = Promise.resolve(new Set<string>());
      declaradaEnEstaRonda = true;

      if (dondeGuardar) {
        await dondeGuardar.almacen.set(dondeGuardar.clave, JSON.stringify([...new Set(ids)]), {
          EX: VIGENCIA_EN_SEGUNDOS
        });
      }
    },

    async pedirPermiso(id) {
      // Declarar y borrar en la misma ronda es justo lo que la regla impide: ni
      // lo declarado ni «tres más de yapa» hasta que la docente conteste.
      if (declaradaEnEstaRonda) return { ok: false, motivo: MOTIVO_RECIEN_DECLARADA };

      const declarados = await leerPendientes();

      // De acá para abajo no hay `await`: dos borrados mandados a la vez no
      // pueden contar los dos como «el tercero».
      if (declaradaEnEstaRonda) return { ok: false, motivo: MOTIVO_RECIEN_DECLARADA };

      if (declarados.has(id)) {
        declarados.delete(id);

        return { ok: true };
      }

      if (sinLista < MAX_BORRADOS_SIN_LISTA) {
        sinLista += 1;

        return { ok: true };
      }

      return { ok: false, motivo: MOTIVO_SIN_LISTA };
    }
  };
}
