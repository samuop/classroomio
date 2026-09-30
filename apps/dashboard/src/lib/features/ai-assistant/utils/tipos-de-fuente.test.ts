import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getCompletedToolLine, getPendingToolI18nKey } from './tool-labels';
import { ACEPTA_FUENTES, esFuenteAceptada, esPlanilla, tipoDeLaFuente, TIPO_XLSX } from './tipos-de-fuente';

/**
 * Las planillas de Excel como fuente, del lado del panel.
 *
 * El navegador toma el tipo de un archivo del sistema operativo: en una
 * computadora sin Office un .xlsx llega sin tipo, y el panel lo rechazaba antes
 * de mandarlo. Y el renglón del chat tiene que decir qué miró el asistente de
 * la planilla, con la celda.
 */

describe('el tipo de una fuente', () => {
  it('un .xlsx sin tipo, o con uno genérico, se reconoce por la extensión', () => {
    expect(tipoDeLaFuente({ name: 'almacen.xlsx', type: '' })).toBe(TIPO_XLSX);
    expect(tipoDeLaFuente({ name: 'ALMACEN.XLSX', type: 'application/octet-stream' })).toBe(TIPO_XLSX);
    expect(tipoDeLaFuente({ name: 'caja.xlsm', type: '' })).toBe('application/vnd.ms-excel.sheet.macroEnabled.12');
    expect(esFuenteAceptada({ name: 'almacen.xlsx', type: '' })).toBe(true);
  });

  it('un .xls viejo sigue afuera, y un tipo real no se pisa por la extensión', () => {
    expect(esFuenteAceptada({ name: 'viejo.xls', type: 'application/vnd.ms-excel' })).toBe(false);
    expect(tipoDeLaFuente({ name: 'raro.xlsx', type: 'application/pdf' })).toBe('application/pdf');
  });

  it('los tres selectores de archivos ofrecen Excel', () => {
    expect(ACEPTA_FUENTES).toContain('.xlsx');
    expect(ACEPTA_FUENTES).toContain(TIPO_XLSX);

    for (const archivo of ['../chat-input.svelte', '../components/course-creator-wizard.svelte', '../sources/upload-source-dialog.svelte']) {
      const fuente = readFileSync(fileURLToPath(new URL(archivo, import.meta.url)), 'utf8');
      expect(fuente, archivo).toContain('ACEPTA_FUENTES');
      expect(fuente, archivo).not.toMatch(/accept="\.pdf,\.docx,\.pptx/);
    }
  });

  it('la tarjeta de una planilla dice Excel', () => {
    expect(esPlanilla(TIPO_XLSX)).toBe(true);
    expect(esPlanilla('application/pdf')).toBe(false);
  });
});

describe('el renglón de la consulta en el chat', () => {
  it('mientras trabaja y cuando termina, con la celda o el texto que miró', () => {
    expect(getPendingToolI18nKey('inspect_spreadsheet')).toBe('ai_assistant.tool.pending.inspect_spreadsheet');

    expect(getCompletedToolLine('inspect_spreadsheet', { fileName: 'almacen.xlsx', action: 'trace', ref: 'B7' })).toEqual({
      shape: 'i18n',
      key: 'ai_assistant.tool.done.inspect_spreadsheet_trace',
      vars: { title: 'almacen.xlsx', ref: 'B7', query: '', sheet: '' }
    });
    expect(getCompletedToolLine('inspect_spreadsheet', { fileName: 'almacen.xlsx', action: 'find', query: 'comisión' })).toMatchObject({
      key: 'ai_assistant.tool.done.inspect_spreadsheet_find',
      vars: { query: 'comisión' }
    });
  });

  it('cada renglón tiene su texto en castellano', () => {
    const es = JSON.parse(readFileSync(fileURLToPath(new URL('../../../utils/translations/es.json', import.meta.url)), 'utf8'));

    expect(es.ai_assistant.tool.pending.inspect_spreadsheet).toBe('Revisando la planilla');
    for (const accion of ['range', 'trace', 'dependents', 'find', 'sheet']) {
      expect(es.ai_assistant.tool.done[`inspect_spreadsheet_${accion}`], accion).toMatch(/«\{title\}»/);
    }
  });
});
