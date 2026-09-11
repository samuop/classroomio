/**
 * Enlaces que el agente escribe a contenido que no existe.
 *
 * El agente cierra una construcción con un resumen que enlaza lo que hizo:
 * `@[Título](lesson:<id>)`. El id lo tiene que copiar de lo que devolvió la
 * herramienta, y a veces no lo hace: medido en dev, un resumen enlazó una
 * lección con `798ca7a5-…` cuando la herramienta había devuelto `585f735a-…`.
 * No era un error de tipeo — ese UUID no aparecía en ningún lado de la ronda.
 * El prompt ya lo prohíbe ("NEVER paraphrase or regenerate UUIDs").
 *
 * La garantía para el docente vive en el dashboard, que es donde el enlace se
 * muestra y se hace clic: ahí se contrasta contra el curso y se repara por
 * título (`mentions.ts`). Esto no arregla nada: MIDE. Dice cuántas veces pasa y
 * si la reparación por título alcanza, que es lo que decide si hace falta
 * atacarlo también en el origen.
 */

const MENCION = /@\[([^\]]+)\]\((lesson|exercise|section):([a-zA-Z0-9_-]+)\)/gi;

export interface ItemDelCurso {
  id: string;
  type: string;
  title: string | null;
}

export interface MencionRota {
  titulo: string;
  tipo: 'lesson' | 'exercise' | 'section';
  id: string;
  /** El título nombra exactamente un ítem de ese tipo: el dashboard lo repara. */
  reparablePorTitulo: boolean;
}

/** Misma normalización que el dashboard: si difieren, esta medición mentiría. */
function normalizar(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Las menciones del texto cuyo id no es de ningún ítem del curso.
 *
 * Un id que existe pero con otro tipo no cuenta como roto: apunta a algo real,
 * y el dashboard lo resuelve. Lo que se busca es el id que no es de nada.
 */
export function mencionesRotas(texto: string, items: ItemDelCurso[]): MencionRota[] {
  const ids = new Set(items.map((item) => item.id));
  const rotas: MencionRota[] = [];

  for (const [, titulo, tipoCrudo, id] of texto.matchAll(MENCION)) {
    if (ids.has(id)) continue;

    const tipo = tipoCrudo.toLowerCase() as MencionRota['tipo'];
    const buscado = normalizar(titulo);
    const coincidencias = buscado
      ? items.filter((item) => item.type.toLowerCase() === tipo && normalizar(item.title ?? '') === buscado)
      : [];

    rotas.push({ titulo, tipo, id, reparablePorTitulo: coincidencias.length === 1 });
  }

  return rotas;
}
