import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * Una planilla de prueba INVENTADA, armada como la guarda Excel: el almacén.
 *
 * Seis hojas conectadas: Parámetros (las entradas, con nombre), Listas (oculta,
 * alimenta los desplegables), Productos (una tabla con columnas calculadas),
 * Ventas (400 renglones con BUSCARV, INDICE/COINCIDIR y fórmulas copiadas hacia
 * abajo), Resumen mensual (SUMAR.SI.CONJUNTO, la meta, un gráfico) y Dinámica
 * (una tabla dinámica de Ventas).
 *
 * Las fórmulas llevan su resultado calculado, como en un archivo guardado por
 * Excel: el lector no calcula nada, lee lo que Excel dejó. La tabla dinámica y
 * el gráfico no los sabe escribir `exceljs`, así que se agregan al archivo con
 * la misma forma que les da Excel.
 */

export const IVA = 0.21;
export const MARGEN = 0.35;
export const COMISION = 0.03;
export const TIPO_DE_CAMBIO = 980;
export const META = 3_000_000;

export const RUBROS = ['Bebidas', 'Golosinas', 'Almacén', 'Limpieza', 'Cigarrillos'];
export const TURNOS = ['Mañana', 'Tarde', 'Noche'];

export const PRODUCTOS: Array<[string, string, string, number]> = [
  ['P001', 'Gaseosa cola 500 ml', 'Bebidas', 620],
  ['P002', 'Agua mineral 1,5 l', 'Bebidas', 540],
  ['P003', 'Jugo de naranja 1 l', 'Bebidas', 890],
  ['P004', 'Cerveza lata 473 ml', 'Bebidas', 1150],
  ['P005', 'Alfajor triple', 'Golosinas', 480],
  ['P006', 'Chocolate con leche 100 g', 'Golosinas', 1320],
  ['P007', 'Caramelos surtidos', 'Golosinas', 210],
  ['P008', 'Chicles de menta', 'Golosinas', 350],
  ['P009', 'Yerba mate 1 kg', 'Almacén', 2900],
  ['P010', 'Galletitas de agua', 'Almacén', 760],
  ['P011', 'Fideos secos 500 g', 'Almacén', 980],
  ['P012', 'Aceite de girasol 900 ml', 'Almacén', 2150],
  ['P013', 'Lavandina 1 l', 'Limpieza', 690],
  ['P014', 'Detergente 750 ml', 'Limpieza', 1240],
  ['P015', 'Esponja doble uso', 'Limpieza', 380],
  ['P016', 'Papel higiénico x4', 'Limpieza', 1870],
  ['P017', 'Cigarrillos box 20', 'Cigarrillos', 2600],
  ['P018', 'Cigarrillos común 20', 'Cigarrillos', 2350],
  ['P019', 'Encendedor', 'Cigarrillos', 540],
  ['P020', 'Papel para armar', 'Cigarrillos', 410]
];

export interface OpcionesDeLaPlanilla {
  filasDeVentas?: number;
  /** Una fórmula que toma un dato de otro libro, `Presupuesto 2026.xlsx`. */
  conVinculoExterno?: boolean;
  /** Un proyecto de macros con dos módulos (sólo sus nombres: no hay código que correr). */
  conMacros?: boolean;
  /**
   * Un desplegable como lo escribe Excel 2010 en adelante cuando la lista está
   * en otra hoja: adentro de `extLst`, con la fórmula en `<xm:f>` y el rango en
   * `<xm:sqref>`, no en los atributos.
   */
  conValidacionModerna?: boolean;
}

/** Números al azar, pero siempre los mismos. */
function azar(semilla: number) {
  let s = semilla >>> 0;

  return (desde: number, hasta: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return desde + Math.floor(r * (hasta - desde));
  };
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface Venta {
  fecha: Date;
  turno: string;
  codigo: string;
  cantidad: number;
  producto: string;
  rubro: string;
  precio: number;
  total: number;
  comision: number;
}

export function ventasDePrueba(filas = 400): Venta[] {
  const al = azar(20260930);
  const precios = new Map(PRODUCTOS.map(([codigo, nombre, rubro, costo]) => [codigo, { nombre, rubro, costo }]));

  return Array.from({ length: filas }, (_, i) => {
    const codigo = `P${String(al(1, 21)).padStart(3, '0')}`;
    const p = precios.get(codigo)!;
    const cantidad = al(1, 13);
    const precio = p.costo * (1 + MARGEN) * (1 + IVA);
    const total = cantidad * precio;

    return {
      fecha: new Date(Date.UTC(2026, 8, 1 + Math.floor(i / 14))),
      turno: TURNOS[al(0, 3)],
      codigo,
      cantidad,
      producto: p.nombre,
      rubro: p.rubro,
      precio,
      total,
      comision: total * COMISION
    };
  });
}

export async function planillaDePrueba(opciones: OpcionesDeLaPlanilla = {}): Promise<Buffer> {
  const n = opciones.filasDeVentas ?? 400;
  const ventas = ventasDePrueba(n);
  const libro = new ExcelJS.Workbook();

  // ── Parámetros ─────────────────────────────────────────────────────────────
  const par = libro.addWorksheet('Parámetros');
  par.addRow(['Parámetro', 'Valor']);
  const parametros: Array<[string, number, string, string?]> = [
    ['IVA', IVA, 'IVA', '0%'],
    ['Margen objetivo', MARGEN, 'Margen', '0%'],
    ['Comisión del vendedor', COMISION, 'Comision', '0%'],
    ['Tipo de cambio', TIPO_DE_CAMBIO, 'TipoDeCambio'],
    ['Meta mensual', META, 'Meta']
  ];
  parametros.forEach(([rotulo, valor, nombre, formato], i) => {
    const fila = i + 2;
    par.getCell(`A${fila}`).value = rotulo;
    par.getCell(`B${fila}`).value = valor;
    if (formato) par.getCell(`B${fila}`).numFmt = formato;
    libro.definedNames.add(`'Parámetros'!$B$${fila}`, nombre);
  });

  // ── Listas (oculta) ────────────────────────────────────────────────────────
  const lis = libro.addWorksheet('Listas', { state: 'hidden' });
  lis.getCell('A1').value = 'Rubros';
  lis.getCell('C1').value = 'Turnos';
  RUBROS.forEach((r, i) => (lis.getCell(`A${i + 2}`).value = r));
  TURNOS.forEach((t, i) => (lis.getCell(`C${i + 2}`).value = t));
  libro.definedNames.add('Listas!$A$2:$A$6', 'ListaRubros');
  libro.definedNames.add('Listas!$C$2:$C$4', 'ListaTurnos');

  // ── Productos: una tabla con columnas calculadas ───────────────────────────
  const pro = libro.addWorksheet('Productos');
  pro.addTable({
    name: 'TablaProductos',
    ref: 'A1',
    headerRow: true,
    columns: ['Código', 'Producto', 'Rubro', 'Costo', 'Precio de venta', 'Precio con IVA', 'Costo en USD'].map((name) => ({ name })),
    rows: PRODUCTOS.map(([codigo, nombre, rubro, costo]) => {
      const venta = costo * (1 + MARGEN);
      return [
        codigo,
        nombre,
        rubro,
        costo,
        { formula: 'TablaProductos[[#This Row],[Costo]]*(1+Margen)', result: venta },
        { formula: 'TablaProductos[[#This Row],[Precio de venta]]*(1+IVA)', result: venta * (1 + IVA) },
        { formula: 'ROUND(TablaProductos[[#This Row],[Costo]]/TipoDeCambio,2)', result: redondear(costo / TIPO_DE_CAMBIO) }
      ];
    })
  });
  for (let fila = 2; fila <= PRODUCTOS.length + 1; fila++) {
    pro.getCell(`C${fila}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['ListaRubros'] };
  }

  // ── Ventas: datos y fórmulas copiadas hacia abajo ──────────────────────────
  const ven = libro.addWorksheet('Ventas');
  ven.addRow(['Fecha', 'Turno', 'Código', 'Cantidad', 'Producto', 'Rubro', 'Precio unitario', 'Total', 'Comisión']);
  ven.getCell('D1').note = 'Unidades vendidas, sin descontar devoluciones.';

  const ultima = n + 1;
  const copiadas: Array<[string, (f: number) => string, (v: Venta) => number | string]> = [
    ['E', (f) => `VLOOKUP(C${f},TablaProductos,2,FALSE)`, (v) => v.producto],
    ['F', (f) => `VLOOKUP(C${f},Productos!$A$2:$G$21,3,FALSE)`, (v) => v.rubro],
    ['G', (f) => `INDEX(TablaProductos[Precio con IVA],MATCH(C${f},TablaProductos[Código],0))`, (v) => v.precio],
    ['H', (f) => `D${f}*G${f}`, (v) => v.total],
    ['I', (f) => `H${f}*Comision`, (v) => v.comision]
  ];

  ventas.forEach((v, i) => {
    const f = i + 2;
    ven.getCell(`A${f}`).value = v.fecha;
    ven.getCell(`A${f}`).numFmt = 'dd/mm/yyyy';
    ven.getCell(`B${f}`).value = v.turno;
    ven.getCell(`B${f}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['ListaTurnos'] };
    ven.getCell(`C${f}`).value = v.codigo;
    ven.getCell(`D${f}`).value = v.cantidad;

    // Como Excel: la primera fila tiene la fórmula entera y las demás la comparten.
    for (const [col, formula, resultado] of copiadas) {
      ven.getCell(`${col}${f}`).value =
        f === 2
          ? ({ formula: formula(2), result: resultado(v), shareType: 'shared', ref: `${col}2:${col}${ultima}` } as ExcelJS.CellValue)
          : ({ sharedFormula: `${col}2`, result: resultado(v) } as ExcelJS.CellValue);
    }
  });

  ven.addConditionalFormatting({
    ref: `H2:H${ultima}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['20000'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } }
      }
    ]
  });

  // ── Resumen mensual ────────────────────────────────────────────────────────
  const res = libro.addWorksheet('Resumen mensual');
  res.addRow(['Rubro', 'Ventas del mes', ...TURNOS, 'Participación']);

  const porRubro = (rubro: string, turno?: string) =>
    ventas.filter((v) => v.rubro === rubro && (!turno || v.turno === turno)).reduce((s, v) => s + v.total, 0);
  const totalDelMes = ventas.reduce((s, v) => s + v.total, 0);

  RUBROS.forEach((rubro, i) => {
    const f = i + 2;
    res.getCell(`A${f}`).value = rubro;
    res.getCell(`B${f}`).value = { formula: `SUMIF(Ventas!$F:$F,A${f},Ventas!$H:$H)`, result: porRubro(rubro) };
    TURNOS.forEach((turno, t) => {
      const col = String.fromCharCode(67 + t);
      res.getCell(`${col}${f}`).value = {
        formula: `SUMIFS(Ventas!$H:$H,Ventas!$F:$F,$A${f},Ventas!$B:$B,${col}$1)`,
        result: porRubro(rubro, turno)
      };
    });
    res.getCell(`F${f}`).value = { formula: `IFERROR(B${f}/$B$7,0)`, result: porRubro(rubro) / totalDelMes };
    res.getCell(`F${f}`).numFmt = '0.0%';
  });

  const porTurno = TURNOS.map((t) => ventas.filter((v) => v.turno === t).reduce((s, v) => s + v.total, 0));
  res.getCell('A7').value = 'Total';
  res.getCell('B7').value = { formula: 'SUM(B2:B6)', result: totalDelMes };
  ['C', 'D', 'E'].forEach((col, t) => (res.getCell(`${col}7`).value = { formula: `SUM(${col}2:${col}6)`, result: porTurno[t] }));
  res.getCell('A9').value = 'Estado de la meta';
  res.getCell('B9').value = {
    formula: 'IF(B7>=Meta,"Meta cumplida","Por debajo de la meta")',
    result: totalDelMes >= META ? 'Meta cumplida' : 'Por debajo de la meta'
  };
  res.getCell('A10').value = 'Comisiones a pagar';
  res.getCell('B10').value = { formula: 'SUM(Ventas!I:I)', result: totalDelMes * COMISION };
  res.getCell('A11').value = 'Mejor turno';
  res.getCell('B11').value = {
    formula: 'INDEX($C$1:$E$1,MATCH(MAX(C7:E7),C7:E7,0))',
    result: TURNOS[porTurno.indexOf(Math.max(...porTurno))]
  };

  if (opciones.conVinculoExterno) {
    res.getCell('A13').value = 'Presupuesto del mes';
    res.getCell('B13').value = { formula: "'[1]Presupuesto 2026'!$C$4", result: 3_200_000 };
    res.getCell('A14').value = 'Diferencia con el presupuesto';
    res.getCell('B14').value = { formula: 'B7-B13', result: totalDelMes - 3_200_000 };
  }

  // ── Dinámica: lo que Excel escribe en la hoja al dibujar la tabla ─────────
  const din = libro.addWorksheet('Dinámica');
  din.getCell('A3').value = 'Suma de Total';
  din.getCell('B3').value = 'Etiquetas de columna';
  din.getCell('A4').value = 'Etiquetas de fila';
  TURNOS.forEach((t, i) => (din.getCell(4, 2 + i).value = t));
  din.getCell(4, 5).value = 'Total general';
  RUBROS.forEach((rubro, r) => {
    din.getCell(5 + r, 1).value = rubro;
    TURNOS.forEach((t, i) => (din.getCell(5 + r, 2 + i).value = porRubro(rubro, t)));
    din.getCell(5 + r, 5).value = porRubro(rubro);
  });
  // La fila de totales, que Excel dibuja siempre: la tabla va de A3 a E10. Sin
  // ella, el asistente ubicó el «Total general» en E9, que es el de un rubro.
  const filaDeTotales = 5 + RUBROS.length;
  din.getCell(filaDeTotales, 1).value = 'Total general';
  TURNOS.forEach((_, i) => (din.getCell(filaDeTotales, 2 + i).value = porTurno[i]));
  din.getCell(filaDeTotales, 5).value = totalDelMes;

  const base = Buffer.from(await libro.xlsx.writeBuffer());

  return agregarPartesDeExcel(base, {
    hojaDinamica: libro.worksheets.indexOf(din) + 1,
    hojaResumen: libro.worksheets.indexOf(res) + 1,
    hojaProductos: libro.worksheets.indexOf(pro) + 1,
    filasDeVentas: n,
    conVinculoExterno: !!opciones.conVinculoExterno,
    conMacros: !!opciones.conMacros,
    conValidacionModerna: !!opciones.conValidacionModerna
  });
}

// ─── Las partes que `exceljs` no escribe ────────────────────────────────────

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

async function agregarRelacion(zip: JSZip, rels: string, id: string, tipo: string, destino: string, externo = false) {
  const actual = (await zip.file(rels)?.async('string')) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"></Relationships>`;
  const nueva = `<Relationship Id="${id}" Type="${REL}/${tipo}" Target="${destino}"${externo ? ' TargetMode="External"' : ''}/>`;
  zip.file(rels, actual.replace('</Relationships>', `${nueva}</Relationships>`));
}

async function agregarTipo(zip: JSZip, parte: string, tipo: string) {
  const actual = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', actual.replace('</Types>', `<Override PartName="${parte}" ContentType="${tipo}"/></Types>`));
}

async function agregarPartesDeExcel(
  archivo: Buffer,
  o: {
    hojaDinamica: number;
    hojaResumen: number;
    hojaProductos: number;
    filasDeVentas: number;
    conVinculoExterno: boolean;
    conMacros: boolean;
    conValidacionModerna: boolean;
  }
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(archivo);

  if (o.conValidacionModerna) {
    const ruta = `xl/worksheets/sheet${o.hojaProductos}.xml`;
    const hoja = await zip.file(ruta)!.async('string');
    const ext =
      '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">' +
      '<x14:dataValidations count="1" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">' +
      '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">' +
      '<x14:formula1><xm:f>Listas!$C$2:$C$4</xm:f></x14:formula1><xm:sqref>H2:H21</xm:sqref>' +
      '</x14:dataValidation></x14:dataValidations></ext></extLst>';
    zip.file(ruta, hoja.replace('</worksheet>', `${ext}</worksheet>`));
  }
  const campos = ['Fecha', 'Turno', 'Código', 'Cantidad', 'Producto', 'Rubro', 'Precio unitario', 'Total', 'Comisión'];

  // Tabla dinámica: la definición de la caché (de dónde salen los datos) y la tabla.
  zip.file(
    'xl/pivotCache/pivotCacheDefinition1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}" refreshOnLoad="1" recordCount="${o.filasDeVentas}">
<cacheSource type="worksheet"><worksheetSource ref="A1:I${o.filasDeVentas + 1}" sheet="Ventas"/></cacheSource>
<cacheFields count="${campos.length}">${campos.map((c) => `<cacheField name="${c}" numFmtId="0"><sharedItems/></cacheField>`).join('')}</cacheFields>
</pivotCacheDefinition>`
  );
  zip.file(
    'xl/pivotTables/pivotTable1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="DinamicaVentas" cacheId="1" dataCaption="Valores">
<location ref="A3:E10" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>
<pivotFields count="${campos.length}">${campos
      .map((_, i) => (i === 1 ? '<pivotField axis="axisCol" showAll="0"/>' : i === 5 ? '<pivotField axis="axisRow" showAll="0"/>' : i === 7 ? '<pivotField dataField="1" showAll="0"/>' : '<pivotField showAll="0"/>'))
      .join('')}</pivotFields>
<rowFields count="1"><field x="5"/></rowFields>
<colFields count="1"><field x="1"/></colFields>
<dataFields count="1"><dataField name="Suma de Total" fld="7" baseField="0" baseItem="0"/></dataFields>
</pivotTableDefinition>`
  );
  await agregarRelacion(zip, 'xl/pivotTables/_rels/pivotTable1.xml.rels', 'rId1', 'pivotCacheDefinition', '../pivotCache/pivotCacheDefinition1.xml');
  await agregarRelacion(zip, `xl/worksheets/_rels/sheet${o.hojaDinamica}.xml.rels`, 'rIdDinamica1', 'pivotTable', '../pivotTables/pivotTable1.xml');
  await agregarTipo(zip, '/xl/pivotTables/pivotTable1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml');
  await agregarTipo(zip, '/xl/pivotCache/pivotCacheDefinition1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml');

  // Gráfico: hoja → dibujo → gráfico, como los enlaza Excel.
  zip.file(
    'xl/charts/chart1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Ventas por rubro</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>'Resumen mensual'!$B$1</c:f></c:strRef></c:tx>
<c:cat><c:strRef><c:f>'Resumen mensual'!$A$2:$A$6</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>'Resumen mensual'!$B$2:$B$6</c:f></c:numRef></c:val></c:ser>
</c:barChart></c:plotArea></c:chart></c:chartSpace>`
  );
  zip.file(
    'xl/drawings/drawing1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
<xdr:twoCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>14</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`
  );
  await agregarRelacion(zip, 'xl/drawings/_rels/drawing1.xml.rels', 'rId1', 'chart', '../charts/chart1.xml');
  await agregarRelacion(zip, `xl/worksheets/_rels/sheet${o.hojaResumen}.xml.rels`, 'rIdDibujo1', 'drawing', '../drawings/drawing1.xml');
  await agregarTipo(zip, '/xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
  await agregarTipo(zip, '/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml');

  if (o.conVinculoExterno) {
    zip.file(
      'xl/externalLinks/externalLink1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><externalBook r:id="rId1"><sheetNames><sheetName val="Presupuesto 2026"/></sheetNames></externalBook></externalLink>`
    );
    await agregarRelacion(zip, 'xl/externalLinks/_rels/externalLink1.xml.rels', 'rId1', 'externalLinkPath', 'Presupuesto%202026.xlsx', true);
    await agregarTipo(zip, '/xl/externalLinks/externalLink1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml');
  }

  if (o.conMacros) {
    // Un proyecto de macros lleva, en claro, la lista de sus módulos (flujo PROJECT).
    zip.file('xl/vbaProject.bin', Buffer.from('ID="{00000000-0000-0000-0000-000000000000}"\r\nDocument=ThisWorkbook/&H00000000\r\nModule=CalcularComisiones\r\nModule=ExportarResumen\r\nName="VBAProject"\r\n', 'latin1'));
    await agregarTipo(zip, '/xl/vbaProject.bin', 'application/vnd.ms-office.vbaProject');
  }

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
