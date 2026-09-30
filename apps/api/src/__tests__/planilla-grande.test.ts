import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { ConsultaDePlanilla } from '@api/services/agent/planilla/consulta';
import { LectorDeLibro, leerLibro, type HojaLeida, type LibroLeido } from '@api/services/agent/planilla/leer-libro';
import { mapaDelLibro } from '@api/services/agent/planilla/mapa-del-libro';

import { planillaDePrueba, ventasDePrueba } from './ayuda/planilla-de-prueba';

/**
 * Una planilla grande, leída sin armarla entera en memoria.
 *
 * Medido el 2026-09-30: un registro de ventas de 450.000 celdas (2,5 MB) pedía
 * 376 MB a una biblioteca que arma el libro entero, y la API corre con 384 MB.
 * Leído de a pedazos pide 18. Lo que se fija acá es que resumir no pierda nada
 * de lo que explica el libro: las reglas y el perfil de las columnas cubren
 * TODAS las filas, las que no se guardan se dicen, y se releen cuando se piden.
 *
 * Con la planilla de 400 filas y un tope de 600 celdas por hoja, Ventas (9
 * columnas) guarda las filas 1 a 66 y las últimas 20, igual que una de miles.
 */

let archivo: Buffer;
let entero: LibroLeido;
let resumido: LibroLeido;
let lector: LectorDeLibro;
const ventas = ventasDePrueba(400);

const hoja = (libro: LibroLeido, nombre: string) => libro.hojas.find((h) => h.nombre === nombre) as HojaLeida;

beforeAll(async () => {
  archivo = await planillaDePrueba({ conValidacionModerna: true });
  entero = await leerLibro(archivo);
  lector = await LectorDeLibro.abrir(archivo);
  resumido = await lector.leer({ celdasPorHoja: 600 });
});

describe('una hoja grande se resume sin perder lo que explica el libro', () => {
  it('guarda las primeras y las últimas filas, y dice cuáles no', () => {
    const v = hoja(resumido, 'Ventas');
    const filas = new Set(v.celdas.map((c) => c.fila));

    expect(v.omitidas).toEqual({ desde: 67, hasta: 381 });
    expect(filas.has(66)).toBe(true);
    expect(filas.has(67)).toBe(false);
    expect(filas.has(382)).toBe(true);
    expect(filas.has(401)).toBe(true);
    expect(v.totalCeldas).toBe(3609);
    expect(v.totalFormulas).toBe(2000);
  });

  it('las reglas cubren la hoja entera, no sólo lo guardado', () => {
    const reglas = (libro: LibroLeido) => hoja(libro, 'Ventas').reglas!.map((r) => [r.rect, r.celdas, r.formula]);

    expect(reglas(resumido)).toEqual(reglas(entero));
    expect(reglas(resumido)).toContainEqual([{ col1: 8, col2: 8, fila1: 2, fila2: 401 }, 400, 'D2*G2']);
  });

  it('el perfil de cada columna se cuenta sobre las 400 filas', () => {
    const perfil = hoja(resumido, 'Ventas').perfil!;
    const cantidad = perfil.columnas.find((c) => c.encabezado === 'Cantidad')!;
    const producto = perfil.columnas.find((c) => c.encabezado === 'Producto')!;

    expect(perfil.filasDeDatos).toBe(400);
    expect(cantidad).toMatchObject({ numeros: 400, enteros: true, min: 1, max: 12 });
    expect(producto.textos).toBe(400);
    expect(producto.distintos.length).toBe(new Set(ventas.map((v) => v.producto)).size);
  });

  it('el mapa dice cuántas filas tiene y cuáles no copió', () => {
    const mapa = mapaDelLibro(resumido, 'almacen.xlsx');
    const seccion = mapa.slice(mapa.indexOf('## Hoja «Ventas»'), mapa.indexOf('## Hoja «Resumen mensual»'));

    expect(seccion).toContain('Una fila de encabezados (fila 1) y 400 filas de datos debajo.');
    expect(seccion).toContain('- E2:E401 (400 celdas, la misma fórmula copiada): `=BUSCARV(C2;TablaProductos;2;FALSO)`');
    expect(seccion).toContain('(Las filas 67 a 381 no están en este mapa');
  });

  it('una fila que no se guardó se relee del archivo cuando se la pide', async () => {
    const consulta = new ConsultaDePlanilla(resumido, (nombre, rect) => lector.celdasDe(nombre, rect));
    const venta = ventas[198];

    const rango = await consulta.rango('Ventas!A200:I200');
    expect(rango).toContain(venta.codigo);
    expect(rango).toContain(venta.producto);

    // La fórmula copiada de una fila que no se guardó sale de su maestra, corrida.
    const rastro = await consulta.rastrear('Ventas!H200', undefined, 1);
    expect(rastro).toMatch(/^Ventas!H200 = [\d.,]+ ← `=D200\*G200`/);
  });

  it('«quién usa» cuenta las celdas de toda la regla, no sólo las guardadas', () => {
    expect(new ConsultaDePlanilla(resumido).quienUsa('Comision')).toContain('- Ventas!I2:I401: 400 cells with `=H2*Comision`');
  });
});

describe('lo que escribe un Excel de verdad', () => {
  it('un desplegable de Excel 2010 en adelante (en extLst) se lee igual que uno clásico', () => {
    expect(hoja(entero, 'Productos').validaciones).toContainEqual({ rango: 'H2:H21', tipo: 'list', formula: 'Listas!$C$2:$C$4' });
  });

  it('una fórmula copiada hacia el costado corre sus columnas, y lo fijo con $ no se mueve', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Meses');
    ws.getRow(1).values = [1.21, 100, 200, 300];
    ws.getCell('B2').value = { formula: 'B1*$A$1', result: 121, shareType: 'shared', ref: 'B2:D2' } as ExcelJS.CellValue;
    ws.getCell('C2').value = { sharedFormula: 'B2', result: 242 } as ExcelJS.CellValue;
    ws.getCell('D2').value = { sharedFormula: 'B2', result: 363 } as ExcelJS.CellValue;

    const meses = (await leerLibro(Buffer.from(await libro.xlsx.writeBuffer()))).hojas[0];
    const formula = (col: number) => meses.celdas.find((c) => c.fila === 2 && c.col === col)?.formula;

    expect([formula(2), formula(3), formula(4)]).toEqual(['B1*$A$1', 'C1*$A$1', 'D1*$A$1']);
    expect(meses.reglas).toEqual([expect.objectContaining({ rect: { col1: 2, col2: 4, fila1: 2, fila2: 2 }, celdas: 3 })]);
  });

  it('los encabezados debajo de un título se encuentran', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Informe');
    ws.getCell('A1').value = 'Informe de stock de septiembre';
    ws.getRow(3).values = ['Código', 'Artículo', 'Stock'];
    for (let i = 0; i < 80; i++) ws.getRow(4 + i).values = [`A${i}`, `Artículo ${i}`, i * 3];

    const leido = await leerLibro(Buffer.from(await libro.xlsx.writeBuffer()));
    const informe = leido.hojas[0];

    expect(informe.perfil?.filaEncabezado).toBe(3);
    expect(informe.perfil?.columnas.map((c) => c.encabezado)).toEqual(['Código', 'Artículo', 'Stock']);
    expect(mapaDelLibro(leido, 'stock.xlsx')).toContain('Una fila de encabezados (fila 3) y 80 filas de datos debajo.');
  });
});
