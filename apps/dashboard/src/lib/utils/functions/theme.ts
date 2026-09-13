import { darken, lighten } from 'color2k';

import { tc } from '$lib/utils/functions/trycatch';

/** Un nombre de tema (`blue`, `purple`) o un color hexadecimal: lo único que `setTheme` sabe pintar. */
const PARECE_UN_TEMA = /^(#[0-9a-f]{3,8}|[a-z][a-z-]*)$/i;

/**
 * El color con el que arranca la pantalla, antes de saber en qué empresa está el usuario.
 *
 * Al cargar sólo se conoce la empresa dueña del dominio; la del usuario llega con
 * la lista de sus empresas (`init.svelte.ts`), medio segundo después. En el
 * dominio de una consultora conviven la consultora y sus empresas cliente, así
 * que pintar primero a la dueña hacía que un estudiante de una empresa cliente
 * viera la marca de la consultora y enseguida la suya.
 *
 * Con sesión se arranca con el último color pintado en este dominio (`setTheme`
 * lo guarda). localStorage es por origen, así que nunca trae la marca de otro
 * dominio. Sin sesión —el login— la pantalla es de la dueña del dominio.
 */
export function temaInicial({
  temaDelDominio,
  temaGuardado,
  conSesion
}: {
  temaDelDominio?: string | null;
  temaGuardado?: string | null;
  conSesion: boolean;
}): string {
  if (conSesion && temaGuardado && PARECE_UN_TEMA.test(temaGuardado)) return temaGuardado;

  return temaDelDominio || 'blue';
}

/** El último color pintado en este dominio, o null si el almacenamiento no está disponible. */
export function leerTemaGuardado(): string | null {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

export function setTheme(theme: string = '') {
  localStorage.setItem('theme', theme);

  if (theme?.includes('#')) {
    const escapedHex = theme.replace(/"/g, '\\"');
    document.body.setAttribute('data-theme', escapedHex);

    injectCustomTheme(escapedHex);
  } else {
    document.body.setAttribute('data-theme', theme);
  }
}

// Handle this functions in a try catch if hex is not valid.
const _lighten = (hex: string, no: number) => tc(() => lighten(hex, no), hex);
const _darken = (hex: string, no: number) => tc(() => darken(hex, no), hex);

export function injectCustomTheme(hex: string) {
  // Generate shades using color2k's lighten/darken functions
  // Following the same pattern as predefined themes (e.g., purple)
  const shades = {
    50: _lighten(hex, 0.7),
    100: _lighten(hex, 0.6),
    200: _lighten(hex, 0.5),
    300: _lighten(hex, 0.4),
    400: _lighten(hex, 0.3),
    500: _lighten(hex, 0.2),
    600: _lighten(hex, 0.1),
    700: hex,
    800: _darken(hex, 0.1),
    900: _darken(hex, 0.2)
  };

  const styleContent = `
    body[data-theme="${hex}"] {
      --primary: ${shades[700]};
      --primary-foreground: ${shades[50]};
      --ring: ${shades[400]};
      --chart-1: ${shades[300]};
      --chart-2: ${shades[500]};
      --chart-3: ${shades[600]};
      --chart-4: ${shades[700]};
      --chart-5: ${shades[800]};
      --sidebar-primary: ${shades[700]};
      --sidebar-primary-foreground: ${shades[50]};
      --sidebar-accent: ${shades[50]};
      --sidebar-accent-foreground: ${shades[700]};
      --sidebar-ring: ${shades[400]};
    }

    body.dark[data-theme="${hex}"],
    html.dark body[data-theme="${hex}"] {
      --primary: ${shades[500]};
      --primary-foreground: ${shades[50]};
      --ring: ${shades[900]};
      --sidebar-primary: ${shades[500]};
      --sidebar-primary-foreground: ${shades[50]};
      --sidebar-accent: oklch(0.268 0.007 34.298);
      --sidebar-accent-foreground: ${shades[500]};
      --sidebar-ring: ${shades[900]};
    }
  `;

  const styleElement = document.createElement('style');
  styleElement.innerHTML = styleContent;
  document.head.appendChild(styleElement);
}
