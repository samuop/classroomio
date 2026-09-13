/**
 * El último paso de una ronda de estudiante va sin herramientas.
 *
 * Medido en producción (2026-09-13): ante una pregunta cuya respuesta no está en
 * el curso, el tutor leía lección tras lección buscándola, llegaba al tope de
 * pasos con una llamada a herramienta y la ronda terminaba sin una sola palabra.
 * El estudiante recibía una respuesta vacía justo cuando lo correcto era decirle
 * «eso no está en el curso». En el último paso se le sacan las herramientas y
 * tiene que contestar con lo que ya leyó.
 *
 * El docente no: su ronda se retoma con «Continuar».
 */
export function herramientasDelPaso({
  esEstudiante,
  paso,
  maximoDePasos
}: {
  esEstudiante: boolean;
  /** Base 0, como el `stepNumber` de `prepareStep`. */
  paso: number;
  maximoDePasos: number;
}): { toolChoice?: 'none' } {
  return esEstudiante && paso >= maximoDePasos - 1 ? { toolChoice: 'none' } : {};
}
