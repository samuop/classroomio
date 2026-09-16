/**
 * El último paso de una ronda termina con una respuesta, sea de quien sea.
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
 * ── Por qué ahora también el docente ─────────────────────────────────────────
 *
 * Quedaba afuera porque su ronda se retoma con «Continuar», y eso sigue siendo
 * cierto: el botón aparece igual. Pero una ronda de construcción que choca
 * contra el techo cierra con 40 llamadas a herramienta y ni una palabra, así que
 * lo único que no llega es el juicio del modelo sobre lo que acaba de hacer —qué
 * quedó a medias, qué decisión necesita del docente—. Medido en producción
 * (2026-09-15, curso de 22 lecciones): las dos rondas terminaron mudas y la
 * última gastó su paso 40 en crear un examen vacío en lugar de avisarlo.
 *
 * `step-budget.ts` ya le pedía «reply now with what you did and what is still
 * missing», pero ese texto viajaba en el RESULTADO del último paso: `stopWhen`
 * corta el bucle ahí y no hay paso siguiente donde el modelo pudiera leerlo. Era
 * una instrucción imposible de obedecer. Acá se cumple, porque el pedido entra
 * como mensaje ANTES de generar.
 */

export const AVISO_DE_ULTIMO_PASO =
  'No more tools are available for this reply. Answer the learner now using only what you already read; if it does not cover the question, say so.';

/**
 * Lo que se le pide al docente no es lo mismo: no está contestando una pregunta,
 * está rindiendo cuentas de una tanda de trabajo. Le pedimos explícitamente lo
 * vacío además de lo faltante, porque un ejercicio creado sin preguntas existe
 * —y por eso no se «extraña»— pero no sirve.
 */
export const AVISO_DE_ULTIMO_PASO_DOCENTE =
  'No more tools will run in this round. Reply now, in the language of the conversation: say what you built, what is still missing or created-but-empty, and anything you need from the teacher to continue. Do not claim the course is complete if any item is still missing or empty.';

/**
 * Si este es el último paso de la ronda.
 *
 * Antes preguntaba además si era el estudiante. Dejó de hacerlo cuando la ronda
 * del docente también pasó a cerrar con palabras: el rol ya no decide SI se
 * cierra, sólo con qué aviso.
 */
export function esUltimoPasoDeLaRonda({
  paso,
  maximoDePasos
}: {
  /** Base 0, como el `stepNumber` de `prepareStep`. */
  paso: number;
  maximoDePasos: number;
}): boolean {
  return paso >= maximoDePasos - 1;
}

/** El aviso que le toca a esta ronda. */
export function avisoDeCierre(esEstudiante: boolean): string {
  return esEstudiante ? AVISO_DE_ULTIMO_PASO : AVISO_DE_ULTIMO_PASO_DOCENTE;
}

/**
 * Si este paso recorta del contexto el contenido de las herramientas viejas.
 *
 * El recorte existe para las rondas de construcción del docente (hasta 40 pasos,
 * con lecciones enteras y documentos que se reenviarían en cada paso). En la ronda
 * del estudiante borraba justo lo que tenía que responder: leía la lección en el
 * paso 2 y, al contestar en el 6, ya no estaba. Medido con la réplica local del
 * tutor y el mismo recorte (2026-09-13): 4 de 6 respuestas inventaron una regla
 * o dijeron que el curso no trata un tema que tiene lección propia; sin recorte,
 * 0 de 9. La ronda del estudiante tiene 12 pasos como máximo, así que el
 * contexto no crece sin techo.
 */
export function recortarContextoDelPaso({ esEstudiante, paso }: { esEstudiante: boolean; paso: number }): boolean {
  return !esEstudiante && paso >= 5;
}

/**
 * Lo que devuelve `prepareStep` en ese último paso: sin herramientas y con el
 * pedido de contestar.
 *
 * El aviso se pasa y no se elige acá adentro: son dos rondas distintas pidiendo
 * dos cosas distintas, y hacerlo explícito en el sitio de llamada evita que
 * alguien agregue un tercer rol y se lleve el del estudiante por defecto.
 */
export function cerrarConRespuesta<M>(
  mensajes: M[],
  aviso: string
): {
  activeTools: [];
  messages: Array<M | { role: 'user'; content: string }>;
} {
  return {
    activeTools: [],
    messages: [...mensajes, { role: 'user', content: aviso }]
  };
}
