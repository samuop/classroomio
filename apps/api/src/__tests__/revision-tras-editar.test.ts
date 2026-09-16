import { describe, expect, it, vi } from 'vitest';

import {
  anotarChequeo,
  crearRegistroDeAvisos,
  revisarTrasEditar,
  tieneAvisosAbiertos
} from '@api/services/agent/revision-tras-editar';
import type { FuenteVista } from '@api/services/agent/grounding';

/**
 * El caso real, en una línea: el verificador citó UNA frase, el agente arregló
 * esa frase, y la misma afirmación sin respaldo siguió en otros cinco lugares de
 * la lección. Nada volvió a mirar.
 */
const FUENTES: FuenteVista[] = [{ fileName: 'manual.docx', text: 'el texto que el escritor tuvo delante' } as FuenteVista];

const AVISO_ORIGINAL = 'This lesson states things the course sources do not support: "the system blocks the sale".';

function registroConLeccionMarcada() {
  const registro = crearRegistroDeAvisos();
  anotarChequeo(registro, 'leccion-1', { avisos: [AVISO_ORIGINAL], soloFuentes: FUENTES });

  return registro;
}

describe('anotarChequeo', () => {
  it('marca la lección cuando el chequeo dejó avisos', () => {
    const registro = crearRegistroDeAvisos();
    anotarChequeo(registro, 'leccion-1', { avisos: [AVISO_ORIGINAL] });

    expect(tieneAvisosAbiertos(registro, 'leccion-1')).toBe(true);
  });

  it('la desmarca cuando vuelve a escribirse limpia, para no pagar rechequeos eternos', () => {
    const registro = registroConLeccionMarcada();
    anotarChequeo(registro, 'leccion-1', { avisos: [] });

    expect(tieneAvisosAbiertos(registro, 'leccion-1')).toBe(false);
  });
});

describe('revisarTrasEditar', () => {
  it('no sale a la red por una lección que nadie marcó', async () => {
    // Devuelve algo válido a propósito: si el mock devolviera `undefined`, una
    // regresión que llamara al verificador reventaría adentro y el fallo se
    // leería como otra cosa. Así, lo único que puede fallar es el `not.toHaveBeenCalled`.
    const verificarFundamento = vi.fn().mockResolvedValue([]);

    const resultado = await revisarTrasEditar({
      registro: crearRegistroDeAvisos(),
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>algo</p>',
      verificarFundamento
    });

    expect(resultado).toBeUndefined();
    expect(verificarFundamento).not.toHaveBeenCalled();
  });

  it('no hace nada si la ronda no tiene verificador', async () => {
    const resultado = await revisarTrasEditar({
      registro: registroConLeccionMarcada(),
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>algo</p>'
    });

    expect(resultado).toBeUndefined();
  });

  /**
   * El corazón del arreglo. Los avisos que estos tools devuelven miran sólo el
   * fragmento escrito; para el fundamento ese recorte ES el defecto, porque la
   * afirmación sobrevivía justamente en lo que la edición no tocó.
   */
  it('chequea la lección ENTERA, no el fragmento que se acaba de escribir', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue([]);
    const leccionCompleta = '<h3>Una lección marcada</h3><p>frase corregida</p><p>la misma afirmación, en otro lado</p>';

    await revisarTrasEditar({
      registro: registroConLeccionMarcada(),
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: leccionCompleta,
      verificarFundamento
    });

    expect(verificarFundamento).toHaveBeenCalledWith(expect.objectContaining({ contenido: leccionCompleta }));
  });

  it('contrasta contra las MISMAS fuentes que tuvo el verificador al escribirla', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue([]);

    await revisarTrasEditar({
      registro: registroConLeccionMarcada(),
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>x</p>',
      verificarFundamento
    });

    expect(verificarFundamento).toHaveBeenCalledWith(expect.objectContaining({ soloFuentes: FUENTES }));
  });

  it('devuelve lo que sigue sin respaldo y mantiene la lección marcada', async () => {
    const registro = registroConLeccionMarcada();
    const sigueMal = 'This lesson states things the course sources do not support: "the claim is still here".';

    const resultado = await revisarTrasEditar({
      registro,
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>la afirmación sigue acá</p>',
      verificarFundamento: vi.fn().mockResolvedValue([sigueMal])
    });

    expect(resultado).toEqual({ groundingWarnings: [sigueMal], resuelto: false });
    // Sigue marcada: la próxima edición tiene que volver a mirarla.
    expect(tieneAvisosAbiertos(registro, 'leccion-1')).toBe(true);
  });

  it('cuando el arreglo funcionó, lo dice y desmarca la lección', async () => {
    const registro = registroConLeccionMarcada();

    const resultado = await revisarTrasEditar({
      registro,
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>ahora dice sólo lo que dice la fuente</p>',
      verificarFundamento: vi.fn().mockResolvedValue([])
    });

    expect(resultado).toEqual({ groundingWarnings: [], resuelto: true });
    expect(tieneAvisosAbiertos(registro, 'leccion-1')).toBe(false);
  });

  /**
   * El verificador sale a la red. Si se cae, la edición YA está guardada: hacerla
   * fallar por esto sería perder trabajo bueno por un chequeo opcional.
   */
  it('si el verificador se cae, la edición sobrevive y la lección queda marcada', async () => {
    const registro = registroConLeccionMarcada();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resultado = await revisarTrasEditar({
      registro,
      lessonId: 'leccion-1',
      lessonTitle: 'Una lección marcada',
      contenido: '<p>x</p>',
      verificarFundamento: vi.fn().mockRejectedValue(new Error('502 del proveedor'))
    });

    expect(resultado).toBeUndefined();
    // Sin desmarcar: el aviso original sigue abierto y la próxima edición reintenta.
    expect(tieneAvisosAbiertos(registro, 'leccion-1')).toBe(true);
  });
});
