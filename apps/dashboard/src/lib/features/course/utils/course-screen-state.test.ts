import { getCourseScreenState, type CourseScreenStateInput } from './course-screen-state';

/**
 * El caso que motivó todo esto: el 2026-08-25 una admin abrió un curso que
 * estaba borrado (`status = 'DELETED'`), la API respondió 404 — correctamente —
 * y la pantalla se quedó en "Cargando el curso…" para siempre. La auditoría lo
 * registró; ningún test lo había visto, porque hasta entonces el fracaso y la
 * espera eran el mismo estado y no había nada que afirmar.
 */
const base: CourseScreenStateInput = {
  requestedCourseId: 'curso-1',
  loadedCourseId: 'curso-1',
  hasGroup: true,
  loadFailed: false
};

describe('getCourseScreenState', () => {
  it('está listo cuando el curso cargado es el que pidió la ruta', () => {
    expect(getCourseScreenState(base)).toBe('ready');
  });

  it('sigue cargando mientras no llegó nada y no falló nada', () => {
    expect(
      getCourseScreenState({ ...base, loadedCourseId: undefined, hasGroup: false })
    ).toBe('loading');
  });

  it('muestra el error cuando el pedido terminó sin curso', () => {
    // Este es el 404 del curso borrado. Antes daba 'loading' (spinner eterno).
    expect(
      getCourseScreenState({
        ...base,
        loadedCourseId: undefined,
        hasGroup: false,
        loadFailed: true
      })
    ).toBe('error');
  });

  it('sigue cargando, no da error, mientras el pedido está en vuelo', () => {
    // Distinguir esto del caso anterior es todo el punto del arreglo.
    expect(
      getCourseScreenState({
        ...base,
        loadedCourseId: undefined,
        hasGroup: false,
        loadFailed: false
      })
    ).toBe('loading');
  });

  it('no se queda con el curso anterior al navegar a otro', () => {
    // Sin comparar contra el id pedido, pasar de un curso a otro mostraba el
    // viejo mientras cargaba el nuevo.
    expect(getCourseScreenState({ ...base, requestedCourseId: 'curso-2' })).toBe('loading');
  });

  it('da error si al navegar a otro curso ese otro falla', () => {
    expect(
      getCourseScreenState({ ...base, requestedCourseId: 'curso-2', loadFailed: true })
    ).toBe('error');
  });

  it('sigue cargando si llegó el curso pero todavía no el grupo', () => {
    expect(getCourseScreenState({ ...base, hasGroup: false })).toBe('loading');
  });

  it('mantiene el curso en pantalla si falla un refresco posterior', () => {
    // Vaciarle la pantalla a alguien que está leyendo, por un error que no le
    // impide seguir, sería peor que ignorarlo.
    expect(getCourseScreenState({ ...base, loadFailed: true })).toBe('ready');
  });

  it('no está listo sin id de curso en la ruta', () => {
    expect(
      getCourseScreenState({ ...base, requestedCourseId: undefined, loadedCourseId: undefined })
    ).toBe('loading');
  });
});
