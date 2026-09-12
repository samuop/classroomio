import { ADD_ATTR } from '@cio/utils/functions';
import { normalizeAgentLessonContent } from '@api/services/agent/lesson-content';
import { listLessonBlocks } from '@api/services/agent/lesson-blocks';
import {
  ATRIBUTO_SIN_FUENTE,
  extraerPasajesSinFuente,
  MAX_TEXTO_PASAJE
} from '@api/services/agent/unsupported-passages';

/**
 * La tercera jugada del escritor: marcar EL PASAJE que puso él.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * El caso que lo motivó, medido en producción: una lección sobre las unidades
 * de negocio de una empresa. Los cuatro nombres estaban en la fuente, textuales;
 * lo que cada una HACE no estaba en ninguna parte. El escritor sólo tenía dos
 * salidas —escribir todo o negarse a todo— así que escribió y describió las
 * cuatro. Tres salieron bien por casualidad y una salió materialmente mal.
 *
 * Negarse habría tirado contenido bueno. Lo que faltaba era poder escribir la
 * lección Y decir cuál de sus párrafos es propio.
 *
 * La mitad frágil de esto no es la extracción: es que la marca SOBREVIVA el
 * camino de guardado. Se sanea con `ALLOW_DATA_ATTR: false`, así que un
 * atributo que no esté declarado se borra sin un solo error, el informe sale
 * igual de bien —porque se calcula antes— y el contenido guardado queda sin la
 * marca. O sea el mismo fallo de origen, pero ahora con la apariencia de estar
 * arreglado. Los dos tests de «el camino de guardado» son los que muerden.
 */

const MARCA = 'el sitio nombra las cuatro líneas pero no dice qué productos tiene cada una';

describe('pasajes que el escritor marcó como propios', () => {
  describe('lo que extrae', () => {
    it('saca el texto del pasaje y el motivo', () => {
      const pasajes = extraerPasajesSinFuente(
        `<h3>Unidades de negocio</h3><p ${ATRIBUTO_SIN_FUENTE}="${MARCA}">La línea Halbex reúne selladores.</p>`
      );

      expect(pasajes).toEqual([{ texto: 'La línea Halbex reúne selladores.', porque: MARCA }]);
    });

    it('marca un solo <li> de una lista cuyos demás ítems están fundados', () => {
      // El prompt pide marcar el elemento MÁS CHICO que cubre el pasaje, y en
      // el caso real ese elemento era un ítem de una lista de cuatro.
      const pasajes = extraerPasajesSinFuente(
        '<ul>' +
          '<li>Lumen Obra</li>' +
          `<li ${ATRIBUTO_SIN_FUENTE}="la fuente no dice qué hace esta línea">Halbex: selladores.</li>` +
          '<li>Lumen Industria</li>' +
          '</ul>'
      );

      expect(pasajes).toHaveLength(1);
      expect(pasajes[0].texto).toBe('Halbex: selladores.');
    });

    it('no marca nada en una lección sin marcas', () => {
      expect(extraerPasajesSinFuente('<h3>Locales</h3><p>Av. Belgrano 120.</p>')).toEqual([]);
    });

    it('no se cae con una lección vacía', () => {
      expect(extraerPasajesSinFuente('')).toEqual([]);
    });

    it('devuelve el motivo legible cuando vino con entidades HTML', () => {
      // El motivo lo lee una persona, y viaja dentro de un atributo: las
      // comillas y el ampersand llegan escapados.
      const pasajes = extraerPasajesSinFuente(
        `<p ${ATRIBUTO_SIN_FUENTE}="el organigrama dice &quot;ventas&quot; y nada m&amp;aacute;s">Ventas atiende…</p>`
      );

      expect(pasajes[0].porque).toBe('el organigrama dice "ventas" y nada m&aacute;s');
    });

    it('cuenta una vez el pasaje que tiene otro marcado adentro', () => {
      // Si no, un párrafo marcado dentro de una lista marcada apareceria dos
      // veces y el docente leeria dos pendientes donde hay uno.
      const pasajes = extraerPasajesSinFuente(
        `<ul ${ATRIBUTO_SIN_FUENTE}="toda la lista es mía"><li ${ATRIBUTO_SIN_FUENTE}="y este ítem también">Uno</li></ul>`
      );

      expect(pasajes).toHaveLength(1);
      expect(pasajes[0].porque).toBe('toda la lista es mía');
    });

    it('marca un pasaje aunque el motivo venga vacío', () => {
      // El motivo sirve, pero la marca sola ya dice lo esencial. Descartarla
      // por venir sin explicación sería ocultar justo lo que hay que ver.
      const pasajes = extraerPasajesSinFuente(`<p ${ATRIBUTO_SIN_FUENTE}="">Algo que puse yo.</p>`);

      expect(pasajes).toEqual([{ texto: 'Algo que puse yo.', porque: '' }]);
    });

    it('recorta un pasaje largo en vez de volcar el párrafo entero', () => {
      const largo = 'palabra '.repeat(80);
      const [pasaje] = extraerPasajesSinFuente(`<p ${ATRIBUTO_SIN_FUENTE}="x">${largo}</p>`);

      expect(pasaje.texto.length).toBeLessThanOrEqual(MAX_TEXTO_PASAJE + 1);
      expect(pasaje.texto.endsWith('…')).toBe(true);
    });

    it('descarta una marca sobre un elemento vacío', () => {
      // Sin texto el docente no puede ubicarla en la lección ni decidir nada
      // sobre ella: es una entrada del informe que sólo ocupa lugar.
      expect(extraerPasajesSinFuente(`<p ${ATRIBUTO_SIN_FUENTE}="x"></p><p>Fundado.</p>`)).toEqual([]);
    });

    it('ignora una marca sobre un elemento sin cerrar, en vez de tragarse el resto', () => {
      // Markup desbalanceado: no se sabe dónde termina el pasaje, y adivinar un
      // final reportaría como "marcado" todo lo que venga después.
      expect(extraerPasajesSinFuente(`<p ${ATRIBUTO_SIN_FUENTE}="x">sin cerrar`)).toEqual([]);
    });
  });

  /**
   * Los dos que muerden. Cada uno cubre un tramo donde la marca se borraría en
   * silencio, dejando el informe correcto y la lección guardada sin nada.
   */
  describe('el camino de guardado', () => {
    /**
     * El saneador corre con `ALLOW_DATA_ATTR: false`, así que TODO atributo
     * `data-*` que deba sobrevivir está declarado en `ADD_ATTR`. Si esta marca
     * se cae de esa lista, el contenido se guarda sin ella —sin un error y sin
     * un aviso— y el informe sigue saliendo bien, porque se calcula antes de
     * sanear. O sea: el fallo queda con la apariencia de estar arreglado.
     *
     * Se fija la DECLARACIÓN y no el comportamiento de DOMPurify porque el
     * entorno de tests de la API es `node` y no puede cargar jsdom
     * (`isomorphic-dompurify` explota con ERR_REQUIRE_ESM). El comportamiento
     * con un DOM de verdad se prueba en el dashboard, que corre en jsdom.
     */
    it('la marca está declarada en la lista blanca del saneador', () => {
      expect(ADD_ATTR).toContain(ATRIBUTO_SIN_FUENTE);
    });

    it('la normalización del contenido del agente conserva la marca', () => {
      const normalizado = normalizeAgentLessonContent(
        `<p ${ATRIBUTO_SIN_FUENTE}="${MARCA}">La línea Halbex reúne selladores.</p>`,
        'Unidades de negocio'
      );

      expect(extraerPasajesSinFuente(normalizado)).toHaveLength(1);
    });
  });

  /**
   * El parser de bloques se generalizó para no tener dos copias de la lógica de
   * anidamiento. Esto fija que la generalización no aflojó lo que ya hacía.
   */
  describe('el parser generalizado', () => {
    it('un bloque con id vacío sigue sin ser direccionable', () => {
      // El patrón genérico acepta valor vacío —una marca sin motivo igual es
      // una marca— y un id vacío no direcciona nada: empalmar por él pegaría
      // en el primer bloque que lo tenga.
      const bloques = listLessonBlocks('<p data-block-id="">sin id</p><p data-block-id="b">con id</p>');

      expect(bloques.map((bloque) => bloque.blockId)).toEqual(['b']);
    });
  });
});
