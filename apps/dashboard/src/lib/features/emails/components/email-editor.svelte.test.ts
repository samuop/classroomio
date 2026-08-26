import { fireEvent, render, screen } from '@testing-library/svelte';

import EmailEditor from './email-editor.svelte';
import { emailsApi, type EmailTemplateView } from '../api/emails.svelte';

/**
 * El editor de correos, montado de verdad.
 *
 * Este archivo existe por un error concreto: la pantalla de Correos salió a
 * producción y se rompía **al montar**, con typecheck, lint, compilación y 850
 * tests de backend en verde. Ninguna de esas herramientas ejecuta un
 * componente, así que ninguna podía verlo. Los tests de acá abajo lo ejecutan.
 */

function plantilla(cambios: Partial<EmailTemplateView> = {}): EmailTemplateView {
  const bloques = {
    subject: 'Te sumaron a {orgName}',
    heading: 'Hola',
    body: 'Ya tenés lugar en la plataforma.\n\nEntrá cuando quieras.',
    ctaLabel: 'Entrar',
    ctaUrl: '{inviteLink}',
    footer: 'Si no esperabas este correo, ignoralo.'
  };

  return {
    id: 'student-invite',
    defaults: bloques,
    values: { ...bloques },
    overrides: { subject: null, heading: null, body: null, ctaLabel: null, ctaUrl: null, footer: null },
    variables: ['orgName', 'inviteLink'],
    requiredVariables: ['inviteLink'],
    isCustomized: false,
    notificationId: null,
    mandatory: false,
    ...cambios
  };
}

beforeEach(() => {
  // La vista previa la pide el servidor. Acá no hay servidor, y sin esto cada
  // test dejaría un pedido colgado contra una URL que no existe.
  vi.spyOn(emailsApi, 'preview').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmailEditor', () => {
  /**
   * El test que faltaba.
   *
   * Rompe si alguien vuelve a poner `bind:ref={campos.subject}` sobre un objeto
   * que arranca vacío: pasarle `undefined` a una prop que declara valor por
   * defecto hace que Svelte 5 corte el render con `props_invalid_value`.
   * Compila perfecto, explota al montar. Exactamente lo que pasó.
   */
  it('monta y dibuja los seis bloques editables', () => {
    render(EmailEditor, { props: { template: plantilla() } });

    expect(screen.getByLabelText('Asunto')).toHaveValue('Te sumaron a {orgName}');
    expect(screen.getByLabelText('Título')).toHaveValue('Hola');
    expect(screen.getByLabelText('Mensaje')).toHaveValue('Ya tenés lugar en la plataforma.\n\nEntrá cuando quieras.');
    expect(screen.getByLabelText('Texto del botón')).toHaveValue('Entrar');
    expect(screen.getByLabelText('A dónde lleva')).toHaveValue('{inviteLink}');
    expect(screen.getByLabelText('Nota al pie')).toHaveValue('Si no esperabas este correo, ignoralo.');
  });

  /**
   * La pantalla mostraba `notifications.settings.title` en crudo porque las
   * traducciones colgaban de un nivel distinto del que leían los componentes.
   * Se ve a simple vista y ninguna herramienta lo notaba.
   *
   * Hasta dónde llega: agarra la clave que **no existe en ningún idioma**, que
   * es la forma que tuvo el bug. Una que falte sólo en español se muestra en
   * inglés por el `fallbackLocale`, y eso no lo puede ver un render — lo cubre
   * `utils/translations/translations-completeness.test.ts`. Comprobado
   * rompiendo las dos cosas por separado.
   */
  it('no deja ninguna clave de traducción sin traducir', () => {
    const { container } = render(EmailEditor, { props: { template: plantilla() } });

    const crudas = (container.textContent ?? '').match(/\b[a-z_]+(\.[a-z_]+){2,}\b/g) ?? [];

    expect(crudas).toEqual([]);
  });

  /**
   * Lo que reemplazó al `bind:ref`: el elemento se toma del evento de foco.
   *
   * No alcanza con que monte — hay que comprobar que la variable cae **donde
   * está el cursor**, que es para lo que existía la referencia al elemento.
   */
  it('inserta la variable en la posición del cursor del campo enfocado', async () => {
    render(EmailEditor, { props: { template: plantilla() } });

    const mensaje = screen.getByLabelText('Mensaje') as HTMLTextAreaElement;

    await fireEvent.focus(mensaje);
    mensaje.setSelectionRange(8, 8); // "Ya tenés| lugar…"

    await fireEvent.click(screen.getByRole('button', { name: '{orgName}' }));

    expect(mensaje.value).toBe('Ya tenés{orgName} lugar en la plataforma.\n\nEntrá cuando quieras.');
  });

  /**
   * Sin foco previo no hay dónde insertar, y perder lo escrito sería peor que
   * insertar en un lugar imperfecto: se agrega al final del mensaje.
   */
  it('sin ningún campo enfocado, agrega la variable al final del mensaje', async () => {
    render(EmailEditor, { props: { template: plantilla() } });

    await fireEvent.click(screen.getByRole('button', { name: '{orgName}' }));

    expect(screen.getByLabelText('Mensaje')).toHaveValue(
      'Ya tenés lugar en la plataforma.\n\nEntrá cuando quieras.{orgName}'
    );
  });

  /**
   * Una invitación sin el enlace es un correo que no sirve para nada, y eso no
   * se descubre hasta que alguien avisa que no puede entrar.
   */
  it('avisa cuando el texto perdió una variable imprescindible', async () => {
    render(EmailEditor, { props: { template: plantilla() } });

    // Con el botón encendido, `{inviteLink}` está en su destino: no falta nada.
    expect(screen.queryByText(/pierde sentido/i)).not.toBeInTheDocument();

    // Apagar el botón se lleva puesta la única mención al enlace.
    await fireEvent.click(screen.getByRole('switch', { name: 'Botón' }));

    expect(screen.getByText(/pierde sentido/i)).toBeInTheDocument();
  });

  /**
   * Cuando los textos los define la consultora de arriba, esta empresa los ve
   * pero no los toca. Que el candado exista en el servidor no sirve si la
   * pantalla igual deja escribir: la persona escribe y pierde el trabajo.
   */
  it('con editable=false deja los campos de sólo lectura y esconde el guardar', () => {
    render(EmailEditor, { props: { template: plantilla(), editable: false } });

    expect(screen.getByLabelText('Asunto')).toBeDisabled();
    expect(screen.getByLabelText('Mensaje')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });
});
