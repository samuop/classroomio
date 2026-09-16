/**
 * Mide el chequeo de fundamento contra lecciones YA ESCRITAS.
 *
 * El verificador nació después de estas lecciones, así que nunca las miró. La
 * pregunta que responde este guion es la única que importa antes de decidir si
 * los arreglos alcanzan: puesto delante de un texto del que ya sabemos, frase
 * por frase, qué está inventado, ¿cuánto marca?
 *
 * No es un test: llama al proveedor de verdad y cuesta plata. Se corre a mano.
 *
 *   pnpm --filter @cio/api exec tsx src/scripts/medir-fundamento.ts --dir <carpeta> [--veces 2]
 *
 * La carpeta lleva un `manifiesto.json` con la fuente y las lecciones:
 *
 *   { "fuente":    { "fileName": "...", "archivo": "fuente.txt" },
 *     "lecciones": [ { "titulo": "...", "archivo": "leccion.html" } ] }
 */
import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AIProvider } from '@cio/ai-assistant';

import { crearVerificadorDeFundamento, textoDeLeccion } from '@api/services/agent/grounding';
import type { RedisClient } from '@api/utils/redis/redis';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1];
const veces = args.includes('--veces') ? Number(args[args.indexOf('--veces') + 1]) : 1;

if (!args.includes('--dir') || !dir) {
  console.error('falta --dir <carpeta con manifiesto.json>');
  process.exit(2);
}

interface Manifiesto {
  fuente: { fileName: string; archivo: string };
  lecciones: { titulo: string; archivo: string }[];
}

const manifiesto: Manifiesto = JSON.parse(readFileSync(join(dir, 'manifiesto.json'), 'utf8'));
const fuente = {
  fileName: manifiesto.fuente.fileName,
  text: readFileSync(join(dir, manifiesto.fuente.archivo), 'utf8')
};

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('falta GOOGLE_API_KEY en el entorno');
  process.exit(2);
}

/**
 * Redis de mentira: con `soloFuentes` el verificador no arma el paquete del
 * curso, así que nunca lo toca. Está para que el tipo cierre, no para funcionar.
 */
const redis = { get: async () => null, set: async () => 'OK' } as unknown as RedisClient;

const verificar = crearVerificadorDeFundamento({
  orgId: process.env.MEDICION_ORG_ID ?? '00000000-0000-0000-0000-000000000000',
  userId: process.env.MEDICION_USER_ID ?? '00000000-0000-0000-0000-000000000000',
  courseId: process.env.MEDICION_COURSE_ID ?? '00000000-0000-0000-0000-000000000000',
  redis,
  providerConfig: { provider: AIProvider.GOOGLE, apiKey, model: process.env.GOOGLE_MODEL || undefined }
});

if (!verificar) {
  console.error('el chequeo está apagado (AGENT_GROUNDING_CHECK=false)');
  process.exit(2);
}

console.log(`fuente: ${fuente.fileName} (${fuente.text.length} caracteres)`);
console.log(`modelo: ${process.env.GOOGLE_MODEL || '(por defecto del proveedor)'}`);
console.log(`lecciones: ${manifiesto.lecciones.length}, corridas por lección: ${veces}\n`);

for (const leccion of manifiesto.lecciones) {
  const contenido = readFileSync(join(dir, leccion.archivo), 'utf8');
  const texto = textoDeLeccion(contenido);

  console.log('='.repeat(78));
  console.log(`${leccion.titulo}  (${texto.length} caracteres de texto)`);
  console.log('='.repeat(78));

  for (let i = 1; i <= veces; i++) {
    const avisos = await verificar({ lessonTitle: leccion.titulo, contenido, soloFuentes: [fuente] });

    console.log(`\n-- corrida ${i} --`);
    console.log(avisos.length === 0 ? 'SIN AVISOS: el verificador no marcó nada.' : avisos.join('\n'));
  }

  console.log('');
}
