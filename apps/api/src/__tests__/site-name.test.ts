/**
 * El nombre del sitio es una etiqueta DNS, y hasta ahora se validaba como texto
 * libre.
 *
 * Los tres caminos que crean una empresa — panel de plataforma, onboarding y
 * espacios de trabajo — solo pedían un largo mínimo y que no empezara ni
 * terminara en guion. Así entró `"Pinurasespeciales "`, con mayúscula y un
 * espacio al final, y la dirección que quedó fue
 * `https://Pinurasespeciales .tensor.com.ar`: un host que no resuelve. Y no es
 * cosmético, porque ese valor es por donde el servidor decide a qué empresa
 * pertenece una visita.
 *
 * Lo que fijan estas pruebas es dónde está la línea entre corregir y rechazar.
 * Se corrige lo que no cambia la intención de nadie (espacios de los bordes,
 * mayúsculas). Se rechaza lo que sí la cambiaría: convertir "Pinturas
 * Especiales" en "pinturas-especiales" le daría a la empresa una dirección que
 * nadie eligió.
 */
import { describe, expect, it } from 'vitest';

import { SITE_NAME_MAX_LENGTH, ZSiteName, toSiteName } from '@cio/utils/validation/organization';

const parse = (value: string) => ZSiteName.safeParse(value);

describe('ZSiteName', () => {
  it('acepta una etiqueta valida', () => {
    expect(parse('pinturas-especiales').data).toBe('pinturas-especiales');
    expect(parse('egea').data).toBe('egea');
    expect(parse('cliente2026').data).toBe('cliente2026');
  });

  it('corrige el caso exacto que se colo en produccion', () => {
    expect(parse('Pinurasespeciales ').data).toBe('pinurasespeciales');
  });

  it('recorta y baja a minuscula sin quejarse', () => {
    expect(parse('  EGEA  ').data).toBe('egea');
  });

  it('rechaza un espacio en el medio en vez de convertirlo', () => {
    expect(parse('pinturas especiales').success).toBe(false);
  });

  it('rechaza acentos y simbolos', () => {
    expect(parse('construcción').success).toBe(false);
    expect(parse('cliente_uno').success).toBe(false);
    expect(parse('cliente.uno').success).toBe(false);
  });

  it('rechaza guiones en los bordes y guiones dobles', () => {
    expect(parse('-egea').success).toBe(false);
    expect(parse('egea-').success).toBe(false);
    expect(parse('egea--sur').success).toBe(false);
  });

  it('rechaza los subdominios reservados de la plataforma', () => {
    expect(parse('app').success).toBe(false);
    expect(parse('APP  ').success).toBe(false);
  });

  it('respeta los limites de largo de una etiqueta DNS', () => {
    expect(parse('ab').success).toBe(false);
    expect(parse('abc').success).toBe(true);
    expect(parse('a'.repeat(SITE_NAME_MAX_LENGTH)).success).toBe(true);
    expect(parse('a'.repeat(SITE_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('toSiteName', () => {
  it('propone algo usable a partir de un nombre libre', () => {
    expect(toSiteName('Pinturas Especiales')).toBe('pinturas-especiales');
    expect(toSiteName('  Egea Consultoría  ')).toBe('egea-consultoria');
    expect(toSiteName('Construcción & Montaje S.A.')).toBe('construccion-montaje-s-a');
  });

  it('lo que propone SIEMPRE pasa el validador', () => {
    const nombres = ['Pinturas Especiales', 'Egea Consultoría', 'ACME 2026', '  espacios  ', 'Ñandú Ltda'];

    for (const nombre of nombres) {
      const propuesto = toSiteName(nombre);
      expect(ZSiteName.safeParse(propuesto).success, `fallo con "${nombre}" -> "${propuesto}"`).toBe(true);
    }
  });

  it('no deja un guion colgando al recortar por largo', () => {
    const largo = toSiteName(`${'a'.repeat(SITE_NAME_MAX_LENGTH - 1)} b`);

    expect(largo.endsWith('-')).toBe(false);
    expect(ZSiteName.safeParse(largo).success).toBe(true);
  });
});
