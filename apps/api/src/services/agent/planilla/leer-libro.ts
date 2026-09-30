/**
 * Un libro de Excel, leído entero: celdas, fórmulas y todo lo que lo explica.
 *
 * Un xlsx es un zip de XML. Se lee de a pedazos, sin armar el libro en memoria:
 * la API corre con 384 MB y un registro de ventas de 450.000 celdas —2,5 MB de
 * archivo— necesitaba 376 MB con una biblioteca que arma todo el libro
 * (medido el 2026-09-30). Leyendo de a pedazos:
 *
 * - todo lo que EXPLICA el libro se lee siempre y entero: cada fórmula (agrupada
 *   en reglas mientras se lee: 400.000 fórmulas copiadas son una regla), los
 *   rangos con nombre, las tablas, los desplegables, el formato condicional, las
 *   notas, las tablas dinámicas, los gráficos, los vínculos a otros libros y la
 *   lista de macros;
 * - los DATOS de una hoja grande se resumen: el perfil de cada columna se calcula
 *   sobre todas las filas, y se guardan completas las primeras y las últimas. Una
 *   fila del medio se vuelve a leer cuando se la pide (`LectorDeLibro.celdasDe`).
 *
 * No se calcula nada: los resultados son los que Excel guardó la última vez que
 * alguien grabó el libro. Las macros se listan y NUNCA se ejecutan.
 */
import { StringDecoder } from 'node:string_decoder';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

import {
  columnaALetras,
  direccion,
  formaRelativa,
  formulaEnCastellano,
  leerExtremo,
  piezas,
  rangoDe,
  rectanguloDe,
  type Pieza,
  type Rectangulo
} from './formulas';

export type ValorDeCelda = string | number | boolean | Date | { error: string } | null;

export interface CeldaLeida {
  col: number;
  fila: number;
  /** El valor; en una fórmula, el resultado que guardó Excel. */
  valor: ValorDeCelda;
  /** La fórmula en inglés, sin el `=`, tal como la guarda el archivo. */
  formula?: string;
  /** El formato de número (`0%`, `dd/mm/yyyy`, `"$"#,##0.00`). */
  formato?: string;
}

export interface TablaLeida {
  nombre: string;
  rango: string;
  columnas: string[];
}

/** Una fórmula copiada: el rectángulo donde está y la de arriba a la izquierda. */
export interface ReglaLeida {
  rect: Rectangulo;
  /** La fórmula de la celda de arriba a la izquierda, en inglés, sin `=`. */
  formula: string;
  celdas: number;
  valor: ValorDeCelda;
  formato?: string;
}

/** Lo que tiene una columna de datos, contado sobre TODAS sus filas. */
export interface PerfilDeColumna {
  col: number;
  encabezado: string;
  numeros: number;
  enteros: boolean;
  min?: number;
  max?: number;
  formatoNumero?: string;
  fechas: number;
  fechaMin?: number;
  fechaMax?: number;
  textos: number;
  /** Los textos distintos, hasta `MAX_DISTINTOS`. */
  distintos: string[];
  /** Si hay más textos distintos que los que se guardaron. */
  masDistintos: boolean;
  otros: number;
}

export interface HojaLeida {
  nombre: string;
  estado: 'visible' | 'oculta' | 'muy oculta';
  /** Hasta dónde llega el contenido. */
  filas: number;
  columnas: number;
  /** Las celdas guardadas, fila por fila. En una hoja grande, las primeras y las últimas filas. */
  celdas: CeldaLeida[];
  tablas: TablaLeida[];
  /** Los desplegables y demás reglas de validación, juntadas por rango. */
  validaciones: Array<{ rango: string; tipo: string; formula?: string }>;
  formatosCondicionales: Array<{ rango: string; reglas: string[] }>;
  notas: Array<{ celda: string; texto: string }>;
  combinadas: string[];
  /** Cuántas celdas con algo y cuántas con fórmula tiene la hoja, guardadas o no. */
  totalCeldas?: number;
  totalFormulas?: number;
  /** Las fórmulas agrupadas en reglas, sobre la hoja entera. */
  reglas?: ReglaLeida[];
  /** La fila de encabezados y el perfil de cada columna debajo de ella. */
  perfil?: { filaEncabezado: number; filasDeDatos: number; columnas: PerfilDeColumna[] } | null;
  /** Las filas que no se guardaron (se vuelven a leer a pedido). */
  omitidas?: { desde: number; hasta: number } | null;
}

export interface TablaDinamicaLeida {
  nombre: string;
  hoja: string;
  ubicacion?: string;
  origen: { hoja?: string; rango?: string; nombre?: string };
  filas: string[];
  columnas: string[];
  filtros: string[];
  valores: Array<{ rotulo: string; campo: string; funcion: string }>;
}

export interface GraficoLeido {
  hoja: string;
  tipo: string;
  titulo?: string;
  series: Array<{ nombre?: string; categorias?: string; valores?: string }>;
}

export interface VinculoExterno {
  /** El número con que lo nombran las fórmulas: `[1]`. */
  indice: number;
  archivo: string;
  hojas: string[];
}

export interface LibroLeido {
  hojas: HojaLeida[];
  nombres: Array<{ nombre: string; referencia: string }>;
  tablasDinamicas: TablaDinamicaLeida[];
  graficos: GraficoLeido[];
  vinculosExternos: VinculoExterno[];
  /** `null` si el libro no tiene macros. */
  macros: { modulos: string[] } | null;
}

/** Por qué un archivo no se pudo leer como planilla. */
export type MotivoIlegible = 'protegido' | 'no-es-xlsx' | 'muy-grande';

export class PlanillaIlegibleError extends Error {
  constructor(
    public readonly motivo: MotivoIlegible,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'PlanillaIlegibleError';
  }
}

/**
 * Cuánto puede ocupar el libro descomprimido.
 *
 * Un xlsx es un zip: 25 MB comprimidos pueden ser gigas de XML. Leído de a
 * pedazos no llena la memoria, pero leerlo lleva tiempo, y un archivo armado
 * para explotar al abrirlo no puede dejar la API ocupada. Se mide ANTES de leer,
 * con lo que declara el propio zip.
 */
export const MAX_DESCOMPRIMIDO = Number(process.env.AGENT_MAX_SPREADSHEET_UNCOMPRESSED_BYTES) || 150 * 1024 * 1024;

/** Cuántas celdas se guardan de una hoja; de ahí en más, sólo las últimas filas. */
export const CELDAS_POR_HOJA = Number(process.env.AGENT_SPREADSHEET_CELLS_PER_SHEET) || 30_000;
const FILAS_FINALES = 20;
export const MAX_DISTINTOS = 200;

export interface OpcionesDeLectura {
  maxDescomprimido?: number;
  celdasPorHoja?: number;
}

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

// ─── XML ────────────────────────────────────────────────────────────────────

function local(nombre: string): string {
  const i = nombre.indexOf(':');
  return i < 0 ? nombre : nombre.slice(i + 1);
}

/**
 * El flujo de `jszip` por eventos. Existe desde la 3.0, pero sus tipos no lo
 * declaran; `nodeStream` sí está declarado y no se deja recorrer con `for await`.
 */
interface FlujoInterno {
  internalStream(tipo: 'uint8array'): {
    on(evento: 'data', f: (trozo: Uint8Array) => void): ReturnType<FlujoInterno['internalStream']>;
    on(evento: 'error', f: (e: Error) => void): ReturnType<FlujoInterno['internalStream']>;
    on(evento: 'end', f: () => void): ReturnType<FlujoInterno['internalStream']>;
    resume(): void;
  };
}

interface Manejador {
  abre?(nombre: string, atributos: Record<string, string>, pila: string[]): void;
  texto?(texto: string, pila: string[]): void;
  cierra?(nombre: string, pila: string[]): void;
}

/**
 * Recorre una parte del zip de a pedazos. Los nombres llegan sin prefijo
 * (`x14:dataValidation` → `dataValidation`); `pila` son los de los padres.
 */
async function recorrer(zip: JSZip, ruta: string, m: Manejador): Promise<boolean> {
  const archivo = zip.file(ruta);
  if (!archivo) return false;

  const parser = new SaxesParser();
  const pila: string[] = [];
  let error: Error | null = null;

  parser.on('opentag', (tag) => {
    const nombre = local(tag.name);
    m.abre?.(nombre, tag.attributes as Record<string, string>, pila);
    if (!tag.isSelfClosing) pila.push(nombre);
    else m.cierra?.(nombre, pila);
  });
  parser.on('text', (t) => m.texto?.(t, pila));
  parser.on('cdata', (t) => m.texto?.(t, pila));
  parser.on('closetag', (tag) => {
    if (tag.isSelfClosing) return;
    pila.pop();
    m.cierra?.(local(tag.name), pila);
  });
  parser.on('error', (e) => {
    error = e;
  });

  const decodificador = new StringDecoder('utf8');

  // De a pedazos: el XML de una hoja grande pesa decenas de megas descomprimido
  // y nunca se arma entero en memoria.
  await new Promise<void>((resolver, rechazar) => {
    (archivo as unknown as FlujoInterno)
      .internalStream('uint8array')
      .on('data', (trozo: Uint8Array) => {
        if (error) return;
        try {
          parser.write(decodificador.write(Buffer.from(trozo.buffer, trozo.byteOffset, trozo.byteLength)));
        } catch (e) {
          error = e as Error;
        }
      })
      .on('error', rechazar)
      .on('end', () => resolver())
      .resume();
  });

  if (error) throw error;
  parser.write(decodificador.end());
  parser.close();
  if (error) throw error;

  return true;
}

async function leerTexto(zip: JSZip, ruta: string): Promise<string | null> {
  const f = zip.file(ruta);
  return f ? f.async('string') : null;
}

function atributo(etiqueta: string, nombre: string): string | undefined {
  const m = new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta);
  return m ? desescapar(m[1]) : undefined;
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function etiquetas(xml: string, nombre: string): string[] {
  return xml.match(new RegExp(`<(?:\\w+:)?${nombre}\\b[^>]*>`, 'g')) ?? [];
}

function bloques(xml: string, nombre: string): string[] {
  return xml.match(new RegExp(`<(?:\\w+:)?${nombre}\\b[^>]*>[\\s\\S]*?</(?:\\w+:)?${nombre}>`, 'g')) ?? [];
}

/** Resuelve `../pivotTables/pivotTable1.xml` contra la carpeta de la parte que la nombra. */
function resolverRuta(desde: string, destino: string): string {
  if (destino.startsWith('/')) return destino.slice(1);

  const partes = desde.split('/').slice(0, -1);

  for (const p of destino.split('/')) {
    if (p === '..') partes.pop();
    else if (p !== '.') partes.push(p);
  }

  return partes.join('/');
}

function rutaDeRelaciones(parte: string): string {
  const i = parte.lastIndexOf('/');
  return `${parte.slice(0, i)}/_rels/${parte.slice(i + 1)}.rels`;
}

/** Las relaciones de una parte: id → { tipo, destino (ya resuelto), externo }. */
async function relaciones(zip: JSZip, parte: string) {
  const xml = await leerTexto(zip, rutaDeRelaciones(parte));
  const salida = new Map<string, { tipo: string; destino: string; externo: boolean }>();

  if (!xml) return salida;

  for (const e of etiquetas(xml, 'Relationship')) {
    const id = atributo(e, 'Id');
    const tipo = atributo(e, 'Type') ?? '';
    const destino = atributo(e, 'Target') ?? '';
    const externo = atributo(e, 'TargetMode') === 'External';
    if (id) salida.set(id, { tipo: tipo.slice(tipo.lastIndexOf('/') + 1), destino: externo ? destino : resolverRuta(parte, destino), externo });
  }

  return salida;
}

// ─── Formatos de número y fechas ────────────────────────────────────────────

const FORMATOS_DE_FABRICA: Record<number, string> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  14: 'dd/mm/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'dd/mm/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  44: '"$"#,##0.00',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  49: '@'
};

/** Si un formato de número muestra una fecha u hora. */
export function esFormatoDeFecha(formato: string | undefined): boolean {
  if (!formato) return false;
  const sinTextos = formato.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(sinTextos) && !/^General$/i.test(sinTextos);
}

/** Un número de serie de Excel como fecha (UTC). */
function fechaDeSerie(serie: number, sistema1904: boolean): Date {
  const dias = sistema1904 ? serie + 1462 : serie;
  return new Date(Math.round((dias - 25569) * 86_400_000));
}

// ─── Reglas mientras se lee ─────────────────────────────────────────────────

interface Tramo {
  col: number;
  fila1: number;
  fila2: number;
  formula: string;
  valor: ValorDeCelda;
  formato?: string;
}

/**
 * Agrupa las fórmulas en reglas a medida que llegan, sin guardar las celdas.
 *
 * Las filas llegan en orden, así que por cada forma relativa y columna alcanza
 * con el tramo abierto: la celda de la fila siguiente lo estira; otra, lo cierra.
 */
class Agrupador {
  private abiertos = new Map<string, Tramo & { forma: string }>();
  private cerrados: Array<Tramo & { forma: string }> = [];

  agregar(forma: string, col: number, fila: number, formula: () => string, valor: ValorDeCelda, formato?: string) {
    const clave = `${col}\u0000${forma}`;
    const tramo = this.abiertos.get(clave);

    if (tramo && tramo.fila2 === fila - 1) {
      tramo.fila2 = fila;
      return;
    }

    if (tramo) this.cerrados.push(tramo);
    this.abiertos.set(clave, { forma, col, fila1: fila, fila2: fila, formula: formula(), valor, formato });
  }

  reglas(): ReglaLeida[] {
    const tramos = [...this.cerrados, ...this.abiertos.values()].sort((a, b) => a.col - b.col || a.fila1 - b.fila1);
    const abiertos = new Map<string, ReglaLeida>();
    const salida: ReglaLeida[] = [];

    for (const t of tramos) {
      const vecino = abiertos.get(`${t.forma}\u0000${t.col - 1}\u0000${t.fila1}\u0000${t.fila2}`);

      if (vecino) {
        abiertos.delete(`${t.forma}\u0000${vecino.rect.col2}\u0000${t.fila1}\u0000${t.fila2}`);
        vecino.rect.col2 = t.col;
        vecino.celdas += t.fila2 - t.fila1 + 1;
        abiertos.set(`${t.forma}\u0000${t.col}\u0000${t.fila1}\u0000${t.fila2}`, vecino);
        continue;
      }

      const regla: ReglaLeida = {
        rect: { col1: t.col, col2: t.col, fila1: t.fila1, fila2: t.fila2 },
        formula: t.formula,
        celdas: t.fila2 - t.fila1 + 1,
        valor: t.valor,
        formato: t.formato
      };
      salida.push(regla);
      abiertos.set(`${t.forma}\u0000${t.col}\u0000${t.fila1}\u0000${t.fila2}`, regla);
    }

    return salida.sort((a, b) => a.rect.fila1 - b.rect.fila1 || a.rect.col1 - b.rect.col1);
  }
}

/** Una fórmula compartida copiada a otra celda: sus referencias sin `$` se corren. */
function desplazar(trozos: Pieza[], dc: number, df: number): string {
  return trozos
    .map((p) => {
      if (p.tipo !== 'referencia') return p.crudo;

      const prefijo = p.crudo.slice(0, p.crudo.length - p.rango!.length);
      const rango = p.rango!
        .split(':')
        .map((extremo) => {
          const e = leerExtremo(extremo);
          const col = e.col === undefined ? '' : `${e.colFija ? '$' : ''}${columnaALetras(e.colFija ? e.col : e.col + dc)}`;
          const fila = e.fila === undefined ? '' : `${e.filaFija ? '$' : ''}${e.filaFija ? e.fila : e.fila + df}`;
          return col + fila;
        })
        .join(':');

      return prefijo + rango;
    })
    .join('');
}

// ─── Perfil de las columnas ─────────────────────────────────────────────────

export function nuevoPerfil(col: number, encabezado: string): PerfilDeColumna {
  return { col, encabezado, numeros: 0, enteros: true, fechas: 0, textos: 0, distintos: [], masDistintos: false, otros: 0 };
}

export function anotarEnPerfil(p: PerfilDeColumna, valor: ValorDeCelda, formato: string | undefined, vistos: Set<string>) {
  if (valor === null) return;

  if (valor instanceof Date) {
    const t = valor.getTime();
    p.fechas++;
    p.fechaMin = p.fechaMin === undefined ? t : Math.min(p.fechaMin, t);
    p.fechaMax = p.fechaMax === undefined ? t : Math.max(p.fechaMax, t);
  } else if (typeof valor === 'number') {
    p.numeros++;
    if (!Number.isInteger(valor)) p.enteros = false;
    p.min = p.min === undefined ? valor : Math.min(p.min, valor);
    p.max = p.max === undefined ? valor : Math.max(p.max, valor);
    p.formatoNumero ??= formato;
  } else if (typeof valor === 'string') {
    p.textos++;
    if (!vistos.has(valor)) {
      if (vistos.size < MAX_DISTINTOS) {
        vistos.add(valor);
        p.distintos.push(valor);
      } else {
        p.masDistintos = true;
      }
    }
  } else {
    p.otros++;
  }
}

// ─── Una hoja ───────────────────────────────────────────────────────────────

interface HojaDelArchivo {
  nombre: string;
  parte: string;
  estado: HojaLeida['estado'];
}

const OPERADORES: Record<string, string> = {
  greaterThan: 'mayor que',
  lessThan: 'menor que',
  greaterThanOrEqual: 'mayor o igual que',
  lessThanOrEqual: 'menor o igual que',
  equal: 'igual a',
  notEqual: 'distinto de',
  between: 'entre',
  notBetween: 'fuera de'
};

/** Una regla de formato condicional, en castellano: «resalta si el valor es mayor que 20000». */
function describirRegla(r: Record<string, string>, formulas: string[]): string {
  const f = formulas.map((x) => formulaEnCastellano(x).slice(1));

  switch (r.type) {
    case 'cellIs':
      return `resalta si el valor es ${OPERADORES[r.operator] ?? r.operator} ${f.join(' y ')}`;
    case 'expression':
      return `resalta si la fórmula =${f[0] ?? ''} da VERDADERO`;
    case 'containsText':
    case 'notContainsText':
    case 'beginsWith':
    case 'endsWith': {
      const como = r.type === 'notContainsText' ? 'no contiene' : r.type === 'beginsWith' ? 'empieza con' : r.type === 'endsWith' ? 'termina con' : 'contiene';
      return `resalta si el texto ${como} «${r.text ?? ''}»`;
    }
    case 'colorScale':
      return 'escala de colores según el valor';
    case 'dataBar':
      return 'barras de datos según el valor';
    case 'iconSet':
      return 'íconos según el valor';
    case 'top10':
      return `resalta ${r.bottom === '1' ? 'los últimos' : 'los primeros'} ${r.rank ?? '10'}${r.percent === '1' ? '%' : ''}`;
    case 'aboveAverage':
      return `resalta lo que está ${r.aboveAverage === '0' ? 'debajo' : 'arriba'} del promedio`;
    case 'duplicateValues':
      return 'resalta los valores repetidos';
    case 'uniqueValues':
      return 'resalta los valores únicos';
    case 'timePeriod':
      return `resalta fechas del período ${r.timePeriod ?? ''}`;
    default:
      return `regla ${r.type ?? 'sin tipo'}`;
  }
}

/**
 * Junta las validaciones iguales que se tocan de arriba a abajo.
 *
 * Cada programa las guarda a su manera —una por celda, en tramos, en una lista
 * de rangos—, y para quien lee el mapa «desplegable en B2:B401» es una sola cosa.
 */
function juntarValidaciones(sueltas: HojaLeida['validaciones']): HojaLeida['validaciones'] {
  const grupos = new Map<string, Array<Rectangulo>>();

  for (const v of sueltas) {
    const r = rectanguloDe(v.rango);
    if (!r) continue;

    const clave = JSON.stringify([v.tipo, v.formula ?? '', r.col1, r.col2]);
    const lista = grupos.get(clave);
    if (lista) lista.push(r);
    else grupos.set(clave, [r]);
  }

  const salida: HojaLeida['validaciones'] = [];

  for (const [clave, rects] of grupos) {
    const [tipo, formula] = JSON.parse(clave) as [string, string];
    rects.sort((a, b) => a.fila1 - b.fila1);
    let actual = { ...rects[0] };

    for (const r of rects.slice(1)) {
      if (r.fila1 <= actual.fila2 + 1) {
        actual.fila2 = Math.max(actual.fila2, r.fila2);
      } else {
        salida.push({ rango: rangoDe(actual), tipo, formula: formula || undefined });
        actual = { ...r };
      }
    }

    salida.push({ rango: rangoDe(actual), tipo, formula: formula || undefined });
  }

  return salida;
}

// ─── El lector ──────────────────────────────────────────────────────────────

/**
 * El libro abierto: el zip, los textos compartidos, los formatos y las hojas.
 *
 * Queda abierto para volver a leer un rango de una hoja grande sin rearmar nada.
 */
export class LectorDeLibro {
  private constructor(
    private readonly zip: JSZip,
    private readonly textos: string[],
    private readonly formatos: Array<string | undefined>,
    private readonly sistema1904: boolean,
    readonly hojasDelArchivo: HojaDelArchivo[],
    private readonly libroXml: string
  ) {}

  static async abrir(archivo: Buffer, opciones: OpcionesDeLectura = {}): Promise<LectorDeLibro> {
    if (archivo.subarray(0, 4).equals(OLE)) {
      throw new PlanillaIlegibleError(
        'protegido',
        'El archivo está protegido con contraseña o es un .xls viejo: guardalo como .xlsx sin contraseña y subilo de nuevo.'
      );
    }

    let zip: JSZip;

    try {
      zip = await JSZip.loadAsync(archivo);
    } catch {
      throw new PlanillaIlegibleError('no-es-xlsx', 'El archivo no es un libro de Excel (.xlsx) válido.');
    }

    const libroXml = await leerTexto(zip, 'xl/workbook.xml');

    if (!libroXml) throw new PlanillaIlegibleError('no-es-xlsx', 'El archivo no es un libro de Excel (.xlsx) válido.');

    if (tamanoDescomprimido(zip) > (opciones.maxDescomprimido ?? MAX_DESCOMPRIMIDO)) {
      throw new PlanillaIlegibleError(
        'muy-grande',
        'La planilla es demasiado grande para leerla entera. Dejá sólo las hojas que hacen falta para entenderla y subila de nuevo.'
      );
    }

    const rels = await relaciones(zip, 'xl/workbook.xml');
    const hojas = etiquetas(libroXml, 'sheet')
      .map((e) => {
        const estado = atributo(e, 'state');
        return {
          nombre: atributo(e, 'name') ?? '',
          parte: rels.get(atributo(e, 'r:id') ?? '')?.destino ?? '',
          estado: (estado === 'hidden' ? 'oculta' : estado === 'veryHidden' ? 'muy oculta' : 'visible') as HojaLeida['estado']
        };
      })
      .filter((h) => h.parte && zip.file(h.parte));

    const partes = [...rels.values()];
    const textos = await leerTextosCompartidos(zip, partes.find((r) => r.tipo === 'sharedStrings')?.destino ?? 'xl/sharedStrings.xml');
    const formatos = await leerFormatos(zip, partes.find((r) => r.tipo === 'styles')?.destino ?? 'xl/styles.xml');
    const sistema1904 = /date1904="(?:1|true)"/.test(etiquetas(libroXml, 'workbookPr')[0] ?? '');

    return new LectorDeLibro(zip, textos, formatos, sistema1904, hojas, libroXml);
  }

  /** El libro entero: cada hoja resumida si es grande, y todo lo que lo explica. */
  async leer(opciones: OpcionesDeLectura = {}): Promise<LibroLeido> {
    const hojas: HojaLeida[] = [];
    for (const h of this.hojasDelArchivo) hojas.push(await this.leerHoja(h, { celdasPorHoja: opciones.celdasPorHoja ?? CELDAS_POR_HOJA }));

    return {
      hojas,
      nombres: this.nombres(),
      tablasDinamicas: await leerTablasDinamicas(this.zip, this.hojasDelArchivo),
      graficos: await leerGraficos(this.zip, this.hojasDelArchivo),
      vinculosExternos: await leerVinculosExternos(this.zip, await this.partesExternas()),
      macros: await leerMacros(this.zip)
    };
  }

  /** Las celdas de un rango de una hoja, leídas de nuevo del archivo. */
  async celdasDe(nombreDeHoja: string, rect: Rectangulo): Promise<CeldaLeida[]> {
    const h = this.hojasDelArchivo.find((x) => x.nombre.toLowerCase() === nombreDeHoja.toLowerCase());
    if (!h) return [];
    return (await this.leerHoja(h, { soloRect: rect })).celdas;
  }

  private nombres(): LibroLeido['nombres'] {
    return bloques(this.libroXml, 'definedName')
      .map((b) => ({ nombre: atributo(b, 'name') ?? '', referencia: desescapar(b.replace(/^<[^>]*>|<\/[^>]*>$/g, '')) }))
      .filter((n) => n.nombre && !n.nombre.startsWith('_xlnm.') && n.referencia);
  }

  private async partesExternas(): Promise<string[]> {
    const rels = await relaciones(this.zip, 'xl/workbook.xml');

    // El orden de <externalReferences> es el número con que las nombran las fórmulas: [1], [2]…
    const partes = etiquetas(this.libroXml, 'externalReference')
      .map((e) => rels.get(atributo(e, 'r:id') ?? '')?.destino)
      .filter((d): d is string => !!d);

    // Un libro escrito sin <externalReferences> (algunos programas): por nombre de archivo.
    if (partes.length === 0) {
      partes.push(
        ...Object.keys(this.zip.files)
          .filter((f) => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(f))
          .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
      );
    }

    return partes;
  }

  private async leerHoja(h: HojaDelArchivo, opciones: { celdasPorHoja?: number; soloRect?: Rectangulo }): Promise<HojaLeida> {
    const soloRect = opciones.soloRect;
    const limite = opciones.celdasPorHoja ?? CELDAS_POR_HOJA;

    // Una celda con fórmula copiada guarda su maestra y no el texto: el texto se
    // arma sólo si la fila queda guardada (`materializar`), no en cada una de las
    // cientos de miles que se leen y se descartan.
    type Pendiente = CeldaLeida & { maestra?: { col: number; fila: number; trozos: Pieza[] } };
    const materializar = (fila: Pendiente[]): CeldaLeida[] =>
      fila.map((x) => {
        if (!x.maestra) return x;
        const { maestra, ...celda } = x;
        return { ...celda, formula: desplazar(maestra.trozos, x.col - maestra.col, x.fila - maestra.fila) };
      });

    const celdas: CeldaLeida[] = [];
    const finales: Pendiente[][] = [];
    const agrupador = new Agrupador();
    const maestras = new Map<string, { col: number; fila: number; trozos: Pieza[]; forma: string }>();
    const perfiles = new Map<number, { perfil: PerfilDeColumna; vistos: Set<string> }>();
    const validaciones: HojaLeida['validaciones'] = [];
    const condicionales: HojaLeida['formatosCondicionales'] = [];
    const combinadas: string[] = [];
    const partesDeTablas: string[] = [];

    let filaEncabezado: number | undefined;
    let filasMiradas = 0;
    let recortando = false;
    let omitidas: { desde: number; hasta: number } | null = null;
    let totalCeldas = 0;
    let totalFormulas = 0;
    let maxFila = 0;
    let maxCol = 0;
    let filasDeDatos = 0;

    // La celda que se está leyendo.
    let fila = 0;
    let filaActual: Pendiente[] = [];
    let c: { dir: string; tipo?: string; estilo?: number; v: string; f: string; fAttr: Record<string, string> | null; tieneV: boolean; is: string } | null = null;

    // Validaciones y formato condicional, que pueden venir en dos formas (la clásica y la de extLst).
    let validacion: { tipo: string; sqref: string; f1: string } | null = null;
    let condicional: { sqref: string; reglas: string[] } | null = null;
    let regla: { attrs: Record<string, string>; formulas: string[] } | null = null;
    let texto = '';

    const cerrarFila = () => {
      if (!filaActual.length) return;

      // Los encabezados: la primera fila, entre las diez primeras, que tiene dos o
      // más celdas y casi todas con texto escrito. Un informe suele empezar con
      // un título en una sola celda y los encabezados un par de filas más abajo.
      if (filaEncabezado === undefined && filasMiradas < 10) {
        filasMiradas++;
        const textos = filaActual.filter((x) => typeof x.valor === 'string' && !x.formula && !x.maestra);
        if (filaActual.length >= 2 && textos.length / filaActual.length >= 0.6) {
          filaEncabezado = filaActual[0].fila;
          for (const x of filaActual) perfiles.set(x.col, { perfil: nuevoPerfil(x.col, String(x.valor)), vistos: new Set() });
        } else if (filaActual.length >= 2) {
          // Una fila con datos antes de cualquier encabezado: la hoja no es una tabla.
          filasMiradas = 10;
        }
      } else if (filaEncabezado !== undefined) {
        filasDeDatos++;
        for (const x of filaActual) {
          const p = perfiles.get(x.col);
          if (p) anotarEnPerfil(p.perfil, x.valor, x.formato, p.vistos);
        }
      }

      if (soloRect) {
        celdas.push(
          ...materializar(filaActual.filter((x) => x.col >= soloRect.col1 && x.col <= soloRect.col2 && x.fila >= soloRect.fila1 && x.fila <= soloRect.fila2))
        );
      } else if (!recortando && celdas.length + filaActual.length <= limite) {
        celdas.push(...materializar(filaActual));
      } else {
        recortando = true;
        finales.push(filaActual);

        if (finales.length > FILAS_FINALES) {
          const fuera = finales.shift()!;
          const n = fuera[0].fila;
          omitidas = omitidas ? { desde: omitidas.desde, hasta: n } : { desde: n, hasta: n };
        }
      }

      filaActual = [];
    };

    const cerrarCelda = () => {
      if (!c) return;
      const pos = leerExtremo(c.dir);
      const col = pos.col ?? filaActual.length + 1;
      const fAttr = c.fAttr;
      let formula: string | undefined = c.f || undefined;
      let forma: string | undefined;
      let trozosDeLaMaestra: { col: number; fila: number; trozos: Pieza[]; forma: string } | undefined;

      if (fAttr?.t === 'shared' && fAttr.si !== undefined) {
        if (formula) {
          const trozos = piezas(formula);
          forma = formaRelativa(formula, col, fila);
          maestras.set(fAttr.si, { col, fila, trozos, forma });
        } else {
          trozosDeLaMaestra = maestras.get(fAttr.si);
          forma = trozosDeLaMaestra?.forma;
        }
      } else if (formula) {
        forma = formaRelativa(formula, col, fila);
      }

      const formato = c.estilo !== undefined ? this.formatos[c.estilo] : undefined;
      let valor: ValorDeCelda = null;

      if (c.tipo === 'inlineStr') valor = c.is;
      else if (c.tieneV) {
        switch (c.tipo) {
          case 's':
            valor = this.textos[Number(c.v)] ?? '';
            break;
          case 'str':
            valor = c.v;
            break;
          case 'b':
            valor = c.v === '1' || c.v === 'true';
            break;
          case 'e':
            valor = { error: c.v };
            break;
          case 'd':
            valor = new Date(c.v);
            break;
          default: {
            const n = Number(c.v);
            valor = Number.isFinite(n) && esFormatoDeFecha(formato) ? fechaDeSerie(n, this.sistema1904) : n;
          }
        }
      }

      const esFormula = !!formula || !!trozosDeLaMaestra;
      c = null;
      if (valor === null && !esFormula) return;

      totalCeldas++;
      if (esFormula) totalFormulas++;
      maxFila = Math.max(maxFila, fila);
      maxCol = Math.max(maxCol, col);

      const textoDeLaFormula = () =>
        formula ?? (trozosDeLaMaestra ? desplazar(trozosDeLaMaestra.trozos, col - trozosDeLaMaestra.col, fila - trozosDeLaMaestra.fila) : '');

      if (esFormula && forma !== undefined && !soloRect) agrupador.agregar(forma, col, fila, textoDeLaFormula, valor, formato);

      filaActual.push({
        col,
        fila,
        valor,
        formula: formula || undefined,
        maestra: trozosDeLaMaestra,
        formato
      });
    };

    await recorrer(this.zip, h.parte, {
      abre: (nombre, a, pila) => {
        const padre = pila[pila.length - 1];

        switch (nombre) {
          case 'row':
            cerrarFila();
            fila = Number(a.r) || fila + 1;
            break;
          case 'c':
            c = { dir: a.r ?? '', tipo: a.t, estilo: a.s !== undefined ? Number(a.s) : undefined, v: '', f: '', fAttr: null, tieneV: false, is: '' };
            break;
          case 'f':
            if (padre === 'c' && c) c.fAttr = a;
            texto = '';
            break;
          case 'v':
            if (c) c.tieneV = true;
            texto = '';
            break;
          case 't':
            texto = '';
            break;
          case 'mergeCell':
            if (a.ref) combinadas.push(a.ref);
            break;
          case 'dataValidation':
            validacion = { tipo: a.type ?? 'any', sqref: a.sqref ?? '', f1: '' };
            break;
          case 'conditionalFormatting':
            condicional = { sqref: a.sqref ?? '', reglas: [] };
            break;
          case 'cfRule':
            regla = { attrs: a, formulas: [] };
            break;
          case 'formula':
          case 'formula1':
          case 'sqref':
            texto = '';
            break;
          case 'tablePart':
            if (a['r:id']) partesDeTablas.push(a['r:id']);
            break;
        }
      },
      texto: (t) => {
        texto += t;
      },
      cierra: (nombre, pila) => {
        const padre = pila[pila.length - 1];

        switch (nombre) {
          case 'f':
            if (padre === 'c' && c) c.f = texto;
            else if (padre === 'formula1' && validacion) validacion.f1 = texto;
            else if (regla) regla.formulas.push(texto);
            break;
          case 'v':
            if (c) c.v = texto;
            break;
          case 't':
            if (c && pila.includes('is') && !pila.includes('rPh')) c.is += texto;
            break;
          case 'c':
            cerrarCelda();
            break;
          case 'row':
            cerrarFila();
            break;
          case 'formula1':
            if (validacion && !validacion.f1) validacion.f1 = texto;
            break;
          case 'formula':
            if (regla) regla.formulas.push(texto);
            break;
          case 'sqref':
            if (validacion) validacion.sqref = texto;
            else if (condicional) condicional.sqref = texto;
            break;
          case 'dataValidation':
            if (validacion) {
              for (const rango of validacion.sqref.split(/\s+/).filter(Boolean)) {
                validaciones.push({ rango, tipo: validacion.tipo, formula: validacion.f1 || undefined });
              }
            }
            validacion = null;
            break;
          case 'cfRule':
            if (regla && condicional) condicional.reglas.push(describirRegla(regla.attrs, regla.formulas));
            regla = null;
            break;
          case 'conditionalFormatting':
            if (condicional) {
              for (const rango of condicional.sqref.split(/\s+/).filter(Boolean)) {
                condicionales.push({ rango, reglas: condicional.reglas });
              }
            }
            condicional = null;
            break;
        }
      }
    });

    cerrarFila();
    for (const f of finales) celdas.push(...materializar(f));

    if (soloRect) {
      return { ...hojaVacia(h), celdas };
    }

    const rels = await relaciones(this.zip, h.parte);

    return {
      nombre: h.nombre,
      estado: h.estado,
      filas: maxFila,
      columnas: maxCol,
      celdas,
      tablas: await leerTablas(this.zip, partesDeTablas.map((id) => rels.get(id)?.destino).filter((d): d is string => !!d)),
      validaciones: juntarValidaciones(validaciones),
      formatosCondicionales: condicionales,
      notas: await leerNotas(this.zip, [...rels.values()].filter((r) => r.tipo === 'comments').map((r) => r.destino)),
      combinadas,
      totalCeldas,
      totalFormulas,
      reglas: agrupador.reglas(),
      perfil:
        filaEncabezado !== undefined && maxFila - filaEncabezado >= 3
          ? { filaEncabezado, filasDeDatos, columnas: [...perfiles.values()].map((p) => p.perfil).sort((a, b) => a.col - b.col) }
          : null,
      omitidas
    };
  }
}

function hojaVacia(h: HojaDelArchivo): HojaLeida {
  return {
    nombre: h.nombre,
    estado: h.estado,
    filas: 0,
    columnas: 0,
    celdas: [],
    tablas: [],
    validaciones: [],
    formatosCondicionales: [],
    notas: [],
    combinadas: []
  };
}

// ─── Partes chicas ──────────────────────────────────────────────────────────

async function leerTextosCompartidos(zip: JSZip, ruta: string): Promise<string[]> {
  const textos: string[] = [];
  let actual = '';
  let texto = '';

  await recorrer(zip, ruta, {
    abre: (nombre) => {
      if (nombre === 'si') actual = '';
      if (nombre === 't') texto = '';
    },
    texto: (t) => {
      texto += t;
    },
    cierra: (nombre, pila) => {
      // Las lecturas fonéticas (<rPh>) también traen <t>: no son parte del texto.
      if (nombre === 't' && !pila.includes('rPh')) actual += texto;
      if (nombre === 'si') textos.push(actual);
    }
  });

  return textos;
}

/** El formato de número de cada estilo de celda (índice de `cellXfs`). */
async function leerFormatos(zip: JSZip, ruta: string): Promise<Array<string | undefined>> {
  const xml = (await leerTexto(zip, ruta)) ?? '';
  const propios = new Map(etiquetas(xml, 'numFmt').map((e) => [Number(atributo(e, 'numFmtId')), atributo(e, 'formatCode') ?? '']));
  const xfs = bloques(xml, 'cellXfs')[0] ?? '';

  return etiquetas(xfs, 'xf').map((e) => {
    const id = Number(atributo(e, 'numFmtId') ?? 0);
    return id === 0 ? undefined : (propios.get(id) ?? FORMATOS_DE_FABRICA[id]);
  });
}

async function leerTablas(zip: JSZip, rutas: string[]): Promise<TablaLeida[]> {
  const salida: TablaLeida[] = [];

  for (const ruta of rutas) {
    const xml = await leerTexto(zip, ruta);
    if (!xml) continue;

    const tabla = etiquetas(xml, 'table')[0] ?? '';
    salida.push({
      nombre: atributo(tabla, 'displayName') ?? atributo(tabla, 'name') ?? '',
      rango: atributo(tabla, 'ref') ?? '',
      columnas: etiquetas(xml, 'tableColumn').map((e) => atributo(e, 'name') ?? '')
    });
  }

  return salida;
}

async function leerNotas(zip: JSZip, rutas: string[]): Promise<HojaLeida['notas']> {
  const salida: HojaLeida['notas'] = [];

  for (const ruta of rutas) {
    let celda = '';
    let actual = '';
    let texto = '';

    await recorrer(zip, ruta, {
      abre: (nombre, a) => {
        if (nombre === 'comment') {
          celda = a.ref ?? '';
          actual = '';
        }
        if (nombre === 't') texto = '';
      },
      texto: (t) => {
        texto += t;
      },
      cierra: (nombre) => {
        if (nombre === 't') actual += texto;
        if (nombre === 'comment' && celda) salida.push({ celda, texto: actual.trim() });
      }
    });
  }

  return salida;
}

async function leerTablasDinamicas(zip: JSZip, hojas: HojaDelArchivo[]): Promise<TablaDinamicaLeida[]> {
  const salida: TablaDinamicaLeida[] = [];

  for (const hoja of hojas) {
    for (const rel of (await relaciones(zip, hoja.parte)).values()) {
      if (rel.tipo !== 'pivotTable') continue;

      const xml = await leerTexto(zip, rel.destino);
      if (!xml) continue;

      const cache = [...(await relaciones(zip, rel.destino)).values()].find((r) => r.tipo === 'pivotCacheDefinition');
      const cacheXml = cache ? ((await leerTexto(zip, cache.destino)) ?? '') : '';
      const campos = etiquetas(cacheXml, 'cacheField').map((e) => atributo(e, 'name') ?? '');
      const fuente = etiquetas(cacheXml, 'worksheetSource')[0] ?? '';
      const campo = (x: string | undefined) => (x !== undefined && x !== '-2' ? (campos[Number(x)] ?? `campo ${x}`) : undefined);
      const def = etiquetas(xml, 'pivotTableDefinition')[0] ?? '';

      const lista = (bloque: string, attr: string) =>
        (bloques(xml, bloque)[0] ?? '')
          .match(/<(?:\w+:)?(?:field|pageField)\b[^>]*>/g)
          ?.map((e) => campo(atributo(e, attr)))
          .filter((c): c is string => !!c) ?? [];

      salida.push({
        nombre: atributo(def, 'name') ?? '',
        hoja: hoja.nombre,
        ubicacion: atributo(etiquetas(xml, 'location')[0] ?? '', 'ref'),
        origen: { hoja: atributo(fuente, 'sheet'), rango: atributo(fuente, 'ref'), nombre: atributo(fuente, 'name') },
        filas: lista('rowFields', 'x'),
        columnas: lista('colFields', 'x'),
        filtros: lista('pageFields', 'fld'),
        valores: etiquetas(xml, 'dataField').map((e) => ({
          rotulo: atributo(e, 'name') ?? '',
          campo: campo(atributo(e, 'fld')) ?? '',
          funcion: atributo(e, 'subtotal') ?? 'sum'
        }))
      });
    }
  }

  return salida;
}

const TIPOS_DE_GRAFICO: Record<string, string> = {
  barChart: 'barras',
  bar3DChart: 'barras 3D',
  lineChart: 'líneas',
  line3DChart: 'líneas 3D',
  pieChart: 'torta',
  pie3DChart: 'torta 3D',
  doughnutChart: 'anillo',
  areaChart: 'áreas',
  scatterChart: 'dispersión',
  bubbleChart: 'burbujas',
  radarChart: 'radar',
  stockChart: 'cotizaciones'
};

function textoDe(xml: string): string {
  return (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => desescapar(t.replace(/<\/?a:t>/g, ''))).join('');
}

function formulaDe(xml: string | undefined): string | undefined {
  const m = xml ? /<c:f>([^<]*)<\/c:f>/.exec(xml) : null;
  return m ? desescapar(m[1]) : undefined;
}

async function leerGraficos(zip: JSZip, hojas: HojaDelArchivo[]): Promise<GraficoLeido[]> {
  const salida: GraficoLeido[] = [];

  for (const hoja of hojas) {
    for (const dibujo of (await relaciones(zip, hoja.parte)).values()) {
      if (dibujo.tipo !== 'drawing') continue;

      for (const rel of (await relaciones(zip, dibujo.destino)).values()) {
        if (rel.tipo !== 'chart') continue;

        const xml = await leerTexto(zip, rel.destino);
        if (!xml) continue;

        const tipos = Object.keys(TIPOS_DE_GRAFICO).filter((t) => new RegExp(`<c:${t}\\b`).test(xml));
        const barDir = atributo(etiquetas(xml, 'barDir')[0] ?? '', 'val');
        const titulo = bloques(xml, 'title')[0];

        salida.push({
          hoja: hoja.nombre,
          tipo: tipos.map((t) => (t === 'barChart' && barDir === 'col' ? 'columnas' : TIPOS_DE_GRAFICO[t])).join(' + ') || 'otro',
          titulo: titulo ? textoDe(titulo) || formulaDe(titulo) : undefined,
          series: bloques(xml, 'ser').map((ser) => ({
            nombre: formulaDe(bloques(ser, 'tx')[0]) ?? (textoDe(bloques(ser, 'tx')[0] ?? '') || undefined),
            categorias: formulaDe(bloques(ser, 'cat')[0] ?? bloques(ser, 'xVal')[0]),
            valores: formulaDe(bloques(ser, 'val')[0] ?? bloques(ser, 'yVal')[0])
          }))
        });
      }
    }
  }

  return salida;
}

async function leerVinculosExternos(zip: JSZip, partes: string[]): Promise<VinculoExterno[]> {
  const salida: VinculoExterno[] = [];

  for (const [i, parte] of partes.entries()) {
    const xml = (await leerTexto(zip, parte)) ?? '';
    const rels = await relaciones(zip, parte);
    const libro = etiquetas(xml, 'externalBook')[0] ?? '';
    const destino = rels.get(atributo(libro, 'r:id') ?? '')?.destino ?? '';
    let archivo = destino;

    try {
      archivo = decodeURIComponent(destino);
    } catch {
      // Una ruta con un «%» suelto queda como vino.
    }

    salida.push({
      indice: i + 1,
      archivo: archivo.split(/[\\/]/).pop() || archivo,
      hojas: etiquetas(xml, 'sheetName').map((e) => atributo(e, 'val') ?? '')
    });
  }

  return salida;
}

/**
 * Los módulos de macros, por nombre.
 *
 * El proyecto VBA guarda en claro la lista de sus módulos (`Module=Nombre`);
 * el código va comprimido y no se lee. Alcanza para decir «este libro tiene
 * macros que hacen X», y nunca se ejecuta nada.
 */
async function leerMacros(zip: JSZip): Promise<LibroLeido['macros']> {
  const archivo = zip.file(/vbaProject\.bin$/i)[0];
  if (!archivo) return null;

  const crudo = Buffer.from(await archivo.async('uint8array')).toString('latin1');
  const modulos = [...crudo.matchAll(/(?:^|[\r\n])(?:Module|Class)=([^\r\n]{1,64})/g)].map((m) => m[1].trim());

  return { modulos: [...new Set(modulos)] };
}

function tamanoDescomprimido(zip: JSZip): number {
  let total = 0;

  for (const f of Object.values(zip.files)) {
    const datos = (f as unknown as { _data?: { uncompressedSize?: number } })._data;
    total += datos?.uncompressedSize ?? 0;
  }

  return total;
}

// ─── Entrada ────────────────────────────────────────────────────────────────

export async function leerLibro(archivo: Buffer, opciones: OpcionesDeLectura = {}): Promise<LibroLeido> {
  const lector = await LectorDeLibro.abrir(archivo, opciones);
  return lector.leer(opciones);
}

/** La dirección de una celda leída (`B7`). */
export function dirDe(c: Pick<CeldaLeida, 'col' | 'fila'>): string {
  return direccion(c.col, c.fila);
}
