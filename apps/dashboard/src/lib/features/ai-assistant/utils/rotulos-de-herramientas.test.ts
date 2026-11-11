import es from '$lib/utils/translations/es.json';

import { getPendingToolI18nKey, getPendingToolI18nVars } from './tool-labels';

/**
 * Lo que el panel dice mientras el asistente usa una herramienta.
 *
 * Una herramienta sin su texto cae en «Ejecutando {toolName}», con el nombre
 * interno a la vista. Medido el 2026-11-11 con las tres que se sumaron ese día:
 * la docente leía «Ejecutando request_bulk_delete».
 */
const NUEVAS = ['request_bulk_delete', 'remember_teacher_rule', 'forget_teacher_rule'];

const enEspanol = (clave: string): unknown =>
  clave.split('.').reduce<unknown>((nodo, parte) => (nodo as Record<string, unknown> | undefined)?.[parte], es);

describe('el rótulo de una herramienta en curso', () => {
  it.each(NUEVAS)('%s tiene su texto, y no muestra su nombre interno', (herramienta) => {
    const clave = getPendingToolI18nKey(herramienta);

    expect(clave).toBe(`ai_assistant.tool.pending.${herramienta}`);
    expect(getPendingToolI18nVars(herramienta)).toBeUndefined();

    const texto = enEspanol(clave);

    expect(typeof texto === 'string' && texto.trim().length > 0).toBe(true);
    expect(String(texto)).not.toContain(herramienta);
  });

  it('una herramienta desconocida sigue cayendo en el texto genérico, con su nombre', () => {
    expect(getPendingToolI18nKey('herramienta_del_futuro')).toBe('ai_assistant.tool.pending.unknown_tool');
    expect(getPendingToolI18nVars('herramienta_del_futuro')).toEqual({ toolName: 'herramienta_del_futuro' });
  });
});
