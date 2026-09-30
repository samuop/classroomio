import { describe, expect, it } from 'vitest';

import {
  formaRelativa,
  formulaEnCastellano,
  piezas,
  rectanguloDe,
  referenciasDe
} from '@api/services/agent/planilla/formulas';

/**
 * Las fórmulas de una planilla, leídas pieza por pieza.
 *
 * El archivo las guarda en inglés y con «,»; quien aprende tiene un Excel en
 * castellano. Y para entender el libro hay que saber de qué depende cada una y
 * reconocer la misma regla copiada en cientos de filas.
 */

describe('en castellano', () => {
  it('traduce funciones, separadores y valores lógicos', () => {
    expect(formulaEnCastellano('VLOOKUP(C2,TablaProductos,2,FALSE)')).toBe('=BUSCARV(C2;TablaProductos;2;FALSO)');
    expect(formulaEnCastellano('=IFERROR(B2/$B$7,0)')).toBe('=SI.ERROR(B2/$B$7;0)');
    expect(formulaEnCastellano('SUMIFS(Ventas!$H:$H,Ventas!$F:$F,$A2,Ventas!$B:$B,C$1)')).toBe(
      '=SUMAR.SI.CONJUNTO(Ventas!$H:$H;Ventas!$F:$F;$A2;Ventas!$B:$B;C$1)'
    );
  });

  it('no toca lo que está adentro de un texto', () => {
    expect(formulaEnCastellano('IF(B7>=Meta,"Meta cumplida, felicitaciones","Por debajo, IF no")')).toBe(
      '=SI(B7>=Meta;"Meta cumplida, felicitaciones";"Por debajo, IF no")'
    );
  });

  it('usa la coma decimal', () => {
    expect(formulaEnCastellano('ROUND(A1*1.21,2)')).toBe('=REDONDEAR(A1*1,21;2)');
  });

  it('saca el prefijo de las funciones nuevas', () => {
    expect(formulaEnCastellano('_xlfn.XLOOKUP(A2,B:B,C:C)')).toBe('=BUSCARX(A2;B:B;C:C)');
    expect(formulaEnCastellano('_xlfn._xlws.FILTER(A2:C9,B2:B9>0)')).toBe('=FILTRAR(A2:C9;B2:B9>0)');
  });

  it('una hoja que se llama como una función no se traduce', () => {
    expect(formulaEnCastellano("SUM('IFS 2024'!A1:A3,IF!B2)")).toBe("=SUMA('IFS 2024'!A1:A3;IF!B2)");
  });

  it('una función desconocida queda con su nombre verdadero', () => {
    expect(formulaEnCastellano('CUBEVALUE("Ventas",A1)')).toBe('=CUBEVALUE("Ventas";A1)');
  });

  it('los errores llevan su nombre en castellano', () => {
    expect(formulaEnCastellano('IF(A1=0,#N/A,#REF!)')).toBe('=SI(A1=0;#N/D;#¡REF!)');
  });

  it('la misma fila de una tabla se escribe corta, como la muestra Excel', () => {
    expect(formulaEnCastellano('TablaProductos[[#This Row],[Costo]]*(1+Margen)', 'TablaProductos')).toBe('=[@Costo]*(1+Margen)');
    expect(formulaEnCastellano('TablaProductos[[#This Row],[Precio de venta]]*(1+IVA)', 'TablaProductos')).toBe(
      '=[@[Precio de venta]]*(1+IVA)'
    );
    // Desde afuera de la tabla, con su nombre.
    expect(formulaEnCastellano('TablaProductos[[#This Row],[Costo]]')).toBe('=TablaProductos[@Costo]');
    expect(formulaEnCastellano('SUM(TablaProductos[#All])')).toBe('=SUMA(TablaProductos[#Todo])');
  });
});

describe('de qué depende', () => {
  it('celdas, rangos de otra hoja, nombres y tablas', () => {
    const refs = referenciasDe('INDEX(TablaProductos[Precio con IVA],MATCH(C2,TablaProductos[Código],0))*Comision+Productos!$A$2');

    expect(refs).toContainEqual({ tabla: { tabla: 'TablaProductos', columnas: ['Precio con IVA'], estaFila: false } });
    expect(refs).toContainEqual({ tabla: { tabla: 'TablaProductos', columnas: ['Código'], estaFila: false } });
    expect(refs).toContainEqual({ hoja: undefined, externo: undefined, rango: 'C2' });
    expect(refs).toContainEqual({ nombre: 'Comision', hoja: undefined, externo: undefined });
    expect(refs).toContainEqual({ hoja: 'Productos', externo: undefined, rango: 'A2' });
  });

  it('una hoja con espacios o comillas, y un libro externo', () => {
    expect(referenciasDe("SUM('Resumen mensual'!B2:B6)")).toEqual([
      { hoja: 'Resumen mensual', externo: undefined, rango: 'B2:B6' }
    ]);
    expect(referenciasDe("'Caja de Juan''s'!A1")).toEqual([{ hoja: "Caja de Juan's", externo: undefined, rango: 'A1' }]);
    expect(referenciasDe("'[1]Presupuesto 2026'!C4+[2]Costos!B2")).toEqual([
      { hoja: 'Presupuesto 2026', externo: '[1]', rango: 'C4' },
      { hoja: 'Costos', externo: '[2]', rango: 'B2' }
    ]);
  });

  it('no confunde una función con una celda', () => {
    const tipos = piezas('LOG10(A1)+ATAN2(B2,C3)').map((p) => p.tipo);
    expect(tipos.filter((t) => t === 'funcion')).toHaveLength(2);
    expect(tipos.filter((t) => t === 'referencia')).toHaveLength(3);
  });
});

describe('la misma regla copiada', () => {
  it('dos filas de una columna copiada tienen la misma forma relativa', () => {
    expect(formaRelativa('D2*G2', 8, 2)).toBe(formaRelativa('D3*G3', 8, 3));
    expect(formaRelativa('D2*G2', 8, 2)).not.toBe(formaRelativa('D2*G3', 8, 3));
  });

  it('las partes fijas no se mueven', () => {
    expect(formaRelativa('IFERROR(B2/$B$7,0)', 6, 2)).toBe(formaRelativa('IFERROR(B3/$B$7,0)', 6, 3));
    expect(formaRelativa('SUMIFS(Ventas!$H:$H,Ventas!$F:$F,$A2,Ventas!$B:$B,C$1)', 3, 2)).toBe(
      formaRelativa('SUMIFS(Ventas!$H:$H,Ventas!$F:$F,$A3,Ventas!$B:$B,D$1)', 4, 3)
    );
  });
});

describe('rangos', () => {
  it('una columna entera va hasta el final de la hoja que se le diga', () => {
    expect(rectanguloDe('F:F', 401)).toEqual({ col1: 6, col2: 6, fila1: 1, fila2: 401 });
    expect(rectanguloDe('$A$2:$G$21')).toEqual({ col1: 1, col2: 7, fila1: 2, fila2: 21 });
  });
});
