import { and, asc, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db, type DbOrTxClient } from '@db/drizzle';

const MAX_CONVERSATIONS_PER_COURSE = 50;

/**
 * Título de la conversación oculta donde cae cada fuente del curso.
 *
 * Una fuente necesita una conversación (`ai_chat_document.conversation_id` es
 * NOT NULL), y las que se agregan desde el panel de Fuentes, la investigación o
 * el asistente de creación no vienen de ningún chat: van a ésta. Vive acá, en
 * la base, porque la base la tiene que reconocer —para no listarla en el
 * historial, para reusarla en vez de abrir otra cada vez y para mudarle las
 * fuentes de un chat que se borra—, y la API la reexporta.
 *
 * Es una constante y no un literal repetido porque un error de tipeo en un solo
 * lugar abriría una SEGUNDA conversación oculta. Va en el idioma de la
 * interfaz: el panel llegó a mostrarla como nombre de conversación.
 */
export const SOURCES_CONVERSATION_TITLE = 'Fuentes del curso';

/**
 * Una conversación oculta de fuentes: ese título y ningún mensaje.
 *
 * El «ningún mensaje» es a propósito. El panel del chat, cuando no tenía una
 * conversación guardada, abría la última de la lista —que podía ser ésta— y la
 * docente conversaba adentro sin saberlo. Con el título viejo («Course
 * sources») quedó una así en producción, con 24 mensajes: ocultarla por el
 * título le borraría un chat de verdad de la lista.
 */
function esConversacionDeFuentes() {
  return and(
    eq(schema.aiChatConversation.title, SOURCES_CONVERSATION_TITLE),
    sql`jsonb_array_length(${schema.aiChatConversation.messages}) = 0`
  );
}

/**
 * Lo contrario, escrito a mano y no con un `not`: en SQL `NULL <> 'x'` no es
 * verdadero, y una conversación sin título desaparecería de la lista.
 */
function noEsConversacionDeFuentes() {
  return or(
    isNull(schema.aiChatConversation.title),
    ne(schema.aiChatConversation.title, SOURCES_CONVERSATION_TITLE),
    sql`jsonb_array_length(${schema.aiChatConversation.messages}) > 0`
  );
}

export interface ChatConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── List all conversations for a user in a course ───────────────────────────

/**
 * Los chats de una persona en un curso, sin las conversaciones ocultas de
 * fuentes.
 *
 * Aparecían en el historial como «Fuentes del curso», vacías y con una papelera
 * que borraba de un clic —y con ellas, por la cascada, las fuentes que
 * guardaban—. Medido en producción: en un curso eran 9 de 13 conversaciones, en
 * otro 7 de 7, y ahí el chat abría una vacía.
 */
export async function listChatConversations(courseId: string, userId: string): Promise<ChatConversationSummary[]> {
  try {
    const rows = await db
      .select({
        id: schema.aiChatConversation.id,
        title: schema.aiChatConversation.title,
        createdAt: schema.aiChatConversation.createdAt,
        updatedAt: schema.aiChatConversation.updatedAt
      })
      .from(schema.aiChatConversation)
      .where(
        and(
          eq(schema.aiChatConversation.courseId, courseId),
          eq(schema.aiChatConversation.userId, userId),
          noEsConversacionDeFuentes()
        )
      )
      .orderBy(desc(schema.aiChatConversation.updatedAt))
      .limit(MAX_CONVERSATIONS_PER_COURSE);

    return rows;
  } catch (error) {
    console.error('listChatConversations error:', error);
    throw new Error('Failed to list chat conversations');
  }
}

// ─── Get a single conversation with messages ─────────────────────────────────

export async function getChatConversation(conversationId: string, userId: string) {
  try {
    const [row] = await db
      .select()
      .from(schema.aiChatConversation)
      .where(and(eq(schema.aiChatConversation.id, conversationId), eq(schema.aiChatConversation.userId, userId)))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getChatConversation error:', error);
    throw new Error('Failed to fetch chat conversation');
  }
}

// ─── Create a new conversation ───────────────────────────────────────────────

/**
 * La conversación oculta de fuentes de esta persona en este curso, si ya hay
 * una. La más vieja: si quedaron varias de antes, todas las altas convergen en
 * la misma.
 */
async function buscarConversacionDeFuentes(
  cliente: DbOrTxClient,
  courseId: string,
  userId: string,
  excepto?: string
): Promise<{ id: string; title: string | null } | null> {
  const [row] = await cliente
    .select({ id: schema.aiChatConversation.id, title: schema.aiChatConversation.title })
    .from(schema.aiChatConversation)
    .where(
      and(
        eq(schema.aiChatConversation.courseId, courseId),
        eq(schema.aiChatConversation.userId, userId),
        esConversacionDeFuentes(),
        excepto ? ne(schema.aiChatConversation.id, excepto) : undefined
      )
    )
    .orderBy(asc(schema.aiChatConversation.createdAt))
    .limit(1);

  return row ?? null;
}

async function insertarConversacion(
  cliente: DbOrTxClient,
  courseId: string,
  userId: string,
  title?: string
): Promise<{ id: string; title: string | null }> {
  const [row] = await cliente
    .insert(schema.aiChatConversation)
    .values({
      courseId,
      userId,
      title: title || 'New conversation',
      messages: []
    })
    .returning({ id: schema.aiChatConversation.id, title: schema.aiChatConversation.title });

  return row;
}

/**
 * Crea una conversación. Con el título de fuentes, reusa la que ya exista.
 *
 * Cada fuente que se agregaba sin un chat abierto creaba una conversación
 * oculta nueva: medido en producción, 45 conversaciones vacías en 18 cursos. La
 * de fuentes es una por curso y persona, que es lo único que una fuente
 * necesita.
 */
export async function createChatConversation(
  courseId: string,
  userId: string,
  title?: string
): Promise<{ id: string; title: string | null }> {
  try {
    if (title === SOURCES_CONVERSATION_TITLE) {
      const existente = await buscarConversacionDeFuentes(db, courseId, userId);

      if (existente) return existente;
    }

    return await insertarConversacion(db, courseId, userId, title);
  } catch (error) {
    console.error('createChatConversation error:', error);
    throw new Error('Failed to create chat conversation');
  }
}

// ─── Save messages to a conversation ─────────────────────────────────────────

export async function saveChatMessages(conversationId: string, userId: string, messages: unknown[], title?: string) {
  try {
    const updateData: Record<string, unknown> = {
      messages,
      updatedAt: new Date().toISOString()
    };

    if (title) {
      updateData.title = title;
    }

    await db
      .update(schema.aiChatConversation)
      .set(updateData)
      .where(and(eq(schema.aiChatConversation.id, conversationId), eq(schema.aiChatConversation.userId, userId)));
  } catch (error) {
    console.error('saveChatMessages error:', error);
    throw new Error('Failed to save chat messages');
  }
}

// ─── Delete a conversation ───────────────────────────────────────────────────

/**
 * Borra una conversación sin llevarse las fuentes del curso.
 *
 * `ai_chat_document` cuelga de la conversación con ON DELETE CASCADE, así que
 * borrar un chat borraba las fuentes que se habían agregado desde él. Medido en
 * producción: borrar el chat de un curso armado con investigación se llevaba
 * sus 10 fuentes, y borrar una «Fuentes del curso» vacía del historial (un clic,
 * sin confirmación) se llevaba lo que guardaba. Una fuente es del curso, no del
 * chat donde entró.
 *
 * Antes de borrar, las fuentes de la conversación se mudan a la conversación
 * oculta de fuentes de esa persona en ese curso —otra que no sea ésta, creada
 * si falta—. Todo en una transacción: si algo falla no se borra nada.
 */
export async function deleteChatConversation(conversationId: string, userId: string) {
  try {
    await db.transaction(async (tx) => {
      const [conversacion] = await tx
        .select({ id: schema.aiChatConversation.id, courseId: schema.aiChatConversation.courseId })
        .from(schema.aiChatConversation)
        .where(and(eq(schema.aiChatConversation.id, conversationId), eq(schema.aiChatConversation.userId, userId)))
        .limit(1);

      if (!conversacion) return;

      const [conFuentes] = await tx
        .select({ id: schema.aiChatDocument.id })
        .from(schema.aiChatDocument)
        .where(eq(schema.aiChatDocument.conversationId, conversacion.id))
        .limit(1);

      if (conFuentes) {
        const destino =
          (await buscarConversacionDeFuentes(tx, conversacion.courseId, userId, conversacion.id)) ??
          (await insertarConversacion(tx, conversacion.courseId, userId, SOURCES_CONVERSATION_TITLE));

        await tx
          .update(schema.aiChatDocument)
          .set({ conversationId: destino.id })
          .where(eq(schema.aiChatDocument.conversationId, conversacion.id));
      }

      await tx
        .delete(schema.aiChatConversation)
        .where(and(eq(schema.aiChatConversation.id, conversacion.id), eq(schema.aiChatConversation.userId, userId)));
    });
  } catch (error) {
    console.error('deleteChatConversation error:', error);
    throw new Error('Failed to delete chat conversation');
  }
}

// ─── Update conversation title ───────────────────────────────────────────────

export async function updateConversationTitle(conversationId: string, userId: string, title: string): Promise<void> {
  try {
    await db
      .update(schema.aiChatConversation)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.aiChatConversation.id, conversationId), eq(schema.aiChatConversation.userId, userId)));
  } catch (error) {
    console.error('updateConversationTitle error:', error);
    throw new Error('Failed to update conversation title');
  }
}

// ─── Legacy compat (keep old exports working during migration) ───────────────

export async function getChatHistory(courseId: string, userId: string) {
  const conversations = await listChatConversations(courseId, userId);

  if (conversations.length === 0) return [];

  const latestConversation = await getChatConversation(conversations[0].id, userId);

  return (latestConversation?.messages ?? []) as unknown[];
}

export async function saveChatHistory(courseId: string, userId: string, messages: unknown[]) {
  const conversations = await listChatConversations(courseId, userId);

  if (conversations.length > 0) {
    await saveChatMessages(conversations[0].id, userId, messages);
  } else {
    const newConversation = await createChatConversation(courseId, userId);
    await saveChatMessages(newConversation.id, userId, messages);
  }
}

export async function deleteChatHistory(courseId: string, userId: string) {
  const conversations = await listChatConversations(courseId, userId);

  for (const conversation of conversations) {
    await deleteChatConversation(conversation.id, userId);
  }
}
