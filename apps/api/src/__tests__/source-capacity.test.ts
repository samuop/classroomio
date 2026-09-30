/**
 * El tope que se comía el PDF de la docente.
 *
 * `createChatDocument` borraba los documentos MÁS VIEJOS de una conversación al
 * pasar de 40, y todas las fuentes del panel de un curso van a la misma
 * conversación oculta: dos investigaciones profundas y una subida se llevaban el
 * primer archivo que la docente había subido, sin que nadie se enterara.
 *
 * Ahora no se borra nada: el tope es por curso y RECHAZA la fuente nueva (eso se
 * prueba contra Postgres en tope-de-fuentes.int.test.ts). Esto fija que el tope
 * alcance para un curso de verdad, así el próximo que lo baje tiene que
 * explicárselo a un build que falla y no a una docente.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SOURCES_PER_COURSE } from '@cio/db/queries/agent/chat-document';

/** Investigación profunda: la tanda de fuentes más grande que produce el producto. */
const DEEPEST_RESEARCH_PAGES = 20;

/** MAX_DOCS del asistente de creación: cuántos archivos sube la docente a mano. */
const WIZARD_UPLOAD_LIMIT = 10;

describe('capacidad de fuentes', () => {
  it('entran varias investigaciones profundas y las subidas de la docente, a la vez', () => {
    expect(MAX_SOURCES_PER_COURSE).toBeGreaterThanOrEqual(3 * DEEPEST_RESEARCH_PAGES + WIZARD_UPLOAD_LIMIT);
  });
});
