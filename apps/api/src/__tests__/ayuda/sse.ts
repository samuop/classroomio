/**
 * Lee la respuesta de una ronda del chat como la lee el navegador: SSE, una
 * parte JSON por evento `data:`.
 *
 * Vive acá porque la usan el test de la ronda y el de la ruta, y las dos tienen
 * que leer exactamente lo mismo que el cliente: si una leyera distinto, podría
 * pasar un test con una respuesta que el navegador no entiende.
 */

export type ParteDeLaRonda = { type: string; [clave: string]: unknown };

/**
 * Lee partes hasta que `seguir` diga que no, o hasta el final.
 *
 * Devuelve el lector abierto: el test que simula al navegador que se va lo
 * cancela, como hace el servidor HTTP cuando se cierra la conexión.
 */
export async function leerPartes(
  respuesta: Response,
  seguir: (parte: ParteDeLaRonda) => boolean = () => true
): Promise<{ partes: ParteDeLaRonda[]; lector: ReadableStreamDefaultReader<Uint8Array> }> {
  const lector = respuesta.body!.getReader();
  const decodificador = new TextDecoder();
  const partes: ParteDeLaRonda[] = [];
  let pendiente = '';

  while (true) {
    const { done, value } = await lector.read();

    if (done) break;

    pendiente += decodificador.decode(value, { stream: true });

    let corte = pendiente.indexOf('\n\n');

    while (corte >= 0) {
      const evento = pendiente.slice(0, corte).trim();
      pendiente = pendiente.slice(corte + 2);
      corte = pendiente.indexOf('\n\n');

      if (!evento.startsWith('data: ') || evento === 'data: [DONE]') continue;

      const parte = JSON.parse(evento.slice('data: '.length)) as ParteDeLaRonda;
      partes.push(parte);

      if (!seguir(parte)) return { partes, lector };
    }
  }

  return { partes, lector };
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Espera a que `condicion` se cumpla, con un tope: una ronda colgada tiene que fallar, no colgar el test. */
export async function hasta(condicion: () => boolean, topeMs = 3_000): Promise<void> {
  const inicio = Date.now();

  while (!condicion()) {
    if (Date.now() - inicio > topeMs) throw new Error('la ronda no terminó');
    await esperar(5);
  }
}
