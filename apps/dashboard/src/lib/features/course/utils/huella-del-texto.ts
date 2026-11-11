/**
 * La huella del texto que el editor tenía cargado (SHA-256, en hexadecimal).
 *
 * Viaja con cada guardado: el servidor la compara con lo que tiene guardado y
 * rechaza el guardado si ya es otro texto (ver `lesson-conflict.ts` en la API).
 *
 * Sin `crypto.subtle` —una página servida por http que no es localhost— no hay
 * huella, y el guardado sale como siempre: sin protección, pero sale.
 */
export async function huellaDelTexto(texto: string): Promise<string | undefined> {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));

    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}
