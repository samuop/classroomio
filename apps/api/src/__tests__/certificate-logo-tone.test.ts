import { describe, expect, it } from 'vitest';

import { ZCertificateDesign } from '@cio/utils/validation/course';
import { getTemplateSurface, renderCertificateDocument } from '@cio/certificates';
import { resolveCertificateDesign } from '@api/utils/certificate';

/**
 * La tinta del logo.
 *
 * Un lock-up monocromo se sube UNA vez y tiene que servir para las seis
 * plantillas, pero cinco imprimen sobre papel claro y `noir` sobre casi negro.
 * Por eso lo que se declara es el archivo y no el resultado: la plantilla
 * invierte cuando la tinta coincide con su fondo, que es la misma comparación
 * en los dos sentidos.
 */

const BASE = {
  templateId: 'classique' as const,
  accentColor: '#7B35AB',
  signatories: [
    { name: 'Ana García', role: 'Directora' },
    { name: 'Luis Pérez', role: 'Coordinador' }
  ] as [{ name: string; role: string }, { name: string; role: string }]
};

const LOGO = 'https://ejemplo.test/logo.png';

const DATOS = {
  recipientName: 'Ana Ruiz',
  courseName: 'Inducción SSMA',
  courseDescription: 'Curso completo',
  orgName: 'Consultora Ejemplo',
  orgLogoUrl: LOGO,
  date: '3 de agosto de 2026',
  certificateId: 'N° 0247'
};

/** Lo que de verdad decide si el logo se ve: la clase que dispara el filtro. */
const invertido = (html: string) => /class="brand-logo inverted"/.test(html);

const render = (design: Record<string, unknown>) =>
  renderCertificateDocument(resolveCertificateDesign({ design: { ...BASE, ...design } }), DATOS);

describe('logoTone — las capas que lo pueden perder', () => {
  it('zod lo conserva dentro de la marca', () => {
    const parsed = ZCertificateDesign.parse({
      ...BASE,
      orgBrand: { name: 'Consultora', logoUrl: LOGO, logoTone: 'light' }
    });

    expect(parsed.orgBrand?.logoTone).toBe('light');
  });

  it('zod rechaza una tinta que el renderer no sabe dibujar', () => {
    const parsed = ZCertificateDesign.safeParse({
      ...BASE,
      orgBrand: { name: 'Consultora', logoUrl: LOGO, logoTone: 'blanco' }
    });

    expect(parsed.success).toBe(false);
  });

  it('el resolver la lleva hasta el renderer', () => {
    const design = resolveCertificateDesign({
      design: { ...BASE, orgBrand: { name: 'Consultora', logoUrl: LOGO, logoTone: 'dark' } }
    });

    expect(design.orgBrand?.logoTone).toBe('dark');
  });

  it('la tinta sola no inventa una marca', () => {
    // `logoTone` sin nombre ni logo describe un archivo que no existe. Guardarla
    // dejaría una marca vacía que después se aplica al primer logo que suba
    // cualquier otro.
    const design = resolveCertificateDesign({ design: { ...BASE, orgBrand: { logoTone: 'light' } } });

    expect(design.orgBrand).toBeUndefined();
  });
});

describe('logoTone — cuándo invierte', () => {
  it('un logo de letras blancas se da vuelta sobre papel claro', () => {
    // El caso que lo motivó: PNG transparente con letras blancas, invisible
    // sobre el crema de classique.
    expect(getTemplateSurface('classique')).toBe('light');
    expect(invertido(render({ orgBrand: { logoUrl: LOGO, logoTone: 'light' } }))).toBe(true);
  });

  it('ese MISMO archivo se deja intacto sobre noir', () => {
    // Lo que hace que se declare el archivo y no el resultado: un interruptor
    // de "ponelo negro" habría que acordarse de apagarlo justo acá.
    expect(getTemplateSurface('noir')).toBe('dark');
    expect(invertido(render({ templateId: 'noir', orgBrand: { logoUrl: LOGO, logoTone: 'light' } }))).toBe(false);
  });

  it('y al revés: un logo negro se da vuelta sobre noir', () => {
    // La regla tiene que valer en los dos sentidos o la mitad de los casos
    // queda sin arreglo, con el mismo síntoma.
    expect(invertido(render({ templateId: 'noir', orgBrand: { logoUrl: LOGO, logoTone: 'dark' } }))).toBe(true);
    expect(invertido(render({ orgBrand: { logoUrl: LOGO, logoTone: 'dark' } }))).toBe(false);
  });

  it('sin declarar tinta no toca nada, en ninguna plantilla', () => {
    // Es lo que deja idénticos los certificados ya emitidos, y lo correcto para
    // un logo a color: invertirlo arruina la marca.
    expect(invertido(render({ orgBrand: { logoUrl: LOGO } }))).toBe(false);
    expect(invertido(render({ templateId: 'noir', orgBrand: { logoUrl: LOGO } }))).toBe(false);
  });

  it('cada marca lleva la suya', () => {
    // La consultora y el cliente suben archivos distintos; una sola tinta para
    // las dos arregla una y rompe la otra.
    const html = render({
      orgBrand: { name: 'Consultora', logoUrl: LOGO, logoTone: 'light' },
      clientBrand: { name: 'Cliente', logoUrl: 'https://ejemplo.test/cliente.png' }
    });

    expect(html.match(/class="brand-logo inverted"/g)).toHaveLength(1);
    expect(html.match(/class="brand-logo"/g)).toHaveLength(1);
  });

  it('el filtro está en la hoja de estilos, no sólo la clase', () => {
    // La clase sin regla que la respalde es exactamente el modo de falla que
    // este arreglo viene a resolver: se ve bien en el editor y sale invisible.
    expect(render({ orgBrand: { logoUrl: LOGO, logoTone: 'light' } })).toMatch(
      /\.brand-logo\.inverted\s*\{\s*filter:\s*invert\(1\)/
    );
  });
});
