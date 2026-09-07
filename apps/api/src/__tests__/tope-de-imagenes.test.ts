/**
 * El tope de imágenes por empresa.
 *
 * Existe porque generar una imagen cuesta plata y hasta acá no se contaba en
 * ningún lado: el tope de fichas no la cubre —una imagen no gasta fichas— así
 * que una empresa con el chat agotado podía seguir generando imágenes sin
 * límite. Este test fija las tres cosas que hacen que el tope sirva: de dónde
 * sale el número, que el cero apague de verdad, y que se corte ANTES de gastar.
 *
 * El caso que más importa es el del cero: es el único valor que un `??` o un
 * `||` mal puesto convierte en "sin tope", y en silencio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const entorno = { PUBLIC_IS_SELFHOSTED: undefined as string | undefined };

// `@api/config/env` valida y congela el entorno al importarse: tocar
// `process.env` dentro de un test llega tarde y el caso de instalación propia
// pasaría en verde sin probar nada.
vi.mock('@api/config/env', () => ({
  get env() {
    return entorno;
  }
}));

const getActiveOrganizationPlan = vi.fn();
const countImagesSince = vi.fn(async () => 0);
const recordImageUsage = vi.fn(async () => undefined);

vi.mock('@cio/db/queries/organization', () => ({
  getActiveOrganizationPlan: (...a: unknown[]) => getActiveOrganizationPlan(...(a as []))
}));

vi.mock('@cio/db/queries/agent', () => ({
  countImagesSince: (...a: unknown[]) => countImagesSince(...(a as [])),
  recordImageUsage: (...a: unknown[]) => recordImageUsage(...(a as []))
}));

const { enforceImageBalance, getImageBalance, readImageAllowance } = await import(
  '@api/services/agent/image-usage'
);

const ORG = 'una-empresa';

beforeEach(() => {
  vi.clearAllMocks();
  countImagesSince.mockResolvedValue(0);
  entorno.PUBLIC_IS_SELFHOSTED = undefined;
});

describe('de dónde sale el tope', () => {
  it('usa el número propio de la empresa cuando lo tiene', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'ENTERPRISE', payload: { aiImageAllowance: 42 } });

    await expect(getImageBalance(ORG)).resolves.toMatchObject({ allowance: 42 });
  });

  it('cae al del plan cuando la empresa no tiene uno propio', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'ENTERPRISE', payload: {} });

    await expect(getImageBalance(ORG)).resolves.toMatchObject({ allowance: 300 });
  });

  it('sin plan activo, trata a la empresa como la más chica', async () => {
    getActiveOrganizationPlan.mockResolvedValue(null);

    await expect(getImageBalance(ORG)).resolves.toMatchObject({ allowance: 20 });
  });

  it('descuenta lo ya generado en el mes', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'BASIC', payload: { aiImageAllowance: 10 } });
    countImagesSince.mockResolvedValue(4);

    await expect(getImageBalance(ORG)).resolves.toMatchObject({ used: 4, allowance: 10, remaining: 6 });
  });
});

describe('el cero apaga', () => {
  it('lo lee como cero y no como "sin configurar"', () => {
    // Un `??` mal puesto acá convierte "apagado" en "el del plan", y nadie lo ve.
    expect(readImageAllowance({ aiImageAllowance: 0 })).toBe(0);
  });

  it('con cero no deja generar ni la primera', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'ENTERPRISE', payload: { aiImageAllowance: 0 } });

    await expect(enforceImageBalance(ORG)).rejects.toThrow(/l[íi]mite/i);
  });

  it('descarta un valor que no sirve como número', () => {
    expect(readImageAllowance({ aiImageAllowance: 'muchas' })).toBeNull();
    expect(readImageAllowance({ aiImageAllowance: -3 })).toBeNull();
    expect(readImageAllowance(null)).toBeNull();
  });
});

describe('el corte', () => {
  it('frena cuando ya se gastó todo el mes', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'BASIC', payload: { aiImageAllowance: 3 } });
    countImagesSince.mockResolvedValue(3);

    await expect(enforceImageBalance(ORG)).rejects.toMatchObject({ statusCode: 402, code: 'IMAGE_LIMIT_REACHED' });
  });

  it('deja pasar la última que entra', async () => {
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'BASIC', payload: { aiImageAllowance: 3 } });
    countImagesSince.mockResolvedValue(2);

    await expect(enforceImageBalance(ORG)).resolves.toMatchObject({ remaining: 1 });
  });

  it('no racionea una instalación propia: la clave del proveedor es suya', async () => {
    entorno.PUBLIC_IS_SELFHOSTED = 'true';
    getActiveOrganizationPlan.mockResolvedValue({ planName: 'BASIC', payload: { aiImageAllowance: 0 } });
    countImagesSince.mockResolvedValue(99);

    await expect(enforceImageBalance(ORG)).resolves.toMatchObject({ remaining: 0 });
  });
});
