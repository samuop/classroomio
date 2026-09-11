/**
 * Borrar: el único lugar donde el agente puede destruir trabajo del docente.
 *
 * Todo lo demás que hace se corrige. Una lección mal escrita se reescribe; una
 * lección borrada no vuelve, y se lleva puestos su contenido, sus ejercicios y
 * el avance de los alumnos.
 *
 * Y el modo de fallar está documentado en el propio prompt, que prohíbe inventar
 * UUIDs en tres lugares distintos — una buena señal de que pasa igual.
 * Prohibirlo ya se probó. Lo que se prueba acá es que ese error no se pueda
 * ejecutar: para borrar hay que decir el TÍTULO, y el servidor lo contrasta.
 * Un id equivocado apunta a otra fila, y esa fila casi nunca se llama igual.
 */
import { describe, expect, it } from 'vitest';

import { avisoDeConfirmacion, confirmacionCoincide } from '@api/services/agent/deletion';

describe('la confirmación por título', () => {
  it('acepta el título exacto', () => {
    expect(confirmacionCoincide('Comprender el organigrama', 'Comprender el organigrama')).toBe(true);
  });

  it('perdona mayúsculas, acentos y espacios de más', () => {
    expect(confirmacionCoincide('  comprender el ORGANIGRAMA  ', 'Comprender el organigrama')).toBe(true);
  });

  it('perdona la puntuación y las comillas tipográficas', () => {
    expect(confirmacionCoincide('«Bienvenida»: primeros pasos', 'Bienvenida: primeros pasos')).toBe(true);
  });

  it('RECHAZA otro título — que es el id equivocado disfrazado', () => {
    expect(confirmacionCoincide('Comprender el organigrama', 'Historia y valores de la empresa')).toBe(false);
  });

  it('RECHAZA un título contenido en el real', () => {
    // "Introducción" está dentro de "Introducción a la seguridad". Aceptar la
    // contención reabriría exactamente el agujero que esto cierra: un título
    // parcial que coincide con la lección equivocada.
    expect(confirmacionCoincide('Introducción', 'Introducción a la seguridad')).toBe(false);
  });

  it('RECHAZA el real contenido en el declarado', () => {
    expect(confirmacionCoincide('Introducción a la seguridad', 'Introducción')).toBe(false);
  });

  it('RECHAZA un título vacío o sólo puntuación', () => {
    // Sin nada contra qué contrastar no hay control, y no tener control es peor
    // que no tener herramienta.
    expect(confirmacionCoincide('', 'Cualquier lección')).toBe(false);
    expect(confirmacionCoincide('  ---  ', 'Cualquier lección')).toBe(false);
  });

  it('distingue títulos que sólo difieren en un número', () => {
    // El caso realista de un curso: secciones numeradas.
    expect(confirmacionCoincide('Módulo 2: Seguridad', 'Módulo 3: Seguridad')).toBe(false);
    expect(confirmacionCoincide('Módulo 3: Seguridad', 'Módulo 3: Seguridad')).toBe(true);
  });
});

describe('lo que se le dice al modelo cuando no coincide', () => {
  const aviso = avisoDeConfirmacion({
    tipo: 'lesson',
    id: 'aaaaaaaa-0000-0000-0000-000000000009',
    declarado: 'Protocolos de seguridad',
    real: 'Historia y valores de la empresa'
  });

  it('dice que no se borró nada', () => {
    expect(aviso).toMatch(/Nothing was deleted/i);
  });

  it('nombra lo que hay REALMENTE en ese id', () => {
    // Sin esto el modelo no puede distinguir "me equivoqué de id" de "me
    // equivoqué de título", y el reintento sería a ciegas.
    expect(aviso).toContain('Historia y valores de la empresa');
    expect(aviso).toContain('aaaaaaaa-0000-0000-0000-000000000009');
  });

  it('manda a buscar el ítem correcto, no a reintentar con otro título', () => {
    expect(aviso).toMatch(/get_course_structure/);
  });
});
