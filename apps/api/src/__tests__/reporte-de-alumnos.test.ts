import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { TCourseReportData } from '@cio/db/queries/course';
import type { GradebookExercise } from '@api/services/mark/gradebook';
import {
  buildCourseReport,
  courseReportHtml,
  courseReportXlsx,
  excelDay,
  formatDay,
  lockedLine,
  summaryLine
} from '@api/services/course/course-report';

/**
 * El reporte de alumnos de un curso: quién lo hizo y con qué nota.
 *
 * Lo que se fija: cuándo alguien «terminó», que la nota final no castigue a
 * quien todavía no entregó todo, que los invitados que no entraron aparezcan
 * sin repetirse, y que la planilla y el PDF digan lo mismo, con las fechas en el
 * día argentino.
 */

// 1 de noviembre a las 12 en Argentina.
const NOW = new Date('2026-11-01T15:00:00.000Z');

const EXERCISES: GradebookExercise[] = [
  { id: 'ej-caja', title: 'Cuestionario de caja', points: 8 },
  { id: 'ej-recepcion', title: 'Cuestionario de recepción', points: 11 },
  { id: 'ej-final', title: 'Examen final', points: 12 }
];

type Student = TCourseReportData['students'][number];
type Submission = TCourseReportData['submissions'][number];

const student = (id: string, fullname: string, lessonsCompleted: number, last: string | null = null): Student => ({
  groupMemberId: id,
  profileId: `perfil-${id}`,
  fullname,
  email: `${id}@ejemplo.test`,
  enrolledAt: '2026-10-30T18:00:00.000Z',
  lessonsCompleted,
  lastLessonCompletedAt: last
});

const entrega = (who: string, exerciseId: string, total: number | null, submittedAt: string, statusId = 3): Submission => ({
  groupMemberId: who,
  exerciseId,
  total,
  statusId,
  submittedAt
});

function data(overrides: Partial<TCourseReportData> = {}): TCourseReportData {
  return {
    course: { id: 'curso', title: 'Curso de prueba', orgId: 'org', orgName: 'Empresa Ejemplo', orgAvatarUrl: null },
    lessonsTotal: 20,
    lockedLessons: 0,
    lockedExerciseIds: [],
    students: [],
    submissions: [],
    pendingInvites: [],
    ...overrides
  };
}

const build = (d: TCourseReportData) =>
  buildCourseReport(d, EXERCISES, { courseTitle: d.course.title, orgName: 'Empresa Ejemplo', now: NOW });

describe('el estado de cada alumno', () => {
  it('terminó cuando completó todas las lecciones y entregó todos los ejercicios', () => {
    const report = build(
      data({
        students: [student('ana', 'Ana', 20, '2026-10-31T13:00:00.000Z')],
        submissions: [
          entrega('ana', 'ej-caja', 6, '2026-10-30T19:00:00.000Z'),
          entrega('ana', 'ej-recepcion', 9, '2026-10-31T12:00:00.000Z'),
          // La última entrega, a las 22:30 del 31 en Argentina (ya 1 en UTC).
          entrega('ana', 'ej-final', 10, '2026-11-01T01:30:00.000Z')
        ]
      })
    );

    expect(report.rows[0]).toMatchObject({
      status: 'finished',
      progressPct: 100,
      marks: [6, 9, 10],
      // 25 de 31 puntos.
      finalPct: 81,
      finishedAt: '2026-11-01T01:30:00.000Z'
    });
  });

  it('sigue en curso si le falta un ejercicio, aunque haya visto todas las lecciones', () => {
    const report = build(
      data({
        students: [student('beto', 'Beto', 20)],
        submissions: [entrega('beto', 'ej-caja', 8, '2026-10-30T19:00:00.000Z')]
      })
    );

    expect(report.rows[0]).toMatchObject({ status: 'in_progress', marks: [8, null, null], finishedAt: null });
  });

  it('no empezó si no completó ni una lección ni entregó nada', () => {
    const report = build(data({ students: [student('ceci', 'Ceci', 0)] }));

    expect(report.rows[0]).toMatchObject({ status: 'not_started', progressPct: 0, lessonsCompleted: 0 });
  });
});

describe('la nota final', () => {
  it('no sale hasta que entregó todo: lo que falta no cuenta como cero', () => {
    const report = build(
      data({
        students: [student('beto', 'Beto', 12)],
        submissions: [
          entrega('beto', 'ej-caja', 8, '2026-10-30T19:00:00.000Z'),
          entrega('beto', 'ej-recepcion', 11, '2026-10-30T20:00:00.000Z')
        ]
      })
    );

    expect(report.rows[0]!.finalPct).toBeNull();
  });

  it('no sale con un ejercicio sin corregir, que se marca como tal', () => {
    const report = build(
      data({
        students: [student('ana', 'Ana', 20)],
        submissions: [
          entrega('ana', 'ej-caja', 6, '2026-10-30T19:00:00.000Z'),
          entrega('ana', 'ej-recepcion', 9, '2026-10-30T20:00:00.000Z'),
          entrega('ana', 'ej-final', 0, '2026-10-30T21:00:00.000Z', 1)
        ]
      })
    );

    expect(report.rows[0]).toMatchObject({ status: 'finished', marks: [6, 9, 'pending'], finalPct: null });
  });

  it('cuenta la última entrega de cada ejercicio', () => {
    const report = build(
      data({
        students: [student('ana', 'Ana', 20)],
        submissions: [
          entrega('ana', 'ej-caja', 2, '2026-10-30T19:00:00.000Z'),
          entrega('ana', 'ej-caja', 7, '2026-10-30T19:30:00.000Z'),
          entrega('ana', 'ej-recepcion', 11, '2026-10-30T20:00:00.000Z'),
          entrega('ana', 'ej-final', 12, '2026-10-30T21:00:00.000Z')
        ]
      })
    );

    expect(report.rows[0]!.marks).toEqual([7, 11, 12]);
  });
});

describe('los invitados que todavía no entraron', () => {
  it('aparecen al final, con la invitación vigente o vencida', () => {
    const report = build(
      data({
        students: [student('ana', 'Ana', 3)],
        pendingInvites: [
          { email: 'nuevo@ejemplo.test', invitedAt: '2026-10-30T18:00:00.000Z', expiresAt: '2026-11-06T18:00:00.000Z' },
          { email: 'viejo@ejemplo.test', invitedAt: '2026-10-20T18:00:00.000Z', expiresAt: '2026-10-27T18:00:00.000Z' }
        ]
      })
    );

    expect(report.rows.map((r) => [r.email, r.status])).toEqual([
      ['ana@ejemplo.test', 'in_progress'],
      ['nuevo@ejemplo.test', 'invited'],
      ['viejo@ejemplo.test', 'invite_expired']
    ]);
    expect(report.rows[1]).toMatchObject({ progressPct: null, lessonsCompleted: null, marks: [null, null, null] });
  });

  it('quien ya está en el curso no aparece dos veces por una invitación vieja', () => {
    const report = build(
      data({
        students: [student('ana', 'Ana', 3)],
        pendingInvites: [
          { email: 'ANA@ejemplo.test', invitedAt: '2026-10-30T18:00:00.000Z', expiresAt: '2026-11-06T18:00:00.000Z' }
        ]
      })
    );

    expect(report.rows).toHaveLength(1);
    expect(report.summary.invited).toBe(0);
  });
});

describe('el orden y el resumen', () => {
  const report = build(
    data({
      students: [
        student('z', 'Zulema', 0),
        student('b', 'Benítez', 5),
        student('a', 'Álvarez', 20),
        student('c', 'Castro', 20)
      ],
      submissions: [
        ...['a', 'c'].flatMap((who, i) => [
          entrega(who, 'ej-caja', 8 - i, '2026-10-30T19:00:00.000Z'),
          entrega(who, 'ej-recepcion', 11 - i, '2026-10-30T20:00:00.000Z'),
          entrega(who, 'ej-final', 12 - i, '2026-10-30T21:00:00.000Z')
        ])
      ],
      pendingInvites: [
        { email: 'nuevo@ejemplo.test', invitedAt: '2026-10-30T18:00:00.000Z', expiresAt: '2026-11-06T18:00:00.000Z' }
      ]
    })
  );

  it('primero los que terminaron, después en curso, no empezaron e invitados; por nombre adentro', () => {
    // «Álvarez» va antes que «Castro» aunque la tilde no sea una «a».
    expect(report.rows.map((r) => r.name || r.email)).toEqual([
      'Álvarez',
      'Castro',
      'Benítez',
      'Zulema',
      'nuevo@ejemplo.test'
    ]);
  });

  it('cuenta cada estado y promedia la nota final de quienes la tienen', () => {
    expect(report.summary).toEqual({
      students: 4,
      finished: 2,
      inProgress: 1,
      notStarted: 1,
      invited: 1,
      // 100 % y 90 % (28 de 31).
      averageFinalPct: 95
    });
    expect(summaryLine(report.summary)).toBe(
      '4 alumnos: 2 terminaron, 1 en curso, 1 no empezó · 1 invitado que todavía no entró · nota final promedio: 95 %'
    );
  });
});

describe('un curso que se habilita por etapas', () => {
  // Medido en producción el 2026-11-02: con 12 lecciones y 3 cuestionarios
  // bloqueados, el reporte decía «0 terminaron» de 51 alumnos. Nadie puede
  // entregar lo que no ve. (La consulta ya trae `lessonsTotal` sólo con las
  // habilitadas.)
  const report = buildCourseReport(
    data({
      lessonsTotal: 8,
      lockedLessons: 12,
      lockedExerciseIds: ['ej-bloqueado'],
      students: [student('ana', 'Ana', 8, '2026-10-31T13:00:00.000Z')],
      submissions: [
        entrega('ana', 'ej-caja', 6, '2026-10-30T19:00:00.000Z'),
        entrega('ana', 'ej-recepcion', 9, '2026-10-31T12:00:00.000Z'),
        entrega('ana', 'ej-final', 10, '2026-10-31T14:00:00.000Z')
      ]
    }),
    // El cuarto ejercicio está bloqueado: nadie lo entregó ni lo puede entregar.
    [...EXERCISES, { id: 'ej-bloqueado', title: 'Cuestionario bloqueado', points: 9 }],
    { courseTitle: 'Curso de prueba', orgName: 'Empresa Ejemplo', now: NOW }
  );

  it('terminó quien hizo todo lo habilitado, aunque falte lo bloqueado', () => {
    expect(report.rows[0]).toMatchObject({ status: 'finished', progressPct: 100, finalPct: 81 });
  });

  it('lo bloqueado no tiene columna, y el reporte lo dice', () => {
    expect(report.exercises.map((ex) => ex.id)).toEqual(['ej-caja', 'ej-recepcion', 'ej-final']);
    expect(report.locked).toEqual({ lessons: 12, exercises: 1 });
  });
});

describe('la línea de lo bloqueado', () => {
  it('nombra lecciones y ejercicios, en singular o plural, y no aparece si no hay nada', () => {
    expect(lockedLine({ lessons: 12, exercises: 3 })).toBe(
      'Todavía bloqueado para los alumnos, no se cuenta: 12 lecciones y 3 ejercicios.'
    );
    expect(lockedLine({ lessons: 1, exercises: 0 })).toBe('Todavía bloqueado para los alumnos, no se cuenta: 1 lección.');
    expect(lockedLine({ lessons: 0, exercises: 0 })).toBeNull();
  });
});

describe('las fechas, en el día argentino', () => {
  it('las 22:30 del 31 de octubre en Argentina son el 31, aunque en UTC ya sea 1', () => {
    expect(formatDay('2026-11-01T01:30:00.000Z')).toBe('31/10/2026');
    expect(excelDay('2026-11-01T01:30:00.000Z').toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
});

const terminado = () =>
  build(
    data({
      students: [student('ana', 'Ana <b>Pérez</b>', 20, '2026-10-31T13:00:00.000Z'), student('beto', 'Beto', 4)],
      submissions: [
        entrega('ana', 'ej-caja', 6, '2026-10-30T19:00:00.000Z'),
        entrega('ana', 'ej-recepcion', 9, '2026-10-31T12:00:00.000Z'),
        entrega('ana', 'ej-final', 10, '2026-11-01T01:30:00.000Z'),
        entrega('beto', 'ej-caja', 0, '2026-10-31T12:00:00.000Z', 1)
      ]
    })
  );

describe('la planilla', () => {
  it('trae los encabezados, números de verdad y el día argentino como fecha', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await courseReportXlsx(terminado()));
    const sheet = workbook.getWorksheet('Alumnos')!;

    expect(sheet.getRow(1).getCell(1).value).toBe('Reporte de alumnos — Curso de prueba');
    expect(sheet.getRow(3).getCell(1).value).toContain('2 alumnos: 1 terminó, 1 en curso');
    expect(sheet.getRow(5).values).toEqual([
      undefined,
      'Alumno',
      'Correo',
      'Estado',
      'Avance',
      'Lecciones (de 20)',
      'Cuestionario de caja (sobre 8)',
      'Cuestionario de recepción (sobre 11)',
      'Examen final (sobre 12)',
      'Nota final',
      'Terminó el'
    ]);

    const ana = sheet.getRow(6);
    expect(ana.getCell(1).value).toBe('Ana <b>Pérez</b>');
    expect(ana.getCell(3).value).toBe('Terminó');
    expect(ana.getCell(4).value).toBe(1);
    expect(ana.getCell(4).numFmt).toBe('0%');
    expect([ana.getCell(6).value, ana.getCell(7).value, ana.getCell(8).value]).toEqual([6, 9, 10]);
    expect(ana.getCell(9).value).toBe(0.81);
    expect((ana.getCell(10).value as Date).toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(ana.getCell(10).numFmt).toBe('dd/mm/yyyy');

    const beto = sheet.getRow(7);
    expect(beto.getCell(3).value).toBe('En curso');
    expect(beto.getCell(6).value).toBe('Sin corregir');
    expect(beto.getCell(7).value).toBeNull();
    expect(beto.getCell(9).value).toBeNull();

    // Leído de vuelta, el filtro viene como rango: de «Alumno» a «Terminó el», en la fila de encabezados.
    expect(sheet.autoFilter).toBe('A5:J5');
  });
});

describe('el PDF', () => {
  const html = courseReportHtml(terminado(), 'https://medios.ejemplo.test/logo.png');

  it('nombra a la empresa, lleva el logo y escapa lo que escribió el alumno', () => {
    expect(html).toContain('Empresa Ejemplo');
    expect(html).toContain('<img src="https://medios.ejemplo.test/logo.png"');
    expect(html).toContain('Ana &lt;b&gt;Pérez&lt;/b&gt;');
    expect(html).not.toContain('<b>Pérez</b>');
  });

  it('dice lo mismo que la planilla: notas sobre el máximo, sin corregir, lo que falta y el día', () => {
    expect(html).toContain('6/8');
    expect(html).toContain('81 %');
    expect(html).toContain('Sin corregir');
    expect(html).toContain('31/10/2026');
    expect(html).toContain('20/20 lecciones');
  });
});
