/**
 * Manijas cortas para las piezas del curso: `S2`, `S2.L3`, `S2.E1`, `S2.E1.B2`.
 *
 * ── Por qué existen ──────────────────────────────────────────────────────────
 *
 * Medido en dos días de pruebas (2026-09-21 y 22): el modelo inventó seis
 * UUIDs —tres de ejercicios, dos de lecciones, uno de sección— y cada uno le
 * costó una vuelta de herramienta, un `get_course_structure` más, y en una ronda
 * el hilo entero: después del tercer id inventado reescribió dos lecciones que
 * ya había reescrito. Las herramientas lo frenaban, pero frenar no es lo mismo
 * que no fallar.
 *
 * Un UUID de treinta y seis caracteres es algo que el modelo tiene que COPIAR
 * de un resultado que el recorte de contexto ya le sacó de la vista. Una manija
 * de cinco caracteres es algo que puede DERIVAR de la estructura del curso, que
 * es como la nombraría una persona: «sección 2, lección 3». Lo que no hay que
 * copiar no se puede copiar mal.
 *
 * ── Cómo se resuelven ────────────────────────────────────────────────────────
 *
 * Son POSICIONALES y se resuelven contra el curso vivo en el momento de la
 * llamada: `S2.L3` es la tercera lección, por `order`, de la segunda sección,
 * por `order`. No hay tabla ni estado nuevo: `get_course_structure` las calcula
 * con la misma función que las resuelve, así que lo que el modelo lee y lo que
 * el servidor entiende no pueden divergir. Construir agrega al final y no mueve
 * a nadie; lo único que las corre es `reorder_content`, y ahí el resultado le
 * dice al modelo que vuelva a leer la estructura.
 *
 * Los UUIDs siguen valiendo en todas partes: una manija es una forma más de
 * nombrar la misma fila, no un reemplazo del id.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `S2`, `S2.L3`, `S2.E1`, `S2.E1.B2`, y las sueltas sin sección: `L3`, `E1`. */
const MANIJA = /^(?:S(\d+))?(?:\.?(L|E)(\d+))?(?:\.B(\d+))?$/i;

export type TipoDeManija = 'section' | 'lesson' | 'exercise' | 'block';

export interface ManijaLeida {
  seccion?: number;
  tipo: TipoDeManija;
  numero?: number;
  bloque?: number;
}

export function esUuid(valor: string): boolean {
  return UUID.test(valor.trim());
}

/** Lee una manija. `undefined` si el texto no tiene esa forma. */
export function leerManija(valor: string): ManijaLeida | undefined {
  const m = valor.trim().match(MANIJA);

  if (!m) return undefined;

  const [, seccion, letra, numero, bloque] = m;

  if (!seccion && !letra) return undefined;

  if (bloque) {
    if (letra?.toUpperCase() !== 'E') return undefined;

    return {
      seccion: seccion ? Number(seccion) : undefined,
      tipo: 'block',
      numero: Number(numero),
      bloque: Number(bloque)
    };
  }

  if (!letra) return { seccion: Number(seccion), tipo: 'section' };

  return {
    seccion: seccion ? Number(seccion) : undefined,
    tipo: letra.toUpperCase() === 'L' ? 'lesson' : 'exercise',
    numero: Number(numero)
  };
}

export function esManija(valor: string): boolean {
  return leerManija(valor) !== undefined;
}

/** Lo mínimo de una sección para ordenarla. */
export interface SeccionParaMapa {
  id: string;
  title: string | null;
  order?: number | null;
  createdAt?: string | null;
}

/** Lo mínimo de un ítem de `getCourseContentItems` para ubicarlo. */
export interface ItemParaMapa {
  id: string;
  type: string;
  title: string | null;
  order?: number | null;
  createdAt?: string | null;
  sectionId: string | null;
  isUnlocked?: boolean | null;
  hasNoteContent?: boolean | null;
  hasSlideContent?: boolean | null;
  videosCount?: number | null;
  questionCount?: number | null;
}

export interface PiezaMapeada {
  manija: string;
  id: string;
  title: string;
  order: number | null;
}

export interface LeccionMapeada extends PiezaMapeada {
  hasContent: boolean;
  unlocked: boolean;
}

export interface EjercicioMapeado extends PiezaMapeada {
  questionCount: number;
  unlocked: boolean;
}

export interface SeccionMapeada extends PiezaMapeada {
  lessons: LeccionMapeada[];
  exercises: EjercicioMapeado[];
}

export interface MapaDelCurso {
  sections: SeccionMapeada[];
  /** Lecciones y ejercicios sin sección: `L1`, `E1`. */
  unfiled: { lessons: LeccionMapeada[]; exercises: EjercicioMapeado[] };
  /** Manija → id, para resolver. */
  idPorManija: Map<string, { id: string; tipo: TipoDeManija }>;
  /** Id → manija, para contestar. */
  manijaPorId: Map<string, string>;
}

/**
 * Orden estable: por `order`, y ante empate por fecha de creación y por id.
 *
 * `getCourseSectionsByCourseId` no tiene ORDER BY y dos secciones pueden
 * compartir `order` (un curso que ya quedó duplicado). Si el desempate fuera
 * el orden de llegada, la misma manija apuntaría a filas distintas en dos
 * llamadas seguidas — que es peor que no tener manijas.
 */
function porOrden<T extends { order?: number | null; createdAt?: string | null; id: string }>(a: T, b: T): number {
  const oa = a.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.order ?? Number.MAX_SAFE_INTEGER;

  if (oa !== ob) return oa - ob;

  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';

  if (ca !== cb) return ca < cb ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function tipoDeItem(type: string): 'lesson' | 'exercise' | 'section' | 'otro' {
  switch (type.toLowerCase()) {
    case 'lesson':
      return 'lesson';
    case 'exercise':
      return 'exercise';
    case 'section':
      return 'section';
    default:
      return 'otro';
  }
}

export function mapaDelCurso(secciones: readonly SeccionParaMapa[], items: readonly ItemParaMapa[]): MapaDelCurso {
  const idPorManija = new Map<string, { id: string; tipo: TipoDeManija }>();
  const manijaPorId = new Map<string, string>();

  const registrar = (manija: string, id: string, tipo: TipoDeManija) => {
    idPorManija.set(manija, { id, tipo });
    manijaPorId.set(id, manija);
  };

  const leccionDe = (item: ItemParaMapa, manija: string): LeccionMapeada => {
    registrar(manija, item.id, 'lesson');

    return {
      manija,
      id: item.id,
      title: item.title ?? '',
      order: item.order ?? null,
      hasContent: item.hasNoteContent === true || Boolean(item.hasSlideContent) || (item.videosCount ?? 0) > 0,
      unlocked: item.isUnlocked === true
    };
  };

  const ejercicioDe = (item: ItemParaMapa, manija: string): EjercicioMapeado => {
    registrar(manija, item.id, 'exercise');

    return {
      manija,
      id: item.id,
      title: item.title ?? '',
      order: item.order ?? null,
      questionCount: item.questionCount ?? 0,
      unlocked: item.isUnlocked === true
    };
  };

  const lecciones = items.filter((i) => tipoDeItem(i.type) === 'lesson').sort(porOrden);
  const ejercicios = items.filter((i) => tipoDeItem(i.type) === 'exercise').sort(porOrden);

  const sections = [...secciones].sort(porOrden).map((seccion, s): SeccionMapeada => {
    const manija = `S${s + 1}`;
    registrar(manija, seccion.id, 'section');

    return {
      manija,
      id: seccion.id,
      title: seccion.title ?? '',
      order: seccion.order ?? null,
      lessons: lecciones.filter((l) => l.sectionId === seccion.id).map((l, i) => leccionDe(l, `${manija}.L${i + 1}`)),
      exercises: ejercicios
        .filter((e) => e.sectionId === seccion.id)
        .map((e, i) => ejercicioDe(e, `${manija}.E${i + 1}`))
    };
  });

  const idsDeSeccion = new Set(secciones.map((s) => s.id));
  const sueltas = (item: ItemParaMapa) => !item.sectionId || !idsDeSeccion.has(item.sectionId);

  return {
    sections,
    unfiled: {
      lessons: lecciones.filter(sueltas).map((l, i) => leccionDe(l, `L${i + 1}`)),
      exercises: ejercicios.filter(sueltas).map((e, i) => ejercicioDe(e, `E${i + 1}`))
    },
    idPorManija,
    manijaPorId
  };
}

/** La manija de un id, o el id mismo si no está en el mapa (recién borrado, otro curso). */
export function manijaDe(mapa: MapaDelCurso, id: string): string {
  return mapa.manijaPorId.get(id) ?? id;
}

const NOMBRE: Record<TipoDeManija, string> = {
  section: 'section',
  lesson: 'lesson',
  exercise: 'exercise',
  block: 'question block'
};

/** Cuántas manijas se listan en un error: alcanza para elegir, sin volcar el curso entero. */
const MAX_LISTADAS = 40;

function listado(mapa: MapaDelCurso, tipo: TipoDeManija): string {
  const piezas: Array<{ manija: string; title: string }> = [];

  for (const seccion of mapa.sections) {
    if (tipo === 'section') piezas.push({ manija: seccion.manija, title: seccion.title });
    if (tipo === 'lesson') piezas.push(...seccion.lessons);
    if (tipo === 'exercise') piezas.push(...seccion.exercises);
  }

  if (tipo === 'lesson') piezas.push(...mapa.unfiled.lessons);
  if (tipo === 'exercise') piezas.push(...mapa.unfiled.exercises);

  if (piezas.length === 0) return `This course has no ${NOMBRE[tipo]}s yet.`;

  const lineas = piezas.slice(0, MAX_LISTADAS).map((p) => `${p.manija} "${p.title}"`);
  const resto = piezas.length > MAX_LISTADAS ? ` … and ${piezas.length - MAX_LISTADAS} more` : '';

  return `This course has: ${lineas.join(', ')}${resto}.`;
}

export class ManijaDesconocida extends Error {
  constructor(valor: string, tipo: TipoDeManija, mapa: MapaDelCurso) {
    super(
      `Unknown ${NOMBRE[tipo]} "${valor}". Use the handle from get_course_structure (for example S2.L3), or the id a tool returned — never guess. ${listado(mapa, tipo)}`
    );
    this.name = 'ManijaDesconocida';
  }
}

/**
 * Resuelve una manija —o deja pasar un id— contra un mapa.
 *
 * Un valor que no es ni manija ni UUID se rechaza con el listado, porque es
 * casi siempre un id inventado a medias («lesson-3», «uuid») y el listado es lo
 * que le falta al modelo para corregirlo en un solo paso.
 */
export function resolverEnMapa(mapa: MapaDelCurso, valor: string, tipo: Exclude<TipoDeManija, 'block'>): string {
  const limpio = valor.trim();

  if (esUuid(limpio)) return limpio;

  const leida = leerManija(limpio);

  if (leida && leida.tipo === tipo) {
    const hallada = mapa.idPorManija.get(limpio.toUpperCase());

    if (hallada && hallada.tipo === tipo) return hallada.id;
  }

  throw new ManijaDesconocida(limpio, tipo, mapa);
}

/** Un bloque de preguntas dentro de un ejercicio, tal como lo lista `getExerciseSectionsByExerciseId`. */
export interface BloqueParaMapa {
  id: string;
  title?: string | null;
  order?: number | null;
  createdAt?: string | null;
}

/**
 * `S1.E2.B3`, o `B3` a secas cuando el ejercicio ya se conoce: el tercer bloque
 * del ejercicio, por `order`.
 */
export function resolverBloque(valor: string, bloques: readonly BloqueParaMapa[], manijaDelEjercicio: string): string {
  const limpio = valor.trim();

  if (esUuid(limpio)) return limpio;

  const numero = limpio.match(/^(?:.*\.)?B(\d+)$/i)?.[1];
  const ordenados = [...bloques].sort(porOrden);
  const bloque = numero ? ordenados[Number(numero) - 1] : undefined;

  if (bloque) return bloque.id;

  const lista =
    ordenados.length === 0
      ? 'This exercise has no question blocks yet: create one with create_exercise_section.'
      : `Its blocks are: ${ordenados.map((b, i) => `${manijaDelEjercicio}.B${i + 1} "${b.title ?? ''}"`).join(', ')}.`;

  throw new Error(`Unknown question block "${limpio}" on exercise ${manijaDelEjercicio}. ${lista}`);
}

/**
 * El resolutor de una ronda: carga el mapa una vez y lo tira cuando el curso
 * cambia.
 *
 * `invalidar()` lo llaman las herramientas que crean, borran o mueven. Sin
 * eso, la lección recién creada no tendría manija hasta la ronda siguiente y
 * el modelo tendría que volver a los ids.
 */
export interface ResolutorDeManijas {
  mapa(): Promise<MapaDelCurso>;
  invalidar(): void;
  seccion(valor: string): Promise<string>;
  leccion(valor: string): Promise<string>;
  ejercicio(valor: string): Promise<string>;
  /**
   * La manija de un id, para contestar después de crear.
   *
   * Lee el mapa vigente y NO lo refresca por su cuenta: quien acaba de crear ya
   * llamó a `invalidar()`, y refrescar acá otra vez haría que esa llamada no
   * cambiara nada — o sea, que ningún test pudiera notar que falta. Una pieza
   * que el mapa no conoce vuelve como su id, que sigue sirviendo en todas
   * partes.
   */
  manijaDe(id: string): Promise<string>;
}

export function crearResolutorDeManijas(cargar: () => Promise<MapaDelCurso>): ResolutorDeManijas {
  let promesa: Promise<MapaDelCurso> | null = null;

  const mapa = () => {
    promesa ??= cargar();
    return promesa;
  };

  /**
   * Un id no necesita el mapa, y el mapa cuesta dos consultas.
   *
   * Los ids siguen valiendo, así que la mayoría de las llamadas de una ronda ya
   * traen el id que otra herramienta les devolvió; cobrarles la estructura
   * entera del curso para contestar lo que ya tienen sería pagar por nada.
   */
  const resolver = async (valor: string, tipo: Exclude<TipoDeManija, 'block'>): Promise<string> =>
    esUuid(valor) ? valor.trim() : resolverEnMapa(await mapa(), valor, tipo);

  return {
    mapa,
    invalidar: () => {
      promesa = null;
    },
    seccion: (valor) => resolver(valor, 'section'),
    leccion: (valor) => resolver(valor, 'lesson'),
    ejercicio: (valor) => resolver(valor, 'exercise'),
    manijaDe: async (id) => manijaDe(await mapa(), id)
  };
}

/**
 * La estructura como la lee el modelo: manijas primero, ids al lado.
 *
 * Los ids siguen viajando porque los enlaces del chat (`@[Título](lesson:ID)`)
 * los necesitan; pero cada herramienta acepta la manija, y la nota lo dice.
 */
export function describirCurso(mapa: MapaDelCurso) {
  const seccion = (s: SeccionMapeada) => ({
    handle: s.manija,
    id: s.id,
    title: s.title,
    order: s.order,
    lessons: s.lessons.map((l) => ({
      handle: l.manija,
      id: l.id,
      title: l.title,
      order: l.order,
      hasContent: l.hasContent,
      unlocked: l.unlocked
    })),
    exercises: s.exercises.map((e) => ({
      handle: e.manija,
      id: e.id,
      title: e.title,
      order: e.order,
      questionCount: e.questionCount,
      unlocked: e.unlocked
    }))
  });

  const sueltas =
    mapa.unfiled.lessons.length > 0 || mapa.unfiled.exercises.length > 0
      ? {
          unfiled: {
            lessons: mapa.unfiled.lessons.map((l) => ({ handle: l.manija, id: l.id, title: l.title })),
            exercises: mapa.unfiled.exercises.map((e) => ({ handle: e.manija, id: e.id, title: e.title }))
          }
        }
      : {};

  return {
    sections: mapa.sections.map(seccion),
    ...sueltas,
    note:
      'Refer to sections, lessons and exercises by their handle (S2, S2.L3, S2.E1) in every tool argument that asks for a sectionId, lessonId or exerciseId. Handles are positional: after reorder_content, call get_course_structure again before using them.'
  };
}
