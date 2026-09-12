import { MAX_HALLAZGOS, verificarTokens } from '@api/services/agent/grounding-tokens';

/**
 * El chequeo determinista de tokens.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * Que los datos que se pueden BUSCAR en la fuente se busquen, en vez de
 * preguntarle a un modelo si le parecen razonables.
 *
 * El caso que lo motivó: una sección de onboarding escrita a partir de una
 * página web de menos de 200 palabras enseñaba seis marcas que la empresa no
 * representa, dieciséis localidades donde no opera, una población, una
 * temperatura, dos cartas de color y una cita a una sección del sitio que no
 * existe. El verificador con modelo, corrido tres veces por lección, marcó
 * algunas de esas familias una vez y otras ninguna. Todas eran tokens: estaban
 * en el texto de la fuente o no estaban.
 *
 * Los casos de abajo son un calco de esa sección con nombres inventados, más
 * —y esto importa igual— los casos donde el chequeo NO tiene que marcar nada:
 * el número que es andamiaje pedagógico, la mayúscula que sólo empieza una
 * oración, y el dato que la fuente sí dice pero escrito con otra tilde. Un
 * chequeo literal que grite de más termina tapado, y entonces no sirve para lo
 * que fue hecho.
 */

const FUENTE = {
  fileName: 'lumen (lumen.example)',
  text: `
QUIENES SOMOS

Fábrica Lumen es una empresa con más de 20 años de trayectoria en iluminación
técnica para obra e industria.

MARCAS CON LAS QUE TRABAJAMOS: Vestra, Korden, Halbex.

NUESTROS LOCALES
Av. Belgrano 120, Maipú
Teléfono +54 11 4555 7000

LINEA DE PRODUCTOS
El sellador Lumen es un sellador acrílico de base acuosa y secado rápido.
Disponible en envases de 1, 4 y 20 litros.
`
};

function verificar(texto: string) {
  return verificarTokens({ texto, fuentes: [FUENTE] });
}

function valores(texto: string) {
  return verificar(texto).map((h) => h.valor);
}

describe('tokens que la fuente no respalda', () => {
  describe('lo que tiene que marcar', () => {
    it('marca una marca que la fuente no nombra', () => {
      const hallazgos = verificar(
        'Somos distribuidores oficiales de firmas como Vestra, Arlux y Tenova, entre otras.'
      );

      expect(hallazgos.map((h) => h.valor)).toEqual(expect.arrayContaining(['Arlux', 'Tenova']));
      // Vestra sí está en la fuente: marcarla sería el falso positivo que
      // vuelve inservible a todo el chequeo.
      expect(hallazgos.map((h) => h.valor)).not.toContain('Vestra');
    });

    it('marca una localidad inventada, como una sola cosa y no palabra por palabra', () => {
      const hallazgos = verificar('Llegamos con entregas periódicas a San Vicente del Sur y a Villa Clara.');

      expect(hallazgos.map((h) => h.valor)).toEqual(
        expect.arrayContaining(['San Vicente del Sur', 'Villa Clara'])
      );
      expect(hallazgos).toHaveLength(2);
    });

    it('marca un número con unidad que la fuente no dice', () => {
      expect(valores('En verano la temperatura supera los 45 °C durante semanas.')).toContain('45 °C');
    });

    it('marca una magnitud grande aunque no traiga unidad', () => {
      expect(valores('El área metropolitana concentra 500.000 habitantes.')).toContain('500.000 habitantes');
    });

    it('marca una sigla inventada', () => {
      expect(valores('Somos referentes en toda la región del NCA.')).toContain('NCA');
    });

    it('marca una cita a una sección de la fuente que no existe', () => {
      // La sección real se llama «QUIENES SOMOS». Citar otra deja al lector
      // buscando algo que no va a encontrar.
      expect(valores('Más detalle en «SOBRE NOSOTROS», donde figura la historia completa.')).toContain(
        'SOBRE NOSOTROS'
      );
    });

    /**
     * El caso que originó todo el trabajo vivía DENTRO de un diagrama: una caja
     * inventada en un organigrama. `textoDeLeccion` entrega las etiquetas del
     * SVG como `[diagram: …]`, y un chequeo que no las mire no mira donde
     * apareció el problema.
     */
    it('marca una etiqueta inventada dentro de un diagrama', () => {
      expect(valores('La estructura se resume así: [diagram: Casa Central · Planta Rosalía · Depósito]')).toContain(
        'Planta Rosalía'
      );
    });

  });

  /**
   * El límite, escrito como test para que nadie lo descubra en producción.
   *
   * Este chequeo mira TOKENS. Una contradicción redactada en minúscula y sin
   * nombres propios —la fuente dice que el sellador es «de base acuosa» y la
   * lección enseña que es «al aguarrás»— no tiene ningún token que buscar: las
   * dos frases están hechas de palabras comunes. Eso es trabajo del verificador
   * con modelo, y por eso los dos existen.
   *
   * Fijarlo acá evita la conclusión peligrosa: que si esto no marca nada, la
   * lección está fundada.
   */
  describe('lo que este chequeo NO puede ver', () => {
    it('no ve una contradicción en prosa, sin nombres ni números', () => {
      expect(verificar('El sellador Lumen es al aguarrás y se aplica sobre revoque seco.')).toEqual([]);
    });

    it('no ve una misión inventada, porque está escrita con palabras comunes', () => {
      expect(
        verificar('Nuestra misión es proveer soluciones integrales con el mejor asesoramiento de la región.')
      ).toEqual([]);
    });
  });

  describe('lo que NO tiene que marcar', () => {
    it('no marca lo que la fuente dice, aunque cambien las tildes', () => {
      expect(verificar('Fabrica Lumen trabaja con Vestra y Korden desde hace 20 años.')).toEqual([]);
    });

    it('no marca los números que son andamiaje pedagógico', () => {
      // «3 pilares» y «paso 2» no son afirmaciones sobre la empresa. Sin este
      // filtro, toda lección bien escrita sale marcada.
      expect(verificar('Repasemos los 3 pilares del método y volvamos al paso 2 del procedimiento.')).toEqual([]);
    });

    it('no marca una palabra por empezar una oración', () => {
      // En español toda oración arranca en mayúscula: tomar eso como nombre
      // propio marcaría media lección.
      expect(verificar('Cuando atendés a un cliente, escuchá primero. Entender el problema viene antes.')).toEqual(
        []
      );
    });

    it('no marca nada cuando la lección no tiene fuentes', () => {
      // Una lección escrita desde el conocimiento general es legítima y se
      // declara en otro lado. Contrastarla contra la nada marcaría todo.
      expect(verificarTokens({ texto: 'Arlux fabrica 500.000 unidades en Villa Clara.', fuentes: [] })).toEqual([]);
    });

    it('cuenta una vez la marca que aparece tres veces', () => {
      const hallazgos = verificar('Arlux es clave. Con Arlux trabajamos hace años. Preferí Arlux siempre.');

      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0].valor).toBe('Arlux');
    });
  });

  /**
   * Los tres los encontró la medición contra la sección real, no el diseño.
   * Cada uno era un error silencioso: el chequeo decía «todo bien» sobre un
   * dato inventado, o acusaba a la lección de un dato que había copiado bien.
   */
  describe('bugs que la medición destapó', () => {
    it('no da por respaldada una sigla que sólo está DENTRO de otra palabra', () => {
      // «NEA» pasaba como fundada porque la fuente dice «LINEA DE PRODUCTOS»:
      // la región inventada se repetía veintiuna veces en la sección real y el
      // chequeo la dejaba pasar por una coincidencia de tres letras.
      expect(valores('Somos líderes en toda la región del NEA desde hace años.')).toContain('NEA');
    });

    it('acepta un teléfono escrito con separadores distintos que la fuente', () => {
      // La fuente lo trae pegado dentro de un enlace y la lección lo separa en
      // grupos. Marcarlo sería acusarla de inventar el número que copió bien.
      expect(verificar('Escribinos al +54 11 4555 7000 de lunes a viernes.')).toEqual([]);
    });

    it('juzga el nombre y no la categoría que lo precede', () => {
      // «Provincia de Maipú» agrega una categoría sobre un dato que la fuente
      // sí tiene. Lo que se verifica es Maipú, y Maipú está.
      expect(verificar('Cubrimos toda la Provincia de Maipú con entregas propias.')).toEqual([]);
    });
  });

  /**
   * Las dos clases de ruido que aparecieron al correrlo contra una sección
   * recién escrita en produccion. Las dos son "donde la mayuscula o las
   * comillas NO significan nada", y por eso se arreglan con una regla y no con
   * una lista de palabras.
   */
  describe('donde las comillas y la mayúscula no dicen nada', () => {
    it('no marca el parlamento inventado de un ejemplo', () => {
      // Una lección tiene todo el derecho de escribir lo que dice un cliente en
      // un caso práctico. Marcarlo era 3 de 14 hallazgos de una sección.
      expect(
        verificar('Respuesta transaccional: "Llevate este sellador de 4 litros y pasale dos manos".')
      ).toEqual([]);
    });

    it('sí marca una cita corta, que es el nombre de una sección', () => {
      // La sección real se llama «QUIENES SOMOS». Esta es la cita que importa.
      expect(valores('Más detalle en «SOBRE NOSOTROS».')).toContain('SOBRE NOSOTROS');
    });

    it('no marca una palabra sola dentro de un diagrama', () => {
      // En una etiqueta la capital es tipográfica: «Sinergia», «Diagnóstico».
      expect(verificar('El modelo se resume así: [diagram: Sinergia · Diagnóstico · Mejora]')).toEqual([]);
    });

    it('sí marca una caja de dos palabras dentro de un diagrama', () => {
      // Que es el caso por el que existe todo esto: una caja inventada en un
      // organigrama.
      expect(valores('La estructura: [diagram: Casa Central · Planta Rosalía]')).toContain('Planta Rosalía');
    });
  });

  /**
   * Una unidad que termina en un signo —«%», «°», «m²»— también es un dato.
   *
   * El patrón cerraba con `\b`, y entre «%» y un espacio no hay límite de
   * palabra: la unidad se caía, quedaba el número pelado y, por debajo de mil,
   * se descartaba. En producción el chequeo había marcado 20 números en 7
   * lecciones y ningún porcentaje, aunque 9 lecciones contrastadas tenían alguno
   * escrito — entre ellas una que inventó «el 30% restante».
   */
  describe('las unidades que terminan en un signo', () => {
    const TALLER = [{ fileName: 'taller.pptx', text: 'El turno de la tarde resuelve el 70% de la actualización.' }];
    const numeros = (texto: string) =>
      verificarTokens({ texto, fuentes: TALLER })
        .filter((hallazgo) => hallazgo.tipo === 'numero')
        .map((hallazgo) => hallazgo.valor);

    it('marca un porcentaje inventado seguido de espacio, coma o punto', () => {
      expect(numeros('La noche completa el 30% restante, y audita el 100%.')).toEqual(['30 %', '100 %']);
    });

    it('no marca el porcentaje que la fuente sí dice', () => {
      expect(numeros('La tarde resuelve el 70% de la actualización.')).toEqual([]);
    });

    it('marca grados y metros cuadrados sueltos', () => {
      expect(numeros('Se guarda a 40 ° y el depósito tiene 120 m² libres.')).toEqual(['40 °', '120 m²']);
    });

    it('una unidad no es el comienzo de una palabra más larga', () => {
      expect(numeros('Se usan unos 10 gramos por envase.')).toEqual([]);
    });
  });

  describe('la forma del hallazgo', () => {
    it('trae el tipo y un contexto donde ubicarlo', () => {
      const [hallazgo] = verificar('El área metropolitana concentra 500.000 habitantes y mucha obra nueva.');

      expect(hallazgo.tipo).toBe('numero');
      expect(hallazgo.contexto).toContain('500.000');
    });

    it('no devuelve una lista interminable', () => {
      const muchos = Array.from({ length: 40 }, (_, i) => `La planta Zeta${i} produce 10.00${i} unidades.`).join(' ');

      expect(verificar(muchos).length).toBeLessThanOrEqual(MAX_HALLAZGOS);
    });
  });
});
