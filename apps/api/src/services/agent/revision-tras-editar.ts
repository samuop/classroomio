import type { FuenteVista, Verificador } from '@api/services/agent/grounding';

/**
 * Cerrar el lazo: cuando el agente edita una lección para tapar un aviso de
 * fundamento, alguien tiene que volver a mirar.
 *
 * ── Lo que pasó (producción, 2026-09-15) ─────────────────────────────────────
 *
 * El chequeo de fundamento corre en `writeLessonBody`, que es por donde pasan
 * los tres caminos que guardan una lección ENTERA. Los retoques quirúrgicos
 * —`edit_lesson_content`, `replace_lesson_block`— quedaban afuera a propósito,
 * con esta justificación escrita en el código:
 *
 *     «son de una frase, con el docente mirando».
 *
 * Las dos mitades de esa suposición fallaron a la vez. El que editó no fue la
 * docente sino EL PROPIO AGENTE, en medio de una construcción; y lo hizo
 * justamente para responder un aviso de fundamento.
 *
 * El verificador había citado UNA frase, que endurecía una regla del manual
 * hasta convertirla en otra cosa. El agente arregló esa frase exacta y dejó la
 * misma afirmación sin respaldo en otros cinco lugares de la lección —títulos,
 * viñetas, el diagrama y hasta un guión para decirle al cliente—. Nada volvió a
 * mirar; el examen se escribió después a partir de ese texto, y la afirmación
 * falsa terminó siendo la respuesta correcta de una pregunta.
 *
 * **Arreglar la frase citada no es arreglar la afirmación.**
 *
 * ── Por qué así y no de otra manera ──────────────────────────────────────────
 *
 * - **Sólo sobre lecciones marcadas.** Chequear cada edición saldría a la red
 *   en cada retoque de una coma y gastaría en la enorme mayoría de los casos,
 *   donde no hay nada que verificar. Acá sólo se rechequea lo que esta misma
 *   ronda dejó marcado, que es exactamente donde el lazo está abierto.
 * - **Sobre la lección ENTERA, no sobre el fragmento.** Los avisos que estos
 *   tools devuelven miran sólo lo que la edición escribió, y con razón: avisar
 *   de un diagrama que el docente no tocó lo manda a perseguir otra cosa. Pero
 *   para el fundamento ese recorte ES el defecto — la afirmación sobrevivía en
 *   los párrafos que la edición no tocó.
 * - **Con las MISMAS fuentes.** Se guarda lo que el verificador tuvo delante al
 *   escribir, así que el rechequeo es tan estricto como el original. Recargarlas
 *   sería otro chequeo, más blando, disfrazado del mismo.
 * - **Falla abierto**, como el original: si el verificador se cae, la edición ya
 *   está guardada y no se pierde.
 *
 * Lo que NO cubre: una lección marcada en una ronda anterior. El registro vive
 * por ronda, igual que `registro` y `presupuestoDePasos`, y por el mismo motivo
 * —dos rondas simultáneas se pisarían—. El caso medido es dentro de la ronda.
 */

/** Lo que hizo falta para chequear una lección, guardado para poder repetirlo igual. */
export type ChequeoDeLaLeccion = {
  avisos: string[];
  /** Lo que el verificador tuvo delante. `undefined` = el paquete del curso. */
  soloFuentes?: FuenteVista[];
};

export type RegistroDeAvisos = Map<string, ChequeoDeLaLeccion>;

export function crearRegistroDeAvisos(): RegistroDeAvisos {
  return new Map();
}

/**
 * Anota el resultado de un chequeo, o lo borra si salió limpio.
 *
 * Borrar importa tanto como anotar: una lección reescrita entera y sin avisos
 * dejó de estar marcada, y la próxima edición no tiene por qué pagar un
 * rechequeo.
 */
export function anotarChequeo(registro: RegistroDeAvisos, lessonId: string, chequeo: ChequeoDeLaLeccion): void {
  if (chequeo.avisos.length > 0) registro.set(lessonId, chequeo);
  else registro.delete(lessonId);
}

/** Si esta lección quedó con avisos abiertos en esta ronda. */
export function tieneAvisosAbiertos(registro: RegistroDeAvisos, lessonId: string): boolean {
  return registro.has(lessonId);
}

export type ResultadoDeLaRevision = {
  /** Lo que sigue sin respaldo DESPUÉS de la edición. Vacío = quedó saneado. */
  groundingWarnings: string[];
  /** El aviso que se estaba arreglando ya no aparece. */
  resuelto: boolean;
};

/**
 * Vuelve a chequear la lección entera después de una edición, si hacía falta.
 *
 * `undefined` significa «no había nada que rechequear» (la lección no estaba
 * marcada ni bajo orden de trabajo, o esta ronda no tiene verificador), y NO
 * «salió limpia»: quien lo llama no debe contarle nada al modelo en ese caso.
 */
export async function revisarTrasEditar(params: {
  registro: RegistroDeAvisos;
  lessonId: string;
  lessonTitle: string;
  /** La lección COMPLETA ya guardada, no el fragmento que se acaba de escribir. */
  contenido: string;
  verificarFundamento?: Verificador;
  /**
   * Rechequear aunque la lección no esté marcada.
   *
   * Es el caso del plan de cambios: el servidor mandó editar ESTA lección, así
   * que lo que la edición escribió es texto nuevo que nadie miró todavía —
   * exactamente la situación que el rechequeo cubre, sólo que llegando por la
   * orden de trabajo en vez de por un aviso anterior.
   *
   * Quien llama se ocupa de no pedirlo dos veces por la misma lección: acá no
   * hay estado de ronda, y meter un contador sería duplicar el que ya existe
   * del otro lado.
   */
  bajoOrdenDeTrabajo?: boolean;
}): Promise<ResultadoDeLaRevision | undefined> {
  const pendiente = params.registro.get(params.lessonId);

  if (!params.verificarFundamento) return undefined;
  if (!pendiente && !params.bajoOrdenDeTrabajo) return undefined;

  // Se lee ANTES del try a propósito: adentro sólo va la llamada que sale a la
  // red. Con esta línea adentro, un error de programación acá se atrapaba como
  // si fuera una caída del proveedor y el rechequeo se salteaba en silencio
  // —lo destapó una mutación, con el test pasando igual—.
  //
  // Sin lección marcada no hay fuentes guardadas, y `undefined` no es un
  // descuido: es «contrastá contra el paquete del curso». Es lo correcto para
  // una lección que ya existía —no se sabe con qué se escribió— y es lo que la
  // orden de trabajo necesita.
  const soloFuentes = pendiente?.soloFuentes;
  let avisos: string[];

  try {
    avisos = await params.verificarFundamento({
      lessonTitle: params.lessonTitle,
      contenido: params.contenido,
      soloFuentes
    });
  } catch (error) {
    // Falla abierto: la edición ya está guardada y el aviso original sigue
    // anotado, así que la próxima edición vuelve a intentarlo.
    console.error('[fundamento] no se pudo rechequear la lección tras editarla:', error);

    return undefined;
  }

  anotarChequeo(params.registro, params.lessonId, { avisos, soloFuentes });

  return { groundingWarnings: avisos, resuelto: avisos.length === 0 };
}
