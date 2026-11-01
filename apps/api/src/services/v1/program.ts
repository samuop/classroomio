import { getCoursesByProgram, getProgramsByOrg } from '@cio/db/queries/program';

export interface PublicApiProgram {
  id: string;
  title: string;
  courses: Array<{ id: string; title: string | null }>;
}

/**
 * Los programas activos de la organización, cada uno con sus cursos. Lo usa Seguimiento (SaaS-RRHH)
 * para elegir las sendas de ingreso de una empresa y las de cada contratación.
 */
export async function listProgramsService(orgId: string): Promise<PublicApiProgram[]> {
  const programs = (await getProgramsByOrg(orgId)).filter((program) => program.status === 'ACTIVE');
  return Promise.all(
    programs.map(async (program) => ({
      id: program.id,
      title: program.name,
      courses: (await getCoursesByProgram(program.id)).map((row) => ({ id: row.course.id, title: row.course.title }))
    }))
  );
}
