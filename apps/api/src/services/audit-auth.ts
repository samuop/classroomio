/**
 * Escribe en la auditoría lo que avisa el ingreso: sesiones que empiezan y
 * terminan, intentos fallidos y cambios de cuenta.
 *
 * Qué fila sale de cada aviso lo decide `utils/audit-auth-map.ts`; acá sólo se
 * agrega lo que el aviso no trae (la IP y el navegador desde los headers, y el
 * email de quien entró) y se escribe. Como toda la auditoría, nunca tira.
 */

import { escucharIngresos, type AvisoDeIngreso } from '@cio/db/auth/audit-bridge';
import { getProfileById } from '@cio/db/queries/auth';

import { clientInfoFromHeaders } from '@api/utils/client-info';
import { describirAvisoDeIngreso } from '@api/utils/audit-auth-map';
import { recordEvent, recordIncident } from '@api/services/audit';

async function emailDe(userId: string | null): Promise<string | null> {
  if (!userId) return null;

  try {
    const perfil = await getProfileById(userId);

    return perfil?.email ?? null;
  } catch {
    return null;
  }
}

export async function registrarAvisoDeIngreso(aviso: AvisoDeIngreso): Promise<void> {
  try {
    const registro = describirAvisoDeIngreso(aviso);
    if (!registro) return;

    const cliente = clientInfoFromHeaders(aviso.headers ?? new Headers());
    const userLabel = registro.userLabel ?? (await emailDe(registro.userId));

    if (registro.destino === 'incidencia') {
      await recordIncident({
        kind: registro.kind,
        source: 'BACKEND',
        message: registro.message,
        code: registro.code,
        status: registro.status,
        route: registro.route,
        method: registro.method,
        userId: registro.userId,
        userLabel,
        sessionId: registro.sessionId,
        metadata: registro.metadata,
        ip: cliente.ip,
        device: cliente.device,
        browser: cliente.browser,
        userAgent: cliente.userAgent
      });
      return;
    }

    await recordEvent({
      orgId: null,
      userId: registro.userId,
      userLabel,
      userRole: null,
      orgRole: null,
      sessionId: registro.sessionId,
      action: registro.action,
      metadata: registro.metadata,
      ip: cliente.ip,
      device: cliente.device,
      browser: cliente.browser,
      userAgent: cliente.userAgent,
      method: registro.method,
      route: registro.route,
      status: registro.status,
      durationMs: null,
      // Cada ingreso y cada cambio de cuenta es un hecho distinto: la ventana
      // anti-repetición es para lecturas que el dashboard repite solo.
      always: true
    });
  } catch (error) {
    console.error('[audit] no se pudo registrar el aviso del ingreso', aviso.tipo, error);
  }
}

/** Se llama una vez, al armar la app. */
export function escucharIngresosEnLaAuditoria(): void {
  escucharIngresos(registrarAvisoDeIngreso);
}
