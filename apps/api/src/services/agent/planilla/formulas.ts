/**
 * Las fórmulas de una planilla, leídas pieza por pieza.
 *
 * Un Excel guarda cada fórmula como texto en inglés, con «,» entre argumentos y
 * «.» decimal: `VLOOKUP(C2,TablaProductos,2,FALSE)`. De ese texto sale todo lo
 * que el asistente necesita para entender el libro:
 *
 * - qué celdas, rangos, hojas, nombres y tablas usa (el flujo de los datos),
 * - la forma relativa de la fórmula, que es la misma en las 400 filas donde se
 *   copió hacia abajo (así 400 fórmulas se leen como una sola regla),
 * - la fórmula como la ve alguien con Excel en castellano:
 *   `=BUSCARV(C2;TablaProductos;2;FALSO)`.
 *
 * Por eso se separa en piezas y no se reemplaza con expresiones sueltas: un
 * reemplazo de «,» por «;» rompe `"Hola, Juan"`, y uno de `IF` por `SI` rompe
 * una hoja que se llame `IFS 2024`. Cada pieza sabe qué es.
 */
import { ERRORES_EN_CASTELLANO, funcionEnCastellano, MARCADORES_DE_TABLA } from './funciones-en-castellano';

export type TipoDePieza =
  | 'texto'
  | 'numero'
  | 'logico'
  | 'error'
  | 'funcion'
  | 'referencia'
  | 'estructurada'
  | 'nombre'
  | 'operador'
  | 'separador'
  | 'parentesis'
  | 'llave'
  | 'espacio'
  | 'otro';

export interface Pieza {
  tipo: TipoDePieza;
  /** El texto tal cual está en la fórmula. */
  crudo: string;
  /** `referencia`: la hoja, sin comillas. Ausente si es de la misma hoja. */
  hoja?: string;
  /** `referencia`: el libro externo (`[1]` o `[Presupuesto.xlsx]`), si apunta a otro archivo. */
  externo?: string;
  /** `referencia`: el rango como está escrito (`$A$2:$G$21`, `C:C`, `3:3`). */
  rango?: string;
  /** `estructurada`: la tabla (`TablaProductos`), o vacío si es implícita (`[@Costo]`). */
  tabla?: string;
  /** `estructurada`: lo que va entre los corchetes de afuera. */
  interior?: string;
}

const LETRA = 'A-Za-z_\\u00C0-\\uFFFF';
const IDENT = `[${LETRA}][\\w.\\u00C0-\\uFFFF]*`;

const RE = {
  espacio: /\s+/y,
  texto: /"(?:[^"]|"")*"/y,
  error: /#(?:N\/A|REF!|DIV\/0!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/iy,
  hojaConComillas: /'((?:[^']|'')+)'!/y,
  hojaSinComillas: new RegExp(`(\\[[^\\]]+\\])?(${IDENT}(?::${IDENT})?)!`, 'y'),
  libroSolo: /(\[[^\]]+\])!/y,
  celdas: /\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![\w(.[])/y,
  columnas: /\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![\w(.[])/y,
  filas: /\$?\d+:\$?\d+(?![\w.])/y,
  funcion: new RegExp(`${IDENT}(?=\\()`, 'y'),
  logico: /(?:TRUE|FALSE)(?![\w(.])/iy,
  tablaConCorchete: new RegExp(`(${IDENT})?\\[`, 'y'),
  numero: /(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?/iy,
  nombre: new RegExp(`[${LETRA}\\\\][\\w.\\u00C0-\\uFFFF]*`, 'y'),
  operador: /<>|<=|>=|[-+*/^&=<>%:@]/y,
  separador: /[,;]/y,
  parentesis: /[()]/y,
  llave: /[{}]/y
};

function probar(re: RegExp, texto: string, desde: number): RegExpExecArray | null {
  re.lastIndex = desde;
  return re.exec(texto);
}

/** Lo que cierra un `[` de una referencia estructurada, respetando los escapes con `'`. */
function finDelCorchete(texto: string, abre: number): number {
  let nivel = 0;

  for (let i = abre; i < texto.length; i++) {
    const c = texto[i];

    if (c === "'") {
      i++;
      continue;
    }

    if (c === '[') nivel++;

    if (c === ']') {
      nivel--;
      if (nivel === 0) return i;
    }
  }

  return texto.length - 1;
}

/** La referencia que sigue a un `Hoja!`: celdas, columnas, filas, `#REF!` o un nombre. */
function destinoDeLaHoja(texto: string, desde: number): { crudo: string; rango?: string } | null {
  for (const re of [RE.celdas, RE.columnas, RE.filas]) {
    const m = probar(re, texto, desde);
    if (m) return { crudo: m[0], rango: m[0] };
  }

  const error = probar(RE.error, texto, desde);
  if (error) return { crudo: error[0] };

  const nombre = probar(RE.nombre, texto, desde);
  if (nombre) return { crudo: nombre[0] };

  return null;
}

/** Separa una fórmula en piezas. Acepta la fórmula con o sin el `=` del principio. */
export function piezas(formula: string): Pieza[] {
  const texto = formula.startsWith('=') ? formula.slice(1) : formula;
  const salida: Pieza[] = [];
  let i = 0;

  while (i < texto.length) {
    let m: RegExpExecArray | null;

    if ((m = probar(RE.espacio, texto, i))) {
      salida.push({ tipo: 'espacio', crudo: m[0] });
      i += m[0].length;
      continue;
    }

    if ((m = probar(RE.texto, texto, i))) {
      salida.push({ tipo: 'texto', crudo: m[0] });
      i += m[0].length;
      continue;
    }

    if ((m = probar(RE.error, texto, i))) {
      salida.push({ tipo: 'error', crudo: m[0] });
      i += m[0].length;
      continue;
    }

    // `'Hoja con espacios'!A1`, `'[1]Hoja'!A1`, `Ventas!$F:$F`, `[1]Hoja!A1`, `[1]!Nombre`.
    const conComillas = probar(RE.hojaConComillas, texto, i);
    const sinComillas = conComillas ? null : probar(RE.hojaSinComillas, texto, i);
    const libroSolo = conComillas || sinComillas ? null : probar(RE.libroSolo, texto, i);
    const prefijo = conComillas ?? sinComillas ?? libroSolo;

    if (prefijo) {
      const destino = destinoDeLaHoja(texto, i + prefijo[0].length);

      if (destino) {
        let hoja: string | undefined;
        let externo: string | undefined;

        if (conComillas) {
          const adentro = conComillas[1].replace(/''/g, "'");
          const libro = /^(\[[^\]]+\])(.*)$/.exec(adentro);
          externo = libro?.[1];
          hoja = libro ? libro[2] : adentro;
        } else if (sinComillas) {
          externo = sinComillas[1];
          hoja = sinComillas[2];
        } else {
          externo = libroSolo![1];
        }

        const crudo = prefijo[0] + destino.crudo;

        if (destino.rango) {
          salida.push({ tipo: 'referencia', crudo, hoja, externo, rango: destino.rango });
        } else {
          salida.push({ tipo: 'nombre', crudo, hoja, externo });
        }

        i += crudo.length;
        continue;
      }
    }

    // `TablaProductos[Código]`, `TablaProductos[[#This Row],[Costo]]`, `[@Costo]`.
    if ((m = probar(RE.tablaConCorchete, texto, i))) {
      const abre = i + m[0].length - 1;
      const cierra = finDelCorchete(texto, abre);
      const crudo = texto.slice(i, cierra + 1);
      salida.push({ tipo: 'estructurada', crudo, tabla: m[1] ?? '', interior: texto.slice(abre + 1, cierra) });
      i += crudo.length;
      continue;
    }

    let referencia = false;

    for (const re of [RE.celdas, RE.columnas, RE.filas]) {
      if ((m = probar(re, texto, i))) {
        salida.push({ tipo: 'referencia', crudo: m[0], rango: m[0] });
        i += m[0].length;
        referencia = true;
        break;
      }
    }

    if (referencia) continue;

    const siguientes: Array<[TipoDePieza, RegExp]> = [
      ['funcion', RE.funcion],
      ['logico', RE.logico],
      ['numero', RE.numero],
      ['nombre', RE.nombre],
      ['operador', RE.operador],
      ['separador', RE.separador],
      ['parentesis', RE.parentesis],
      ['llave', RE.llave]
    ];

    let encontrada = false;

    for (const [tipo, re] of siguientes) {
      if ((m = probar(re, texto, i))) {
        salida.push({ tipo, crudo: m[0] });
        i += m[0].length;
        encontrada = true;
        break;
      }
    }

    if (!encontrada) {
      salida.push({ tipo: 'otro', crudo: texto[i] });
      i += 1;
    }
  }

  return salida;
}

// ─── Direcciones ─────────────────────────────────────────────────────────────

export function letrasAColumna(letras: string): number {
  let n = 0;
  for (const c of letras.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

export function columnaALetras(n: number): string {
  let letras = '';

  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }

  return letras;
}

export interface Extremo {
  col?: number;
  fila?: number;
  colFija: boolean;
  filaFija: boolean;
}

/** Un extremo de un rango: `$A$2`, `C`, `$3`. */
export function leerExtremo(texto: string): Extremo {
  const m = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(texto);

  if (!m) return { colFija: false, filaFija: false };

  return {
    col: m[2] ? letrasAColumna(m[2]) : undefined,
    fila: m[4] ? Number(m[4]) : undefined,
    colFija: m[1] === '$',
    filaFija: m[3] === '$'
  };
}

export interface Rectangulo {
  col1: number;
  fila1: number;
  col2: number;
  fila2: number;
}

/**
 * El rectángulo que cubre un rango. Una columna entera (`F:F`) va de la fila 1
 * a `maxFila`; una fila entera, de la columna 1 a `maxCol`.
 */
export function rectanguloDe(rango: string, maxFila = 1_048_576, maxCol = 16_384): Rectangulo | null {
  const [a, b = a] = rango.split(':');
  const x = leerExtremo(a);
  const y = leerExtremo(b);

  if (x.col === undefined && x.fila === undefined) return null;

  const col1 = x.col ?? 1;
  const col2 = y.col ?? (x.col === undefined ? maxCol : col1);
  const fila1 = x.fila ?? 1;
  const fila2 = y.fila ?? (x.fila === undefined ? maxFila : fila1);

  return {
    col1: Math.min(col1, col2),
    col2: Math.max(col1, col2),
    fila1: Math.min(fila1, fila2),
    fila2: Math.max(fila1, fila2)
  };
}

export function direccion(col: number, fila: number): string {
  return `${columnaALetras(col)}${fila}`;
}

export function rangoDe(r: Rectangulo): string {
  const a = direccion(r.col1, r.fila1);
  const b = direccion(r.col2, r.fila2);
  return a === b ? a : `${a}:${b}`;
}

// ─── Referencias ─────────────────────────────────────────────────────────────

export interface Referencia {
  /** La hoja nombrada en la fórmula; ausente cuando es la misma hoja de la celda. */
  hoja?: string;
  /** El libro externo, cuando la referencia sale de otro archivo. */
  externo?: string;
  rango?: string;
  /** Un nombre definido (`IVA`) o, con `hoja`, uno de otro libro. */
  nombre?: string;
  /** Una referencia estructurada a una tabla. */
  tabla?: { tabla: string; columnas: string[]; estaFila: boolean };
}

/** Las columnas nombradas adentro de una referencia estructurada: `[[#This Row],[Costo]]` → `Costo`. */
export function columnasDeLaEstructurada(interior: string): { columnas: string[]; estaFila: boolean } {
  const estaFila = /#this row|^@/i.test(interior.trim());
  const sinArroba = interior.trim().replace(/^@/, '');
  const partes = sinArroba.startsWith('[') ? [...sinArroba.matchAll(/\[((?:[^\]']|'.)*)\]/g)].map((m) => m[1]) : [sinArroba];

  const columnas = partes
    .map((p) => p.replace(/'(.)/g, '$1').trim())
    .filter((p) => p && !p.startsWith('#'));

  // `Col1]:[Col2` en un rango de columnas queda como dos columnas.
  return { columnas, estaFila };
}

/** De qué depende una fórmula: celdas, rangos, nombres y tablas, sin repetir. */
export function referenciasDe(formula: string): Referencia[] {
  const vistas = new Set<string>();
  const salida: Referencia[] = [];

  const agregar = (ref: Referencia) => {
    const clave = JSON.stringify(ref);
    if (vistas.has(clave)) return;
    vistas.add(clave);
    salida.push(ref);
  };

  for (const p of piezas(formula)) {
    if (p.tipo === 'referencia') {
      agregar({ hoja: p.hoja, externo: p.externo, rango: p.rango!.replace(/\$/g, '').toUpperCase() });
    } else if (p.tipo === 'nombre' && !/^(?:TRUE|FALSE)$/i.test(p.crudo)) {
      const nombre = p.hoja || p.externo ? p.crudo.slice(p.crudo.lastIndexOf('!') + 1) : p.crudo;
      agregar({ nombre, hoja: p.hoja, externo: p.externo });
    } else if (p.tipo === 'estructurada') {
      const { columnas, estaFila } = columnasDeLaEstructurada(p.interior ?? '');
      agregar({ tabla: { tabla: p.tabla ?? '', columnas, estaFila } });
    }
  }

  return salida;
}

// ─── Forma relativa ──────────────────────────────────────────────────────────

function extremoRelativo(texto: string, col: number, fila: number): string {
  const e = leerExtremo(texto);
  const c = e.col === undefined ? '' : e.colFija ? `$C${e.col}` : `C[${e.col - col}]`;
  const f = e.fila === undefined ? '' : e.filaFija ? `$R${e.fila}` : `R[${e.fila - fila}]`;
  return c + f;
}

/**
 * La fórmula con sus referencias relativas escritas como distancias a la celda.
 *
 * `=D2*G2` en H2 y `=D3*G3` en H3 son la misma regla copiada: las dos quedan
 * `D·C[-4]R[0]*C[-1]R[0]`. Las partes fijas (`$B$7`) quedan tal cual.
 */
export function formaRelativa(formula: string, col: number, fila: number): string {
  return piezas(formula)
    .map((p) => {
      if (p.tipo !== 'referencia') return p.crudo;

      const prefijo = p.crudo.slice(0, p.crudo.length - p.rango!.length);
      const relativo = p.rango!
        .split(':')
        .map((extremo) => extremoRelativo(extremo, col, fila))
        .join(':');

      return prefijo + relativo;
    })
    .join('');
}

// ─── En castellano ───────────────────────────────────────────────────────────

function estructuradaEnCastellano(p: Pieza, tablaDeLaCelda?: string): string {
  const interior = p.interior ?? '';
  const { columnas, estaFila } = columnasDeLaEstructurada(interior);

  // `Tabla[[#This Row],[Costo]]` es lo que guarda el archivo; Excel muestra `[@Costo]`.
  if (estaFila && columnas.length === 1) {
    const col = columnas[0];
    const conCorchetes = /^[\wÀ-￿]+$/.test(col) ? col : `[${col}]`;
    const tabla = p.tabla && p.tabla !== tablaDeLaCelda ? p.tabla : '';
    return `${tabla}[@${conCorchetes}]`;
  }

  const traducido = interior.replace(/#(?:This Row|All|Data|Headers|Totals)/gi, (m) => MARCADORES_DE_TABLA[m.toUpperCase()] ?? m);
  return `${p.tabla ?? ''}[${traducido}]`;
}

/**
 * La fórmula como la muestra un Excel en castellano (Argentina, España):
 * funciones traducidas, «;» entre argumentos, «,» decimal, `VERDADERO`/`FALSO`
 * y los errores con su nombre (`#N/D`).
 *
 * `tablaDeLaCelda`: si la celda está adentro de una tabla, sus referencias a la
 * misma fila se escriben cortas (`[@Costo]`), como las muestra Excel.
 */
export function formulaEnCastellano(formula: string, tablaDeLaCelda?: string): string {
  let llaves = 0;

  const cuerpo = piezas(formula)
    .map((p) => {
      switch (p.tipo) {
        case 'funcion':
          return funcionEnCastellano(p.crudo);
        case 'logico':
          return p.crudo.toUpperCase() === 'TRUE' ? 'VERDADERO' : 'FALSO';
        case 'error':
          return ERRORES_EN_CASTELLANO[p.crudo.toUpperCase()] ?? p.crudo;
        case 'numero':
          return p.crudo.replace('.', ',');
        case 'separador':
          // Adentro de una constante de matriz `{1,2;3,4}` el separador significa
          // otra cosa (columna o fila): se deja como está.
          return llaves > 0 ? p.crudo : ';';
        case 'llave':
          llaves += p.crudo === '{' ? 1 : -1;
          return p.crudo;
        case 'estructurada':
          return estructuradaEnCastellano(p, tablaDeLaCelda);
        default:
          return p.crudo;
      }
    })
    .join('');

  return `=${cuerpo}`;
}
