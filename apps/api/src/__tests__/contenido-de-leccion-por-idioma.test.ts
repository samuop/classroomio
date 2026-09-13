import { contenidoEnIdioma } from '@api/services/agent/lesson-content-locale';
import { describe, expect, it } from 'vitest';

/**
 * Un curso en español pedido sin idioma dejaba al tutor leyendo lecciones vacías.
 */
describe('contenidoEnIdioma', () => {
  const enEspanol = [{ locale: 'es', content: '<p>Los libros se devuelven en el mostrador.</p>' }];

  it('devuelve el idioma pedido', () => {
    const ambos = [...enEspanol, { locale: 'en', content: '<p>Books are returned at the desk.</p>' }];
    expect(contenidoEnIdioma(ambos, 'es')).toBe(enEspanol[0].content);
    expect(contenidoEnIdioma(ambos, 'en')).toBe('<p>Books are returned at the desk.</p>');
  });

  it('con una lección sólo en español, pedida en inglés, devuelve el español en vez de nada', () => {
    expect(contenidoEnIdioma(enEspanol, 'en')).toBe(enEspanol[0].content);
  });

  it('salta las filas vacías', () => {
    const conHueco = [{ locale: 'en', content: '   ' }, ...enEspanol];
    expect(contenidoEnIdioma(conHueco, 'en')).toBe(enEspanol[0].content);
  });

  it('sin ninguna fila con texto devuelve null', () => {
    expect(contenidoEnIdioma([], 'es')).toBeNull();
    expect(contenidoEnIdioma(undefined, 'es')).toBeNull();
    expect(contenidoEnIdioma([{ locale: 'es', content: null }], 'es')).toBeNull();
  });
});
