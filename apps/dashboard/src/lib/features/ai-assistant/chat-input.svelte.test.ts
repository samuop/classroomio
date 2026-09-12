import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

import ChatInput from './chat-input.svelte';
import { t } from '$lib/utils/functions/translations';

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
  function montar(onSend: (...args: unknown[]) => void, inputValue = 'hola') {
    return render(ChatInput, {
      props: {
        inputValue,
        isStreaming: false,
        isExhausted: false,
        isUploading: false,
        error: null,
        mentionItems: [],
        uploadedDocument: null,
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

  it('está apagado cuando no hay nada escrito', () => {
    const onSend = vi.fn();
    montar(onSend, '   ');

    expect(botonEnviar()).toBeDisabled();
  });
});
