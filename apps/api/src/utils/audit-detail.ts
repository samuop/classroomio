import type { Context } from 'hono';

import type { AuditDetail } from '@api/types/auth';

/**
 * Suma datos a la fila de auditoría de este request.
 *
 * Se puede llamar varias veces: cada llamada completa lo anterior y la metadata
 * se mezcla. No escribe nada por sí sola; el middleware lo lee al terminar, y si
 * el request falló la fila va como incidencia con esa misma metadata.
 */
export function anotarAuditoria(c: Context, detalle: AuditDetail): void {
  const previo = (c.get('auditDetail') as AuditDetail | null | undefined) ?? null;

  c.set('auditDetail', {
    ...previo,
    ...detalle,
    metadata: previo?.metadata || detalle.metadata ? { ...previo?.metadata, ...detalle.metadata } : undefined
  });
}
