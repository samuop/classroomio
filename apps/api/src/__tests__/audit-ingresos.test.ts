/**
 * Qué deja en la auditoría un ingreso, un cierre de sesión y un cambio de cuenta.
 *
 * Hasta acá `/api/auth/*` no dejaba nada: ni el ingreso con su IP, ni el intento
 * fallido, ni el cambio de contraseña. Para saber si alguien más había entrado
 * con una cuenta había que deducirlo de las acciones que hizo después, y entrar a
 * mirar no deja acciones.
 *
 * Los avisos que se usan acá tienen la forma que Better Auth 1.6.11 produjo en un
 * experimento real (hooks `session.create/delete.after` y `hooks.after`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvisoDeIngreso } from '@cio/db/auth/audit-bridge';

const recordEvent = vi.fn(async () => {});
const recordIncident = vi.fn(async () => {});
const getProfileById = vi.fn(async (_id: string) => ({ email: 'ana@consultora-ejemplo.com.ar' }) as unknown);

vi.mock('@api/services/audit', () => ({
  recordEvent: (...args: unknown[]) => recordEvent(...(args as [])),
  recordIncident: (...args: unknown[]) => recordIncident(...(args as []))
}));

vi.mock('@cio/db/queries/auth', () => ({
  getProfileById: (id: string) => getProfileById(id)
}));

const { describirAvisoDeIngreso, camposDeclarados, ENDPOINTS_DE_CUENTA } = await import('@api/utils/audit-auth-map');
const { registrarAvisoDeIngreso } = await import('@api/services/audit-auth');
const { avisarIngreso, escucharIngresos, errorDeLoDevuelto } = await import('@cio/db/auth/audit-bridge');

const USUARIA = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const SESION = '9c8b7a65-4321-4fed-8cba-0987654321fe';
const CLAVE = 'la-clave-de-ana-no-puede-quedar-escrita';

const headers = () =>
  new Headers({
    'cf-connecting-ip': '203.0.113.10',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });

const ingresoFallido = (email = 'Ana@Consultora-Ejemplo.com.ar'): AvisoDeIngreso => ({
  tipo: 'endpoint',
  ruta: '/sign-in/email',
  metodo: 'POST',
  headers: headers(),
  cuerpo: { email, password: CLAVE },
  error: { status: 401, codigo: 'INVALID_EMAIL_OR_PASSWORD', mensaje: 'Invalid email or password' },
  usuario: null,
  sesionId: null
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sesiones: el ingreso y la salida', () => {
  it('una sesión nueva es un INGRESO con su método y la sesión que firma lo que venga después', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'sesion-creada',
      ruta: '/sign-in/email',
      metodo: 'POST',
      headers: headers(),
      sesion: { id: SESION, userId: USUARIA }
    });

    expect(fila).toMatchObject({
      destino: 'evento',
      action: 'INGRESO',
      metadata: { metodo: 'contraseña' },
      userId: USUARIA,
      sessionId: SESION,
      route: '/api/auth/sign-in/email'
    });
  });

  it('una suplantación dice quién suplantó', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'sesion-creada',
      ruta: '/admin/impersonate-user',
      metodo: 'POST',
      headers: null,
      sesion: { id: SESION, userId: USUARIA, impersonatedBy: 'admin-1' }
    });

    expect(fila?.metadata).toEqual({ metodo: 'suplantación', suplantadoPor: 'admin-1' });
  });

  it('el cierre distingue salir, vencer y cambiar la contraseña', () => {
    const cierre = (ruta: string | null) =>
      describirAvisoDeIngreso({
        tipo: 'sesion-borrada',
        ruta,
        metodo: null,
        headers: null,
        sesion: { id: SESION, userId: USUARIA }
      })?.metadata;

    expect(cierre('/sign-out')).toEqual({ motivo: 'salió' });
    expect(cierre('/get-session')).toEqual({ motivo: 'venció' });
    expect(cierre(null)).toEqual({ motivo: 'venció' });
    expect(cierre('/change-password')).toEqual({ motivo: 'cambio de contraseña' });
    expect(cierre('/admin/revoke-user-sessions')).toEqual({ motivo: 'la cerró un administrador' });
  });
});

describe('intentos fallidos', () => {
  it('un ingreso con la clave mal es una incidencia INGRESO_FALLIDO con el correo intentado', () => {
    const fila = describirAvisoDeIngreso(ingresoFallido());

    expect(fila).toMatchObject({
      destino: 'incidencia',
      kind: 'REQUEST_FAILED',
      message: 'INGRESO_FALLIDO: INVALID_EMAIL_OR_PASSWORD',
      code: 'INVALID_EMAIL_OR_PASSWORD',
      status: 401,
      metadata: { email: 'ana@consultora-ejemplo.com.ar', accion: 'INGRESO_FALLIDO' }
    });
  });

  it('el intento no se le atribuye a la dueña del correo: cualquiera puede escribirlo', () => {
    const fila = describirAvisoDeIngreso(ingresoFallido());

    expect(fila?.userId).toBeNull();
    expect(fila?.userLabel).toBeNull();
  });

  it('la clave no sale nunca, ni en la metadata ni en ningún otro campo', () => {
    const fila = describirAvisoDeIngreso(ingresoFallido());

    expect(JSON.stringify(fila)).not.toContain(CLAVE);
  });

  it('un ingreso bueno no se duplica: ya lo registra la sesión creada', () => {
    const fila = describirAvisoDeIngreso({ ...ingresoFallido(), error: null });

    expect(fila).toBeNull();
  });

  it('un admin que intenta bloquear a otro sin permiso queda con su nombre', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'endpoint',
      ruta: '/admin/ban-user',
      metodo: 'POST',
      headers: null,
      cuerpo: { userId: 'victima-1' },
      error: { status: 403, codigo: 'YOU_ARE_NOT_ALLOWED_TO_BAN_USERS', mensaje: null },
      usuario: { id: USUARIA, email: 'ana@consultora-ejemplo.com.ar' },
      sesionId: SESION
    });

    expect(fila).toMatchObject({
      destino: 'incidencia',
      message: 'ADMIN_BLOQUEO_USUARIO_FALLIDO: YOU_ARE_NOT_ALLOWED_TO_BAN_USERS',
      userLabel: 'ana@consultora-ejemplo.com.ar',
      metadata: { userId: 'victima-1' }
    });
  });

  it('un 5xx del ingreso es un error del sistema, no un intento', () => {
    const fila = describirAvisoDeIngreso({
      ...ingresoFallido(),
      error: { status: 500, codigo: null, mensaje: 'db caída' }
    });

    expect(fila).toMatchObject({ destino: 'incidencia', kind: 'BACKEND_ERROR', message: 'INGRESO_FALLIDO' });
  });
});

describe('cambios de cuenta', () => {
  it('cambiar la contraseña queda registrado sin ninguna de las dos claves', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'endpoint',
      ruta: '/change-password',
      metodo: 'POST',
      headers: null,
      cuerpo: { currentPassword: CLAVE, newPassword: `${CLAVE}-nueva`, revokeOtherSessions: true },
      error: null,
      usuario: { id: USUARIA, email: 'ana@consultora-ejemplo.com.ar' },
      sesionId: SESION
    });

    expect(fila).toMatchObject({
      destino: 'evento',
      action: 'CAMBIO_SU_CONTRASENA',
      metadata: { revokeOtherSessions: true },
      userLabel: 'ana@consultora-ejemplo.com.ar'
    });
    expect(JSON.stringify(fila)).not.toContain(CLAVE);
  });

  it('editar el usuario guarda qué campos cambió, no los valores', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'endpoint',
      ruta: '/update-user',
      metodo: 'POST',
      headers: null,
      cuerpo: { name: 'Ana Nueva', image: 'https://ejemplo.test/a.png' },
      error: null,
      usuario: { id: USUARIA, email: 'ana@consultora-ejemplo.com.ar' },
      sesionId: SESION
    });

    expect(fila?.metadata).toEqual({ campos: ['name', 'image'] });
  });

  it('un endpoint que no está en la lista no se registra, ni cuando falla', () => {
    const fila = describirAvisoDeIngreso({
      tipo: 'endpoint',
      ruta: '/list-sessions',
      metodo: 'GET',
      headers: null,
      cuerpo: undefined,
      error: { status: 401, codigo: 'UNAUTHORIZED', mensaje: null },
      usuario: null,
      sesionId: null
    });

    expect(fila).toBeNull();
  });

  it('un campo prohibido no sale aunque alguien lo declare por error', () => {
    const salida = camposDeclarados(
      { ruta: '/x', accion: 'X', campos: ['email', 'password', 'token'], nombresDeCampos: true },
      { email: 'a@b.test', password: CLAVE, token: 'secreto', otro: 1 }
    );

    expect(salida).toEqual({ email: 'a@b.test', campos: ['email', 'otro'] });
  });

  it('ningún endpoint declara un campo que sea una clave o un token', () => {
    const prohibidos = ['password', 'newPassword', 'currentPassword', 'token', 'idToken', 'code'];

    for (const endpoint of ENDPOINTS_DE_CUENTA) {
      for (const campo of endpoint.campos ?? []) {
        expect(prohibidos, `${endpoint.ruta} declara ${campo}`).not.toContain(campo);
      }
    }
  });
});

describe('el servicio que escribe', () => {
  it('el INGRESO lleva la IP y el navegador de los headers, y el email de la persona', async () => {
    await registrarAvisoDeIngreso({
      tipo: 'sesion-creada',
      ruta: '/sign-in/email',
      metodo: 'POST',
      headers: headers(),
      sesion: { id: SESION, userId: USUARIA }
    });

    expect(getProfileById).toHaveBeenCalledWith(USUARIA);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'INGRESO',
        userLabel: 'ana@consultora-ejemplo.com.ar',
        sessionId: SESION,
        ip: '203.0.113.10',
        device: 'Windows',
        browser: 'Chrome',
        // Dos ingresos seguidos son dos hechos: no pasan por la ventana anti-repetición.
        always: true
      })
    );
  });

  it('el intento fallido va a incidencias y no busca a nadie', async () => {
    await registrarAvisoDeIngreso(ingresoFallido());

    expect(recordEvent).not.toHaveBeenCalled();
    expect(getProfileById).not.toHaveBeenCalled();
    expect(recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'REQUEST_FAILED', ip: '203.0.113.10', userLabel: null })
    );
  });

  it('si no encuentra el email igual registra el ingreso', async () => {
    getProfileById.mockRejectedValueOnce(new Error('sin base'));

    await registrarAvisoDeIngreso({
      tipo: 'sesion-creada',
      ruta: '/sign-in/email',
      metodo: 'POST',
      headers: null,
      sesion: { id: SESION, userId: USUARIA }
    });

    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'INGRESO', userLabel: null, ip: null }));
  });
});

describe('el puente con Better Auth', () => {
  it('un oyente que tira no le rompe el ingreso a nadie', async () => {
    escucharIngresos(() => {
      throw new Error('explota sincrónico');
    });
    expect(() => avisarIngreso(ingresoFallido())).not.toThrow();

    escucharIngresos(async () => {
      throw new Error('explota asincrónico');
    });
    expect(() => avisarIngreso(ingresoFallido())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    escucharIngresos(null);
  });

  it('lee el status que Better Auth deja como texto', () => {
    const error = Object.assign(new Error('Invalid email or password'), {
      status: 'UNAUTHORIZED',
      body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }
    });

    expect(errorDeLoDevuelto(error)).toEqual({
      status: 401,
      codigo: 'INVALID_EMAIL_OR_PASSWORD',
      mensaje: 'Invalid email or password'
    });
    expect(errorDeLoDevuelto({ user: { id: 'x' } })).toBeNull();
  });
});
