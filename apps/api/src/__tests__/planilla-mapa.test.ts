import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { leerLibro, PlanillaIlegibleError, type LibroLeido } from '@api/services/agent/planilla/leer-libro';
import { mapaDelLibro, mostrarValor } from '@api/services/agent/planilla/mapa-del-libro';

import { planillaDePrueba } from './ayuda/planilla-de-prueba';

/**
 * Un Excel leído entero, y el mapa que el asistente lee de él.
 *
 * Quien llega nuevo a una planilla de una empresa tiene que entender cómo está
 * armada: qué hoja alimenta a cuál, qué rangos tienen nombre, qué hace cada
 * fórmula. El mapa lo dice antes que los números, y en castellano, que es como
 * lo ve en su Excel.
 */

let libro: LibroLeido;
let mapa: string;

beforeAll(async () => {
  libro = await leerLibro(await planillaDePrueba({ conVinculoExterno: true, conMacros: true }));
  mapa = mapaDelLibro(libro, 'almacen.xlsx');
});

describe('el libro, leído', () => {
  it('las hojas, con la oculta marcada', () => {
    expect(libro.hojas.map((h) => [h.nombre, h.estado])).toEqual([
      ['Parámetros', 'visible'],
      ['Listas', 'oculta'],
      ['Productos', 'visible'],
      ['Ventas', 'visible'],
      ['Resumen mensual', 'visible'],
      ['Dinámica', 'visible']
    ]);
  });

  it('las fórmulas copiadas llegan traducidas a cada fila, con el resultado que guardó Excel', () => {
    const ventas = libro.hojas.find((h) => h.nombre === 'Ventas')!;
    const h3 = ventas.celdas.find((c) => c.col === 8 && c.fila === 3)!;

    expect(h3.formula).toBe('D3*G3');
    expect(typeof h3.valor).toBe('number');
  });

  it('los desplegables se juntan en rangos, y las notas y el formato condicional se leen', () => {
    const ventas = libro.hojas.find((h) => h.nombre === 'Ventas')!;

    expect(ventas.validaciones).toEqual([{ rango: 'B2:B401', tipo: 'list', formula: 'ListaTurnos' }]);
    expect(ventas.notas).toEqual([{ celda: 'D1', texto: 'Unidades vendidas, sin descontar devoluciones.' }]);
    expect(ventas.formatosCondicionales).toEqual([
      { rango: 'H2:H401', reglas: ['resalta con fondo rojo claro (#FFC7CE) si el valor es mayor que 20000'] }
    ]);
  });

  it('la tabla dinámica, el gráfico, el vínculo externo y las macros, que exceljs no lee', () => {
    expect(libro.tablasDinamicas).toEqual([
      expect.objectContaining({
        nombre: 'DinamicaVentas',
        hoja: 'Dinámica',
        origen: expect.objectContaining({ hoja: 'Ventas', rango: 'A1:I401' }),
        filas: ['Rubro'],
        columnas: ['Turno'],
        valores: [{ rotulo: 'Suma de Total', campo: 'Total', funcion: 'sum' }]
      })
    ]);
    expect(libro.graficos).toEqual([
      expect.objectContaining({ hoja: 'Resumen mensual', tipo: 'columnas', titulo: 'Ventas por rubro' })
    ]);
    expect(libro.vinculosExternos).toEqual([{ indice: 1, archivo: 'Presupuesto 2026.xlsx', hojas: ['Presupuesto 2026'] }]);
    expect(libro.macros).toEqual({ modulos: ['CalcularComisiones', 'ExportarResumen'] });
  });
});

describe('lo que no se puede leer, con un motivo que la docente entiende', () => {
  const motivo = async (archivo: Buffer, opciones?: { maxDescomprimido?: number }) => {
    try {
      await leerLibro(archivo, opciones);
      return 'se leyó';
    } catch (error) {
      return error instanceof PlanillaIlegibleError ? error.motivo : `otro: ${String(error)}`;
    }
  };

  it('un .xls viejo o un libro con contraseña', async () => {
    expect(await motivo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe('protegido');
  });

  it('algo que no es un Excel', async () => {
    expect(await motivo(Buffer.from('esto no es un zip'))).toBe('no-es-xlsx');

    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    expect(await motivo(await zip.generateAsync({ type: 'nodebuffer' }))).toBe('no-es-xlsx');
  });

  it('un archivo que descomprimido ocupa más de la cuenta, antes de abrirlo', async () => {
    expect(await motivo(await planillaDePrueba({ filasDeVentas: 10 }), { maxDescomprimido: 10_000 })).toBe('muy-grande');
  });
});

describe('el mapa', () => {
  it('empieza por el recorrido: de las entradas a los resultados', () => {
    const recorrido = mapa.slice(mapa.indexOf('## Recorrido'), mapa.indexOf('Quién le da datos'));

    expect(recorrido).toMatch(/1\. Parámetros — entrada/);
    expect(recorrido).toMatch(/2\. Listas — entrada, oculta/);
    expect(recorrido.indexOf('Productos')).toBeLessThan(recorrido.indexOf('Ventas'));
    expect(recorrido.indexOf('Ventas')).toBeLessThan(recorrido.indexOf('Resumen mensual'));
    expect(recorrido).toMatch(/Resumen mensual — resultado/);
  });

  it('cuenta cada celda una sola vez, aunque su fórmula nombre la hoja tres veces', () => {
    expect(mapa).toContain('- Ventas → Resumen mensual: 21 fórmulas');
    // Las 400 de BUSCARV con el nombre de la tabla solo también cuentan.
    expect(mapa).toMatch(/- Productos → Ventas: 1200 fórmulas \(por TablaProductos,/);
  });

  it('agrupa la fórmula copiada en 400 filas como una sola regla, en castellano', () => {
    expect(mapa).toContain('- E2:E401 (400 celdas, la misma fórmula copiada): `=BUSCARV(C2;TablaProductos;2;FALSO)`');
    expect(mapa).toContain('- C2:E6 (15 celdas, la misma fórmula copiada): `=SUMAR.SI.CONJUNTO(Ventas!$H:$H;Ventas!$F:$F;$A2;Ventas!$B:$B;C$1)`');
    expect(mapa).toContain('`=[@[Precio de venta]]*(1+IVA)`');
    expect(mapa).not.toMatch(/VLOOKUP|SUMIFS|IFERROR/);
  });

  it('dice qué vale cada nombre y quién lo usa', () => {
    expect(mapa).toContain("- IVA = 'Parámetros'!$B$2 (vale 21%); usado por: 20 fórmulas de Productos");
    expect(mapa).toContain('- ListaTurnos = Listas!$C$2:$C$4; usado por: desplegables de Ventas (B2:B401)');
  });

  it('avisa lo que viene de otro archivo, la tabla dinámica, el gráfico y las macros', () => {
    expect(mapa).toMatch(/## Datos que vienen de OTROS archivos \(no los tenemos\)\n- \[1\] Presupuesto 2026\.xlsx/);
    expect(mapa).toContain('Toma datos de OTRO ARCHIVO que no tenemos: Presupuesto 2026.xlsx.');
    expect(mapa).toMatch(/«DinamicaVentas» en Dinámica!A3:E10: resume Ventas!A1:I401\. Filas: Rubro\. Columnas: Turno\. Valores: Suma de Total \(suma de Total\)/);
    expect(mapa).toMatch(/Gráfico de columnas «Ventas por rubro» en Resumen mensual: «Ventas del mes»: valores/);
    expect(mapa).toMatch(/macros \(código VBA\) en 2 módulos: CalcularComisiones, ExportarResumen\. No se ejecutan/);
  });

  it('una hoja de datos grande va por columnas y con muestras, no entera', () => {
    const ventas = mapa.slice(mapa.indexOf('## Hoja «Ventas»'), mapa.indexOf('## Hoja «Resumen mensual»'));

    expect(ventas).toContain('Una fila de encabezados (fila 1) y 400 filas de datos debajo.');
    expect(ventas).toContain('- A «Fecha»: fechas del 01/09/2026 al 29/09/2026');
    expect(ventas).toMatch(/- B «Turno»: texto, 3 valores: .*— desplegable \(lista ListaTurnos\)/);
    expect(ventas).toContain('- D «Cantidad»: números enteros de 1 a 12 — nota: «Unidades vendidas, sin descontar devoluciones.»');
    expect(ventas).toContain('Filas de muestra (6 de 400):');
    expect(ventas.split('\n').filter((l) => /^\| \d+ \|/.test(l)).length).toBe(7);
  });

  it('si no entra, achica las muestras y las listas y avisa, sin perder el recorrido', () => {
    const chico = mapaDelLibro(libro, 'almacen.xlsx', 9_000);

    expect(chico.length).toBeLessThanOrEqual(9_000 + 200);
    expect(chico).toContain('## Recorrido de los datos');
    expect(chico).toMatch(/Filas de muestra \([1-3] de 400\)/);
  });
});

/**
 * Un control de vencimientos INVENTADO, como el de una sucursal: la columna de
 * días que faltan pintada como semáforo con tres reglas sobre el mismo rango.
 * Lo que mira quien la usa es el color, así que el mapa tiene que decir las tres
 * reglas y de qué color pinta cada una.
 */
describe('el formato condicional, con su color', () => {
  let semaforo: string;

  beforeAll(async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Vencimientos');
    hoja.getCell('A1').value = { formula: 'TODAY()', result: new Date(Date.UTC(2026, 8, 30)) } as ExcelJS.CellValue;
    hoja.getRow(2).values = ['FECHA CONTROL', 'PRODUCTO', 'FECHA DE VENCIMIENTO', 'DIAS A VENCER'];
    for (let f = 3; f <= 82; f++) {
      const dias = (f * 7) % 45;
      hoja.getCell(`A${f}`).value = new Date(Date.UTC(2026, 8, 1));
      hoja.getCell(`B${f}`).value = `producto ${f}`;
      hoja.getCell(`C${f}`).value = new Date(Date.UTC(2026, 8, 30 + dias));
      hoja.getCell(`D${f}`).value = { formula: `C${f}-$A$1`, result: dias } as ExcelJS.CellValue;
    }

    const regla = (formula: string, color: Partial<ExcelJS.Color>, priority: number) =>
      hoja.addConditionalFormatting({
        ref: 'D3:D200',
        rules: [{ type: 'expression', formulae: [formula], priority, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: color } } }]
      });
    regla('D3>=15', { theme: 6 }, 1);
    regla('AND(D3>7,D3<15)', { argb: 'FFFFC000' }, 2);
    regla('D3<=7', { argb: 'FFFF0000' }, 3);
    // Una columna sin encabezado cuyo nombre empieza con A: no es la columna A.
    hoja.addConditionalFormatting({
      ref: 'AB3:AB82',
      rules: [{ type: 'expression', formulae: ['AB3>0'], priority: 4, style: { font: { color: { argb: 'FF006100' }, bold: true } } }]
    });

    semaforo = mapaDelLibro(await leerLibro(Buffer.from(await libro.xlsx.writeBuffer())), 'vencimientos.xlsx');
  });

  it('las tres reglas del semáforo, en la línea de la columna y cada una con su color', () => {
    const columna = semaforo.split('\n').find((l) => l.startsWith('- D «DIAS A VENCER»'))!;

    expect(columna).toContain(
      '— formato condicional en D3:D200: ' +
        'resalta con fondo verde (#9BBB59) si la fórmula =D3>=15 da VERDADERO; ' +
        'resalta con fondo naranja (#FFC000) si la fórmula =Y(D3>7;D3<15) da VERDADERO; ' +
        'resalta con fondo rojo (#FF0000) si la fórmula =D3<=7 da VERDADERO'
    );
  });

  it('el formato de otra columna va aparte, una vez, y no en la de la A', () => {
    const columnaA = semaforo.split('\n').find((l) => l.startsWith('- A «FECHA CONTROL»'))!;

    expect(columnaA).not.toContain('formato condicional');
    expect(semaforo).toContain('Formato condicional en AB3:AB82: resalta con letra verde oscuro (#006100), negrita si la fórmula =AB3>0 da VERDADERO.');
  });
});

describe('el recorrido no es el orden de las pestañas', () => {
  const hoja = (nombre: string, celdas: LibroLeido['hojas'][number]['celdas']) => ({
    nombre,
    estado: 'visible' as const,
    filas: Math.max(...celdas.map((c) => c.fila)),
    columnas: Math.max(...celdas.map((c) => c.col)),
    celdas,
    tablas: [],
    validaciones: [],
    formatosCondicionales: [],
    notas: [],
    combinadas: []
  });

  it('el resumen puede ser la primera pestaña y va último', () => {
    const alReves: LibroLeido = {
      hojas: [
        hoja('Tablero', [{ col: 2, fila: 1, valor: 30, formula: 'SUM(Cuentas!A1:A3)' }]),
        hoja('Cuentas', [
          { col: 1, fila: 1, valor: 10, formula: 'Datos!A1*2' },
          { col: 1, fila: 2, valor: 10, formula: 'Datos!A2*2' },
          { col: 1, fila: 3, valor: 10, formula: 'Datos!A3*2' }
        ]),
        hoja('Datos', [
          { col: 1, fila: 1, valor: 5 },
          { col: 1, fila: 2, valor: 5 },
          { col: 1, fila: 3, valor: 5 }
        ])
      ],
      nombres: [],
      tablasDinamicas: [],
      graficos: [],
      vinculosExternos: [],
      macros: null
    };

    const recorrido = mapaDelLibro(alReves, 'al-reves.xlsx');

    expect(recorrido).toMatch(/1\. Datos — entrada\n2\. Cuentas — cálculo\n3\. Tablero — resultado/);
  });
});

describe('los valores, como los muestra Excel en castellano', () => {
  it('porcentajes, fechas, moneda, lógicos y errores', () => {
    expect(mostrarValor(0.21, '0%')).toBe('21%');
    expect(mostrarValor(0.152, '0.0%')).toBe('15,2%');
    expect(mostrarValor(new Date(Date.UTC(2026, 8, 1)), 'dd/mm/yyyy')).toBe('01/09/2026');
    expect(mostrarValor(12741.3, '"$"#,##0.00')).toBe('$ 12.741,30');
    expect(mostrarValor(3000000)).toBe('3.000.000');
    expect(mostrarValor(true)).toBe('VERDADERO');
    expect(mostrarValor({ error: '#DIV/0!' })).toBe('#¡DIV/0!');
  });
});
