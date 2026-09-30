import { mensajeDeControl, TEXTO_DE_APROBACION, TEXTO_DE_CONTINUACION, textoDelMensaje } from './mensajes-de-control';

/**
 * Los gestos del docente que viajan como mensajes.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. Que los textos nuevos sean los del contrato con la API, en castellano: el
 *    servidor no los compara, pero el subagente de construcción los lee como su
 *    única orden y la docente no tiene por qué ver inglés.
 * 2. Que una conversación VIEJA —guardada con «Implement this plan.»— se siga
 *    reconociendo: está en la base y se va a volver a abrir.
 * 3. Que un mensaje escrito por la docente nunca se confunda con un gesto.
 */

const usuario = (texto: string, metadata?: unknown) => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: texto }],
  ...(metadata ? { metadata } : {})
});

describe('los textos de los gestos', () => {
  it('son los del contrato, en castellano', () => {
    expect(TEXTO_DE_APROBACION).toBe('Construí el curso según el plan aprobado.');
    expect(TEXTO_DE_CONTINUACION).toBe('Seguí construyendo el plan desde donde quedó.');
  });
});

describe('qué gesto es un mensaje', () => {
  it('la aprobación se reconoce por su marca, diga lo que diga el texto', () => {
    const aprobacion = usuario('cualquier cosa', { plan: { action: 'implement_course_plan', payload: {} } });

    expect(mensajeDeControl(aprobacion)).toBe('aprobacion');
  });

  it('la aprobación nueva y la vieja, en inglés', () => {
    expect(mensajeDeControl(usuario(TEXTO_DE_APROBACION))).toBe('aprobacion');
    expect(mensajeDeControl(usuario('Implement this plan.'))).toBe('aprobacion');
  });

  it('la continuación nueva y la vieja, en inglés', () => {
    expect(mensajeDeControl(usuario(TEXTO_DE_CONTINUACION))).toBe('continuacion');
    expect(mensajeDeControl(usuario('Continue implementing the plan from where you left off.'))).toBe('continuacion');
  });

  it('un pedido de cambios al plan NO es un gesto: lo escribió la docente', () => {
    const cambios = usuario('Sacá la lección de cierre', { plan: { action: 'request_plan_changes' } });

    expect(mensajeDeControl(cambios)).toBeNull();
  });

  it('un mensaje escrito que se parece no cuenta', () => {
    expect(mensajeDeControl(usuario('Seguí construyendo el plan desde donde quedó, pero sin examen.'))).toBeNull();
    expect(mensajeDeControl(usuario('hola'))).toBeNull();
  });

  it('sólo los mensajes del docente son gestos', () => {
    expect(mensajeDeControl({ ...usuario(TEXTO_DE_CONTINUACION), role: 'assistant' })).toBeNull();
  });

  it('tolera los bordes en blanco y las partes que no son texto', () => {
    const conImagen = {
      id: 'm2',
      role: 'user',
      parts: [{ type: 'file', url: 'https://almacen.example/a.png' }, { type: 'text', text: `  ${TEXTO_DE_CONTINUACION}\n` }]
    };

    expect(textoDelMensaje(conImagen)).toBe(TEXTO_DE_CONTINUACION);
    expect(mensajeDeControl(conImagen)).toBe('continuacion');
  });
});
