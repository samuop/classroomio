import { describe, expect, it } from 'vitest';
import {
  ROTULO_DE_RESPALDO,
  extraerCitas,
  redactarTokens,
  textoParaTokens,
  valorDeCifra,
  verificarTokens
} from '@api/services/agent/grounding-tokens';
import { palabrasDeLaDocente, textoDelItemDelPlan } from '@api/services/agent/alcance-de-tokens';
import { quitarPasajesMarcados } from '@api/services/agent/unsupported-passages';

/**
 * Qué cuenta como dato sin respaldo, y contra qué se busca.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * Un curso de planillas para vendedores de un comercio que abre todo el día. El
 * chequeo de datos:
 *
 *   - buscaba sólo en las una o dos fuentes asignadas a cada lección, así que
 *     marcaba como inventadas las palabras de la docente («24 hs») y las
 *     pestañas y teclas del programa que figuraban en OTRAS fuentes del curso;
 *   - partía «1,048,576» en «1,048» y «576», así que el «1.048.576» bien
 *     escrito rebotaba, y leía «150.50» como quince mil;
 *   - tomaba el texto de AFUERA de dos pares de comillas rectas como una cita;
 *   - contaba como nombre propio una palabra cuya única minúscula quedaba
 *     adentro de un ejemplo marcado.
 *
 * Todo con fuentes, pedidos y lecciones inventados.
 */

const fuente = (text: string, fileName = 'guia-de-la-planilla.pdf') => ({ fileName, text });

/** Los hallazgos de una lección de un solo párrafo contra una fuente. */
function hallazgos(
  leccion: string,
  fuenteDeLaLeccion: string,
  extra: Partial<Parameters<typeof verificarTokens>[0]> = {}
) {
  return verificarTokens({ texto: leccion, fuentes: [fuente(fuenteDeLaLeccion)], ...extra });
}

const valores = (lista: Array<{ valor: string }>) => lista.map((h) => h.valor);

describe('los números se comparan por valor, en cualquier formato', () => {
  it('«1.048.576» de la lección es el «1,048,576» de la fuente', () => {
    expect(
      hallazgos('La hoja llega hasta 1.048.576 filas.', 'Una hoja tiene 16,384 columnas y 1,048,576 filas.')
    ).toEqual([]);
  });

  it('y es el «1 048 576» de otra fuente, con espacios o espacios duros', () => {
    expect(hallazgos('La hoja llega hasta 1.048.576 filas.', 'Las filas van del 1 al 1 048 576.')).toEqual([]);
    expect(hallazgos('La hoja llega hasta 1.048.576 filas.', 'Las filas van del 1 al 1 048 576.')).toEqual([]);
  });

  it('un precio con centavos no es un dato por su tamaño: «150.50» vale 150,5, no 15050', () => {
    expect(
      hallazgos('Si escribís 150.50 con punto, la planilla lo toma como texto.', 'La planilla usa la coma decimal.')
    ).toEqual([]);
    expect(
      hallazgos('La gaseosa cuesta 25,00 y el alfajor 950,00.', 'Los precios se cargan con dos decimales.')
    ).toEqual([]);
  });

  it('un número inventado se sigue marcando', () => {
    expect(valores(hallazgos('Llega la factura 4471 del proveedor.', 'Las facturas se archivan por fecha.'))).toEqual([
      '4471'
    ]);
  });

  it('«45 °C» no está respaldado por un «4555» cualquiera', () => {
    expect(valores(hallazgos('La cámara se mantiene a 45 °C.', 'Consultas al 4555 7000.'))).toEqual(['45 °C']);
  });

  it('el valor de cada formato', () => {
    expect(valorDeCifra('1.048.576')).toBe('1048576');
    expect(valorDeCifra('1,048,576')).toBe('1048576');
    expect(valorDeCifra('1 048 576')).toBe('1048576');
    expect(valorDeCifra('150.50')).toBe('150.5');
    expect(valorDeCifra('25,00')).toBe('25');
    expect(valorDeCifra('1.500,50')).toBe('1500.5');
    expect(valorDeCifra('0,125')).toBe('0.125');
  });
});

describe('lo que no está en la lección se busca en el resto del curso, el pedido y el plan', () => {
  const FUENTE_DE_LA_LECCION = 'La hoja de cálculo se organiza en filas y columnas.';

  it('un nombre que figura en OTRA fuente del curso queda con su rótulo y no vuelve al modelo', () => {
    const lista = hallazgos('Los gráficos se agregan desde la pestaña Insertar de la cinta.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('Desde Insertar se agregan tablas y gráficos.', 'otra-guia.pdf')] }
    });

    expect(lista).toEqual([
      expect.objectContaining({ valor: 'Insertar', respaldo: 'curso', rotulo: ROTULO_DE_RESPALDO.curso })
    ]);
    expect(redactarTokens(lista)).toEqual([]);
  });

  it('lo que dijo la docente no es un invento: queda como «está en tu pedido»', () => {
    const lista = hallazgos('En un comercio abierto las 24 horas, cada turno carga su caja.', FUENTE_DE_LA_LECCION, {
      ampliacion: { pedido: 'Público: vendedores de un comercio de 24 hs.' }
    });

    expect(lista).toEqual([
      expect.objectContaining({ valor: '24 horas', respaldo: 'pedido', rotulo: 'está en tu pedido' })
    ]);
    expect(redactarTokens(lista)).toEqual([]);
  });

  it('lo que dice el ítem del plan tampoco', () => {
    const lista = hallazgos('La hoja lleva el control de la Caja Chica del local.', FUENTE_DE_LA_LECCION, {
      ampliacion: { plan: 'Registrar la Caja Chica\nUna hoja para los movimientos de la Caja Chica.' }
    });

    expect(lista).toEqual([expect.objectContaining({ valor: 'Caja Chica', respaldo: 'plan' })]);
    expect(redactarTokens(lista)).toEqual([]);
  });

  it('un nombre inventado no aparece en ningún lado y SÍ vuelve al modelo', () => {
    const lista = hallazgos('El proveedor es la marca Arlux, que entrega los lunes.', FUENTE_DE_LA_LECCION, {
      ampliacion: {
        pedido: 'Público: vendedores de un comercio de 24 hs.',
        curso: [fuente('Desde Insertar se agregan tablas y gráficos.', 'otra-guia.pdf')]
      }
    });

    expect(lista).toEqual([expect.objectContaining({ valor: 'Arlux' })]);
    expect(lista[0].respaldo).toBeUndefined();
    expect(redactarTokens(lista)).toEqual([expect.stringContaining('Arlux')]);
  });

  /**
   * Los números NO se amplían comparando dígitos: medido, con once fuentes
   * quedaban «respaldados» 65 de los enteros del 1 al 100, y «45 °C» pasaba por
   * un «45 personas» de cualquier taller. Valor Y unidad.
   */
  it('un número de otra fuente respalda sólo si dice lo mismo con la misma unidad', () => {
    const lista = hallazgos('La cámara se mantiene a 45 °C.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('El taller admite hasta 45 personas.', 'taller.pdf')] }
    });

    expect(lista).toEqual([expect.objectContaining({ valor: '45 °C' })]);
    expect(lista[0].respaldo).toBeUndefined();

    const conLaMismaUnidad = hallazgos('La cámara se mantiene a 45 °C.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('La cámara trabaja a 45°C como máximo.', 'manual.pdf')] }
    });

    expect(conLaMismaUnidad).toEqual([expect.objectContaining({ valor: '45 °C', respaldo: 'curso' })]);
  });

  it('un número SIN unidad no lo respalda el mismo valor con unidad, ni un año', () => {
    // Medido con las fuentes reales como curso: un «2.024 productos» inventado
    // quedaba respaldado por el año 2024 de una fuente.
    const porUnAnio = hallazgos('El depósito guarda 2.024 productos distintos.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('Informe anual 2024 de la cadena.', 'informe.pdf')] }
    });

    expect(porUnAnio).toEqual([expect.objectContaining({ valor: '2.024' })]);
    expect(porUnAnio[0].respaldo).toBeUndefined();

    const porOtraUnidad = hallazgos('El depósito guarda 1.500 productos distintos.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('La cámara carga hasta 1.500 kg.', 'manual.pdf')] }
    });

    expect(porOtraUnidad[0]?.respaldo).toBeUndefined();

    const porElMismoNumero = hallazgos('El depósito guarda 1.500 productos distintos.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('El catálogo tiene 1.500 artículos.', 'catalogo.pdf')] }
    });

    expect(porElMismoNumero).toEqual([expect.objectContaining({ valor: '1.500', respaldo: 'curso' })]);
  });

  it('lo que no está en ningún lado va primero: el tope no puede dejarlo afuera', () => {
    const lista = hallazgos('Desde Insertar se agrega la marca Arlux.', FUENTE_DE_LA_LECCION, {
      ampliacion: { curso: [fuente('Desde Insertar se agregan tablas.', 'otra-guia.pdf')] },
      tope: 1
    });

    expect(valores(lista)).toEqual(['Arlux']);
  });
});

describe('las palabras de la docente y el ítem del plan, como los arma la app', () => {
  const mensajes = [
    { role: 'user', parts: [{ type: 'text', text: 'Público: vendedores de un comercio de 24 hs.' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Propongo usar la marca Arlux en los ejemplos.' }] },
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Construí el curso según el plan aprobado.' }],
      metadata: {
        plan: {
          action: 'implement_course_plan',
          payload: {
            title: 'Planillas para el mostrador',
            sections: [
              {
                title: 'Primeros pasos',
                order: 0,
                items: [
                  {
                    type: 'lesson',
                    title: 'Registrar la Caja Chica',
                    description: 'Una hoja para los movimientos de la Caja Chica del local.',
                    order: 0
                  }
                ]
              }
            ]
          }
        }
      }
    }
  ];

  it('sólo los mensajes de la docente, sin repetir, aunque lleguen de dos lados', () => {
    const pedido = palabrasDeLaDocente(mensajes, [mensajes[0]]);

    expect(pedido).toContain('24 hs');
    expect(pedido).not.toContain('Arlux');
    expect(pedido.match(/24 hs/g)).toHaveLength(1);
  });

  it('el ítem del plan se encuentra por el título de la lección', () => {
    const item = textoDelItemDelPlan(mensajes, ['registrar la caja chica']);

    expect(item).toContain('Una hoja para los movimientos');
    expect(textoDelItemDelPlan(mensajes, ['Otra lección'])).toBe('');
  });
});

describe('las citas', () => {
  it('dos pares de comillas rectas no se cruzan: lo de afuera no es una cita', () => {
    const texto = 'Escribí " Tarde " en vez de "Tarde" y el filtro no lo encuentra.';

    expect(extraerCitas(texto).map((c) => c.valor)).not.toContain('en vez de');
  });

  it('una comilla recta suelta no apaga el chequeo de las citas que vienen después', () => {
    // Una pulgada o el signo explicado en el texto: la comilla no cierra. Antes
    // ahí se cortaba, y la «sección» inventada de después pasaba sin mirar.
    expect(extraerCitas('Un monitor de 24" alcanza. La sección «SOBRE NOSOTROS» dice algo.').map((c) => c.valor)).toEqual([
      'SOBRE NOSOTROS'
    ]);
    expect(
      extraerCitas('Escribí el signo " antes del texto. Después abrí «Mesa de Ayuda Central».').map((c) => c.valor)
    ).toEqual(['Mesa de Ayuda Central']);
  });

  it('una frase en minúscula va al informe pero no vuelve al modelo', () => {
    const lista = hallazgos('Dejá una fila «más aireada» entre los bloques.', 'La planilla se organiza en bloques.');

    expect(lista).toEqual([expect.objectContaining({ valor: 'más aireada', tipo: 'cita', soloInforme: true })]);
    expect(redactarTokens(lista)).toEqual([]);
  });

  it('el nombre de una sección entre comillas sigue volviendo', () => {
    const lista = hallazgos(
      'Los datos están en la sección «SOBRE NOSOTROS» del sitio.',
      'La sección Quiénes somos cuenta la historia.'
    );

    expect(redactarTokens(lista)).toEqual([expect.stringContaining('SOBRE NOSOTROS')]);
  });
});

describe('la minúscula se mira en la lección entera, marcas incluidas', () => {
  // La única «rubro» en minúscula está adentro de un ejemplo marcado; la
  // «Rubro» en mayúscula, a mitad de oración, en un bloque sin marcar.
  const HTML =
    '<p>La columna C guarda el campo Rubro de cada artículo.</p>' +
    '<ul data-ejemplo="un listado inventado"><li>Un rubro posible: bebidas.</li></ul>';
  const FUENTE = 'Un campo es un elemento en el que se almacena un fragmento de información.';

  it('con la lección entera, «Rubro» no es un nombre propio', () => {
    const lista = verificarTokens({
      texto: textoParaTokens(quitarPasajesMarcados(HTML)),
      textoCompleto: textoParaTokens(HTML),
      fuentes: [fuente(FUENTE)]
    });

    expect(valores(lista)).not.toContain('Rubro');
  });

  it('sin ella, la minúscula se pierde con el ejemplo y «Rubro» se marca (lo que pasaba)', () => {
    const lista = verificarTokens({ texto: textoParaTokens(quitarPasajesMarcados(HTML)), fuentes: [fuente(FUENTE)] });

    expect(valores(lista)).toContain('Rubro');
  });
});
