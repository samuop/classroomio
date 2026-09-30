/**
 * Consultar una planilla a pedido: lo que el mapa no alcanza a mostrar.
 *
 * El mapa de un libro grande lleva muestras y reglas, no las 50.000 filas. Para
 * explicar de dónde sale un total, el asistente tiene que poder seguirlo celda
 * por celda como lo haría alguien con el Excel abierto: ver un rango, rastrear
 * los precedentes de una celda, ver quién la usa, buscar un texto.
 *
 * Todo trabaja sobre el libro leído (`leer-libro.ts`), sin calcular: los valores
 * son los que Excel guardó.
 */
import { analizar, celdaDeLaRegla, celdasEn, rangoConHoja, seTocan, type Analisis, type Destino, type Regla } from './analisis';
import {
  columnaALetras,
  formulaEnCastellano,
  leerExtremo,
  piezas,
  rangoDe,
  rectanguloDe,
  referenciasDe,
  type Rectangulo,
  type Referencia
} from './formulas';
import { dirDe, type CeldaLeida, type HojaLeida, type LibroLeido } from './leer-libro';
import { mapaDeUnaHoja, mostrarValor } from './mapa-del-libro';

/** Cuánto devuelve una consulta, para que una sola no llene el contexto. */
export const MAX_RESPUESTA = 12_000;
const MAX_CELDAS_DE_UN_RANGO = 400;

export class ConsultaInvalidaError extends Error {}

/** Vuelve a leer del archivo las celdas de un rango de una hoja (las filas que el libro leído no guardó). */
export type Releer = (hoja: string, rect: Rectangulo) => Promise<CeldaLeida[]>;

export class ConsultaDePlanilla {
  readonly analisis: Analisis;

  constructor(
    readonly libro: LibroLeido,
    private readonly releer?: Releer
  ) {
    this.analisis = analizar(libro);
  }

  /** Si un rango cae, aunque sea en parte, en filas que el libro leído no guardó. */
  private tocaOmitidas(h: HojaLeida, r: Rectangulo): boolean {
    return !!h.omitidas && r.fila1 <= h.omitidas.hasta && r.fila2 >= h.omitidas.desde;
  }

  /**
   * Las celdas de un rango ACOTADO: las guardadas o, si caen en filas que no se
   * guardaron, leídas de nuevo del archivo.
   */
  private async celdasDelRango(h: HojaLeida, r: Rectangulo): Promise<CeldaLeida[]> {
    if (this.releer && this.tocaOmitidas(h, r)) return this.releer(h.nombre, r);
    return celdasEn(h, r);
  }

  private hoja(nombre: string): HojaLeida {
    const h = this.analisis.indice.hoja(nombre.replace(/^'|'$/g, '').replace(/''/g, "'"));
    if (!h) {
      throw new ConsultaInvalidaError(`No sheet named "${nombre}". Sheets: ${this.libro.hojas.map((x) => x.nombre).join(', ')}.`);
    }
    return h;
  }

  /**
   * Una dirección como la escribiría una persona: `B7`, `Ventas!H2:H10`,
   * `'Resumen mensual'!B7`, `Resumen mensual!B7`, un nombre (`IVA`) o una
   * columna de tabla (`TablaProductos[Costo]`).
   */
  ubicar(ref: string, hojaPorDefecto?: string): { hoja: HojaLeida; rect: Rectangulo; via?: string } {
    const texto = ref.trim().replace(/^=/, '');
    const bang = texto.lastIndexOf('!');

    if (bang > 0) {
      const hoja = this.hoja(texto.slice(0, bang));
      const rect = rectanguloDe(texto.slice(bang + 1).replace(/\$/g, ''), hoja.filas, hoja.columnas);
      if (!rect) throw new ConsultaInvalidaError(`"${ref}" is not a cell or range.`);
      return { hoja, rect };
    }

    const directa = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$|^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}$/.test(texto);

    if (directa) {
      if (!hojaPorDefecto) throw new ConsultaInvalidaError(`Say which sheet "${ref}" is on: pass sheet, or write it as Sheet!${ref}.`);
      const hoja = this.hoja(hojaPorDefecto);
      return { hoja, rect: rectanguloDe(texto.replace(/\$/g, ''), hoja.filas, hoja.columnas)! };
    }

    const destinos = this.analisis.indice.destinosDe(texto, hojaPorDefecto ?? this.libro.hojas[0]?.nombre ?? '');
    const d = destinos.find((x) => x.hoja && x.rect);
    if (!d) throw new ConsultaInvalidaError(`"${ref}" is not a cell, range, defined name or table column of this workbook.`);

    return { hoja: this.hoja(d.hoja!), rect: d.rect!, via: d.via ?? texto };
  }

  private formula(hoja: string, c: CeldaLeida): string {
    return formulaEnCastellano(c.formula!, this.analisis.indice.tablaDeLaCelda(hoja, c.col, c.fila));
  }

  private describirCelda(hoja: string, c: CeldaLeida | undefined, direccion: string): string {
    if (!c) return `${direccion}: vacía`;
    const valor = mostrarValor(c.valor, c.formato);
    return c.formula ? `${direccion} = ${valor || '(empty)'} ← \`${this.formula(hoja, c)}\`` : `${direccion} = ${valor} (typed value, no formula)`;
  }

  private reglasEn(hoja: string, rect: Rectangulo): Regla[] {
    return (this.analisis.reglas.get(hoja) ?? []).filter((r) => seTocan(r.rect, rect));
  }

  // ─── Acciones ─────────────────────────────────────────────────────────────

  /** Los valores de un rango en una grilla, y las fórmulas que tiene. */
  async rango(ref: string, hojaPorDefecto?: string): Promise<string> {
    const { hoja, rect, via } = this.ubicar(ref, hojaPorDefecto);
    const alto = rect.fila2 - rect.fila1 + 1;
    const ancho = rect.col2 - rect.col1 + 1;
    const recorte =
      alto * ancho > MAX_CELDAS_DE_UN_RANGO
        ? { ...rect, fila2: rect.fila1 + Math.max(1, Math.floor(MAX_CELDAS_DE_UN_RANGO / ancho)) - 1, col2: rect.col1 + Math.min(ancho, 26) - 1 }
        : rect;

    const celdas = new Map((await this.celdasDelRango(hoja, recorte)).map((c) => [`${c.col},${c.fila}`, c]));
    const lineas = [`${rangoConHoja(hoja.nombre, rect)}${via ? ` (${via})` : ''}`];
    lineas.push(`| | ${Array.from({ length: recorte.col2 - recorte.col1 + 1 }, (_, i) => rangoDe({ col1: recorte.col1 + i, col2: recorte.col1 + i, fila1: 1, fila2: 1 }).replace(/\d+/, '')).join(' | ')} |`);

    for (let fila = recorte.fila1; fila <= Math.min(recorte.fila2, hoja.filas); fila++) {
      const valores: string[] = [];
      for (let col = recorte.col1; col <= recorte.col2; col++) {
        const c = celdas.get(`${col},${fila}`);
        valores.push(c ? mostrarValor(c.valor, c.formato).replace(/\|/g, '/') : '');
      }
      lineas.push(`| ${fila} | ${valores.join(' | ')} |`);
    }

    if (recorte !== rect) lineas.push(`(Only the first ${recorte.fila2 - recorte.fila1 + 1} rows are shown: ask for a smaller range to see the rest.)`);

    const reglas = this.reglasEn(hoja.nombre, rect);
    if (reglas.length) {
      lineas.push('', 'Formulas in this range:');
      for (const r of reglas.slice(0, 40)) {
        lineas.push(
          `- ${rangoDe(r.rect)}${r.celdas > 1 ? ` (${r.celdas} cells, same formula copied)` : ''}: \`${this.formula(hoja.nombre, celdaDeLaRegla(r))}\``
        );
      }
    }

    return recortar(lineas.join('\n'));
  }

  /** De dónde sale el valor de una celda, hacia atrás, hasta `profundidad` pasos. */
  async rastrear(ref: string, hojaPorDefecto?: string, profundidad = 3): Promise<string> {
    const { hoja, rect } = this.ubicar(ref, hojaPorDefecto);
    const lineas: string[] = [];
    const vistos = new Set<string>();

    const seguir = async (h: HojaLeida, r: Rectangulo, nivel: number, sangria: string): Promise<void> => {
      const clave = `${h.nombre}!${rangoDe(r)}`;
      const unaCelda = r.col1 === r.col2 && r.fila1 === r.fila2;

      if (vistos.has(clave)) {
        lineas.push(`${sangria}${rangoConHoja(h.nombre, r)} (already shown above)`);
        return;
      }
      vistos.add(clave);

      if (unaCelda) {
        const [c] = await this.celdasDelRango(h, r);
        lineas.push(`${sangria}${this.describirCelda(h.nombre, c, rangoConHoja(h.nombre, r))}`);
        if (!c?.formula || nivel >= profundidad) return;
        for (const d of this.analisis.indice.destinosDe(c.formula, h.nombre, c)) await this.seguirDestino(d, nivel + 1, `${sangria}  `, seguir, lineas);
        return;
      }

      // Un rango: qué valores tiene y con qué reglas se calcula. Una columna entera
      // no se vuelve a leer: se muestra lo guardado y se dice que es una muestra.
      const celdas = celdasEn(h, r);
      const reglas = this.reglasEn(h.nombre, r);
      const muestras = celdas.slice(0, 5).map((c) => `${dirDe(c)}=${mostrarValor(c.valor, c.formato)}`).join(', ');
      const muestra = this.tocaOmitidas(h, r) ? ` (a sample: rows ${h.omitidas!.desde}–${h.omitidas!.hasta} are not kept)` : '';
      lineas.push(
        `${sangria}${rangoConHoja(h.nombre, r)}: ${celdas.length} cell(s) with content${muestra}${muestras ? ` (${muestras}${celdas.length > 5 ? ', …' : ''})` : ''}`
      );

      if (nivel >= profundidad) return;

      for (const regla of reglas.slice(0, 6)) {
        const primera = celdaDeLaRegla(regla);
        lineas.push(`${sangria}  computed in ${rangoDe(regla.rect)} with \`${this.formula(h.nombre, primera)}\``);
        for (const d of this.analisis.indice.destinosDe(regla.formula, h.nombre, primera)) {
          await this.seguirDestino(d, nivel + 1, `${sangria}    `, seguir, lineas);
        }
      }
    };

    await seguir(hoja, rect, 0, '');
    return recortar(lineas.join('\n'));
  }

  private async seguirDestino(
    d: Destino,
    nivel: number,
    sangria: string,
    seguir: (h: HojaLeida, r: Rectangulo, nivel: number, sangria: string) => Promise<void>,
    lineas: string[]
  ): Promise<void> {
    if (d.externo) {
      lineas.push(`${sangria}from ANOTHER FILE we do not have: ${d.externo}${d.via ? ` (${d.via})` : ''}`);
      return;
    }

    if (!d.hoja || !d.rect) return;
    if (d.via) lineas.push(`${sangria}via ${d.via}:`);
    await seguir(this.hoja(d.hoja), d.rect, nivel, d.via ? `${sangria}  ` : sangria);
  }

  /** Qué fórmulas, desplegables, tablas dinámicas y gráficos usan una celda o un rango. */
  quienUsa(ref: string, hojaPorDefecto?: string): string {
    const { hoja, rect } = this.ubicar(ref, hojaPorDefecto);
    const lineas = [`Who uses ${rangoConHoja(hoja.nombre, rect)}:`];
    const tocaAlObjetivo = (d: Destino) => d.hoja?.toLowerCase() === hoja.nombre.toLowerCase() && d.rect && seTocan(d.rect, rect);

    for (const h of this.libro.hojas) {
      for (const regla of this.analisis.reglas.get(h.nombre) ?? []) {
        // Primero con la celda de arriba a la izquierda: si ninguna referencia va a
        // la hoja buscada, ninguna celda de la regla puede tocarla.
        const primera = celdaDeLaRegla(regla);
        const destinos = this.analisis.indice.destinosDe(regla.formula, h.nombre, primera);
        if (!destinos.some((d) => d.hoja?.toLowerCase() === hoja.nombre.toLowerCase())) continue;

        // La fórmula se lee una vez por regla, no una por celda: en cada posición
        // sólo se corren las partes relativas de sus referencias, como al copiarla.
        // Se recorren las posiciones de la regla y no las celdas guardadas: en una
        // hoja grande casi todas las celdas de la regla no están guardadas.
        const base = referenciasConSigno(regla.formula);
        const usa = (col: number, fila: number) =>
          base.some((r) =>
            this.analisis.indice
              .resolver(r.fija ? r.ref : correr(r.ref, col - regla.rect.col1, fila - regla.rect.fila1), h.nombre, { col, fila })
              .some(tocaAlObjetivo)
          );

        let cuantas = 0;
        let unica = '';

        if (base.every((r) => r.fija)) {
          if (usa(primera.col, primera.fila)) cuantas = regla.celdas;
        } else {
          for (let fila = regla.rect.fila1; fila <= regla.rect.fila2; fila++) {
            for (let col = regla.rect.col1; col <= regla.rect.col2; col++) {
              if (!usa(col, fila)) continue;
              cuantas++;
              unica = dirDe({ col, fila });
            }
          }
        }

        if (!cuantas) continue;

        lineas.push(
          `- ${rangoConHoja(h.nombre, regla.rect)}: ${cuantas === 1 && unica ? unica : `${cuantas} cells`} with \`${this.formula(h.nombre, primera)}\``
        );
      }

      for (const v of h.validaciones) {
        if (v.formula && this.analisis.indice.destinosDe(v.formula, h.nombre).some(tocaAlObjetivo)) {
          lineas.push(`- the dropdowns of ${rangoConHoja(h.nombre, rectanguloDe(v.rango)!)} take their options from here`);
        }
      }
    }

    for (const t of this.libro.tablasDinamicas) {
      if (t.origen.hoja?.toLowerCase() === hoja.nombre.toLowerCase() && t.origen.rango && seTocan(rectanguloDe(t.origen.rango)!, rect)) {
        lineas.push(`- the pivot table «${t.nombre}» on ${t.hoja} summarizes this data`);
      }
    }

    for (const g of this.libro.graficos) {
      if (g.series.some((s) => [s.valores, s.categorias].some((f) => f && this.analisis.indice.destinosDe(f, g.hoja).some(tocaAlObjetivo)))) {
        lineas.push(`- the ${g.tipo} chart${g.titulo ? ` «${g.titulo}»` : ''} on ${g.hoja} draws it`);
      }
    }

    for (const n of this.libro.nombres) {
      if (referenciasDe(n.referencia).some((r) => this.analisis.indice.resolver(r, hoja.nombre).some(tocaAlObjetivo))) {
        lineas.push(`- the defined name ${n.nombre} points here (formulas that use ${n.nombre} are listed above)`);
      }
    }

    if (lineas.length === 1) lineas.push('- nothing: no formula, dropdown, pivot table or chart of this workbook uses it.');
    return recortar(lineas.join('\n'));
  }

  /** Celdas cuyo valor o fórmula contiene un texto (sin mayúsculas ni tildes). */
  buscar(texto: string): string {
    const buscado = normalizar(texto);
    if (!buscado) throw new ConsultaInvalidaError('Say what to look for.');

    const hallazgos: string[] = [];

    for (const h of this.libro.hojas) {
      // Una fórmula copiada en 400 filas que coincide es UNA regla que coincide.
      for (const regla of this.analisis.reglas.get(h.nombre) ?? []) {
        if (hallazgos.length >= 40) break;
        const primera = celdaDeLaRegla(regla);
        if (!normalizar(this.formula(h.nombre, primera)).includes(buscado)) continue;
        hallazgos.push(
          regla.celdas === 1
            ? `- ${this.describirCelda(h.nombre, primera, rangoConHoja(h.nombre, regla.rect))}`
            : `- ${rangoConHoja(h.nombre, regla.rect)} (${regla.celdas} cells, same formula copied): \`${this.formula(h.nombre, primera)}\``
        );
      }

      // Formatear un número a la argentina es lo caro de buscar en un millón de
      // celdas: sólo hace falta si lo buscado tiene dígitos.
      const conDigitos = /\d/.test(buscado);

      for (const c of h.celdas) {
        if (hallazgos.length >= 40) break;
        if (typeof c.valor === 'number' && !conDigitos) continue;
        if (!normalizar(mostrarValor(c.valor, c.formato)).includes(buscado)) continue;
        hallazgos.push(`- ${this.describirCelda(h.nombre, c, rangoConHoja(h.nombre, { col1: c.col, col2: c.col, fila1: c.fila, fila2: c.fila }))}`);
      }
    }

    if (!hallazgos.length) return `Nothing in the workbook contains "${texto}".`;
    return recortar([`Cells containing "${texto}"${hallazgos.length >= 40 ? ' (first 40)' : ''}:`, ...hallazgos].join('\n'));
  }

  /** Una hoja entera, con más detalle que el mapa. */
  hojaEntera(nombre: string): string {
    const h = this.hoja(nombre);
    return recortar(mapaDeUnaHoja(this.analisis, h.nombre)!);
  }
}

/**
 * Las referencias de una fórmula, sabiendo cuáles se mueven al copiarla.
 *
 * Una referencia estructurada a la fila (`[@Costo]`) no está escrita con
 * direcciones, pero también cambia de celda en celda: la resuelve el índice con
 * la celda. Por eso sólo cuenta como fija la que no tiene nada relativo.
 */
function referenciasConSigno(formula: string): Array<{ ref: Referencia; fija: boolean }> {
  return piezas(formula).flatMap((p) => {
    if (p.tipo === 'referencia') {
      const fija = p.rango!.split(':').every((extremo) => {
        const e = leerExtremo(extremo);
        return (e.col === undefined || e.colFija) && (e.fila === undefined || e.filaFija);
      });
      return [{ ref: { hoja: p.hoja, externo: p.externo, rango: p.rango! }, fija }];
    }

    if (p.tipo !== 'nombre' && p.tipo !== 'estructurada') return [];

    return referenciasDe(`=${p.crudo}`).map((ref) => ({ ref, fija: !ref.tabla?.estaFila }));
  });
}

/** Una referencia corrida `dc` columnas y `df` filas en sus partes sin `$`. */
function correr(ref: Referencia, dc: number, df: number): Referencia {
  if (!ref.rango) return ref;

  const rango = ref.rango
    .split(':')
    .map((extremo) => {
      const e = leerExtremo(extremo);
      const col = e.col === undefined ? '' : `${e.colFija ? '$' : ''}${columnaALetras(e.colFija ? e.col : e.col + dc)}`;
      const fila = e.fila === undefined ? '' : `${e.filaFija ? '$' : ''}${e.filaFija ? e.fila : e.fila + df}`;
      return col + fila;
    })
    .join(':');

  return { ...ref, rango };
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function recortar(texto: string): string {
  return texto.length > MAX_RESPUESTA
    ? `${texto.slice(0, MAX_RESPUESTA)}\n(Answer cut at ${MAX_RESPUESTA} characters: ask for something narrower to see the rest.)`
    : texto;
}
