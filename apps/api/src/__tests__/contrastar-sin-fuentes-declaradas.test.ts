import { fuentesParaContrastar } from '@api/services/agent/fuentes-para-contrastar';
import { verificarTokens } from '@api/services/agent/grounding-tokens';

/**
 * Una lección guardada sin decir con qué fuentes se escribió igual se contrasta.
 *
 * El caso medido: una lección de un protocolo reescrita desde el chat guardó
 * «el 30% restante» y «el 100% de cobertura», cuando la fuente sólo dice que un
 * turno resuelve el 70%. El informe mostró cero avisos porque el chequeo no
 * corrió. Los datos de abajo son ficticios pero tienen esa misma forma.
 */

const TALLER_DE_PRECIOS = {
  fileName: 'Taller de precios.pptx',
  text: 'Turno de la tarde: confección de etiquetas y resolución del 70% de la actualización física. Tomar 10 productos al azar.'
};

const TALLER_DE_SEGURIDAD = {
  fileName: 'Taller de seguridad.pptx',
  text: 'Ante un corte de luz se avisa al grupo. Las motos no ingresan al local.'
};

const LECCION_REESCRITA =
  'El turno de la tarde resuelve el 70% de la actualización física. El turno noche completa el 30% restante y garantiza el 100% de cobertura. Se toman 10 productos al azar.';

describe('contra qué se contrasta una lección guardada', () => {
  it('sin fuentes declaradas, contra TODAS las del curso — y caza lo que no está en ninguna', async () => {
    const contraste = await fuentesParaContrastar({
      deLaLeccion: undefined,
      cargarDelCurso: async () => [TALLER_DE_PRECIOS, TALLER_DE_SEGURIDAD]
    });

    expect(contraste.alcance).toBe('course');

    const valores = verificarTokens({ texto: LECCION_REESCRITA, fuentes: contraste.fuentes }).map((h) => h.valor);

    // Los dos inventados se marcan… (con `arrayContaining`, un fallo muestra la
    // lista real de lo marcado en vez de un «false no es true»)
    expect(valores).toEqual(
      expect.arrayContaining([expect.stringMatching(/^30\b/), expect.stringMatching(/^100\b/)])
    );
    // …y los que sí están en la fuente, no.
    expect(valores.filter((v) => /^(70|10)\b/.test(v))).toEqual([]);
  });

  it('con fuentes de la lección, contra ESAS: un dato de otro taller no la salva', async () => {
    const cargarDelCurso = vi.fn(async () => [TALLER_DE_PRECIOS, TALLER_DE_SEGURIDAD]);

    const contraste = await fuentesParaContrastar({ deLaLeccion: [TALLER_DE_PRECIOS], cargarDelCurso });

    expect(contraste).toEqual({ fuentes: [TALLER_DE_PRECIOS], alcance: 'lesson' });
    // Ni siquiera se leen las del curso.
    expect(cargarDelCurso).not.toHaveBeenCalled();
  });

  it('declarada de conocimiento general (lista vacía), no se contrasta contra el curso', async () => {
    const cargarDelCurso = vi.fn(async () => [TALLER_DE_PRECIOS]);

    const contraste = await fuentesParaContrastar({ deLaLeccion: [], cargarDelCurso });

    expect(contraste).toEqual({ fuentes: [], alcance: 'none' });
    expect(cargarDelCurso).not.toHaveBeenCalled();
  });

  it('un curso sin fuentes no inventa un contraste', async () => {
    expect(await fuentesParaContrastar({ cargarDelCurso: async () => [] })).toEqual({ fuentes: [], alcance: 'none' });
  });

  it('una fuente sin texto no cuenta como fuente', async () => {
    const contraste = await fuentesParaContrastar({
      cargarDelCurso: async () => [{ fileName: 'escaneo.pdf', text: '   ' }]
    });

    expect(contraste.alcance).toBe('none');
  });

  it('si las fuentes no se pueden leer, no tira: la lección ya quedó guardada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const contraste = await fuentesParaContrastar({
      cargarDelCurso: async () => {
        throw new Error('base caída');
      }
    });

    expect(contraste).toEqual({ fuentes: [], alcance: 'none' });
    error.mockRestore();
  });
});
