import 'dotenv/config';

import * as schema from '../schema';
import bcrypt from 'bcrypt';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Datos sintéticos para mirar el hub de Seguimiento con algo adentro.
 *
 * Llena la jerarquía de [[seed:b2b2b]] con alumnos reales en todos los estados
 * que la pantalla sabe distinguir — certificados, casi terminando, en curso,
 * atrasados, sin empezar, y el caso incómodo del que avanza mucho y aprueba
 * mal — repartidos entre la consultora y sus dos empresas cliente.
 *
 *   Consultora Demo      2 cursos, 8 alumnos internos
 *   ├── Cliente Norte    5 cursos, 22 alumnos
 *   └── Cliente Sur      4 cursos, 18 alumnos
 *
 * Los estados NO se escriben a mano: se declaran como objetivos (avance %, nota
 * %, días de inactividad) y el script fabrica las lecciones completadas, la
 * entrega y la fecha de actividad que producen ese número. Así lo que se ve en
 * la pantalla es el resultado del mismo cálculo que corre en producción, y no
 * una columna inventada que podría no coincidir con nada.
 *
 * Los umbrales de "en riesgo" son los de fábrica (inactivo > 14 días, avance
 * < 30 %, nota < 60 %), así que los arquetipos están elegidos para caer de los
 * dos lados de esas rayas a propósito.
 *
 * Es IDEMPOTENTE: vuelve a dejar exactamente el mismo estado, borrando primero
 * el progreso anterior de estos alumnos.
 *
 * NO CORRER CONTRA PRODUCCIÓN. Comprueba que la base sea local y aborta si no.
 *
 * Uso:
 *   pnpm --filter @cio/db seed:seguimiento
 */

const CLAVE = 'prueba1234';
const BCRYPT_COST = 10;
const ROLE = { ADMIN: 1, TUTOR: 2, STUDENT: 3 } as const;

/** Single answer: alcanza para que la pregunta valga puntos. */
const TIPO_PREGUNTA_SIMPLE = 1;
/** "Graded" en submissionstatus. */
const ESTADO_CORREGIDA = 3;
const PUNTOS_POR_PREGUNTA = 10;
const PREGUNTAS_POR_EVALUACION = 4;

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';

if (!connectionString) {
  console.error('DATABASE_URL es requerido');
  process.exit(1);
}

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) {
  console.error('❌ Esta base NO parece local. Abortado.');
  console.error('   El script crea usuarios con una contraseña conocida; solo tiene sentido en desarrollo.');
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

const ahoraIso = () => new Date().toISOString();
const haceDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

/* -------------------------------------------------------------------------- */
/*  Arquetipos                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Un estado de inscripción, dicho en los términos en que se lee la pantalla.
 *
 * Cada campo es un RANGO, no un número: con valores fijos las cuarenta y pico
 * de filas salen con el mismo 55 % repetido y la tabla parece un error de
 * copiado. El valor concreto se elige de forma determinista a partir del índice
 * del alumno, así que hay variedad y aun así dos corridas dan lo mismo.
 *
 * Los rangos NO cruzan los umbrales de riesgo (inactivo > 14 d, avance < 30 %,
 * nota < 60 %): un arquetipo llamado "atrasado" que a veces no cae en riesgo
 * haría imposible leer la pantalla contra lo que el script dice que sembró.
 *
 * `notaPct` en null significa que nunca entregó: la ficha lo cuenta como 0 y el
 * motor lo marca por nota baja, que es lo que pasa con quien no arrancó.
 */
interface Arquetipo {
  avancePct: [number, number];
  notaPct: [number, number] | null;
  diasInactivo: [number, number] | null;
  certificado: boolean;
}

const ARQUETIPOS = {
  // Terminó todo y aprobó: las únicas filas con certificado.
  certificado: { avancePct: [100, 100], notaPct: [82, 98], diasInactivo: [1, 9], certificado: true },
  // Le falta el último tramo.
  casi: { avancePct: [82, 95], notaPct: [70, 88], diasInactivo: [1, 6], certificado: false },
  enCurso: { avancePct: [45, 70], notaPct: [64, 84], diasInactivo: [1, 8], certificado: false },
  // Recién arrancado pero presente y aprobando: cae bajo el 30 % de avance, así
  // que el motor lo marca igual. Está a propósito — es el falso positivo que
  // hace falta ver para decidir si el umbral sirve.
  reciente: { avancePct: [12, 28], notaPct: [72, 90], diasInactivo: [1, 3], certificado: false },
  // Poco avance Y desaparecido: cae por tres motivos a la vez.
  atrasado: { avancePct: [8, 26], notaPct: [22, 55], diasInactivo: [18, 70], certificado: false },
  // Avanza pero hace rato que no entra: riesgo por inactividad SOLA.
  ausente: { avancePct: [55, 78], notaPct: [65, 85], diasInactivo: [16, 45], certificado: false },
  // Nunca entró. Sin actividad de ningún tipo, que es distinto de "hace mucho
  // que no entra" y la pantalla lo dice distinto.
  sinEmpezar: { avancePct: [0, 0], notaPct: null, diasInactivo: null, certificado: false },
  // El caso que justifica tener nota además de avance: hizo todas las lecciones
  // y no entendió nada. Sin la columna de nota, éste se ve igual que el mejor.
  notaBaja: { avancePct: [88, 100], notaPct: [28, 55], diasInactivo: [1, 7], certificado: false }
} as const satisfies Record<string, Arquetipo>;

type NombreArquetipo = keyof typeof ARQUETIPOS;

/**
 * Reparto de estados por cada 12 alumnos.
 *
 * Pensado como una cohorte real y no como un muestrario: la mayoría avanza, y
 * los casos que duelen son minoría. Una tabla mitad en rojo no se parece a nada
 * y no sirve para juzgar si la pantalla los destaca bien.
 */
const REPARTO: NombreArquetipo[] = [
  'enCurso',
  'certificado',
  'casi',
  'enCurso',
  'atrasado',
  'enCurso',
  'certificado',
  'reciente',
  'notaBaja',
  'casi',
  'ausente',
  'sinEmpezar'
];

/** Determinista: el mismo índice siempre da el mismo valor dentro del rango. */
function enRango(rango: [number, number], indice: number): number {
  const [minimo, maximo] = rango;
  if (maximo <= minimo) return minimo;

  // Paso primo respecto del ancho típico, para que la serie no se repita cada
  // pocos alumnos ni quede correlacionada con el reparto de arquetipos.
  return minimo + ((indice * 7 + 3) % (maximo - minimo + 1));
}

function concretar(arquetipo: Arquetipo, indice: number) {
  return {
    avancePct: enRango(arquetipo.avancePct, indice),
    notaPct: arquetipo.notaPct === null ? null : enRango(arquetipo.notaPct, indice + 1),
    diasInactivo: arquetipo.diasInactivo === null ? null : enRango(arquetipo.diasInactivo, indice + 2),
    certificado: arquetipo.certificado
  };
}

/**
 * Configuración de recertificación de un curso.
 *
 * Dos cosas tienen que pasar para que un curso aparezca en Cumplimiento y es
 * fácil hacer solo una: el JSON de `compliance` Y `type = 'COMPLIANCE'`. La
 * consulta del panel filtra por el TIPO; un curso con la configuración puesta y
 * el tipo sin tocar queda invisible, que es exactamente lo que pasaba con el
 * único curso que había configurado en la base.
 */
interface DefinicionCumplimiento {
  /** Cada cuánto hay que rehacerlo. */
  mesesVigencia: number;
  /** Días después del vencimiento en los que todavía no se considera incumplido. */
  diasGracia: number;
  marco?: 'OSHA' | 'ISO' | 'HIPAA' | 'CUSTOM';
}

interface DefinicionCurso {
  titulo: string;
  descripcion: string;
  lecciones: number;
  cumplimiento?: DefinicionCumplimiento;
}

interface DefinicionEmpresa {
  slug: string;
  cursos: DefinicionCurso[];
  /** Cuántos alumnos tomar de la lista de nombres, en orden. */
  alumnos: number;
}

/**
 * Nombres para la tanda. Reales de aspecto, argentinos, sin repetir apellido
 * seguido: una tabla con veinte "Pérez" se lee como datos falsos y uno deja de
 * mirarla, que es exactamente lo contrario de lo que se busca acá.
 */
const NOMBRES = [
  'Ana Gómez Ferreyra',
  'Bruno Salgado',
  'Carla Ibáñez',
  'Diego Peralta',
  'Elena Ruiz',
  'Facundo Toledo',
  'Gabriela Sosa',
  'Hernán Vidal',
  'Irene Castro',
  'Joaquín Miranda',
  'Karina Duarte',
  'Leandro Farías',
  'Mónica Aguirre',
  'Nicolás Bustos',
  'Olivia Ferrari',
  'Pablo Quiroga',
  'Rocío Maldonado',
  'Santiago Cabrera',
  'Tamara Leiva',
  'Ulises Benítez',
  'Valeria Ponce',
  'Walter Escobar',
  'Ximena Arias',
  'Yamila Correa',
  'Zacarías Ledesma',
  'Agustina Rivas',
  'Bautista Moyano',
  'Camila Herrera',
  'Damián Ocaña',
  'Emilia Zárate',
  'Federico Alsina',
  'Guadalupe Nieva',
  'Horacio Sandoval',
  'Inés Barrionuevo',
  'Julián Tapia',
  'Lucía Villalba',
  'Matías Godoy',
  'Natalia Ojeda',
  'Osvaldo Pizarro',
  'Priscila Cardozo',
  'Ramón Aceval',
  'Sofía Britos',
  'Tobías Lencina',
  'Úrsula Maidana',
  'Vicente Alegre',
  'Wanda Suárez',
  'Ezequiel Paz',
  'Florencia Alcaraz'
];

/**
 * Ana ya existe con este correo desde seed:b2b2b y es la cuenta con la que se
 * prueba la vista de alumno. Reusarlo la mantiene como una sola persona.
 */
const CORREOS_FIJOS: Record<string, string> = {
  'Ana Gómez Ferreyra': 'alumna@local.test'
};

function correoDe(nombre: string): string {
  const fijo = CORREOS_FIJOS[nombre];
  if (fijo) return fijo;

  const limpio = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');

  return `${limpio}@demo.test`;
}

const EMPRESAS: DefinicionEmpresa[] = [
  {
    slug: 'cliente-norte',
    cursos: [
      {
        titulo: 'Seguridad e Higiene en Planta · Nivel I',
        descripcion: '40 horas. Obligatorio para todo el personal de planta.',
        lecciones: 10,
        cumplimiento: { mesesVigencia: 12, diasGracia: 30, marco: 'OSHA' }
      },
      {
        titulo: 'Uso de Elementos de Protección Personal',
        descripcion: 'Selección, colocación y mantenimiento de EPP.',
        lecciones: 8
      },
      {
        titulo: 'Manejo Defensivo de Autoelevadores',
        descripcion: 'Certificación interna para operarios de autoelevador.',
        lecciones: 12
      },
      {
        titulo: 'Trabajo en Altura y Espacios Confinados',
        descripcion: 'Arnés, línea de vida, permisos de trabajo y rescate.',
        lecciones: 14,
        cumplimiento: { mesesVigencia: 12, diasGracia: 15, marco: 'OSHA' }
      },
      {
        titulo: 'Primeros Auxilios en el Puesto',
        descripcion: 'RCP, quemaduras, cortes y traslado de accidentados.',
        lecciones: 7,
        cumplimiento: { mesesVigencia: 24, diasGracia: 30 }
      }
    ],
    alumnos: 22
  },
  {
    slug: 'cliente-sur',
    cursos: [
      {
        titulo: 'Atención al Cliente y Manejo de Reclamos',
        descripcion: 'Protocolo de atención, escalamiento y cierre.',
        lecciones: 9
      },
      {
        titulo: 'Prevención de Riesgos Eléctricos',
        descripcion: 'Trabajos con tensión: bloqueo, etiquetado y rescate.',
        lecciones: 10,
        cumplimiento: { mesesVigencia: 12, diasGracia: 0, marco: 'ISO' }
      },
      {
        titulo: 'Manipulación Segura de Alimentos',
        descripcion: 'Cadena de frío, contaminación cruzada y registros.',
        lecciones: 11,
        cumplimiento: { mesesVigencia: 6, diasGracia: 30 }
      },
      {
        titulo: 'Ventas Consultivas para Mostrador',
        descripcion: 'Detección de necesidad, objeciones y cierre.',
        lecciones: 8
      }
    ],
    alumnos: 18
  },
  {
    slug: 'consultora-demo',
    cursos: [
      {
        titulo: 'Inducción para Instructores',
        descripcion: 'Cómo dictar los cursos maestros de la consultora.',
        lecciones: 6
      },
      {
        titulo: 'Diseño de Evaluaciones Válidas',
        descripcion: 'Escribir preguntas que midan lo que dicen medir.',
        lecciones: 9
      }
    ],
    alumnos: 8
  }
];

/**
 * A qué cursos va cada alumno y con qué estado.
 *
 * Reparte en abanico (alumno i arranca en el curso i) para que ningún curso
 * quede vacío, y suma un segundo curso a uno de cada tres —con OTRO estado, no
 * el mismo— porque el promedio entre cursos de un mismo alumno es justamente el
 * número que el eje "Por alumno" existe para mostrar.
 */
function inscripcionesDe(indice: number, cantidadCursos: number): Array<{ curso: number; estado: NombreArquetipo }> {
  const principal = indice % cantidadCursos;
  const estado = REPARTO[indice % REPARTO.length]!;

  const inscripciones = [{ curso: principal, estado }];

  if (indice % 3 === 0 && cantidadCursos > 1) {
    inscripciones.push({
      curso: (principal + 1 + (indice % (cantidadCursos - 1))) % cantidadCursos,
      estado: REPARTO[(indice * 5 + 4) % REPARTO.length]!
    });
  }

  return inscripciones;
}

/* -------------------------------------------------------------------------- */
/*  Altas idempotentes                                                        */
/* -------------------------------------------------------------------------- */

/** user + profile + credencial. Igual que en seed:b2b2b, para poder entrar con cualquiera. */
async function asegurarUsuario(email: string, nombre: string, hash: string): Promise<string> {
  const ahora = new Date();

  let [usuario] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);

  if (!usuario) {
    [usuario] = await db
      .insert(schema.user)
      .values({
        id: randomUUID(),
        name: nombre,
        email,
        emailVerified: true,
        createdAt: ahora,
        updatedAt: ahora
      } as typeof schema.user.$inferInsert)
      .returning();
  }

  const [credencial] = await db
    .select()
    .from(schema.account)
    .where(and(eq(schema.account.userId, usuario!.id), eq(schema.account.providerId, 'credential')))
    .limit(1);

  if (credencial) {
    await db
      .update(schema.account)
      .set({ password: hash, updatedAt: ahora })
      .where(eq(schema.account.id, credencial.id));
  } else {
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId: usuario!.id,
      providerId: 'credential',
      userId: usuario!.id,
      password: hash,
      createdAt: ahora,
      updatedAt: ahora
    } as typeof schema.account.$inferInsert);
  }

  const [perfil] = await db.select().from(schema.profile).where(eq(schema.profile.email, email)).limit(1);

  if (perfil) {
    await db
      .update(schema.profile)
      .set({ isEmailVerified: true, verifiedAt: ahora.toISOString() })
      .where(eq(schema.profile.id, perfil.id));

    return perfil.id;
  }

  // `profile.id` es clave foránea de `user.id`: el perfil no tiene identidad propia.
  const [creado] = await db
    .insert(schema.profile)
    .values({
      id: usuario!.id,
      fullname: nombre,
      email,
      username: email.split('@')[0],
      isEmailVerified: true,
      verifiedAt: ahora.toISOString(),
      createdAt: ahora.toISOString()
    } as unknown as typeof schema.profile.$inferInsert)
    .returning();

  return creado!.id;
}

async function asegurarMiembro(orgId: string, profileId: string, email: string, roleId: number) {
  const [existente] = await db
    .select()
    .from(schema.organizationmember)
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.profileId, profileId)))
    .limit(1);

  if (existente) return existente.id;

  const [creado] = await db
    .insert(schema.organizationmember)
    .values({
      organizationId: orgId,
      profileId,
      email,
      roleId,
      verified: true,
      createdAt: ahoraIso()
    } as unknown as typeof schema.organizationmember.$inferInsert)
    .returning();

  return creado!.id;
}

/**
 * Curso publicado con sus lecciones y una evaluación de 4 preguntas.
 *
 * El grupo lleva el nombre del curso: es la unidad a la que se inscribe la
 * gente, y con un grupo por curso cada inscripción tiene su propio
 * `certificate_earned_at`, que es lo que hace que un alumno pueda estar
 * certificado en un curso y atrasado en otro.
 */
async function asegurarCurso(orgId: string, definicion: DefinicionCurso) {
  // Se busca el CURSO por título en toda la empresa, no el grupo por nombre.
  // El grupo puede llamarse distinto del curso —seed:b2b2b crea "Seguridad e
  // Higiene" conteniendo "Seguridad e Higiene en Planta · Nivel I"— y buscar por
  // el nombre del grupo no lo encuentra: se arma un segundo curso con el mismo
  // título, la gente queda inscripta en los dos, y el promedio del alumno se
  // hunde contra un curso fantasma de cero lecciones.
  const [cursoExistente] = await db
    .select({ curso: schema.course, grupo: schema.group })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(and(eq(schema.group.organizationId, orgId), eq(schema.course.title, definicion.titulo)))
    .limit(1);

  const grupo =
    cursoExistente?.grupo ??
    (
      await db
        .insert(schema.group)
        .values({
          id: randomUUID(),
          name: definicion.titulo,
          organizationId: orgId,
          createdAt: ahoraIso()
        } as unknown as typeof schema.group.$inferInsert)
        .returning()
    )[0]!;

  const curso =
    cursoExistente?.curso ??
    (
      await db
        .insert(schema.course)
        .values({
          id: randomUUID(),
          title: definicion.titulo,
          description: definicion.descripcion,
          groupId: grupo.id,
          isPublished: true,
          status: 'ACTIVE',
          slug: `${definicion.titulo
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}-${randomUUID().slice(0, 6)}`,
          createdAt: ahoraIso()
        } as unknown as typeof schema.course.$inferInsert)
        .returning()
    )[0]!;

  // Un curso en borrador es invisible para el alumno inscripto, y una corrida
  // vieja pudo haberlo dejado así. El tipo y la configuración de
  // recertificación se reescriben acá por lo mismo.
  await db
    .update(schema.course)
    .set({
      isPublished: true,
      status: 'ACTIVE',
      type: definicion.cumplimiento ? 'COMPLIANCE' : 'SELF_PACED',
      compliance: definicion.cumplimiento
        ? {
            retakeIntervalMonths: definicion.cumplimiento.mesesVigencia,
            gracePeriodDays: definicion.cumplimiento.diasGracia,
            reminderDaysBefore: [30, 14, 7],
            isMandatory: true,
            framework: definicion.cumplimiento.marco ?? null,
            passingScore: 70
          }
        : null
    })
    .where(eq(schema.course.id, curso.id));

  const leccionesExistentes = await db.select().from(schema.lesson).where(eq(schema.lesson.courseId, curso.id));

  const lecciones = [...leccionesExistentes];
  for (let i = leccionesExistentes.length; i < definicion.lecciones; i++) {
    const [creada] = await db
      .insert(schema.lesson)
      .values({
        id: randomUUID(),
        courseId: curso.id,
        title: `${i + 1}. ${definicion.titulo.split(' ').slice(0, 3).join(' ')} — parte ${i + 1}`,
        order: i,
        isUnlocked: true,
        createdAt: ahoraIso()
      } as unknown as typeof schema.lesson.$inferInsert)
      .returning();

    lecciones.push(creada!);
  }

  lecciones.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));

  // Evaluación: una por curso, con puntos, o la nota no existiría.
  const [evaluacionExistente] = await db
    .select()
    .from(schema.exercise)
    .where(eq(schema.exercise.courseId, curso.id))
    .limit(1);

  const evaluacion =
    evaluacionExistente ??
    (
      await db
        .insert(schema.exercise)
        .values({
          id: randomUUID(),
          title: 'Evaluación final',
          description: 'Cuatro preguntas. Se aprueba con 60 %.',
          courseId: curso.id,
          order: 0,
          isUnlocked: true,
          createdAt: ahoraIso()
        } as unknown as typeof schema.exercise.$inferInsert)
        .returning()
    )[0]!;

  const preguntas = await db.select().from(schema.question).where(eq(schema.question.exerciseId, evaluacion.id));

  for (let i = preguntas.length; i < PREGUNTAS_POR_EVALUACION; i++) {
    await db.insert(schema.question).values({
      questionTypeId: TIPO_PREGUNTA_SIMPLE,
      title: `Pregunta ${i + 1}`,
      exerciseId: evaluacion.id,
      points: PUNTOS_POR_PREGUNTA,
      order: i,
      createdAt: ahoraIso()
    } as unknown as typeof schema.question.$inferInsert);
  }

  // El puntaje máximo REAL del curso, contado igual que lo cuenta la aplicación:
  // sobre todos sus cuestionarios, propios o colgados de una lección.
  //
  // No se puede dar por sentado que sean los 4 × 10 de arriba. Un curso que ya
  // existía puede traer su propia evaluación, y entonces el denominador es otro:
  // la primera corrida escribió entregas calculadas sobre 40 puntos contra
  // cursos que valían 24, y la pantalla mostró alumnos con 127 % de nota.
  const [maximo] = (await db.execute(sql`
    SELECT COALESCE(SUM(q.points), 0)::int AS puntos
      FROM question q
      JOIN exercise ex ON ex.id = q.exercise_id
      LEFT JOIN lesson el ON el.id = ex.lesson_id
     WHERE ex.course_id = ${curso.id} OR el.course_id = ${curso.id}
  `)) as unknown as Array<{ puntos: number }>;

  return {
    grupo,
    curso,
    evaluacion,
    lecciones,
    puntosMaximos: Number(maximo?.puntos) || 0,
    cumplimiento: definicion.cumplimiento
  };
}

/**
 * Borra el rastro de los alumnos de prueba en una empresa antes de rearmarla.
 *
 * "Idempotente" tiene que valer también cuando cambia la configuración de acá
 * arriba, y no valía: al reordenar la lista de nombres, los alumnos de la
 * corrida anterior se quedaron inscriptos donde ya no correspondía. La empresa
 * decía 24 alumnos con 18 sembrados, y la misma persona aparecía en dos
 * empresas — no por el diseño multiempresa sino por basura acumulada, que es
 * peor, porque se parece a un dato real.
 *
 * Alcanza SOLO a los perfiles de prueba (`@demo.test` y la alumna del escenario
 * base). Los tutores y administradores no se tocan.
 */
async function limpiarAlumnosDemo(orgId: string) {
  await db.execute(sql`
    WITH demo AS (
      SELECT id FROM profile
       WHERE email LIKE '%@demo.test' OR email = 'alumna@local.test'
    ),
    grupos AS (
      SELECT id FROM "group" WHERE organization_id = ${orgId}
    ),
    miembros AS (
      SELECT gm.id FROM groupmember gm
       WHERE gm.group_id IN (SELECT id FROM grupos)
         AND gm.profile_id IN (SELECT id FROM demo)
    ),
    borra_entregas AS (
      DELETE FROM submission WHERE submitted_by IN (SELECT id FROM miembros)
    ),
    borra_lecciones AS (
      DELETE FROM lesson_completion
       WHERE profile_id IN (SELECT id FROM demo)
         AND lesson_id IN (
           SELECT l.id FROM lesson l
             JOIN course c ON c.id = l.course_id
            WHERE c.group_id IN (SELECT id FROM grupos)
         )
    ),
    borra_miembros AS (
      DELETE FROM groupmember WHERE id IN (SELECT id FROM miembros)
    )
    DELETE FROM organizationmember
     WHERE organization_id = ${orgId}
       AND profile_id IN (SELECT id FROM demo)
  `);
}

/* -------------------------------------------------------------------------- */
/*  Cumplimiento (recertificación)                                            */
/* -------------------------------------------------------------------------- */

type EstadoCumplimiento =
  | 'compliant'
  | 'expiring_soon'
  | 'in_grace_period'
  | 'non_compliant'
  | 'in_progress'
  | 'not_started'
  | 'waived';

/**
 * Reparto de estados de recertificación, uno por inscripción.
 *
 * `null` = sin registro, que la pantalla cuenta aparte como "sin registro": es
 * la persona inscripta en un curso obligatorio que todavía no lo empezó nunca, y
 * en una auditoría es tan importante como la que está vencida.
 *
 * Mayoría al día, como en una empresa que funciona; los vencidos son los pocos
 * que la pantalla tiene que hacer saltar a la vista.
 */
const CICLO_CUMPLIMIENTO: Array<EstadoCumplimiento | null> = [
  'compliant',
  'compliant',
  'expiring_soon',
  'in_progress',
  'non_compliant',
  'compliant',
  'in_grace_period',
  'not_started',
  'waived',
  'compliant',
  'expiring_soon',
  null
];

const enDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

/**
 * Las fechas que hacen verdadero a cada estado.
 *
 * El estado se guarda en una columna —lo escribe el barrido de recordatorios,
 * no se calcula al leer— así que sembrarlo sin fechas coherentes daría una
 * pantalla que se contradice sola: "expira pronto" con vencimiento en dos años.
 * Acá se derivan del vencimiento y de la vigencia configurada del curso.
 */
function fechasCumplimiento(estado: EstadoCumplimiento, config: DefinicionCumplimiento, indice: number) {
  const diasVigencia = config.mesesVigencia * 30;

  switch (estado) {
    case 'compliant': {
      const completado = enRango([40, 120], indice);
      return {
        completedAt: haceDias(completado),
        validUntil: enDias(diasVigencia - completado),
        dueDate: enDias(diasVigencia - completado),
        startedAt: haceDias(completado + 20)
      };
    }
    case 'expiring_soon': {
      // Dentro de la ventana de aviso, todavía sin vencer.
      const faltan = enRango([3, 25], indice);
      return {
        completedAt: haceDias(diasVigencia - faltan),
        validUntil: enDias(faltan),
        dueDate: enDias(faltan),
        startedAt: haceDias(diasVigencia - faltan + 20)
      };
    }
    case 'in_grace_period': {
      // Vencido pero dentro de la gracia — si el curso no tiene gracia este
      // estado no puede existir, y el llamador ya no lo pide en ese caso.
      const vencidoHace = Math.max(1, Math.floor(config.diasGracia / 2));
      return {
        completedAt: haceDias(diasVigencia + vencidoHace),
        validUntil: haceDias(vencidoHace),
        dueDate: haceDias(vencidoHace),
        startedAt: haceDias(diasVigencia + vencidoHace + 20)
      };
    }
    case 'non_compliant': {
      const vencidoHace = config.diasGracia + enRango([10, 90], indice);
      return {
        completedAt: haceDias(diasVigencia + vencidoHace),
        validUntil: haceDias(vencidoHace),
        dueDate: haceDias(vencidoHace),
        startedAt: haceDias(diasVigencia + vencidoHace + 20)
      };
    }
    case 'in_progress':
      return { completedAt: null, validUntil: null, dueDate: enDias(enRango([30, 120], indice)), startedAt: haceDias(enRango([2, 25], indice)) };
    case 'not_started':
      return { completedAt: null, validUntil: null, dueDate: enDias(enRango([60, 180], indice)), startedAt: null };
    case 'waived':
      return { completedAt: null, validUntil: null, dueDate: enDias(enRango([120, 300], indice)), startedAt: null };
  }
}

/** El primer ADMIN de la empresa, para firmar las exenciones. */
async function adminDe(orgId: string): Promise<string | null> {
  const [fila] = await db
    .select({ profileId: schema.organizationmember.profileId })
    .from(schema.organizationmember)
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.roleId, ROLE.ADMIN)))
    .limit(1);

  return fila?.profileId ?? null;
}

async function aplicarCumplimiento(
  armado: CursoArmado,
  profileId: string,
  groupMemberId: string,
  indice: number,
  notaPct: number | null,
  adminProfileId: string | null
) {
  const config = armado.cumplimiento;
  if (!config) return null;

  await db
    .delete(schema.courseCompletionRecord)
    .where(
      and(
        eq(schema.courseCompletionRecord.courseId, armado.curso.id),
        eq(schema.courseCompletionRecord.profileId, profileId)
      )
    );

  let estado = CICLO_CUMPLIMIENTO[indice % CICLO_CUMPLIMIENTO.length];
  // Sin días de gracia configurados, "en período de gracia" es imposible: el
  // curso pasa de vencido a incumplido el mismo día.
  if (estado === 'in_grace_period' && config.diasGracia === 0) estado = 'non_compliant';
  if (!estado) return null;

  const fechas = fechasCumplimiento(estado, config, indice);
  const completado = fechas.completedAt !== null;

  await db.insert(schema.courseCompletionRecord).values({
    id: randomUUID(),
    courseId: armado.curso.id,
    groupMemberId,
    profileId,
    // Segundo ciclo para algunos: la recertificación es la razón de existir de
    // esta pantalla, y un tablero donde todos van por el ciclo 1 no la muestra.
    cycleNumber: completado && indice % 3 === 0 ? 2 : 1,
    status: estado,
    dueDate: fechas.dueDate,
    startedAt: fechas.startedAt,
    completedAt: fechas.completedAt,
    validUntil: fechas.validUntil,
    score: completado ? (notaPct ?? enRango([70, 98], indice)) : null,
    attempts: completado ? 1 + (indice % 2) : 0,
    timeSpentMinutes: completado ? enRango([90, 400], indice) : enRango([0, 60], indice),
    ...(estado === 'waived'
      ? {
          waivedBy: adminProfileId,
          waiverReason: 'Acredita capacitación equivalente externa.',
          waiverExpiresAt: fechas.dueDate
        }
      : {})
  } as unknown as typeof schema.courseCompletionRecord.$inferInsert);

  return estado;
}

/* -------------------------------------------------------------------------- */
/*  Fabricar un estado                                                        */
/* -------------------------------------------------------------------------- */

interface CursoArmado {
  grupo: typeof schema.group.$inferSelect;
  curso: typeof schema.course.$inferSelect;
  evaluacion: typeof schema.exercise.$inferSelect;
  lecciones: Array<typeof schema.lesson.$inferSelect>;
  /** Denominador de la nota: la suma de puntos de TODO el curso. */
  puntosMaximos: number;
  /** Presente solo si el curso recertifica. */
  cumplimiento?: DefinicionCumplimiento;
}

/**
 * Escribe las filas que producen el estado pedido.
 *
 * Deliberadamente no toca ninguna columna de "avance" ni de "nota": esas no
 * existen. El avance sale de contar `lesson_completion`, la nota de dividir el
 * total de la entrega por los puntos del cuestionario, y la actividad del
 * máximo entre login, lección completada y entrega. Fabricar los hechos y dejar
 * que la aplicación saque la cuenta es lo que hace que esta base de prueba
 * sirva para creerle a la pantalla.
 */
async function aplicarEstado(
  armado: CursoArmado,
  profileId: string,
  estado: ReturnType<typeof concretar>
): Promise<string> {
  const cuandoIso = estado.diasInactivo === null ? null : haceDias(estado.diasInactivo);

  const [miembro] = await db
    .select()
    .from(schema.groupmember)
    .where(and(eq(schema.groupmember.groupId, armado.grupo.id), eq(schema.groupmember.profileId, profileId)))
    .limit(1);

  const groupMemberId =
    miembro?.id ??
    (
      await db
        .insert(schema.groupmember)
        .values({
          id: randomUUID(),
          groupId: armado.grupo.id,
          profileId,
          roleId: ROLE.STUDENT,
          createdAt: haceDias(60)
        } as unknown as typeof schema.groupmember.$inferInsert)
        .returning()
    )[0]!.id;

  await db
    .update(schema.groupmember)
    .set({ certificateEarnedAt: estado.certificado && cuandoIso ? cuandoIso : null })
    .where(eq(schema.groupmember.id, groupMemberId));

  // Lecciones completadas: las primeras N, que es como avanza cualquiera.
  const completadas = Math.round((estado.avancePct / 100) * armado.lecciones.length);

  await db.delete(schema.lessonCompletion).where(
    and(
      eq(schema.lessonCompletion.profileId, profileId),
      inArray(
        schema.lessonCompletion.lessonId,
        armado.lecciones.map((leccion) => leccion.id)
      )
    )
  );

  if (completadas > 0 && cuandoIso) {
    await db.insert(schema.lessonCompletion).values(
      armado.lecciones.slice(0, completadas).map((leccion, indice) => ({
        lessonId: leccion.id,
        profileId,
        isComplete: true,
        // Escalonadas hacia atrás desde la última actividad, para que el
        // historial no sea un bloque con la misma marca de tiempo.
        createdAt: haceDias((estado.diasInactivo ?? 0) + (completadas - indice)),
        updatedAt: cuandoIso
      })) as unknown as Array<typeof schema.lessonCompletion.$inferInsert>
    );
  }

  await db.delete(schema.submission).where(
    and(eq(schema.submission.exerciseId, armado.evaluacion.id), eq(schema.submission.submittedBy, groupMemberId))
  );

  if (estado.notaPct !== null && cuandoIso) {
    const maximo = armado.puntosMaximos || PREGUNTAS_POR_EVALUACION * PUNTOS_POR_PREGUNTA;

    await db.insert(schema.submission).values({
      id: randomUUID(),
      exerciseId: armado.evaluacion.id,
      courseId: armado.curso.id,
      submittedBy: groupMemberId,
      total: Math.round((estado.notaPct / 100) * maximo),
      statusId: ESTADO_CORREGIDA,
      gradingState: 'graded',
      overallStatus: 'passed',
      createdAt: cuandoIso,
      updatedAt: cuandoIso
    } as unknown as typeof schema.submission.$inferInsert);
  }

  return groupMemberId;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const hash = await bcrypt.hash(CLAVE, BCRYPT_COST);
  const totalPedido = EMPRESAS.reduce((suma, empresa) => suma + empresa.alumnos, 0);

  if (totalPedido > NOMBRES.length) {
    console.error(`❌ Hacen falta ${totalPedido} nombres y la lista tiene ${NOMBRES.length}.`);
    process.exitCode = 1;
    return;
  }

  const porEstado = new Map<NombreArquetipo, number>();
  const porCumplimiento = new Map<string, number>();
  let siguienteNombre = 0;
  let inscripciones = 0;

  for (const empresa of EMPRESAS) {
    const [org] = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.siteName, empresa.slug))
      .limit(1);

    if (!org) {
      console.error(`❌ No existe la empresa "${empresa.slug}". Corré primero: pnpm --filter @cio/db seed:b2b2b`);
      process.exitCode = 1;
      return;
    }

    // Antes de sembrar, no después: si no, la corrida anterior sobrevive donde
    // la configuración cambió de opinión.
    await limpiarAlumnosDemo(org.id);

    const cursos: CursoArmado[] = [];
    for (const definicion of empresa.cursos) {
      cursos.push(await asegurarCurso(org.id, definicion));
    }

    const adminProfileId = await adminDe(org.id);

    for (let i = 0; i < empresa.alumnos; i++) {
      const nombre = NOMBRES[siguienteNombre]!;
      const email = correoDe(nombre);
      siguienteNombre += 1;

      const profileId = await asegurarUsuario(email, nombre, hash);
      await asegurarMiembro(org.id, profileId, email, ROLE.STUDENT);

      for (const inscripcion of inscripcionesDe(i, cursos.length)) {
        const armado = cursos[inscripcion.curso];
        if (!armado) continue;

        // El índice global, no el de la empresa: si no, las tres empresas
        // salen con exactamente los mismos porcentajes en el mismo orden.
        const concreto = concretar(ARQUETIPOS[inscripcion.estado], siguienteNombre + inscripciones);
        const groupMemberId = await aplicarEstado(armado, profileId, concreto);
        porEstado.set(inscripcion.estado, (porEstado.get(inscripcion.estado) ?? 0) + 1);

        const estadoCumplimiento = await aplicarCumplimiento(
          armado,
          profileId,
          groupMemberId,
          inscripciones,
          concreto.notaPct,
          adminProfileId
        );
        if (estadoCumplimiento) {
          porCumplimiento.set(estadoCumplimiento, (porCumplimiento.get(estadoCumplimiento) ?? 0) + 1);
        } else if (armado.cumplimiento) {
          porCumplimiento.set('sin registro', (porCumplimiento.get('sin registro') ?? 0) + 1);
        }

        inscripciones += 1;
      }
    }

    console.log(`   ${org.name}: ${empresa.cursos.length} cursos, ${empresa.alumnos} alumnos`);
  }

  const cursosTotales = EMPRESAS.reduce((suma, empresa) => suma + empresa.cursos.length, 0);

  console.log(`\n✅ Listo: ${totalPedido} alumnos, ${inscripciones} inscripciones, ${cursosTotales} cursos.\n`);
  console.log(`   Contraseña de todos los alumnos nuevos: ${CLAVE}\n`);
  console.log('   Inscripciones por estado sembrado:');
  for (const [estado, cantidad] of [...porEstado.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${estado.padEnd(12)} ${String(cantidad).padStart(3)}`);
  }
  console.log('\n   Qué es cada uno:');
  console.log('     certificado  100 % y nota alta → las únicas filas con certificado');
  console.log('     casi         82-95 % — no completó, no certifica');
  console.log('     enCurso      45-70 % y aprobando — al día');
  console.log('     reciente     12-28 % pero activo y con buena nota → cae por el umbral de avance');
  console.log('     ausente      avanza bien pero 16-45 días sin entrar → riesgo SOLO por inactividad');
  console.log('     atrasado     poco avance + nota floja + desaparecido → riesgo por 3 motivos');
  console.log('     sinEmpezar   0 %, sin entrega, sin actividad → "Sin actividad"');
  console.log('     notaBaja     88-100 % de avance con nota < 60 → riesgo SOLO por nota\n');
  if (porCumplimiento.size > 0) {
    console.log('\n   Cumplimiento (recertificación) por estado:');
    for (const [estado, cantidad] of [...porCumplimiento.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${estado.padEnd(16)} ${String(cantidad).padStart(3)}`);
    }
    console.log('     (5 cursos obligatorios, vigencia de 6 a 24 meses)');
  }

  console.log('   Miralo entrando como consultora@local.test:');
  console.log('   http://localhost:5173/org/consultora-demo/seguimiento\n');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
