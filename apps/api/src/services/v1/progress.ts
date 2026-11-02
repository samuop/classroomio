import { getProfileCourseProgressInOrg, type ProfileCourseProgressInOrg } from '@cio/db/queries/course';
import { getLatestOrgInvitesByEmails, getOrganizationStudentsByEmails } from '@cio/db/queries/organization';
import { getCoursesByProgram, getEnrolledProgramsByProfile } from '@cio/db/queries/program';

import { ROLE } from '@cio/utils/constants';
import { calcPercentageWithRounding } from '@api/services/course/utils';
import { deriveAudienceMemberStatus, type AudienceMemberStatus } from '@api/utils/audience-member-status';

/** "none": no es alumno de la organización (nunca se lo invitó, o se lo sacó). */
export type PublicApiAudienceStatus = AudienceMemberStatus | 'none';

export interface PublicApiCourseProgress {
  id: string;
  title: string;
  /** 0–100: las lecciones completadas sobre las del curso, como lo muestra el Campus. */
  progress: number;
  /** El día que completó la última lección, si las completó todas. */
  completedAt: string | null;
  certificateAt: string | null;
}

export interface PublicApiAudienceProgress {
  email: string;
  status: PublicApiAudienceStatus;
  /** Sus programas en la organización, cada uno con sus cursos publicados. */
  programs: Array<{ id: string; title: string; courses: PublicApiCourseProgress[] }>;
  /** Los cursos que tiene fuera de esos programas. */
  courses: PublicApiCourseProgress[];
}

function delCurso(curso: ProfileCourseProgressInOrg): PublicApiCourseProgress {
  const completo = curso.lessonsCount > 0 && curso.lessonsCompleted >= curso.lessonsCount;
  return {
    id: curso.courseId,
    title: curso.courseTitle,
    progress: Math.min(100, calcPercentageWithRounding(curso.lessonsCompleted, curso.lessonsCount)),
    completedAt: completo ? curso.lastCompletedAt : null,
    certificateAt: curso.certificateEarnedAt
  };
}

/**
 * El avance de cada persona en la organización, para Seguimiento (SaaS-RRHH, fase 22): guarda una copia
 * en el legajo de cada empleado. Por cada correo, su estado en la organización, sus programas (las
 * "sendas") con el avance de cada curso, y los cursos que tiene sueltos. Sólo alumnos, y sólo lo de la
 * organización de la clave. Las notas de los exámenes no van: Seguimiento no las guarda.
 */
export async function getAudienceProgressService(
  orgId: string,
  emails: string[]
): Promise<PublicApiAudienceProgress[]> {
  const pedidos = [...new Set(emails.map((e) => e.toLowerCase().trim()))].filter(Boolean);
  const [miembros, invitaciones] = await Promise.all([
    getOrganizationStudentsByEmails(orgId, pedidos),
    getLatestOrgInvitesByEmails(orgId, pedidos)
  ]);

  // Si un correo figura dos veces, manda el que ya aceptó.
  const miembroPorCorreo = new Map<string, (typeof miembros)[number]>();
  for (const m of miembros) {
    const antes = miembroPorCorreo.get(m.email);
    if (!antes || (!antes.profileId && m.profileId)) miembroPorCorreo.set(m.email, m);
  }
  const invitacionPorCorreo = new Map(invitaciones.map((i) => [i.email.toLowerCase(), i]));

  // Los cursos de un programa son los mismos para todos: se piden una vez.
  const cursosDelPrograma = new Map<string, ReturnType<typeof getCoursesByProgram>>();
  const cursosDe = (programId: string) => {
    if (!cursosDelPrograma.has(programId)) cursosDelPrograma.set(programId, getCoursesByProgram(programId, true));
    return cursosDelPrograma.get(programId)!;
  };

  return Promise.all(
    pedidos.map(async (email): Promise<PublicApiAudienceProgress> => {
      const miembro = miembroPorCorreo.get(email);
      if (!miembro) return { email, status: 'none', programs: [], courses: [] };
      const status = deriveAudienceMemberStatus(miembro.profileId, invitacionPorCorreo.get(email));
      if (!miembro.profileId) return { email, status, programs: [], courses: [] };

      const [cursos, programas] = await Promise.all([
        getProfileCourseProgressInOrg(miembro.profileId, orgId),
        getEnrolledProgramsByProfile(miembro.profileId)
      ]);
      const avance = new Map(cursos.map((c) => [c.courseId, delCurso(c)]));
      const suyos = programas.filter((p) => p.organizationId === orgId && p.roleId === ROLE.STUDENT);

      const programs = await Promise.all(
        suyos.map(async (p) => ({
          id: p.id,
          title: p.name,
          courses: (await cursosDe(p.id)).map(
            (row) =>
              avance.get(row.course.id) ?? {
                id: row.course.id,
                title: row.course.title ?? '',
                progress: 0,
                completedAt: null,
                certificateAt: null
              }
          )
        }))
      );
      const enUnPrograma = new Set(programs.flatMap((p) => p.courses.map((c) => c.id)));

      return { email, status, programs, courses: cursos.filter((c) => !enUnPrograma.has(c.courseId)).map(delCurso) };
    })
  );
}
