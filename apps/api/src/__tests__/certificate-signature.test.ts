import { describe, expect, it } from 'vitest';

import { ZCertificateDesign } from '@cio/utils/validation/course';
import { renderCertificateDocument } from '@cio/certificates';
import { resolveCertificateDesign } from '@api/utils/certificate';

/**
 * La firma escaneada.
 *
 * Dos decisiones que el test tiene que fijar, porque las dos se pueden
 * "arreglar" en la dirección equivocada sin que nada falle:
 *
 *  1. La tinta NO se pregunta: una firma siempre es oscura. Sobre papel oscuro
 *     la plantilla la invierte sola.
 *  2. El fondo SÍ se pregunta, porque un PNG recortado y una foto del papel se
 *     ven idénticos hasta que se imprimen.
 */

const FIRMA = 'https://ejemplo.test/firma.png';

const base = {
  accentColor: '#7B35AB',
  idFormat: 'N° {seq}'
};

const firmantes = (extra: Record<string, unknown>) =>
  [
    { name: 'Ana García', role: 'Directora', ...extra },
    { name: 'Luis Pérez', role: 'Coordinador' }
  ] as never;

const DATOS = {
  recipientName: 'Ana Ruiz',
  courseName: 'Inducción SSMA',
  courseDescription: 'Curso completo',
  orgName: 'Consultora Ejemplo',
  date: '3 de agosto de 2026',
  certificateId: 'N° 0247'
};

const render = (design: Record<string, unknown>) =>
  renderCertificateDocument(
    resolveCertificateDesign({ design: { templateId: 'classique', ...base, ...design } }),
    DATOS
  );

/** Las clases son lo que enciende cada mezcla; sin ellas no se dibuja nada. */
const clasesDeFirma = (html: string) => html.match(/<img class="(signature[^"]*)"/g) ?? [];

describe('firma — las capas que la pueden perder', () => {
  it('zod la conserva dentro de quien firma', () => {
    const parsed = ZCertificateDesign.parse({
      templateId: 'classique',
      ...base,
      signatories: firmantes({ imageUrl: FIRMA, imageHasBackground: true })
    });

    expect(parsed.signatories[0].imageUrl).toBe(FIRMA);
    expect(parsed.signatories[0].imageHasBackground).toBe(true);
  });

  it('zod rechaza una firma que no es http(s)', () => {
    // Esto entra en un `<img src>` dentro de un documento que la plataforma
    // emite en nombre de quien enseña: un `javascript:` guardado acá sería un
    // script corriendo con su firma al pie.
    const parsed = ZCertificateDesign.safeParse({
      templateId: 'classique',
      ...base,
      signatories: firmantes({ imageUrl: 'javascript:alert(1)' })
    });

    expect(parsed.success).toBe(false);
  });

  it('el resolver también descarta el esquema raro', () => {
    // Segunda puerta, para las filas que son anteriores a cualquier esquema.
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', ...base, signatories: firmantes({ imageUrl: 'javascript:alert(1)' }) }
    });

    expect(design.signatories[0].imageUrl).toBeUndefined();
  });

  it('el fondo sin firma no se guarda', () => {
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', ...base, signatories: firmantes({ imageHasBackground: true }) }
    });

    expect(design.signatories[0].imageHasBackground).toBeUndefined();
  });

  it('quien firma conserva su nombre y su cargo', () => {
    // El sanitizador se reescribió entero para meter la firma; perder el nombre
    // habría dejado el certificado firmado por nadie.
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', ...base, signatories: firmantes({ imageUrl: FIRMA }) }
    });

    expect(design.signatories[0]).toMatchObject({ name: 'Ana García', role: 'Directora' });
    expect(design.signatories[1]).toMatchObject({ name: 'Luis Pérez', role: 'Coordinador' });
  });
});

describe('firma — lo que dibuja', () => {
  it('sin firma no dibuja ninguna imagen', () => {
    // Es lo que deja intactos los miles de certificados ya emitidos.
    expect(clasesDeFirma(render({ signatories: firmantes({}) }))).toHaveLength(0);
  });

  it('un recorte sobre papel claro va tal cual', () => {
    expect(clasesDeFirma(render({ signatories: firmantes({ imageUrl: FIRMA }) }))).toEqual(['<img class="signature"']);
  });

  it('una foto con fondo blanco borra su fondo', () => {
    // `multiply` deja pasar el papel del certificado y respeta el trazo. Sin
    // esto sale un rectángulo blanco en medio del pie de página.
    expect(clasesDeFirma(render({ signatories: firmantes({ imageUrl: FIRMA, imageHasBackground: true }) }))).toEqual([
      '<img class="signature has-bg"'
    ]);
  });

  it('sobre papel oscuro se invierte, sin preguntar nada', () => {
    // Nadie firma en blanco: la tinta es siempre oscura y por eso lo decide la
    // plantilla. Preguntarlo habría sido un ajuste más para equivocarse.
    expect(clasesDeFirma(render({ templateId: 'noir', signatories: firmantes({ imageUrl: FIRMA }) }))).toEqual([
      '<img class="signature on-dark"'
    ]);
  });

  it('foto con fondo blanco sobre papel oscuro: invertir y `screen`', () => {
    // Invertida, el fondo blanco quedó negro — y sobre oscuro `screen` lo borra.
    // `multiply` acá habría borrado el TRAZO en vez del fondo.
    expect(
      clasesDeFirma(
        render({ templateId: 'noir', signatories: firmantes({ imageUrl: FIRMA, imageHasBackground: true }) })
      )
    ).toEqual(['<img class="signature on-dark has-bg"']);
  });

  it('las seis plantillas dibujan LAS DOS firmas', () => {
    // Cada plantilla tiene su propio marcado de firma con sus propias clases, y
    // hay DOS huecos por plantilla: doce inserciones hechas a mano.
    //
    // Las dos, y no una: con firma en un solo firmante este test pasaba igual
    // habiendo borrado el hueco del segundo en las seis plantillas — seis
    // agujeros que el test decía cubrir. Verificado rompiéndolo.
    const dosFirmas = [
      { name: 'Ana García', role: 'Directora', imageUrl: FIRMA },
      { name: 'Luis Pérez', role: 'Coordinador', imageUrl: 'https://ejemplo.test/firma-2.png' }
    ] as never;

    for (const templateId of ['classique', 'diploma', 'brutalist', 'noir', 'poster', 'minimal'] as const) {
      const html = render({ templateId, signatories: dosFirmas });

      expect(clasesDeFirma(html), templateId).toHaveLength(2);
    }
  });

  it('va ARRIBA del renglón, no debajo', () => {
    // Las seis plantillas dibujan la línea como el `border-top` del bloque, así
    // que la firma —primer hijo— caía DEBAJO, sobre el nombre. El margen
    // negativo es lo que la levanta; sin él se ve como una mancha bajo la línea.
    const html = render({ signatories: firmantes({ imageUrl: FIRMA }) });

    expect(html).toContain('margin: calc(-1 * (min(var(--signature-height), var(--signature-cap))');
  });

  it('el alto y la altura sobre el renglón se eligen por firma', () => {
    const html = render({ signatories: firmantes({ imageUrl: FIRMA, imageHeight: 70, imageOffset: -12 }) });

    expect(html).toContain('--signature-height:70px');
    expect(html).toContain('--signature-gap:-12px');
  });

  it('sin elegir nada NO emite medidas', () => {
    // Una variable en línea le gana a la regla de la plantilla: emitirlas
    // siempre pisaría el tope que cada plantilla se puso, y poster volvería a
    // montar la firma sobre su descripción sin que nadie tocara nada.
    // El nombre de la variable vive SIEMPRE en la hoja de estilos; lo que no
    // tiene que aparecer es el atributo `style` en el <img>.
    expect(render({ signatories: firmantes({ imageUrl: FIRMA }) })).not.toMatch(/<img class="signature[^>]*style=/);
  });

  it('un alto disparatado se acota antes de llegar al HTML', () => {
    const html = render({ signatories: firmantes({ imageUrl: FIRMA, imageHeight: 9000, imageOffset: -9000 }) });

    expect(html).toContain('--signature-height:90px');
    expect(html).toContain('--signature-gap:-24px');
  });

  it('la plantilla conserva su tope aunque le suban el alto', () => {
    // `min()` contra `--signature-cap`: el alto lo elige quien edita, el tope lo
    // pone la plantilla, y el que manda es el más chico de los dos.
    const html = render({
      templateId: 'poster',
      signatories: firmantes({ imageUrl: FIRMA, imageHeight: 90 })
    });

    expect(html).toMatch(/\.t-poster \.signature \{[^}]*--signature-cap:\s*22px/);
    expect(html).toMatch(/height:\s*min\(var\(--signature-height\), var\(--signature-cap\)\)/);
  });

  it('las mezclas están en la hoja de estilos, no sólo las clases', () => {
    // Una clase sin regla detrás se ve bien en el editor y sale mal impresa.
    const html = render({ signatories: firmantes({ imageUrl: FIRMA, imageHasBackground: true }) });

    expect(html).toMatch(/\.signature\.has-bg\s*\{\s*mix-blend-mode:\s*multiply/);
    expect(html).toMatch(/\.signature\.on-dark\s*\{\s*filter:\s*invert\(1\)/);
    expect(html).toMatch(/\.signature\.on-dark\.has-bg\s*\{\s*mix-blend-mode:\s*screen/);
  });
});
