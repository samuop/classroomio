/**
 * Los nombres que el servidor inventa para lo que no tiene uno.
 *
 * Medido el 2026-11-11: después de borrar unas secciones, las piezas que
 * quedaron sueltas aparecieron bajo «Ungrouped» —en inglés— en el panel, y el
 * asistente, que lee la misma estructura, lo repetía en sus respuestas.
 */
import { describe, expect, it } from 'vitest';

import { ContentType } from '@cio/utils/constants';

import { buildCourseContent } from '@api/services/course/utils';

const fila = (datos: Record<string, unknown>) => datos as never;

describe('el contenido de un curso agrupado en secciones', () => {
  const contenido = buildCourseContent(
    [
      fila({ id: 'seccion-1', type: ContentType.Section, title: '', order: 1 }),
      fila({ id: 'leccion-1', type: ContentType.Lesson, title: 'Recibir mercadería', sectionId: 'seccion-1', order: 1 }),
      fila({ id: 'leccion-2', type: ContentType.Lesson, title: 'Controlar el remito', sectionId: null, order: 2 })
    ],
    true
  );

  it('lo que no está en ninguna sección va bajo «Sin sección», con el id que reconoce el panel', () => {
    const suelta = contenido.sections.find((seccion) => seccion.id === 'ungrouped');

    expect(suelta?.title).toBe('Sin sección');
    expect(suelta?.items.map((item) => item.title)).toEqual(['Controlar el remito']);
  });

  it('una sección sin título se nombra en español', () => {
    expect(contenido.sections.find((seccion) => seccion.id === 'seccion-1')?.title).toBe('Sección sin título');
  });

  it('ningún nombre inventado queda en inglés', () => {
    expect(JSON.stringify(contenido.sections.map((seccion) => seccion.title))).not.toMatch(/Ungrouped|Untitled/);
  });
});
