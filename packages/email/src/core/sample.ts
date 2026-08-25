import * as z from 'zod';

import type { EmailTemplate } from './types';

/**
 * Datos de mentira para la vista previa.
 *
 * La pantalla de configuración muestra el correo renderizado de verdad, y para
 * eso hace falta con qué llenarlo. Los valores se adivinan por el nombre del
 * campo — todo lo que termina en `Url` es un enlace, todo lo que termina en
 * `Email` es un correo— así que un campo nuevo en cualquier plantilla ya sale
 * con algo razonable sin tocar este archivo.
 *
 * Nada de esto se envía nunca: es sólo para dibujar.
 */
const POR_NOMBRE: Array<[RegExp, string]> = [
  [/(url|link)$/i, 'https://ejemplo.test/acceso'],
  [/email$/i, 'persona@ejemplo.test'],
  [/^orgName$/, 'Consultora Ejemplo'],
  [/^(courseName|courseTitle)$/, 'Seguridad e Higiene'],
  [/^courseNames$/, 'Seguridad e Higiene, Primeros auxilios'],
  [/^programName$/, 'Programa de inducción'],
  [/^goalTitle$/, 'Completar los cursos obligatorios'],
  [/^(studentName|studentFullname)$/, 'Ana Pérez'],
  [/^teacherName$/, 'Carlos Gómez'],
  [/^name$/, 'Ana Pérez'],
  [/^roleName$/, 'instructor'],
  [/^expiresAt$/, '31 de diciembre'],
  [/^(content|comment)$/, 'Mañana subo el material de la clase.'],
  [/^customMessage$/, '']
];

function valorDe(nombre: string): string {
  for (const [patron, valor] of POR_NOMBRE) {
    if (patron.test(nombre)) return valor;
  }

  return 'ejemplo';
}

/**
 * Ajusta los tipos que no son texto preguntándole al propio esquema.
 *
 * En vez de mantener una lista de qué campo es número —que se desactualiza el
 * día que alguien agrega uno— se intenta validar y se corrigen los campos que
 * el esquema rechaza por tipo. La plantilla ya sabe qué espera; esto sólo le
 * hace caso.
 */
function corregirTipos(schema: z.ZodType, sample: Record<string, unknown>): Record<string, unknown> {
  let actual = { ...sample };

  for (let intento = 0; intento < 3; intento++) {
    const resultado = schema.safeParse(actual);
    if (resultado.success) return actual;

    let cambio = false;

    for (const issue of resultado.error.issues) {
      const clave = issue.path[0];
      if (typeof clave !== 'string') continue;

      const esperado = (issue as { expected?: string }).expected;
      if (esperado === 'number') {
        actual = { ...actual, [clave]: 3 };
        cambio = true;
      } else if (esperado === 'boolean') {
        actual = { ...actual, [clave]: true };
        cambio = true;
      }
    }

    // Si no hay nada que corregir, lo que falla es una regla de contenido
    // (`.url()`, `.min()`) y no un tipo. Se devuelve igual: la vista previa con
    // un valor imperfecto es mucho mejor que ninguna vista previa.
    if (!cambio) return actual;
  }

  return actual;
}

export function sampleFieldsFor(template: EmailTemplate): Record<string, unknown> {
  const shape = (template.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const base = Object.fromEntries(Object.keys(shape).map((clave) => [clave, valorDe(clave)]));

  return corregirTipos(template.schema, base);
}
