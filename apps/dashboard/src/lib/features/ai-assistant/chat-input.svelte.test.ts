import { render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { get } from 'svelte/store';

import ChatInput from './chat-input.svelte';
import { t } from '$lib/utils/functions/translations';
import { ApiError } from '$lib/utils/services/api/types';

/**
 * El botón de enviar del chat del asistente.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * Que hacer clic en Enviar mande el mensaje. Suena trivial y no lo era: el
 * botón no hacía nada y había que apretar Enter.
 *
 * La causa es la forma en que se conecta, no el botón. `onclick` le pasa el
 * MouseEvent como primer argumento a la función que reciba; del otro lado,
 * `handleSend(textOverride?: string)` acepta un texto opcional para que otras
 * tarjetas puedan mandar un mensaje armado. Con `onclick={onSend}`, el evento
 * llegaba como ese texto, `.trim()` reventaba sobre un MouseEvent y el clic
 * moría en silencio. Enter seguía andando porque el textarea llama
 * `onSubmit?.()` sin argumentos.
 *
 * TypeScript no lo atrapa: una función de cero parámetros es asignable a un
 * manejador de uno. Así que la regla tiene que comprobarse acá, y la
 * comprobación no es "se llamó" sino **con qué se llamó**: un test que sólo
 * mirara que `onSend` corrió pasaba igual con el bug puesto.
 */
describe('el botón de enviar del chat', () => {
  function montar(onSend: (...args: unknown[]) => void, inputValue = 'hola', canSend = true) {
    return render(ChatInput, {
      props: {
        inputValue,
        isStreaming: false,
        isExhausted: false,
        isUploading: false,
        error: null,
        mentionItems: [],
        uploadedDocument: null,
        canSend,
        onSend,
        onStop: () => {},
        onFileSelect: () => {},
        onRemoveDocument: () => {}
      }
    });
  }

  function botonEnviar() {
    return screen.getByRole('button', { name: get(t)('ai_assistant.send') });
  }

  it('manda el mensaje SIN pasarle el evento como texto', async () => {
    const onSend = vi.fn();
    montar(onSend);

    botonEnviar().click();

    expect(onSend).toHaveBeenCalledTimes(1);

    // Lo que importa: ningún argumento. Con `onclick={onSend}` acá llegaba un
    // MouseEvent y el envío se caía.
    //
    // Se mira el TIPO del primer argumento y no el array de llamadas: al
    // fallar, vitest serializa lo que comparó, y serializar un MouseEvent
    // recorre su `currentTarget` —un nodo de Svelte— y reventaba con
    // `rune_outside_svelte`, tapando el fallo real con un error de runas.
    expect(typeof onSend.mock.calls[0][0]).toBe('undefined');
    expect(onSend.mock.calls[0].length).toBe(0);
  });

  // Qué cuenta como «algo para mandar» —texto, o una imagen que ya subió— lo
  // decide `puedeEnviar` y se fija en `chat-attachments.test.ts`. Acá sólo que el
  // botón obedece.
  it('está apagado cuando no hay nada para mandar', () => {
    const onSend = vi.fn();
    montar(onSend, '   ', false);

    expect(botonEnviar()).toBeDisabled();
  });
});

/**
 * La banda de error del chat y la espera de una ronda que sigue en el servidor.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * Lo que la docente LEE. Medido: un vencimiento se mostraba «Request timeout»,
 * crudo y en inglés; un corte del stream a mitad de ronda, «Error de red.
 * Revisá tu conexión…», aunque su conexión estaba bien; y después de un corte
 * se podía mandar otro mensaje sobre una ronda que seguía viva.
 */
describe('la banda de error y la ronda viva', () => {
  const texto = (clave: string) => get(t)(clave);

  function montar(cambios: Record<string, unknown> = {}) {
    const onRetry = vi.fn();

    render(ChatInput, {
      props: {
        inputValue: 'hola',
        isStreaming: false,
        isExhausted: false,
        isUploading: false,
        error: null,
        mentionItems: [],
        uploadedDocument: null,
        canSend: true,
        onSend: () => {},
        onRetry,
        onStop: () => {},
        onFileSelect: () => {},
        onRemoveDocument: () => {},
        ...cambios
      } as ComponentProps<typeof ChatInput>
    });

    return { onRetry };
  }

  const reintentar = () => screen.queryByRole('button', { name: texto('ai_assistant.error_retry') });

  it('un vencimiento se lee traducido, no «Request timeout»', () => {
    montar({ error: new ApiError('Request timeout', 408, 'Request Timeout'), canRetry: true });

    expect(screen.getByText(texto('ai_assistant.error_timeout_chat'))).toBeInTheDocument();
    expect(screen.queryByText('Request timeout')).toBeNull();
  });

  it('un corte del stream dice que lo creado quedó guardado, no que revise su conexión', () => {
    montar({ error: new TypeError('network error'), streamCut: true, canRetry: true });

    expect(screen.getByText(texto('ai_assistant.error_stream_cut'))).toBeInTheDocument();
    expect(screen.queryByText(texto('ai_assistant.error_network'))).toBeNull();
  });

  it('el 409 dice que el asistente sigue trabajando, no el JSON de la respuesta', () => {
    const cuerpo = JSON.stringify({
      success: false,
      error: 'A round is already running for this conversation',
      code: 'AGENT_ROUND_IN_PROGRESS'
    });

    montar({ error: new ApiError(cuerpo, 409, 'Conflict') });

    expect(screen.getByText(texto('ai_assistant.error_round_in_progress'))).toBeInTheDocument();
    expect(screen.queryByText(/AGENT_ROUND_IN_PROGRESS/)).toBeNull();
  });

  it('«Reintentar» aparece con un turno para reintentar y llama sin argumentos', () => {
    const { onRetry } = montar({ error: new ApiError('Request timeout', 408), canRetry: true });

    reintentar()?.click();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0].length).toBe(0);
  });

  it('mientras el servidor termina una ronda viva: aviso, sin «Reintentar» y sin poder mandar', () => {
    montar({ error: new TypeError('network error'), streamCut: true, canRetry: true, waitingForRound: true });

    expect(screen.getByText(texto('ai_assistant.round_in_progress_notice'))).toBeInTheDocument();
    // El corte se sigue diciendo: la conexión se cortó, pero la ronda sigue.
    expect(screen.getByText(texto('ai_assistant.error_stream_cut'))).toBeInTheDocument();
    expect(reintentar()).toBeNull();
    expect(screen.getByRole('button', { name: texto('ai_assistant.send') })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('sin ronda viva se puede escribir y mandar', () => {
    montar({ waitingForRound: false });

    expect(screen.queryByText(texto('ai_assistant.round_in_progress_notice'))).toBeNull();
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: texto('ai_assistant.send') })).toBeEnabled();
  });

  it('con todos los campos opcionales puestos, se dibuja entero', () => {
    // Las ramas que abren los opcionales: medidor de contexto, adjuntos en sus
    // tres estados, documento adjunto y botón de imágenes.
    montar({
      error: new Error('Quota exceeded. Please retry in 3s'),
      streamCut: false,
      waitingForRound: false,
      canRetry: true,
      isStudent: false,
      tutorBlocked: null,
      focusSignal: 1,
      contextUsage: {
        usedTokens: 40_000,
        maxTokens: 200_000,
        percentage: 20,
        isNearlyFull: false,
        isFull: false,
        isCompactionWorthwhile: true
      },
      attachments: [
        { id: 'a1', nombre: 'foto.png', tipo: 'image/png', vistaPrevia: 'blob:1', estado: 'subiendo' },
        { id: 'a2', nombre: 'otra.png', tipo: 'image/png', vistaPrevia: 'blob:2', estado: 'lista', url: 'https://almacen.example/2.png' },
        { id: 'a3', nombre: 'rota.png', tipo: 'image/png', vistaPrevia: 'blob:3', estado: 'error' }
      ],
      canAttachImages: true,
      uploadedDocument: { id: 'd1', name: 'manual.pdf' },
      onAddImages: () => {},
      onRemoveAttachment: () => {}
    });

    expect(screen.getByText(get(t)('ai_assistant.error_rate_limit_with_wait', { seconds: 3 }))).toBeInTheDocument();
    expect(screen.getByText('manual.pdf')).toBeInTheDocument();
    expect(reintentar()).not.toBeNull();
  });
});
