import { fichasSueltas, porcentajeDeCupo, textoDeConsumo } from './ai-usage';

/**
 * La regla de qué se muestra del consumo de IA.
 *
 * Vale la pena probarla sola, aparte de las pantallas, porque es una regla de
 * **visibilidad**: cuando falla no se rompe nada, simplemente aparece un número
 * que no tenía que aparecer, y eso no lo nota ninguna herramienta.
 */

const traducir = (clave: string, params?: Record<string, unknown>) => `${clave}:${params?.pct}`;

describe('porcentajeDeCupo', () => {
  it('redondea a entero', () => {
    expect(porcentajeDeCupo(1, 3)).toBe(33);
    expect(porcentajeDeCupo(2, 3)).toBe(67);
  });

  it('topea en 100 cuando se pasó del cupo', () => {
    // El corte no es instantáneo, así que pasarse es normal. "137% de tu cupo"
    // no le sirve a nadie que sólo quiere saber que se quedó sin nada.
    expect(porcentajeDeCupo(11_000, 10_000)).toBe(100);
  });

  it('sin cupo devuelve null, que NO es lo mismo que 0', () => {
    // Si devolviera 0 la pantalla diría "0% consumido", que es una afirmación
    // falsa: no es que no se consumió, es que no se sabe contra qué medir.
    expect(porcentajeDeCupo(5_000, 0)).toBeNull();
    expect(porcentajeDeCupo(5_000, -1)).toBeNull();
    expect(porcentajeDeCupo(Number.NaN, 10)).toBeNull();
    expect(porcentajeDeCupo(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('nunca devuelve un porcentaje negativo', () => {
    expect(porcentajeDeCupo(-500, 10_000)).toBe(0);
  });
});

describe('textoDeConsumo', () => {
  it('al super-admin le da los números', () => {
    expect(textoDeConsumo(3_240_000, 8_000_000, true, traducir)).toBe(
      `${(3_240_000).toLocaleString()} / ${(8_000_000).toLocaleString()}`
    );
  });

  it('a cualquier otro le da el porcentaje, sin el cupo', () => {
    const texto = textoDeConsumo(3_240_000, 8_000_000, false, traducir);

    // Lo que importa no es el formato sino que NINGUNA de las dos cifras
    // sobreviva: con el porcentaje y el cupo a la vista, lo consumido se
    // despeja con una división.
    expect(texto).toContain('41');
    expect(texto).not.toContain('3.240.000');
    expect(texto).not.toContain('3,240,000');
    expect(texto).not.toContain('8.000.000');
    expect(texto).not.toContain('8,000,000');
  });

  it('sin cupo no muestra nada, en vez de caer al número', () => {
    // Éste es el caso que filtraría el dato: si el fallback fuera "mostrar las
    // fichas cuando no hay cupo", bastaría con que la empresa no tenga cupo
    // configurado para que se vean todas.
    expect(textoDeConsumo(3_240_000, 0, false, traducir)).toBeNull();
  });
});

describe('fichasSueltas', () => {
  it('sólo el super-admin ve un conteo suelto', () => {
    expect(fichasSueltas(1_240_000, true)).toBe((1_240_000).toLocaleString());
    expect(fichasSueltas(1_240_000, false)).toBeNull();
  });

  it('sin dato devuelve null aunque sea super-admin', () => {
    expect(fichasSueltas(undefined, true)).toBeNull();
  });
});
