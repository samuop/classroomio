/**
 * Reescribir el texto de un correo: qué se guarda, qué se limpia y cómo se
 * reemplazan las variables.
 *
 * Acá hay dos superficies peligrosas y son distintas entre sí:
 *
 *   1. **Lo que escribe el admin** llega como HTML a un correo. Un `<script>` o
 *      un `href="javascript:…"` guardado hoy sale mañana en la bandeja de
 *      cientos de alumnos, y a esa altura no se puede recuperar.
 *   2. **Lo que se interpola** son datos de gente: el nombre de un alumno, el
 *      título de un curso. Eso NO es HTML y tiene que escaparse, o un curso
 *      llamado `<b>` se convierte en etiqueta dentro del correo.
 *
 * Un fallo de cualquiera de las dos no rompe nada visible: el correo sale, se
 * ve casi bien, y el problema viaja.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyVariables, getEditableEmails, isEditableEmail } from '@cio/email';

/**
 * ── Por qué esto lanza un proceso ──────────────────────────────────────────
 *
 * `sanitizeEmailBody` usa DOMPurify, que llega a jsdom, que tiene un archivo
 * CommonJS que hace `require()` de uno ESM. Node lo permite bajo el cargador
 * propio de la API; el camino CJS externalizado de vitest no, y el suite ni
 * siquiera llega a recolectar. Es exactamente el mismo muro que documenta
 * `svg-sanitize.test.ts`, y la misma salida: correrlo con el cargador con el
 * que la API arranca de verdad, que además lo acerca a la realidad.
 */
const CASOS = {
  formato: '<p>Hola <strong>Ana</strong></p><ul><li>uno</li></ul>',
  enlace: '<a href="https://ejemplo.test/x">ir</a>',
  correo: '<a href="mailto:hola@ejemplo.test">escribir</a>',
  script: '<p>Hola</p><script>alert(1)</script>',
  manejador: '<p onclick="alert(1)">Hola</p>',
  javascript: '<a href="javascript:alert(1)">toca aca</a>',
  datos: '<a href="data:text/html;base64,PHNjcmlwdD4=">bajar</a>',
  incrustados: '<iframe src="https://ejemplo.test"></iframe><form action="/x"><input name="a"/></form><style>p{}</style>',
  imagen: '<img src="https://ejemplo.test/pixel.gif"/>',
  // DOMPurify por si solo permite `tel:`, `ftp:` y varios mas. Este caso es el
  // que prueba NUESTRA lista blanca de esquemas, no la suya: sin ella, los dos
  // casos de arriba (javascript:, data:) pasarian igual y no probarian nada.
  esquemaRaro: '<a href="ftp://ejemplo.test/x">bajar</a><a href="tel:+5491100000000">llamar</a>'
};

let limpio: Record<keyof typeof CASOS, string>;

beforeAll(() => {
  const apiRoot = path.resolve(__dirname, '../..');

  const script = `
    import { sanitizeEmailBody } from './src/utils/sanitize-email-body.ts';
    const casos = JSON.parse(process.argv[1]);
    const out = {};
    for (const [nombre, html] of Object.entries(casos)) out[nombre] = sanitizeEmailBody(html);
    process.stdout.write('<<<' + JSON.stringify(out) + '>>>');
  `;

  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, JSON.stringify(CASOS)],
    { cwd: apiRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const match = /<<<([\s\S]*)>>>/.exec(stdout);
  if (!match) throw new Error(`el saneador no devolvió nada:
${stdout}`);

  limpio = JSON.parse(match[1]);
}, 60_000);

describe('qué correos se pueden reescribir', () => {
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

  it('cada correo declara sus variables, y salen de su propio esquema', () => {
    const catalogo = getEditableEmails();

    expect(catalogo.length).toBeGreaterThan(0);

    const unido = catalogo.find((e) => e.id === 'teacherStudentJoined');
    // Exactamente los campos que la plantilla valida: ni más ni menos.
    expect(unido?.variables).toEqual(['courseName', 'studentEmail', 'studentName']);
  });

  it('marca como imprescindibles las variables de enlace', () => {
    const invitacion = getEditableEmails().find((e) => e.id === 'studentCourseInvite');

    expect(invitacion?.requiredVariables.some((v) => /link|url/i.test(v))).toBe(true);
  });
});

describe('saneado del cuerpo escrito por el admin', () => {
  it('conserva el formato que un correo sí sabe mostrar', () => {
    expect(limpio.formato).toContain('<strong>Ana</strong>');
    expect(limpio.formato).toContain('<li>uno</li>');
  });

  it('conserva los enlaces normales', () => {
    expect(limpio.enlace).toContain('href="https://ejemplo.test/x"');
    expect(limpio.correo).toContain('mailto:');
  });

  it('saca el script pero deja el texto que lo rodeaba', () => {
    expect(limpio.script).not.toContain('<script');
    expect(limpio.script).not.toContain('alert(1)');
    expect(limpio.script).toContain('Hola');
  });

  it('saca los manejadores de eventos', () => {
    expect(limpio.manejador).not.toContain('onclick');
    expect(limpio.manejador).toContain('Hola');
  });

  it('saca los enlaces javascript:', () => {
    // El caso clásico: se ve como un enlace normal y en algunos clientes corre.
    expect(limpio.javascript).not.toContain('javascript:');
  });

  it('saca los href data:', () => {
    expect(limpio.datos).not.toContain('data:');
  });

  it('saca iframes, formularios y estilos', () => {
    expect(limpio.incrustados).not.toContain('<iframe');
    expect(limpio.incrustados).not.toContain('<form');
    expect(limpio.incrustados).not.toContain('<style');
    expect(limpio.incrustados).not.toContain('<input');
  });

  it('sólo deja https y mailto, ningún otro esquema', () => {
    // Un correo no necesita `ftp:` ni `tel:`, y cada esquema de más es una
    // superficie que hay que confiar en que el cliente de correo maneje bien.
    expect(limpio.esquemaRaro).not.toContain('ftp:');
    expect(limpio.esquemaRaro).not.toContain('tel:');
  });

  it('saca las imágenes', () => {
    // Una imagen remota en un correo es un píxel de rastreo servido por
    // cualquiera, y además la mayoría de los clientes la bloquean igual.
    expect(limpio.imagen).not.toContain('<img');
  });
});

describe('reemplazo de variables', () => {
  const campos = { studentName: 'Ana', courseName: 'Ventas & Marketing', nada: null };

  it('reemplaza lo que existe', () => {
    expect(applyVariables('Hola {studentName}', campos)).toBe('Hola Ana');
  });

  it('escapa el valor en el cuerpo HTML', () => {
    // Un alumno que se anota como `<b>Ana</b>` no puede poner etiquetas en el
    // correo de todos los demás.
    const salida = applyVariables('<p>{studentName}</p>', { studentName: '<b>Ana</b>' });

    expect(salida).toBe('<p>&lt;b&gt;Ana&lt;/b&gt;</p>');
  });

  it('NO escapa en el asunto, que no es HTML', () => {
    // Escapar acá haría que la bandeja de entrada muestre "Ventas &amp; Marketing".
    expect(applyVariables('Nuevo: {courseName}', campos, 'texto')).toBe('Nuevo: Ventas & Marketing');
  });

  it('deja a la vista una variable que no existe, en vez de vaciarla', () => {
    // Que el admin vea `{cursoo}` en la vista previa y lo corrija es mejor que un
    // hueco silencioso que nadie note hasta que el correo ya salió.
    expect(applyVariables('Curso: {cursoo}', campos)).toBe('Curso: {cursoo}');
  });

  it('convierte null en vacío, no en la palabra "null"', () => {
    expect(applyVariables('Valor: {nada}', campos)).toBe('Valor: ');
  });

  it('no toca las llaves que no son una variable', () => {
    expect(applyVariables('function () { return 1; }', campos)).toBe('function () { return 1; }');
  });

  it('reemplaza la misma variable todas las veces que aparezca', () => {
    expect(applyVariables('{studentName} y {studentName}', campos)).toBe('Ana y Ana');
  });
});
