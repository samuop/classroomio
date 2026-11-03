import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Una variante escrita ANTES del prefijo `ui:` no existe.
 *
 * El paquete @cio/ui compila sus utilidades con el prefijo `ui`, y en Tailwind 4
 * el prefijo va primero: `ui:dark:bg-green-950`, `ui:hover:bg-muted`. Escrita al
 * revés (variante + `:` + `ui:`), la clase no la genera nadie. El paquete no la
 * usa, y en su `output.css` no hay ni una sola regla con esa forma. El dashboard
 * tampoco, porque para él `ui` no es una variante. No falla nada: la regla
 * simplemente no está.
 *
 * Así salió la tabla de Calificaciones: en el modo oscuro las celdas seguían con
 * el tinte claro, porque el fondo oscuro estaba escrito de esa forma. Lo vio un
 * usuario en producción, no un test.
 */

/** `src/` del dashboard. */
const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Deuda conocida al 2026-11-03: hover y foco escritos con la variante antes del
 * prefijo, que por lo tanto no hacen nada. Arreglarlas cambia cómo se ven estas
 * pantallas, así que va aparte. Esta lista sólo puede achicarse: un archivo que
 * suma una más, o uno nuevo, rompe el test; uno que se arregla obliga a bajar su
 * número acá.
 */
const DEUDA_HOVER_Y_FOCO: Record<string, number> = {
  'lib/components/Navigation/index.svelte': 1,
  'lib/features/ai-assistant/agent-steps.svelte': 1,
  'lib/features/ai-assistant/chat-history-popover.svelte': 1,
  'lib/features/ai-assistant/components/course-creator-wizard.svelte': 6,
  'lib/features/ai-assistant/context-indicator.svelte': 1,
  'lib/features/ai-assistant/discovery-form-card.svelte': 1,
  'lib/features/ai-assistant/plan-view.svelte': 8,
  'lib/features/ai-assistant/progress-card.svelte': 2,
  'lib/features/ai-assistant/sources/source-card.svelte': 4,
  'lib/features/ai-assistant/template-form-card.svelte': 1,
  'lib/features/ai-assistant/thinking-block.svelte': 1,
  'lib/features/audience/components/audience-member-row.svelte': 3,
  'lib/features/clients/pages/clients.svelte': 1,
  'lib/features/course/components/analytics/student-table.svelte': 1,
  'lib/features/course/components/course-filter-popover.svelte': 1,
  'lib/features/course/components/course-header.svelte': 1,
  'lib/features/course/components/lesson/document/document-card.svelte': 2,
  'lib/features/course/components/lesson/note/lesson-media-embed.svelte': 2,
  'lib/features/course/components/lesson/video/lesson-video-simple-card.svelte': 3,
  'lib/features/course/components/lesson/video/transcript-panel.svelte': 4,
  'lib/features/course/components/lesson/video/transcript-side-panel.svelte': 2,
  'lib/features/course/components/people/invitations-section.svelte': 3,
  'lib/features/program/components/program-filter-popover.svelte': 1,
  'lib/features/widget/components/course-filter-popover.svelte': 1,
  'lib/features/widget/panels/layout-panel.svelte': 1
};

function archivosDeFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
      salida.push(...archivosDeFuente(ruta));
    } else if (/\.(svelte|ts)$/.test(nombre) && !/\.test\.ts$/.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** Una o más variantes (`dark:`, `hover:`, `md:`…) pegadas antes de `ui:`. */
const VARIANTE_ANTES_DEL_PREFIJO = /(?<![\w:.\-/])(?:[a-z][a-z0-9-]*:)+ui:[a-z[]/g;

function clasesMalEscritas(texto: string): string[] {
  return texto.match(VARIANTE_ANTES_DEL_PREFIJO) ?? [];
}

function relevamiento(): Map<string, string[]> {
  const porArchivo = new Map<string, string[]>();
  for (const archivo of archivosDeFuente(RAIZ)) {
    const clases = clasesMalEscritas(readFileSync(archivo, 'utf8'));
    if (clases.length) porArchivo.set(relative(RAIZ, archivo).split(sep).join('/'), clases);
  }
  return porArchivo;
}

describe('clases de Tailwind que no se generan', () => {
  it('el detector reconoce la forma rota y deja pasar la correcta', () => {
    const rota = ['dark', 'ui', 'bg-green-950/30'].join(':');
    const anidada = ['hover', 'dark', 'ui', 'text-red-400'].join(':');
    expect(clasesMalEscritas(`class="${rota} px-2"`)).toHaveLength(1);
    expect(clasesMalEscritas(`'${anidada}'`)).toHaveLength(1);

    expect(clasesMalEscritas('class="ui:dark:bg-green-950/30 dark:bg-green-950/30 ui:text-foreground"')).toEqual([]);
    expect(clasesMalEscritas("const url = 'https://ejemplo.com/ui:algo'")).toEqual([]);
  });

  it('ningún archivo pone el modo oscuro antes del prefijo ui:', () => {
    const conDark: string[] = [];
    for (const [archivo, clases] of relevamiento()) {
      for (const clase of clases) if (/(^|:)dark:/.test(clase)) conDark.push(`${archivo}: ${clase}`);
    }
    expect(conDark).toEqual([]);
  });

  it('la deuda de hover y foco no crece, y lo que se arregla se descuenta', () => {
    const actual = Object.fromEntries([...relevamiento()].map(([archivo, clases]) => [archivo, clases.length]));
    expect(actual).toEqual(DEUDA_HOVER_Y_FOCO);
  });
});
