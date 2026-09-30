import { ApiError } from '$lib/utils/services/api/types';

import {
  claveDelErrorDeFuente,
  esRondaEnCurso,
  esTiempoAgotado,
  leerErrorDeApi,
  mensajeDelErrorDelChat
} from './errores-del-chat';

/**
 * El texto que ve la docente cuando algo del asistente falla.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. Que un vencimiento no llegue crudo («Request timeout», en inglés): dice
 *    que el pedido sigue en proceso y que conviene probar en unos segundos.
 * 2. Que un corte del stream a mitad de ronda no culpe a la conexión de la
 *    docente: el error que lo acompaña es un `TypeError` «network error», que
 *    antes se mostraba como «Error de red. Revisá tu conexión…».
 * 3. Que el 409 de una conversación ocupada diga que el asistente sigue
 *    trabajando, en vez de un JSON.
 * 4. Que los dos códigos de fuentes del contrato (422) tengan su texto.
 */

const cuerpo = (code: string, error = 'texto del servidor') => JSON.stringify({ success: false, error, code });

const rondaEnCurso = new ApiError(cuerpo('AGENT_ROUND_IN_PROGRESS', 'A round is already running for this conversation'), 409);
const vencido = new ApiError('Request timeout', 408, 'Request Timeout');

describe('lo que se lee de un error de la API', () => {
  it('el estado y el código del cuerpo', () => {
    expect(leerErrorDeApi(rondaEnCurso)).toEqual({
      status: 409,
      code: 'AGENT_ROUND_IN_PROGRESS',
      detalle: 'A round is already running for this conversation'
    });
  });

  it('un error sin cuerpo JSON trae sólo el estado; algo que no es error, nada', () => {
    expect(leerErrorDeApi(vencido)).toEqual({ status: 408 });
    expect(leerErrorDeApi('texto suelto')).toEqual({});
    expect(leerErrorDeApi(null)).toEqual({});
  });

  it('reconoce la ronda en curso y el vencimiento', () => {
    expect(esRondaEnCurso(rondaEnCurso)).toBe(true);
    expect(esRondaEnCurso(new ApiError(cuerpo('OTRA_COSA'), 409))).toBe(false);
    expect(esTiempoAgotado(vencido)).toBe(true);
    // El mensaje solo, como lo deja `this.error` en una pantalla.
    expect(esTiempoAgotado('Request timeout')).toBe(true);
    expect(esTiempoAgotado(new Error('otra cosa'))).toBe(false);
  });
});

describe('el mensaje de la banda del chat', () => {
  it('un corte del stream gana sobre el error de red que lo acompaña', () => {
    expect(mensajeDelErrorDelChat(new TypeError('network error'), { corte: true })).toEqual({
      clave: 'ai_assistant.error_stream_cut'
    });
    // Aun sin error: un stream que se cerró sin la parte final no trae ninguno.
    expect(mensajeDelErrorDelChat(undefined, { corte: true })).toEqual({ clave: 'ai_assistant.error_stream_cut' });
  });

  it('sin corte, el mismo error de red sigue siendo un error de red', () => {
    expect(mensajeDelErrorDelChat(new ApiError('Network error', 0, 'Network Error'))).toEqual({
      clave: 'ai_assistant.error_network'
    });
  });

  it('un vencimiento se traduce con el texto del chat, que ya espera solo', () => {
    expect(mensajeDelErrorDelChat(vencido)).toEqual({ clave: 'ai_assistant.error_timeout_chat' });
  });

  it('el 409 dice que el asistente sigue trabajando', () => {
    expect(mensajeDelErrorDelChat(rondaEnCurso)).toEqual({ clave: 'ai_assistant.error_round_in_progress' });
  });

  it('el cupo del proveedor, con y sin espera', () => {
    expect(mensajeDelErrorDelChat(new Error('Quota exceeded. Please retry in 12.4s'))).toEqual({
      clave: 'ai_assistant.error_rate_limit_with_wait',
      valores: { seconds: 13 }
    });
    expect(mensajeDelErrorDelChat(new Error('rate limit'))).toEqual({ clave: 'ai_assistant.error_rate_limit' });
  });

  it('el contexto largo', () => {
    expect(mensajeDelErrorDelChat(new Error('prompt is too long'))).toEqual({ clave: 'ai_assistant.error_context_too_long' });
  });

  it('cualquier otro error del servidor muestra su texto, no el JSON entero', () => {
    expect(mensajeDelErrorDelChat(new ApiError(cuerpo('ALGO', 'Algo salió mal'), 400))).toEqual({
      texto: 'Algo salió mal'
    });
  });

  it('sin error no hay banda', () => {
    expect(mensajeDelErrorDelChat(null)).toBeNull();
  });
});

describe('los errores de fuentes', () => {
  it('SOURCE_NEEDS_LOGIN y SOURCE_UNREADABLE tienen su texto', () => {
    expect(claveDelErrorDeFuente(cuerpo('SOURCE_NEEDS_LOGIN'), 'x')).toBe('course.sources.error_needs_login');
    expect(claveDelErrorDeFuente(cuerpo('SOURCE_UNREADABLE'), 'x')).toBe('course.sources.error_unreadable');
  });

  it('el curso lleno (SOURCE_LIMIT_REACHED) también', () => {
    expect(claveDelErrorDeFuente(cuerpo('SOURCE_LIMIT_REACHED'), 'x')).toBe('course.sources.error_source_limit');
  });

  it('un vencimiento usa el texto del vencimiento', () => {
    expect(claveDelErrorDeFuente('Request timeout', 'x')).toBe('ai_assistant.error_timeout');
  });

  it('lo demás, el texto por defecto de quien pregunta', () => {
    expect(claveDelErrorDeFuente(cuerpo('DOCUMENT_NOT_FOUND'), 'course.sources.url_failed')).toBe(
      'course.sources.url_failed'
    );
    expect(claveDelErrorDeFuente(null, 'course.sources.url_failed')).toBe('course.sources.url_failed');
  });
});
