/**
 * Enlaces del agente a lecciones, ejercicios y secciones.
 *
 * El agente copia ids de lo que le devuelven las herramientas a la prosa de su
 * respuesta, y a veces escribe uno que no existió nunca. Medido en dev: un
 * resumen de construcción enlazó una lección como `798ca7a5-…` cuando la
 * herramienta había devuelto `585f735a-…`. No era un error de tipeo — ese UUID
 * no aparecía en ningún lado. El prompt ya lo prohibía.
 *
 * Por eso el enlace se contrasta contra el curso en vez de creerle. Lo que se
 * fija acá:
 *   - el caso medido se repara (el título nombra la lección real);
 *   - la reparación nunca adivina: título parcial o repetido → no repara;
 *   - sin estructura cargada, todo se comporta como antes (no se rompen enlaces
 *     buenos por no poder comprobarlos);
 *   - lo que no se puede resolver queda marcado para decidirlo al hacer clic.
 */
import { renderMentions, resolveMention, type MentionTarget } from './mentions';

const CURSO = 'curso-1';
const REAL = '585f735a-ad92-41ab-9712-b496801abc25';
const INVENTADO = '798ca7a5-cfa9-4416-ba92-f38b813b526f';
const SECCION = '49abea02-ab27-4428-8fdb-6b36657fcde3';

const TARGETS: MentionTarget[] = [
  { id: REAL, title: 'Cómo está organizada la empresa', type: 'lesson' },
  { id: '70bc0922-bd8b-4cc9-aaf2-73b7db9fb5f8', title: 'Elementos de protección personal', type: 'lesson' },
  { id: SECCION, title: 'La empresa por dentro', type: 'section' },
  { id: '8babaa1f-354c-4374-aedb-1fa4bd344496', title: 'Examen', type: 'exercise' },
  { id: 'intro-a', title: 'Introducción', type: 'lesson' },
  { id: 'intro-b', title: 'Introducción', type: 'lesson' }
];

describe('adónde apunta un enlace', () => {
  it('deja pasar un id que existe', () => {
    expect(resolveMention({ type: 'lesson', id: REAL, title: 'lo que sea' }, TARGETS)).toEqual({
      status: 'ok',
      type: 'lesson',
      id: REAL
    });
  });

  it('repara el id inventado por el título — el caso medido', () => {
    expect(resolveMention({ type: 'lesson', id: INVENTADO, title: 'Cómo está organizada la empresa' }, TARGETS)).toEqual({
      status: 'repaired',
      type: 'lesson',
      id: REAL
    });
  });

  it('perdona acentos, mayúsculas y puntuación del título', () => {
    const r = resolveMention({ type: 'lesson', id: INVENTADO, title: 'como esta organizada la EMPRESA.' }, TARGETS);

    expect(r.id).toBe(REAL);
  });

  it('NO repara por un título parcial: así se manda al docente a la lección equivocada', () => {
    expect(resolveMention({ type: 'lesson', id: INVENTADO, title: 'Cómo está organizada' }, TARGETS).status).toBe(
      'unknown'
    );
  });

  it('NO adivina entre dos ítems con el mismo título', () => {
    expect(resolveMention({ type: 'lesson', id: INVENTADO, title: 'Introducción' }, TARGETS).status).toBe('unknown');
  });

  it('el título del tipo pedido gana sobre el tipo real de un id ajeno', () => {
    // «lesson:<id de una sección>» con el título de una lección: se quiso decir
    // la lección, no la sección a la que pertenece el id suelto.
    expect(resolveMention({ type: 'lesson', id: SECCION, title: 'Cómo está organizada la empresa' }, TARGETS)).toEqual({
      status: 'repaired',
      type: 'lesson',
      id: REAL
    });
  });

  it('si el título no sirve, un id real de otro tipo lleva a ese ítem', () => {
    expect(resolveMention({ type: 'lesson', id: SECCION, title: 'otra cosa' }, TARGETS)).toEqual({
      status: 'repaired',
      type: 'section',
      id: SECCION
    });
  });

  it('sin la estructura del curso cargada, no toca nada', () => {
    // Marcar como roto lo que no se puede comprobar rompería enlaces buenos.
    expect(resolveMention({ type: 'lesson', id: INVENTADO, title: 'x' }, [])).toEqual({
      status: 'ok',
      type: 'lesson',
      id: INVENTADO
    });
    expect(resolveMention({ type: 'lesson', id: INVENTADO, title: 'x' }, undefined).status).toBe('ok');
  });
});

describe('el enlace que se dibuja', () => {
  it('el id inventado ya no aparece: el enlace lleva a la lección real', () => {
    const html = renderMentions(`Listo: @[Cómo está organizada la empresa](lesson:${INVENTADO}).`, CURSO, TARGETS);

    expect(html).toContain(`href="/courses/${CURSO}/lessons/${REAL}"`);
    expect(html).toContain(`data-mention-route="/courses/${CURSO}/lessons/${REAL}"`);
    expect(html).not.toContain(INVENTADO);
    expect(html).not.toContain('data-mention-unverified');
  });

  it('repara también el enlace que el markdown ya convirtió en <a>', () => {
    const html = renderMentions(`<a href="lesson:${INVENTADO}">Cómo está organizada la empresa</a>`, CURSO, TARGETS);

    expect(html).toContain(`/courses/${CURSO}/lessons/${REAL}`);
    expect(html).not.toContain(INVENTADO);
  });

  it('lo que no se puede resolver queda marcado, con lo que escribió el agente', () => {
    const html = renderMentions(`@[Algo que no existe](lesson:${INVENTADO})`, CURSO, TARGETS);

    expect(html).toContain('data-mention-unverified="true"');
    expect(html).toContain(`data-mention-id="${INVENTADO}"`);
    expect(html).toContain('data-mention-title="Algo que no existe"');
  });

  it('sin estructura, se dibuja como siempre y sin marca', () => {
    const html = renderMentions('@[Una lección](lesson:abc-123)', CURSO);

    expect(html).toContain(`href="/courses/${CURSO}/lessons/abc-123"`);
    expect(html).not.toContain('data-mention-unverified');
  });

  it('secciones y ejercicios usan sus propias rutas', () => {
    const html = renderMentions(`@[Examen](exercise:${INVENTADO}) y @[La empresa por dentro](section:${INVENTADO})`, CURSO, TARGETS);

    expect(html).toContain(`/courses/${CURSO}/exercises/8babaa1f-354c-4374-aedb-1fa4bd344496`);
    expect(html).toContain(`/courses/${CURSO}/lessons#section-${SECCION}`);
  });

  it('el título que escribió el agente no se cuela como HTML', () => {
    const html = renderMentions('@[a"><img src=x onerror=alert(1)>](lesson:abc)', CURSO, TARGETS);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
  });

  it('la landing page no se toca', () => {
    const html = renderMentions('@[Portada](landingpage)', CURSO, TARGETS);

    expect(html).toContain(`href="/courses/${CURSO}/landingpage"`);
  });
});
