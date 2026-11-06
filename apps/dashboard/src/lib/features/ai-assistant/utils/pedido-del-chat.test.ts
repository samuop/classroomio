import { describe, expect, it } from 'vitest';

import { cuerpoDelPedido } from './pedido-del-chat';

/**
 * El panel manda el mensaje nuevo, no la conversación: la tiene el servidor.
 * Medido el 2026-11-03: 1,4 MB por pedido en una construcción, y envíos
 * cortados.
 */

const CONVERSACION = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  parts: [{ type: 'text', text: 'x'.repeat(30_000) }]
}));

describe('lo que viaja en cada pedido', () => {
  it('con conversación, sólo el último mensaje: el peso no crece con la historia', () => {
    const cuerpo = cuerpoDelPedido({
      body: { courseId: 'c', conversationId: 'conv' },
      id: 'ai-assistant',
      messages: CONVERSACION,
      trigger: 'submit-message'
    });

    expect(cuerpo.messages).toBeUndefined();
    expect(cuerpo.message).toBe(CONVERSACION.at(-1));
    expect(cuerpo).toMatchObject({ courseId: 'c', conversationId: 'conv', trigger: 'submit-message' });
    expect(JSON.stringify(cuerpo).length).toBeLessThan(40_000);
  });

  it('«Reintentar» viaja como regenerate con el pedido de la docente', () => {
    const hastaElPedido = CONVERSACION.slice(0, 39);
    const cuerpo = cuerpoDelPedido({
      body: { conversationId: 'conv' },
      id: 'ai-assistant',
      messages: hastaElPedido,
      trigger: 'regenerate-message',
      messageId: 'm39'
    });

    expect(cuerpo).toMatchObject({ trigger: 'regenerate-message', messageId: 'm39' });
    expect(cuerpo.message).toBe(hastaElPedido.at(-1));
  });

  it('sin conversación todavía, va lo que haya: del otro lado no hay nada guardado', () => {
    const primero = [CONVERSACION[0]];
    const cuerpo = cuerpoDelPedido({ body: { courseId: 'c' }, id: 'ai-assistant', messages: primero, trigger: 'submit-message' });

    expect(cuerpo.messages).toBe(primero);
    expect(cuerpo.message).toBeUndefined();
  });
});
