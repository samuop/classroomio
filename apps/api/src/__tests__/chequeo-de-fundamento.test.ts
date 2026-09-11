/**
 * El chequeo de fundamento: que lo que la lección AFIRMA salga de las fuentes.
 *
 * Acá no se testea al modelo verificador —eso no se puede fijar en un test— sino
 * las dos piezas que deciden si su salida vale algo, y las dos son de servidor:
 *
 *   1. QUÉ SE MIRA (`textoDeLeccion`). El caso real que originó todo esto vivía
 *      dentro de un <svg>: una jerarquía inventada, dibujada como organigrama.
 *      Si el verificador no ve las etiquetas del diagrama, no mira exactamente
 *      donde apareció el problema.
 *
 *   2. QUÉ SE CREE (`citaAparece`). El verificador es otro modelo y puede
 *      inventar la frase que denuncia igual que el primero inventó el
 *      organigrama. Un aviso sobre una frase que nadie escribió es peor que
 *      ningún aviso: el modelo sale a buscarla, no la encuentra, y aprende que
 *      este canal miente. Por eso la cita se comprueba contra el texto acá.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  chequeoHabilitado,
  citaAparece,
  crearVerificadorDeFundamento,
  redactarAviso,
  textoDeLeccion
} from '@api/services/agent/grounding';

describe('qué mira el verificador', () => {
  it('conserva las etiquetas del diagrama, que es donde estaba la invención', () => {
    // Textual del caso real: el modelo dibujó un organigrama con cajas que no
    // existen en el documento de la empresa.
    const leccion =
      '<p>La estructura de la empresa es la siguiente:</p>' +
      '<svg viewBox="0 0 600 400"><rect x="10" y="10" width="180" height="40" fill="#eee"/>' +
      '<text x="100" y="35">Dirección General</text>' +
      '<path d="M100 50 L100 90"/>' +
      '<text x="100" y="110">Área Comercial</text></svg>';

    const texto = textoDeLeccion(leccion);

    expect(texto).toContain('Dirección General');
    expect(texto).toContain('Área Comercial');
  });

  it('tira la geometría, que es lo que no se puede juzgar y sí se paga', () => {
    const leccion = '<svg viewBox="0 0 600 400"><path d="M100 50 L100 90"/><text>Depósito</text></svg>';

    const texto = textoDeLeccion(leccion);

    expect(texto).not.toContain('viewBox');
    expect(texto).not.toContain('M100 50');
    expect(texto).not.toContain('#eee');
  });

  it('marca de dónde salió cada etiqueta, para que el aviso pueda decirlo', () => {
    const leccion = '<svg><text>Gerente</text><text>Auxiliar</text></svg>';

    expect(textoDeLeccion(leccion)).toBe('[diagram: Gerente · Auxiliar]');
  });

  it('deja pasar un diagrama decorativo sin texto en vez de anunciarlo vacío', () => {
    const leccion = '<p>Un separador.</p><svg><circle cx="5" cy="5" r="4"/></svg>';

    expect(textoDeLeccion(leccion)).toBe('Un separador.');
  });

  it('devuelve las entidades a su forma legible', () => {
    const leccion = '<p>Seguridad &amp; Higiene: el l&iacute;mite es &lt;40&nbsp;kg&gt;</p>';

    // &iacute; no se decodifica (no es de las cinco que importan) y se deja como
    // está: lo que no se puede decodificar bien es preferible dejarlo visible.
    const texto = textoDeLeccion(leccion);
    expect(texto).toContain('Seguridad & Higiene');
    expect(texto).toContain('<40 kg>');
  });

  it('no manda scripts ni estilos', () => {
    const leccion = '<style>.x{color:red}</style><p>Contenido</p><script>alert(1)</script>';

    expect(textoDeLeccion(leccion)).toBe('Contenido');
  });
});

describe('qué se le cree al verificador', () => {
  const leccion = textoDeLeccion(
    '<p>El Departamento Comercial depende del Gerente General.</p>' +
      '<svg><text>Encargado Sucursal Norte</text></svg>'
  );

  it('acepta una cita que está de verdad en la lección', () => {
    expect(citaAparece('El Departamento Comercial depende del Gerente General', leccion)).toBe(true);
  });

  it('acepta una cita que está dentro de un diagrama', () => {
    expect(citaAparece('Encargado Sucursal Norte', leccion)).toBe(true);
  });

  it('perdona acentos, mayúsculas y puntuación: eso no es lo que se comprueba', () => {
    expect(citaAparece('"el departamento comercial DEPENDE del gerente general."', leccion)).toBe(true);
  });

  it('RECHAZA una cita que el verificador inventó', () => {
    // La afirmación es plausible y la lección no la contiene. Es exactamente el
    // fallo que este filtro existe para atajar.
    expect(citaAparece('El Departamento Comercial depende del Director', leccion)).toBe(false);
  });

  it('rechaza una cita demasiado corta para significar algo', () => {
    // "del" aparece en la lección, y aceptarla convertiría el aviso en ruido.
    expect(citaAparece('del', leccion)).toBe(false);
    expect(citaAparece('Gerente', leccion)).toBe(false);
  });

  it('acepta una cita cortada con puntos suspensivos por su tramo más largo', () => {
    expect(citaAparece('El Departamento Comercial … del Gerente General', leccion)).toBe(true);
  });

  it('rechaza la cortada cuando el tramo largo tampoco existe', () => {
    expect(citaAparece('El Departamento de Compras … del Gerente General', leccion)).toBe(false);
  });
});

describe('qué se le devuelve al modelo', () => {
  it('no dice nada cuando no hay nada que decir', () => {
    expect(redactarAviso([])).toEqual([]);
  });

  it('nombra cada afirmación y lo que la fuente dice en su lugar', () => {
    const aviso = redactarAviso([
      { cita: 'El plazo de entrega es de 48 horas', porque: 'the sources say 72 hours (page 4)' },
      { cita: 'Dirección General', porque: 'the org chart has no such box' }
    ]);

    expect(aviso).toHaveLength(1);
    expect(aviso[0]).toContain('El plazo de entrega es de 48 horas');
    expect(aviso[0]).toContain('72 hours');
    expect(aviso[0]).toContain('Dirección General');
  });

  it('cierra la salida fácil: reemplazar lo inventado por otra cosa inventada', () => {
    const aviso = redactarAviso([{ cita: 'un plazo de 48 horas', porque: 'nothing in the sources' }])[0];

    expect(aviso).toMatch(/do NOT replace an unsupported claim with a different unsupported claim/i);
    expect(aviso).toMatch(/do NOT soften it/i);
  });

  it('deja abierta la salida correcta: escribir menos y pedir el material', () => {
    const aviso = redactarAviso([{ cita: 'un plazo de 48 horas', porque: 'nothing in the sources' }])[0];

    // Sin esto el modelo queda sin ninguna salida y vuelve a inventar, que es de
    // donde venimos. El piso de palabras ya no existe justamente para que ésta
    // sea una salida real.
    expect(aviso).toMatch(/no minimum length/i);
    expect(aviso).toMatch(/name the document/i);
  });
});

describe('el interruptor', () => {
  const original = process.env.AGENT_GROUNDING_CHECK;

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_GROUNDING_CHECK;
    else process.env.AGENT_GROUNDING_CHECK = original;
  });

  it('está encendido salvo que se lo apague explícitamente', () => {
    delete process.env.AGENT_GROUNDING_CHECK;
    expect(chequeoHabilitado()).toBe(true);

    process.env.AGENT_GROUNDING_CHECK = 'true';
    expect(chequeoHabilitado()).toBe(true);
  });

  it('apagado, no se construye ningún verificador', () => {
    process.env.AGENT_GROUNDING_CHECK = 'false';

    expect(chequeoHabilitado()).toBe(false);
    expect(
      crearVerificadorDeFundamento({
        orgId: 'o',
        userId: 'u',
        courseId: 'c',
        redis: {} as never,
        providerConfig: { provider: 'google', apiKey: 'x' } as never
      })
    ).toBeUndefined();
  });
});
