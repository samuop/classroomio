/**
 * El escritor de lecciones: un sub-agente que escribe UNA lección con contexto
 * limpio — su consigna, el temario, y SÓLO las fuentes que el plan le asignó.
 *
 * Al modelo no se lo puede fijar en un test. Lo que se fija acá es lo que decide
 * si su trabajo sirve, y todo es de servidor:
 *
 *   1. QUÉ MATERIAL VE (`armarMaterial`, `buscarFuente`). Si el reparto del
 *      presupuesto desperdicia lugar, recorta fuentes que entraban; si la
 *      búsqueda de la fuente declarada elige otra, la lección se escribe con el
 *      documento equivocado y pasa el chequeo de cobertura igual.
 *
 *   2. QUÉ SE GUARDA (`extraerLeccion`). Una respuesta cortada por el tope de
 *      salida se ve completa en el editor y termina a mitad de una oración.
 *      Tiene que rechazarse, no guardarse.
 *
 *   3. QUE LAS REGLAS SEAN LAS MISMAS que las del agente que construye el curso.
 *      Si el escritor tuviera su propia copia de "cuánto escribir", el primer
 *      cambio llegaría a una sola — y "cuánto escribir" es justo lo que se acaba
 *      de cambiar.
 */
import { describe, expect, it } from 'vitest';

import { buildLessonWriterPrompt, buildTeacherSystemPrompt } from '@cio/ai-assistant';
import { buscarFuente } from '@api/services/agent/plan-coverage';
import {
  armarMaterial,
  extraerLeccion,
  PRESUPUESTO_MATERIAL_CHARS,
  temarioDelPlan
} from '@api/services/agent/lesson-writer';

describe('qué material ve el escritor', () => {
  it('cuando todo entra, lo muestra entero y en el orden del plan', () => {
    const r = armarMaterial([
      { fileName: 'B.pdf', text: 'segundo' },
      { fileName: 'A.pdf', text: 'primero' }
    ]);

    expect(r.recortadas).toEqual([]);
    expect(r.texto.indexOf('B.pdf')).toBeLessThan(r.texto.indexOf('A.pdf'));
    expect(r.texto).toContain('segundo');
    expect(r.texto).toContain('primero');
  });

  it('sin fuentes no inventa un bloque vacío', () => {
    expect(armarMaterial([])).toEqual({ texto: '', recortadas: [] });
  });

  it('una fuente enorme no le quita lugar a una chica, venga primero o segunda', () => {
    const chica = { fileName: 'chica.pdf', text: 'c'.repeat(10_000) };
    const enorme = { fileName: 'enorme.pdf', text: 'e'.repeat(PRESUPUESTO_MATERIAL_CHARS * 3) };

    for (const orden of [
      [chica, enorme],
      [enorme, chica]
    ]) {
      const r = armarMaterial(orden);

      // La chica entra entera…
      expect(r.texto).toContain(chica.text);
      // …la enorme se recorta y se dice cuál…
      expect(r.recortadas).toEqual(['enorme.pdf']);
      // …y entre las dos usan TODO el presupuesto: repartir en mitades en el
      // orden de llegada dejaba sin usar la mitad que le sobraba a la chica.
      const mostrado = (r.texto.match(/[ce]/g) ?? []).length;
      expect(mostrado).toBeGreaterThanOrEqual(PRESUPUESTO_MATERIAL_CHARS - 50);
      expect(mostrado).toBeLessThanOrEqual(PRESUPUESTO_MATERIAL_CHARS + 50);
    }
  });

  it('el recorte se le dice al escritor, con el nombre de la fuente', () => {
    const r = armarMaterial([{ fileName: 'manual.pdf', text: 'x'.repeat(PRESUPUESTO_MATERIAL_CHARS * 2) }]);

    expect(r.texto).toMatch(/were not shown to you/);
    expect(r.texto).toContain('"manual.pdf"');
    expect(r.texto).toMatch(/<note>/);
  });
});

describe('qué fuente es la declarada', () => {
  const fuentes = [
    { id: 'id-1', fileName: 'Organigrama 2023.pdf' },
    { id: 'id-2', fileName: 'Organigrama.pdf' },
    { id: 'id-3', fileName: 'sitioejemplo (sitioejemplo.example)' }
  ];

  it('prefiere la coincidencia exacta a la contención', () => {
    // «Organigrama» está contenido en los dos. El que se llama exactamente así
    // es el que el plan quiso decir.
    expect(buscarFuente('Organigrama', fuentes)?.id).toBe('id-2');
  });

  it('encuentra por id', () => {
    expect(buscarFuente('id-3', fuentes)?.fileName).toBe('sitioejemplo (sitioejemplo.example)');
  });

  it('encuentra por nombre a medias cuando no hay exacto', () => {
    expect(buscarFuente('sitioejemplo', fuentes)?.id).toBe('id-3');
  });

  it('no encuentra lo que no existe', () => {
    expect(buscarFuente('Manual de higiene.pdf', fuentes)).toBeUndefined();
  });
});

describe('qué se guarda', () => {
  it('saca la lección y la nota del sobre', () => {
    const r = extraerLeccion('<lesson>\n<h3>Hola</h3><p>Texto.</p>\n</lesson>\n<note>Falta el manual.</note>');

    expect(r).toEqual({ html: '<h3>Hola</h3><p>Texto.</p>', nota: 'Falta el manual.' });
  });

  it('sin nota, no inventa una', () => {
    expect(extraerLeccion('<lesson><p>Texto.</p></lesson>')).toEqual({ html: '<p>Texto.</p>' });
  });

  it('saca el bloque de código que algunos modelos agregan aunque se les pida HTML crudo', () => {
    const r = extraerLeccion('<lesson>\n```html\n<p>Texto.</p>\n```\n</lesson>');

    expect(r?.html).toBe('<p>Texto.</p>');
  });

  it('RECHAZA una respuesta cortada: el sobre sin cerrar es media lección', () => {
    // Es lo que devuelve un modelo que llegó al tope de salida. Guardarlo
    // dejaría una lección que se ve completa y termina a mitad de una oración.
    expect(extraerLeccion('<lesson><h3>Intro</h3><p>La estructura de la empresa se divide en')).toBeNull();
  });

  it('rechaza una respuesta sin sobre', () => {
    expect(extraerLeccion('<h3>Intro</h3><p>Texto suelto.</p>')).toBeNull();
  });

  it('rechaza un sobre vacío', () => {
    expect(extraerLeccion('<lesson>   </lesson>')).toBeNull();
  });
});

describe('el temario', () => {
  it('no hay temario sin plan', () => {
    expect(temarioDelPlan(undefined)).toBeUndefined();
  });

  it('lleva las descripciones, que es lo que dice qué le toca a cada lección', () => {
    const t = temarioDelPlan({
      sections: [
        {
          title: 'La empresa',
          items: [
            { type: 'lesson', title: 'Organigrama', description: 'Las áreas y de quién dependen.' },
            { type: 'exercise', title: 'Repaso' }
          ]
        }
      ]
    })!;

    expect(t).toContain('1. La empresa');
    expect(t).toContain('Organigrama — Las áreas y de quién dependen.');
    expect(t).toContain('[exercise] Repaso');
  });

  it('acota las descripciones largas', () => {
    const t = temarioDelPlan({
      sections: [{ title: 'S', items: [{ type: 'lesson', title: 'L', description: 'x'.repeat(2000) }] }]
    })!;

    expect(t.length).toBeLessThan(400);
  });
});

describe('las reglas son las mismas que las del constructor', () => {
  const escritor = buildLessonWriterPrompt();
  const constructor = buildTeacherSystemPrompt(
    { orgId: 'o', courseId: 'c', courseTitle: 'C', userId: 'u', role: 'teacher' as never, locale: 'es' },
    { mode: 'build' }
  );

  it.each([
    '**There is no minimum word count, and you must not treat length as a goal.**',
    '**If the sources do not carry enough material to teach the lesson properly, stop and say so.**',
    '**Concrete beats abstract, always.**',
    'A "Common pitfalls" or "Key takeaways" sub-section at the end'
  ])('los dos dicen: %s', (frase) => {
    expect(escritor).toContain(frase);
    expect(constructor).toContain(frase);
  });

  it('no volvió el piso de palabras por ninguno de los dos lados', () => {
    for (const prompt of [escritor, constructor]) {
      expect(prompt).not.toMatch(/700[- ]word/i);
      expect(prompt).not.toMatch(/Aim for 1,500/i);
    }
  });

  it('el escritor no hereda una interpolación sin resolver', () => {
    expect(escritor).not.toContain('${');
  });

  /**
   * Capacidad nueva, instrucción vieja: la guardia de conservación niega la
   * versión del escritor que pierde un diagrama, una tabla o un ejemplo
   * marcado, y el prompt sólo le pedía conservar las <img> — y le prohibía
   * escribir <table>. Una orden `rewrite` sobre una lección con tabla quedaba
   * trabada entre las dos reglas.
   */
  it('el escritor sabe qué piezas tiene que conservar al reescribir', () => {
    for (const pieza of ['data-ejemplo', '<svg>', '<img>', '<figure>', '<table>', '<pre>']) {
      expect(escritor).toContain(pieza);
    }
    expect(escritor).toMatch(/refuses your version/);
    expect(escritor).toMatch(/Changing a diagram means REPLACING it/);
    // Y la regla de HTML ya no le prohíbe CONSERVAR la tabla que ya estaba.
    expect(escritor).toContain('no new <table>');
    expect(escritor).not.toContain('keep every <img> exactly where it is.');
  });

  it('el escritor sabe que no puede hablar con el docente y usa la nota', () => {
    expect(escritor).toMatch(/You cannot talk to the teacher/);
    expect(escritor).toMatch(/"tell the teacher" always means: put it in <note>/);
  });
});
