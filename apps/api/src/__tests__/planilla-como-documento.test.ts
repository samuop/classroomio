import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { leerLibro } from '@api/services/agent/planilla/leer-libro';
import { mapaDelLibro } from '@api/services/agent/planilla/mapa-del-libro';

/**
 * Muchas planillas de las empresas no calculan nada: son procedimientos,
 * instructivos y cronogramas escritos en celdas. Su contenido es el texto.
 *
 * Medido el 2026-09-30 con planillas reales de un cliente: una hoja de
 * procedimiento que llegaba hasta la fila 73 se tomaba por «tabla grande», el
 * mapa copiaba 6 filas de muestra y cortaba cada celda en 40 caracteres. La
 * tabla de actividades, sus descripciones y las notas del final no llegaban al
 * asistente. Acá, un procedimiento inventado con la misma forma.
 */

const DESCRIPCION_LARGA =
  'SE CUENTA EL EFECTIVO DE LA CAJA DELANTE DEL ENCARGADO, SE COMPARA CON EL CIERRE DEL SISTEMA Y SE ANOTA CUALQUIER DIFERENCIA EN LA PLANILLA DE NOVEDADES, CON LA FIRMA DE LOS DOS';

const ACTIVIDADES: Array<[string, string, string, string, string]> = [
  ['EL CAJERO IMPRIME EL CIERRE PARCIAL DEL SISTEMA', 'CAJERO', 'SISTEMA', 'CADA TURNO', 'SE IMPRIME EL CIERRE PARCIAL Y SE ABROCHA A LA PLANILLA DEL TURNO'],
  ['CONTEO DEL EFECTIVO', 'CAJERO / ENCARGADO', 'PLANILLA', 'CADA TURNO', DESCRIPCION_LARGA],
  ['CONTROL DE LOS COMPROBANTES DE TARJETA', 'ENCARGADO', 'POSNET', 'CADA TURNO', 'SE SUMAN LOS COMPROBANTES Y SE CONTROLA EL TOTAL CONTRA EL LOTE CERRADO'],
  ['ARMADO DEL SOBRE DE RECAUDACIÓN', 'ENCARGADO', 'SOBRE', 'CADA TURNO', 'EL EFECTIVO VA AL SOBRE CON EL CIERRE Y LA PLANILLA, CERRADO Y FIRMADO'],
  ['GUARDADO EN LA CAJA FUERTE', 'ENCARGADO', 'CAJA FUERTE', 'CADA TURNO', 'EL SOBRE SE GUARDA Y SE ANOTA EN EL CUADERNO DE LA CAJA FUERTE'],
  ['ENTREGA A ADMINISTRACIÓN', 'ADMINISTRACIÓN', 'CUADERNO', 'DIARIA', 'ADMINISTRACIÓN RETIRA LOS SOBRES Y FIRMA EL CUADERNO'],
  ['REVISIÓN DE DIFERENCIAS', 'ADMINISTRACIÓN', 'PLANILLA', 'SEMANAL', 'SE REVISAN LAS DIFERENCIAS DE LA SEMANA Y SE HABLAN CON CADA CAJERO']
];

const PEGADO_CELDA_POR_CELDA = [
  'A11', 'B11', 'C11', 'D11', 'E11', 'F11', 'G11', 'A12:A19', 'B12', 'C12',
  'D13', 'E14:E15', 'F16', 'G17', 'B18', 'C19', 'D19', 'E19', 'F19', 'G19', 'D13'
];

async function procedimiento(): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const ws = libro.addWorksheet('Cierre de caja');

  ws.getCell('A1').value = 'PROCEDIMIENTO DE CIERRE DE CAJA';
  ws.mergeCells('A1:G1');
  ws.getRow(2).values = ['Procedimiento:', 'CIERRE DE CAJA'];
  ws.getRow(3).values = ['Propósito:', 'QUE LA RECAUDACIÓN DE CADA TURNO LLEGUE COMPLETA A ADMINISTRACIÓN'];
  ws.getRow(4).values = ['Responsable:', 'ENCARGADO DE TURNO'];
  ws.getRow(5).values = ['Límites:', 'DESDE EL FIN DEL TURNO HASTA LA ENTREGA DEL SOBRE'];
  ws.getRow(7).values = ['Unidades intervinientes:', '1. ENCARGADO'];
  ws.getCell('B8').value = '2. CAJERO';
  ws.getCell('B9').value = '3. ADMINISTRACIÓN';
  ws.getRow(10).values = ['N°', 'ACTIVIDAD', 'RESPONSABLE', 'SOPORTE', 'FRECUENCIA', 'TIEMPO', 'DESCRIPCIÓN'];
  ACTIVIDADES.forEach(([actividad, quien, soporte, cuando, descripcion], i) => {
    ws.getRow(11 + i).values = [i + 1, actividad, quien, soporte, cuando, null, descripcion];
  });
  ws.getCell('A18').value = 8;
  ws.getCell('A19').value = 9;
  ws.getCell('B55').value = 'si falta plata se avisa enseguida al encargado';
  ws.getCell('B61').value = 'limpieza';
  ws.getCell('B62').value = 'los sábados se limpia el mostrador a fondo';
  ws.getCell('B73').value = 'dejar cambio chico para el turno que entra';

  for (const ref of PEGADO_CELDA_POR_CELDA) {
    ws.addConditionalFormatting({
      ref,
      rules: [
        {
          type: 'colorScale',
          priority: 1,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFF8696B' }, { argb: 'FF63BE7B' }]
        }
      ]
    });
  }

  const turnos = libro.addWorksheet('Turnos');
  turnos.getRow(1).values = ['TURNO', 'HORARIO'];
  turnos.getRow(2).values = ['MAÑANA', '7 A 14'];
  turnos.getRow(3).values = ['TARDE', '14 A 21'];

  return Buffer.from(await libro.xlsx.writeBuffer());
}

let mapa: string;
let cierre: string;

beforeAll(async () => {
  mapa = mapaDelLibro(await leerLibro(await procedimiento()), 'procedimientos.xlsx');
  cierre = mapa.slice(mapa.indexOf('## Hoja «Cierre de caja»'), mapa.indexOf('## Hoja «Turnos»'));
});

describe('una planilla que es un procedimiento', () => {
  it('va entera, con el texto completo de cada celda', () => {
    expect(cierre).toContain('| 1 | PROCEDIMIENTO DE CIERRE DE CAJA |');
    expect(cierre).toContain('| 10 | N° | ACTIVIDAD | RESPONSABLE | SOPORTE | FRECUENCIA | TIEMPO | DESCRIPCIÓN |');
    expect(cierre).toContain(`| 12 | 2 | CONTEO DEL EFECTIVO | CAJERO / ENCARGADO | PLANILLA | CADA TURNO |  | ${DESCRIPCION_LARGA} |`);
    expect(cierre).toContain('| 73 |  | dejar cambio chico para el turno que entra |');
    expect(cierre).not.toContain('…');
    expect(cierre).not.toContain('Filas de muestra');
  });

  it('si las hojas no se pasan datos, lo dice una vez y no le pone un papel a cada una', () => {
    expect(mapa).toContain(
      'Las hojas no se pasan datos: ninguna fórmula ni desplegable de una usa otra. Cada una se lee por su cuenta, en el orden del libro:\n1. Cierre de caja\n2. Turnos\n'
    );
    expect(mapa).not.toContain('suelta');
    expect(mapa).not.toContain('Papel:');
    expect(cierre).toContain('Contenido:\n');
    expect(cierre).not.toContain('las fórmulas van abajo');
  });

  it('la misma regla de formato condicional pegada celda por celda es una sola línea', () => {
    const lineas = cierre.split('\n').filter((l) => l.startsWith('Formato condicional'));

    expect(lineas).toEqual(['Formato condicional en 20 rangos dentro de A11:G19: escala de colores según el valor.']);
  });
});

describe('lo que no entra en el mapa se dice', () => {
  it('una hoja larga se corta donde se acaba el lugar, y dice desde qué fila falta', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Instructivo');
    const paso = (n: number) => `Paso ${n}: ${'revisar la góndola, anotar el faltante y avisar al depósito antes del mediodía. '.repeat(2)}`.trim();
    for (let n = 1; n <= 400; n++) ws.getCell(`A${n}`).value = paso(n);

    const texto = mapaDelLibro(await leerLibro(Buffer.from(await libro.xlsx.writeBuffer())), 'instructivo.xlsx');
    const falta = /\(Faltan (\d+) filas con contenido, desde la (\d+): no entran en este mapa\. Consultalas con la herramienta de planillas\.\)/.exec(texto);

    expect(falta).not.toBeNull();
    const desde = Number(falta![2]);
    expect(Number(falta![1])).toBe(400 - desde + 1);
    expect(texto).toContain(`| ${desde - 1} | ${paso(desde - 1)} |`);
    expect(texto).not.toContain(`| ${desde} | `);
    expect(texto).toContain(`| 1 | ${paso(1)} |`);
  });

  it('más de 26 columnas: dice cuántas quedan afuera y desde cuál', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Ancha');
    for (let fila = 1; fila <= 3; fila++) ws.getRow(fila).values = Array.from({ length: 30 }, (_, i) => `f${fila}c${i + 1}`);

    const texto = mapaDelLibro(await leerLibro(Buffer.from(await libro.xlsx.writeBuffer())), 'ancha.xlsx');

    expect(texto).toContain('(Y 4 columnas más con contenido, desde la AA: consultalas con la herramienta de planillas.)');
    expect(texto).toContain('| 1 | f1c1 |');
    expect(texto).not.toContain('f1c27');
  });

  it('en una tabla que no entra, las muestras llevan el título de arriba de los encabezados', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Stock');
    ws.getCell('A1').value = 'Informe de stock de septiembre';
    ws.getRow(3).values = ['Código', 'Artículo', 'Stock'];
    for (let i = 0; i < 3000; i++) ws.getRow(4 + i).values = [`A${i}`, `Artículo número ${i}`, i * 3];

    const texto = mapaDelLibro(await leerLibro(Buffer.from(await libro.xlsx.writeBuffer())), 'stock.xlsx');

    expect(texto).toContain('Una fila de encabezados (fila 3) y 3000 filas de datos debajo.');
    expect(texto).toContain('Filas de muestra (6 de 3000):');
    expect(texto).toContain('| 1 | Informe de stock de septiembre |  |  |');
    expect(texto).toContain('| 3 | Código | Artículo | Stock |');
  });

  it('una tabla chica lleva el perfil de sus columnas y además va entera', async () => {
    const libro = new ExcelJS.Workbook();
    const ws = libro.addWorksheet('Stock');
    ws.getRow(1).values = ['Código', 'Artículo', 'Stock'];
    for (let i = 0; i < 80; i++) ws.getRow(2 + i).values = [`A${i}`, `Artículo número ${i}`, i * 3];

    const texto = mapaDelLibro(await leerLibro(Buffer.from(await libro.xlsx.writeBuffer())), 'stock.xlsx');

    expect(texto).toContain('Una fila de encabezados (fila 1) y 80 filas de datos debajo.');
    expect(texto).toContain('- C «Stock»: números enteros de 0 a 237');
    expect(texto).toContain('| 81 | A79 | Artículo número 79 | 237 |');
    expect(texto).not.toContain('Filas de muestra');
  });
});
