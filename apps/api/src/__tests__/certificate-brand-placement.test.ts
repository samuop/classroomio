import { describe, expect, it } from 'vitest';

import { ZCertificateDesign } from '@cio/utils/validation/course';
import { renderCertificateDocument } from '@cio/certificates';
import { resolveCertificateDesign } from '@api/utils/certificate';

/**
 * Dónde se dibujan las marcas (logo de la consultora y del cliente).
 *
 * El campo tiene que sobrevivir TRES capas que lo pueden descartar en silencio,
 * y las tres ya rompieron algo antes: el tipo, el esquema de zod —que es
 * `z.object` sin `passthrough`— y `resolveCertificateDesign`, que reconstruye
 * el diseño campo por campo. Ninguna de las tres tira un error: el editor
 * guarda, la API contesta 200 y el valor no está.
 */

const BASE = {
  templateId: 'classique' as const,
  accentColor: '#7B35AB',
  signatories: [
    { name: 'Ana García', role: 'Directora' },
    { name: 'Luis Pérez', role: 'Coordinador' }
  ] as [{ name: string; role: string }, { name: string; role: string }]
};

const DATOS = {
  recipientName: 'Ana Ruiz',
  courseName: 'Inducción SSMA',
  courseDescription: 'Curso completo',
  orgName: 'Consultora Ejemplo',
  orgLogoUrl: 'https://ejemplo.test/logo.svg',
  date: '3 de agosto de 2026',
  certificateId: 'N° 0247'
};

describe('brandPlacement — las tres capas que lo pueden perder', () => {
  it('zod lo conserva en vez de descartarlo', () => {
    const parsed = ZCertificateDesign.parse({ ...BASE, brandPlacement: 'bottom' });

    expect(parsed.brandPlacement).toBe('bottom');
  });

  it('zod rechaza una ubicación que ninguna plantilla dibuja', () => {
    // El conjunto es CERRADO a propósito: si entrara cualquier cadena, la
    // plantilla caería a su default y la persona vería que su elección "no hizo
    // nada", sin ningún error que lo explique.
    expect(ZCertificateDesign.safeParse({ ...BASE, brandPlacement: 'izquierda' }).success).toBe(false);
  });

  it('el resolver lo lleva hasta el renderer', () => {
    const design = resolveCertificateDesign({ design: { ...BASE, brandPlacement: 'bottom' } });

    expect(design.brandPlacement).toBe('bottom');
  });

  it('un valor inválido que se coló cae al default de la plantilla', () => {
    const design = resolveCertificateDesign({
      design: { ...BASE, brandPlacement: 'diagonal' as unknown as 'top' }
    });

    expect(design.brandPlacement).toBeUndefined();
  });
});

describe('brandPlacement — lo que dibuja', () => {
  it('mueve la marca de arriba abajo, sin duplicarla', () => {
    const arriba = renderCertificateDocument(
      resolveCertificateDesign({ design: { ...BASE, brandPlacement: 'top' } }),
      DATOS
    );
    const abajo = renderCertificateDocument(
      resolveCertificateDesign({ design: { ...BASE, brandPlacement: 'bottom' } }),
      DATOS
    );

    const marcas = (html: string) => (html.match(/class="brands/g) ?? []).length;

    // Una sola vez en cada caso: el bug obvio de tener dos huecos es que la
    // marca salga en los dos.
    expect(marcas(arriba)).toBe(1);
    expect(marcas(abajo)).toBe(1);

    // Y que efectivamente cambie de lugar: en classique el hueco de arriba es
    // `top-tag` y el de abajo la banda.
    expect(arriba).toMatch(/top-tag[^]*?class="brands/);
    expect(abajo).toMatch(/brand-band[^]*?class="brands/);
  });

  it('sin elegir nada se dibuja donde esa plantilla ya la ponía', () => {
    // Es lo que hace que el cambio no toque ningún certificado ya diseñado.
    const sinElegir = renderCertificateDocument(resolveCertificateDesign({ design: BASE }), DATOS);

    expect(sinElegir).toMatch(/top-tag[^]*?class="brands/);
  });

  it('diploma tiene su propio default, abajo', () => {
    // Cada plantilla hereda el lugar donde ya dibujaba las marcas, que no es el
    // mismo en todas: un default único las habría movido a la mitad de ellas.
    const diploma = renderCertificateDocument(
      resolveCertificateDesign({ design: { ...BASE, templateId: 'diploma' } }),
      DATOS
    );

    expect(diploma).toMatch(/class="marks"[^]*?class="brands/);
  });

  it('marca cuando el nombre acompaña al logo, para que la plantilla pueda achicarlo', () => {
    // `has-names` no es cosmético: sin él, noir apilaba logo + nombre en una
    // fila pensada para texto de 11px y el adorno terminaba encima de la fecha.
    const conNombres = renderCertificateDocument(
      resolveCertificateDesign({ design: { ...BASE, brandShowNames: true } }),
      DATOS
    );
    const sinNombres = renderCertificateDocument(resolveCertificateDesign({ design: BASE }), DATOS);

    expect(conNombres).toContain('class="brands has-names"');
    expect(sinNombres).not.toContain('has-names');
  });
});
