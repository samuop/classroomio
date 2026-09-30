import { citaAparece, normalizarParaComparar, textoDeLeccion } from '@api/services/agent/grounding';
import { listarElementosDePrimerNivel } from '@api/services/agent/lesson-blocks';

/**
 * La guardia entre la primera versión de una lección y la corrección del
 * escritor: lo que nadie pidió cambiar vuelve igual, o la corrección se tira.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-29. La consigna de la corrección decía «arreglá SÓLO
 * esto, todo lo demás idéntico», y nada lo comprobaba: la guardia de
 * conservación cuenta tablas, diagramas, imágenes y marcas, no el texto. La
 * segunda versión sacó de una lección la lista entera de pestañas cuando sólo
 * se había señalado una, cambió «totales» por «subtotales» en un bloque que
 * nadie había marcado, y pasó cifras bien escritas al formato de la fuente.
 *
 * ── Qué compara ──────────────────────────────────────────────────────────────
 *
 * Por TEXTO de bloque y no por id: el escritor recibe la lección con sus ids
 * pero nada lo obliga a devolverlos, y un bloque idéntico con otro id sigue
 * siendo el mismo bloque. El texto se compara exacto —espacios aparte—, sin
 * normalizar la puntuación: «1.048.576» → «1,048,576» es justamente uno de los
 * cambios que esto tiene que ver.
 *
 *   1. Todo bloque de la primera versión que no contiene una frase señalada
 *      tiene que estar, con el mismo texto, en la segunda. Agregar bloques se
 *      permite (partir un párrafo para corregirlo es legítimo); cambiar o sacar
 *      uno que nadie señaló, no.
 *   2. Un dato que figura en el pedido de la docente, en el plan o en otra
 *      fuente del curso no puede desaparecer, salvo que esté adentro de la
 *      frase señalada misma.
 *
 * Si no se sabe qué frases señaló el juez (un verificador que devuelve sólo
 * prosa), el punto 1 no se puede aplicar y no se aplica: se sigue con el 2.
 */

export interface VeredictoDeLaGuardia {
  /** La segunda versión se puede guardar. */
  conservar: boolean;
  /** Por qué no, en una frase para el log y el informe de la ronda. */
  motivo?: string;
  /** El texto quedó idéntico: sólo cambiaron atributos (marcas, ids). */
  soloMarcas: boolean;
}

/** El texto de un bloque tal como se compara: el que ve el lector, espacios aparte. */
function textoComparable(html: string): string {
  return textoDeLeccion(html).replace(/\s+/g, ' ').trim();
}

function textosDeBloques(html: string): string[] {
  return listarElementosDePrimerNivel(html)
    .map((elemento) => textoComparable(html.slice(elemento.start, elemento.end)))
    .filter((texto) => texto.length > 0);
}

const conBordes = (texto: string) => ` ${normalizarParaComparar(texto)} `;

function resumir(texto: string): string {
  return texto.length > 70 ? `${texto.slice(0, 70).trimEnd()}…` : texto;
}

export function guardiaDelRebote(params: {
  /** La primera versión, tal como quedó guardada. */
  antes: string;
  /** La corrección, normalizada igual que se guardaría. */
  despues: string;
  /** Las frases que el juez señaló en la primera versión. */
  citas: string[];
  /** Datos que no pueden desaparecer: están en el pedido, el plan u otra fuente del curso. */
  protegidos: string[];
}): VeredictoDeLaGuardia {
  const soloMarcas = textoComparable(params.antes) === textoComparable(params.despues);

  if (soloMarcas) return { conservar: true, soloMarcas };

  const antes = textosDeBloques(params.antes);
  const citas = params.citas.filter((cita) => cita.trim().length > 0);

  // Qué bloques se pidió tocar: los que contienen una frase señalada. Si alguna
  // frase no cae entera en un solo bloque, no se sabe cuáles son, y la regla de
  // los bloques no se aplica — mejor dejar pasar la corrección que tirarla por
  // no saber leerla.
  const tocables = new Set<number>();
  let ubicadas = citas.length > 0;

  for (const cita of citas) {
    const donde = antes.map((texto, i) => (citaAparece(cita, texto) ? i : -1)).filter((i) => i >= 0);

    if (donde.length === 0) ubicadas = false;

    for (const i of donde) tocables.add(i);
  }

  if (ubicadas) {
    const disponibles = new Map<string, number>();

    for (const texto of textosDeBloques(params.despues)) disponibles.set(texto, (disponibles.get(texto) ?? 0) + 1);

    for (const [i, texto] of antes.entries()) {
      if (tocables.has(i)) continue;

      const quedan = disponibles.get(texto) ?? 0;

      if (quedan === 0) {
        return {
          conservar: false,
          soloMarcas,
          motivo: `it changed a block the check did not flag («${resumir(texto)}»)`
        };
      }

      disponibles.set(texto, quedan - 1);
    }
  }

  const textoAntes = conBordes(textoDeLeccion(params.antes));
  const textoDespues = conBordes(textoDeLeccion(params.despues));
  const enLasCitas = citas.map(conBordes);

  for (const protegido of params.protegidos) {
    const buscado = conBordes(protegido);

    if (buscado.trim().length === 0) continue;
    if (!textoAntes.includes(buscado) || textoDespues.includes(buscado)) continue;
    // Adentro de la frase que el juez señaló: sacarla era el arreglo pedido.
    if (enLasCitas.some((cita) => cita.includes(buscado))) continue;

    return {
      conservar: false,
      soloMarcas,
      motivo: `it removed «${protegido}», which is in the teacher's request or in another source of the course`
    };
  }

  return { conservar: true, soloMarcas };
}
