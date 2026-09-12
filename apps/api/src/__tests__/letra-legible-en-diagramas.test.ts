/**
 * La letra ilegible de un diagrama se repara, no se avisa.
 *
 * ── El caso real ─────────────────────────────────────────────────────────────
 *
 * 2026-09-12, producción. El validador devolvió, palabra por palabra:
 *
 *   "In the diagram, 10 text element(s) use font-size below 12 (smallest: 11).
 *    Raise them to at least 14 and shorten the labels if they no longer fit."
 *
 * junto con "Fix that now with edit_lesson_content before moving on". El agente
 * leyó la lección de vuelta... y siguió con el examen. La lección quedó
 * publicada con letra 11. En la corrida anterior, con el MISMO aviso, sí la
 * había corregido — o sea que el resultado dependía del humor del modelo.
 *
 * Por eso el piso ahora se aplica, y estos tests fijan que se aplique donde se
 * escribe: al guardar una lección entera y al editar un fragmento suelto, que
 * son dos caminos distintos y antes reparaban cosas distintas.
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeAgentLessonContent,
  repararDiagrama,
  subirLetraIlegible,
  validateSvgDiagram
} from '@api/services/agent/lesson-content';

/** Como lo escribió el modelo: etiquetas por debajo del piso. */
const DIAGRAMA_CHICO = `<svg viewBox="0 0 400 200" width="400" height="200">
  <rect x="10" y="10" width="180" height="40"></rect>
  <text x="20" y="35" font-size="11">DEPARTAMENTO DE LOGISTICA</text>
  <text x="20" y="80" font-size="9.5">Encargado de Logistica</text>
  <text x="20" y="120" font-size="14">Jefe de Obras</text>
</svg>`;

const tamanos = (html: string) =>
  [...html.matchAll(/font-size\s*=\s*["']?\s*([\d.]+)/gi)].map((m) => Number.parseFloat(m[1]));

describe('la letra de los diagramas se sube al piso legible', () => {
  it('sube las que están por debajo', () => {
    expect(tamanos(subirLetraIlegible(DIAGRAMA_CHICO))).toEqual([12, 12, 14]);
  });

  it('no toca las que ya estaban bien', () => {
    const ok = '<svg viewBox="0 0 10 10"><text font-size="18">Hola</text></svg>';

    expect(subirLetraIlegible(ok)).toBe(ok);
  });

  /**
   * El validador y la reparación tienen que mirar lo mismo. Si alguien cambia
   * una de las dos mitades, acá se separan y este test lo dice.
   */
  it('después de reparar, el validador ya no tiene nada que decir sobre el tamaño', () => {
    const antes = validateSvgDiagram(DIAGRAMA_CHICO);
    const despues = validateSvgDiagram(subirLetraIlegible(DIAGRAMA_CHICO));

    expect(antes.some((a) => a.includes('font-size below'))).toBe(true);
    expect(despues.some((a) => a.includes('font-size below'))).toBe(false);
  });

  it('guardar una lección entera la deja legible', () => {
    const guardada = normalizeAgentLessonContent(`<h3>Estructura</h3>${DIAGRAMA_CHICO}`, 'Estructura');

    expect(Math.min(...tamanos(guardada))).toBeGreaterThanOrEqual(12);
  });

  it('editar un fragmento suelto también', () => {
    expect(Math.min(...tamanos(repararDiagrama(DIAGRAMA_CHICO)))).toBeGreaterThanOrEqual(12);
  });

  /**
   * Fuera de un `<svg>` no se toca nada: el piso es una regla sobre diagramas,
   * no sobre el HTML de la lección, y ensancharla sin querer sería reescribir
   * contenido del docente.
   */
  it('no toca un font-size que esté fuera de un diagrama', () => {
    const prosa = '<p>El atributo font-size="8" se explica así.</p>';

    expect(subirLetraIlegible(prosa)).toBe(prosa);
  });
});
