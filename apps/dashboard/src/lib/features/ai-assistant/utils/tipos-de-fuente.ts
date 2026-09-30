/**
 * Qué archivos se pueden subir como fuente de un curso.
 *
 * En un solo lugar porque eran tres copias —el diálogo de fuentes, el adjunto
 * del chat y el asistente de creación— y agregar Excel en una sola dejaba las
 * otras dos rechazándolo.
 */
export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TIPO_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export const TIPOS_DE_FUENTE = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  TIPO_XLSX,
  TIPO_XLSM
] as const;

/** Para el `accept` del selector de archivos: extensiones y tipos. */
export const ACEPTA_FUENTES = ['.pdf', '.docx', '.pptx', '.xlsx', '.xlsm', ...TIPOS_DE_FUENTE].join(',');

/**
 * El tipo de un archivo, mirando también su extensión.
 *
 * El navegador toma el tipo del sistema operativo: en una computadora sin
 * Office un .xlsx llega sin tipo o como `application/octet-stream`, y se
 * rechazaba un Excel perfectamente bueno. El servidor hace lo mismo.
 */
export function tipoDeLaFuente(archivo: Pick<File, 'name' | 'type'>): string {
  const extension = archivo.name.toLowerCase().split('.').pop();
  const generico = !archivo.type || archivo.type === 'application/octet-stream' || archivo.type === 'application/vnd.ms-excel';

  if (generico && extension === 'xlsx') return TIPO_XLSX;
  if (generico && extension === 'xlsm') return TIPO_XLSM;

  return archivo.type;
}

export function esFuenteAceptada(archivo: Pick<File, 'name' | 'type'>): boolean {
  return (TIPOS_DE_FUENTE as readonly string[]).includes(tipoDeLaFuente(archivo));
}

export function esPlanilla(mimeType: string | null | undefined): boolean {
  return mimeType === TIPO_XLSX || mimeType === TIPO_XLSM;
}
