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

import { decidirSiMirar, MAX_VISION_PAGES, MIN_CHARS_PER_PAGE } from '@api/services/agent/document-vision';

const UN_MEGA = 1024 * 1024;

function decidir(textoExtraido: string, pageCount: number | null, bytes = UN_MEGA) {
  return decidirSiMirar({ textoExtraido, pageCount, bytes });
}

describe('el caso que originó esto', () => {
  it('mira el organigrama del que sólo salió una frase repetida', () => {
    // Textual, de producción: "Organigrama actual.pptx.pdf", 104 caracteres.
    const loQueSalioDelParser = '\n\nASESORES DE CAPITAL HUMANO\n\nASESORES DE CAPITAL HUMANO\n\nASESORES DE CAPITAL HUMANO';

    expect(decidir(loQueSalioDelParser, 1)).toEqual({ leer: true });
  });
});

describe('el umbral se mide por página', () => {
  it('no mira un PDF de una carilla con su texto completo', () => {
    expect(decidir('x'.repeat(1800), 1)).toEqual({ leer: false, motivo: 'texto_suficiente' });
  });

  it('SÍ mira un escaneado largo, aunque tenga más texto que el corto que dejó pasar', () => {
    // 1.800 caracteres en 20 páginas son 90 por carilla: está escaneado. Con un
    // umbral absoluto este documento pasaría, y es justo el que hace daño.
    expect(decidir('x'.repeat(1800), 20)).toEqual({ leer: true });
  });

  it('el borde exacto no dispara la visión', () => {
    const justo = MIN_CHARS_PER_PAGE * 3;

    expect(decidir('x'.repeat(justo), 3)).toEqual({ leer: false, motivo: 'texto_suficiente' });
    expect(decidir('x'.repeat(justo - 1), 3)).toEqual({ leer: true });
  });

  it('no cuenta los espacios como contenido', () => {
    // Un PDF de puras imágenes suele devolver saltos de línea y nada más.
    expect(decidir('\n\n   \t  \n\n', 2)).toEqual({ leer: true });
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
