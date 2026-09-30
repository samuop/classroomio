/**
 * Qué archivos son planillas de Excel.
 *
 * Aparte del lector y de la consulta para que el servicio de documentos lo use
 * sin importar la consulta, que a su vez baja los originales con él.
 */
export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TIPO_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export const TIPOS_DE_PLANILLA = [TIPO_XLSX, TIPO_XLSM] as const;

export function esPlanilla(mimeType: string | null | undefined): boolean {
  return !!mimeType && (TIPOS_DE_PLANILLA as readonly string[]).includes(mimeType);
}

/**
 * El tipo de un archivo subido, mirando también su extensión.
 *
 * El navegador toma el tipo del sistema operativo: en una computadora sin
 * Office, un .xlsx llega como `application/octet-stream` o sin tipo, y se
 * rechazaría un Excel perfectamente bueno.
 */
export function tipoDelArchivo(nombre: string, tipoDelNavegador: string): string {
  const extension = nombre.toLowerCase().split('.').pop();
  const generico = !tipoDelNavegador || tipoDelNavegador === 'application/octet-stream' || tipoDelNavegador === 'application/vnd.ms-excel';

  if (generico && extension === 'xlsx') return TIPO_XLSX;
  if (generico && extension === 'xlsm') return TIPO_XLSM;

  return tipoDelNavegador;
}
