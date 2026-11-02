import { classroomio } from '$lib/utils/services/api';
import type { TCourseReportFormat } from '@cio/utils/validation/course';

/**
 * Baja el reporte de alumnos del curso: quién lo hizo y con qué nota.
 *
 * Lo arma el servidor, en planilla o en PDF, así que acá sólo se pide y se
 * guarda con el nombre que manda. `false` si no se pudo armar.
 */
export async function descargarReporteDeAlumnos(courseId: string, format: TCourseReportFormat): Promise<boolean> {
  const response = await classroomio.course[':courseId'].mark.report.$get({
    param: { courseId },
    query: { format }
  });

  if (!response.ok) return false;

  const nombre =
    response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `alumnos.${format}`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = nombre;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return true;
}
