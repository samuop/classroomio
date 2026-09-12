import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reescribir una lección entera va por el escritor, y nada en el sistema dice
 * lo contrario.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * Pedido desde el chat: «Reconstruí esta lección desde cero con las fuentes».
 * Dos veces, el agente la escribió él mismo con `update_lesson_content` y no con
 * `write_lesson`. Sin escritor no hubo marca de pasaje propio ni posibilidad de
 * negarse, y el guardado no supo con qué fuentes se había escrito.
 *
 * El agente hizo lo que le decían. El prompt ordenaba textual «FULL write
 * (empty lesson, or "rewrite the whole thing") → use update_lesson_content», y
 * otras cinco frases apuntaban al mismo camino — una de ellas dentro de la
 * sección de construcción, tres líneas debajo de la que manda usar
 * `write_lesson`. Es la tercera vez en este proyecto que una capacidad nueva
 * queda muerta por una instrucción vieja que nadie sacó.
 *
 * Esto se lee como texto a propósito: lo que hay que impedir es que esas frases
 * vuelvan, y la herramienta y el prompt viven en dos paquetes distintos.
 */

const leer = (relativo: string) => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8');

const PROMPT_DOCENTE = leer('../../../../packages/ai-assistant/src/prompt/teacher.ts');
const HERRAMIENTAS = leer('../services/agent/chat-tools.ts');
const ESQUEMAS = leer('../services/agent/agent-tool-schemas.ts');

describe('reescribir una lección entera va por el escritor', () => {
  it('la regla de la reescritura completa nombra a write_lesson', () => {
    expect(PROMPT_DOCENTE).toMatch(/FULL write[^\n]*write_lesson/);
    expect(PROMPT_DOCENTE).not.toMatch(/FULL write[^\n]*update_lesson_content/);
  });

  it('la construcción no dice que las lecciones terminan con update_lesson_content', () => {
    expect(PROMPT_DOCENTE).not.toMatch(/real content via update_lesson_content/);
  });

  it('pedirle al modelo que escriba en el editor no lo manda al camino viejo', () => {
    expect(PROMPT_DOCENTE).not.toMatch(/call\s+\\?`?update_lesson_content\\?`?\s+directly with the full body/);
  });

  it('write_lesson no se presenta como exclusiva de la construcción de un plan', () => {
    expect(HERRAMIENTAS).not.toMatch(/While building an approved plan, this is how every lesson gets written/);
    expect(ESQUEMAS).not.toMatch(/exactly as the approved plan declared them \(file names/);
  });

  it('las herramientas de edición no derivan la reescritura a update_lesson_content', () => {
    expect(HERRAMIENTAS).not.toMatch(/use update_lesson_content for that/);
    expect(HERRAMIENTAS).not.toMatch(/Use update_lesson_content to write the initial content/);
  });

  it('update_lesson_content avisa que la reescritura desde el material es de write_lesson', () => {
    expect(HERRAMIENTAS).toMatch(/update_lesson_content: tool\(\{\s*description:\s*'[^']*use write_lesson instead/);
  });
});
