/**
 * La conversación oculta de fuentes: no se lista, se reusa, y borrar un chat
 * nunca borra fuentes.
 *
 * ── Qué pasaba ───────────────────────────────────────────────────────────────
 *
 * Cada fuente que se agregaba sin un chat abierto creaba una conversación
 * oculta nueva, «Fuentes del curso» (en producción, 45 vacías en 18 cursos).
 * Aparecían en el historial del chat con una papelera que borraba de un clic, y
 * `ai_chat_document` cuelga de la conversación con ON DELETE CASCADE: borrar
 * una se llevaba las fuentes que guardaba, y borrar el chat de un curso armado
 * con investigación se llevaba sus diez páginas.
 *
 * ── El arnés ─────────────────────────────────────────────────────────────────
 *
 * No hay Postgres en la corrida normal, así que la base es de mentira, pero
 * arma el mismo contexto que la de verdad en lo que importa acá:
 *   - interpreta las condiciones de drizzle (`eq`, `ne`, `and`, `or`, `isNull`,
 *     `inArray`, `jsonb_array_length`) con la semántica de SQL, incluido que
 *     `NULL <> 'x'` no es verdadero;
 *   - y sobre todo, BORRAR UNA CONVERSACIÓN BORRA SUS DOCUMENTOS, como la FK
 *     real. Sin eso, el test del borrado pasaría aunque el arreglo no existiera.
 *
 * Nombres y datos inventados.
 */
import { randomUUID } from 'node:crypto';
import { Column, getTableColumns, is, Param, SQL, StringChunk } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fila = Record<string, unknown>;

const tablas: { conversaciones: Fila[]; documentos: Fila[] } = { conversaciones: [], documentos: [] };
let reloj = 0;

/** Una marca de tiempo que avanza: el orden de creación tiene que ser el real. */
function ahora(): string {
  reloj += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, reloj)).toISOString();
}

vi.mock('@cio/db/drizzle', async () => {
  const schema = await import('@cio/db/schema');

  const filasDe = (tabla: unknown): Fila[] => {
    if (tabla === schema.aiChatConversation) return tablas.conversaciones;
    if (tabla === schema.aiChatDocument) return tablas.documentos;
    throw new Error('tabla que el arnés no conoce');
  };

  /** La clave JS de una columna de la tabla: `course_id` → `courseId`. */
  const claveDe = (tabla: unknown, columna: unknown): string => {
    const par = Object.entries(getTableColumns(tabla as never)).find(([, c]) => c === columna);
    if (!par) throw new Error('columna que no es de esta tabla');
    return par[0];
  };

  const texto = (chunk: unknown) => (chunk as StringChunk).value.join('');
  const valor = (param: unknown) => (is(param, Param) ? (param as Param).value : param);

  /** ¿La fila cumple la condición? Con la semántica de SQL para los NULL. */
  const cumple = (tabla: unknown, fila: Fila, condicion: unknown): boolean => {
    if (condicion === undefined) return true;
    if (!is(condicion, SQL)) throw new Error('condición que el arnés no sabe leer');

    const partes = (condicion as SQL).queryChunks.filter((p) => !(is(p, StringChunk) && texto(p).trim() === ''));

    if (partes.length === 1 && is(partes[0], SQL)) return cumple(tabla, fila, partes[0]);

    if (partes.length === 3 && is(partes[0], StringChunk) && texto(partes[0]) === '(' && texto(partes[2]) === ')') {
      return cumple(tabla, fila, partes[1]);
    }

    const separadores = partes.filter((p) => is(p, StringChunk)).map(texto);
    const subcondiciones = partes.filter((p) => is(p, SQL));

    if (separadores.length > 0 && separadores.every((s) => s === ' and ')) {
      return subcondiciones.every((c) => cumple(tabla, fila, c));
    }

    if (separadores.length > 0 && separadores.every((s) => s === ' or ')) {
      return subcondiciones.some((c) => cumple(tabla, fila, c));
    }

    const [a, b, c] = partes;

    if (is(a, Column) && is(b, StringChunk)) {
      const actual = fila[claveDe(tabla, a)];
      const operador = texto(b);

      if (operador === ' is null') return actual === null || actual === undefined;
      // En SQL, comparar con NULL no es verdadero ni con `=` ni con `<>`.
      if (actual === null || actual === undefined) return false;
      if (operador === ' = ') return actual === valor(c);
      if (operador === ' <> ') return actual !== valor(c);
      if (operador === ' in ') return (c as unknown[]).map(valor).includes(actual);
    }

    if (is(a, StringChunk) && texto(a) === 'jsonb_array_length(' && is(b, Column) && is(c, StringChunk)) {
      const largo = (fila[claveDe(tabla, b)] as unknown[]).length;
      const resto = texto(c).trim();

      if (resto === ') = 0') return largo === 0;
      if (resto === ') > 0') return largo > 0;
    }

    throw new Error(`condición que el arnés no sabe leer: ${partes.length} partes`);
  };

  const ordenar = (tabla: unknown, filas: Fila[], orden: unknown): Fila[] => {
    if (!orden) return filas;
    const partes = (orden as SQL).queryChunks.filter((p) => !(is(p, StringChunk) && texto(p).trim() === ''));
    const clave = claveDe(tabla, partes[0]);
    const sentido = texto(partes[1]).trim() === 'desc' ? -1 : 1;

    return [...filas].sort((x, y) => (String(x[clave]) < String(y[clave]) ? -sentido : sentido));
  };

  const proyectar = (tabla: unknown, fila: Fila, campos?: Record<string, unknown>): Fila =>
    campos
      ? Object.fromEntries(Object.entries(campos).map(([nombre, columna]) => [nombre, fila[claveDe(tabla, columna)]]))
      : { ...fila };

  function crearCliente() {
    return {
      select: (campos?: Record<string, unknown>) => ({
        from: (tabla: unknown) => {
          let condicion: unknown;
          let orden: unknown;
          let tope = Infinity;

          const consulta = {
            where: (c: unknown) => ((condicion = c), consulta),
            orderBy: (o: unknown) => ((orden = o), consulta),
            limit: (n: number) => ((tope = n), consulta),
            then: (resolver: (v: Fila[]) => unknown, rechazar: (e: unknown) => unknown) => {
              try {
                const filas = ordenar(tabla, filasDe(tabla).filter((f) => cumple(tabla, f, condicion)), orden)
                  .slice(0, tope)
                  .map((f) => proyectar(tabla, f, campos));
                return Promise.resolve(filas).then(resolver, rechazar);
              } catch (error) {
                return Promise.reject(error).then(resolver, rechazar);
              }
            }
          };

          return consulta;
        }
      }),
      insert: (tabla: unknown) => ({
        values: (valores: Fila) => {
          const creada = ahora();
          const fila: Fila =
            tabla === schema.aiChatConversation
              ? { id: randomUUID(), title: 'New conversation', messages: [], createdAt: creada, updatedAt: creada, ...valores }
              : { createdAt: creada, ...valores };

          filasDe(tabla).push(fila);

          const hecho = Promise.resolve([] as Fila[]);
          return Object.assign(hecho, {
            returning: async (campos?: Record<string, unknown>) => [proyectar(tabla, fila, campos)]
          });
        }
      }),
      update: (tabla: unknown) => ({
        set: (valores: Fila) => ({
          where: async (condicion: unknown) => {
            for (const fila of filasDe(tabla).filter((f) => cumple(tabla, f, condicion))) Object.assign(fila, valores);
          }
        })
      }),
      delete: (tabla: unknown) => ({
        where: async (condicion: unknown) => {
          const lista = filasDe(tabla);
          const borradas = lista.filter((f) => cumple(tabla, f, condicion));

          for (const fila of borradas) lista.splice(lista.indexOf(fila), 1);

          // ON DELETE CASCADE de ai_chat_document_conversation_id_fkey.
          if (tabla === schema.aiChatConversation) {
            const ids = new Set(borradas.map((f) => f.id));
            tablas.documentos = tablas.documentos.filter((d) => !ids.has(d.conversationId));
          }
        }
      })
    };
  }

  const db = {
    ...crearCliente(),
    // Una transacción de verdad a los efectos del test: si algo tira, vuelve
    // todo a como estaba.
    transaction: async <T>(trabajo: (tx: ReturnType<typeof crearCliente>) => Promise<T>): Promise<T> => {
      const antes = structuredClone(tablas);

      try {
        return await trabajo(crearCliente());
      } catch (error) {
        tablas.conversaciones = antes.conversaciones;
        tablas.documentos = antes.documentos;
        throw error;
      }
    }
  };

  return { db };
});

const { createChatConversation, deleteChatConversation, listChatConversations, SOURCES_CONVERSATION_TITLE } =
  await import('@cio/db/queries/agent/chat-history');
const { buscarFuentePorDireccion, duenoDeFuente, reemplazarFuenteWeb } = await import(
  '@cio/db/queries/agent/fuentes-del-curso'
);

const CURSO = 'curso-almacen-demo';
const OTRO_CURSO = 'curso-ferreteria-demo';
const DOCENTE = 'docente-demo';
const OTRA_DOCENTE = 'otra-docente-demo';

function conversacion(datos: Partial<Fila>): Fila {
  const creada = ahora();
  const fila = {
    id: randomUUID(),
    courseId: CURSO,
    userId: DOCENTE,
    title: 'Curso de caja',
    messages: [],
    createdAt: creada,
    updatedAt: creada,
    ...datos
  };

  tablas.conversaciones.push(fila);
  return fila;
}

function documento(conversationId: string, datos: Partial<Fila> = {}): Fila {
  const fila = {
    id: `doc-${randomUUID().slice(0, 8)}`,
    conversationId,
    courseId: CURSO,
    userId: DOCENTE,
    assetId: null,
    sourceUrl: null,
    fileName: 'manual.pdf',
    mimeType: 'application/pdf',
    text: 'Texto de la fuente',
    contentHash: 'hash',
    wordCount: 4,
    pageCount: 1,
    extractorVersion: 1,
    createdAt: ahora(),
    ...datos
  };

  tablas.documentos.push(fila);
  return fila;
}

const oculta = (datos: Partial<Fila> = {}) => conversacion({ title: SOURCES_CONVERSATION_TITLE, ...datos });

beforeEach(() => {
  tablas.conversaciones = [];
  tablas.documentos = [];
});

describe('el historial no lista las conversaciones ocultas de fuentes', () => {
  it('muestra los chats y esconde la de fuentes', async () => {
    const chat = conversacion({ title: 'Curso de caja' });
    oculta();
    oculta();

    const lista = await listChatConversations(CURSO, DOCENTE);

    expect(lista.map((c) => c.id)).toEqual([chat.id]);
  });

  it('una conversación sin título sigue apareciendo (en SQL, NULL <> x no es verdadero)', async () => {
    const sinTitulo = conversacion({ title: null });

    expect((await listChatConversations(CURSO, DOCENTE)).map((c) => c.id)).toEqual([sinTitulo.id]);
  });

  it('una «de fuentes» donde se conversó es un chat de verdad, y se lista', async () => {
    // El panel abría la última conversación de la lista, que podía ser ésta:
    // con el título viejo quedó una así en producción, con 24 mensajes.
    const conversada = oculta({ messages: [{ role: 'user', parts: [] }] });

    expect((await listChatConversations(CURSO, DOCENTE)).map((c) => c.id)).toEqual([conversada.id]);
  });

  it('sigue siendo de esta persona en este curso', async () => {
    conversacion({ userId: OTRA_DOCENTE });
    conversacion({ courseId: OTRO_CURSO });

    expect(await listChatConversations(CURSO, DOCENTE)).toEqual([]);
  });
});

describe('la conversación de fuentes se reusa', () => {
  it('pedirla dos veces devuelve la misma', async () => {
    const primera = await createChatConversation(CURSO, DOCENTE, SOURCES_CONVERSATION_TITLE);
    const segunda = await createChatConversation(CURSO, DOCENTE, SOURCES_CONVERSATION_TITLE);

    expect(segunda.id).toBe(primera.id);
    expect(tablas.conversaciones).toHaveLength(1);
  });

  it('con varias de antes, todas las altas van a la más vieja', async () => {
    const vieja = oculta();
    oculta();

    expect((await createChatConversation(CURSO, DOCENTE, SOURCES_CONVERSATION_TITLE)).id).toBe(vieja.id);
  });

  it('no reusa la de otra persona ni la de otro curso', async () => {
    oculta({ userId: OTRA_DOCENTE });
    oculta({ courseId: OTRO_CURSO });

    const propia = await createChatConversation(CURSO, DOCENTE, SOURCES_CONVERSATION_TITLE);

    expect(tablas.conversaciones).toHaveLength(3);
    expect(tablas.conversaciones.find((c) => c.id === propia.id)).toMatchObject({ courseId: CURSO, userId: DOCENTE });
  });

  it('un chat nuevo sigue siendo nuevo cada vez', async () => {
    await createChatConversation(CURSO, DOCENTE, 'Curso de caja');
    await createChatConversation(CURSO, DOCENTE, 'Curso de caja');

    expect(tablas.conversaciones).toHaveLength(2);
  });
});

describe('borrar un chat nunca borra fuentes', () => {
  it('las fuentes del chat se mudan a la conversación de fuentes y el chat se borra', async () => {
    const fuentes = oculta();
    const chat = conversacion({ title: 'Curso armado con investigación' });
    const paginas = [documento(chat.id as string), documento(chat.id as string)];

    await deleteChatConversation(chat.id as string, DOCENTE);

    expect(tablas.conversaciones.map((c) => c.id)).toEqual([fuentes.id]);
    expect(tablas.documentos.map((d) => d.id).sort()).toEqual(paginas.map((d) => d.id).sort());
    expect(tablas.documentos.every((d) => d.conversationId === fuentes.id)).toBe(true);
  });

  it('si no había conversación de fuentes, la crea', async () => {
    const chat = conversacion({});
    const fuente = documento(chat.id as string);

    await deleteChatConversation(chat.id as string, DOCENTE);

    expect(tablas.conversaciones).toHaveLength(1);
    expect(tablas.conversaciones[0]).toMatchObject({ title: SOURCES_CONVERSATION_TITLE, courseId: CURSO, userId: DOCENTE });
    expect(tablas.documentos).toEqual([expect.objectContaining({ id: fuente.id, conversationId: tablas.conversaciones[0].id })]);
  });

  it('borrar la propia conversación de fuentes tampoco pierde lo que guardaba', async () => {
    // El caso del historial: una «Fuentes del curso» vacía con una papelera.
    const fuentes = oculta();
    const manual = documento(fuentes.id as string);

    await deleteChatConversation(fuentes.id as string, DOCENTE);

    expect(tablas.documentos).toEqual([expect.objectContaining({ id: manual.id })]);
    expect(tablas.documentos[0].conversationId).not.toBe(fuentes.id);
    expect(tablas.conversaciones.find((c) => c.id === tablas.documentos[0].conversationId)).toMatchObject({
      title: SOURCES_CONVERSATION_TITLE
    });
  });

  it('un chat sin fuentes se borra sin crear nada', async () => {
    const chat = conversacion({});

    await deleteChatConversation(chat.id as string, DOCENTE);

    expect(tablas.conversaciones).toEqual([]);
  });

  it('la conversación de otra persona no se toca', async () => {
    const ajena = conversacion({ userId: OTRA_DOCENTE });
    const suya = documento(ajena.id as string, { userId: OTRA_DOCENTE });

    await deleteChatConversation(ajena.id as string, DOCENTE);

    // La misma conversación, no otra que la reemplace, y su fuente ahí.
    expect(tablas.conversaciones.map((c) => c.id)).toEqual([ajena.id]);
    expect(tablas.documentos).toEqual([expect.objectContaining({ id: suya.id, conversationId: ajena.id })]);
  });
});

describe('la fuente web por su dirección', () => {
  const PAGINA = 'https://ayuda.ejemplo.test/articulos/arqueo';

  it('la encuentra por cualquiera de las formas de la dirección', async () => {
    const chat = conversacion({});
    const propia = documento(chat.id as string, { sourceUrl: PAGINA });

    expect((await buscarFuentePorDireccion(CURSO, ['https://Ayuda.Ejemplo.test/articulos/arqueo', PAGINA]))?.id).toBe(
      propia.id
    );
    expect(await buscarFuentePorDireccion(CURSO, ['https://otra.ejemplo.test/'])).toBeNull();
    expect(await buscarFuentePorDireccion(CURSO, [])).toBeNull();
  });

  it('sólo en este curso: la misma página en otro curso es otra fuente', async () => {
    const chat = conversacion({});
    const propia = documento(chat.id as string, { sourceUrl: PAGINA });
    // Más nueva a propósito: sin el curso en la consulta, ésta ganaría por orden.
    documento(chat.id as string, { courseId: OTRO_CURSO, sourceUrl: PAGINA });

    expect((await buscarFuentePorDireccion(CURSO, [PAGINA]))?.id).toBe(propia.id);
  });

  it('con duplicados de antes, devuelve la lectura más nueva', async () => {
    const chat = conversacion({});
    documento(chat.id as string, { sourceUrl: PAGINA });
    const nueva = documento(chat.id as string, { sourceUrl: PAGINA });

    expect((await buscarFuentePorDireccion(CURSO, [PAGINA]))?.id).toBe(nueva.id);
  });

  it('reemplazar cambia lo leído y conserva la fuente', async () => {
    const chat = conversacion({});
    const fuente = documento(chat.id as string, { sourceUrl: PAGINA, fileName: 'Sign-in (ayuda.ejemplo.test)' });

    await reemplazarFuenteWeb(fuente.id as string, {
      text: 'Texto nuevo',
      fileName: 'Arqueo (ayuda.ejemplo.test)',
      wordCount: 2,
      contentHash: 'hash-nuevo'
    });

    expect(tablas.documentos[0]).toMatchObject({
      id: fuente.id,
      sourceUrl: PAGINA,
      conversationId: chat.id,
      createdAt: fuente.createdAt,
      text: 'Texto nuevo',
      fileName: 'Arqueo (ayuda.ejemplo.test)',
      contentHash: 'hash-nuevo'
    });
  });

  it('dice de quién es una fuente, y nada para un borrador', async () => {
    const chat = conversacion({});
    const fuente = documento(chat.id as string);

    expect(await duenoDeFuente(fuente.id as string)).toEqual({ courseId: CURSO, userId: DOCENTE });
    expect(await duenoDeFuente('borrador-sin-fila')).toBeNull();
  });
});
