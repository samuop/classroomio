/**
 * El mapa de un libro de Excel: lo que el asistente lee de la planilla.
 *
 * Una planilla aplanada a texto pierde justo lo importante: un «150» en una
 * celda no dice que sale de `=B4*C4` de otra hoja. El mapa dice primero cómo
 * está armado el libro —qué hojas hay, qué hoja alimenta a cuál, qué rangos
 * tienen nombre— y después, hoja por hoja, qué hay y cómo se calcula.
 *
 * Las fórmulas van como las ve alguien con Excel en castellano (`BUSCARV`, «;»)
 * porque de acá salen las lecciones, y una lección que dice `VLOOKUP` le habla
 * a quien aprende de una función que no está en su pantalla.
 *
 * Una hoja que entra va entera y con el texto completo de cada celda: muchas
 * planillas de las empresas no calculan nada, son procedimientos e instructivos
 * escritos en celdas, y su contenido es ese texto. Una hoja de datos de miles de
 * filas no entra ni hace falta: va el perfil de cada columna, unas filas de
 * muestra y las reglas de cálculo. El resto se consulta con la herramienta de
 * planillas (`consulta.ts`).
 */
import {
  analizar,
  celdaEn,
  celdasEn,
  rangoConHoja,
  type Analisis,
  type Flecha,
  type Regla
} from './analisis';
import { ERRORES_EN_CASTELLANO } from './funciones-en-castellano';
import { columnaALetras, formulaEnCastellano, rangoDe, rectanguloDe } from './formulas';
import {
  anotarEnPerfil,
  MAX_DISTINTOS,
  nuevoPerfil,
  type HojaLeida,
  type LibroLeido,
  type PerfilDeColumna,
  type ValorDeCelda
} from './leer-libro';

/** Hasta dónde puede crecer el mapa. Con más, se achican las muestras y las listas. */
export const MAX_MAPA = Number(process.env.AGENT_MAX_SPREADSHEET_MAP_CHARS) || 120_000;

// ─── Valores como los muestra Excel ─────────────────────────────────────────

const numero = (n: number, decimales: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: decimales });

function decimalesDelFormato(formato: string): number {
  const m = /\.(0+)/.exec(formato);
  return m ? m[1].length : 0;
}

/** Un valor como lo muestra un Excel en castellano con ese formato. */
export function mostrarValor(valor: ValorDeCelda, formato?: string): string {
  if (valor === null) return '';
  if (typeof valor === 'boolean') return valor ? 'VERDADERO' : 'FALSO';
  if (valor instanceof Date) return fecha(valor, formato);
  if (typeof valor === 'object') return ERRORES_EN_CASTELLANO[valor.error.toUpperCase()] ?? valor.error;
  if (typeof valor === 'string') return valor;

  const f = formato ?? '';

  if (f.includes('%')) return `${numero(valor * 100, decimalesDelFormato(f))}%`;

  if (/[$€]|\[\$/.test(f)) {
    const d = decimalesDelFormato(f);
    return `$ ${valor.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  }

  if (/0\.0/.test(f)) {
    const d = decimalesDelFormato(f);
    return valor.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  return numero(valor, Math.abs(valor) >= 100 ? 2 : 4);
}

function fecha(d: Date, formato?: string): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const base = `${dd}/${mm}/${d.getUTCFullYear()}`;

  if (formato && /h|s/i.test(formato.replace(/"[^"]*"/g, ''))) {
    return `${base} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  return base;
}

function corto(texto: string, max = 40): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

/** Para una celda de tabla markdown. */
function enTabla(texto: string, max: number): string {
  return corto(texto, max).replace(/\|/g, '/');
}

// ─── Piezas del mapa ────────────────────────────────────────────────────────

function formulaMostrada(analisis: Analisis, hoja: string, formula: string, col: number, fila: number): string {
  return formulaEnCastellano(formula, analisis.indice.tablaDeLaCelda(hoja, col, fila));
}

function describirFlecha(f: Flecha): string {
  const vias = f.vias.length ? ` (por ${f.vias.slice(0, 6).join(', ')}${f.vias.length > 6 ? '…' : ''})` : '';

  switch (f.camino) {
    case 'fórmulas':
      return `${f.desde} → ${f.hacia}: ${f.celdas} fórmula${f.celdas === 1 ? '' : 's'}${vias}`;
    case 'desplegables':
      return `${f.desde} → ${f.hacia}: las opciones de sus desplegables${vias}`;
    case 'tabla dinámica':
      return `${f.desde} → ${f.hacia}: la tabla dinámica${vias} resume sus datos`;
    case 'gráfico':
      return `${f.desde} → ${f.hacia}: un gráfico dibuja sus datos`;
  }
}

const PAPELES: Record<string, string> = {
  entrada: 'entrada: da datos a otras hojas y no toma de ninguna',
  cálculo: 'cálculo: toma datos de otras hojas y se los da a otras',
  resultado: 'resultado: toma datos de otras hojas y ninguna la usa',
  suelta: 'suelta: no da ni toma datos de otras hojas'
};

const FUNCIONES_DE_RESUMEN: Record<string, string> = {
  sum: 'suma',
  count: 'cuenta',
  average: 'promedio',
  max: 'máximo',
  min: 'mínimo',
  product: 'producto',
  countNums: 'cuenta de números',
  stdDev: 'desvío estándar',
  var: 'varianza'
};

function valorDeLaCelda(analisis: Analisis, referencia: string | undefined, hoja: string): string | undefined {
  if (!referencia) return undefined;
  const d = analisis.indice.destinosDe(referencia, hoja)[0];
  if (!d?.hoja || !d.rect || d.rect.col1 !== d.rect.col2 || d.rect.fila1 !== d.rect.fila2) return undefined;
  const h = analisis.indice.hoja(d.hoja);
  const c = h ? celdaEn(h, d.rect.col1, d.rect.fila1) : undefined;
  return c ? mostrarValor(c.valor, c.formato) : undefined;
}

// ─── Una hoja ───────────────────────────────────────────────────────────────

interface Presupuesto {
  filasDeMuestra: number;
  reglasPorHoja: number;
  /** Una hoja cuya grilla entera ocupa hasta esto va entera; si no, resumida. */
  caracteresPorHoja: number;
  /** Hasta dónde se copia el texto de una celda en la grilla entera. */
  largoDeCelda: number;
}

/**
 * Desde cuántas filas de datos una hoja con encabezados es una tabla de
 * registros y lleva el perfil de sus columnas.
 */
const FILAS_DE_UNA_TABLA = 60;

/** Las columnas que entran en una grilla. */
const MAX_COLUMNAS = 26;

/** El largo de una celda en las filas de muestra: ilustran, no son el contenido. */
const LARGO_DE_MUESTRA = 60;

type PerfilDeHoja = NonNullable<HojaLeida['perfil']>;

/**
 * La fila de encabezados y el perfil de cada columna debajo de ella.
 *
 * El lector lo arma sobre TODAS las filas mientras lee, también las que no
 * guarda. Un libro armado a mano (las pruebas) no lo trae: se saca de las
 * celdas, con la misma regla —primera fila con dos o más celdas y casi todas
 * con texto escrito, y filas debajo—.
 */
function perfilDeLaHoja(hoja: HojaLeida): PerfilDeHoja | null {
  if (hoja.perfil !== undefined) return hoja.perfil;

  const primera = hoja.celdas[0]?.fila;
  if (primera === undefined) return null;

  const fila = hoja.celdas.filter((c) => c.fila === primera);
  const textos = fila.filter((c) => typeof c.valor === 'string' && !c.formula);
  if (fila.length < 2 || textos.length / fila.length < 0.6 || hoja.filas - primera < 3) return null;

  const columnas = new Map(fila.map((c) => [c.col, { perfil: nuevoPerfil(c.col, String(c.valor)), vistos: new Set<string>() }]));
  const filasDeDatos = new Set<number>();

  for (const c of hoja.celdas) {
    if (c.fila <= primera) continue;
    filasDeDatos.add(c.fila);
    const p = columnas.get(c.col);
    if (p) anotarEnPerfil(p.perfil, c.valor, c.formato, p.vistos);
  }

  return { filaEncabezado: primera, filasDeDatos: filasDeDatos.size, columnas: [...columnas.values()].map((p) => p.perfil) };
}

function textoDelPerfil(p: PerfilDeColumna): string {
  if (p.numeros + p.fechas + p.textos + p.otros === 0) return 'vacía';

  const partes: string[] = [];

  if (p.fechas) partes.push(`fechas del ${fecha(new Date(p.fechaMin!))} al ${fecha(new Date(p.fechaMax!))}`);

  if (p.numeros) {
    partes.push(
      `${p.enteros ? 'números enteros' : 'números'} de ${mostrarValor(p.min!, p.formatoNumero)} a ${mostrarValor(p.max!, p.formatoNumero)}`
    );
  }

  if (p.textos) {
    const n = p.distintos.length;
    partes.push(
      !p.masDistintos && n <= 8
        ? `texto, ${n} valor${n === 1 ? '' : 'es'}: ${p.distintos.map((t) => corto(t, 30)).join(', ')}`
        : `texto, ${p.masDistintos ? `más de ${MAX_DISTINTOS}` : n} valores distintos (p. ej. ${p.distintos
            .slice(0, 4)
            .map((t) => `«${corto(t, 30)}»`)
            .join(', ')})`
    );
  }

  if (p.otros > 0) partes.push(`${p.otros} con otro tipo de dato (lógicos o errores)`);

  return partes.join('; ');
}

function avisoDeOmitidas(hoja: HojaLeida): string[] {
  if (!hoja.omitidas) return [];
  const { desde, hasta } = hoja.omitidas;
  return [
    `(Las filas ${desde} a ${hasta} no están en este mapa: se leyeron para el perfil de las columnas y las fórmulas, pero no se copian. Consultalas con la herramienta de planillas.)`
  ];
}

function grilla(hoja: HojaLeida, filas: number[], columnas: number[], largo: number): string[] {
  const porCelda = new Map(hoja.celdas.map((c) => [`${c.col},${c.fila}`, c]));
  const lineas = [`| | ${columnas.map(columnaALetras).join(' | ')} |`, `|---|${columnas.map(() => '---').join('|')}|`];

  for (const fila of filas) {
    lineas.push(
      `| ${fila} | ${columnas
        .map((col) => {
          const c = porCelda.get(`${col},${fila}`);
          return c ? enTabla(mostrarValor(c.valor, c.formato), largo) : '';
        })
        .join(' | ')} |`
    );
  }

  return lineas;
}

/**
 * Las filas con algo que entran en `tope` caracteres de grilla, en orden.
 * Una hoja escrita como documento —un procedimiento, un instructivo— tiene su
 * contenido en el texto de las celdas: se copia entero mientras entre.
 */
function filasQueEntran(
  hoja: HojaLeida,
  columnas: number[],
  largo: number,
  tope: number
): { filas: number[]; todas: number; siguiente?: number } {
  const mostradas = new Set(columnas);
  const porFila = new Map<number, number>();

  for (const c of hoja.celdas) {
    if (!mostradas.has(c.col)) continue;
    const texto = mostrarValor(c.valor, c.formato);
    porFila.set(c.fila, (porFila.get(c.fila) ?? columnas.length * 3 + 8) + Math.min(texto.length, largo));
  }

  const filas: number[] = [];
  let total = 0;

  for (const [fila, costo] of porFila) {
    total += costo;
    if (total > tope) return { filas, todas: porFila.size, siguiente: fila };
    filas.push(fila);
  }

  return { filas, todas: porFila.size };
}

function lineaDeRegla(analisis: Analisis, r: Regla): string {
  const f = formulaMostrada(analisis, r.hoja, r.formula, r.rect.col1, r.rect.fila1);
  const hoja = analisis.indice.hoja(r.hoja)!;

  if (r.celdas === 1) {
    return `- ${rangoDe(r.rect)}: \`${f}\`${r.valor !== null ? ` → ${corto(mostrarValor(r.valor, r.formato), 60)}` : ''}`;
  }

  return `- ${rangoDe(r.rect)} (${r.celdas} celdas, la misma fórmula copiada): \`${f}\` — la de ${rangoDe({ ...r.rect, col2: r.rect.col1, fila2: r.rect.fila1 })}`;
}

/**
 * El formato condicional, una línea por regla. Copiar y pegar formato en Excel
 * deja la misma regla repetida celda por celda —una hoja de procedimiento traía
 * 54—: los rangos de una misma regla se juntan en uno que los contiene.
 */
function formatosCondicionales(hoja: HojaLeida): string[] {
  const porRegla = new Map<string, Set<string>>();

  for (const f of hoja.formatosCondicionales) {
    const regla = f.reglas.join('; ');
    const rangos = porRegla.get(regla) ?? new Set<string>();
    for (const r of f.rango.split(/\s+/).filter(Boolean)) rangos.add(r);
    porRegla.set(regla, rangos);
  }

  return [...porRegla].map(([regla, rangos]) => {
    if (rangos.size <= 4) return `Formato condicional en ${[...rangos].join(', ')}: ${regla}.`;

    const rects = [...rangos].map((r) => rectanguloDe(r, hoja.filas, hoja.columnas)).filter((r) => r !== null);
    const junto = {
      col1: Math.min(...rects.map((r) => r.col1)),
      fila1: Math.min(...rects.map((r) => r.fila1)),
      col2: Math.max(...rects.map((r) => r.col2)),
      fila2: Math.max(...rects.map((r) => r.fila2))
    };
    return `Formato condicional en ${rangos.size} rangos dentro de ${rangoDe(junto)}: ${regla}.`;
  });
}

/** Hojas que no se pasan datos: el papel de cada una no dice nada. */
function sinFlujo(analisis: Analisis): boolean {
  return analisis.flechas.length === 0 && analisis.externos.size === 0;
}

function escribirHoja(analisis: Analisis, hoja: HojaLeida, p: Presupuesto): string[] {
  const reglas = analisis.reglas.get(hoja.nombre) ?? [];
  const papel = analisis.papel.get(hoja.nombre)!;
  const totalCeldas = hoja.totalCeldas ?? hoja.celdas.length;
  const formulas = hoja.totalFormulas ?? hoja.celdas.filter((c) => c.formula).length;
  const lineas: string[] = [];

  lineas.push(`## Hoja «${hoja.nombre}»${hoja.estado === 'visible' ? '' : ` (${hoja.estado})`}`);

  if (totalCeldas === 0) {
    lineas.push('Vacía.', '');
    return lineas;
  }

  lineas.push(
    `Ocupa ${rangoDe({ col1: 1, fila1: 1, col2: hoja.columnas, fila2: hoja.filas })}: ${totalCeldas} celdas con algo, ${formulas} con fórmula.${sinFlujo(analisis) ? '' : ` Papel: ${PAPELES[papel]}.`}`
  );

  const toma = analisis.flechas.filter((f) => f.hacia === hoja.nombre);
  const da = analisis.flechas.filter((f) => f.desde === hoja.nombre);
  const externos = analisis.externos.get(hoja.nombre);

  if (toma.length) lineas.push(`Toma datos de: ${toma.map((f) => `${f.desde} (${f.camino})`).join('; ')}.`);
  if (externos) lineas.push(`Toma datos de OTRO ARCHIVO que no tenemos: ${[...externos].join(', ')}.`);
  if (da.length) lineas.push(`Le da datos a: ${da.map((f) => `${f.hacia} (${f.camino})`).join('; ')}.`);

  for (const t of hoja.tablas) {
    lineas.push(`Tabla «${t.nombre}» en ${t.rango}, columnas: ${t.columnas.join(', ')}.`);
  }

  const cabecera = perfilDeLaHoja(hoja);
  const tabla = cabecera !== null && (cabecera.filasDeDatos > FILAS_DE_UNA_TABLA || totalCeldas > 400);
  const todasLasColumnas = [...new Set(hoja.celdas.map((c) => c.col))].sort((a, b) => a - b);
  const columnas = todasLasColumnas.slice(0, MAX_COLUMNAS);
  const entran = filasQueEntran(hoja, columnas, p.largoDeCelda, p.caracteresPorHoja);
  const entera = !hoja.omitidas && entran.siguiente === undefined;
  const contenido = `Contenido${reglas.length ? ' (valores; las fórmulas van abajo)' : ''}:`;
  const columnasDeMas =
    todasLasColumnas.length > columnas.length
      ? [
          `(Y ${todasLasColumnas.length - columnas.length} columnas más con contenido, desde la ${columnaALetras(todasLasColumnas[MAX_COLUMNAS])}: consultalas con la herramienta de planillas.)`
        ]
      : [];
  lineas.push('');

  if (tabla && cabecera) {
    lineas.push(
      `Una fila de encabezados (fila ${cabecera.filaEncabezado}) y ${cabecera.filasDeDatos} filas de datos debajo. Columnas (contadas sobre todas las filas):`
    );

    for (const columna of cabecera.columnas) {
      const col = columna.col;
      const deLaColumna = reglas.filter((r) => r.rect.col1 <= col && r.rect.col2 >= col);
      const validacion = hoja.validaciones.find((v) => v.rango.startsWith(`${columnaALetras(col)}`));
      const nota = hoja.notas.find((n) => n.celda === `${columnaALetras(col)}${cabecera.filaEncabezado}`);
      const condicional = hoja.formatosCondicionales.find((f) => f.rango.startsWith(columnaALetras(col)));

      const partes = [`- ${columnaALetras(col)} «${corto(columna.encabezado, 40)}»:`];
      for (const r of deLaColumna.slice(0, 3)) {
        partes.push(`fórmula en ${rangoDe(r.rect)} \`${formulaMostrada(analisis, hoja.nombre, r.formula, r.rect.col1, r.rect.fila1)}\`;`);
      }
      partes.push(textoDelPerfil(columna));
      if (validacion) partes.push(`— desplegable (${validacion.tipo === 'list' ? `lista ${validacion.formula ?? ''}` : validacion.tipo})`);
      if (condicional) partes.push(`— formato condicional en ${condicional.rango}: ${condicional.reglas.join('; ')}`);
      if (nota) partes.push(`— nota: «${corto(nota.texto, p.largoDeCelda)}»`);
      lineas.push(partes.join(' '));
    }

    if (entera) {
      lineas.push('', contenido, ...grilla(hoja, entran.filas, columnas, p.largoDeCelda));
    } else {
      // Lo que está arriba de los encabezados —el título, la fecha del informe— va siempre.
      const arriba = [...new Set(hoja.celdas.filter((c) => c.fila < cabecera.filaEncabezado).map((c) => c.fila))];
      const primeras = [...new Set(hoja.celdas.filter((c) => c.fila > cabecera.filaEncabezado).map((c) => c.fila))].slice(0, p.filasDeMuestra);
      lineas.push('', `Filas de muestra (${primeras.length} de ${cabecera.filasDeDatos}):`);
      lineas.push(...grilla(hoja, [...arriba, cabecera.filaEncabezado, ...primeras], columnas, LARGO_DE_MUESTRA));
      lineas.push(...avisoDeOmitidas(hoja));
    }

    lineas.push(...columnasDeMas);
  } else {
    lineas.push(contenido, ...grilla(hoja, entran.filas, columnas, p.largoDeCelda));
    if (entran.siguiente !== undefined) {
      lineas.push(
        `(Faltan ${entran.todas - entran.filas.length} filas con contenido, desde la ${entran.siguiente}: no entran en este mapa. Consultalas con la herramienta de planillas.)`
      );
    }
    lineas.push(...columnasDeMas, ...avisoDeOmitidas(hoja));

    for (const v of hoja.validaciones) lineas.push(`Desplegable en ${v.rango}: ${v.tipo === 'list' ? `lista ${v.formula ?? ''}` : v.tipo}.`);
    lineas.push(...formatosCondicionales(hoja));
    for (const n of hoja.notas) lineas.push(`Nota en ${n.celda}: «${corto(n.texto, p.largoDeCelda)}».`);
  }

  if (hoja.combinadas.length) lineas.push(`Celdas combinadas: ${hoja.combinadas.slice(0, 20).join(', ')}${hoja.combinadas.length > 20 ? '…' : ''}.`);

  if (reglas.length) {
    lineas.push('', `Fórmulas: ${formulas} celdas en ${reglas.length} regla${reglas.length === 1 ? '' : 's'} distinta${reglas.length === 1 ? '' : 's'}:`);
    for (const r of reglas.slice(0, p.reglasPorHoja)) lineas.push(lineaDeRegla(analisis, r));
    if (reglas.length > p.reglasPorHoja) {
      lineas.push(`(${reglas.length - p.reglasPorHoja} reglas más en esta hoja: consultalas con la herramienta de planillas)`);
    }
  }

  lineas.push('');
  return lineas;
}

// ─── El libro ───────────────────────────────────────────────────────────────

function escribir(libro: LibroLeido, analisis: Analisis, nombreDelArchivo: string, p: Presupuesto): string {
  const formulas = libro.hojas.reduce((s, h) => s + h.celdas.filter((c) => c.formula).length, 0);
  const reglas = [...analisis.reglas.values()].reduce((s, r) => s + r.length, 0);
  const ocultas = libro.hojas.filter((h) => h.estado !== 'visible').length;
  const tablas = libro.hojas.reduce((s, h) => s + h.tablas.length, 0);

  const l: string[] = [
    `# Planilla de Excel «${nombreDelArchivo}»`,
    '',
    'Este es el mapa del libro, armado al leer el archivo: cómo está organizado, de dónde sale cada dato y cómo se calcula. Las fórmulas están escritas como las muestra Excel en castellano. Los valores son los que Excel guardó la última vez que se grabó el archivo. Para ver cualquier rango completo, rastrear de dónde sale un número o quién usa una celda, usá la herramienta de planillas con esta fuente.',
    '',
    '## Resumen',
    `${libro.hojas.length} hoja${libro.hojas.length === 1 ? '' : 's'}${ocultas ? ` (${ocultas} oculta${ocultas === 1 ? '' : 's'})` : ''}, ${libro.nombres.length} rango${libro.nombres.length === 1 ? '' : 's'} con nombre, ${tablas} tabla${tablas === 1 ? '' : 's'}, ${libro.tablasDinamicas.length} tabla${libro.tablasDinamicas.length === 1 ? '' : 's'} dinámica${libro.tablasDinamicas.length === 1 ? '' : 's'}, ${libro.graficos.length} gráfico${libro.graficos.length === 1 ? '' : 's'}; ${formulas} celdas con fórmula que son ${reglas} regla${reglas === 1 ? '' : 's'} distinta${reglas === 1 ? '' : 's'}.`,
    '',
    '## Recorrido de los datos (de las entradas a los resultados)'
  ];

  if (sinFlujo(analisis)) {
    l.push('Las hojas no se pasan datos: ninguna fórmula ni desplegable de una usa otra. Cada una se lee por su cuenta, en el orden del libro:');
  }

  analisis.orden.forEach((nombre, i) => {
    const h = analisis.indice.hoja(nombre)!;
    const estado = h.estado === 'visible' ? '' : h.estado;
    const detalle = sinFlujo(analisis) ? estado : [analisis.papel.get(nombre), estado].filter(Boolean).join(', ');
    l.push(`${i + 1}. ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  });

  if (analisis.flechas.length) {
    l.push('', 'Quién le da datos a quién:');
    for (const f of analisis.flechas) l.push(`- ${describirFlecha(f)}`);
  }

  if (libro.vinculosExternos.length) {
    l.push('', '## Datos que vienen de OTROS archivos (no los tenemos)');
    for (const v of libro.vinculosExternos) {
      l.push(`- [${v.indice}] ${v.archivo}${v.hojas.length ? ` (hojas: ${v.hojas.join(', ')})` : ''}`);
    }
    l.push('Las celdas que los usan muestran el último valor que Excel trajo de ese archivo; si el archivo cambió, ese valor puede estar viejo.');
  }

  if (libro.nombres.length) {
    l.push('', '## Rangos con nombre');
    for (const n of libro.nombres) {
      const usos = analisis.usosDeNombres.get(n.nombre);
      const valor = valorDeLaCelda(analisis, n.referencia, analisis.orden[0]);
      const quien = usos
        ? `; usado por: ${[...usos].map(([donde, c]) => (c === 0 ? donde : `${c} fórmula${c === 1 ? '' : 's'} de ${donde}`)).join(', ')}`
        : '; ninguna fórmula ni desplegable lo usa';
      l.push(`- ${n.nombre} = ${formulaEnCastellano(n.referencia).slice(1)}${valor !== undefined ? ` (vale ${valor})` : ''}${quien}`);
    }
  }

  if (libro.tablasDinamicas.length) {
    l.push('', '## Tablas dinámicas');
    for (const t of libro.tablasDinamicas) {
      const origen = t.origen.hoja ? `${t.origen.hoja}!${t.origen.rango ?? ''}` : (t.origen.nombre ?? 'un origen que no se pudo leer');
      const valores = t.valores.map((v) => `${v.rotulo} (${FUNCIONES_DE_RESUMEN[v.funcion] ?? v.funcion} de ${v.campo})`).join(', ');
      l.push(
        `- «${t.nombre}» en ${t.hoja}${t.ubicacion ? `!${t.ubicacion}` : ''}: resume ${origen}. Filas: ${t.filas.join(', ') || '—'}. Columnas: ${t.columnas.join(', ') || '—'}. Valores: ${valores || '—'}. Filtros: ${t.filtros.join(', ') || '—'}.`
      );
    }
    l.push('Una tabla dinámica no se recalcula sola: muestra los datos de la última vez que alguien la actualizó.');
  }

  if (libro.graficos.length) {
    l.push('', '## Gráficos');
    for (const g of libro.graficos) {
      const series = g.series
        .map((s) => {
          const nombre = valorDeLaCelda(analisis, s.nombre, g.hoja) ?? s.nombre;
          return `${nombre ? `«${nombre}»: ` : ''}valores ${s.valores ?? '—'}${s.categorias ? `, categorías ${s.categorias}` : ''}`;
        })
        .join('; ');
      l.push(`- Gráfico de ${g.tipo}${g.titulo ? ` «${g.titulo}»` : ''} en ${g.hoja}: ${series}.`);
    }
  }

  if (libro.macros) {
    l.push(
      '',
      '## Macros',
      `El libro tiene macros (código VBA)${libro.macros.modulos.length ? ` en ${libro.macros.modulos.length} módulo${libro.macros.modulos.length === 1 ? '' : 's'}: ${libro.macros.modulos.join(', ')}` : ''}. No se ejecutan y su código no se leyó: si hacen algo que importa para entender la planilla, hay que pedirle a quien la armó que lo explique.`
    );
  }

  l.push('');

  for (const nombre of analisis.orden) l.push(...escribirHoja(analisis, analisis.indice.hoja(nombre)!, p));

  return l.join('\n');
}

const PRESUPUESTOS: Presupuesto[] = [
  { filasDeMuestra: 6, reglasPorHoja: 60, caracteresPorHoja: 30_000, largoDeCelda: 1_000 },
  { filasDeMuestra: 3, reglasPorHoja: 30, caracteresPorHoja: 15_000, largoDeCelda: 400 },
  { filasDeMuestra: 2, reglasPorHoja: 15, caracteresPorHoja: 6_000, largoDeCelda: 150 },
  { filasDeMuestra: 1, reglasPorHoja: 6, caracteresPorHoja: 2_500, largoDeCelda: 60 }
];

/**
 * El mapa del libro. Si no entra en `maxCaracteres`, se achican las muestras y
 * las listas; lo que queda afuera se nombra y se consulta con la herramienta.
 */
export function mapaDelLibro(libro: LibroLeido, nombreDelArchivo: string, maxCaracteres = MAX_MAPA): string {
  const analisis = analizar(libro);
  let mapa = '';

  for (const p of PRESUPUESTOS) {
    mapa = escribir(libro, analisis, nombreDelArchivo, p);
    if (mapa.length <= maxCaracteres) return mapa;
  }

  return `${mapa.slice(0, maxCaracteres)}\n\n(El mapa sigue: es más largo de lo que entra acá. Consultá el resto con la herramienta de planillas.)`;
}

/** Una hoja con más muestras y todas sus reglas: lo que el mapa del libro resumió. */
export function mapaDeUnaHoja(analisis: Analisis, nombre: string): string | null {
  const hoja = analisis.indice.hoja(nombre);
  if (!hoja) return null;
  // La respuesta de la herramienta se corta en 12.000 caracteres: la grilla entera, hasta 10.000.
  return escribirHoja(analisis, hoja, { filasDeMuestra: 25, reglasPorHoja: 300, caracteresPorHoja: 10_000, largoDeCelda: 1_000 }).join('\n');
}

export { celdasEn, rangoConHoja };
