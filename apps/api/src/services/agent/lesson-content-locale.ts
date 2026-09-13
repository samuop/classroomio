/**
 * El cuerpo de una lección en el idioma pedido, o en el que haya.
 *
 * El contenido vive en una fila por idioma, y quien lee pedía el idioma del
 * pedido con respaldo sólo en inglés. Un curso escrito en español, pedido sin
 * idioma (la API cae en 'en'), devolvía `content: null` para cada lección: el
 * tutor del estudiante buscaba, leía vacío, volvía a buscar y se quedaba sin
 * pasos sin contestar. Medido contra producción el 2026-09-13.
 *
 * Orden: el idioma pedido, después inglés (lo que ya se hacía), después
 * cualquier idioma que tenga texto. Una lección en otro idioma sirve más que
 * ninguna: el modelo responde en el idioma de la conversación igual.
 */
export function contenidoEnIdioma(
  idiomas: Array<{ locale: string; content: string | null }> | undefined,
  locale: string
): string | null {
  const conTexto = (idiomas ?? []).filter((fila) => typeof fila.content === 'string' && fila.content.trim().length > 0);

  return (
    conTexto.find((fila) => fila.locale === locale)?.content ??
    conTexto.find((fila) => fila.locale === 'en')?.content ??
    conTexto[0]?.content ??
    null
  );
}
