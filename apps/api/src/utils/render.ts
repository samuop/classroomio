/**
 * Quién dibuja los PDF y los PNG.
 *
 * Hay dos motores y son EL MISMO Chromium: uno corre acá y el otro en la red de
 * Cloudflare. Por eso se pueden intercambiar sin que la salida cambie, y por eso
 * la elección es una variable de entorno y no una reescritura.
 *
 * `chromium` es el valor por defecto: no necesita credenciales, alcanza las
 * imágenes que servimos nosotros —incluido `localhost` en desarrollo, que es
 * donde Cloudflare siempre falló— y no manda los datos del alumno a un tercero.
 * `cloudflare` queda como salida de emergencia si un día el servidor no puede
 * con el navegador.
 */
import { CLOUDFLARE } from '@api/constants';
import { getChromiumPdfBuffer, getChromiumPngBuffer } from '@api/utils/chromium';
import {
  getCloudflarePdfBuffer,
  getCloudflarePngBuffer,
  isCertificateRenderConfigured,
  type CloudflarePdfOptions,
  type CloudflareViewport
} from '@api/utils/cloudflare';

export type RenderPdfOptions = CloudflarePdfOptions;
export type RenderViewport = CloudflareViewport;

export type RenderEngine = 'chromium' | 'cloudflare';

/**
 * Cualquier valor que no sea exactamente `cloudflare` cae en `chromium`.
 *
 * A propósito en esa dirección: una variable mal escrita deja el motor que
 * funciona sin configurar nada, en vez de apagar la exportación entera —que es
 * el modo de falla que ya se vivió, y que se ve como una función rota y no como
 * una función sin configurar.
 */
export function activeRenderEngine(): RenderEngine {
  return process.env.CERTIFICATE_RENDERER?.trim().toLowerCase() === 'cloudflare' ? 'cloudflare' : 'chromium';
}

/**
 * Si este despliegue puede exportar.
 *
 * Con Chromium la respuesta es siempre sí: el navegador viaja con el código. Es
 * el motor de Cloudflare el que puede quedar a medio configurar.
 */
export function isRenderConfigured(): boolean {
  return activeRenderEngine() === 'chromium' || isCertificateRenderConfigured();
}

export const RENDER_UNCONFIGURED_MESSAGE =
  'La exportación por Cloudflare no está configurada: faltan CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_RENDERING_API_KEY. ' +
  'Alternativa: quitar CERTIFICATE_RENDERER=cloudflare para usar el navegador del propio servidor.';

export async function renderPdf(html: string, styles?: string, pdfOptions?: RenderPdfOptions): Promise<Buffer> {
  if (activeRenderEngine() === 'cloudflare') {
    return getCloudflarePdfBuffer(html, styles, pdfOptions);
  }

  return getChromiumPdfBuffer(html, styles, pdfOptions);
}

export async function renderPng(html: string, styles?: string, viewport?: RenderViewport): Promise<Buffer> {
  if (activeRenderEngine() === 'cloudflare') {
    return getCloudflarePngBuffer(html, styles, viewport);
  }

  return getChromiumPngBuffer(html, styles, viewport);
}

/** Sólo para el mensaje de diagnóstico; nadie decide nada con esto. */
export function renderEngineLabel(): string {
  return activeRenderEngine() === 'cloudflare'
    ? `Cloudflare Browser Rendering (cuenta ${CLOUDFLARE.CONFIGS.ACCOUNT_ID ? 'configurada' : 'SIN configurar'})`
    : 'Chromium del propio servidor';
}
