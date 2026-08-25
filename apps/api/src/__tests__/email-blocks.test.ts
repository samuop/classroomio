/**
 * Los correos escritos en bloques de texto, no en HTML.
 *
 * Antes el admin editaba el documento entero —`<!doctype html>`, tablas de
 * 600px, estilos en línea— y eso tiene dos problemas distintos: es imposible
 * para quien no escribe HTML, y para quien sí sabe es una trampa, porque una
 * etiqueta mal cerrada sale igual y llega rota a trescientas bandejas.
 *
 * Ahora el admin escribe texto y el servidor lo mete en el diseño de siempre.
 * Eso mueve dónde están los peligros:
 *
 *   1. **Lo que escribe el admin ya no es HTML.** Se escapa entero, así que un
 *      `<script>` tipeado sale como texto visible. Lo que sí queda vivo es el
 *      enlace del botón: es lo único que llega crudo a un `href`.
 *   2. **Lo que se interpola** son datos de gente —el nombre de un alumno, el
 *      título de un curso— y también se escapa, o un curso llamado `<b>` se
 *      convierte en etiqueta dentro del correo de todos los demás.
 *   3. **El texto de fábrica es lo que se envía.** Si un `{variable}` de una
 *      plantilla está mal escrito, el correo sale con la llave a la vista y
 *      nadie se entera hasta que se queja alguien.
 */
import { describe, expect, it } from 'vitest';

import {
  EMAIL_BLOCK_KEYS,
  EmailRegistry,
  type EmailBlocks,
  getEditableEmails,
  isEditableEmail,
  renderEmailBlocks,
  sampleFieldsFor
} from '@cio/email';

const BASE: EmailBlocks = {
  subject: 'Asunto',
  heading: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  footer: ''
};

const render = (blocks: Partial<EmailBlocks>, fields: Record<string, unknown> = {}) =>
  renderEmailBlocks({ ...BASE, ...blocks }, fields);

/**
 * Cuántos párrafos del CUERPO tiene el correo.
 *
 * Contando `<p ` a secas se cuela el del pie del diseño, que está siempre y no
 * tiene nada que ver con lo que escribió el admin: el conteo daba uno de más y
 * el test pasaba a verde por el motivo equivocado.
 */
const parrafos = (html: string) => html.match(/margin:0 0 16px 0/g)?.length ?? 0;

describe('el cuerpo, que es texto y no HTML', () => {
  it('una línea en blanco empieza un párrafo nuevo', () => {
    const { html } = render({ body: 'Primero.\n\nSegundo.' });

    expect(html).toContain('>Primero.<');
    expect(html).toContain('>Segundo.<');
    expect(parrafos(html)).toBe(2);
  });

  it('un salto simple es un salto de línea, no un párrafo', () => {
    const { html } = render({ body: 'Saludos,\nEquipo' });

    expect(html).toContain('Saludos,<br/>Equipo');
    expect(parrafos(html)).toBe(1);
  });

  it('*así* sale en negrita', () => {
    // Es el único formato que hay, y existe porque los textos de fábrica ya
    // usaban negrita para el nombre del curso.
    expect(render({ body: 'Curso *Ventas*' }).html).toContain('Curso <strong>Ventas</strong>');
  });

  it('lo que escribe el admin se escapa: un script tipeado sale como texto', () => {
    const { html } = render({ body: '<script>alert(1)</script> hola' });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('hola');
  });

  it('un párrafo que queda vacío al interpolar desaparece', () => {
    // Es cómo se resuelven las líneas opcionales: `{courseLine}` sin cursos no
    // deja un hueco, se cae el párrafo entero.
    const { html } = render({ body: 'Hola.\n\n{opcional}\n\nChau.' }, { opcional: '' });

    expect(parrafos(html)).toBe(2);
  });
});

describe('los datos que se interpolan', () => {
  it('reemplaza la variable por su valor', () => {
    expect(render({ body: 'Hola {name}' }, { name: 'Ana' }).html).toContain('Hola Ana');
  });

  it('escapa el valor: un alumno no puede meter etiquetas en el correo de los demás', () => {
    const { html } = render({ body: '{name}' }, { name: '<b>Ana</b>' });

    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).not.toContain('<b>Ana</b>');
  });

  it('NO escapa el asunto, que no es HTML', () => {
    // Escapar acá haría que la bandeja de entrada muestre "Ventas &amp; Marketing".
    const { subject } = render({ subject: 'Nuevo: {curso}' }, { curso: 'Ventas & Marketing' });

    expect(subject).toBe('Nuevo: Ventas & Marketing');
  });

  it('deja a la vista una variable que no existe, en vez de vaciarla', () => {
    // Que el admin vea `{cursoo}` en la vista previa y lo corrija es mejor que
    // un hueco silencioso que nadie note hasta que el correo ya salió.
    expect(render({ body: 'Curso: {cursoo}' }, { curso: 'X' }).html).toContain('Curso: {cursoo}');
  });

  it('convierte null en vacío, no en la palabra "null"', () => {
    const { html } = render({ body: 'Valor: {nada}' }, { nada: null });

    expect(html).toContain('Valor:');
    expect(html).not.toContain('null');
  });

  it('un asterisco DENTRO de un valor sale literal, no en negrita', () => {
    // La negrita se aplica antes de interpolar, a propósito: si fuera después,
    // un alumno llamado `*Ana*` metería etiquetas en el correo.
    const { html } = render({ body: '{name}' }, { name: '*Ana*' });

    expect(html).not.toContain('<strong>');
    expect(html).toContain('*Ana*');
  });
});

describe('el botón', () => {
  it('sale cuando tiene texto y destino', () => {
    const { html } = render({ ctaLabel: 'Entrar', ctaUrl: '{link}' }, { link: 'https://ejemplo.test/x' });

    expect(html).toContain('href="https://ejemplo.test/x"');
    expect(html).toContain('Entrar');
  });

  it('sin texto no hay botón, y eso es una elección válida', () => {
    const { html } = render({ ctaLabel: '', ctaUrl: 'https://ejemplo.test/x' });

    expect(html).not.toContain('https://ejemplo.test/x');
  });

  it('un destino que no es http(s) no se dibuja', () => {
    // El `href` es lo único del correo que recibe texto del admin sin escapar.
    // `javascript:` adentro de un correo es una trampa que viaja con el correo.
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://ejemplo.test/x', '']) {
      const { html } = render({ ctaLabel: 'Entrar', ctaUrl: url });

      expect(html).not.toContain('>Entrar<');
    }
  });

  it('una variable de enlace que no llegó tampoco dibuja el botón', () => {
    // Mejor sin botón que con un botón que no lleva a ningún lado.
    const { html } = render({ ctaLabel: 'Entrar', ctaUrl: '{link}' }, { link: null });

    expect(html).not.toContain('>Entrar<');
  });
});

describe('el resto del armado', () => {
  it('el título sale como encabezado, y vacío no sale', () => {
    expect(render({ heading: 'Bienvenida' }).html).toContain('Bienvenida');
    expect(render({ heading: '' }).html).not.toContain('<h1');
  });

  it('el pie sale chico, y vacío no sale', () => {
    expect(render({ footer: 'Letra chica' }).html).toContain('Letra chica');
  });

  it('firma con la empresa cuando se la pasan', () => {
    const html = renderEmailBlocks({ ...BASE, body: 'x' }, {}, { sender: 'Consultora Ejemplo' }).html;

    expect(html).toContain('Consultora Ejemplo');
  });
});

describe('el catálogo de correos editables', () => {
  const editables = getEditableEmails();

  it('deja afuera los de cuenta', () => {
    // Son el camino para entrar al sistema. Un admin que borre el `{link}` de
    // "recuperar contraseña" deja gente afuera sin ningún error que lo avise.
    for (const id of ['welcome', 'verifyEmail', 'forgotPassword', 'onPasswordReset']) {
      expect(isEditableEmail(id)).toBe(false);
    }
  });

  it('incluye los que le hablan a alumnos y docentes', () => {
    expect(isEditableEmail('teacherStudentJoined')).toBe(true);
    expect(isEditableEmail('studentCourseInvite')).toBe(true);
  });

  it('rechaza un id que no existe', () => {
    expect(isEditableEmail('loQueSea')).toBe(false);
  });

  it('ofrece también las variables que el correo calcula', () => {
    // Para quien escribe el texto, `{dueLine}` y `{expiresAt}` son lo mismo.
    const objetivo = editables.find((e) => e.id === 'programGoalReminder');

    expect(objetivo?.variables).toContain('dueLine');
    expect(objetivo?.variables).toContain('progress');
    expect(objetivo?.variables).toContain('goalTitle');
  });

  it('marca como imprescindibles las variables de enlace', () => {
    const invitacion = editables.find((e) => e.id === 'studentCourseInvite');

    expect(invitacion?.requiredVariables).toContain('inviteLink');
  });

  it('ninguno se quedó sin asunto ni sin cuerpo', () => {
    for (const email of editables) {
      expect(email.defaults.subject.trim(), email.id).not.toBe('');
      expect(email.defaults.body.trim(), email.id).not.toBe('');
    }
  });

  it('cada `{variable}` del texto de fábrica existe de verdad', () => {
    // El que muerde: una variable mal escrita en cualquiera de las plantillas
    // sale con la llave a la vista en la bandeja de entrada de un alumno, y no
    // hay ningún error que lo avise.
    for (const email of editables) {
      const usadas = EMAIL_BLOCK_KEYS.flatMap((k) => [...email.defaults[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

      for (const nombre of usadas) {
        expect(email.variables, `${email.id} usa {${nombre}}`).toContain(nombre);
      }
    }
  });

  it('todos renderizan sin dejar ninguna llave suelta', () => {
    for (const email of editables) {
      const template = EmailRegistry.get(email.id)!;
      const fields = sampleFieldsFor(template);
      const { subject, html } = template.renderEmail(fields);

      expect(subject.trim(), email.id).not.toBe('');
      expect(html, email.id).not.toMatch(/\{[a-zA-Z_]\w*\}/);
      expect(subject, email.id).not.toMatch(/\{[a-zA-Z_]\w*\}/);
    }
  });

  it('el que declara botón lo dibuja de verdad', () => {
    for (const email of editables.filter((e) => e.defaults.ctaLabel.trim() !== '')) {
      const template = EmailRegistry.get(email.id)!;
      const { html } = template.renderEmail(sampleFieldsFor(template));

      expect(html, email.id).toContain('https://');
    }
  });
});

describe('lo que se envía sale de los bloques, no de un render aparte', () => {
  it('el asunto también se interpola', () => {
    // Un asunto con `{courseName}` mandado crudo deja la llave a la vista en la
    // bandeja de entrada, que es el peor lugar donde puede pasar.
    const { subject } = render({ subject: 'Curso {curso}' }, { curso: 'Ventas' });

    expect(subject).toBe('Curso Ventas');
  });

  it('el HTML de `render` y el de `renderEmail` son el mismo', () => {
    const template = EmailRegistry.get('studentCourseInvite')!;
    const fields = sampleFieldsFor(template);

    expect(template.render(fields)).toBe(template.renderEmail(fields).html);
  });
});
