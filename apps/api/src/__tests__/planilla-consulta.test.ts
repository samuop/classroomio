import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Consultar una planilla a pedido: lo que el mapa no alcanza a mostrar.
 *
 * Para explicar de dónde sale un total, el asistente lo sigue celda por celda
 * como lo haría alguien con el Excel abierto. Se fija:
 *
 * 1. La consulta en sí: un rango, el rastro de un total hasta sus datos (y
 *    hasta otro archivo que no tenemos), quién usa una celda —fórmulas,
 *    desplegables, tablas dinámicas, gráficos—, y la búsqueda.
 * 2. La herramienta en el asistente: baja el original de la fuente una sola vez,
 *    no mira una fuente que no es planilla, y pide lo que le falta.
 * 3. La subida: un .xlsx se guarda con su mapa como texto, aunque el navegador
 *    no le ponga tipo; uno con contraseña se rechaza con un motivo propio.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  getCourseSource: vi.fn()
}));

vi.mock('@api/services/agent/document', async (original) => ({
  ...(await original<typeof import('@api/services/agent/document')>()),
  bajarArchivoOriginal: vi.fn()
}));

import { getCourseSource } from '@cio/db/queries/agent';
import { bajarArchivoOriginal, parseDocument } from '@api/services/agent/document';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { ConsultaDePlanilla } from '@api/services/agent/planilla/consulta';
import { leerLibro } from '@api/services/agent/planilla/leer-libro';
import { olvidarPlanillas } from '@api/services/agent/planilla/planilla-de-la-fuente';
import { AppError } from '@api/utils/errors';

import { planillaDePrueba } from './ayuda/planilla-de-prueba';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let archivo: Buffer;
let consulta: ConsultaDePlanilla;

beforeAll(async () => {
  archivo = await planillaDePrueba({ conVinculoExterno: true });
  consulta = new ConsultaDePlanilla(await leerLibro(archivo));
});

describe('la consulta', () => {
  it('un rango: los valores en grilla y las reglas que lo calculan, en castellano', async () => {
    const rango = await consulta.rango("'Resumen mensual'!A1:C3");

    expect(rango).toContain('| 2 | Bebidas |');
    expect(rango).toContain('- B2:B6 (5 cells, same formula copied): `=SUMAR.SI(Ventas!$F:$F;A2;Ventas!$H:$H)`');
  });

  it('un rango enorme se corta y lo dice', async () => {
    expect(await consulta.rango('Ventas!A1:I401')).toMatch(/Only the first \d+ rows are shown/);
  });

  it('rastrea un total hasta los datos escritos a mano, pasando por otra hoja', async () => {
    const rastro = await consulta.rastrear('Resumen mensual!B7');

    expect(rastro).toMatch(/^'Resumen mensual'!B7 = [\d.,]+ ← `=SUMA\(B2:B6\)`/);
    expect(rastro).toContain('computed in B2:B6 with `=SUMAR.SI(Ventas!$F:$F;A2;Ventas!$H:$H)`');
    expect(rastro).toContain('computed in H2:H401 with `=D2*G2`');
    expect(rastro).toMatch(/Ventas!D2 = \d+ \(typed value, no formula\)/);
  });

  it('avisa cuando un número viene de otro archivo que no tenemos', async () => {
    expect(await consulta.rastrear('B14', 'Resumen mensual')).toContain(
      'from ANOTHER FILE we do not have: Presupuesto 2026.xlsx'
    );
  });

  it('quién usa una celda: fórmulas de otras hojas, por un nombre o por la tabla', () => {
    const comision = consulta.quienUsa('Comision');
    expect(comision).toContain('- Ventas!I2:I401: 400 cells with `=H2*Comision`');
    expect(comision).toContain('the defined name Comision points here');

    // El costo de un producto lo usan su propia fila de la tabla y las dos BUSCARV de Ventas.
    const costo = consulta.quienUsa('Productos!D5');
    expect(costo).toContain('- Productos!E2:E21: E5 with `=[@Costo]*(1+Margen)`');
    expect(costo).toContain('- Ventas!E2:E401: 400 cells with `=BUSCARV(C2;TablaProductos;2;FALSO)`');
    expect(costo).not.toContain('Productos!E2:E21: 20 cells');
  });

  it('quién usa una celda: desplegables, la tabla dinámica y el gráfico', () => {
    expect(consulta.quienUsa('Listas!C3')).toContain('the dropdowns of Ventas!B2:B401 take their options from here');
    expect(consulta.quienUsa('Ventas!H5')).toContain('the pivot table «DinamicaVentas» on Dinámica summarizes this data');
    expect(consulta.quienUsa("'Resumen mensual'!B3")).toContain('the columnas chart «Ventas por rubro» on Resumen mensual draws it');
  });

  it('una celda que nadie usa lo dice', () => {
    expect(consulta.quienUsa('Resumen mensual!B11')).toContain('- nothing:');
  });

  it('la búsqueda devuelve la fórmula copiada una vez, como la regla que es', () => {
    const hallado = consulta.buscar('comision');

    expect(hallado).toContain('- Ventas!I2:I401 (400 cells, same formula copied): `=H2*Comision`');
    expect(hallado.split('\n').filter((l) => l.includes('=H'))).toHaveLength(1);
    expect(hallado).toContain('Parámetros!A4 = Comisión del vendedor (typed value, no formula)');
  });

  it('una dirección que no existe se contesta con lo que hay', async () => {
    await expect(consulta.rango('Stock!A1')).rejects.toThrow(/No sheet named "Stock"\. Sheets: Parámetros, Listas/);
    await expect(consulta.rango('B7')).rejects.toThrow(/Say which sheet "B7" is on/);
    await expect(consulta.rango('NoExiste')).rejects.toThrow(/is not a cell, range, defined name or table column/);
  });
});

describe('la herramienta en el asistente', () => {
  const OPCIONES = { toolCallId: 'llamada', messages: [] };
  type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };
  const herramienta = () =>
    (buildAgentTools('org', 'usuario', 'curso', [], { conversationId: 'conversacion', locale: 'es' }) as Record<string, Herramienta>)
      .inspect_spreadsheet;

  beforeEach(() => {
    vi.clearAllMocks();
    olvidarPlanillas();
    vi.mocked(getCourseSource).mockResolvedValue({ id: 'fuente', fileName: 'almacen.xlsx', mimeType: XLSX, assetId: 'archivo' } as never);
    vi.mocked(bajarArchivoOriginal).mockResolvedValue(archivo as never);
  });

  it('rastrea desde la fuente del curso, y baja el original una sola vez para varias consultas', async () => {
    const primera = await herramienta().execute({ sourceId: 'fuente', action: 'trace', ref: "'Resumen mensual'!B7" }, OPCIONES);
    const segunda = await herramienta().execute({ sourceId: 'fuente', action: 'dependents', ref: 'IVA' }, OPCIONES);

    expect(primera).toMatchObject({ fileName: 'almacen.xlsx', action: 'trace', ref: "'Resumen mensual'!B7" });
    expect(String(primera.result)).toContain('`=SUMA(B2:B6)`');
    expect(String(segunda.result)).toContain('Productos!F2:F21');
    expect(getCourseSource).toHaveBeenCalledWith('fuente', 'curso');
    expect(bajarArchivoOriginal).toHaveBeenCalledTimes(1);
  });

  it('una fuente que no es planilla se manda a leer con read_source', async () => {
    vi.mocked(getCourseSource).mockResolvedValue({ id: 'fuente', fileName: 'manual.pdf', mimeType: 'application/pdf', assetId: 'x' } as never);

    const resultado = await herramienta().execute({ sourceId: 'fuente', action: 'find', query: 'caja' }, OPCIONES);

    expect(JSON.stringify(resultado)).toMatch(/is not an Excel workbook: read it with read_source/);
    expect(bajarArchivoOriginal).not.toHaveBeenCalled();
  });

  it('una acción sin lo que necesita lo pide', async () => {
    const resultado = await herramienta().execute({ sourceId: 'fuente', action: 'trace' }, OPCIONES);
    expect(JSON.stringify(resultado)).toContain('Action \\"trace\\" needs \\"ref\\"');
  });
});

describe('la subida de un Excel', () => {
  it('se guarda con el mapa del libro como texto y una página por hoja, aunque el navegador no le ponga tipo', async () => {
    const leido = await parseDocument(new File([new Uint8Array(archivo)], 'almacen.xlsx', { type: '' }));

    expect(leido.mimeType).toBe(XLSX);
    expect(leido.pageCount).toBe(6);
    expect(leido.text.startsWith('# Planilla de Excel «almacen.xlsx»')).toBe(true);
    expect(leido.text).toContain('`=BUSCARV(C2;TablaProductos;2;FALSO)`');
  });

  it('un libro con contraseña se rechaza con su propio motivo', async () => {
    const protegido = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const error = await parseDocument(new File([protegido], 'caja.xlsx', { type: XLSX })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'SPREADSHEET_PROTECTED', statusCode: 422 });
  });

  it('un .xls viejo sigue sin aceptarse', async () => {
    const error = await parseDocument(new File([new Uint8Array([1, 2, 3])], 'viejo.xls', { type: 'application/vnd.ms-excel' })).catch(
      (e: unknown) => e
    );

    expect(error).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });
});
