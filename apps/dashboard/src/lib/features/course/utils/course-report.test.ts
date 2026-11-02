// @vitest-environment jsdom
import { vi } from 'vitest';

/**
 * La descarga del reporte de alumnos desde la pantalla de calificaciones.
 *
 * El archivo lo arma el servidor; acá se fija que se pida el formato elegido,
 * que se guarde con el nombre que manda el servidor, y que un error llegue como
 * `false` para que la pantalla avise en vez de quedarse callada.
 */

const falso = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock('$lib/utils/services/api', () => ({
  classroomio: { course: { ':courseId': { mark: { report: { $get: falso.$get } } } } }
}));

const { descargarReporteDeAlumnos } = await import('./course-report');

const guardados: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  guardados.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:reporte');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    guardados.push(this.download);
  });
});

describe('descargar el reporte de alumnos', () => {
  it('pide el formato elegido y lo guarda con el nombre que manda el servidor', async () => {
    falso.$get.mockResolvedValue(
      new Response('%PDF', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="Curso-de-prueba-alumnos.pdf"' }
      })
    );

    expect(await descargarReporteDeAlumnos('curso-1', 'pdf')).toBe(true);

    expect(falso.$get).toHaveBeenCalledWith({ param: { courseId: 'curso-1' }, query: { format: 'pdf' } });
    expect(guardados).toEqual(['Curso-de-prueba-alumnos.pdf']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reporte');
  });

  it('sin nombre del servidor, lo guarda con uno propio del formato', async () => {
    falso.$get.mockResolvedValue(new Response('xlsx', { status: 200 }));

    await descargarReporteDeAlumnos('curso-1', 'xlsx');

    expect(guardados).toEqual(['alumnos.xlsx']);
  });

  it('si el servidor no lo pudo armar, devuelve false y no guarda nada', async () => {
    falso.$get.mockResolvedValue(new Response('{"success":false}', { status: 500 }));

    expect(await descargarReporteDeAlumnos('curso-1', 'xlsx')).toBe(false);
    expect(guardados).toEqual([]);
  });
});
