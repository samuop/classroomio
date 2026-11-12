/**
 * Lo que el asistente cambió en el curso, en la auditoría.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El middleware de auditoría registra una fila por request, y una ronda del
 * asistente es UN request: quedaba «USO_EL_ASISTENTE» y nada más, aunque la
 * ronda hubiera agregado doce preguntas a un examen ya rendido (producción,
 * 2026-11-07). Para saber qué había pasado hubo que leer la conversación entera.
 * «¿Quién tocó este ejercicio?» tiene que salir de `audit_event`, como sale para
 * cualquier cambio hecho a mano.
 *
 * Se escribe al CERRAR la ronda —una vez, aunque haya corrido en varios
 * tramos— a partir del registro de la ronda (`round-ledger.ts`), que es lo que
 * el servidor vio cambiar y no lo que el modelo dice. Firmado por la docente
 * que pidió la ronda: es su cambio, hecho a través del asistente.
 */
import { recordEvent, type RecordEventParams } from '@api/services/audit';
import { lineasDelRegistro, type CambioDeRonda, type RegistroDeRonda } from '@api/services/agent/round-ledger';

/** Quién pidió la ronda y desde dónde: lo mismo que el middleware guarda de cada request. */
export type IdentidadDelPedido = Pick<
  RecordEventParams,
  'orgId' | 'userId' | 'userLabel' | 'userRole' | 'orgRole' | 'sessionId' | 'ip' | 'device' | 'browser' | 'userAgent'
>;

const ACCION_EN_LA_AUDITORIA: Record<CambioDeRonda['accion'], string> = {
  escribio: 'ASISTENTE_ESCRIBIO_LECCION',
  edito: 'ASISTENTE_EDITO_LECCION',
  creo: 'ASISTENTE_CREO',
  borro: 'ASISTENTE_BORRO',
  ilustro: 'ASISTENTE_ILUSTRO_LECCION',
  pregunto: 'ASISTENTE_CAMBIO_PREGUNTAS',
  saco_del_plan: 'ASISTENTE_SACO_DEL_PLAN',
  cambio_el_plan: 'ASISTENTE_CAMBIO_EL_PLAN',
  guardo_regla: 'ASISTENTE_GUARDO_REGLA_DEL_CURSO',
  retiro_regla: 'ASISTENTE_RETIRO_REGLA_DEL_CURSO',
  propuso: 'ASISTENTE_PROPUSO_CAMBIO_CON_ENTREGAS'
};

/** Una pregunta cuya lección cambió en la ronda y quedó sin la frase que la respaldaba. */
export const ACCION_PREGUNTA_A_REVISAR = 'ASISTENTE_DEJO_PREGUNTA_A_REVISAR';

export interface PreguntaARevisarAuditada {
  exerciseId: string;
  exerciseTitle: string;
  questionId: string;
  questionTitle: string;
  evidence: string;
}

/**
 * El nombre de la acción. Editar una SECCIÓN (renombrarla, moverla) no es editar
 * una lección: con el mismo nombre, quien filtra la auditoría por lecciones
 * editadas se encontraba con secciones.
 */
function accionEnLaAuditoria(cambio: CambioDeRonda): string {
  if (cambio.accion === 'edito' && cambio.entidad?.tipo === 'Section') return 'ASISTENTE_EDITO_SECCION';

  return ACCION_EN_LA_AUDITORIA[cambio.accion];
}

/**
 * Una fila por cambio del registro. Nunca tira: la auditoría no rompe el flujo,
 * y a esta altura la ronda ya terminó y se guardó.
 */
export async function auditarCambiosDeLaRonda(params: {
  identidad: IdentidadDelPedido;
  registro: RegistroDeRonda;
  courseId: string;
  conversationId?: string | null;
  /**
   * La ronda no llegó a cerrar (el proceso murió) y esto se audita después, de
   * lo que había quedado a resguardo. Ver `auditoria-pendiente.ts`.
   */
  interrumpida?: boolean;
  /**
   * Las preguntas que esta ronda dejó a revisar: su lección cambió y la frase
   * en la que se basaban ya no está. El chat dejó de mostrarlas (2026-11-12),
   * así que la auditoría es donde quedan, junto con los cambios.
   */
  preguntasARevisar?: ReadonlyArray<PreguntaARevisarAuditada>;
  /** Para escribir sin esperar la base en los tests. */
  registrar?: typeof recordEvent;
}): Promise<void> {
  const registrar = params.registrar ?? recordEvent;
  const lineas = lineasDelRegistro(params.registro);

  for (const pregunta of params.preguntasARevisar ?? []) {
    try {
      await registrar({
        ...params.identidad,
        action: ACCION_PREGUNTA_A_REVISAR,
        entity: 'Exercise',
        entityId: pregunta.exerciseId,
        metadata: {
          courseId: params.courseId,
          ...(params.conversationId ? { conversationId: params.conversationId } : {}),
          ejercicio: pregunta.exerciseTitle,
          preguntaId: pregunta.questionId,
          pregunta: pregunta.questionTitle,
          seBasabaEn: pregunta.evidence
        },
        method: 'POST',
        route: '/agent/chat',
        status: 200,
        durationMs: null,
        always: true
      });
    } catch (error) {
      console.error('[agent.chat] no se pudo auditar una pregunta a revisar:', error);
    }
  }

  for (const [indice, cambio] of params.registro.cambios.entries()) {
    try {
      await registrar({
        ...params.identidad,
        action: accionEnLaAuditoria(cambio),
        entity: cambio.entidad?.tipo ?? 'Course',
        entityId: cambio.entidad?.id ?? params.courseId,
        metadata: {
          courseId: params.courseId,
          ...(params.conversationId ? { conversationId: params.conversationId } : {}),
          ...(params.interrumpida ? { rondaInterrumpida: true } : {}),
          objeto: cambio.objeto,
          veces: cambio.veces,
          // La misma línea que vio la docente en el resumen de la ronda.
          resumen: lineas[indice],
          ...(cambio.preguntas ? { preguntas: cambio.preguntas } : {})
        },
        method: 'POST',
        route: '/agent/chat',
        status: 200,
        durationMs: null,
        // Cada cambio es un hecho distinto: la ventana anti-repetición es para lecturas.
        always: true
      });
    } catch (error) {
      console.error('[agent.chat] no se pudo auditar un cambio del asistente:', error);
    }
  }
}
