import {
  buscarEnLecciones,
  MAX_COINCIDENCIAS,
  MAX_POR_LECCION,
  MIN_LARGO_BUSQUEDA
} from '@api/services/agent/lesson-search';

/**
 * Buscar dentro de las lecciones.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * Medido: una ronda para sacar afirmaciones inventadas de tres lecciones gastó
 * 17 llamadas a `get_lesson_content` e hizo 2 de las 8 ediciones que le
 * faltaban antes de que el techo de pasos la cortara. El modelo estaba
 * BUSCANDO, y para el contenido del curso la única herramienta era «dame la
 * lección entera».
 *
 * Antes de esto se intentó avisarle en cada paso que dejara de leer. El aviso
 * llegó quince veces y siguió leyendo. Un bucle no se arregla pidiéndole al
 * modelo que se contenga.
 *
 * ── Los bordes que importan ──────────────────────────────────────────────────
 *
 * Los tres primeros me costaron una vuelta cada uno HOY, buscando a mano sobre
 * el mismo contenido: el acento que hace fallar el patrón, la etiqueta que pega
 * dos palabras que nadie escribió junto, y la subcadena que coincide dentro de
 * otra palabra.
 */

const LECCIONES = [
  {
    id: 'l1',
    title: 'Presencia regional',
    content:
      '<h3 data-block-id="b1">Dónde estamos</h3>' +
      '<p data-block-id="b2">Operamos en la región de Valdenia Central (VCE), sobre ambas márgenes del río Tamán.</p>' +
      '<p data-block-id="b3">Las dos sucursales atienden al público de lunes a viernes.</p>'
  },
  {
    id: 'l2',
    title: 'Historia',
    content: '<p>Más de 30 años de trayectoria en el rubro.</p><p>Trabajamos en toda la región.</p>'
  }
];

const buscar = (texto: string) => buscarEnLecciones({ lecciones: LECCIONES, texto });

describe('buscar dentro de las lecciones', () => {
  describe('lo que tiene que encontrar', () => {
    it('encuentra el texto y dice en qué lección y en qué bloque', () => {
      const [hallazgo] = buscar('Valdenia Central');

      expect(hallazgo.lessonId).toBe('l1');
      expect(hallazgo.title).toBe('Presencia regional');
      expect(hallazgo.blockId).toBe('b2');
    });

    it('devuelve contexto alrededor, para decidir sin abrir la lección', () => {
      // Es el punto de todo esto: el fragmento tiene que alcanzar para saber
      // si hay que editar, sin pagar la lección entera.
      const [hallazgo] = buscar('VCE');

      expect(hallazgo.fragmento).toContain('Valdenia Central');
      expect(hallazgo.fragmento).toContain('Tamán');
    });

    it('encuentra aunque falte el acento', () => {
      // El que busca escribe "taman". Hoy perdí una vuelta entera por
      // patrones que no coincidían por un acento.
      expect(buscar('taman').map((c) => c.lessonId)).toEqual(['l1']);
    });

    it('encuentra aunque cambien las mayúsculas', () => {
      expect(buscar('valdenia central')).toHaveLength(1);
    });

    it('recorre todas las lecciones, no sólo la primera', () => {
      expect(buscar('region').map((c) => c.lessonId)).toEqual(['l1', 'l2']);
    });

    it('no devuelve nada cuando no está', () => {
      expect(buscar('Marquesada')).toEqual([]);
    });
  });

  describe('lo que NO tiene que encontrar', () => {
    it('no busca dentro del HTML', () => {
      // Sin esto, buscar "block" coincide con cada bloque y "p" con todo.
      expect(buscar('data-block-id')).toEqual([]);
      expect(buscar('h3')).toEqual([]);
    });

    it('no pega el encabezado con el párrafo que le sigue', () => {
      // «Dónde estamos» + «Operamos» no forman «estamos Operamos» como una
      // frase: el límite de etiqueta separa. Es el mismo error que me dio
      // falsos positivos en el chequeo de tokens.
      expect(buscar('estamosOperamos')).toEqual([]);
    });

    it('no acepta una búsqueda demasiado corta', () => {
      // Dos letras coinciden con media lección y el resultado no sirve.
      expect(buscar('ea')).toEqual([]);
      expect('ea'.length).toBeLessThan(MIN_LARGO_BUSQUEDA);
    });

    it('no se cae con una lección vacía', () => {
      expect(buscarEnLecciones({ lecciones: [{ id: 'x', title: 'X', content: '' }], texto: 'algo' })).toEqual([]);
    });
  });

  describe('los topes, porque esto va al contexto del modelo', () => {
    it('no devuelve más de unas pocas coincidencias por lección', () => {
      const repetida = {
        id: 'r',
        title: 'Repetida',
        content: Array.from({ length: 20 }, () => '<p>La región es amplia.</p>').join('')
      };
      const encontradas = buscarEnLecciones({ lecciones: [repetida], texto: 'region' });

      expect(encontradas.length).toBeLessThanOrEqual(MAX_POR_LECCION);
    });

    it('tiene un tope total aunque haya muchas lecciones', () => {
      const muchas = Array.from({ length: 40 }, (_, i) => ({
        id: `l${i}`,
        title: `Lección ${i}`,
        content: '<p>La región es amplia.</p>'
      }));

      expect(buscarEnLecciones({ lecciones: muchas, texto: 'region' }).length).toBeLessThanOrEqual(
        MAX_COINCIDENCIAS
      );
    });

    it('avanza en vez de devolver la misma coincidencia', () => {
      // Un `indexOf` sin mover el cursor devuelve siempre la primera y el
      // resultado parece un tope alcanzado cuando en realidad es un bucle.
      //
      // Las dos apariciones van MUY separadas a propósito: con un párrafo
      // corto los dos fragmentos abarcan todo el texto y salen iguales aunque
      // el cursor funcione, así que el test no probaría nada. Eso me lo
      // enseñó este test fallando.
      const lejos = 'palabra '.repeat(60);
      const dos = {
        id: 'd',
        title: 'Dos',
        content: `<p>Primero la región norte. ${lejos}</p><p>${lejos} Después la región sur.</p>`
      };
      const encontradas = buscarEnLecciones({ lecciones: [dos], texto: 'region' });

      expect(encontradas).toHaveLength(2);
      expect(encontradas[0].fragmento).toContain('norte');
      expect(encontradas[1].fragmento).toContain('sur');
      expect(encontradas[0].fragmento).not.toBe(encontradas[1].fragmento);
    });
  });

  describe('la coincidencia sin bloque', () => {
    it('no inventa un blockId cuando el contenido no los tiene', () => {
      // Contenido viejo, escrito antes de que el editor estampara ids.
      const [hallazgo] = buscarEnLecciones({ lecciones: [LECCIONES[1]], texto: 'trayectoria' });

      expect(hallazgo.blockId).toBeUndefined();
    });
  });
});
