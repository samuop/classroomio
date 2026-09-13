import { untrack } from 'svelte';
import type { CoursePlan } from './course-plan';
import type { AiAssistantPlanProgress } from './types';

/**
 * La pantalla del plan, abierta al lado del chat.
 *
 * El plan vivía dentro de una burbuja del chat: 5 secciones y 21 lecciones en
 * una columna de 400 px, editable a golpes de lápiz, con el botón de aprobar al
 * final de un scroll. Un plan se revisa como un documento, así que ahora se abre
 * en el área principal del curso y el chat queda al costado para pedir cambios.
 *
 * El chat es el dueño de la conversación: decide qué plan es el vigente, si ya
 * se aprobó y cuánto se construyó, y conecta las acciones. La pantalla sólo
 * muestra lo que el chat le pasa y le devuelve lo que el docente decide.
 */

export interface AccionesDelPlan {
  aprobar: (plan: CoursePlan) => void;
  pedirCambios: (texto: string) => void;
}

export interface PlanMostrado {
  /** Id de la llamada que produjo el plan: distingue una versión de otra. */
  id: string;
  plan: CoursePlan;
}

class PantallaDelPlan {
  abierta = $state(false);
  /**
   * El plan que se está mirando, que puede no ser el vigente.
   *
   * Crudo y no profundo: el plan llega de los mensajes y no se edita en el lugar
   * (la pantalla edita una copia). Con `$state` profundo quedaba envuelto en un
   * proxy, y comparar si cambió daba siempre «distinto».
   */
  mostrado = $state.raw<PlanMostrado | null>(null);
  /** Id del plan más nuevo de la conversación. Sólo ese se puede aprobar. */
  vigenteId = $state<string | null>(null);
  aprobado = $state(false);
  /** El agente está trabajando: aprobar o pedir cambios tiene que esperar. */
  ocupado = $state(false);
  progreso = $state.raw<AiAssistantPlanProgress | null>(null);
  acciones = $state<AccionesDelPlan | null>(null);

  get esVigente(): boolean {
    return !!this.mostrado && this.mostrado.id === this.vigenteId;
  }

  mostrar(plan: PlanMostrado) {
    this.mostrado = plan;
    this.abierta = true;
  }

  cerrar() {
    this.abierta = false;
  }

  /** Lo que el chat sabe del estado del plan, en cada cambio. */
  sincronizar(estado: {
    vigente: PlanMostrado | null;
    aprobado: boolean;
    ocupado: boolean;
    progreso: AiAssistantPlanProgress | null;
  }) {
    this.vigenteId = estado.vigente?.id ?? null;
    this.aprobado = estado.aprobado;
    this.ocupado = estado.ocupado;
    this.progreso = estado.progreso;

    // Esto se llama desde un efecto del chat. Leer `mostrado` sin `untrack` lo
    // suscribía a lo que escribe acá mismo, y reescribirlo con un objeto nuevo en
    // cada vuelta era un bucle que Svelte corta rompiendo la pantalla entera.
    // Ver `plan-screen.svelte.test.ts`.
    const actual = untrack(() => this.mostrado);

    // Si el que se mira es el vigente y cambió su contenido —aprobado con
    // ediciones, por ejemplo—, se muestra lo último. Sólo si cambió.
    if (estado.vigente && actual?.id === estado.vigente.id && actual.plan !== estado.vigente.plan) {
      this.mostrado = estado.vigente;
    }

    if (!estado.vigente && actual) {
      this.mostrado = null;
      this.abierta = false;
    }
  }

  /**
   * Conecta las acciones del chat. Devuelve con qué desconectarlas: sin el chat
   * no hay a quién mandarle una aprobación, así que la pantalla se cierra.
   */
  conectar(acciones: AccionesDelPlan): () => void {
    this.acciones = acciones;

    return () => {
      if (this.acciones !== acciones) return;

      this.acciones = null;
      this.abierta = false;
    };
  }
}

export const pantallaDelPlan = new PantallaDelPlan();
