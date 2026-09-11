/**
 * La cobertura del plan: qué lección se apoya en qué fuente, contrastado ANTES
 * de construir.
 *
 * El caso que originó esto es el primer bloque y conviene leerlo primero: un
 * curso se planificó con dieciséis lecciones sobre una fuente que alcanzaba para
 * dos, y las catorce restantes se escribieron igual, con un sello de "Basado en"
 * debajo que no era cierto.
 *
 * El momento importa tanto como la medición. Después de escribir, admitir el
 * hueco es contradecirse; antes, la respuesta todavía puede ser "no la
 * escribas". Por eso esto corre en `generate_course_plan` y no al guardar.
 */
import { describe, expect, it } from 'vitest';

import {
  avisoDeCobertura,
  fuenteDeclaradaExiste,
  medirCobertura,
  type FuenteDelCurso,
  type ItemDelPlan
} from '@api/services/agent/plan-coverage';

const FUENTES: FuenteDelCurso[] = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', fileName: 'Organigrama actual.pptx.pdf' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', fileName: 'sitioejemplo (sitioejemplo.example)' }
];

function leccion(title: string, sources?: string[]): ItemDelPlan {
  return { type: 'lesson', title, sources };
}

describe('el caso que originó esto', () => {
  it('marca las lecciones planificadas sobre material que no existe', () => {
    // Siete lecciones, una sola fuente que sirve para dos.
    const plan = [
      leccion('Historia y valores de la empresa', ['sitioejemplo (sitioejemplo.example)']),
      leccion('Comprender el organigrama', ['Organigrama actual.pptx.pdf']),
      leccion('Protocolos de seguridad e higiene', []),
      leccion('Sistema de gestión de calidad', []),
      leccion('Procedimiento de atención al cliente', []),
      { type: 'exercise', title: 'Examen final' } as ItemDelPlan
    ];

    const medida = medirCobertura(plan, FUENTES);

    expect(medida.cubiertas).toBe(2);
    expect(medida.sinFuente).toEqual([
      'Protocolos de seguridad e higiene',
      'Sistema de gestión de calidad',
      'Procedimiento de atención al cliente'
    ]);
  });

  it('no cuenta el examen final como huérfano: sale de las lecciones, no del material', () => {
    const medida = medirCobertura([{ type: 'exercise', title: 'Examen final' }], FUENTES);

    expect(medida.sinFuente).toEqual([]);
    expect(medida.cubiertas).toBe(0);
  });
});

describe('reconocer la fuente declarada', () => {
  it('acepta el nombre exacto', () => {
    expect(fuenteDeclaradaExiste('Organigrama actual.pptx.pdf', FUENTES)).toBe(true);
  });

  it('acepta el nombre a medias, que es como el modelo lo va a escribir', () => {
    expect(fuenteDeclaradaExiste('Organigrama', FUENTES)).toBe(true);
    expect(fuenteDeclaradaExiste('organigrama actual', FUENTES)).toBe(true);
  });

  it('perdona acentos, mayúsculas y la extensión', () => {
    expect(fuenteDeclaradaExiste('ORGANIGRAMA ACTUAL', FUENTES)).toBe(true);
  });

  it('acepta el id, para cuando el modelo prefiere copiarlo', () => {
    expect(fuenteDeclaradaExiste('aaaaaaaa-0000-0000-0000-000000000001', FUENTES)).toBe(true);
  });

  it('RECHAZA un documento que el curso no tiene', () => {
    // Nombrar un documento inexistente es la misma invención que el chequeo de
    // fundamento persigue, sólo que antes de escribir una sola palabra.
    expect(fuenteDeclaradaExiste('Manual de higiene y seguridad.pdf', FUENTES)).toBe(false);
  });

  it('rechaza un nombre tan corto que coincidiría con cualquier cosa', () => {
    expect(fuenteDeclaradaExiste('a', FUENTES)).toBe(false);
    expect(fuenteDeclaradaExiste('  ', FUENTES)).toBe(false);
  });
});

describe('no contestar NO es lo mismo que contestar que no hay', () => {
  /**
   * El primer resultado medido de este chequeo contra el sistema real: el modelo
   * omitió `sources` en las 16 lecciones y el servidor reportó 14 huérfanas de
   * 14 — incluidas las que el organigrama sí cubría. Un aviso que se equivoca
   * así es un aviso que se aprende a ignorar, y de paso arruina los que sí
   * funcionan.
   */
  it('detecta que el modelo no declaró nada', () => {
    const medida = medirCobertura([leccion('Una'), leccion('Otra')], FUENTES);

    expect(medida.sinDeclarar).toBe(true);
  });

  it('y en vez de acusar huérfanas, le pide que conteste', () => {
    const medida = medirCobertura([leccion('Una'), leccion('Otra')], FUENTES);
    const aviso = avisoDeCobertura(medida, FUENTES.length)!;

    expect(aviso).toMatch(/Call generate_course_plan again/i);
    expect(aviso).toMatch(/empty array/i);
    // Lo que NO tiene que decir: que estas lecciones no tienen material. Eso
    // todavía no se sabe.
    expect(aviso).not.toMatch(/Do NOT start building yet/i);
  });

  it('una sola lección que declara alcanza para que ya no sea silencio', () => {
    const medida = medirCobertura([leccion('Una', ['Organigrama actual.pptx.pdf']), leccion('Otra')], FUENTES);

    expect(medida.sinDeclarar).toBe(false);
    expect(medida.sinFuente).toEqual(['Otra']);
  });

  it('un array vacío SÍ es una respuesta y se trata como tal', () => {
    const medida = medirCobertura([leccion('Una', []), leccion('Otra', [])], FUENTES);

    expect(medida.sinDeclarar).toBe(false);
    expect(avisoDeCobertura(medida, FUENTES.length)).toMatch(/Do NOT start building yet/i);
  });
});

describe('una fuente inventada se separa de un hueco declarado', () => {
  const plan = [leccion('Protocolos de seguridad', ['Manual de higiene y seguridad.pdf'])];

  it('la reporta como inexistente, con el nombre que se inventó', () => {
    const medida = medirCobertura(plan, FUENTES);

    expect(medida.fuentesInexistentes).toEqual([
      { item: 'Protocolos de seguridad', declarada: 'Manual de higiene y seguridad.pdf' }
    ]);
  });

  it('y además la cuenta como sin cubrir, porque de hecho no lo está', () => {
    const medida = medirCobertura(plan, FUENTES);

    expect(medida.cubiertas).toBe(0);
    expect(medida.sinFuente).toEqual(['Protocolos de seguridad']);
  });

  it('una lección con una fuente real y otra inventada sigue cubierta', () => {
    const medida = medirCobertura([leccion('Organigrama', ['Organigrama actual.pptx.pdf', 'Inventado.pdf'])], FUENTES);

    expect(medida.cubiertas).toBe(1);
    expect(medida.sinFuente).toEqual([]);
    expect(medida.fuentesInexistentes).toHaveLength(1);
  });
});

describe('cuándo se dice algo y cuándo no', () => {
  it('no dice nada cuando el curso no tiene fuentes', () => {
    // Un curso sin material adjunto se escribe legítimamente desde el
    // conocimiento general. Avisar acá sería marcar como defecto lo normal.
    const medida = medirCobertura([leccion('Cualquier tema', [])], []);

    expect(avisoDeCobertura(medida, 0)).toBeUndefined();
  });

  it('no dice nada cuando está todo cubierto', () => {
    const medida = medirCobertura([leccion('Organigrama', ['Organigrama actual.pptx.pdf'])], FUENTES);

    expect(avisoDeCobertura(medida, FUENTES.length)).toBeUndefined();
  });

  it('nombra las lecciones huérfanas y manda a preguntar antes de construir', () => {
    const medida = medirCobertura([leccion('Protocolos de seguridad', []), leccion('Calidad', [])], FUENTES);
    const aviso = avisoDeCobertura(medida, FUENTES.length)!;

    expect(aviso).toContain('Protocolos de seguridad');
    expect(aviso).toContain('Calidad');
    expect(aviso).toMatch(/Do NOT start building yet/i);
  });

  it('ofrece las tres salidas reales, y ninguna es escribirlo callado', () => {
    const medida = medirCobertura([leccion('Protocolos de seguridad', [])], FUENTES);
    const aviso = avisoDeCobertura(medida, FUENTES.length)!;

    expect(aviso).toMatch(/upload the document/i);
    expect(aviso).toMatch(/drop them/i);
    expect(aviso).toMatch(/general professional knowledge/i);
    expect(aviso).toMatch(/mark as such|mark it|which you will then mark/i);
  });

  it('avisa aparte de la fuente inventada, aunque no haya ninguna lección huérfana', () => {
    const medida = medirCobertura(
      [leccion('Organigrama', ['Organigrama actual.pptx.pdf', 'Manual inexistente.pdf'])],
      FUENTES
    );
    const aviso = avisoDeCobertura(medida, FUENTES.length)!;

    expect(aviso).toContain('Manual inexistente.pdf');
    expect(aviso).not.toMatch(/Do NOT start building yet/i);
  });
});
