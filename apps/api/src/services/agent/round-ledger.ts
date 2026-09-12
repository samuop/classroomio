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

/** Una cosa que cambió. `objeto` es lo que el docente reconoce: el título. */
export interface CambioDeRonda {
  accion: 'escribio' | 'edito' | 'creo' | 'borro' | 'ilustro' | 'pregunto';
  objeto: string;
  /** Cuántas veces pasó lo mismo sobre lo mismo. */
  veces: number;
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
export function anotarCambio(registro: RegistroDeRonda, accion: CambioDeRonda['accion'], objeto: string): void {
  const limpio = objeto.trim() || '(sin título)';
  const ya = registro.cambios.find((c) => c.accion === accion && c.objeto === limpio);

  if (ya) {
    ya.veces += 1;
    return;
  }

  registro.cambios.push({ accion, objeto: limpio, veces: 1 });
}

const COMO_SE_DICE: Record<CambioDeRonda['accion'], string> = {
  escribio: 'Escribió',
  edito: 'Editó',
  creo: 'Creó',
  borro: 'Borró',
  ilustro: 'Ilustró',
  pregunto: 'Cambió las preguntas de'
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

    return `${COMO_SE_DICE[c.accion]} «${c.objeto}»${veces}`;
  });
}
