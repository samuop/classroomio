/**
 * La auditoría de una ronda que no llegó a cerrar.
 *
 * Medido el 2026-11-11 matando el proceso a mitad de una construcción: la
 * lección escrita quedó en el curso y en la auditoría no quedó ni una fila de
 * lo que el asistente había hecho.
 *
 * Lo falso es Redis (un mapa) y quien escribe la auditoría (un espía).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/services/audit', () => ({ recordEvent: vi.fn(async () => {}) }));

const { dejarAuditoriaPendiente, quitarAuditoriaPendiente, recuperarAuditoriaPendiente } = await import(
  '@api/services/agent/auditoria-pendiente'
);
const { auditarCambiosDeLaRonda } = await import('@api/services/agent/auditoria-del-asistente');
const { anotarCambio, registroVacio } = await import('@api/services/agent/round-ledger');

const CONVERSACION = 'c0a8012e-0000-4000-8000-000000000001';
const CURSO = 'curso-1';
const IDENTIDAD = {
  orgId: 'empresa-1',
  userId: 'docente-1',
  userLabel: 'docente@ejemplo.com.ar',
  userRole: null,
  orgRole: 1,
  sessionId: 'sesion-1',
  ip: '203.0.113.7',
  device: 'Windows',
  browser: 'Chrome',
  userAgent: 'x'
};

function almacenDePrueba({ conLeerYBorrar = false } = {}) {
  const valores = new Map<string, string>();

  return {
    valores,
    set: vi.fn(async (clave: string, valor: string, _opciones: { EX: number }) => void valores.set(clave, valor)),
    get: vi.fn(async (clave: string) => valores.get(clave) ?? null),
    del: vi.fn(async (clave: string) => void valores.delete(clave)),
    ...(conLeerYBorrar
      ? {
          getDel: vi.fn(async (clave: string) => {
            const valor = valores.get(clave) ?? null;

            valores.delete(clave);

            return valor;
          })
        }
      : {})
  };
}

function registroConUnaLeccion() {
  const registro = registroVacio();

  anotarCambio(registro, 'escribio', 'Recibir mercadería', { entidad: { tipo: 'Lesson', id: 'leccion-1' } });

  return registro;
}

const resguardar = (almacen: ReturnType<typeof almacenDePrueba>, registro = registroConUnaLeccion()) =>
  dejarAuditoriaPendiente(almacen, { identidad: IDENTIDAD, registro, courseId: CURSO, conversationId: CONVERSACION });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('lo que la ronda lleva cambiado queda a resguardo', () => {
  it('con quién la pidió, por un mes, y pisando el resguardo del paso anterior', async () => {
    const almacen = almacenDePrueba();
    const registro = registroConUnaLeccion();

    await resguardar(almacen, registro);
    anotarCambio(registro, 'creo', 'Cuestionario de recepción', { entidad: { tipo: 'Exercise', id: 'ejercicio-1' } });
    await resguardar(almacen, registro);

    expect(almacen.valores.size).toBe(1);

    const [clave, valor, opciones] = almacen.set.mock.calls.at(-1)!;

    expect(clave).toContain(CONVERSACION);
    expect(opciones.EX).toBe(30 * 24 * 60 * 60);
    expect(JSON.parse(valor)).toMatchObject({
      identidad: { userLabel: 'docente@ejemplo.com.ar', orgId: 'empresa-1' },
      courseId: CURSO,
      registro: { cambios: [{ objeto: 'Recibir mercadería' }, { objeto: 'Cuestionario de recepción' }] }
    });
  });

  it('una ronda que no cambió nada no deja resguardo', async () => {
    const almacen = almacenDePrueba();

    await resguardar(almacen, registroVacio());

    expect(almacen.set).not.toHaveBeenCalled();
  });

  it('sin Redis, o si Redis falla, la ronda sigue como si nada', async () => {
    const roto = almacenDePrueba();

    roto.set.mockRejectedValue(new Error('Redis caído'));

    await expect(resguardar(roto)).resolves.toBeUndefined();
    await expect(
      dejarAuditoriaPendiente(null, { identidad: IDENTIDAD, registro: registroConUnaLeccion(), courseId: CURSO, conversationId: CONVERSACION })
    ).resolves.toBeUndefined();
  });
});

describe('la ronda cerró bien', () => {
  it('el resguardo se borra: no queda nada para auditar después', async () => {
    const almacen = almacenDePrueba();
    const auditar = vi.fn(async () => {});

    await resguardar(almacen);
    await quitarAuditoriaPendiente(almacen, CONVERSACION);

    expect(await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar })).toBe(0);
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('la ronda murió sin cerrar', () => {
  it('lo que había cambiado se audita al volver, a nombre de quien la pidió y marcado como interrumpido', async () => {
    const almacen = almacenDePrueba();
    const registrar = vi.fn(async () => {});

    await resguardar(almacen);

    const cambios = await recuperarAuditoriaPendiente({
      almacen,
      conversationId: CONVERSACION,
      auditar: (params) => auditarCambiosDeLaRonda({ ...params, registrar })
    });

    expect(cambios).toBe(1);
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ASISTENTE_ESCRIBIO_LECCION',
        entity: 'Lesson',
        entityId: 'leccion-1',
        userId: 'docente-1',
        userLabel: 'docente@ejemplo.com.ar',
        orgId: 'empresa-1',
        metadata: expect.objectContaining({
          courseId: CURSO,
          conversationId: CONVERSACION,
          rondaInterrumpida: true,
          objeto: 'Recibir mercadería'
        })
      })
    );
  });

  it('se audita UNA vez: el segundo que pregunta ya no encuentra nada', async () => {
    const almacen = almacenDePrueba();
    const auditar = vi.fn(async () => {});

    await resguardar(almacen);

    expect(await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar })).toBe(1);
    expect(await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar })).toBe(0);
    expect(auditar).toHaveBeenCalledTimes(1);
  });

  it('con un Redis que lee y borra en un paso, lo usa', async () => {
    const almacen = almacenDePrueba({ conLeerYBorrar: true });
    const auditar = vi.fn(async () => {});

    await resguardar(almacen);
    await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar });

    expect(almacen.getDel).toHaveBeenCalledTimes(1);
    expect(almacen.get).not.toHaveBeenCalled();
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ interrumpida: true, courseId: CURSO }));
  });

  it('una auditoría normal NO lleva la marca de interrumpida', async () => {
    const registrar = vi.fn(async () => {});

    await auditarCambiosDeLaRonda({ identidad: IDENTIDAD, registro: registroConUnaLeccion(), courseId: CURSO, registrar });

    expect(registrar.mock.calls[0][0].metadata).not.toHaveProperty('rondaInterrumpida');
  });

  it('renombrar una sección se audita como sección, no como lección editada', async () => {
    const registrar = vi.fn(async () => {});
    const registro = registroVacio();

    anotarCambio(registro, 'edito', 'Cobrar en la caja', { entidad: { tipo: 'Section', id: 'seccion-1' } });
    anotarCambio(registro, 'edito', 'Abrir la caja', { entidad: { tipo: 'Lesson', id: 'leccion-1' } });
    await auditarCambiosDeLaRonda({ identidad: IDENTIDAD, registro, courseId: CURSO, registrar });

    expect(registrar.mock.calls.map(([fila]) => `${fila.action} ${fila.entity}`)).toEqual([
      'ASISTENTE_EDITO_SECCION Section',
      'ASISTENTE_EDITO_LECCION Lesson'
    ]);
  });

  it('un resguardo ilegible, o Redis caído, no rompe nada', async () => {
    const almacen = almacenDePrueba();
    const auditar = vi.fn(async () => {});

    almacen.valores.set(`agent:auditoria:pendiente:conversation:${CONVERSACION}`, '{no es json');
    expect(await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar })).toBe(0);

    almacen.get.mockRejectedValue(new Error('Redis caído'));
    expect(await recuperarAuditoriaPendiente({ almacen, conversationId: CONVERSACION, auditar })).toBe(0);
    expect(await recuperarAuditoriaPendiente({ almacen: null, conversationId: CONVERSACION, auditar })).toBe(0);
    expect(auditar).not.toHaveBeenCalled();
  });
});
