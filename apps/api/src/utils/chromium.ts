/**
 * Render de PDF y PNG con NUESTRO propio Chromium, en el mismo servidor.
 *
 * Reemplaza a Cloudflare Browser Rendering, que es el mismo motor pero corriendo
 * en la red de Cloudflare. Eso trae tres problemas que este archivo elimina:
 *
 *  1. **El navegador remoto no alcanza nuestras imágenes.** En desarrollo los
 *     logos y las firmas viven en `http://localhost:9000` (MinIO), así que
 *     salían rotas en todos los PDF locales. Un navegador nuestro las ve.
 *  2. **Una credencial que falta apaga la función entera**, en silencio hasta
 *     que alguien descarga un archivo que no abre. Ya pasó en producción.
 *  3. **Cada certificado emitido es un viaje a un tercero** con los datos del
 *     alumno adentro.
 *
 * Es el mismo Chromium, así que la salida no cambia: lo que se imprimía sigue
 * imprimiéndose igual.
 */
import { chromium, type Browser, type LaunchOptions } from 'playwright';

import type { CloudflarePdfOptions, CloudflareViewport } from '@api/utils/cloudflare';

/**
 * Un render por vez.
 *
 * No es prudencia abstracta: el VPS **no tiene swap** (medido), así que no hay
 * red de contención debajo. Dos Chromium simultáneos son ~800 MB de pico y dos
 * núcleos peleándose; serializados son ~400 MB y un segundo de espera. Un
 * certificado se descarga de a uno, no es un endpoint de tráfico.
 */
let cola: Promise<unknown> = Promise.resolve();

function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  // El `catch` mantiene viva la cadena: sin él, un render que falla deja la
  // cola rechazada y todos los siguientes fallan sin siquiera intentarlo.
  const resultado = cola.then(tarea, tarea);
  cola = resultado.catch(() => undefined);

  return resultado;
}

/**
 * Tope duro. Sin swap, un render colgado no se degrada: se lleva puesto lo que
 * haya. Doce segundos es mucho más de lo que tarda una hoja (medido: ~1,5 s) y
 * mucho menos de lo que aguanta quien espera una descarga.
 */
const RENDER_TIMEOUT_MS = 12_000;

const LAUNCH_OPTIONS: LaunchOptions = {
  args: [
    /*
     * Ubuntu 24.04 bloquea los espacios de nombres de usuario sin privilegios
     * (`kernel.apparmor_restrict_unprivileged_userns=1`), que es justo lo que
     * necesita el sandbox de Chromium: con sandbox no arranca.
     *
     * Lo que se pierde acotado: el HTML lo generamos nosotros y los datos del
     * alumno van escapados. Lo remoto que carga la página son las imágenes que
     * subió la propia organización y las tipografías de Google.
     */
    '--no-sandbox',
    // /dev/shm por defecto es chico y Chromium lo llena; sin esto el render
    // muere con "Target crashed" en servidores, no en la máquina de nadie.
    '--disable-dev-shm-usage'
  ]
};

/**
 * Se abre y se cierra en cada render, en vez de mantener uno vivo.
 *
 * Un Chromium ocioso son ~120 MB permanentes en una caja compartida con otra
 * app. Arrancarlo cuesta ~400 ms sobre un render que ya tarda un segundo y
 * medio, y a cambio la memoria vuelve a cero entre certificado y certificado.
 */
async function conNavegador<T>(trabajo: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch(LAUNCH_OPTIONS).catch((error: unknown) => {
    /*
     * El binario no viaja con `pnpm install`: `pnpm.onlyBuiltDependencies` es
     * una lista blanca y playwright no está en ella, así que su postinstall
     * queda bloqueado. Lo baja `deploy-remote.sh` con un paso explícito.
     *
     * Sin este mensaje el síntoma es "Executable doesn't exist at ...", que no
     * dice nada sobre qué correr — y el momento en que aparece es cuando
     * alguien descarga un certificado, no cuando se despliega.
     */
    const detalle = error instanceof Error ? error.message : String(error);

    throw new Error(
      'No se pudo abrir el navegador que imprime los certificados. ' +
        'Instalalo con: pnpm --filter @cio/api exec playwright install chromium ' +
        '(y, la primera vez en un servidor, como root: npx playwright install-deps chromium). ' +
        `Detalle: ${detalle.slice(0, 300)}`
    );
  });

  try {
    return await trabajo(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * La página lista para imprimir: contenido puesto, estilos agregados, imágenes
 * y tipografías resueltas.
 *
 * Esperar las tipografías no es cosmético. El motor de ajuste de texto midió con
 * las métricas reales de cada fuente; si Chromium imprime antes de que lleguen,
 * imprime con la de reserva —otras métricas— y lo que entraba en su caja deja de
 * entrar. `document.fonts.ready` es lo único que lo sabe de verdad.
 */
async function prepararPagina(
  browser: Browser,
  html: string,
  styles: string | undefined,
  viewport?: CloudflareViewport
) {
  const page = await browser.newPage(
    viewport
      ? {
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor ?? 1
        }
      : {}
  );

  page.setDefaultTimeout(RENDER_TIMEOUT_MS);

  // `load` y no `networkidle`: una imagen que nunca responde deja networkidle
  // esperando hasta el timeout, y preferimos imprimir el certificado sin ese
  // logo antes que no entregar nada.
  await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });

  if (styles) {
    await page.addStyleTag({ content: styles });
  }

  await page
    .evaluate(async () => {
      await document.fonts.ready;

      // Las imágenes que ya fallaron no se esperan; `decode()` rechaza y se
      // ignora, que es exactamente "imprimí sin ella".
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? Promise.resolve() : img.decode().catch(() => undefined)
        )
      );
    })
    .catch(() => undefined);

  return page;
}

/** Un render vacío es la otra forma de entregar un archivo que no abre. */
function asegurarNoVacio(buffer: Buffer, kind: 'PDF' | 'PNG'): Buffer {
  if (buffer.byteLength === 0) {
    throw new Error(`El navegador devolvió un ${kind} vacío.`);
  }

  return buffer;
}

export async function getChromiumPdfBuffer(
  html: string,
  styles?: string,
  pdfOptions?: CloudflarePdfOptions
): Promise<Buffer> {
  return enCola(() =>
    conNavegador(async (browser) => {
      const page = await prepararPagina(browser, html, styles);

      const buffer = await page.pdf({
        // Los mismos valores que se le mandaban a Cloudflare, que a su vez los
        // reenviaba a Puppeteer: mismo motor, mismos nombres, misma salida.
        ...(pdfOptions?.preferCSSPageSize !== undefined ? { preferCSSPageSize: pdfOptions.preferCSSPageSize } : {}),
        ...(pdfOptions?.printBackground !== undefined ? { printBackground: pdfOptions.printBackground } : {}),
        ...(pdfOptions?.format ? { format: pdfOptions.format } : {}),
        ...(pdfOptions?.landscape !== undefined ? { landscape: pdfOptions.landscape } : {}),
        ...(pdfOptions?.margin ? { margin: pdfOptions.margin } : {}),
        ...(pdfOptions?.pageRanges ? { pageRanges: pdfOptions.pageRanges } : {})
      });

      return asegurarNoVacio(buffer, 'PDF');
    })
  );
}

export async function getChromiumPngBuffer(
  html: string,
  styles?: string,
  viewport?: CloudflareViewport
): Promise<Buffer> {
  return enCola(() =>
    conNavegador(async (browser) => {
      const page = await prepararPagina(browser, html, styles, viewport);
      const buffer = await page.screenshot({ type: 'png' });

      return asegurarNoVacio(buffer, 'PNG');
    })
  );
}
