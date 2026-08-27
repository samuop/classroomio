import { describe, expect, it } from 'vitest';

import { ZCertificateDesign } from '@cio/utils/validation/course';
import { DEFAULT_FIELD_PLACEMENTS, buildLayoutDocument, renderCertificateDocument } from '@cio/certificates';
import { resolveCertificateDesign } from '@api/utils/certificate';

/**
 * La plantilla propia: la imagen que trae quien diseñó el certificado, más
 * dónde se imprime cada campo encima.
 *
 * Lo que este archivo tiene que fijar es el límite que la distingue del lienzo
 * libre —el que ya se intentó y no cerró—: el conjunto de campos es CERRADO. Si
 * un id desconocido lograra llegar al compilador, esto volvería a ser un editor
 * de documentos arbitrarios con otro nombre.
 */

const FONDO = 'https://ejemplo.test/mi-certificado.png';
const LOGO = 'https://ejemplo.test/logo.png';
const FIRMA = 'https://ejemplo.test/firma.png';

const BASE = {
  templateId: 'classique' as const,
  accentColor: '#7B35AB',
  signatories: [
    { name: 'Ana García', role: 'Directora' },
    { name: 'Luis Pérez', role: 'Coordinador' }
  ] as never
};

const DATOS = {
  recipientName: 'Ana Ruiz',
  courseName: 'Inducción SSMA',
  courseDescription: 'Curso completo',
  orgName: 'Consultora Ejemplo',
  date: '3 de agosto de 2026',
  certificateId: 'N° 0247'
};

const resolver = (layout: Record<string, unknown>) => resolveCertificateDesign({ design: { ...BASE, layout } });
const render = (layout: Record<string, unknown>) => renderCertificateDocument(resolver(layout), DATOS);

describe('layout — el conjunto cerrado', () => {
  it('zod descarta un campo que ninguna plataforma dibuja', () => {
    const parsed = ZCertificateDesign.parse({
      ...BASE,
      layout: { fields: { recipientName: { x: 1, y: 2, w: 3, h: 4 }, hackeado: { x: 0, y: 0, w: 99, h: 99 } } }
    });

    expect(parsed.layout?.fields?.recipientName).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(parsed.layout?.fields).not.toHaveProperty('hackeado');
  });

  it('el resolver también lo descarta, para las filas que preceden al esquema', () => {
    const design = resolver({ fields: { hackeado: { x: 0, y: 0, w: 99, h: 99 } } });

    expect(design.layout?.fields).toBeUndefined();
  });

  it('el fondo tiene que ser http(s)', () => {
    // Termina dentro de un `background-image: url(...)` en un documento que la
    // plataforma emite en nombre de quien enseña.
    expect(ZCertificateDesign.safeParse({ ...BASE, layout: { backgroundUrl: 'javascript:alert(1)' } }).success).toBe(
      false
    );
    expect(resolver({ backgroundUrl: 'javascript:alert(1)' }).layout?.backgroundUrl).toBeUndefined();
  });

  it('una caja incompleta cae al default en vez de dibujarse en el 0,0', () => {
    const design = resolver({ fields: { recipientName: { x: 10, y: 20 } } });

    expect(design.layout?.fields).toBeUndefined();
  });
});

describe('layout — qué dibuja', () => {
  it('reemplaza a la plantilla fija', () => {
    // `templateId` se queda en el diseño como el preset del que salió, pero no
    // lo lee nadie para dibujar.
    const html = render({ backgroundUrl: FONDO });

    expect(html).toContain(FONDO);
    expect(html).not.toContain('t-classique');
  });

  it('sin layout se sigue dibujando la plantilla de siempre', () => {
    // Lo que deja intactos los miles de certificados ya emitidos.
    expect(renderCertificateDocument(resolveCertificateDesign({ design: BASE }), DATOS)).toContain('t-classique');
  });

  it('un campo que nadie movió cae en su ubicación por defecto', () => {
    // Mezclar en lugar de reemplazar es lo que hace que un campo NUEVO aparezca
    // en los certificados ya diseñados en vez de faltar en silencio.
    const doc = buildLayoutDocument({ layout: { fields: {} }, design: resolver({}) });
    const nombre = doc.elements.find((el) => el.id === 'field:recipientName');

    expect(nombre).toMatchObject({ x: DEFAULT_FIELD_PLACEMENTS.recipientName.x });
  });

  it('lo oculto no se dibuja', () => {
    const doc = buildLayoutDocument({
      layout: { fields: { certificateId: { ...DEFAULT_FIELD_PLACEMENTS.certificateId, hidden: true } } },
      design: resolver({})
    });

    expect(doc.elements.map((el) => el.id)).not.toContain('field:certificateId');
  });

  it('el logo se invierte cuando su tinta choca con el fondo declarado', () => {
    // Con las seis plantillas el papel lo sabía la plantilla; con una imagen
    // que sube alguien, sólo lo sabe quien la subió.
    const claro = buildLayoutDocument({
      layout: { backgroundTone: 'light' },
      design: { ...resolver({}), orgBrand: { logoUrl: LOGO, logoTone: 'light' } }
    });
    const oscuro = buildLayoutDocument({
      layout: { backgroundTone: 'dark' },
      design: { ...resolver({}), orgBrand: { logoUrl: LOGO, logoTone: 'light' } }
    });

    expect(claro.elements.find((el) => el.id === 'field:orgLogo')).toMatchObject({ invert: true });
    expect(oscuro.elements.find((el) => el.id === 'field:orgLogo')).not.toHaveProperty('invert');
  });

  it('la firma escaneada borra su fondo blanco acá también', () => {
    const design = resolver({});
    const doc = buildLayoutDocument({
      layout: {},
      design: {
        ...design,
        signatories: [
          { name: 'Ana', role: 'Directora', imageUrl: FIRMA, imageHasBackground: true },
          { name: 'Luis', role: 'Coordinador' }
        ]
      }
    });

    expect(doc.elements.find((el) => el.id === 'field:signatoryOneImage')).toMatchObject({
      knockoutBackground: true
    });
    // Sin firma cargada no se dibuja una caja vacía.
    expect(doc.elements.map((el) => el.id)).not.toContain('field:signatoryTwoImage');
  });

  it('el nombre de quien firma va por binding, no como texto crudo', () => {
    // Puesto CRUDO en el contenido de un elemento, un nombre que contuviera
    // `{{recipientName}}` se sustituiría por el del alumno y el certificado
    // saldría firmado por quien lo recibe.
    //
    // Yendo por binding no pasa, porque la sustitución es de una sola pasada: el
    // token entra como VALOR y no se vuelve a escanear. Lo que se imprime es el
    // nombre raro, literal — que es exactamente lo que alguien escribió.
    const html = renderCertificateDocument(
      {
        ...resolver({}),
        signatories: [
          { name: '{{recipientName}}', role: 'Directora' },
          { name: 'Luis', role: 'X' }
        ]
      },
      DATOS
    );

    // Una sola vez: en su propio campo. Dos seria el certificado firmado por el
    // alumno.
    expect(html.match(/Ana Ruiz/g)).toHaveLength(1);
    expect(html).toContain('{{recipientName}}');
  });

  it('los datos del alumno se escapan', () => {
    // Un alumno llamado `<script>` sería un XSS almacenado en cada certificado
    // que el curso emite.
    const html = renderCertificateDocument(resolver({ backgroundUrl: FONDO }), {
      ...DATOS,
      recipientName: '<script>alert(1)</script>'
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
