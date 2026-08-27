/**
 * A donde puede volver un enlace de correo.
 *
 * Un cliente entra por su propio dominio (`learn.<cliente>.com.ar`) y pide
 * recuperar su contrasena. El correo llega —eso funcionaba— pero el enlace del
 * correo moria en 403 `INVALID_CALLBACK_URL`, y no habia nada que relacionara
 * las dos mitades: te avisaba "te mandamos el enlace" y despues el enlace no
 * llevaba a ningun lado.
 *
 * La causa es que las dos mitades viajan distinto. El pedido lo hace el
 * navegador desde la pagina, asi que lleva cabecera `Origin` y el dominio
 * verificado se reconocia. **El clic en el correo no lleva `Origin`**: es una
 * navegacion de primer nivel. Sin esa cabecera no habia nada que resolver, y la
 * unica lista que quedaba era la estatica, donde el dominio del cliente no
 * estaba.
 *
 * Por eso estos tests preguntan siempre por el caso SIN cabecera: es el unico
 * que reproduce el clic en el correo.
 */
import { beforeEach, describe, expect, it } from 'vitest';

// Antes de importar: los dos modulos leen el entorno al cargarse.
process.env.PUBLIC_TENANT_ROOT_DOMAIN = 'tensor.com.ar';
process.env.TRUSTED_ORIGINS = 'https://learn.tensor.com.ar';

const { buildTrustedOrigins, trustCustomDomainHostname, untrustCustomDomainHostname } = await import(
  '@cio/db/utils'
);

const DOMINIO_DEL_CLIENTE = 'aprende.clientedemo.com.ar';
const SIN_CABECERA = null; // el clic en el correo

/**
 * Si Better Auth aceptaria `origin` con esta lista. Repite la semantica de
 * comodin de la lista de confianza (`https://*.raiz`), que es lo unico que
 * distingue "esta permitido" de "aparece escrito ahi": una entrada exacta
 * coincide entera, y una con `*` coincide por los extremos.
 */
function aceptaria(origins: string[], origin: string): boolean {
  return origins.some((entry) => {
    if (!entry.includes('*')) return entry === origin;

    const [prefijo, sufijo] = entry.split('*');

    return (
      origin.startsWith(prefijo) && origin.endsWith(sufijo) && origin.length >= prefijo.length + sufijo.length
    );
  });
}

beforeEach(() => {
  untrustCustomDomainHostname(DOMINIO_DEL_CLIENTE);
});

describe('el enlace del correo, que llega sin cabecera Origin', () => {
  it('puede volver al dominio propio del cliente si esta verificado', () => {
    trustCustomDomainHostname(DOMINIO_DEL_CLIENTE);

    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), `https://${DOMINIO_DEL_CLIENTE}`)).toBe(true);
  });

  it('deja de poder volver apenas se desverifica el dominio', () => {
    trustCustomDomainHostname(DOMINIO_DEL_CLIENTE);
    untrustCustomDomainHostname(DOMINIO_DEL_CLIENTE);

    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), `https://${DOMINIO_DEL_CLIENTE}`)).toBe(false);
  });

  it('puede volver a la empresa que vive en un subdominio nuestro', () => {
    // Mismo agujero, otra puerta: sin cabecera tampoco se consultaba si el host
    // era de primera parte, asi que un tenant en `<empresa>.<raiz>` chocaba
    // contra la misma pared que el dominio propio.
    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), 'https://empresa-demo.tensor.com.ar')).toBe(true);
  });

  it('sigue pudiendo volver al dominio principal', () => {
    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), 'https://learn.tensor.com.ar')).toBe(true);
  });
});

describe('lo que no se abre por arreglar esto', () => {
  it('no confia en un dominio que nadie verifico', () => {
    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), 'https://learn.impostor.com.ar')).toBe(false);
  });

  it('verificar un dominio no habilita a sus hermanos', () => {
    // El dominio propio entra EXACTO, no como comodin: que el cliente pruebe
    // que controla `learn.cliente.com` no dice nada sobre lo que cuelgue de
    // `otra.cliente.com`, que puede ser de cualquiera.
    trustCustomDomainHostname(DOMINIO_DEL_CLIENTE);

    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), 'https://otra.clientedemo.com.ar')).toBe(false);
  });

  it('no confia en el mismo dominio por http', () => {
    trustCustomDomainHostname(DOMINIO_DEL_CLIENTE);

    expect(aceptaria(buildTrustedOrigins(SIN_CABECERA), `http://${DOMINIO_DEL_CLIENTE}`)).toBe(false);
  });
});

describe('el camino que ya funcionaba', () => {
  it('sigue aceptando el origen del navegador cuando la cabecera viene', () => {
    trustCustomDomainHostname(DOMINIO_DEL_CLIENTE);

    const origins = buildTrustedOrigins(`https://${DOMINIO_DEL_CLIENTE}`);

    expect(aceptaria(origins, `https://${DOMINIO_DEL_CLIENTE}`)).toBe(true);
  });

  it('ignora una cabecera Origin de un dominio ajeno', () => {
    const origins = buildTrustedOrigins('https://learn.impostor.com.ar');

    expect(aceptaria(origins, 'https://learn.impostor.com.ar')).toBe(false);
  });
});
