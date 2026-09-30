import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Desde el código fuente y no desde `@cio/ai-assistant`: los tests de la API
// leen el `dist`, y un prompt recién cambiado no llega ahí hasta compilar.
import { buildLessonWriterPrompt } from '../../../../packages/ai-assistant/src/prompt/lesson-writer';
import { buildTeacherSystemPrompt } from '../../../../packages/ai-assistant/src/prompt/teacher';
import { pasoPudoCambiarElCurso } from '@api/services/agent/pasos-que-cambian';

/**
 * Una capacidad nueva que ningún prompt nombra queda muerta y sin error: pasó
 * dos veces en este proyecto. Acá se fija que el asistente sepa que las
 * planillas se leen como mapa, que se consultan con `inspect_spreadsheet`, que
 * el curso sigue el recorrido de los datos y que las fórmulas van en castellano.
 */

const CONTEXTO = { orgId: 'o', courseId: 'c', courseTitle: 'C', userId: 'u', role: 'teacher' as never, locale: 'es' };

describe('el asistente, al planificar', () => {
  const plan = buildTeacherSystemPrompt(CONTEXTO, { mode: 'plan' });

  it('sabe que una planilla llega como mapa y que se mira por dentro con la herramienta', () => {
    expect(plan).toContain('### Excel workbooks as sources');
    expect(plan).toMatch(/comes to you as a MAP of the workbook, not every cell/);
    expect(plan).toMatch(/look at it with `inspect_spreadsheet`/);
  });

  it('arma el curso —o la sección de un curso que ya existe— siguiendo el recorrido de los datos', () => {
    expect(plan).toMatch(/or for a section of a course that already exists — about a workbook, the plan follows the data/);
    expect(plan).toMatch(/first the inputs .* then the calculations .* and last the results/);
  });

  it('escribe las fórmulas en castellano y dice lo que la planilla no cuenta', () => {
    expect(plan).toContain('=BUSCARV(C2;TablaProductos;2;FALSO)');
    expect(plan).toMatch(/Never translate it back to English/);
    expect(plan).toMatch(/values that come from another file .* macros .* pivot tables/);
  });

  it('tiene la herramienta a mano al planificar, y consultarla no cuenta como cambiar el curso', () => {
    const ruta = readFileSync(new URL('../routes/agent/agent.ts', import.meta.url), 'utf8');
    const desde = ruta.indexOf('const activeToolNames =');
    const listaDelPlan = ruta.slice(desde, ruta.indexOf('] as const)', desde));

    expect(listaDelPlan).toContain("teacherPromptMode === 'plan'");

    expect(listaDelPlan).toContain("'inspect_spreadsheet'");
    expect(pasoPudoCambiarElCurso(['inspect_spreadsheet'])).toBe(false);
  });
});

describe('el escritor de lecciones', () => {
  const escritor = buildLessonWriterPrompt();

  it('con el mapa de una planilla: fórmulas como en el mapa, y ningún número que el mapa no tenga', () => {
    expect(escritor).toMatch(/When the material is the map of an Excel workbook \(it starts with "# Planilla de Excel"\)/);
    expect(escritor).toMatch(/never translated back to English/);
    expect(escritor).toMatch(/never state a total, a count or a value that is not in it/);
  });
});
