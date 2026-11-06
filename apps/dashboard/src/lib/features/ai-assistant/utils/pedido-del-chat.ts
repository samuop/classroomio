/**
 * Lo que el panel le manda a `/agent/chat`: el mensaje nuevo, no la conversación.
 *
 * Antes el SDK mandaba la conversación ENTERA en cada pedido. Medido el
 * 2026-11-03: una conversación de construcción llegó a 1,4 MB por mensaje y los
 * envíos empezaron a cortarse. El servidor ya guarda la conversación (al
 * arrancar la ronda guarda el pedido, al terminar la ronda entera), así que
 * ahora arma la historia con lo suyo y el panel le manda sólo lo nuevo.
 *
 * Sin conversación todavía no hay nada guardado del otro lado: ahí sí va lo que
 * haya, que en un chat recién abierto es un mensaje.
 */

export type DisparoDelChat = 'submit-message' | 'regenerate-message';

export function cuerpoDelPedido<M>(params: {
  body: Record<string, unknown> | undefined;
  id: string;
  messages: M[];
  trigger: DisparoDelChat;
  messageId?: string;
}): Record<string, unknown> {
  const base = {
    ...(params.body ?? {}),
    id: params.id,
    trigger: params.trigger,
    ...(params.messageId ? { messageId: params.messageId } : {})
  };

  if (!base.conversationId) return { ...base, messages: params.messages };

  // En un «Reintentar» el SDK ya sacó la respuesta que falló: el último es el
  // pedido de la docente, que el servidor reconoce por su id.
  const ultimo = params.messages.at(-1);

  return ultimo === undefined ? base : { ...base, message: ultimo };
}
