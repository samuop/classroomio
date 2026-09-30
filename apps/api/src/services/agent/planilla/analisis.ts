/**
 * Lo que se entiende de un libro sin mirar celda por celda.
 *
 * Tres preguntas que quien llega nuevo a una planilla se hace primero, y que el
 * archivo no contesta a simple vista:
 *
 * 1. ¿Cuántas reglas hay de verdad? Una columna con 400 fórmulas copiadas hacia
 *    abajo es UNA regla. Se agrupan por su forma relativa (`formaRelativa`).
 * 2. ¿De dónde sale cada cosa? Cada fórmula, desplegable, tabla dinámica y
 *    gráfico apunta a celdas de alguna hoja; eso arma el flujo entre hojas.
 * 3. ¿Por dónde empiezo? Por las hojas que alimentan a otras sin depender de
 *    nadie (las entradas) y terminando por las que nadie usa (los resultados).
 */
import {
  formaRelativa,
  piezas,
  rangoDe,
  rectanguloDe,
  referenciasDe,
  type Rectangulo,
  type Referencia
} from './formulas';
import type { CeldaLeida, HojaLeida, LibroLeido, TablaLeida, ValorDeCelda } from './leer-libro';

// ─── Reglas: las fórmulas copiadas, juntas ──────────────────────────────────

export interface Regla {
  hoja: string;
  rect: Rectangulo;
  /** La fórmula de la celda de arriba a la izquierda, en inglés, sin `=`. */
  formula: string;
  celdas: number;
  /** El valor y el formato de esa celda, que en una hoja grande puede no estar guardada. */
  valor: ValorDeCelda;
  formato?: string;
  /** La tabla a la que pertenece, si es una columna calculada. */
  tabla?: string;
}

/** La celda de arriba a la izquierda de una regla, esté guardada o no. */
export function celdaDeLaRegla(r: Regla): CeldaLeida {
  return { col: r.rect.col1, fila: r.rect.fila1, valor: r.valor, formula: r.formula, formato: r.formato };
}

export function reglasDeLaHoja(hoja: HojaLeida): Regla[] {
  // El lector las arma sobre la hoja entera mientras la lee; las celdas
  // guardadas de una hoja grande son sólo una parte.
  if (hoja.reglas) {
    return hoja.reglas.map((r) => ({ ...r, hoja: hoja.nombre, tabla: tablaQueContiene(hoja.tablas, r.rect)?.nombre }));
  }

  // Todo en mapas y agregando al final: una hoja de 150.000 filas tiene cientos
  // de miles de fórmulas, y cualquier cosa que copie la lista en cada paso crece
  // al cuadrado (medido: más de diez minutos con 50.000 filas).
  const porForma = new Map<string, CeldaLeida[]>();

  for (const c of hoja.celdas) {
    if (!c.formula) continue;
    const forma = formaRelativa(c.formula, c.col, c.fila);
    const lista = porForma.get(forma);
    if (lista) lista.push(c);
    else porForma.set(forma, [c]);
  }

  const reglas: Regla[] = [];

  for (const celdas of porForma.values()) {
    // Tramos seguidos dentro de cada columna…
    const porColumna = new Map<number, number[]>();
    for (const c of celdas) {
      const filas = porColumna.get(c.col);
      if (filas) filas.push(c.fila);
      else porColumna.set(c.col, [c.fila]);
    }

    const tramos: Rectangulo[] = [];

    for (const [col, filas] of [...porColumna].sort((a, b) => a[0] - b[0])) {
      filas.sort((a, b) => a - b);
      let desde = filas[0];

      for (let i = 1; i <= filas.length; i++) {
        if (i === filas.length || filas[i] !== filas[i - 1] + 1) {
          tramos.push({ col1: col, col2: col, fila1: desde, fila2: filas[i - 1] });
          if (i < filas.length) desde = filas[i];
        }
      }
    }

    // …y los tramos de columnas vecinas con las mismas filas, en un rectángulo.
    const juntos: Rectangulo[] = [];
    const abiertos = new Map<string, Rectangulo>();

    for (const t of tramos) {
      const vecino = abiertos.get(`${t.col1 - 1}:${t.fila1}:${t.fila2}`);

      if (vecino) {
        abiertos.delete(`${vecino.col2}:${t.fila1}:${t.fila2}`);
        vecino.col2 = t.col2;
        abiertos.set(`${vecino.col2}:${t.fila1}:${t.fila2}`, vecino);
      } else {
        const nuevo = { ...t };
        juntos.push(nuevo);
        abiertos.set(`${nuevo.col2}:${nuevo.fila1}:${nuevo.fila2}`, nuevo);
      }
    }

    const porDireccion = new Map(celdas.map((c) => [`${c.col},${c.fila}`, c]));

    for (const rect of juntos) {
      const primera = porDireccion.get(`${rect.col1},${rect.fila1}`)!;
      reglas.push({
        hoja: hoja.nombre,
        rect,
        formula: primera.formula!,
        celdas: (rect.col2 - rect.col1 + 1) * (rect.fila2 - rect.fila1 + 1),
        valor: primera.valor,
        formato: primera.formato,
        tabla: tablaQueContiene(hoja.tablas, rect)?.nombre
      });
    }
  }

  return reglas.sort((a, b) => a.rect.fila1 - b.rect.fila1 || a.rect.col1 - b.rect.col1);
}

function contiene(afuera: Rectangulo, adentro: Rectangulo): boolean {
  return afuera.col1 <= adentro.col1 && afuera.col2 >= adentro.col2 && afuera.fila1 <= adentro.fila1 && afuera.fila2 >= adentro.fila2;
}

function tablaQueContiene(tablas: TablaLeida[], rect: Rectangulo): TablaLeida | undefined {
  return tablas.find((t) => {
    const r = rectanguloDe(t.rango);
    return r && contiene(r, rect);
  });
}

export function seTocan(a: Rectangulo, b: Rectangulo): boolean {
  return a.col1 <= b.col2 && b.col1 <= a.col2 && a.fila1 <= b.fila2 && b.fila1 <= a.fila2;
}

// ─── A dónde apunta una referencia ──────────────────────────────────────────

export interface Destino {
  /** La hoja de este libro; ausente si apunta a otro archivo. */
  hoja?: string;
  rect?: Rectangulo;
  /** El archivo externo, cuando la referencia sale del libro. */
  externo?: string;
  /** Por qué camino llegó: el nombre definido o la tabla que se usó. */
  via?: string;
}

export class IndiceDelLibro {
  readonly hojas = new Map<string, HojaLeida>();
  readonly tablas = new Map<string, { hoja: string; tabla: TablaLeida }>();
  readonly nombres = new Map<string, string>();

  constructor(readonly libro: LibroLeido) {
    for (const h of libro.hojas) {
      this.hojas.set(h.nombre.toLowerCase(), h);
      for (const t of h.tablas) this.tablas.set(t.nombre.toLowerCase(), { hoja: h.nombre, tabla: t });
    }

    for (const n of libro.nombres) this.nombres.set(n.nombre.toLowerCase(), n.referencia);
  }

  hoja(nombre: string): HojaLeida | undefined {
    return this.hojas.get(nombre.toLowerCase());
  }

  /** La tabla que tiene adentro a una celda. */
  tablaDeLaCelda(hoja: string, col: number, fila: number): string | undefined {
    const h = this.hoja(hoja);
    return h ? tablaQueContiene(h.tablas, { col1: col, col2: col, fila1: fila, fila2: fila })?.nombre : undefined;
  }

  private externo(ref: Pick<Referencia, 'externo'>): string | undefined {
    if (!ref.externo) return undefined;
    const indice = Number(ref.externo.replace(/[[\]]/g, ''));
    return this.libro.vinculosExternos.find((v) => v.indice === indice)?.archivo ?? ref.externo.replace(/[[\]]/g, '');
  }

  /**
   * Las celdas a las que apunta una referencia de una fórmula que está en
   * `hojaActual`. Un nombre puede apuntar a una constante (`=0,21`): ahí no hay
   * destino, y se devuelve vacío.
   */
  resolver(ref: Referencia, hojaActual: string, celda?: { col: number; fila: number }, profundidad = 0): Destino[] {
    const externo = this.externo(ref);

    if (externo) return [{ externo, via: ref.hoja ? `${ref.hoja}!${ref.rango ?? ref.nombre ?? ''}` : ref.nombre }];

    if (ref.rango) {
      const hoja = ref.hoja ?? hojaActual;
      const h = this.hoja(hoja);
      const rect = rectanguloDe(ref.rango, h?.filas || 1, h?.columnas || 1);
      return rect ? [{ hoja: h?.nombre ?? hoja, rect }] : [];
    }

    if (ref.nombre) {
      const referencia = this.nombres.get(ref.nombre.toLowerCase());

      // El nombre de una tabla solo (`BUSCARV(C2;TablaProductos;2;FALSO)`) son todas sus filas de datos.
      if (!referencia && this.tablas.has(ref.nombre.toLowerCase())) {
        return this.resolver({ tabla: { tabla: ref.nombre, columnas: [], estaFila: false } }, hojaActual, celda, profundidad + 1);
      }

      if (!referencia || profundidad > 4) return [];

      return referenciasDe(referencia).flatMap((r) =>
        this.resolver(r, hojaActual, celda, profundidad + 1).map((d) => ({ ...d, via: ref.nombre }))
      );
    }

    if (ref.tabla) {
      const nombre = ref.tabla.tabla || (celda ? this.tablaDeLaCelda(hojaActual, celda.col, celda.fila) : undefined);
      const encontrada = nombre ? this.tablas.get(nombre.toLowerCase()) : undefined;
      if (!encontrada) return [];

      const rect = rectanguloDe(encontrada.tabla.rango);
      if (!rect) return [];

      const datos = { ...rect, fila1: Math.min(rect.fila1 + 1, rect.fila2) };
      const via = encontrada.tabla.nombre;

      if (ref.tabla.columnas.length === 0) return [{ hoja: encontrada.hoja, rect: datos, via }];

      return ref.tabla.columnas.flatMap((columna) => {
        const i = encontrada.tabla.columnas.findIndex((c) => c.toLowerCase() === columna.toLowerCase());
        if (i < 0) return [];

        const col = rect.col1 + i;
        const filas = ref.tabla!.estaFila && celda ? { fila1: celda.fila, fila2: celda.fila } : { fila1: datos.fila1, fila2: datos.fila2 };
        return [{ hoja: encontrada.hoja, rect: { col1: col, col2: col, ...filas }, via: `${via}[${columna}]` }];
      });
    }

    return [];
  }

  /** Todo a lo que apunta una fórmula de una celda. */
  destinosDe(formula: string, hoja: string, celda?: { col: number; fila: number }): Destino[] {
    return referenciasDe(formula).flatMap((r) => this.resolver(r, hoja, celda));
  }
}

// ─── El flujo entre hojas ───────────────────────────────────────────────────

export type Camino = 'fórmulas' | 'desplegables' | 'tabla dinámica' | 'gráfico';

export interface Flecha {
  /** La hoja que da los datos. */
  desde: string;
  /** La hoja que los usa. */
  hacia: string;
  camino: Camino;
  /** Cuántas celdas con fórmula la usan (en `fórmulas`). */
  celdas: number;
  /** Por dónde: nombres definidos o tablas que se usaron. */
  vias: string[];
}

export type Papel = 'entrada' | 'cálculo' | 'resultado' | 'suelta';

export interface Analisis {
  indice: IndiceDelLibro;
  reglas: Map<string, Regla[]>;
  flechas: Flecha[];
  /** Hojas que reciben datos de otro archivo: hoja → archivos. */
  externos: Map<string, Set<string>>;
  papel: Map<string, Papel>;
  /** De las entradas a los resultados. */
  orden: string[];
  /** Cuántas fórmulas usan cada nombre definido, por hoja. */
  usosDeNombres: Map<string, Map<string, number>>;
}

export function analizar(libro: LibroLeido): Analisis {
  const indice = new IndiceDelLibro(libro);
  const reglas = new Map(libro.hojas.map((h) => [h.nombre, reglasDeLaHoja(h)]));
  const flechas = new Map<string, Flecha>();
  const externos = new Map<string, Set<string>>();
  const usosDeNombres = new Map<string, Map<string, number>>();

  const anotar = (desde: string | undefined, hacia: string, camino: Camino, celdas: number, via?: string) => {
    if (!desde || desde === hacia) return;
    const clave = `${desde}\u0000${hacia}\u0000${camino}`;
    const f = flechas.get(clave) ?? { desde, hacia, camino, celdas: 0, vias: [] };
    f.celdas += celdas;
    if (via && !f.vias.includes(via)) f.vias.push(via);
    flechas.set(clave, f);
  };

  const usarNombre = (nombre: string, donde: string, cuantas: number) => {
    const usos = usosDeNombres.get(nombre) ?? new Map<string, number>();
    usos.set(donde, (usos.get(donde) ?? 0) + cuantas);
    usosDeNombres.set(nombre, usos);
  };

  for (const [hoja, lista] of reglas) {
    for (const regla of lista) {
      // Cada celda cuenta una vez por hoja de la que toma datos, aunque la nombre
      // tres veces (`SUMAR.SI.CONJUNTO(Ventas!H:H;Ventas!F:F;…;Ventas!B:B)`).
      const porHoja = new Map<string, Set<string>>();

      for (const ref of referenciasDe(regla.formula)) {
        if (ref.nombre && !ref.externo) usarNombre(ref.nombre, hoja, regla.celdas);

        for (const d of indice.resolver(ref, hoja, { col: regla.rect.col1, fila: regla.rect.fila1 })) {
          if (d.externo) {
            externos.set(hoja, (externos.get(hoja) ?? new Set()).add(d.externo));
            continue;
          }

          if (!d.hoja) continue;
          const vias = porHoja.get(d.hoja) ?? new Set<string>();
          if (d.via) vias.add(d.via);
          porHoja.set(d.hoja, vias);
        }
      }

      for (const [desde, vias] of porHoja) {
        anotar(desde, hoja, 'fórmulas', regla.celdas);
        for (const via of vias) anotar(desde, hoja, 'fórmulas', 0, via);
      }
    }
  }

  for (const h of libro.hojas) {
    for (const v of h.validaciones) {
      if (!v.formula) continue;

      for (const ref of referenciasDe(v.formula)) {
        if (ref.nombre && !ref.externo) usarNombre(ref.nombre, `desplegables de ${h.nombre} (${v.rango})`, 0);
      }

      for (const d of indice.destinosDe(v.formula, h.nombre)) anotar(d.hoja, h.nombre, 'desplegables', 0, d.via);
    }
  }

  for (const t of libro.tablasDinamicas) {
    const origen = t.origen.hoja ?? (t.origen.nombre ? indice.destinosDe(t.origen.nombre, t.hoja)[0]?.hoja : undefined);
    anotar(origen, t.hoja, 'tabla dinámica', 0, t.nombre);
  }

  for (const g of libro.graficos) {
    for (const s of g.series) {
      for (const f of [s.valores, s.categorias]) {
        if (f) for (const d of indice.destinosDe(f, g.hoja)) anotar(d.hoja, g.hoja, 'gráfico', 0);
      }
    }
  }

  const lista = [...flechas.values()];
  const papel = new Map<string, Papel>();

  for (const h of libro.hojas) {
    const recibe = lista.some((f) => f.hacia === h.nombre) || externos.has(h.nombre);
    const da = lista.some((f) => f.desde === h.nombre);
    papel.set(h.nombre, recibe && da ? 'cálculo' : da ? 'entrada' : recibe ? 'resultado' : 'suelta');
  }

  return { indice, reglas, flechas: lista, externos, papel, orden: ordenar(libro, lista), usosDeNombres };
}

/** De las entradas a los resultados; en un empate, en el orden de las pestañas. Un ciclo no traba nada. */
function ordenar(libro: LibroLeido, flechas: Flecha[]): string[] {
  const nombres = libro.hojas.map((h) => h.nombre);
  const faltan = new Map(nombres.map((n) => [n, new Set(flechas.filter((f) => f.hacia === n).map((f) => f.desde))]));
  const orden: string[] = [];

  while (orden.length < nombres.length) {
    const lista = nombres.filter((n) => !orden.includes(n) && [...faltan.get(n)!].every((d) => orden.includes(d)));
    // Un ciclo: sigue la primera hoja pendiente, en el orden de las pestañas.
    const siguiente = lista[0] ?? nombres.find((n) => !orden.includes(n))!;
    orden.push(siguiente);
  }

  return orden;
}

/**
 * Las celdas de cada hoja por dirección, armadas una vez.
 *
 * Buscar una celda recorriendo la hoja es gratis en una planilla de 50 celdas y
 * se come segundos en una de un millón, cuando se hace por cada regla.
 */
const direcciones = new WeakMap<HojaLeida, Map<string, CeldaLeida>>();

function porDireccion(hoja: HojaLeida): Map<string, CeldaLeida> {
  let mapa = direcciones.get(hoja);

  if (!mapa) {
    mapa = new Map(hoja.celdas.map((c) => [`${c.col},${c.fila}`, c]));
    direcciones.set(hoja, mapa);
  }

  return mapa;
}

/** La celda de una dirección, o nada si está vacía. */
export function celdaEn(hoja: HojaLeida, col: number, fila: number): CeldaLeida | undefined {
  return porDireccion(hoja).get(`${col},${fila}`);
}

/** Las celdas de una hoja que caen adentro de un rectángulo, fila por fila. */
export function celdasEn(hoja: HojaLeida, rect: Rectangulo): CeldaLeida[] {
  const fila2 = Math.min(rect.fila2, hoja.filas);
  const col2 = Math.min(rect.col2, hoja.columnas);
  const area = Math.max(0, fila2 - rect.fila1 + 1) * Math.max(0, col2 - rect.col1 + 1);

  // Un rango chico se recorre por dirección; uno grande (columnas enteras), por las celdas que hay.
  if (area > hoja.celdas.length) {
    return hoja.celdas.filter((c) => c.col >= rect.col1 && c.col <= rect.col2 && c.fila >= rect.fila1 && c.fila <= rect.fila2);
  }

  const mapa = porDireccion(hoja);
  const salida: CeldaLeida[] = [];

  for (let fila = rect.fila1; fila <= fila2; fila++) {
    for (let col = rect.col1; col <= col2; col++) {
      const c = mapa.get(`${col},${fila}`);
      if (c) salida.push(c);
    }
  }

  return salida;
}

/** Un rango para mostrar: `Ventas!B2:B401`, con comillas si la hoja las necesita. */
export function rangoConHoja(hoja: string, rect: Rectangulo): string {
  const conComillas = /^[A-Za-z_À-￿][\w.À-￿]*$/.test(hoja) ? hoja : `'${hoja.replace(/'/g, "''")}'`;
  return `${conComillas}!${rangoDe(rect)}`;
}

/** Si una fórmula tiene alguna referencia a otra hoja o a otro libro. */
export function usaOtraHoja(formula: string): boolean {
  return piezas(formula).some((p) => (p.tipo === 'referencia' || p.tipo === 'nombre') && (p.hoja || p.externo));
}
