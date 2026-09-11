/**
 * El índice de fuentes y la lectura bajo demanda.
 *
 * Reemplaza al estado binario que había: o viajaban las fuentes enteras en cada
 * turno, o no viajaba nada, y lo que decidía cuál era si el docente tenía
 * abierta una pestaña de lección. Medido en una sesión real de nueve turnos, el
 * paquete viajó en uno.
 *
 * Lo que se fija acá son las dos cosas de servidor:
 *
 *   1. QUÉ DICE EL ÍNDICE de cada fuente, y sobre todo cómo se leyó. Un
 *      organigrama transcripto mirándolo y uno con su texto extraído no merecen
 *      la misma confianza, y el modelo no tiene forma de distinguirlos si nadie
 *      se lo dice — que es exactamente cómo una extracción fallida terminó
 *      entregada etiquetada como `full text`.
 *
 *   2. LOS BORDES DE LA LECTURA. Sin tope de caracteres, un documento sin saltos
 *      de línea entra entero por la puerta de atrás y la lectura bajo demanda se
 *      convierte en el volcado automático que vino a reemplazar.
 */
import { describe, expect, it } from 'vitest';

import { VISION_NOTICE } from '@api/services/agent/document-vision';
import {
  comoSeLeyo,
  decidirMaterial,
  LINEAS_POR_LECTURA,
  MAX_LECTURA_CHARS,
  recortarLineas
} from '@api/services/agent/source-index';

describe('cómo se leyó cada fuente', () => {
  it('reconoce una transcripción hecha mirando el documento', () => {
    // El caso real: un PDF de organigramas del que el parser sacó 104
    // caracteres. Decirlo es decirle al modelo cuánta confianza tenerle.
    expect(comoSeLeyo({ text: `${VISION_NOTICE}\n\nDIRECTOR\n  GERENTE GENERAL`, sourceUrl: null })).toBe('vision');
  });

  it('reconoce una página web por su dirección', () => {
    expect(comoSeLeyo({ text: 'Quiénes somos…', sourceUrl: 'https://ejemplo.example/nosotros' })).toBe('web');
  });

  it('lo demás es texto extraído del archivo', () => {
    expect(comoSeLeyo({ text: 'Capítulo 1…', sourceUrl: null })).toBe('texto');
  });

  it('la marca de visión sólo cuenta al principio, no en el medio', () => {
    // Un documento que MENCIONA la frase no fue leído con visión. Aceptarla en
    // cualquier posición dejaría al índice mintiendo sobre su propia
    // procedencia.
    expect(comoSeLeyo({ text: `Un texto normal que cita "${VISION_NOTICE}" adentro.`, sourceUrl: null })).toBe('texto');
  });
});

describe('los bordes de una lectura', () => {
  const documento = Array.from({ length: 50 }, (_, i) => `linea ${i + 1}`).join('\n');

  it('numera las líneas, para que continuar sea pedir desde la última', () => {
    const r = recortarLineas(documento, 1, 3);

    expect(r.content).toBe('1\tlinea 1\n2\tlinea 2\n3\tlinea 3');
    expect(r.desdeLinea).toBe(1);
    expect(r.hastaLinea).toBe(3);
    expect(r.totalLineas).toBe(50);
    expect(r.hayMas).toBe(true);
  });

  it('continúa exactamente donde quedó', () => {
    const primera = recortarLineas(documento, 1, 3);
    const segunda = recortarLineas(documento, primera.hastaLinea + 1, 3);

    expect(segunda.content.startsWith('4\tlinea 4')).toBe(true);
  });

  it('avisa cuando ya no queda nada', () => {
    const r = recortarLineas(documento, 48, 10);

    expect(r.hastaLinea).toBe(50);
    expect(r.hayMas).toBe(false);
  });

  it('una lectura pasada del final no dice que haya más', () => {
    // Decirlo mandaría al modelo a un bucle de lecturas vacías.
    const r = recortarLineas(documento, 99, 10);

    expect(r.content).toBe('');
    expect(r.hayMas).toBe(false);
  });

  it('lee desde el principio cuando no se le pide otra cosa', () => {
    const r = recortarLineas(documento);

    expect(r.desdeLinea).toBe(1);
    expect(r.hastaLinea).toBe(50);
    expect(LINEAS_POR_LECTURA).toBeGreaterThan(50);
  });

  it('el tope de CARACTERES manda sobre el de líneas', () => {
    // Un documento de una sola línea gigante es el caso que rompe un tope
    // contado en líneas: "una línea" serían doscientos mil caracteres.
    const unaLineaEnorme = 'x'.repeat(MAX_LECTURA_CHARS * 3);
    const r = recortarLineas(unaLineaEnorme, 1, 600);

    expect(r.content.length).toBeLessThanOrEqual(MAX_LECTURA_CHARS);
  });

  it('corta a mitad de camino cuando las líneas son largas, y lo dice', () => {
    const gordas = Array.from({ length: 20 }, () => 'y'.repeat(5000)).join('\n');
    const r = recortarLineas(gordas, 1, 20);

    expect(r.content.length).toBeLessThanOrEqual(MAX_LECTURA_CHARS + 16);
    expect(r.hastaLinea).toBeLessThan(20);
    expect(r.hayMas).toBe(true);
  });

  it('devuelve al menos una línea aunque sola ya pase el tope', () => {
    // Devolver vacío dejaría al modelo sin nada y sin forma de avanzar.
    const r = recortarLineas('z'.repeat(MAX_LECTURA_CHARS * 2), 1, 5);

    expect(r.content.length).toBeGreaterThan(0);
    expect(r.hastaLinea).toBe(1);
  });
});

describe('qué forma toma el material en cada fase', () => {
  const docente = (fase: 'plan' | 'build' | 'full') => decidirMaterial({ esDocente: true, fase, hayDocumentoBuscable: false });

  it('planificar recibe todo: un temario no se decide con fragmentos', () => {
    expect(docente('plan')).toBe('paquete');
  });

  it('CONSTRUIR recibe el índice: las lecciones las escribe write_lesson con sus propias fuentes', () => {
    expect(docente('build')).toBe('indice');
  });

  it('el resto de los turnos, también el índice', () => {
    expect(docente('full')).toBe('indice');
  });

  it('el tutor del alumno no recibe ni lo uno ni lo otro', () => {
    expect(decidirMaterial({ esDocente: false, fase: 'full', hayDocumentoBuscable: false })).toBe('ninguno');
  });

  it('con un documento indexado para búsqueda, manda el camino viejo', () => {
    expect(decidirMaterial({ esDocente: true, fase: 'build', hayDocumentoBuscable: true })).toBe('ninguno');
  });
});
