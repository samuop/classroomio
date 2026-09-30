/**
 * ¿Lo que devolvió el lector es la página, o lo que la página pone delante?
 *
 * El caso que originó el detector: una docente pegó el enlace de su planilla
 * privada en Fuentes → Página web y quedó guardada como fuente la pantalla de
 * inicio de sesión de Google —«Sign in / to continue to Google Sheets / Email
 * or phone» más la lista de idiomas del selector—. El filtro que había la
 * dejaba pasar: está hecho para muros de ENLACES, y ésta trae los idiomas como
 * texto plano.
 *
 * Lo que se fija acá, con una pantalla que imita aquella (el id de la planilla
 * es inventado):
 *   1. el muro se reconoce y se dice que pide iniciar sesión;
 *   2. una página de AYUDA sobre cómo iniciar sesión NO es un muro, aunque
 *      tenga las mismas palabras en el título: tiene prosa;
 *   3. una tabla de referencia NO es un muro, aunque no tenga ni una oración:
 *      la medida de prosa nunca descarta sola, sólo junto con las señales.
 */
import { describe, expect, it } from 'vitest';

import {
  diagnosticarFuente,
  diagnosticarPagina,
  errorDePaginaSinContenido,
  extractoDeProsa,
  isUnreadablePage,
  PROSA_MINIMA_CON_SENALES_DE_LOGIN,
  prosaEnRenglones,
  senalesDeLogin
} from '@api/services/agent/pagina-sin-contenido';
import { AppError } from '@api/utils/errors';

/** Un id de planilla inventado: no existe ninguna planilla con este id. */
const PLANILLA = 'https://docs.google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit#gid=0';

const IDIOMAS = [
  'Afrikaans', 'azərbaycan', 'bosanski', 'català', 'Čeština', 'Cymraeg', 'Dansk', 'Deutsch', 'eesti',
  'English (United Kingdom)', 'English (United States)', 'Español (España)', 'Español (Latinoamérica)',
  'euskara', 'Filipino', 'Français (Canada)', 'Français (France)', 'Gaeilge', 'galego', 'Hrvatski',
  'Indonesia', 'isiZulu', 'íslenska', 'Italiano', 'Kiswahili', 'latviešu', 'lietuvių', 'magyar', 'Melayu',
  'Nederlands', 'norsk', 'polski', 'Português (Brasil)', 'Português (Portugal)', 'română', 'shqip',
  'Slovenčina', 'slovenščina', 'srpski (latinica)', 'Suomi', 'Svenska', 'Tiếng Việt', 'Türkçe', 'Ελληνικά',
  'беларуская', 'български', 'кыргызча', 'қазақ тілі', 'македонски', 'монгол', 'Русский', 'српски',
  'Українська', 'ქართული', 'հայերեն', 'עברית', 'اردو', 'العربية', 'فارسی', 'አማርኛ', 'नेपाली', 'मराठी',
  'हिन्दी', 'বাংলা', 'ਪੰਜਾਬੀ', 'ગુજરાતી', 'தமிழ்', 'తెలుగు', 'ಕನ್ನಡ', 'മലയാളം', 'ไทย', '한국어', '日本語',
  '简体中文', '繁體中文'
];

/** Imita lo que el lector devolvió para una planilla privada, con el sobre con que se guarda. */
const MURO_DE_GOOGLE = [
  `<external_untrusted_document src="${PLANILLA}">`,
  'Title: Google Sheets: Sign-in',
  '',
  `URL Source: ${PLANILLA}`,
  '',
  'Markdown Content:',
  'Loading',
  '',
  '![Image 1](https://www.gstatic.com/images/branding/logo.svg)',
  '',
  '# Sign in',
  '',
  'to continue to Google Sheets',
  '',
  'Email or phone',
  '',
  'Forgot email?',
  '',
  'Type the text you hear or see',
  '',
  'Not your computer? Use Guest mode to sign in privately. [Learn more](https://support.google.com/)',
  '',
  'Next',
  '',
  'Create account',
  '',
  ...IDIOMAS.map((idioma) => `*   ${idioma}`),
  '',
  '*   [Help](https://support.google.com/accounts)',
  '*   [Privacy](https://accounts.google.com/TOS)',
  '*   [Terms](https://accounts.google.com/TOS)',
  '</external_untrusted_document>'
].join('\n');

/** La misma pantalla, en castellano: la frase del formulario cambia de idioma. */
const MURO_EN_CASTELLANO = MURO_DE_GOOGLE.replace('Title: Google Sheets: Sign-in', 'Title: Hojas de cálculo de Google: Acceder')
  .replace('to continue to Google Sheets', 'para ir a Hojas de cálculo de Google')
  .replace('Email or phone', 'Correo electrónico o teléfono')
  .replace('Forgot email?', '¿Olvidaste el correo electrónico?');

/** Una página de ayuda de verdad sobre iniciar sesión: el título dice lo mismo que el muro. */
const AYUDA_PARA_INICIAR_SESION = [
  'Title: Iniciar sesión en tu cuenta - Centro de ayuda de Ejemplo',
  '',
  'URL Source: https://ayuda.ejemplo.test/articulos/iniciar-sesion',
  '',
  'Markdown Content:',
  '# Iniciar sesión en tu cuenta',
  '',
  'Para iniciar sesión necesitás la dirección de correo con la que te registraste y tu contraseña.',
  'En el campo Correo electrónico o teléfono escribí tu dirección tal como la usaste al crear la cuenta.',
  'Si usás una computadora compartida, acordate de cerrar la sesión cuando termines de trabajar.',
  'Cuando no recordás la contraseña, tocá el enlace de recuperación y seguí los pasos que llegan por correo.',
  'Si la cuenta es de tu trabajo, puede que tengas que pedirle acceso a quien administra tu organización.',
  '',
  '## Problemas frecuentes',
  '',
  'Si el sistema dice que la contraseña es incorrecta, revisá que no esté activada la tecla de mayúsculas.',
  'Si no te llega el correo de recuperación, mirá en la carpeta de correo no deseado antes de volver a pedirlo.'
].join('\n');

/** Una tabla de referencia: puros renglones cortos, ni una oración. Es buen material. */
const TABLA_DE_EQUIVALENCIAS = [
  'Title: Tabla de equivalencias de medidas',
  '',
  'URL Source: https://medidas.ejemplo.test/tabla',
  '',
  'Markdown Content:',
  // Un menú con un enlace para iniciar sesión, como tiene casi cualquier sitio.
  '[Inicio](https://medidas.ejemplo.test/) [Iniciar sesión](https://medidas.ejemplo.test/login)',
  '',
  '# Equivalencias',
  '',
  '| Pulgadas | Centímetros | Milímetros |',
  '| --- | --- | --- |',
  ...Array.from({ length: 40 }, (_, i) => `| ${i + 1} | ${((i + 1) * 2.54).toFixed(2)} | ${((i + 1) * 25.4).toFixed(1)} |`)
].join('\n');

/** Una portada de documentación hecha casi sólo de enlaces. */
const PORTADA_DE_ENLACES = [
  'Title: Documentación',
  '',
  'URL Source: https://docs.ejemplo.test/',
  '',
  'Markdown Content:',
  ...['Primeros pasos', 'Instalación', 'Configuración', 'Referencia de la API', 'Preguntas frecuentes', 'Novedades'].map(
    (titulo, i) => `*   [${titulo}](https://docs.ejemplo.test/seccion-${i + 1})`
  )
].join('\n');

describe('la pantalla de inicio de sesión de una planilla privada', () => {
  it('se reconoce como un muro, no como una página', () => {
    expect(diagnosticarPagina(MURO_DE_GOOGLE)).toEqual({
      code: 'SOURCE_NEEDS_LOGIN',
      motivo: expect.stringContaining('sign-in screen')
    });
  });

  it('también como fuente: el código es el que el panel traduce', () => {
    expect(diagnosticarFuente(MURO_DE_GOOGLE)?.code).toBe('SOURCE_NEEDS_LOGIN');
  });

  it('el filtro viejo la dejaba pasar: por eso hacía falta otro', () => {
    // La lista de idiomas es texto plano, no enlaces: el filtro de muros de
    // enlaces la contaba como prosa.
    expect(isUnreadablePage(MURO_DE_GOOGLE)).toBe(false);
  });

  it('en castellano también', () => {
    expect(diagnosticarPagina(MURO_EN_CASTELLANO)?.code).toBe('SOURCE_NEEDS_LOGIN');
  });

  it('las señales son las del título y las del formulario', () => {
    expect(senalesDeLogin(MURO_DE_GOOGLE)).toEqual(
      expect.arrayContaining(['title "Google Sheets: Sign-in"', '"to continue to"', '"Email or phone"', '"Forgot email"'])
    );
    expect(prosaEnRenglones(MURO_DE_GOOGLE)).toBeLessThan(PROSA_MINIMA_CON_SENALES_DE_LOGIN);
  });
});

describe('lo que se parece pero es una página de verdad', () => {
  it('una ayuda sobre cómo iniciar sesión tiene las mismas señales, y prosa', () => {
    expect(senalesDeLogin(AYUDA_PARA_INICIAR_SESION).length).toBeGreaterThan(0);
    expect(diagnosticarPagina(AYUDA_PARA_INICIAR_SESION)).toBeNull();
    expect(diagnosticarFuente(AYUDA_PARA_INICIAR_SESION)).toBeNull();
  });

  it('una tabla de referencia no tiene ni una oración, y no es un muro', () => {
    // La medida de prosa sola la descartaría: por eso nunca va sola.
    expect(prosaEnRenglones(TABLA_DE_EQUIVALENCIAS)).toBeLessThan(PROSA_MINIMA_CON_SENALES_DE_LOGIN);
    expect(diagnosticarPagina(TABLA_DE_EQUIVALENCIAS)).toBeNull();
    expect(diagnosticarFuente(TABLA_DE_EQUIVALENCIAS)).toBeNull();
  });

  it('un título con el verbo «acceder» no es un muro: una tabla de referencia de verdad', () => {
    // «acceder» es un verbo común en castellano. Con el título que sólo lo
    // CONTENÍA, esta página —justo lo que la investigación busca— se descartaba.
    const tabla = [
      'Title: Acceder a las funciones de Excel: tabla de referencia',
      '',
      'Markdown Content:',
      '| Función | Qué hace |',
      '| --- | --- |',
      ...Array.from({ length: 25 }, (_, i) => `| FUNCION${i} | Devuelve el resultado ${i} |`)
    ].join('\n');

    expect(diagnosticarPagina(tabla)).toBeNull();
    expect(diagnosticarFuente(tabla)).toBeNull();
  });

  it('«to continue to» en el pie de una tabla no alcanza sola', () => {
    const atajos = [
      'Title: Atajos de teclado',
      '',
      'Markdown Content:',
      '| Atajo | Acción |',
      '| --- | --- |',
      ...Array.from({ length: 25 }, (_, i) => `| Ctrl+${String.fromCharCode(65 + i)} | Acción número ${i} |`),
      '',
      'Scroll down to continue to the next table.'
    ].join('\n');

    expect(diagnosticarPagina(atajos)).toBeNull();
  });

  it('una portada de enlaces le sirve al agente para navegar, pero no como fuente', () => {
    expect(diagnosticarPagina(PORTADA_DE_ENLACES)).toBeNull();
    expect(diagnosticarFuente(PORTADA_DE_ENLACES)?.code).toBe('SOURCE_UNREADABLE');
  });
});

describe('lo que el lector avisa y lo que vuelve vacío', () => {
  it('un 401 o un 403 del sitio es un documento privado', () => {
    const privado = 'Title: \nURL Source: https://videos.ejemplo.test/v/1\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\nMenú';

    expect(diagnosticarPagina(privado)?.code).toBe('SOURCE_NEEDS_LOGIN');
  });

  it('otro error del sitio es una página que no está', () => {
    const noEsta = 'Title: \nURL Source: https://ejemplo.test/nada\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nMenú';

    expect(diagnosticarPagina(noEsta)?.code).toBe('SOURCE_UNREADABLE');
  });

  it('una página que no cargó no es una página', () => {
    const vacia = 'Title: Cargando\n\nURL Source: https://app.ejemplo.test/\n\nMarkdown Content:\nLoading...';

    expect(diagnosticarPagina(vacia)?.code).toBe('SOURCE_UNREADABLE');
  });
});

describe('el error que recibe quien pidió la página', () => {
  it('es un 422 con el código, y nombra la dirección', () => {
    const error = errorDePaginaSinContenido({ code: 'SOURCE_NEEDS_LOGIN', motivo: 'it is a sign-in screen' }, PLANILLA);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('SOURCE_NEEDS_LOGIN');
    expect(error.message).toContain(PLANILLA);
  });
});

describe('el extracto que muestra el índice mientras falta el resumen', () => {
  it('saltea el menú y los avisos, y empieza por la prosa', () => {
    const texto = [
      '[Este documento se leyó mirándolo: el archivo no tenía texto extraíble.]',
      'Inicio | Productos | Contacto',
      'La conciliación bancaria compara los movimientos del banco con los registros de la empresa cada mes.',
      'Sirve para encontrar a tiempo los errores de carga y los débitos que nadie reconoce.'
    ].join('\n');

    const extracto = extractoDeProsa(texto, 60);

    expect(extracto.startsWith('La conciliación bancaria')).toBe(true);
    expect(extracto.endsWith('…')).toBe(true);
    // Corta en un espacio: una palabra partida al medio se lee como un error.
    expect(extracto.length).toBeLessThanOrEqual(61);
    expect(extracto).not.toMatch(/\s…$/);
  });

  it('sin prosa se queda con el texto que haya', () => {
    expect(extractoDeProsa('DIRECTOR\n  GERENTE GENERAL', 240)).toBe('DIRECTOR GERENTE GENERAL');
  });
});
