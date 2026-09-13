/**
 * El último paso de una ronda de estudiante termina con una respuesta.
 *
 * Medido en producción (2026-09-13): ante una pregunta cuya respuesta no está en
 * el curso, el tutor leía lección tras lección buscándola, llegaba al tope de
 * pasos con una llamada a herramienta y la ronda cerraba sin una sola palabra.
 * El estudiante recibía una respuesta vacía justo cuando lo correcto era decirle
 * «eso no está en el curso».
 *
 * Cómo se corta, y por qué así: forzando la llegada al último paso con
 * gemini-flash-latest, `toolChoice: 'none'` no cortó nada (0 de 4 respuestas,
 * el modelo llamó igual a la herramienta; fue lo primero que se desplegó y en
 * producción siguió cerrando con `finish=tool-calls steps=12`). Sacar las
 * herramientas con `activeTools: []` tampoco (0 de 4). Sacarlas y además decirle
 * que conteste ya con lo que leyó: 4 de 4.
 *
 * El docente no: su ronda se retoma con «Continuar».
 */

export const AVISO_DE_ULTIMO_PASO =
  'No more tools are available for this reply. Answer the learner now using only what you already read; if it does not cover the question, say so.';

export function esUltimoPasoDelEstudiante({
  esEstudiante,
  paso,
  maximoDePasos
}: {
  esEstudiante: boolean;
  /** Base 0, como el `stepNumber` de `prepareStep`. */
  paso: number;
  maximoDePasos: number;
}): boolean {
  return esEstudiante && paso >= maximoDePasos - 1;
}

/** Lo que devuelve `prepareStep` en ese último paso: sin herramientas y con el pedido de contestar. */
export function cerrarConRespuesta<M>(mensajes: M[]): {
  activeTools: [];
  messages: Array<M | { role: 'user'; content: string }>;
} {
  return {
    activeTools: [],
    messages: [...mensajes, { role: 'user', content: AVISO_DE_ULTIMO_PASO }]
  };
}
