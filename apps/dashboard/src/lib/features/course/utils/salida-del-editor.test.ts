import { guardaAlSalirDeEditar } from './salida-del-editor';

/**
 * Medido el 2026-11-10: «Dejar de editar sin guardar» guardó (un PUT y un POST)
 * y borró el cambio que otra sesión había guardado 3 segundos antes.
 */
describe('si se guarda al salir de la edición', () => {
  const base = { salidaAtendida: false, hayCambios: true, hayChoque: false };

  it('la flecha «atrás» con cambios sin guardar: se guarda', () => {
    expect(guardaAlSalirDeEditar(base)).toBe(true);
  });

  it('«dejar de editar sin guardar» no guarda, aunque haya cambios', () => {
    expect(guardaAlSalirDeEditar({ ...base, salidaAtendida: true })).toBe(false);
  });

  it('sin cambios no hay nada que guardar: no se reescribe la lección con lo que había cargado', () => {
    expect(guardaAlSalirDeEditar({ ...base, hayCambios: false })).toBe(false);
  });

  it('con un choque a la vista no se guarda solo: decide la docente', () => {
    expect(guardaAlSalirDeEditar({ ...base, hayChoque: true })).toBe(false);
  });
});
