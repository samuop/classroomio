/**
 * Cuándo hay que MIRAR un documento en vez de creerle al parser.
 *
 * El caso real que originó esto está en el primer test y conviene leerlo antes
 * que nada: un organigrama del que se extrajeron 104 caracteres viajó al modelo
 * etiquetado como el documento completo, y el modelo construyó una sección
 * entera sobre una jerarquía que tuvo que inventar.
 *
 * Lo que se fija acá es el umbral, y se fija POR PÁGINA a propósito. Un total
 * fijo no sirve: 300 caracteres son normales en un PDF de una carilla y son una
 * falla evidente en uno de veinte. Un umbral absoluto o castiga al documento
 * corto legítimo (y paga visión de gusto) o deja pasar al escaneado largo, que
 * es el que de verdad hace daño.
 */
import { describe, expect, it } from 'vitest';

import {
  decidirSiMirar,
  MAX_VISION_PAGES,
  MIN_CHARS_PER_PAGE,
  pareceDiagrama
} from '@api/services/agent/document-vision';

const UN_MEGA = 1024 * 1024;

function decidir(textoExtraido: string, pageCount: number | null, bytes = UN_MEGA) {
  return decidirSiMirar({ textoExtraido, pageCount, bytes });
}

describe('el caso que originó esto', () => {
  it('mira el organigrama del que sólo salió una frase repetida', () => {
    // Textual, de producción: "Organigrama actual.pptx.pdf", 104 caracteres.
    const loQueSalioDelParser = '\n\nASESORES DE CAPITAL HUMANO\n\nASESORES DE CAPITAL HUMANO\n\nASESORES DE CAPITAL HUMANO';

    expect(decidir(loQueSalioDelParser, 1)).toEqual({ leer: true, porque: 'poco_texto' });
  });
});

describe('el umbral se mide por página', () => {
  it('no mira un PDF de una carilla con su texto completo', () => {
    expect(decidir('x'.repeat(1800), 1)).toEqual({ leer: false, motivo: 'texto_suficiente' });
  });

  it('SÍ mira un escaneado largo, aunque tenga más texto que el corto que dejó pasar', () => {
    // 1.800 caracteres en 20 páginas son 90 por carilla: está escaneado. Con un
    // umbral absoluto este documento pasaría, y es justo el que hace daño.
    expect(decidir('x'.repeat(1800), 20)).toEqual({ leer: true, porque: 'poco_texto' });
  });

  it('el borde exacto no dispara la visión', () => {
    const justo = MIN_CHARS_PER_PAGE * 3;

    expect(decidir('x'.repeat(justo), 3)).toEqual({ leer: false, motivo: 'texto_suficiente' });
    expect(decidir('x'.repeat(justo - 1), 3)).toEqual({ leer: true, porque: 'poco_texto' });
  });

  it('no cuenta los espacios como contenido', () => {
    // Un PDF de puras imágenes suele devolver saltos de línea y nada más.
    expect(decidir('\n\n   \t  \n\n', 2)).toEqual({ leer: true, porque: 'poco_texto' });
  });
});

describe('cuándo NO se gasta', () => {
  it('sin páginas no adivina', () => {
    // Sin denominador no hay cuenta posible, y suponer sale plata.
    expect(decidir('poco', null)).toEqual({ leer: false, motivo: 'sin_paginas' });
    expect(decidir('poco', 0)).toEqual({ leer: false, motivo: 'sin_paginas' });
  });

  it('un documento enorme se deja como está en vez de encarecerlo', () => {
    expect(decidir('', MAX_VISION_PAGES + 1)).toEqual({ leer: false, motivo: 'demasiadas_paginas' });
  });

  it('un archivo que no entra en línea tampoco se manda', () => {
    expect(decidir('', 2, 25 * UN_MEGA)).toEqual({ leer: false, motivo: 'archivo_muy_grande' });
  });

  it('el tamaño se revisa ANTES que las páginas', () => {
    // Los dos motivos aplican; el que se reporta tiene que ser estable, porque
    // es lo que se va a leer en el log cuando alguien pregunte por qué no miró.
    expect(decidir('', MAX_VISION_PAGES + 1, 25 * UN_MEGA)).toEqual({
      leer: false,
      motivo: 'archivo_muy_grande'
    });
  });
});

/**
 * El segundo motivo para mirar, que el umbral por cantidad no puede ver.
 *
 * El organigrama de producción pasó por visión POR CASUALIDAD: esa exportación
 * dejó 104 caracteres y cayó del lado del umbral por cantidad. Un organigrama
 * exportado de PowerPoint normalmente sí trae capa de texto con todas las
 * etiquetas de las cajas — cinco mil caracteres en siete páginas pasan cómodos
 * el piso de doscientos por carilla— y entonces la visión no corría nunca.
 *
 * Lo que el modelo recibía en ese caso son las palabras SIN la jerarquía: los
 * nombres de los puestos sin quién depende de quién. Con eso escribe un
 * organigrama parecido al original y que no es el original, que es peor que no
 * tener nada porque no se nota.
 *
 * La señal es la PUNTUACIÓN y no el largo del renglón, y la diferencia importa:
 * el largo depende del maquetado —una columna angosta da renglones tan cortos
 * como una etiqueta— mientras que los puntos dependen de si el documento dice
 * frases.
 */
describe('hay texto, pero el documento es un diagrama', () => {
  /** Un organigrama con su capa de texto intacta: etiquetas, ni un punto. */
  const ETIQUETAS_DE_ORGANIGRAMA = [
    'DIRECTOR',
    'GERENTE GENERAL',
    'DEPARTAMENTO ADMINISTRATIVO Y DE FINANZAS',
    'ANALISTA ADMINISTRATIVO',
    'AUXILIAR ADMINISTRATIVO',
    'DEPARTAMENTO COMERCIAL',
    'GERENTE COMERCIAL',
    'ENCARGADO DE OBRAS Y LOGISTICA',
    'VENDEDOR MAYORISTA',
    'AREA VENTAS MAYORISTAS',
    'VENDEDORES EXTERNOS',
    'AUX DEPOSITO MAYORISTA',
    'CAJERO',
    'AUXILIAR DE DEPOSITO',
    'VENDEDORES DE SALON',
    'DEPARTAMENTO DE LOGISTICA',
    'ENCARGADO DE LOGISTICA',
    'JEFE LOGISTICA DE OBRAS',
    'DEPARTAMENTO DE MARKETING',
    'ENCARGADO DE MARKETING',
    'AUXILIAR DE MARKETING',
    'DEPARTAMENTO DE OBRAS',
    'ENCARGADO TECNICO DE OBRA',
    'SUPERVISOR DE OBRA',
    'JEFE DE DEPOSITO',
    'JEFE DE OBRA',
    'OPERARIOS',
    'TECNICO DE OBRA',
    'AUX DE PRESUPUESTOS',
    'ASESORES CONTABLES',
    'ASESORES LEGALES',
    'ASESORES DE CAPITAL HUMANO',
    'ASESORES DE SEG E HIGIENE'
  ].join('\n');

  /** Prosa de verdad: renglones largos y una oración cada tanto. */
  const PAGINA_DE_PROSA = Array.from(
    { length: 30 },
    (_, i) =>
      `El procedimiento ${i} describe como preparar la superficie antes de aplicar el producto, ` +
      `verificando la humedad del sustrato y el tiempo de secado indicado por el fabricante.`
  ).join('\n');

  it('mira un organigrama que SÍ tenía texto extraíble', () => {
    // Supera el umbral por cantidad y aun así hay que mirarlo.
    expect(ETIQUETAS_DE_ORGANIGRAMA.length).toBeGreaterThan(MIN_CHARS_PER_PAGE);
    expect(decidir(ETIQUETAS_DE_ORGANIGRAMA, 1)).toEqual({ leer: true, porque: 'parece_diagrama' });
  });

  it('no mira una página de prosa, aunque tenga renglones cortos', () => {
    expect(decidir(PAGINA_DE_PROSA, 1)).toEqual({ leer: false, motivo: 'texto_suficiente' });
  });

  /**
   * Una columna angosta da renglones de cuarenta caracteres, igual de cortos
   * que una etiqueta. Si la decisión mirara el largo del renglón, esto se
   * confundiría con un diagrama y se pagaría visión de gusto.
   */
  it('no confunde una columna angosta con un diagrama', () => {
    const columnaAngosta = Array.from({ length: 40 }, (_, i) =>
      i % 4 === 3 ? `y se deja secar doce horas.` : `se aplica el producto en dos manos`
    ).join('\n');

    expect(decidir(columnaAngosta, 1)).toEqual({ leer: false, motivo: 'texto_suficiente' });
  });

  it('el motivo distingue los dos casos, porque el aviso que se guarda es distinto', () => {
    // `poco_texto` dice «no tenía texto extraíble»; `parece_diagrama` no puede
    // decir eso porque seria mentira, y el aviso viaja con el texto a todas
    // partes.
    expect(decidir('\n\nDIRECTOR\n\nGERENTE\n', 3)).toEqual({ leer: true, porque: 'poco_texto' });
    expect(decidir(ETIQUETAS_DE_ORGANIGRAMA, 1)).toEqual({ leer: true, porque: 'parece_diagrama' });
  });

  it('con poquísimo texto no se pone a deducir formas', () => {
    // Tres etiquetas no son una muestra: la decisión la toma el umbral por
    // cantidad, que para eso está.
    expect(pareceDiagrama({ textoExtraido: 'UNO\nDOS\nTRES', pageCount: 1 })).toBe(false);
  });
});
