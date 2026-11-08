/**
 * Lo que el modelo YA hizo en esta ronda, paso por paso, para que lo vea él.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Medido el 2026-11-03 en un curso de un cliente: un mensaje con correcciones para
 * doce lecciones terminó en 35 `replace_lesson_block` sobre los MISMOS tres
 * bloques de una lección (nueve veces cada uno, todos `updated: true`), con los
 * 40 pasos gastados y el resumen diciendo que esa lección seguía «pendiente».
 *
 * La causa no era el modelo solo. Dentro de la ronda, la poda borra las
 * llamadas viejas para que el contexto no crezca, y borraba justamente las
 * ediciones: sin rastro. En cambio conservaba la última LECTURA de cada lección
 * —que era de antes de editarla—. El modelo veía el texto viejo, no tenía
 * ninguna constancia de haberlo cambiado, y lo volvía a cambiar. El
 * razonamiento de los pasos anteriores también se poda, así que tampoco lo
 * recordaba por ahí.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * 1. Anota cada llamada que cambia el curso (paso, herramienta, pieza, bloque,
 *    si salió o la negaron) y cada lectura de una pieza.
 * 2. Arma una nota corta que `prepareStep` pone al final de cada paso: lo hecho,
 *    lo negado, y qué lecturas quedaron VENCIDAS porque la pieza se editó
 *    después. La nota reemplaza a la del paso anterior; no se acumula.
 * 3. Le dice a la poda qué lecturas ya no conviene conservar: una lectura
 *    vencida es contenido que ya no existe, y conservarla es invitar a rehacer.
 *
 * Es la misma idea que el registro de la ronda (`round-ledger.ts`), que ya le
 * muestra a la docente lo que cambió. La diferencia es para quién: aquel es
 * para la persona al final, éste es para el modelo mientras trabaja.
 */
import type { ModelMessage, ToolSet } from 'ai';

import { HERRAMIENTAS_DE_LECTURA } from '@api/services/agent/pasos-que-cambian';

/** Las lecturas que pueden quedar viejas: las que traen el texto de UNA pieza. */
const LECTURAS_DE_PIEZA: Readonly<Record<string, 'lessonId' | 'exerciseId'>> = {
  get_lesson_content: 'lessonId',
  get_exercise_details: 'exerciseId'
};

/** Con qué campo del pedido se nombra la pieza que una escritura toca. */
const CAMPOS_DE_PIEZA = ['lessonId', 'exerciseId', 'sectionId', 'target'] as const;

/**
 * El comienzo de la nota. Con esto se la reconoce para sacarla en el paso
 * siguiente: el SDK arrastra los mensajes que devuelve `prepareStep` (v7,
 * `stepMessagesForNextStep`), así que sin sacarla habría una por paso.
 */
export const ENCABEZADO_DE_LA_NOTA = '[Server log of this round';

/** Cuántas líneas de cambios entran en la nota. El resto se resume en una cuenta. */
export const MAX_LINEAS_DE_LA_NOTA = 40;

/**
 * Cuántas veces se puede reemplazar el mismo bloque en una ronda. El tercero se
 * niega (`replace_lesson_block`): dos alcanzan para corregir una corrección, y
 * el bucle medido llegaba a nueve.
 */
export const MAX_REEMPLAZOS_DEL_MISMO_BLOQUE = 2;

export interface Escritura {
  paso: number;
  herramienta: string;
  /** Las formas en que se nombró la pieza (manija del pedido, id resuelto), en mayúsculas. */
  claves: string[];
  /** Cómo se la muestra: la manija o el id que mandó el modelo. */
  pieza?: string;
  titulo?: string;
  bloque?: string;
  hecho: boolean;
  /** Por qué la negaron, recortado. */
  motivo?: string;
  /**
   * No se guardó: quedó PROPUESTA y espera a la docente (un ejercicio con
   * entregas, ver `cambios-con-entregas.ts`). Ni hecha ni negada.
   */
  propuesta?: true;
}

export interface Lectura {
  toolCallId: string;
  paso: number;
  claves: string[];
  pieza?: string;
  titulo?: string;
}

export interface BitacoraDeLaRonda {
  escrituras: Escritura[];
  lecturas: Lectura[];
}

export function bitacoraVacia(): BitacoraDeLaRonda {
  return { escrituras: [], lecturas: [] };
}

function comoTexto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

function comoObjeto(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined;
}

function recortar(texto: string, largo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();

  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
}

/**
 * Si la herramienta hizo lo que se le pidió, leído de su respuesta.
 *
 * Las herramientas no comparten forma: una falla es `{ ok: false, error }`
 * (`executeAgentTool`), y las negativas deliberadas dicen `updated: false`,
 * `generated: false` o traen `rejected`. Todo lo demás se cuenta como hecho.
 */
export function salioBien(resultado: unknown): { hecho: boolean; motivo?: string } {
  const objeto = comoObjeto(resultado);

  if (!objeto) return { hecho: true };

  const negada =
    objeto.ok === false ||
    objeto.updated === false ||
    objeto.generated === false ||
    objeto.saved === false ||
    objeto.rejected === true ||
    typeof objeto.rejected === 'string';

  if (!negada) return { hecho: true };

  const motivo = comoTexto(objeto.error) ?? comoTexto(objeto.note) ?? comoTexto(objeto.reason) ?? comoTexto(objeto.rejected);

  return { hecho: false, ...(motivo ? { motivo: recortar(motivo, 160) } : {}) };
}

/**
 * La pieza que nombra un pedido, en la forma en que la escribió el modelo, y
 * con qué campo la nombró.
 */
function piezaDelPedido(
  herramienta: string,
  entrada: Record<string, unknown> | undefined
): { valor?: string; campo?: string } {
  if (!entrada) return {};

  const campoDeLectura = LECTURAS_DE_PIEZA[herramienta];

  if (campoDeLectura) return { valor: comoTexto(entrada[campoDeLectura]), campo: 'id' };

  for (const campo of CAMPOS_DE_PIEZA) {
    const valor = comoTexto(entrada[campo]);

    if (valor) return { valor, campo };
  }

  return {};
}

/**
 * El id resuelto y el título, si la respuesta los trae.
 *
 * El id se busca en el MISMO campo con que se pidió la pieza: un ejercicio
 * atado a una lección trae también `lessonId`, y tomarlo daría por vencida la
 * lectura de la lección cuando lo que cambió fue el ejercicio.
 */
function piezaDeLaRespuesta(resultado: unknown, campo: string | undefined): { id?: string; titulo?: string } {
  const objeto = comoObjeto(resultado);

  if (!objeto) return {};

  const id =
    campo === 'target'
      ? (comoTexto(objeto.lessonId) ?? comoTexto(objeto.exerciseId))
      : campo && campo !== 'id'
        ? (comoTexto(objeto[campo]) ?? comoTexto(objeto.id))
        : comoTexto(objeto.id);
  const titulo = comoTexto(objeto.lessonTitle) ?? comoTexto(objeto.exerciseTitle) ?? comoTexto(objeto.title);

  return { ...(id ? { id } : {}), ...(titulo ? { titulo } : {}) };
}

function clavesDe(...valores: Array<string | undefined>): string[] {
  return [...new Set(valores.filter((valor): valor is string => !!valor).map((valor) => valor.toUpperCase()))];
}

/** Anota una llamada ya resuelta. Exportada para los tests y para quien no use el envoltorio. */
export function anotarLlamada(
  bitacora: BitacoraDeLaRonda,
  llamada: { paso: number; herramienta: string; toolCallId?: string; entrada: unknown; resultado: unknown }
): void {
  const entrada = comoObjeto(llamada.entrada);
  const { valor: pedida, campo } = piezaDelPedido(llamada.herramienta, entrada);
  const respuesta = piezaDeLaRespuesta(llamada.resultado, campo);

  if (LECTURAS_DE_PIEZA[llamada.herramienta]) {
    // Una lectura que falló no le dejó texto al modelo: no hay nada que pueda
    // quedar viejo.
    if (!llamada.toolCallId || !salioBien(llamada.resultado).hecho) return;

    bitacora.lecturas.push({
      toolCallId: llamada.toolCallId,
      paso: llamada.paso,
      claves: clavesDe(pedida, respuesta.id),
      ...(pedida ? { pieza: pedida } : {}),
      ...(respuesta.titulo ? { titulo: respuesta.titulo } : {})
    });

    return;
  }

  if (HERRAMIENTAS_DE_LECTURA.has(llamada.herramienta)) return;

  const bloque = comoTexto(entrada?.blockId);
  const comun = {
    paso: llamada.paso,
    herramienta: llamada.herramienta,
    claves: clavesDe(pedida, respuesta.id),
    ...(pedida ? { pieza: pedida } : {}),
    ...(respuesta.titulo ? { titulo: respuesta.titulo } : {}),
    ...(bloque ? { bloque } : {})
  };

  // Una propuesta no falló, pero tampoco guardó nada. Contada como hecha, la
  // nota se la listaba al modelo entre los «cambios ya guardados» y le pedía
  // informar como hecho lo guardado: medido en vivo (2026-11-08), contestó
  // «Listo, sumé las preguntas» sobre un examen que seguía igual.
  if (esPropuesta(llamada.resultado)) {
    bitacora.escrituras.push({ ...comun, hecho: false, propuesta: true });
    return;
  }

  const { hecho, motivo } = salioBien(llamada.resultado);

  bitacora.escrituras.push({ ...comun, hecho, ...(motivo ? { motivo } : {}) });
}

/** La respuesta de una herramienta que no escribió y dejó el cambio esperando a la docente. */
function esPropuesta(resultado: unknown): boolean {
  return comoObjeto(resultado)?.status === 'needs_teacher_approval';
}

/**
 * Envuelve las herramientas para que cada llamada quede anotada.
 *
 * `paso` se lee en el momento de la llamada: lo escribe `prepareStep` antes de
 * que corran las herramientas del paso.
 */
export function conBitacora(herramientas: ToolSet, bitacora: BitacoraDeLaRonda, paso: () => number): ToolSet {
  const envueltas: ToolSet = {};

  for (const [nombre, herramienta] of Object.entries(herramientas)) {
    const original = (herramienta as { execute?: (...args: never[]) => Promise<unknown> }).execute;

    if (typeof original !== 'function') {
      envueltas[nombre] = herramienta;
      continue;
    }

    envueltas[nombre] = {
      ...herramienta,
      execute: async (...args: never[]) => {
        const resultado = await original(...args);
        const opciones = comoObjeto(args[1] as unknown);

        anotarLlamada(bitacora, {
          paso: paso(),
          herramienta: nombre,
          toolCallId: comoTexto(opciones?.toolCallId),
          entrada: args[0],
          resultado
        });

        return resultado;
      }
    } as ToolSet[string];
  }

  return envueltas;
}

/** Las lecturas de una pieza que se editó con éxito DESPUÉS de leerla. */
export function lecturasVencidas(bitacora: BitacoraDeLaRonda): Lectura[] {
  return bitacora.lecturas.filter((lectura) =>
    bitacora.escrituras.some(
      (escritura) =>
        escritura.hecho &&
        escritura.paso > lectura.paso &&
        escritura.claves.some((clave) => lectura.claves.includes(clave))
    )
  );
}

/** Los `toolCallId` de las lecturas vencidas, para que la poda no las conserve. */
export function idsDeLecturasVencidas(bitacora: BitacoraDeLaRonda): Set<string> {
  return new Set(lecturasVencidas(bitacora).map((lectura) => lectura.toolCallId));
}

function nombreDePieza(registro: { pieza?: string; titulo?: string }): string {
  if (registro.pieza && registro.titulo) return `${registro.pieza} «${registro.titulo}»`;
  if (registro.titulo) return `«${registro.titulo}»`;

  return registro.pieza ?? '(no piece)';
}

interface Grupo {
  herramienta: string;
  pieza: string;
  pasos: number[];
  bloques: string[];
  motivo?: string;
}

/** Junta las llamadas de la misma herramienta sobre la misma pieza en una línea. */
function agrupar(escrituras: readonly Escritura[]): Grupo[] {
  const grupos = new Map<string, Grupo>();

  for (const escritura of escrituras) {
    const pieza = nombreDePieza(escritura);
    const clave = `${escritura.herramienta}|${escritura.claves[0] ?? pieza}`;
    const grupo = grupos.get(clave) ?? { herramienta: escritura.herramienta, pieza, pasos: [], bloques: [] };

    grupo.pasos.push(escritura.paso);
    if (escritura.bloque && !grupo.bloques.includes(escritura.bloque)) grupo.bloques.push(escritura.bloque);
    if (escritura.motivo) grupo.motivo = escritura.motivo;

    grupos.set(clave, grupo);
  }

  return [...grupos.values()];
}

function lineaDeGrupo(grupo: Grupo): string {
  const pasos = grupo.pasos.length > 1 ? `steps ${grupo.pasos.join(', ')}` : `step ${grupo.pasos[0]}`;
  const veces = grupo.pasos.length > 1 ? ` ×${grupo.pasos.length}` : '';
  const bloques = grupo.bloques.length > 0 ? ` · block${grupo.bloques.length > 1 ? 's' : ''} ${grupo.bloques.join(', ')}` : '';
  const motivo = grupo.motivo ? ` — ${grupo.motivo}` : '';

  return `- ${pasos} · ${grupo.herramienta}${veces} · ${grupo.pieza}${bloques}${motivo}`;
}

function lineasConTope(lineas: string[], tope: number): string[] {
  if (lineas.length <= tope) return lineas;

  const ocultas = lineas.length - tope;

  return [`- (${ocultas} earlier line${ocultas > 1 ? 's' : ''} not shown)`, ...lineas.slice(-tope)];
}

/**
 * La nota del paso, o nada si la ronda todavía no cambió ni negó nada.
 *
 * En inglés como el resto de lo que lee el modelo; la respuesta a la docente
 * sale en su idioma igual.
 */
export function notaDeLaBitacora(
  bitacora: BitacoraDeLaRonda,
  extra: {
    /** El avance del plan medido después del último cambio (construcción). */
    avanceDelPlan?: string;
    /** Preguntas cuya evidencia desapareció de las lecciones. */
    preguntasARevisar?: readonly string[];
    /**
     * Cómo quedaron los cambios con entregas propuestos en rondas anteriores
     * (`avisoDePropuestas`). Va acá, al final de los mensajes, y no en el
     * contexto de arriba: más abajo la conversación todavía tiene el resultado
     * viejo «NOTHING WAS SAVED», y el modelo le creía a lo más reciente
     * (medido en vivo: aprobada y aplicada, contestó «todavía no se agregaron»).
     */
    propuestasAnteriores?: string;
  } = {}
): string | undefined {
  const hechas = agrupar(bitacora.escrituras.filter((escritura) => escritura.hecho));
  const negadas = agrupar(bitacora.escrituras.filter((escritura) => !escritura.hecho && !escritura.propuesta));
  const propuestas = agrupar(bitacora.escrituras.filter((escritura) => escritura.propuesta));
  const vencidas = lecturasVencidas(bitacora);
  const preguntas = extra.preguntasARevisar ?? [];

  if (
    hechas.length === 0 &&
    negadas.length === 0 &&
    propuestas.length === 0 &&
    preguntas.length === 0 &&
    !extra.avanceDelPlan &&
    !extra.propuestasAnteriores
  ) {
    return undefined;
  }

  const partes: string[] = [
    `${ENCABEZADO_DE_LA_NOTA} — written by the server, not by the teacher. It is not a new request: keep working on what the teacher asked.]`
  ];

  if (hechas.length > 0) {
    partes.push(
      'Changes ALREADY saved in this round (do not redo them; a result with `updated: true` was a finished change):',
      ...lineasConTope(hechas.map(lineaDeGrupo), MAX_LINEAS_DE_LA_NOTA)
    );
  } else {
    partes.push('No change has been saved yet in this round.');
  }

  if (propuestas.length > 0) {
    partes.push(
      'PROPOSED and NOT saved — students already submitted these exercises, so each change waits for the teacher, who approves or cancels it on a card in the chat:',
      ...lineasConTope(propuestas.map(lineaDeGrupo), Math.ceil(MAX_LINEAS_DE_LA_NOTA / 2)),
      'In your reply, tell her it waits for her approval on the card. Never say it is done or "listo", and never save it another way.'
    );
  }

  if (negadas.length > 0) {
    partes.push(
      'Refused or failed (fix the cause, or move on; repeating the same call returns the same refusal):',
      ...lineasConTope(negadas.map(lineaDeGrupo), Math.ceil(MAX_LINEAS_DE_LA_NOTA / 2))
    );
  }

  if (extra.propuestasAnteriores) partes.push(extra.propuestasAnteriores);

  if (vencidas.length > 0) {
    const piezas = [...new Set(vencidas.map((lectura) => nombreDePieza(lectura)))];

    partes.push(
      `Outdated reads: ${piezas.join('; ')} — you changed ${piezas.length > 1 ? 'them' : 'it'} after reading. ` +
        'The old text was removed from your context because it no longer exists. Read again only if you still have to change something there.'
    );
  }

  if (preguntas.length > 0) {
    partes.push(
      'Questions to review — a change in this round removed the lesson sentence each one was based on, so its answer may now be wrong:',
      ...lineasConTope(
        preguntas.map((pregunta) => `- ${pregunta}`),
        15
      ),
      'Tell the teacher about them in your reply. Update them (from what the lesson says now) only if the teacher asked for question changes.'
    );
  }

  if (extra.avanceDelPlan) partes.push(extra.avanceDelPlan);

  partes.push('When you write your closing reply, report as done only what this log lists as saved.');

  return partes.join('\n');
}

function textoDelMensaje(mensaje: ModelMessage): string {
  if (typeof mensaje.content === 'string') return mensaje.content;

  const primera = (mensaje.content as Array<{ type?: string; text?: string }>)[0];

  return primera?.type === 'text' && typeof primera.text === 'string' ? primera.text : '';
}

export function esNotaDeLaBitacora(mensaje: ModelMessage): boolean {
  return mensaje.role === 'user' && textoDelMensaje(mensaje).startsWith(ENCABEZADO_DE_LA_NOTA);
}

/**
 * Los mensajes del paso con la nota nueva al final y sin las anteriores.
 *
 * Al final y no adelante: lo que va adelante es el prefijo que el proveedor
 * cachea, y la nota cambia en cada paso.
 */
export function conNotaDelPaso(mensajes: ModelMessage[], nota: string | undefined): ModelMessage[] {
  const sinViejas = mensajes.filter((mensaje) => !esNotaDeLaBitacora(mensaje));

  if (nota) return [...sinViejas, { role: 'user', content: nota }];

  // Sin nota nueva ni vieja, los mismos mensajes: quien llama sabe así que no
  // hay nada que devolverle al SDK.
  return sinViejas.length === mensajes.length ? mensajes : sinViejas;
}
