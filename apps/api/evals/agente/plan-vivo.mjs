/**
 * El plan vivo y los cambios que tocan notas, contra una API de verdad (con el
 * modelo de verdad). Ver DISEÑO-7.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Los tests de la ruta prueban que el servidor arma bien el contexto, guarda
 * bien la enmienda y no escribe sobre un ejercicio con entregas. Lo que no
 * pueden probar es si el MODELO, con ese contexto, hace lo que corresponde:
 * si llama a `update_plan` cuando la docente cambia de idea a mitad de la
 * construcción, si deja de «alinear» el curso a un plan ya terminado, y si dice
 * «espera tu aprobación» en vez de «listo» cuando el cambio quedó propuesto.
 *
 * ── Los casos ────────────────────────────────────────────────────────────────
 *
 * V1  A mitad de la construcción («Detener»), la docente saca una lección y
 *     cambia el examen. El modelo enmienda el plan con sus palabras, construye
 *     el resto sin la lección sacada, y el plan se cierra.
 * V2  Con el plan terminado, alguien achica el examen a mano. Un pedido chico
 *     sobre el examen no lo vuelve a completar según el plan viejo.
 * V3  El examen tiene entregas: agregarle preguntas queda propuesto (no se
 *     escribe), la docente lo aprueba y se aplica; borrarlo queda propuesto y
 *     se cancela. La ronda siguiente se entera.
 * V4  La auditoría registra lo que escribió el asistente, y el resumen de la
 *     ronda dice cuántas preguntas agregó.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   node apps/api/evals/agente/plan-vivo.mjs --org <id> [--solo V1,V2]
 *
 * Las mismas opciones de conexión que `casos-limite.mjs`. Lee y escribe la base
 * local por `docker exec <contenedor> psql` (`--pg cio-postgres`) para insertar
 * entregas de prueba y leer la auditoría. Crea un curso de prueba y no lo
 * borra. Sólo contra una API local.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const CONTENEDOR_PG = opcion('pg', 'EVAL_PG_CONTAINER', 'cio-postgres');
const LOCALE = 'es';

if (!ORG) {
  console.error('Falta --org <id de la empresa> (o EVAL_ORG_ID).');
  process.exit(2);
}

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(API)) {
  console.error(`Esto corre sólo contra una API local (${API}).`);
  process.exit(2);
}

const TEXTO_DE_APROBACION = 'Construí el curso según el plan aprobado.';
const TEXTO_DE_CONTINUACION = 'Seguí construyendo el plan desde donde quedó.';

// ── Base local ───────────────────────────────────────────────────────────────

/** Una consulta a la base local; devuelve las filas como texto separado por «|». */
function sql(consulta) {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR_PG, 'psql', '-U', 'postgres', '-d', 'classroomio', '-tA', '-v', 'ON_ERROR_STOP=1'], {
    input: consulta,
    encoding: 'utf8'
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

// ── Cliente ──────────────────────────────────────────────────────────────────

let cookie = '';

async function entrar() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGEN },
    body: JSON.stringify({ email: EMAIL, password: CLAVE })
  });

  if (!res.ok) throw new Error(`no se pudo entrar como ${EMAIL}: ${res.status}`);

  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function pedir(metodo, ruta, cuerpo, { senal } = {}) {
  const esForm = cuerpo instanceof FormData;

  return fetch(API + ruta, {
    method: metodo,
    signal: senal,
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

// ── Informe ──────────────────────────────────────────────────────────────────

const informe = { api: API, empezo: new Date().toISOString(), chequeos: [], rondas: [] };

function chequear(caso, descripcion, ok, detalle) {
  informe.chequeos.push({ caso, descripcion, ok, ...(detalle !== undefined ? { detalle } : {}) });
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${caso} — ${descripcion}${detalle !== undefined ? `: ${JSON.stringify(detalle)}` : ''}`);
}

// ── Un pedido al chat ────────────────────────────────────────────────────────

/** Manda un mensaje como el panel y lee el stream hasta el final (o «Detener»). */
async function enviar(estado, opciones = {}) {
  const mensaje = {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: opciones.texto ?? '' }],
    ...(opciones.metadata ? { metadata: opciones.metadata } : {})
  };
  const cuerpo = {
    id: 'ai-assistant',
    trigger: 'submit-message',
    courseId: estado.curso,
    conversationId: estado.conversacion,
    context: { locale: LOCALE },
    message: mensaje
  };
  const inicio = Date.now();
  const res = await pedir('POST', '/agent/chat', cuerpo);

  if (!res.ok) return { status: res.status, error: await res.json().catch(() => null) };

  const partes = [];
  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let pendiente = '';
  let detenido = false;

  while (true) {
    const { done, value } = await lector.read();

    if (done) break;

    pendiente += decodificador.decode(value, { stream: true });

    let corte = pendiente.indexOf('\n\n');

    while (corte >= 0) {
      const evento = pendiente.slice(0, corte).trim();
      pendiente = pendiente.slice(corte + 2);
      corte = pendiente.indexOf('\n\n');

      const datos = evento.startsWith('data:') ? evento.slice(5).trim() : '';

      if (!datos || datos === '[DONE]') continue;

      const parte = JSON.parse(datos);
      partes.push(parte);

      if (!detenido && opciones.alVer?.(parte, partes) === 'detener') {
        detenido = true;
        const parada = await pedir('POST', '/agent/chat/stop', { courseId: estado.curso, conversationId: estado.conversacion });
        console.log(`  «Detener» → ${parada.status} ${JSON.stringify((await parada.json()).data ?? {})}`);
      }
    }
  }

  const respuesta = (await historia(estado)).at(-1);
  const ronda = {
    pedido: opciones.texto,
    segundos: Math.round((Date.now() - inicio) / 1000),
    herramientas: herramientasDe(respuesta).map((h) => h.nombre),
    texto: textoDe(respuesta).slice(0, 1200),
    serverRun: respuesta?.metadata?.serverRun,
    roundChanges: respuesta?.metadata?.roundChanges
  };

  informe.rondas.push(ronda);
  console.log(`  ronda «${String(opciones.texto).slice(0, 60)}» (${ronda.segundos} s): ${ronda.herramientas.join(', ') || 'sin herramientas'}`);

  return { status: res.status, detenido, respuesta };
}

async function historia(estado) {
  return (await json('GET', `/agent/history/${estado.conversacion}`)).data?.messages ?? [];
}

function herramientasDe(mensaje) {
  return (mensaje?.parts ?? [])
    .filter((parte) => typeof parte.type === 'string' && parte.type.startsWith('tool-'))
    .map((parte) => ({ nombre: parte.type.slice(5), input: parte.input, output: parte.output, estado: parte.state }));
}

const textoDe = (mensaje) =>
  (mensaje?.parts ?? [])
    .filter((parte) => parte.type === 'text')
    .map((parte) => parte.text)
    .join('\n');

function planDe(mensaje) {
  for (const parte of mensaje?.parts ?? []) {
    if (parte.type === 'tool-generate_course_plan' && parte.input?.plan) return parte.input.plan;
  }

  return null;
}

const listar = async (ruta) => (await json('GET', ruta)).data ?? [];
const lecciones = (curso) => listar(`/course/${curso}/lesson?courseId=${curso}`);
const ejercicios = (curso) => listar(`/course/${curso}/exercise`);
const ejercicio = async (curso, id) => (await json('GET', `/course/${curso}/exercise/${id}`)).data;

async function cursoNuevo(titulo) {
  const curso = await json('POST', '/course', {
    title: `${titulo} ${new Date().toISOString().slice(0, 16)}`,
    description: 'Curso de prueba del plan vivo del asistente. No publicar.',
    type: 'SELF_PACED',
    organizationId: ORG
  });
  const cursoId = curso?.data?.id ?? curso?.data?.course?.id;
  const conversacion = await json('POST', '/agent/history', { courseId: cursoId, title: 'Plan vivo' });
  const nuevo = { curso: cursoId, conversacion: conversacion?.data?.id };
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

async function pedirPlan(estado, pedido) {
  await enviar(estado, { texto: pedido });

  for (let intento = 0; intento < 3; intento += 1) {
    const plan = planDe((await historia(estado)).at(-1));

    if (plan) return plan;

    await enviar(estado, { texto: 'Saltá las preguntas y armá el plan ahora, con lo que ya tenés.' });
  }

  return null;
}

const ESCRITURAS = /^(write_lesson|create_lesson|create_exercise|write_questions|add_questions)$/;

/** El examen final: el ejercicio con «examen» o «final» en el título, o el último. */
async function examenDe(curso) {
  const lista = await ejercicios(curso);
  const examen = lista.find((e) => /examen|final|evaluaci[oó]n/i.test(e.title ?? '')) ?? lista.at(-1);

  return examen ? ejercicio(curso, examen.id) : null;
}

const terminoElPlan = (mensaje) => {
  const progreso = mensaje?.metadata?.planProgress;

  return (
    mensaje?.metadata?.serverRun?.stopReason === 'plan_completo' ||
    (!!progreso && progreso.pendingCount === 0 && (progreso.emptyCount ?? 0) === 0 && progreso.total > 0)
  );
};

// ── Los casos ────────────────────────────────────────────────────────────────

async function v1EnmiendaAMitad(estado) {
  console.log('\nV1 — la docente cambia el plan a mitad de la construcción');

  const plan = await pedirPlan(
    estado,
    'Armá un curso corto con el manual de mostrador que subí: 2 secciones de 2 lecciones cada una, y al final un examen final ' +
      'de 4 preguntas sobre todo el curso. No me hagas preguntas: armá el plan directamente.'
  );
  chequear('V1', 'hay plan', !!plan);
  if (!plan) return null;

  const seccion2 = plan.sections?.[1];
  const leccionASacar = seccion2?.items?.filter((item) => item.type === 'lesson').at(-1);
  const seccion1 = plan.sections?.[0];

  console.log(`  la lección a sacar: «${leccionASacar?.title}»`);

  const corrida = await enviar(estado, {
    texto: TEXTO_DE_APROBACION,
    metadata: { plan: { action: 'implement_course_plan', payload: plan } },
    alVer: (parte, partes) =>
      parte.type === 'tool-output-available' &&
      partes.some((p) => p.type === 'tool-input-available' && ESCRITURAS.test(p.toolName))
        ? 'detener'
        : undefined
  });

  chequear('V1', '«Detener» llegó a mitad de la construcción', corrida.detenido && !terminoElPlan(corrida.respuesta), {
    serverRun: corrida.respuesta?.metadata?.serverRun
  });

  const pedido =
    `Cambio de planes: la lección «${leccionASacar?.title}» no la hagas, sacala del plan. ` +
    `Y el examen final que sea sólo sobre la sección «${seccion1?.title}», nada de la otra sección.`;
  let ronda = await enviar(estado, { texto: pedido });
  const enmiendas = herramientasDe(ronda.respuesta).filter((h) => h.nombre === 'update_plan');
  const aplicadas = enmiendas.flatMap((h) => h.output?.updated ?? []);

  chequear('V1', 'el modelo enmendó el plan con update_plan', aplicadas.length > 0, enmiendas.map((h) => ({ input: h.input, output: h.output })));
  chequear(
    'V1',
    'sacó la lección',
    aplicadas.some((cambio) => cambio.action === 'remove' && cambio.title === leccionASacar?.title),
    aplicadas
  );
  chequear(
    'V1',
    'y cambió el examen',
    aplicadas.some((cambio) => cambio.action === 'change' && /examen|final|evaluaci/i.test(cambio.title)),
    aplicadas
  );

  if (!terminoElPlan(ronda.respuesta)) {
    ronda = await enviar(estado, { texto: TEXTO_DE_CONTINUACION });
  }

  const progreso = ronda.respuesta?.metadata?.planProgress;
  const quitados = (progreso?.items ?? []).filter((item) => item.status === 'removed');
  const titulos = (await lecciones(estado.curso)).map((l) => l.title);

  chequear('V1', 'el plan quedó terminado', terminoElPlan(ronda.respuesta), {
    serverRun: ronda.respuesta?.metadata?.serverRun,
    progreso: progreso && { completed: progreso.completed, total: progreso.total, pendientes: progreso.pendingCount }
  });
  chequear('V1', 'el progreso muestra la lección como quitada', quitados.some((item) => item.title === leccionASacar?.title), quitados.map((i) => i.title));
  chequear('V1', 'la lección sacada no se construyó', !titulos.includes(leccionASacar?.title), titulos);
  chequear('V1', 'quedaron 3 lecciones', titulos.length === 3, titulos.length);

  const cierre = sql(
    `SELECT s.input->>'huella' FROM ai_agent_run_step s JOIN ai_agent_run r ON r.id = s.run_id ` +
      `WHERE r.conversation_id = '${estado.conversacion}' AND s.step_type = 'plan_cierre' AND s.status = 'completed';`
  );
  chequear('V1', 'el servidor guardó el cierre del plan', cierre.length === 1, cierre);

  const examen = await examenDe(estado.curso);
  informe.examenV1 = examen && { titulo: examen.title, preguntas: (examen.questions ?? []).map((q) => q.title ?? q.question) };
  chequear('V1', 'hay examen final con preguntas', (examen?.questions ?? []).length > 0, informe.examenV1);

  return { plan, seccion1 };
}

async function v2PlanTerminado(estado) {
  console.log('\nV2 — el plan terminado no vuelve como orden');

  const examen = await examenDe(estado.curso);
  const preguntas = examen?.questions ?? [];

  if (preguntas.length < 2) {
    chequear('V2', 'el examen tiene al menos 2 preguntas para achicarlo', false, preguntas.length);
    return;
  }

  // Alguien lo achica a mano (o desde otra conversación): queda 1 pregunta.
  await json('PUT', `/course/${estado.curso}/exercise/${examen.id}`, {
    questions: preguntas.slice(1).map((q) => ({ id: q.id, question: q.question ?? q.title, deletedAt: new Date().toISOString() }))
  });

  const achicado = await ejercicio(estado.curso, examen.id);
  const tituloAntes = achicado.title;
  const cuantasAntes = (achicado.questions ?? []).length;

  const ronda = await enviar(estado, {
    texto: `Revisá la pregunta del examen final: ¿está bien redactada? Si tiene algún error, corregila.`
  });
  const despues = await ejercicio(estado.curso, examen.id);
  const escribio = herramientasDe(ronda.respuesta).filter((h) => /^(write_questions|add_questions|create_exercise|write_lesson|create_lesson)$/.test(h.nombre));

  chequear('V2', 'el examen achicado tiene 1 pregunta', cuantasAntes === 1, cuantasAntes);
  chequear('V2', 'no agregó preguntas para «completar» el plan', (despues.questions ?? []).length === cuantasAntes, {
    antes: cuantasAntes,
    despues: (despues.questions ?? []).length
  });
  chequear('V2', 'ni construyó nada', escribio.length === 0, escribio.map((h) => h.nombre));
  chequear('V2', 'el título del examen sigue igual', despues.title === tituloAntes, { antes: tituloAntes, despues: despues.title });
  chequear('V2', 'la ronda no se presenta como construcción del plan', !ronda.respuesta?.metadata?.planProgress || terminoElPlan(ronda.respuesta), ronda.respuesta?.metadata?.serverRun);
}

async function v3CambiosConEntregas(estado) {
  console.log('\nV3 — cambios a un examen que ya tiene entregas');

  const examen = await examenDe(estado.curso);

  if (!examen) {
    chequear('V3', 'hay examen', false);
    return;
  }

  // Tres entregas de prueba, sin alumnos (submitted_by admite null), con notas
  // que caben en el máximo del examen de hoy.
  const maximo = (examen.questions ?? []).reduce((suma, q) => suma + Number(q.points ?? 0), 0);

  sql(
    [0.7, 0.9, 1]
      .map(
        (fraccion) =>
          `INSERT INTO submission (exercise_id, course_id, total, status_id, grading_state, overall_status) ` +
          `VALUES ('${examen.id}', '${estado.curso}', ${Math.round(maximo * fraccion)}, 3, 'graded', 'graded');`
      )
      .join('\n')
  );

  const cuantasAntes = (examen.questions ?? []).length;
  const ronda = await enviar(estado, { texto: 'Agregale al examen final 2 preguntas más sobre la otra sección del curso.' });
  const propuestas = herramientasDe(ronda.respuesta).filter((h) => h.output?.status === 'needs_teacher_approval');
  const sinPropuesta = (await ejercicio(estado.curso, examen.id)).questions ?? [];
  const texto = textoDe(ronda.respuesta);

  chequear('V3', 'el cambio quedó propuesto, no escrito', propuestas.length > 0 && sinPropuesta.length === cuantasAntes, {
    herramientas: herramientasDe(ronda.respuesta).map((h) => `${h.nombre}:${h.output?.status ?? (h.output?.error ? 'error' : 'ok')}`),
    preguntas: { antes: cuantasAntes, despues: sinPropuesta.length }
  });
  chequear('V3', 'con el efecto en las notas', propuestas[0]?.output?.impact?.entregas === 3, propuestas[0]?.output?.impact);
  chequear(
    'V3',
    'el modelo dice que espera la aprobación (no «listo»)',
    /aprob|confirm|esper/i.test(texto) && !/^\s*(listo|¡listo)/i.test(texto),
    texto.slice(0, 400)
  );

  const propuesta = propuestas.at(-1)?.output;

  if (!propuesta) return;

  const leida = await json('GET', `/agent/proposals/${propuesta.proposalId}?courseId=${estado.curso}`);
  chequear('V3', 'la propuesta está pendiente', leida.data?.estado === 'pendiente', leida.data);

  const aprobada = await json('POST', `/agent/proposals/${propuesta.proposalId}/resolve`, { courseId: estado.curso, decision: 'approve' });
  const conPropuesta = (await ejercicio(estado.curso, examen.id)).questions ?? [];

  chequear('V3', 'aprobada, se aplica', aprobada.data?.estado === 'aplicada', aprobada.data);
  chequear('V3', 'y el examen tiene las preguntas nuevas', conPropuesta.length === cuantasAntes + (propuesta.impact?.agregadas?.cantidad ?? 2), {
    antes: cuantasAntes,
    despues: conPropuesta.length
  });

  const otraVez = await json('POST', `/agent/proposals/${propuesta.proposalId}/resolve`, { courseId: estado.curso, decision: 'approve' });
  chequear('V3', 'aprobarla otra vez no la aplica de nuevo', ((await ejercicio(estado.curso, examen.id)).questions ?? []).length === conPropuesta.length, otraVez.data);

  const enterada = await enviar(estado, { texto: '¿Quedaron agregadas las preguntas al examen? Contestá en una línea.' });
  chequear('V3', 'la ronda siguiente sabe que se aplicó', /s[ií]|quedaron|agregad|aplicad/i.test(textoDe(enterada.respuesta)), textoDe(enterada.respuesta).slice(0, 300));

  // Borrar el examen: propuesto y cancelado.
  const borrar = await enviar(estado, { texto: 'Borrá el examen final entero.' });
  const propuestaDeBorrar = herramientasDe(borrar.respuesta).find((h) => h.output?.status === 'needs_teacher_approval')?.output;

  chequear('V3', 'borrar un examen con entregas queda propuesto', !!propuestaDeBorrar && propuestaDeBorrar.impact?.tipo === 'borrar', {
    herramientas: herramientasDe(borrar.respuesta).map((h) => `${h.nombre}:${h.output?.status ?? 'ok'}`)
  });

  if (propuestaDeBorrar) {
    const cancelada = await json('POST', `/agent/proposals/${propuestaDeBorrar.proposalId}/resolve`, { courseId: estado.curso, decision: 'cancel' });
    const sigue = (await ejercicios(estado.curso)).some((e) => e.id === examen.id);

    chequear('V3', 'cancelada, el examen sigue', cancelada.data?.estado === 'cancelada' && sigue, cancelada.data);
  }
}

function v4Auditoria(estado) {
  console.log('\nV4 — auditoría y resumen de la ronda');

  const acciones = sql(
    `SELECT action, count(*) FROM audit_event WHERE metadata->>'courseId' = '${estado.curso}' OR entity_id = '${estado.curso}' ` +
      `GROUP BY action ORDER BY action;`
  );
  const tiene = (accion) => acciones.some((fila) => fila.startsWith(`${accion}|`));

  informe.auditoria = acciones;
  chequear('V4', 'quedó registrado lo que escribió el asistente', acciones.some((fila) => fila.startsWith('ASISTENTE_')), acciones);
  chequear('V4', 'la enmienda del plan', tiene('ASISTENTE_SACO_DEL_PLAN') || tiene('ASISTENTE_CAMBIO_EL_PLAN'), acciones);
  chequear('V4', 'la propuesta y su resolución', tiene('ASISTENTE_PROPUSO_CAMBIO_CON_ENTREGAS') && tiene('APROBO_CAMBIO_DEL_ASISTENTE') && tiene('CANCELO_CAMBIO_DEL_ASISTENTE'), acciones);

  const conPreguntas = informe.rondas.flatMap((r) => r.roundChanges ?? []).filter((linea) => /agregó \d+ pregunta/.test(linea));
  chequear('V4', 'el resumen de la ronda dice cuántas preguntas agregó', conPreguntas.length > 0, conPreguntas.slice(0, 3));
}

// ── Corrida ──────────────────────────────────────────────────────────────────

await entrar();

const solo = opcion('solo', 'EVAL_SOLO', '');
const corre = (caso) => !solo || solo.split(',').includes(caso);
const existente = opcion('curso', 'EVAL_CURSO', '');
const estado = existente
  ? { curso: existente, conversacion: opcion('conversacion', 'EVAL_CONVERSACION', '') }
  : await cursoNuevo('Plan vivo');

informe.curso = estado.curso;
informe.conversacion = estado.conversacion;
console.log(`curso ${estado.curso}, conversación ${estado.conversacion}`);

try {
  if (corre('V1')) await v1EnmiendaAMitad(estado);
  if (corre('V2')) await v2PlanTerminado(estado);
  if (corre('V3')) await v3CambiosConEntregas(estado);
  if (corre('V4')) v4Auditoria(estado);
} catch (error) {
  chequear('—', 'la corrida terminó sin errores', false, String(error?.stack ?? error));
}

const fallas = informe.chequeos.filter((c) => !c.ok);
const salida = join(tmpdir(), `plan-vivo-agente-${Date.now()}.json`);

informe.termino = new Date().toISOString();
writeFileSync(salida, JSON.stringify(informe, null, 2));

console.log(`\n${informe.chequeos.length - fallas.length}/${informe.chequeos.length} chequeos OK. Informe: ${salida}`);
process.exit(fallas.length > 0 ? 1 : 0);
