import { render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { get } from 'svelte/store';

import MessageBubble from './message-bubble.svelte';
import { t } from '$lib/utils/functions/translations';
import type { AiAssistantMessage } from './utils/types';

/**
 * Cómo se dibujan los gestos del docente y la tarjeta del plan.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. «Aprobar y construir» y «Continuar» viajan como mensajes con un texto fijo
 *    para el modelo. Ese texto no es lo que la docente dijo: se dibuja como una
 *    ficha, también en conversaciones viejas con el texto en inglés.
 * 2. La tarjeta del plan dice «Aprobado» sólo si la aprobación tuvo respuesta
 *    (o está en vuelo). Medido: una aprobación que falló dejaba el plan
 *    «Aprobado» sin construir nada y sin el botón de aprobar.
 *
 * Datos inventados.
 */

const texto = (clave: string) => get(t)(clave);

const plan = {
  title: 'Caja en sucursales',
  sections: [
    {
      title: 'Apertura',
      order: 0,
      items: [{ type: 'lesson', title: 'Arqueo', description: 'Contar la caja.', order: 0, hasExercise: false }]
    }
  ]
};

const pedido: AiAssistantMessage = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: 'Armá un curso de caja para sucursales' }]
};

const conPlan = {
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'tool-generate_course_plan', toolCallId: 'call-1', state: 'output-available', input: {}, output: plan }]
} as unknown as AiAssistantMessage;

const aprobacion = (texto: string): AiAssistantMessage =>
  ({
    id: 'u2',
    role: 'user',
    parts: [{ type: 'text', text: texto }],
    metadata: { plan: { action: 'implement_course_plan', payload: plan } }
  }) as AiAssistantMessage;

const respuesta = {
  id: 'a2',
  role: 'assistant',
  parts: [{ type: 'step-start' }, { type: 'text', text: 'Arranco por la primera sección.' }]
} as unknown as AiAssistantMessage;

function dibujar(message: AiAssistantMessage, messages: AiAssistantMessage[], cambios: Record<string, unknown> = {}) {
  return render(MessageBubble, {
    props: {
      message,
      messages,
      courseId: 'curso-1',
      isStreaming: false,
      latestPlanId: 'call-1',
      onOpenPlan: () => {},
      onSubmitTemplateAnswers: () => {},
      onSkipTemplateForm: () => {},
      onSubmitDiscoveryAnswers: () => {},
      onSkipDiscoveryForm: () => {},
      onMentionClick: () => {},
      ...cambios
    } as ComponentProps<typeof MessageBubble>
  });
}

describe('los gestos del docente se ven como fichas', () => {
  it('la aprobación: «Plan aprobado — construyendo», no el texto que viaja al modelo', () => {
    const mensaje = aprobacion('Construí el curso según el plan aprobado.');
    const { container } = dibujar(mensaje, [pedido, conPlan, mensaje]);

    expect(screen.getByText(texto('ai_assistant.control_message.plan_approved'))).toBeInTheDocument();
    expect(container.textContent).not.toContain('Construí el curso según el plan aprobado.');
  });

  it('también la de una conversación vieja, en inglés', () => {
    const mensaje = aprobacion('Implement this plan.');
    const { container } = dibujar(mensaje, [pedido, conPlan, mensaje]);

    expect(container.querySelector('[data-control="aprobacion"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Implement this plan.');
  });

  it('la continuación, nueva y vieja', () => {
    for (const escrito of [
      'Seguí construyendo el plan desde donde quedó.',
      'Continue implementing the plan from where you left off.'
    ]) {
      const mensaje: AiAssistantMessage = { id: `c-${escrito.length}`, role: 'user', parts: [{ type: 'text', text: escrito }] };
      const { container, unmount } = dibujar(mensaje, [mensaje]);

      expect(screen.getByText(texto('ai_assistant.control_message.continue_build'))).toBeInTheDocument();
      expect(container.textContent).not.toContain(escrito);
      unmount();
    }
  });

  it('lo que escribió la docente sigue siendo una burbuja con su texto', () => {
    const { container } = dibujar(pedido, [pedido]);

    expect(container.textContent).toContain('Armá un curso de caja para sucursales');
    expect(container.querySelector('[data-control]')).toBeNull();
  });
});

describe('la tarjeta del plan dice «Aprobado» sólo con una aprobación que tuvo respuesta', () => {
  const aprobado = () => screen.queryByText(texto('ai_assistant.plan_screen.approved'));
  const propuesto = () => screen.queryByText(texto('ai_assistant.plan_screen.proposed'));

  it('con respuesta del asistente: aprobado', () => {
    dibujar(conPlan, [pedido, conPlan, aprobacion('x'), respuesta]);

    expect(aprobado()).toBeInTheDocument();
  });

  it('una aprobación que falló —sin respuesta, nada en vuelo— vuelve a «Propuesto»', () => {
    dibujar(conPlan, [pedido, conPlan, aprobacion('x')]);

    expect(aprobado()).toBeNull();
    expect(propuesto()).toBeInTheDocument();
  });

  it('en vuelo, ya dice «Aprobado»', () => {
    dibujar(conPlan, [pedido, conPlan, aprobacion('x')], { isStreaming: true });

    expect(aprobado()).toBeInTheDocument();
  });

  it('con todos los campos opcionales puestos, se dibuja igual', () => {
    const mensajes = [pedido, conPlan, aprobacion('x'), respuesta];

    dibujar(conPlan, mensajes, {
      isLast: false,
      startedAt: Date.now(),
      nombrar: (id: string) => (id === 'doc-1' ? 'Manual de caja.pdf' : undefined),
      onOpenLatestPlan: () => {},
      onRetryStep: () => {},
      mentionTargets: [{ id: 'l1', title: 'Arqueo', type: 'lesson' }],
      onUseImageInLesson: () => {},
      esFuenteDelCurso: () => true
    });

    expect(aprobado()).toBeInTheDocument();
  });
});
