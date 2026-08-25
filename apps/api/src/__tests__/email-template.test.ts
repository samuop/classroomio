/**
 * El layout de los correos transaccionales.
 *
 * Es el mismo que usa SaaS-RRHH, a propósito: los dos productos le escriben a la
 * misma gente y tienen que leerse como del mismo lugar. Estos tests fijan lo que
 * hace que eso se sostenga, que no es el color sino tres decisiones:
 *
 *   1. **Nada de `<style>`.** Gmail lo descarta al reenviar y Outlook lo respeta
 *      a medias: el diseño terminaba dependiendo del cliente de correo de cada
 *      destinatario. Todo va en línea.
 *   2. **El layout viste al contenido.** Las diecisiete definiciones de
 *      `emails/` escriben `<p>` y `<a class="button">` pelados; la plantilla los
 *      convierte. Si esto se rompe, los correos siguen saliendo — sin estilos, y
 *      nadie se entera hasta que un cliente lo comenta.
 *   3. **No queda una sola marca ajena.**
 */
import { describe, expect, it } from 'vitest';

import { getDefaultTemplate } from '@cio/email';

const CONTENT = `
  <p>Hola,</p>
  <p>Te invitaron al curso <strong>Seguridad e Higiene</strong>.</p>
  <div><a class="button" href="https://learn.tensor.com.ar/invite/abc">Ir al curso</a></div>
`;

const render = (content = CONTENT, options?: { sender?: string | null }) => getDefaultTemplate(content, options);

describe('estructura del layout', () => {
  it('no emite ningún bloque de estilos', () => {
    expect(render()).not.toMatch(/<style/i);
  });

  it('arma la tabla de 600px con la barra de acento', () => {
    const html = render();

    expect(html).toContain('max-width:600px');
    // La barra superior redondeada es la firma visual compartida con SaaS-RRHH.
    expect(html).toContain('border-radius:12px 12px 0 0');
    expect(html).toContain('border-radius:0 0 12px 12px');
  });

  it('usa el mismo acento en la barra y en el botón', () => {
    // Que coincidan es la coherencia: dos acentos distintos en el mismo correo
    // se leen como dos productos.
    const html = render();
    const accents = html.match(/#7B35AB/g) ?? [];

    expect(accents.length).toBeGreaterThanOrEqual(2);
  });
});

describe('el layout viste al contenido', () => {
  it('convierte el botón declarativo en uno con estilos en línea', () => {
    const html = render();

    expect(html).not.toContain('class="button"');
    expect(html).toMatch(/<a href="https:\/\/learn\.tensor\.com\.ar\/invite\/abc" style="display:inline-block/);
    // El color plano después del degradado: Outlook ignora el gradiente y sin
    // esto el botón sale transparente con texto blanco, o sea invisible.
    expect(html).toContain('background-color:#7B35AB;">Ir al curso</a>');
  });

  it('estila todos los párrafos del contenido', () => {
    const html = render();
    const styled = html.match(/<p style="margin:0 0 16px 0/g) ?? [];

    expect(styled).toHaveLength(2);
  });

  it('no pisa un párrafo que ya trae su propio estilo', () => {
    const html = render('<p style="color:red">rojo</p>');

    expect(html).toContain('<p style="color:red">rojo</p>');
    expect(html).not.toMatch(/<p style="color:red" style=/);
  });

  it('deja intacto el resto del marcado', () => {
    expect(render()).toContain('<strong>Seguridad e Higiene</strong>');
  });
});

describe('quién firma el correo', () => {
  it('pone a la organización de antetítulo y en el pie', () => {
    const html = render(CONTENT, { sender: 'Pinturas Especiales' });

    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('Pinturas Especiales');
    expect(html).toContain('Correo enviado por Pinturas Especiales');
  });

  it('sin organización no inventa un remitente', () => {
    const html = render(CONTENT);

    expect(html).not.toContain('Correo enviado por');
    expect(html).not.toContain('text-transform:uppercase');
  });

  it('escapa el nombre de la organización', () => {
    // El nombre lo escribe quien crea la empresa. Sin escapar, entra marcado
    // crudo al correo de todos sus alumnos.
    const html = render(CONTENT, { sender: '<script>alert(1)</script>' });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('trata un nombre en blanco como ausencia', () => {
    expect(render(CONTENT, { sender: '   ' })).not.toContain('Correo enviado por');
  });
});

describe('marca', () => {
  it('no menciona ClassroomIO en ninguna parte', () => {
    const html = render(CONTENT, { sender: 'Pinturas Especiales' });

    expect(html.toLowerCase()).not.toContain('classroomio');
  });

  it('firma el pie con la marca del despliegue y el año', () => {
    const html = render();

    expect(html).toContain(String(new Date().getFullYear()));
  });
});
