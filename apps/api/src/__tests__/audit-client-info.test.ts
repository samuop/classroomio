/**
 * De dónde viene un request y con qué entra.
 *
 * Importa que esté bajo prueba porque es un dato del que después se sacan
 * conclusiones ("este acceso vino de otro lado"), y porque la cascada de headers
 * depende de la forma exacta de ESTE despliegue: Cloudflare → Nginx → dashboard
 * (adapter-node) → API. Cada salto reescribe algo, y elegir mal el orden hace que
 * todo el mundo aparezca conectándose desde 127.0.0.1.
 *
 * Las IPs de ejemplo son de `203.0.113.0/24` (TEST-NET-3, RFC 5737), que existe
 * justamente para documentación y no le pertenece a nadie. Acá había IPs reales
 * capturadas verificando contra el servidor: este repositorio es público, así
 * que eso deja la dirección de una persona indexada para siempre. Al agregar
 * casos, sacá la dirección de ese rango.
 */
import { describe, expect, it } from 'vitest';

import { clientInfoFromHeaders, ipFromHeaders, normalizeIp, parseUserAgent } from '@api/utils/client-info';

const headers = (values: Record<string, string>) => new Headers(values);

describe('ipFromHeaders', () => {
  it('prefiere la IP que pone Cloudflare', () => {
    const ip = ipFromHeaders(
      headers({ 'cf-connecting-ip': '203.0.113.10', 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '127.0.0.1' })
    );

    expect(ip).toBe('203.0.113.10');
  });

  it('toma la primera entrada de x-forwarded-for, que es la del cliente', () => {
    expect(ipFromHeaders(headers({ 'x-forwarded-for': '203.0.113.10, 172.68.1.1' }))).toBe('203.0.113.10');
  });

  it('deja x-real-ip para el final', () => {
    // En el salto dashboard → API, Nginx pone ahí 127.0.0.1. Priorizarlo haría
    // que TODOS los requests autenticados figuraran viniendo del propio servidor.
    expect(ipFromHeaders(headers({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '127.0.0.1' }))).toBe(
      '203.0.113.10'
    );
    expect(ipFromHeaders(headers({ 'x-real-ip': '10.0.0.4' }))).toBe('10.0.0.4');
  });

  it('devuelve null cuando no hay ninguno, en vez de inventar', () => {
    expect(ipFromHeaders(headers({}))).toBeNull();
  });

  it('ignora un header vacío y sigue bajando la cascada', () => {
    expect(ipFromHeaders(headers({ 'cf-connecting-ip': '   ', 'x-forwarded-for': '203.0.113.10' }))).toBe(
      '203.0.113.10'
    );
  });

  it('con la primera entrada de x-forwarded-for vacía, baja a x-real-ip y no promueve al proxy', () => {
    // `$proxy_add_x_forwarded_for` de Nginx APENDEA su `$remote_addr` a lo que
    // haya. Si lo que había estaba vacío, queda ", <edge de Cloudflare>": el
    // lugar del cliente vino en blanco. Tomar la segunda entrada devolvería la
    // IP de Cloudflare presentándola como la de la persona, que es peor que no
    // saber. Se baja un escalón más de la cascada.
    expect(ipFromHeaders(headers({ 'x-forwarded-for': ' , 172.68.1.1', 'x-real-ip': '10.0.0.4' }))).toBe(
      '10.0.0.4'
    );
    expect(ipFromHeaders(headers({ 'x-forwarded-for': ' , 172.68.1.1' }))).toBeNull();
  });
});

describe('normalizeIp', () => {
  it('normaliza las IPv4 sobre sockets IPv6', () => {
    // La misma máquina no puede aparecer escrita de dos formas distintas, o
    // agrupar por IP deja de servir.
    expect(normalizeIp('::ffff:203.0.113.24')).toBe('203.0.113.24');
  });

  it('recorta lo que venga: el header lo controla quien llama', () => {
    expect(normalizeIp('x'.repeat(500))).toHaveLength(45);
  });

  it('trata el vacío como ausencia', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp('   ')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe('parseUserAgent', () => {
  it('no confunde Edge con Chrome', () => {
    // Edge, Opera y Samsung se anuncian como Chrome; Chrome se anuncia como
    // Safari. El orden de la lista ES la lógica.
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120';

    expect(parseUserAgent(edge)).toEqual({ device: 'Windows', browser: 'Edge' });
  });

  it('no confunde Chrome con Safari', () => {
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

    expect(parseUserAgent(chrome)).toEqual({ device: 'Mac', browser: 'Chrome' });
  });

  it('reconoce el Safari de un iPhone', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

    expect(parseUserAgent(iphone)).toEqual({ device: 'iPhone', browser: 'Safari' });
  });

  it('marca como Servidor los pedidos del propio SvelteKit', () => {
    // El dashboard llama a la API desde su proceso de Node en los `load` de
    // servidor. Distinguirlo evita leer "sin navegador" como "algo raro".
    expect(parseUserAgent('node')).toEqual({ device: null, browser: 'Servidor' });
    expect(parseUserAgent('undici')).toEqual({ device: null, browser: 'Servidor' });
  });

  it('devuelve null cuando no reconoce, en vez de inventar un "Desconocido"', () => {
    // Un null en la base dice "no lo pudimos determinar", que es la verdad. El
    // User-Agent crudo queda guardado aparte para poder mirarlo a mano.
    expect(parseUserAgent('')).toEqual({ device: null, browser: null });
    expect(parseUserAgent('curl/8.4.0')).toEqual({ device: null, browser: null });
    expect(parseUserAgent(null)).toEqual({ device: null, browser: null });
  });
});

describe('clientInfoFromHeaders', () => {
  it('resuelve todo de una pasada', () => {
    const info = clientInfoFromHeaders(
      headers({
        'cf-connecting-ip': '203.0.113.10',
        'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'
      })
    );

    expect(info).toEqual({
      ip: '203.0.113.10',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36',
      device: 'Android',
      browser: 'Chrome'
    });
  });

  it('recorta el User-Agent antes de persistirlo', () => {
    const info = clientInfoFromHeaders(headers({ 'user-agent': 'x'.repeat(2000) }));

    expect(info.userAgent).toHaveLength(512);
  });

  it('sobrevive a un request sin ningún header', () => {
    expect(clientInfoFromHeaders(headers({}))).toEqual({
      ip: null,
      userAgent: null,
      device: null,
      browser: null
    });
  });
});
