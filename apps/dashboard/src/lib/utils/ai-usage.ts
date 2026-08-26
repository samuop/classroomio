/**
 * Cómo se muestra el consumo de IA, según quién esté mirando.
 *
 * Regla: **sólo el super-admin de la plataforma ve fichas.** Cualquier admin de
 * empresa —la consultora incluida— ve porcentajes. El consumo de IA es un dato
 * de costo del negocio, no información que la empresa necesite para trabajar:
 * lo único que le sirve saber es cuánto le queda, y eso un porcentaje lo dice
 * mejor que un número de siete cifras que nadie sabe interpretar.
 *
 * Está acá y no adentro de cada componente porque la regla se aplica en ocho
 * pantallas distintas. Una regla de visibilidad repetida es una regla que un
 * día se aplica en un lugar y en otro no — y la que se olvida es justamente la
 * que filtra el dato.
 */

/**
 * El porcentaje de un cupo, listo para mostrar.
 *
 * Se redondea a entero: la precisión decimal acá no informa nada y encima
 * sugiere una exactitud que el conteo de fichas no tiene.
 *
 * Devuelve `null` cuando no hay cupo contra el cual comparar. **`null` no es
 * `0`**: sin cupo definido no es que se consumió nada, es que la pregunta no
 * tiene respuesta, y mostrar "0%" sería afirmar algo falso.
 */
export function porcentajeDeCupo(usado: number, cupo: number): number | null {
  if (!Number.isFinite(usado) || !Number.isFinite(cupo) || cupo <= 0) return null;

  // Se topea en 100 porque un cupo se puede pasar (el corte no es instantáneo)
  // y "137% de tu cupo" es más confuso que útil para quien sólo quiere saber
  // que se quedó sin nada.
  return Math.min(100, Math.max(0, Math.round((usado / cupo) * 100)));
}

/**
 * Qué texto va donde antes iba "3.240.000 / 8.000.000 fichas".
 *
 * `null` significa "no mostrar nada": no hay dato que dar, y un guión o un
 * "0%" en su lugar se leería como un dato.
 */
export function textoDeConsumo(
  usado: number,
  cupo: number,
  esPlatformAdmin: boolean,
  traducir: (clave: string, params?: Record<string, unknown>) => string
): string | null {
  if (esPlatformAdmin) {
    if (!Number.isFinite(usado) || !Number.isFinite(cupo)) return null;

    return `${usado.toLocaleString()} / ${cupo.toLocaleString()}`;
  }

  const pct = porcentajeDeCupo(usado, cupo);

  return pct === null ? null : traducir('settings.ai_credits.percent_of_quota', { pct });
}

/**
 * Un conteo suelto de fichas (una lectura de caché, el costo de un mensaje).
 *
 * Acá **no hay porcentaje posible**: no existe un cupo contra el cual medir un
 * mensaje. Así que o se muestra el número o no se muestra nada, y para quien no
 * opera la plataforma es nada. Dejar estos sueltos anularía todo lo demás: no
 * sirve esconder el total si cada mensaje sigue anunciando "1.240.000 fichas".
 */
export function fichasSueltas(cantidad: number | undefined, esPlatformAdmin: boolean): string | null {
  if (!esPlatformAdmin || cantidad === undefined || !Number.isFinite(cantidad)) return null;

  return cantidad.toLocaleString();
}
