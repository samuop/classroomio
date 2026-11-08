/**
 * Lo que la ronda CAMBIÓ de verdad, medido por el servidor.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * El relato del modelo sobre su propio trabajo no es evidencia. Medido en un
 * solo día de producción, cuatro veces:
 *
 * - dijo haber escrito una lección con un id que no existe en el curso;
 * - dijo haber eliminado seis menciones cuando había eliminado cuatro;
 * - se atribuyó diagramas que ya estaban de antes;
 * - dijo «era la única lección donde figuraba» justo después de editar cinco.
 *
 * No son errores de capacidad: el modelo narra de memoria al final de una ronda
 * larga, y su memoria de lo que hizo compite con todo lo demás que tiene en
 * contexto. Pedirle que sea más cuidadoso es la clase de arreglo que ya
 * probamos hoy con el presupuesto de pasos —el aviso llegó quince veces y no
 * cambió nada—.
 *
 * ── Qué hace en cambio ───────────────────────────────────────────────────────
 *
 * El servidor ya sabe qué pasó: cada cambio pasa por una herramienta suya. Esto
 * lo anota mientras ocurre y lo devuelve con la ronda, para mostrarlo AL LADO
 * del relato. No impide que el modelo diga cualquier cosa; hace que el docente
 * pueda verlo.
 *
 * Es el mismo principio que el informe de construcción de cada lección y que el
 * progreso del plan —que ya reemplazó, por este mismo motivo, la lista que
 * llevaba el modelo y que «derivaba de la realidad porque nada lo obligaba a
 * mantenerla al día»—.
 *
 * ── Lo que NO registra ───────────────────────────────────────────────────────
 *
 * Las lecturas. Una ronda puede leer cuarenta veces y no cambiar nada, y eso no
 * es lo que el docente necesita comprobar. Sólo se anota lo que dejó el curso
 * distinto de como estaba.
 */

/** Qué fila del curso se tocó: lo que la auditoría registra como entidad. */
export interface EntidadDelCambio {
  tipo: 'Lesson' | 'Exercise' | 'Section' | 'Course';
  id: string;
}

/** Una cosa que cambió. `objeto` es lo que el docente reconoce: el título. */
export interface CambioDeRonda {
  accion:
    | 'escribio'
    | 'edito'
    | 'creo'
    | 'borro'
    | 'ilustro'
    | 'pregunto'
    | 'saco_del_plan'
    | 'cambio_el_plan'
    /** Un cambio que toca notas, guardado como propuesta: NO se aplicó. Ver `cambios-con-entregas.ts`. */
    | 'propuso';
  objeto: string;
  /** Cuántas veces pasó lo mismo sobre lo mismo. */
  veces: number;
  entidad?: EntidadDelCambio;
  /**
   * Sólo en `pregunto`: cuántas se agregaron y con cuántos puntos, y una línea
   * por pregunta reescrita. «Cambió las preguntas (3 veces)» escondió doce
   * preguntas nuevas en un examen ya rendido. Ver `resumen-de-preguntas.ts`.
   */
  preguntas?: { agregadas: number; puntos: number; cambios: string[] };
}

/** Lo que una escritura puede agregar a su renglón. */
export interface DetalleDelCambio {
  entidad?: EntidadDelCambio;
  agregadas?: { cantidad: number; puntos: number };
  cambios?: string[];
}

export interface RegistroDeRonda {
  cambios: CambioDeRonda[];
}

export function registroVacio(): RegistroDeRonda {
  return { cambios: [] };
}

/**
 * Anota un cambio, juntando las repeticiones sobre el mismo objeto.
 *
 * Se juntan porque tres ediciones a la misma lección son un hecho —«la tocó
 * tres veces»— y no tres hechos, y una lista de treinta líneas repetidas es
 * tan ilegible como no tener nada.
 */
export function anotarCambio(
  registro: RegistroDeRonda,
  accion: CambioDeRonda['accion'],
  objeto: string,
  detalle: DetalleDelCambio = {}
): void {
  const limpio = objeto.trim() || '(sin título)';
  let cambio = registro.cambios.find((c) => c.accion === accion && c.objeto === limpio);

  if (cambio) {
    cambio.veces += 1;
  } else {
    cambio = { accion, objeto: limpio, veces: 1 };
    registro.cambios.push(cambio);
  }

  if (detalle.entidad && !cambio.entidad) cambio.entidad = detalle.entidad;
  if (detalle.agregadas || detalle.cambios?.length) {
    const preguntas = (cambio.preguntas ??= { agregadas: 0, puntos: 0, cambios: [] });

    preguntas.agregadas += detalle.agregadas?.cantidad ?? 0;
    preguntas.puntos += detalle.agregadas?.puntos ?? 0;
    for (const linea of detalle.cambios ?? []) {
      if (!preguntas.cambios.includes(linea)) preguntas.cambios.push(linea);
    }
  }
}

/** Hasta cuántas reescrituras se nombran en un renglón; el resto se cuenta. */
const REESCRITURAS_A_LA_VISTA = 5;

function detalleDePreguntas(preguntas: NonNullable<CambioDeRonda['preguntas']>): string {
  const partes: string[] = [];

  if (preguntas.agregadas > 0) {
    partes.push(
      `agregó ${preguntas.agregadas} ${preguntas.agregadas === 1 ? 'pregunta' : 'preguntas'} (${preguntas.puntos} ${preguntas.puntos === 1 ? 'punto' : 'puntos'})`
    );
  }

  const aLaVista = preguntas.cambios.slice(0, REESCRITURAS_A_LA_VISTA);
  const resto = preguntas.cambios.length - aLaVista.length;

  partes.push(...aLaVista);
  if (resto > 0) partes.push(`y ${resto} ${resto === 1 ? 'cambio' : 'cambios'} más`);

  return partes.join('; ');
}

const COMO_SE_DICE: Record<CambioDeRonda['accion'], string> = {
  escribio: 'Escribió',
  edito: 'Editó',
  creo: 'Creó',
  borro: 'Borró',
  ilustro: 'Ilustró',
  pregunto: 'Cambió las preguntas de',
  saco_del_plan: 'Sacó del plan',
  cambio_el_plan: 'Cambió en el plan',
  propuso: 'Propuso, para tu aprobación, un cambio en'
};

/**
 * El registro en líneas que lee una persona, en español y en el orden en que
 * pasó.
 *
 * Se arma acá y no en el dashboard porque es un hecho, no una vista: si el día
 * de mañana se manda por correo o se guarda en la auditoría, tiene que decir lo
 * mismo.
 */
export function lineasDelRegistro(registro: RegistroDeRonda): string[] {
  return registro.cambios.map((c) => {
    const veces = c.veces > 1 ? ` (${c.veces} veces)` : '';
    const detalle = c.preguntas ? detalleDePreguntas(c.preguntas) : '';

    return `${COMO_SE_DICE[c.accion]} «${c.objeto}»${veces}${detalle ? `: ${detalle}` : ''}`;
  });
}
