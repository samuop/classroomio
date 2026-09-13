import { temaInicial } from './theme';

/**
 * El color con el que arranca la pantalla, antes de saber en qué empresa está
 * el usuario.
 *
 * En el dominio de una consultora conviven la consultora y sus empresas
 * cliente. Al cargar sólo se conoce la dueña del dominio, y la empresa del
 * usuario llega medio segundo después con la lista de sus empresas: pintar el
 * color de la dueña primero hacía que un estudiante de la empresa cliente viera
 * la marca de la consultora y, enseguida, la suya.
 */

describe('temaInicial', () => {
  it('con sesión, arranca con el último color que vio el usuario en este dominio', () => {
    expect(temaInicial({ temaDelDominio: 'purple', temaGuardado: '#0f766e', conSesion: true })).toBe('#0f766e');
  });

  it('sin sesión (el login), muestra la marca del dominio aunque haya un color guardado', () => {
    // Quien todavía no entró no pertenece a ninguna empresa: la pantalla es de la dueña del dominio.
    expect(temaInicial({ temaDelDominio: 'purple', temaGuardado: '#0f766e', conSesion: false })).toBe('purple');
  });

  it('la primera vez, sin color guardado, usa el del dominio', () => {
    expect(temaInicial({ temaDelDominio: 'purple', temaGuardado: null, conSesion: true })).toBe('purple');
    expect(temaInicial({ temaDelDominio: 'purple', temaGuardado: '', conSesion: true })).toBe('purple');
  });

  it('ignora un valor guardado que no es un color', () => {
    // Termina dentro de un <style>: lo que no sea un nombre de tema o un hex no se usa.
    expect(temaInicial({ temaDelDominio: 'purple', temaGuardado: 'red;} body{display:none', conSesion: true })).toBe(
      'purple'
    );
  });

  it('cae en el azul de siempre si el dominio no tiene color', () => {
    expect(temaInicial({ temaDelDominio: null, temaGuardado: null, conSesion: false })).toBe('blue');
  });
});
