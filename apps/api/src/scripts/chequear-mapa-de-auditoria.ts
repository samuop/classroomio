/**
 * ¿Cada entrada del mapa de auditoría corresponde a una ruta que existe?
 *
 *   pnpm --filter @cio/api audit:check-map
 *
 * Una entrada con la ruta mal escrita no falla, no rompe nada y nunca se dispara:
 * la acción queda con su nombre genérico o, si era una lectura, directamente no se
 * registra. La primera vez que se corrió encontró tres así (`/organization/clients`,
 * `POST /organization/keys` y `PUT /account/user`), declaradas desde el principio.
 *
 * Carga la app entera para leer sus rutas, por eso no es un test de vitest: esa
 * importación no resuelve bajo vitest. No hace falta base ni Redis levantados.
 */
import { app } from '@api/app';
import { AUDITED_READS, WRITE_ACTION_NAMES } from '@api/utils/audit-map';

const normalizar = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':param');

const reales = new Set(app.routes.map((ruta) => `${ruta.method} ${normalizar(ruta.path)}`));

const muertas = [
  ...AUDITED_READS.map((lectura) => ({ clave: `GET ${lectura.pattern}`, accion: lectura.action })),
  ...WRITE_ACTION_NAMES.map((escritura) => ({ clave: `${escritura.method} ${escritura.pattern}`, accion: escritura.action }))
].filter(({ clave }) => {
  const [metodo, patron] = clave.split(' ');

  return !reales.has(`${metodo} ${normalizar(patron!)}`);
});

if (muertas.length > 0) {
  console.error(`Entradas del mapa de auditoría sin ruta real (${muertas.length}):`);
  for (const { clave, accion } of muertas) console.error(`  ${clave}  →  ${accion}`);
  process.exit(1);
}

console.log(`Mapa de auditoría: ${AUDITED_READS.length + WRITE_ACTION_NAMES.length} entradas, todas con ruta real.`);
process.exit(0);
