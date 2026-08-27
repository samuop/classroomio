import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_FIELD_PLACEMENTS } from '@cio/certificates';

import { certificateEditorStore } from './certificate-editor.store.svelte';

/**
 * La edición de la plantilla propia.
 *
 * Lo que hace que esto no sea el lienzo libre otra vez es que el editor NO
 * guarda elementos: guarda quince cajas. Los elementos que el lienzo arrastra
 * son una compilación de esas cajas, y se regeneran en cada cambio.
 *
 * De ahí sale el modo de falla que estos tests vigilan: `updateElement` —lo que
 * llama el arrastre— escribiendo sobre el elemento compilado en vez de sobre la
 * caja. Se ve bien mientras se arrastra, y al soltar vuelve solo a su lugar.
 */

const store = certificateEditorStore;

beforeEach(() => {
  // El store es un singleton (hay un editor por pantalla), así que cada test
  // tiene que devolverlo a las plantillas fijas o arrastra el estado del anterior.
  store.useFixedTemplate();
  store.draft.layout = null;
  store.selectedElementId = null;
});

describe('pasar a plantilla propia', () => {
  it('arranca sin campos guardados, no con una copia de la plantilla', () => {
    // Copiar congelaría hoy las quince cajas: mejorar un default no llegaría
    // nunca a los certificados ya creados.
    store.useOwnTemplate();

    expect(store.draft.layout).toEqual({ backgroundTone: 'light' });
    expect(store.isLayout).toBe(true);
  });

  it('los campos aparecen igual, en su ubicación por defecto', () => {
    store.useOwnTemplate();

    expect(store.fieldPlacement('recipientName')).toMatchObject(DEFAULT_FIELD_PLACEMENTS.recipientName);
    expect(store.elements.map((el) => el.id)).toContain('field:recipientName');
  });

  it('volver a las plantillas es un paso que se puede deshacer', () => {
    // Cambiar de vía perdía el trabajo sin que nada lo dijera: el historial
    // sólo guardaba el documento del lienzo libre.
    store.useOwnTemplate();
    store.updateField('recipientName', { x: 777 });
    store.useFixedTemplate();

    expect(store.isLayout).toBe(false);

    store.undo();

    expect(store.isLayout).toBe(true);
    expect(store.fieldPlacement('recipientName').x).toBe(777);
  });
});

describe('arrastrar un campo', () => {
  beforeEach(() => {
    store.useOwnTemplate();
  });

  it('mover el elemento compilado escribe en la CAJA del campo', () => {
    // `updateElement` es lo que llama el arrastre del lienzo. Si escribiera
    // sobre el elemento, el siguiente $derived lo regeneraría y el campo
    // volvería solo a su lugar al soltar.
    store.updateElement('field:recipientName', { x: 300, y: 120 });

    expect(store.draft.layout?.fields?.recipientName).toMatchObject({ x: 300, y: 120 });
    expect(store.elements.find((el) => el.id === 'field:recipientName')).toMatchObject({ x: 300, y: 120 });
  });

  it('guarda la caja COMPLETA, no sólo lo que cambió', () => {
    // Una caja a medio guardar —con `x` pero sin `w`— la descarta el resolver
    // del servidor: el editor mostraría la posición nueva y el PDF la vieja.
    store.updateElement('field:date', { x: 42 });

    expect(store.draft.layout?.fields?.date).toMatchObject({
      x: 42,
      y: DEFAULT_FIELD_PLACEMENTS.date.y,
      w: DEFAULT_FIELD_PLACEMENTS.date.w,
      h: DEFAULT_FIELD_PLACEMENTS.date.h
    });
  });

  it('un id que no es un campo no escribe nada', () => {
    store.updateElement('elemento-inventado', { x: 10, y: 10 });

    expect(store.draft.layout?.fields).toBeUndefined();
  });

  it('devolver a su lugar borra lo guardado en vez de escribir el default', () => {
    // Escribir el default lo congelaría, que es justo lo que "devolver a su
    // lugar" tiene que deshacer.
    store.updateField('courseName', { x: 5, fontSize: 80 });
    store.resetField('courseName');

    expect(store.draft.layout?.fields?.courseName).toBeUndefined();
    expect(store.fieldPlacement('courseName')).toMatchObject(DEFAULT_FIELD_PLACEMENTS.courseName);
  });
});

describe('mostrar y ocultar', () => {
  beforeEach(() => {
    store.useOwnTemplate();
  });

  it('lo oculto sale del lienzo', () => {
    store.toggleField('certificateId', true);

    expect(store.elements.map((el) => el.id)).not.toContain('field:certificateId');
  });

  it('ocultar lo que estaba elegido lo deselecciona', () => {
    // Sin esto el panel sigue mostrando los ajustes de un campo que ya no está
    // en el lienzo, y moverlo no se ve en ningún lado.
    store.selectField('certificateId');
    store.toggleField('certificateId', true);

    expect(store.selectedFieldId).toBeNull();
  });
});

describe('el estilo por campo', () => {
  beforeEach(() => {
    store.useOwnTemplate();
  });

  it('llega hasta el elemento que se dibuja', () => {
    store.updateField('recipientName', { fontSize: 40, color: '#aa0000', bold: true, uppercase: true });

    const elemento = store.elements.find((el) => el.id === 'field:recipientName');

    expect(elemento).toMatchObject({
      style: { fontSize: 40, color: '#aa0000', fontWeight: 700, uppercase: true }
    });
  });

  it('el fondo oscuro cambia la tinta por defecto de TODOS los campos', () => {
    // Con las seis plantillas el papel lo sabía la plantilla; con una imagen
    // que sube alguien, no lo sabe nadie.
    store.setBackgroundTone('dark');

    const elemento = store.elements.find((el) => el.id === 'field:recipientName');

    expect(elemento).toMatchObject({ style: { color: '#f2efe9' } });
  });

  it('el color elegido a mano le gana al del fondo', () => {
    store.setBackgroundTone('dark');
    store.updateField('date', { color: '#123456' });

    expect(store.elements.find((el) => el.id === 'field:date')).toMatchObject({ style: { color: '#123456' } });
  });
});

describe('lo que se guarda', () => {
  it('el diseño lleva la plantilla propia', () => {
    store.useOwnTemplate();
    store.updateField('recipientName', { x: 111 });

    expect(store.toDesign().layout?.fields?.recipientName).toMatchObject({ x: 111 });
  });

  it('sin plantilla propia el diseño no la menciona', () => {
    // Es lo que deja intactos los cursos que usan una de las seis plantillas.
    expect(store.toDesign().layout).toBeUndefined();
  });
});
