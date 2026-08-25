import { EMAIL_BRAND_NAME } from '@cio/email';
import { getRootOrganizationName } from '@cio/db/queries/organization';

/**
 * Con qué nombre se firma un correo que sale por una empresa.
 *
 * **No es el nombre de la empresa, es el de su consultora.** Una alumna de una
 * empresa cliente está recibiendo la formación de la consultora que se la
 * entrega, no de su propio empleador: el correo tiene que decir el nombre de la
 * consultora. Además es el que coincide con el dominio del remitente, así que el
 * destinatario ve un nombre y un dominio que van juntos.
 *
 * Una empresa sin madre se firma a sí misma. Por eso Tensor Tech, que es su
 * propia raíz, sigue firmando "Tensor Tech".
 *
 * La regla sale de la jerarquía y no de una lista de nombres: sumar una
 * consultora nueva con sus clientes no toca este archivo.
 */

/**
 * El nombre de la raíz cambia sólo si alguien renombra una empresa o mueve una
 * de consultora, que pasa como mucho un par de veces al año. Sin caché, cada
 * correo pagaría una consulta recursiva; con ella, un envío masivo a 40 alumnos
 * hace una sola.
 *
 * Diez minutos y no "para siempre": un renombre tiene que llegar solo, sin
 * reiniciar la API, y diez minutos de nombre viejo en un correo no le arruinan
 * el día a nadie.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { nombre: string; vence: number }>();

/** Para los tests, y para cuando alguien renombre una empresa y no quiera esperar. */
export function clearSenderNameCache(): void {
  cache.clear();
}

export async function resolveSenderName(orgId: string | null | undefined): Promise<string> {
  if (!orgId) return EMAIL_BRAND_NAME;

  const enCache = cache.get(orgId);
  if (enCache && enCache.vence > Date.now()) return enCache.nombre;

  try {
    const raiz = await getRootOrganizationName(orgId);
    const nombre = raiz?.trim() || EMAIL_BRAND_NAME;

    cache.set(orgId, { nombre, vence: Date.now() + CACHE_TTL_MS });

    return nombre;
  } catch (error) {
    // Un correo firmado con la marca del despliegue es mucho mejor que un correo
    // que no sale. Esto corre dentro del envío, no puede tumbarlo.
    console.error(`resolveSenderName(${orgId}) falló; se firma con la marca por defecto:`, error);

    return EMAIL_BRAND_NAME;
  }
}
