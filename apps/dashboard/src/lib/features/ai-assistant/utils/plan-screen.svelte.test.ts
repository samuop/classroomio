import { flushSync } from 'svelte';

import { pantallaDelPlan } from './plan-screen.svelte';
import type { CoursePlan } from './course-plan';

/**
 * La pantalla del plan se sincroniza desde un efecto del chat.
 *
 * ── Lo que pasó (dev, 2026-09-13) ────────────────────────────────────────────
 *
 * El primer plan pedido en el dashboard local nunca abrió la pantalla. La consola
 * decía «updated at … set mostrado … sincronizar … $effect»: `sincronizar` leía
 * el plan mostrado y lo reescribía con un objeto nuevo, y como la lectura pasaba
 * DENTRO del efecto del chat, cada escritura lo volvía a disparar. Svelte corta
 * ese bucle con un error, y el efecto que tenía que mostrar el plan moría.
 *
 * Se prueba dentro de un efecto de verdad porque fuera de uno no hay bucle posible.
 */

const plan: CoursePlan = {
  title: 'Curso',
  sections: [{ title: 'Arranque', order: 1, items: [] }]
};

describe('sincronizar la pantalla del plan desde un efecto', () => {
  afterEach(() => {
    pantallaDelPlan.cerrar();
  });

  it('no se realimenta cuando el plan que se mira es el vigente', () => {
    pantallaDelPlan.mostrar({ id: 'call-1', plan });

    let limpiar = () => {};

    expect(() => {
      limpiar = $effect.root(() => {
        $effect(() => {
          // Como en el chat: un objeto nuevo en cada corrida, con el mismo plan adentro.
          pantallaDelPlan.sincronizar({
            vigente: { id: 'call-1', plan },
            aprobado: false,
            ocupado: false,
            progreso: null
          });
        });
      });
      flushSync();
    }).not.toThrow();

    expect(pantallaDelPlan.abierta).toBe(true);
    expect(pantallaDelPlan.mostrado?.id).toBe('call-1');
    limpiar();
  });

  it('si el plan vigente cambia de contenido, la pantalla muestra el nuevo', () => {
    const revisado: CoursePlan = { ...plan, title: 'Curso revisado' };
    pantallaDelPlan.mostrar({ id: 'call-1', plan });

    pantallaDelPlan.sincronizar({ vigente: { id: 'call-1', plan: revisado }, aprobado: true, ocupado: false, progreso: null });

    expect(pantallaDelPlan.mostrado?.plan.title).toBe('Curso revisado');
  });

  it('sin plan vigente se cierra', () => {
    pantallaDelPlan.mostrar({ id: 'call-1', plan });

    pantallaDelPlan.sincronizar({ vigente: null, aprobado: false, ocupado: false, progreso: null });

    expect(pantallaDelPlan.abierta).toBe(false);
  });
});
