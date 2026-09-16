import { armarMensajeInicial, type DatosDelMensaje } from './mensaje-inicial';
import { describe, expect, it } from 'vitest';

/**
 * El mensaje con el que arranca el asistente.
 *
 * Es todo lo que el formulario de creación produce: si un dato no entra acá, el
 * asistente no lo tiene y vuelve a preguntarlo en el chat, que es exactamente lo
 * que las dos pantallas existen para evitar.
 */
const TEXTOS = {
  publico: 'Público destinatario',
  objetivo: 'Al terminar, los alumnos tienen que poder',
  modalidad: 'Modalidad',
  nivel: 'Cuánto saben del tema hoy',
  fuentes: 'Enlaces de referencia para investigar',
  pistaDeFuentes: 'Leé estas páginas antes de planificar.',
  documentos: 'Documentos adjuntos',
  pistaDeInvestigadas: 'Las últimas 2 ya las investigamos.'
};

function datos(cambios: Partial<DatosDelMensaje> = {}): DatosDelMensaje {
  return {
    descripcion: 'Cómo se maneja la caja en las sucursales',
    publico: 'Cajeras y cajeros de sucursal',
    objetivo: 'Manejar un turno de caja completo sin ayuda',
    modalidad: 'A ritmo propio',
    nivel: 'Nada',
    enlaces: [''],
    documentos: [],
    investigadas: 0,
    textos: TEXTOS,
    ...cambios
  };
}

describe('armarMensajeInicial', () => {
  it('pone cada dato con su etiqueta, y el nivel en su propio renglón', () => {
    const mensaje = armarMensajeInicial(datos());

    // Juntos decían «Modalidad y nivel: A ritmo propio, Nada»: el modelo no tiene
    // cómo saber que «Nada» es cuánto sabe la gente y no parte de la modalidad.
    expect(mensaje).toContain('Modalidad: A ritmo propio');
    expect(mensaje).toContain('Cuánto saben del tema hoy: Nada');
    expect(mensaje).not.toContain('A ritmo propio, Nada');
  });

  it('arranca con la descripción y sigue con el público', () => {
    const renglones = armarMensajeInicial(datos()).split('\n');

    expect(renglones[0]).toBe('Cómo se maneja la caja en las sucursales');
    expect(renglones[2]).toBe('Público destinatario: Cajeras y cajeros de sucursal');
  });

  it('omite el objetivo cuando está vacío, sin dejar una etiqueta suelta', () => {
    const mensaje = armarMensajeInicial(datos({ objetivo: '   ' }));

    expect(mensaje).not.toContain(TEXTOS.objetivo);
  });

  it('recorta los espacios de lo que se escribió a mano', () => {
    const mensaje = armarMensajeInicial(datos({ descripcion: '  la caja  ', publico: '  cajeras  ' }));

    expect(mensaje.split('\n')[0]).toBe('la caja');
    expect(mensaje).toContain('Público destinatario: cajeras');
  });

  it('no inventa una sección de enlaces cuando los campos están vacíos', () => {
    // El formulario arranca con un campo de enlace en blanco: sin filtrarlo, todo
    // curso salía diciendo que tenía páginas de referencia.
    const mensaje = armarMensajeInicial(datos({ enlaces: ['', '   '] }));

    expect(mensaje).not.toContain(TEXTOS.fuentes);
    expect(mensaje).not.toContain(TEXTOS.pistaDeFuentes);
  });

  it('lista los enlaces que sí se cargaron, con la pista de qué hacer con ellos', () => {
    const mensaje = armarMensajeInicial(datos({ enlaces: [' https://ejemplo.com/manual ', ''] }));

    expect(mensaje).toContain('Enlaces de referencia para investigar: https://ejemplo.com/manual');
    expect(mensaje).toContain(TEXTOS.pistaDeFuentes);
  });

  it('lista los documentos adjuntos por nombre', () => {
    const mensaje = armarMensajeInicial(datos({ documentos: ['Instructivo de caja.docx', 'Protocolos.docx'] }));

    expect(mensaje).toContain('Documentos adjuntos: Instructivo de caja.docx, Protocolos.docx');
  });

  it('aclara cuáles vinieron de la investigación sólo si hubo investigación', () => {
    const sinInvestigar = armarMensajeInicial(datos({ documentos: ['Manual.pdf'] }));
    const conInvestigacion = armarMensajeInicial(datos({ documentos: ['Manual.pdf', 'Página'], investigadas: 2 }));

    expect(sinInvestigar).not.toContain(TEXTOS.pistaDeInvestigadas);
    expect(conInvestigacion).toContain(TEXTOS.pistaDeInvestigadas);
  });
});
