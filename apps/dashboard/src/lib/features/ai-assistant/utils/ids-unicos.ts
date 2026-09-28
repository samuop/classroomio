/**
 * Los mensajes de una conversación guardada, con un id distinto cada uno.
 *
 * La lista del chat los dibuja con `{#each … (message.id)}`, y Svelte corta con
 * `each_key_duplicate` si dos se repiten: la pantalla entera cae en «Se rompió
 * esta pantalla». Pasó en producción con historiales guardados con el id vacío
 * en cada respuesta del asistente — abrir el Asistente de esos cursos era
 * imposible.
 *
 * El primero que usa un id se lo queda; a los repetidos o vacíos se les da uno
 * derivado de su posición, estable entre recargas (no aleatorio), así el mismo
 * historial se dibuja siempre igual y, al volver a guardarse, queda sano.
 */
export function conIdsUnicos<T extends { id?: string | null }>(mensajes: T[]): T[] {
  const usados = new Set<string>();
  let cambio = false;

  const resultado = mensajes.map((mensaje, indice) => {
    const id = typeof mensaje.id === 'string' ? mensaje.id.trim() : '';
    if (id && !usados.has(id)) {
      usados.add(id);
      return mensaje;
    }

    let nuevo = `${id || 'msg'}-${indice}`;
    while (usados.has(nuevo)) nuevo = `${nuevo}-b`;
    usados.add(nuevo);
    cambio = true;
    return { ...mensaje, id: nuevo };
  });

  return cambio ? resultado : mensajes;
}
