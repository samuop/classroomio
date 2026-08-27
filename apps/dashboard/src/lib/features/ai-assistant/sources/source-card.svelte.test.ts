import { render, screen } from '@testing-library/svelte';

import SourceCard from './source-card.svelte';
import type { CourseSource, DocumentCacheStatus } from '../utils/types';

/**
 * La tarjeta de una fuente dice si ya fue leída. Nada más.
 *
 * Antes contaba el mecanismo: "Leída de caché hace 3 min · 110.464 fichas".
 * Eso es cómo funciona la plataforma por dentro —que exista una caché de
 * contexto, cuándo se evictó, cuánto costó— y no algo sobre lo que quien arma
 * un curso pueda hacer nada.
 *
 * El test mira **el texto que la tarjeta dibuja**, no una función: la regla es
 * "esto no se muestra", y eso sólo se puede comprobar mirando lo mostrado.
 */

const FUENTE: CourseSource = {
  id: 'src-1',
  conversationId: 'conv-1',
  courseId: 'curso-1',
  assetId: null,
  sourceUrl: null,
  downloadUrl: null,
  fileName: 'manual-de-seguridad.pdf',
  mimeType: 'application/pdf',
  wordCount: 4200,
  pageCount: 18,
  createdAt: '2026-08-01T10:00:00.000Z'
};

function estado(cambios: Partial<DocumentCacheStatus> = {}): DocumentCacheStatus {
  return {
    documentId: 'src-1',
    cached: true,
    provider: 'gemini',
    expireAt: null,
    secondsRemaining: null,
    observedAt: '2026-08-26T10:00:00.000Z',
    observedSecondsAgo: 220,
    lastCacheReadTokens: 110_464,
    ...cambios
  };
}

function dibujar(cacheStatus?: DocumentCacheStatus, cambios: Partial<CourseSource> = {}) {
  return render(SourceCard, {
    props: { source: { ...FUENTE, ...cambios }, cacheStatus, onDelete: () => {}, onRefresh: () => {} }
  });
}

describe('tarjeta de una fuente', () => {
  it('marca que se leyó, y punto', () => {
    const { container } = dibujar(estado());
    const texto = container.textContent ?? '';

    expect(screen.getByText('Leída')).toBeInTheDocument();

    // Ni el mecanismo, ni cuándo, ni cuánto costó.
    expect(texto).not.toMatch(/cach[ée]/i);
    expect(texto).not.toMatch(/min/);
    expect(texto).not.toContain('110.464');
    expect(texto).not.toContain('110,464');
    expect(texto).not.toMatch(/ficha/i);
  });

  it('sin lecturas todavía no muestra ninguna marca', () => {
    // Una fuente recién subida no tiene marca, y esa ausencia ya dice lo suyo
    // sin agregar una línea que haya que explicar.
    const { container } = dibujar(estado({ cached: false, observedSecondsAgo: null }));

    expect(container.textContent).not.toContain('Leída');
  });

  it('con estado a medias tampoco inventa una marca', () => {
    // `cached: true` pero sin observación es "no sabemos": marcarla como leída
    // sería afirmar algo que nadie comprobó.
    const { container } = dibujar(estado({ observedSecondsAgo: null }));

    expect(container.textContent).not.toContain('Leída');
  });

  it('sigue mostrando lo que sí le sirve a la persona', () => {
    const { container } = dibujar(estado());

    expect(screen.getByTitle('manual-de-seguridad.pdf')).toBeInTheDocument();
    expect(container.textContent).toContain('18');
  });
});

/**
 * De donde se saca el ORIGINAL de una fuente.
 *
 * Son dos casos y no se pisan: una pagina web se abre donde vive, un archivo
 * subido se baja del almacenamiento. Antes no habia ninguno de los dos: la
 * pagina se guardaba con el dominio metido en el nombre —"Colorimetria
 * (wikipedia.org)"— y de ahi no se podia volver, y el PDF que habia subido el
 * docente no se podia recuperar aunque el archivo estuviera guardado.
 *
 * Estos tests miran el enlace DIBUJADO y a donde apunta, porque la regla es
 * exactamente esa: que se pueda llegar al original de un clic.
 */
describe('volver al original', () => {
  it('una pagina web se abre en su direccion', () => {
    dibujar(undefined, {
      sourceUrl: 'https://es.wikipedia.org/wiki/Colorimetr%C3%ADa',
      mimeType: 'text/markdown',
      fileName: 'Colorimetria (es.wikipedia.org)'
    });

    const enlace = screen.getByRole('link', { name: /Colorimetria/ });

    expect(enlace).toHaveAttribute('href', 'https://es.wikipedia.org/wiki/Colorimetr%C3%ADa');
    // Sin esto, abrir la fuente saca al docente del curso que esta armando.
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('de una pagina muestra el dominio, no el mime', () => {
    // "text/markdown" es como la guardamos nosotros; el dominio es de donde
    // salio el material, que es lo unico que le sirve a quien mira la lista.
    const { container } = dibujar(undefined, {
      sourceUrl: 'https://www.datacolor.com/guia',
      mimeType: 'text/markdown',
      fileName: 'Guia de color (datacolor.com)'
    });

    expect(container.textContent).toContain('datacolor.com');
    expect(container.textContent).not.toContain('text/markdown');
    // Y `www.` no aporta nada.
    expect(container.textContent).not.toContain('www.datacolor.com');
  });

  it('un archivo subido se descarga del enlace firmado', () => {
    dibujar(undefined, { assetId: 'asset-1', downloadUrl: 'https://almacen.example/firmado?sig=abc' });

    const enlace = screen.getByRole('link', { name: 'Descargar el archivo original' });

    expect(enlace).toHaveAttribute('href', 'https://almacen.example/firmado?sig=abc');
  });

  it('sin enlace ni descarga no dibuja ningun enlace', () => {
    // El caso de las fuentes viejas, guardadas antes de que existiera la
    // columna: la tarjeta tiene que seguir funcionando, sin un boton que no
    // lleve a ninguna parte.
    dibujar();

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('una pagina web NO ofrece descarga: no hay archivo que bajar', () => {
    // El servidor no guarda copia de una pagina. Si la tarjeta mostrara el boton
    // igual, el clic terminaria en un enlace vacio.
    dibujar(undefined, {
      sourceUrl: 'https://es.wikipedia.org/wiki/Colorimetr%C3%ADa',
      downloadUrl: 'https://almacen.example/no-deberia-usarse'
    });

    expect(screen.queryByRole('link', { name: 'Descargar el archivo original' })).toBeNull();
  });

  it('la fecha sale del formateador de la plataforma, no del navegador', () => {
    const { container } = dibujar();

    // Antes era `toLocaleDateString()` sin argumentos: idioma y zona horaria del
    // navegador, o sea la misma fuente fechada distinto segun quien la mire, y
    // en la zona equivocada para cualquier cosa de la madrugada.
    //
    // Lo que se fija es la FORMA que impone `formatDisplayDate` ("1 de ago de
    // 2026"), no el nombre del mes: el mes lo traduce dayjs y en este arnes el
    // locale no siempre queda registrado como en el navegador. Atarlo a "ago"
    // seria un test que mide la biblioteca, no la tarjeta.
    expect(container.textContent).toMatch(/\d{1,2} de \w+ de 2026/);
    expect(container.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });
});
