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

function dibujar(cacheStatus?: DocumentCacheStatus) {
  return render(SourceCard, {
    props: { source: FUENTE, cacheStatus, onDelete: () => {}, onRefresh: () => {} }
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
