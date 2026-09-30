/**
 * Los nombres de las funciones como los muestra un Excel en castellano.
 *
 * El archivo guarda las fórmulas SIEMPRE en inglés (`VLOOKUP`, `IFERROR`), sea
 * cual sea el idioma de quien la armó; es Excel el que las traduce al
 * mostrarlas. Quien aprende con una lección tiene enfrente un Excel en
 * castellano, así que una lección que dice `VLOOKUP` le habla de una función
 * que no encuentra en su pantalla.
 *
 * Las funciones nuevas vienen en el archivo con prefijo (`_xlfn.XLOOKUP`,
 * `_xlfn._xlws.FILTER`): se sacan antes de buscar. Una función que no está acá
 * queda en inglés, tal cual: mejor el nombre verdadero en otro idioma que uno
 * inventado.
 */
const FUNCIONES: Record<string, string> = {
  // Matemáticas y agregados
  SUM: 'SUMA',
  SUMIF: 'SUMAR.SI',
  SUMIFS: 'SUMAR.SI.CONJUNTO',
  SUMPRODUCT: 'SUMAPRODUCTO',
  PRODUCT: 'PRODUCTO',
  SUBTOTAL: 'SUBTOTALES',
  AGGREGATE: 'AGREGAR',
  AVERAGE: 'PROMEDIO',
  AVERAGEIF: 'PROMEDIO.SI',
  AVERAGEIFS: 'PROMEDIO.SI.CONJUNTO',
  COUNT: 'CONTAR',
  COUNTA: 'CONTARA',
  COUNTBLANK: 'CONTAR.BLANCO',
  COUNTIF: 'CONTAR.SI',
  COUNTIFS: 'CONTAR.SI.CONJUNTO',
  MAX: 'MAX',
  MIN: 'MIN',
  MAXIFS: 'MAX.SI.CONJUNTO',
  MINIFS: 'MIN.SI.CONJUNTO',
  LARGE: 'K.ESIMO.MAYOR',
  SMALL: 'K.ESIMO.MENOR',
  MEDIAN: 'MEDIANA',
  MODE: 'MODA',
  'MODE.SNGL': 'MODA.UNO',
  STDEV: 'DESVEST',
  'STDEV.S': 'DESVEST.M',
  'STDEV.P': 'DESVEST.P',
  RANK: 'JERARQUIA',
  'RANK.EQ': 'JERARQUIA.EQV',
  ROUND: 'REDONDEAR',
  ROUNDUP: 'REDONDEAR.MAS',
  ROUNDDOWN: 'REDONDEAR.MENOS',
  MROUND: 'REDOND.MULT',
  CEILING: 'MULTIPLO.SUPERIOR',
  FLOOR: 'MULTIPLO.INFERIOR',
  INT: 'ENTERO',
  TRUNC: 'TRUNCAR',
  ABS: 'ABS',
  MOD: 'RESIDUO',
  POWER: 'POTENCIA',
  SQRT: 'RAIZ',
  RAND: 'ALEATORIO',
  RANDBETWEEN: 'ALEATORIO.ENTRE',

  // Lógicas
  IF: 'SI',
  IFS: 'SI.CONJUNTO',
  IFERROR: 'SI.ERROR',
  IFNA: 'SI.ND',
  AND: 'Y',
  OR: 'O',
  NOT: 'NO',
  XOR: 'XO',
  SWITCH: 'CAMBIAR',
  TRUE: 'VERDADERO',
  FALSE: 'FALSO',

  // Búsqueda y referencia
  VLOOKUP: 'BUSCARV',
  HLOOKUP: 'BUSCARH',
  LOOKUP: 'BUSCAR',
  XLOOKUP: 'BUSCARX',
  INDEX: 'INDICE',
  MATCH: 'COINCIDIR',
  XMATCH: 'COINCIDIRX',
  CHOOSE: 'ELEGIR',
  OFFSET: 'DESREF',
  INDIRECT: 'INDIRECTO',
  ROW: 'FILA',
  ROWS: 'FILAS',
  COLUMN: 'COLUMNA',
  COLUMNS: 'COLUMNAS',
  TRANSPOSE: 'TRANSPONER',
  HYPERLINK: 'HIPERVINCULO',
  GETPIVOTDATA: 'IMPORTARDATOSDINAMICOS',
  FILTER: 'FILTRAR',
  SORT: 'ORDENAR',
  SORTBY: 'ORDENARPOR',
  UNIQUE: 'UNICOS',
  SEQUENCE: 'SECUENCIA',
  LET: 'LET',
  LAMBDA: 'LAMBDA',

  // Texto
  CONCATENATE: 'CONCATENAR',
  CONCAT: 'CONCAT',
  TEXTJOIN: 'UNIRCADENAS',
  TEXT: 'TEXTO',
  LEFT: 'IZQUIERDA',
  RIGHT: 'DERECHA',
  MID: 'EXTRAE',
  LEN: 'LARGO',
  TRIM: 'ESPACIOS',
  CLEAN: 'LIMPIAR',
  UPPER: 'MAYUSC',
  LOWER: 'MINUSC',
  PROPER: 'NOMPROPIO',
  FIND: 'ENCONTRAR',
  SEARCH: 'HALLAR',
  SUBSTITUTE: 'SUSTITUIR',
  REPLACE: 'REEMPLAZAR',
  REPT: 'REPETIR',
  EXACT: 'IGUAL',
  VALUE: 'VALOR',
  FIXED: 'DECIMAL',
  DOLLAR: 'MONEDA',
  CHAR: 'CARACTER',
  CODE: 'CODIGO',
  TEXTBEFORE: 'TEXTOANTES',
  TEXTAFTER: 'TEXTODESPUES',
  TEXTSPLIT: 'DIVIDIRTEXTO',

  // Información
  ISBLANK: 'ESBLANCO',
  ISERROR: 'ESERROR',
  ISERR: 'ESERR',
  ISNA: 'ESNOD',
  ISNUMBER: 'ESNUMERO',
  ISTEXT: 'ESTEXTO',
  NA: 'NOD',

  // Fechas y horas
  TODAY: 'HOY',
  NOW: 'AHORA',
  DATE: 'FECHA',
  TIME: 'NSHORA',
  YEAR: 'AÑO',
  MONTH: 'MES',
  DAY: 'DIA',
  HOUR: 'HORA',
  MINUTE: 'MINUTO',
  SECOND: 'SEGUNDO',
  WEEKDAY: 'DIASEM',
  WEEKNUM: 'NUM.DE.SEMANA',
  ISOWEEKNUM: 'ISO.NUM.DE.SEMANA',
  EOMONTH: 'FIN.MES',
  EDATE: 'FECHA.MES',
  DATEDIF: 'SIFECHA',
  DAYS: 'DIAS',
  NETWORKDAYS: 'DIAS.LAB',
  'NETWORKDAYS.INTL': 'DIAS.LAB.INTL',
  WORKDAY: 'DIA.LAB',
  'WORKDAY.INTL': 'DIA.LAB.INTL',
  DATEVALUE: 'FECHANUMERO',

  // Financieras
  PMT: 'PAGO',
  NPV: 'VNA',
  IRR: 'TIR',
  FV: 'VF',
  PV: 'VA',
  RATE: 'TASA',
  NPER: 'NPER'
};

/** Los errores, como los muestra Excel en castellano. */
export const ERRORES_EN_CASTELLANO: Record<string, string> = {
  '#N/A': '#N/D',
  '#VALUE!': '#¡VALOR!',
  '#REF!': '#¡REF!',
  '#DIV/0!': '#¡DIV/0!',
  '#NAME?': '#¿NOMBRE?',
  '#NUM!': '#¡NUM!',
  '#NULL!': '#¡NULO!',
  '#SPILL!': '#¡DESBORDAMIENTO!',
  '#CALC!': '#¡CALC!'
};

/** Los marcadores de una referencia estructurada (`Tabla[#Todo]`). */
export const MARCADORES_DE_TABLA: Record<string, string> = {
  '#ALL': '#Todo',
  '#DATA': '#Datos',
  '#HEADERS': '#Encabezados',
  '#TOTALS': '#Totales',
  '#THIS ROW': '#Esta fila'
};

/** Saca los prefijos con que el archivo guarda las funciones nuevas. */
export function nombreSinPrefijo(nombre: string): string {
  return nombre.replace(/^(?:_xlfn\.)?(?:_xlws\.)?/i, '').toUpperCase();
}

/** El nombre en castellano, o el mismo nombre si no lo conocemos. */
export function funcionEnCastellano(nombre: string): string {
  const limpio = nombreSinPrefijo(nombre);
  return FUNCIONES[limpio] ?? limpio;
}

/** Si la función tiene nombre en castellano conocido. */
export function tieneNombreEnCastellano(nombre: string): boolean {
  return nombreSinPrefijo(nombre) in FUNCIONES;
}
