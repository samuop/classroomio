import { aprobacionVigente, estadoDelPlan, ultimoTurnoDelDocente } from './aprobacion';
import { TEXTO_DE_APROBACION, TEXTO_DE_CONTINUACION } from './mensajes-de-control';

/**
 * Cuándo un plan cuenta como aprobado, y qué turno reintenta «Reintentar».
 *
 * ── El caso que lo originó (datos inventados, forma real) ────────────────────
 *
 * La docente aprobó el plan y el pedido venció antes de que el servidor
 * contestara. El plan quedó «Aprobado» con la tilde verde y sin el botón de
 * aprobar, aunque no se había construido nada; después de recargar, lo mismo y
 * sin ninguna salida a la vista. Y «Reintentar» reenviaba la descripción del
 * curso que se había escrito al crearlo, no la aprobación.
 */

const plan = {
  title: 'Caja en sucursales',
  sections: [{ title: 'Apertura', order: 0, items: [{ type: 'lesson', title: 'Arqueo', description: 'x', order: 0 }] }]
};

const pedido = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Armá un curso de caja para sucursales' }] };
const conPlan = {
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'tool-generate_course_plan', toolCallId: 'call-1', state: 'output-available', output: plan }]
};
const aprobacion = {
  id: 'u2',
  role: 'user',
  parts: [{ type: 'text', text: TEXTO_DE_APROBACION }],
  metadata: { plan: { action: 'implement_course_plan', payload: plan } }
};
const construccion = (avance?: { total: number; completed: number }) => ({
  id: 'a2',
  role: 'assistant',
  parts: [{ type: 'step-start' }, { type: 'tool-create_section', state: 'output-available', output: {} }],
  ...(avance ? { metadata: { planProgress: { ...avance, pendingCount: 0, emptyCount: 0, items: [] } } } : {})
});

describe('una aprobación cuenta si tuvo respuesta', () => {
  it('con respuesta del asistente, el plan está aprobado', () => {
    const mensajes = [pedido, conPlan, aprobacion, construccion()];

    expect(aprobacionVigente(mensajes, 1, false)?.indice).toBe(2);
  });

  it('SIN respuesta y sin pedido en vuelo —falló—, el plan NO está aprobado', () => {
    // Es el caso medido: vuelve el botón de aprobar, también después de recargar.
    expect(aprobacionVigente([pedido, conPlan, aprobacion], 1, false)).toBeNull();
  });

  it('en vuelo, la última aprobación cuenta: la pantalla dice «Construyendo»', () => {
    expect(aprobacionVigente([pedido, conPlan, aprobacion], 1, true)?.indice).toBe(2);
  });

  it('el pedido en vuelo es de la ÚLTIMA: una aprobación vieja sin respuesta no revive', () => {
    const otroPedido = { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'otra cosa' }] };

    expect(aprobacionVigente([pedido, conPlan, aprobacion, otroPedido], 1, true)).toBeNull();
  });

  it('un mensaje del asistente vacío —el `start` de una ronda que se cayó— no es una respuesta', () => {
    const vacio = { id: 'a2', role: 'assistant', parts: [] };

    expect(aprobacionVigente([pedido, conPlan, aprobacion, vacio], 1, false)).toBeNull();
  });

  it('el avance medido también es una respuesta, aunque el mensaje no traiga partes', () => {
    const soloAvance = { ...construccion({ total: 4, completed: 1 }), parts: [] };

    expect(aprobacionVigente([pedido, conPlan, aprobacion, soloAvance], 1, false)?.indice).toBe(2);
  });

  it('si la última falló pero una anterior tuvo respuesta, sigue aprobado por la anterior', () => {
    const reintento = { ...aprobacion, id: 'u3' };
    const mensajes = [pedido, conPlan, aprobacion, construccion(), reintento];

    expect(aprobacionVigente(mensajes, 1, false)?.indice).toBe(2);
  });

  it('sólo cuentan las aprobaciones posteriores al plan', () => {
    expect(aprobacionVigente([aprobacion, construccion(), conPlan], 2, false)).toBeNull();
  });

  it('devuelve el plan tal como se aprobó', () => {
    expect(aprobacionVigente([pedido, conPlan, aprobacion, construccion()], 1, false)?.payload).toBe(plan);
  });
});

describe('en qué anda el plan de la conversación', () => {
  it('sin plan, nada', () => {
    expect(estadoDelPlan([pedido])).toBeNull();
  });

  it('propuesto y sin aprobar: pendiente', () => {
    expect(estadoDelPlan([pedido, conPlan])).toBe('pendiente');
  });

  it('una aprobación que falló deja el plan pendiente', () => {
    expect(estadoDelPlan([pedido, conPlan, aprobacion])).toBe('pendiente');
  });

  it('aprobado y a medio medir: construyendo', () => {
    expect(estadoDelPlan([pedido, conPlan, aprobacion, construccion({ total: 4, completed: 1 })])).toBe('construyendo');
    // Sin avance medido todavía, también.
    expect(estadoDelPlan([pedido, conPlan, aprobacion, construccion()])).toBe('construyendo');
  });

  it('medido completo: terminado', () => {
    expect(estadoDelPlan([pedido, conPlan, aprobacion, construccion({ total: 4, completed: 4 })])).toBe('terminado');
  });
});

describe('el turno que reintenta «Reintentar»', () => {
  it('es el último mensaje del docente, con su marca: la aprobación, no la descripción del curso', () => {
    const turno = ultimoTurnoDelDocente([pedido, conPlan, aprobacion]);

    expect(turno?.mensaje.id).toBe('u2');
    expect(turno?.control).toBe('aprobacion');
  });

  it('con una respuesta cortada después, sigue siendo ese mensaje', () => {
    const turno = ultimoTurnoDelDocente([pedido, conPlan, aprobacion, construccion()]);

    expect(turno?.mensaje.id).toBe('u2');
  });

  it('reconoce la continuación', () => {
    const continuar = { id: 'u4', role: 'user', parts: [{ type: 'text', text: TEXTO_DE_CONTINUACION }] };

    expect(ultimoTurnoDelDocente([pedido, conPlan, aprobacion, construccion(), continuar])?.control).toBe(
      'continuacion'
    );
  });

  it('un mensaje escrito no es un gesto', () => {
    expect(ultimoTurnoDelDocente([pedido])?.control).toBeNull();
  });

  it('sin mensajes del docente, no hay nada que reintentar', () => {
    expect(ultimoTurnoDelDocente([conPlan])).toBeNull();
  });
});
