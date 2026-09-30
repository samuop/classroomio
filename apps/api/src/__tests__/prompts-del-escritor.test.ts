import { describe, expect, it } from 'vitest';
// Desde el código fuente del paquete y no desde `@cio/ai-assistant`: los tests
// de la API leen el `dist` compilado, y un prompt recién cambiado no llega ahí
// hasta la próxima compilación. Acá se fija lo que dice el texto de verdad.
import { buildLessonWriterPrompt } from '../../../../packages/ai-assistant/src/prompt/lesson-writer';
import { buildQuestionWriterPrompt } from '../../../../packages/ai-assistant/src/prompt/question-writer';
import { LESSON_VOICE_RULES } from '../../../../packages/ai-assistant/src/prompt/lesson-rules';
import { SVG_DIAGRAM_RULES } from '../../../../packages/ai-assistant/src/prompt/svg-rules';
import { SIN_MATERIAL_ASIGNADO } from '@api/services/agent/lesson-writer';

/**
 * Lo que los prompts de escritura dicen, medido contra un curso de planillas
 * (producción, 2026-09-29).
 *
 * Cada regla nueva viene de un defecto visto: cifras en formato inglés en una
 * lección en castellano, un código de color para principiantes, planillas
 * dibujadas como listas con «|», ejemplos marcados que se llevaban la
 * definición de al lado, un cuestionario con «Selecciona» entre lecciones con
 * voseo, y un escritor al que se le decía que la docente había «aceptado» algo
 * que nunca contestó.
 */

const ESCRITOR = buildLessonWriterPrompt();

describe('el escritor de lecciones', () => {
  it('separa el ejemplo inventado del párrafo con material, y marca sólo el ejemplo', () => {
    expect(ESCRITOR).toMatch(/split it: put the example in its own `<p>`, `<li>` or `<table>` and mark only that one/);
  });

  it('marca la tabla entera cuando toda es ejemplo, y nunca una fila o una celda', () => {
    // El editor guarda la marca en el nodo tabla y en ningún otro de adentro:
    // puesta en un <tr> o un <td>, se pierde en el primer guardado y los datos
    // inventados vuelven como inventos sin explicar.
    expect(ESCRITOR).toMatch(/the whole `<table>` when every value in it is invented/);
    expect(ESCRITOR).toMatch(/never on a `<tr>` or a `<td>`/);
  });

  it('tiene salida para el conocimiento general correcto, con certeza', () => {
    expect(ESCRITOR).toMatch(/correct, well-established general knowledge of the subject/);
    expect(ESCRITOR).toMatch(/never remove or reword a correct fact/);
  });

  it('puede escribir una tabla simple, y no vuelve a prohibirla', () => {
    expect(ESCRITOR).toMatch(/a simple <table>/);
    expect(ESCRITOR).toMatch(/Never fake a table with a list whose items join the values with "\|"/);
    expect(ESCRITOR).not.toMatch(/no new <table>/);
    expect(ESCRITOR).not.toMatch(/would not let you write from scratch, such as a <table>/);
  });

  it('ya no dice que la docente aceptó escribir de conocimiento general', () => {
    expect(ESCRITOR).not.toMatch(/teacher agreed/i);
    expect(SIN_MATERIAL_ASIGNADO).not.toMatch(/agreed/i);
    expect(SIN_MATERIAL_ASIGNADO).toMatch(/general professional knowledge/);
    expect(SIN_MATERIAL_ASIGNADO).toMatch(/data-sin-fuente/);
  });

  it('las cifras van en el formato del idioma y los colores sin código', () => {
    for (const texto of [ESCRITOR, LESSON_VOICE_RULES]) {
      expect(texto).toMatch(/1\.048\.576/);
      expect(texto).toMatch(/never copy "1,048,576" into a Spanish lesson/);
      expect(texto).toMatch(/Colour codes \(#e2e8f0\)[^\n]*belong inside your SVG attributes only/);
    }
  });
});

describe('los diagramas', () => {
  it('una planilla se dibuja con una celda por dato, y los códigos de color quedan adentro del SVG', () => {
    expect(SVG_DIAGRAM_RULES).toMatch(/one cell \(its own <rect>\) per value/);
    expect(SVG_DIAGRAM_RULES).toMatch(/never write them in the text of the lesson/);
  });
});

describe('el escritor de preguntas', () => {
  it('dice el voseo con todas las letras', () => {
    const prompt = buildQuestionWriterPrompt('- 1: RADIO');

    expect(prompt).toMatch(/Argentine voseo/);
    expect(prompt).toContain('«Seleccioná todas las opciones correctas»');
    expect(prompt).toMatch(/Never the tú forms \(«Selecciona»/);
  });
});
