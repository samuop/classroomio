import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ADD_ATTR } from '@cio/utils/functions';
import { buildLessonWriterPrompt } from '@cio/ai-assistant';
import { normalizeAgentLessonContent } from '@api/services/agent/lesson-content';
import { textoParaTokens, verificarTokens } from '@api/services/agent/grounding-tokens';
import { textoDeLeccion } from '@api/services/agent/grounding';
import {
  ATRIBUTO_EJEMPLO,
  ATRIBUTO_SIN_FUENTE,
  extraerEjemplos,
  extraerPasajesSinFuente,
  quitarPasajesMarcados
} from '@api/services/agent/unsupported-passages';

/**
 * La cuarta jugada del escritor: declarar el ejemplo que se inventó.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * Medido el 2026-09-21/22 sobre cinco lecciones: cero marcas `data-sin-fuente`
 * y hallazgos de tokens en todas. Casi todos vivían en los EJEMPLOS —el nombre
 * y el legajo de un empleado, un «Error 404», un «24/7»— que es justo donde
 * marcar `data-sin-fuente` habría estado MAL: un ejemplo inventado no es una
 * afirmación falsa sobre la empresa, es cómo se enseña.
 *
 * Con las dos marcas, «este número no está en la fuente» pasa a tener una
 * respuesta que no empeora la lección. Lo que hace falta fijar es la mitad
 * frágil, que no es la extracción sino que la marca SIRVA:
 *
 *   1. que sobreviva el camino de guardado (el saneador corre con
 *      `ALLOW_DATA_ATTR: false`: un atributo no declarado se borra sin un solo
 *      error, y el ejemplo queda otra vez indistinguible de un dato copiado);
 *   2. que el editor no la tire la primera vez que el docente abre y guarda;
 *   3. que lo marcado NO cuente como token sin respaldo. Si contara, marcar no
 *      serviría de nada y el escritor aprendería a no hacerlo — o sea, el
 *      sistema estaría gritando por lo que él mismo le pidió.
 */

const leer = (relativo: string) => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8');

const FUENTE = {
  fileName: 'circular.docx',
  text: 'La Mesa de Ayuda de Distribuidora Andina atiende de 8 a 18. Teléfono 4555 7000.'
};

describe('los ejemplos que el escritor declara', () => {
  describe('lo que extrae', () => {
    it('saca el texto del ejemplo y para qué sirve', () => {
      const ejemplos = extraerEjemplos(
        `<p ${ATRIBUTO_EJEMPLO}="un caso inventado para mostrar la regla">Marina recibe la factura 4471.</p>`
      );

      expect(ejemplos).toEqual([
        { texto: 'Marina recibe la factura 4471.', porque: 'un caso inventado para mostrar la regla' }
      ]);
    });

    it('marca el listado entero cuando todo el listado es el ejemplo', () => {
      const ejemplos = extraerEjemplos(
        `<ul ${ATRIBUTO_EJEMPLO}="tres casos inventados"><li>Uno</li><li>Dos</li><li>Tres</li></ul>`
      );

      expect(ejemplos).toHaveLength(1);
      expect(ejemplos[0].texto).toBe('Uno Dos Tres');
    });

    it('no confunde las dos marcas: cada una va a su lista', () => {
      // La distinción es el punto de que sean dos. Un informe que las sumara
      // volvería a perder lo único que separa un pendiente del docente —material
      // que tiene que confirmar— de una ilustración que nadie tiene que buscar.
      const html =
        `<p ${ATRIBUTO_SIN_FUENTE}="la circular no dice quién autoriza">Autoriza el jefe de turno.</p>` +
        `<p ${ATRIBUTO_EJEMPLO}="caso inventado">Marina recibe la factura 4471.</p>`;

      expect(extraerPasajesSinFuente(html)).toHaveLength(1);
      expect(extraerPasajesSinFuente(html)[0].texto).toBe('Autoriza el jefe de turno.');
      expect(extraerEjemplos(html)).toHaveLength(1);
      expect(extraerEjemplos(html)[0].texto).toBe('Marina recibe la factura 4471.');
    });

    it('no marca nada en una lección sin ejemplos', () => {
      expect(extraerEjemplos('<p>La mesa atiende de 8 a 18.</p>')).toEqual([]);
      expect(extraerEjemplos('')).toEqual([]);
    });
  });

  describe('sacar lo marcado antes de contrastar', () => {
    it('saca el elemento marcado y deja el resto', () => {
      const html = `<p>La mesa atiende de 8 a 18.</p><p ${ATRIBUTO_EJEMPLO}="caso">Factura 4471.</p><p>Fin.</p>`;
      const limpio = quitarPasajesMarcados(html);

      expect(limpio).toContain('La mesa atiende de 8 a 18.');
      expect(limpio).toContain('Fin.');
      expect(limpio).not.toContain('4471');
    });

    it('saca también los pasajes sin fuente', () => {
      const html = `<p ${ATRIBUTO_SIN_FUENTE}="no está">Autoriza el jefe.</p><p>Queda.</p>`;

      expect(quitarPasajesMarcados(html)).not.toContain('Autoriza');
      expect(quitarPasajesMarcados(html)).toContain('Queda.');
    });

    it('un ejemplo adentro de un pasaje marcado no se corta dos veces', () => {
      // Las dos listas son de primer nivel POR SEPARADO, así que sus tramos se
      // solapan. Cortar dos veces el mismo tramo se comería texto que nadie
      // marcó — y eso lo devolvería como «sin respaldo» al chequeo siguiente.
      const html =
        `<blockquote ${ATRIBUTO_SIN_FUENTE}="no está"><p ${ATRIBUTO_EJEMPLO}="caso">Factura 4471.</p></blockquote>` +
        '<p>Este párrafo no está marcado.</p>';

      expect(quitarPasajesMarcados(html)).toContain('Este párrafo no está marcado.');
      expect(quitarPasajesMarcados(html)).not.toContain('4471');
    });

    it('no toca una lección sin marcas ni se rompe con una vacía', () => {
      expect(quitarPasajesMarcados('<p>Nada marcado.</p>')).toBe('<p>Nada marcado.</p>');
      expect(quitarPasajesMarcados('')).toBe('');
    });

    it('no pega el texto de antes con el de después', () => {
      // Los dos chequeos aplanan el HTML a texto. Sin un separador, «turno» y
      // «Cierre» se leerían como una sola frase e inventarían un nombre propio
      // que nadie escribió — el chequeo ya tuvo ese falso positivo una vez.
      const html = `Turno<p ${ATRIBUTO_EJEMPLO}="caso">Factura 4471.</p>Cierre`;

      expect(quitarPasajesMarcados(html)).not.toContain('TurnoCierre');
    });
  });

  /**
   * El que muerde: lo marcado no puede seguir contando como dato sin respaldo.
   */
  describe('lo marcado no cuenta como token sin respaldo', () => {
    const tokens = (html: string) =>
      verificarTokens({ texto: textoParaTokens(html), fuentes: [FUENTE] }).map((h) => h.valor);

    it('el número de un ejemplo marcado no se reporta', () => {
      const html = `<p ${ATRIBUTO_EJEMPLO}="un caso inventado">La factura 4471 llega el martes.</p>`;

      expect(tokens(html)).toContain('4471');
      expect(tokens(quitarPasajesMarcados(html))).toEqual([]);
    });

    it('y el número que está AFUERA del ejemplo sigue reportándose', () => {
      // La marca no es un permiso para el resto de la lección: si lo fuera,
      // marcar un párrafo apagaría el chequeo de los otros diez.
      const html =
        `<p ${ATRIBUTO_EJEMPLO}="un caso inventado">La factura 4471 llega el martes.</p>` +
        '<p>La mesa atiende 24500 pedidos por mes.</p>';

      expect(tokens(quitarPasajesMarcados(html))).toEqual(['24500']);
    });

    it('el verificador con modelo tampoco ve el ejemplo marcado', () => {
      // `citaAparece` se comprueba contra este mismo texto, así que un
      // verificador que quisiera citar el ejemplo no podría: no llegó a verlo.
      const html = `<p>La mesa atiende de 8 a 18.</p><p ${ATRIBUTO_EJEMPLO}="caso">Factura 4471.</p>`;

      expect(textoDeLeccion(quitarPasajesMarcados(html))).not.toContain('4471');
    });
  });

  /**
   * Los tres tramos donde la marca desaparecería en silencio.
   */
  describe('el camino de guardado', () => {
    it('la marca está declarada en la lista blanca del saneador', () => {
      // `ALLOW_DATA_ATTR: false`: lo que no está acá se borra sin un error, y el
      // informe sigue saliendo bien porque se calcula antes de sanear.
      expect(ADD_ATTR).toContain(ATRIBUTO_EJEMPLO);
    });

    it('la normalización del contenido del agente la conserva', () => {
      const normalizado = normalizeAgentLessonContent(
        `<p ${ATRIBUTO_EJEMPLO}="un caso inventado">Marina recibe la factura 4471.</p>`,
        'Facturación'
      );

      expect(extraerEjemplos(normalizado)).toHaveLength(1);
    });

    /**
     * TipTap tira todo atributo que ninguna extensión declare, en silencio. Sin
     * la extensión, la primera vez que el docente abre y guarda la lección
     * desaparecen TODAS las marcas de la página, incluidas las de los párrafos
     * que no miró.
     */
    it('el editor declara el atributo y registra la extensión', () => {
      const extension = leer('../../../../packages/ui/src/custom/editor/extensions/ejemplo/Ejemplo.ts');
      const editor = leer('../../../../packages/ui/src/custom/editor/editor.ts');

      expect(extension).toContain(`EJEMPLO_ATTRIBUTE = '${ATRIBUTO_EJEMPLO}'`);
      expect(editor).toMatch(/import \{ Ejemplo \} from '\.\/extensions\/ejemplo\/Ejemplo'/);
      expect(editor).toMatch(/^\s+Ejemplo,$/m);
    });
  });

  describe('el prompt del escritor', () => {
    const PROMPT = buildLessonWriterPrompt();

    it('le da la jugada y la nombra por su atributo', () => {
      expect(PROMPT).toContain('Worked examples are yours');
      expect(PROMPT).toContain(ATRIBUTO_EJEMPLO);
    });

    it('la pone entre los atributos que puede escribir', () => {
      // Una capacidad nueva con la prohibición vieja puesta queda muerta y sin
      // ningún error: ya pasó dos veces en este proyecto.
      expect(PROMPT).toMatch(new RegExp(`only attributes you may add[^\\n]*${ATRIBUTO_EJEMPLO}`));
    });

    it('dice en qué se diferencia de la otra marca', () => {
      expect(PROMPT).toMatch(new RegExp(`${ATRIBUTO_SIN_FUENTE}\\s*\`? = a claim about THIS organisation`));
    });
  });
});
