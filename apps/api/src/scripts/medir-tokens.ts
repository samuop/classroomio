/**
 * Mide el chequeo determinista de tokens contra lecciones ya escritas.
 *
 * Es el par de `medir-fundamento.ts`: el mismo material y las mismas lecciones,
 * para poder decir qué caza cada mitad. No llama a ningún proveedor, así que se
 * puede correr todas las veces que haga falta.
 *
 *   pnpm --filter @cio/api exec tsx src/scripts/medir-tokens.ts --dir <carpeta>
 *
 * La carpeta lleva un `manifiesto-tokens.json`:
 *
 *   { "fuentes":   [ { "fileName": "...", "archivo": "fuente.txt" } ],
 *     "lecciones": [ { "titulo": "...", "archivo": "leccion.html" } ] }
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { textoParaTokens, verificarTokens } from '@api/services/agent/grounding-tokens';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1];

if (!args.includes('--dir') || !dir) {
  console.error('falta --dir <carpeta con manifiesto-tokens.json>');
  process.exit(2);
}

interface Manifiesto {
  fuentes: { fileName: string; archivo: string }[];
  lecciones: { titulo: string; archivo: string }[];
}

const manifiesto: Manifiesto = JSON.parse(readFileSync(join(dir, 'manifiesto-tokens.json'), 'utf8'));

const fuentes = manifiesto.fuentes.map((f) => ({
  fileName: f.fileName,
  text: readFileSync(join(dir, f.archivo), 'utf8')
}));

const palabras = fuentes.reduce((n, f) => n + f.text.split(/\s+/).filter(Boolean).length, 0);
console.log(`fuentes: ${fuentes.map((f) => f.fileName).join(', ')} (${palabras} palabras en total)\n`);

let total = 0;

for (const leccion of manifiesto.lecciones) {
  const texto = textoParaTokens(readFileSync(join(dir, leccion.archivo), 'utf8'));
  const hallazgos = verificarTokens({ texto, fuentes, tope: Infinity });
  total += hallazgos.length;

  console.log('='.repeat(78));
  console.log(`${leccion.titulo}  —  ${hallazgos.length} hallazgo(s)`);
  console.log('='.repeat(78));

  for (const h of hallazgos) {
    console.log(`  [${h.tipo}] ${h.valor}`);
    console.log(`          ${h.contexto}`);
  }

  console.log('');
}

console.log(`TOTAL: ${total} hallazgo(s) en ${manifiesto.lecciones.length} lección(es)`);
