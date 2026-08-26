/**
 * Qué dominio lleva un mail.
 *
 * Una consultora le entrega la plataforma a un cliente bajo el dominio del
 * cliente. Antes `DASHBOARD_ORIGIN` cortaba primero y el argumento de empresa
 * se descartaba, así que toda invitación salía apuntando al dominio raíz del
 * despliegue: la gente del cliente aterrizaba en la marca de la consultora, en
 * un host donde además su sesión no vale porque las cookies son por host.
 *
 * La regla ya existía en el código — `buildCourseBaseUrl` la aplicaba, dos
 * veces, copiada — y las invitaciones eran el único lugar que no. Estas pruebas
 * la fijan en el único lugar que ahora la sabe, y sobre todo fijan el borde que
 * importa: un dominio SIN verificar no se usa jamás. Usarlo mandaría gente a un
 * host que todavía no resuelve, que es peor que mandarla al dominio principal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: { DASHBOARD_ORIGIN?: string; NODE_ENV?: string } = {};

vi.mock('@api/config/env', () => ({
  get env() {
    return env;
  }
}));

const { getDashboardBaseUrl } = await import('@api/config/dashboard-url');

const CONSULTORA = {
  siteName: 'consultora',
  customDomain: 'learn.consultora-ejemplo.com.ar',
  isCustomDomainVerified: true
};

beforeEach(() => {
  env.DASHBOARD_ORIGIN = 'https://learn.tensor.com.ar';
  env.NODE_ENV = 'production';
});

describe('getDashboardBaseUrl', () => {
  it('manda al dominio del cliente y no al del despliegue', () => {
    expect(getDashboardBaseUrl(CONSULTORA)).toBe('https://learn.consultora-ejemplo.com.ar');
  });

  it('IGNORA un dominio propio sin verificar', () => {
    expect(getDashboardBaseUrl({ ...CONSULTORA, isCustomDomainVerified: false })).toBe('https://learn.tensor.com.ar');
  });

  it('ignora la bandera de verificado si no hay dominio cargado', () => {
    expect(getDashboardBaseUrl({ siteName: 'consultora', customDomain: '   ', isCustomDomainVerified: true })).toBe(
      'https://learn.tensor.com.ar'
    );
  });

  it('cae al dominio del despliegue cuando la empresa no tiene dominio propio', () => {
    expect(getDashboardBaseUrl({ siteName: 'globex' })).toBe('https://learn.tensor.com.ar');
  });

  it('sigue aceptando solo el siteName, como antes', () => {
    expect(getDashboardBaseUrl('globex')).toBe('https://learn.tensor.com.ar');
    expect(getDashboardBaseUrl()).toBe('https://learn.tensor.com.ar');
  });

  it('le pone https a un dominio guardado pelado y saca la barra final', () => {
    expect(getDashboardBaseUrl({ ...CONSULTORA, customDomain: 'learn.consultora-ejemplo.com.ar/' })).toBe(
      'https://learn.consultora-ejemplo.com.ar'
    );
    expect(getDashboardBaseUrl({ ...CONSULTORA, customDomain: 'http://viejo.example.com' })).toBe(
      'http://viejo.example.com'
    );
  });

  it('en desarrollo nunca se va a un dominio de produccion', () => {
    env.NODE_ENV = 'development';
    env.DASHBOARD_ORIGIN = undefined;

    expect(getDashboardBaseUrl(CONSULTORA)).toBe('http://localhost:5173');
  });

  it('sin DASHBOARD_ORIGIN y sin dominio propio, usa el subdominio de la nube', () => {
    env.DASHBOARD_ORIGIN = undefined;

    expect(getDashboardBaseUrl({ siteName: 'globex' })).toBe('https://globex.classroomio.com');
    expect(getDashboardBaseUrl()).toBe('https://app.classroomio.com');
  });
});
