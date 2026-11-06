/**
 * Escenarios fijos del asistente de cursos, contra una API de verdad.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Los arreglos del asistente se venían midiendo de a uno, sobre el curso que
 * tocaba. Sin una vara fija no se sabe si un cambio arregla un error y empeora
 * otro. Estos escenarios son los errores medidos en noviembre de 2026, con una
 * fuente ficticia, y cada uno tiene su umbral. Se corren antes de desplegar un
 * cambio del asistente (auditoría del 2026-09-23, recomendación 5).
 *
 * ── Los escenarios ───────────────────────────────────────────────────────────
 *
 * E1  Construir con una regla de la docente: el plan la trae en
 *     `teacherRules`, la construcción la respeta (ninguna lección habla de
 *     devoluciones ni descuentos, que la fuente no trae) y termina en UNA
 *     respuesta, sin que el panel mande «seguí».
 * E2  Corregir cuatro lecciones en un mensaje: las cuatro cambian y ningún
 *     bloque se reemplaza más de dos veces (el bucle medido llegaba a nueve).
 * E3  Cambiar una lección a mano: la pregunta que salía de la frase cambiada
 *     queda «a revisar»; al pedir que se actualicen las preguntas, deja de
 *     estarlo y el registro de la ronda lo dice.
 * E4  El relato contra el registro: ninguna respuesta de E1-E3 sale con
 *     afirmaciones que el servidor no vio (`unverifiedClaims`).
 * E5  El pedido pesa lo mismo con la historia larga: viaja sólo el mensaje
 *     nuevo.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   node apps/api/evals/agente/escenarios.mjs --org <id de la empresa>
 *
 * Opciones (o variables de entorno):
 *   --api       EVAL_API        http://localhost:3002
 *   --origin    EVAL_ORIGIN     http://localhost:5173
 *   --email     EVAL_EMAIL      consultora@local.test (semilla local)
 *   --password  EVAL_PASSWORD   prueba1234 (semilla local)
 *   --org       EVAL_ORG_ID     obligatoria: la empresa donde se crea el curso
 *   --reusar    <curso>,<conversación>  saltea la construcción de E1 y corre
 *               el resto sobre un curso ya construido por una corrida anterior
 *
 * Crea un curso de prueba nuevo en cada corrida y no lo borra: queda para
 * mirarlo. Gasta cupo de IA de esa empresa (una construcción chica). Sólo
 * corre contra una API local; nunca contra producción.
 *
 * Primera corrida medida (2026-11-06, Gemini Flash): 14/14, unos 9 minutos.
 * Antes de una corrección del prompt, E1 falló una vez: con la regla «no
 * inventes descuentos», una lección escribió «no debés aplicar descuentos».
 *
 * Sale con código 1 si algún umbral no se cumple. El informe completo queda en
 * un JSON en la carpeta temporal del sistema.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ai from 'ai';
import JSZip from 'jszip';

const AQUI = dirname(fileURLToPath(import.meta.url));

function opcion(nombre, entorno, porDefecto) {
  const indice = process.argv.indexOf(`--${nombre}`);

  if (indice >= 0 && process.argv[indice + 1]) return process.argv[indice + 1];

  return process.env[entorno] ?? porDefecto;
}

const API = opcion('api', 'EVAL_API', 'http://localhost:3002');
const ORIGEN = opcion('origin', 'EVAL_ORIGIN', 'http://localhost:5173');
const EMAIL = opcion('email', 'EVAL_EMAIL', 'consultora@local.test');
const CLAVE = opcion('password', 'EVAL_PASSWORD', 'prueba1234');
const ORG = opcion('org', 'EVAL_ORG_ID', '');
const LOCALE = 'es';

if (!ORG) {
  console.error('Falta --org <id de la empresa> (o EVAL_ORG_ID).');
  process.exit(2);
}

// Crea cursos y gasta cupo: sólo contra una API local, salvo que se pida a
// propósito para otro entorno de prueba.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(API) && !process.argv.includes('--permitir-remoto')) {
  console.error(`Esto corre sólo contra una API local (${API}). Para otro entorno de prueba: --permitir-remoto.`);
  process.exit(2);
}

// ── Umbrales ─────────────────────────────────────────────────────────────────

const UMBRAL = {
  /** Reemplazos del mismo bloque en una ronda (el riel niega el tercero). */
  reemplazosPorBloque: 2,
  /** Peso de un pedido a /agent/chat, en bytes. */
  pesoDelPedido: 64 * 1024,
  /** Lo que la fuente no trae y una regla de la docente prohíbe. */
  prohibido: /devoluci|descuent|reintegr/i
};

const TEXTO_DE_APROBACION = 'Construí el curso según el plan aprobado.';

// ── Cliente ──────────────────────────────────────────────────────────────────

let cookie = '';

async function entrar() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGEN },
    body: JSON.stringify({ email: EMAIL, password: CLAVE })
  });

  if (!res.ok) throw new Error(`no se pudo entrar como ${EMAIL}: ${res.status} ${(await res.text()).slice(0, 200)}`);

  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function pedir(metodo, ruta, cuerpo) {
  const esForm = cuerpo instanceof FormData;

  return fetch(API + ruta, {
    method: metodo,
    headers: {
      origin: ORIGEN,
      cookie,
      'cio-org-id': ORG,
      ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {})
    },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo)
  });
}

async function json(metodo, ruta, cuerpo) {
  const res = await pedir(metodo, ruta, cuerpo);
  const texto = await res.text();

  if (!res.ok) throw new Error(`${metodo} ${ruta}: ${res.status} ${texto.slice(0, 300)}`);

  return JSON.parse(texto);
}

/** La fuente ficticia, como .docx: la subida no acepta texto plano. */
async function docxDe(markdown) {
  const parrafos = markdown
    .split(/\r?\n+/)
    .map((linea) => linea.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .map((linea) => linea.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .map((linea) => `<w:p><w:r><w:t xml:space="preserve">${linea}</w:t></w:r></w:p>`)
    .join('');

  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parrafos}</w:body></w:document>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}

// ── Una ronda, como la manda el panel ────────────────────────────────────────

const informe = { api: API, empezo: new Date().toISOString(), rondas: [], chequeos: [] };

/**
 * Manda UN mensaje (el contrato nuevo: la historia la tiene el servidor) y
 * arma la respuesta desde el stream, con el lector del SDK.
 */
async function ronda(estado, texto, metadata) {
  const mensaje = {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: texto }],
    ...(metadata ? { metadata } : {})
  };
  const cuerpo = {
    id: 'ai-assistant',
    trigger: 'submit-message',
    courseId: estado.curso,
    conversationId: estado.conversacion,
    message: mensaje,
    context: { locale: LOCALE }
  };
  const peso = Buffer.byteLength(JSON.stringify(cuerpo));
  const inicio = Date.now();
  const res = await pedir('POST', '/agent/chat', cuerpo);

  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const trozos = ai.parseJsonEventStream({ stream: res.body, schema: ai.uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(parte, control) {
        if (!parte.success) throw parte.error;
        control.enqueue(parte.value);
      }
    })
  );

  let respuesta;

  for await (const parcial of ai.readUIMessageStream({
    stream: trozos,
    onError: (error) => console.error('  [stream] parte que no se pudo aplicar:', error?.message ?? error)
  })) {
    respuesta = parcial;
  }

  if (!respuesta) throw new Error('la ronda no devolvió ningún mensaje');

  const segundos = Math.round((Date.now() - inicio) / 1000);
  const resumen = resumir(respuesta, segundos, peso);

  informe.rondas.push({ pedido: texto.slice(0, 200), ...resumen });
  console.log(
    `  ronda: ${segundos}s, ${resumen.llamadas} llamadas, pedido de ${peso} bytes` +
      (resumen.serverRun ? `, ${resumen.serverRun.segments} tramo(s), cierre: ${resumen.serverRun.stopReason ?? '—'}` : '')
  );

  return { mensaje: respuesta, peso, resumen };
}

function partesDeHerramienta(mensaje) {
  return (mensaje.parts ?? []).filter((parte) => typeof parte.type === 'string' && parte.type.startsWith('tool-'));
}

function resumir(mensaje, segundos, peso) {
  const herramientas = {};

  for (const parte of partesDeHerramienta(mensaje)) {
    const nombre = parte.type.slice(5);
    herramientas[nombre] = (herramientas[nombre] ?? 0) + 1;
  }

  const meta = mensaje.metadata ?? {};

  return {
    segundos,
    peso,
    llamadas: Object.values(herramientas).reduce((a, b) => a + b, 0),
    herramientas,
    serverRun: meta.serverRun,
    planProgress: meta.planProgress ? { completed: meta.planProgress.completed, total: meta.planProgress.total } : null,
    roundChanges: meta.roundChanges ?? [],
    unverifiedClaims: meta.unverifiedClaims ?? null,
    questionsToReview: meta.questionsToReview ?? [],
    continuation: meta.continuation ?? null,
    texto: (mensaje.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
      .slice(0, 1500)
  };
}

/** Cuántas veces la ronda reemplazó cada bloque con éxito. */
function reemplazosPorBloque(mensaje) {
  const cuenta = new Map();

  for (const parte of partesDeHerramienta(mensaje)) {
    if (parte.type !== 'tool-replace_lesson_block' || parte.output?.updated !== true) continue;

    const clave = `${parte.output.lessonId ?? parte.input?.lessonId}|${parte.input?.blockId}`;
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }

  return cuenta;
}

function chequear(escenario, descripcion, ok, detalle) {
  informe.chequeos.push({ escenario, descripcion, ok, ...(detalle !== undefined ? { detalle } : {}) });
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${escenario} — ${descripcion}${detalle !== undefined ? `: ${JSON.stringify(detalle)}` : ''}`);
}

// ── Lo que dice el curso, leído por la API ───────────────────────────────────

async function lecciones(curso) {
  const lista = (await json('GET', `/course/${curso}/lesson?courseId=${curso}`)).data ?? [];

  return Promise.all(
    lista.map(async (leccion) => {
      const completa = (await json('GET', `/course/${curso}/lesson/${leccion.id}`)).data;
      const contenido = (completa.lessonLanguages ?? []).find((idioma) => idioma.locale === LOCALE)?.content ?? '';

      return { id: leccion.id, title: completa.title, content: contenido };
    })
  );
}

const textoPlano = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizar = (texto) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

async function preguntasARevisar(curso) {
  return (await json('GET', `/agent/questions-to-review?courseId=${curso}&locale=${LOCALE}`)).data?.questions ?? [];
}

function ultimoPlan(mensaje) {
  for (const parte of partesDeHerramienta(mensaje)) {
    if (parte.type === 'tool-generate_course_plan' && parte.input?.plan) return parte.input.plan;
  }

  return null;
}

// ── Los escenarios ───────────────────────────────────────────────────────────

async function e1Construir(estado) {
  console.log('\nE1 — construir con una regla de la docente');

  const pedido =
    'Armá un curso corto para vendedores nuevos con el manual de mostrador que subí: 2 secciones de 2 lecciones cada una, ' +
    'y un examen final corto. Regla: no inventes una política de devoluciones ni descuentos; si el manual no lo dice, no lo pongas. ' +
    'No me hagas preguntas: armá el plan directamente.';

  let { mensaje } = await ronda(estado, pedido);
  let plan = ultimoPlan(mensaje);

  for (let intento = 0; !plan && intento < 2; intento += 1) {
    ({ mensaje } = await ronda(estado, 'Saltá las preguntas y armá el plan ahora, con lo que ya tenés.'));
    plan = ultimoPlan(mensaje);
  }

  chequear('E1', 'el asistente propuso un plan', !!plan);
  if (!plan) return false;

  const reglas = plan.teacherRules ?? [];

  chequear('E1', 'el plan trae la regla de la docente en teacherRules', reglas.some((regla) => UMBRAL.prohibido.test(regla)), reglas);

  const construccion = await ronda(estado, TEXTO_DE_APROBACION, { plan: { action: 'implement_course_plan', payload: plan } });
  const corrida = construccion.mensaje.metadata?.serverRun;
  const progreso = construccion.mensaje.metadata?.planProgress;

  chequear(
    'E1',
    'la construcción termina en una sola respuesta, con el plan completo',
    corrida?.stopReason === 'plan_completo' || (!!progreso && progreso.completed >= progreso.total && progreso.total > 0),
    { serverRun: corrida, planProgress: progreso && { completed: progreso.completed, total: progreso.total } }
  );

  const escritas = await lecciones(estado.curso);
  const conProhibido = escritas.filter((leccion) => UMBRAL.prohibido.test(textoPlano(leccion.content)));

  chequear('E1', 'ninguna lección habla de devoluciones ni descuentos', conProhibido.length === 0, conProhibido.map((l) => l.title));
  chequear('E1', 'se escribieron lecciones', escritas.filter((l) => textoPlano(l.content).length > 200).length >= 3, escritas.length);

  estado.lecciones = escritas;

  return true;
}

async function e2Corregir(estado) {
  console.log('\nE2 — corregir cuatro lecciones en un mensaje');

  const elegidas = (estado.lecciones ?? []).filter((l) => textoPlano(l.content).length > 200).slice(0, 4);

  if (elegidas.length < 4) {
    chequear('E2', 'hay cuatro lecciones para corregir', false, elegidas.length);
    return;
  }

  const pedido =
    'Necesito estas correcciones:\n' +
    elegidas
      .map(
        (leccion, i) =>
          `${i + 1}. En la lección «${leccion.title}», agregá al final un párrafo que empiece con «Para recordar:» y resuma la lección en una oración.`
      )
      .join('\n');

  const { mensaje } = await ronda(estado, pedido);
  const despues = await lecciones(estado.curso);
  const corregidas = elegidas.filter((leccion) => {
    const ahora = despues.find((l) => l.id === leccion.id);

    return ahora && normalizar(textoPlano(ahora.content)).includes('para recordar');
  });

  chequear('E2', 'las cuatro lecciones quedaron corregidas', corregidas.length === 4, corregidas.map((l) => l.title));

  const peor = Math.max(0, ...reemplazosPorBloque(mensaje).values());

  chequear('E2', `ningún bloque se reemplazó más de ${UMBRAL.reemplazosPorBloque} veces`, peor <= UMBRAL.reemplazosPorBloque, peor);
  chequear('E4', 'E2: el relato coincide con el registro', !mensaje.metadata?.unverifiedClaims, mensaje.metadata?.unverifiedClaims);

  estado.lecciones = despues;
}

async function e3Preguntas(estado) {
  console.log('\nE3 — cambiar una lección a mano y actualizar sus preguntas');

  const ejercicios = (await json('GET', `/course/${estado.curso}/exercise`)).data ?? [];
  let objetivo;

  // Una pregunta con evidencia cuya frase esté, tal cual, en un párrafo de una lección.
  buscar: for (const ejercicio of ejercicios) {
    const completo = (await json('GET', `/course/${estado.curso}/exercise/${ejercicio.id}`)).data;

    for (const pregunta of completo?.questions ?? []) {
      const evidencia = pregunta.settings?.evidence;

      if (typeof evidencia !== 'string' || evidencia.length < 20) continue;

      for (const leccion of estado.lecciones ?? []) {
        const bloque = [...leccion.content.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].find((m) =>
          normalizar(textoPlano(m[2])).includes(normalizar(evidencia.split(/…|\.\.\./)[0]).slice(0, 60))
        );

        if (bloque) {
          objetivo = { ejercicio: completo, pregunta, leccion, bloque: bloque[0], etiqueta: bloque[1] };
          break buscar;
        }
      }
    }
  }

  chequear('E3', 'hay una pregunta con su frase en una lección', !!objetivo);
  if (!objetivo) return;

  const nuevo = `<${objetivo.etiqueta}>Este paso cambió: ahora lo hace el encargado de depósito con la terminal de mano, y el vendedor sólo confirma en el sistema.</${objetivo.etiqueta}>`;
  const contenido = objetivo.leccion.content.replace(objetivo.bloque, nuevo);

  await json('POST', `/course/${estado.curso}/lesson/${objetivo.leccion.id}/language`, { locale: LOCALE, content: contenido });

  const marcadas = await preguntasARevisar(estado.curso);
  const marcada = marcadas.some((p) => String(p.questionId) === String(objetivo.pregunta.id));

  chequear('E3', 'cambiar la lección a mano deja la pregunta a revisar', marcada, objetivo.pregunta.title);
  if (!marcada) return;

  const { mensaje } = await ronda(
    estado,
    `Cambié la lección «${objetivo.leccion.title}»: un paso ahora lo hace el encargado de depósito con la terminal de mano. ` +
      'Actualizá las preguntas que quedaron desactualizadas.'
  );

  const despues = await preguntasARevisar(estado.curso);
  const sigue = despues.some((p) => String(p.questionId) === String(objetivo.pregunta.id));
  const registro = mensaje.metadata?.roundChanges ?? [];

  chequear('E3', 'la pregunta dejó de estar a revisar', !sigue, despues.map((p) => p.questionTitle));
  chequear('E3', 'el registro de la ronda dice que cambió preguntas', registro.some((l) => /preguntas/i.test(l)), registro);
  chequear('E4', 'E3: el relato coincide con el registro', !mensaje.metadata?.unverifiedClaims, mensaje.metadata?.unverifiedClaims);
}

// ── Corrida ──────────────────────────────────────────────────────────────────

await entrar();

/** Un curso nuevo con la fuente ficticia subida. */
async function cursoNuevo() {
  const curso = await json('POST', '/course', {
    title: `Escenarios del asistente ${new Date().toISOString().slice(0, 16)}`,
    description: 'Curso de prueba de los escenarios del asistente. No publicar.',
    type: 'SELF_PACED',
    organizationId: ORG
  });
  const cursoId = curso?.data?.id ?? curso?.data?.course?.id;

  if (!cursoId) throw new Error(`no se creó el curso: ${JSON.stringify(curso).slice(0, 300)}`);

  const conversacion = await json('POST', '/agent/history', { courseId: cursoId, title: 'Escenarios' });
  const nuevo = { curso: cursoId, conversacion: conversacion?.data?.id ?? conversacion?.id };

  const archivo = new FormData();
  archivo.append(
    'file',
    new Blob([await docxDe(readFileSync(join(AQUI, 'fuente-mostrador.md'), 'utf8'))], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }),
    'manual-de-mostrador.docx'
  );
  await json('POST', `/agent/upload?courseId=${cursoId}&conversationId=${nuevo.conversacion}`, archivo);

  return nuevo;
}

const reusar = opcion('reusar', 'EVAL_REUSAR', '');
const estado = reusar
  ? { curso: reusar.split(',')[0], conversacion: reusar.split(',')[1] }
  : await cursoNuevo();

informe.curso = estado.curso;
console.log(`curso ${estado.curso}, conversación ${estado.conversacion}${reusar ? ' (reusado)' : ''}`);

try {
  const construido = reusar ? ((estado.lecciones = await lecciones(estado.curso)), true) : await e1Construir(estado);

  if (construido) {
    await e2Corregir(estado);
    await e3Preguntas(estado);
  }
} catch (error) {
  chequear('—', 'la corrida terminó sin errores', false, String(error?.message ?? error));
}

const pesoMaximo = Math.max(0, ...informe.rondas.map((r) => r.peso));

chequear('E5', `ningún pedido pasó de ${UMBRAL.pesoDelPedido} bytes`, pesoMaximo <= UMBRAL.pesoDelPedido, pesoMaximo);

const fallas = informe.chequeos.filter((c) => !c.ok);
const salida = join(tmpdir(), `escenarios-agente-${Date.now()}.json`);

informe.termino = new Date().toISOString();
writeFileSync(salida, JSON.stringify(informe, null, 2));

console.log(`\n${informe.chequeos.length - fallas.length}/${informe.chequeos.length} chequeos OK. Informe: ${salida}`);
process.exit(fallas.length > 0 ? 1 : 0);
