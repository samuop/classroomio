import {
  imagenesDe,
  MAXIMO_DE_IMAGENES_POR_MENSAJE,
  partesDeArchivo,
  puedeEnviar,
  revisarImagenes,
  TAMANO_MAXIMO_DE_IMAGEN,
  type AdjuntoDeImagen
} from './chat-attachments';

/**
 * Las imágenes que se adjuntan a un mensaje.
 *
 * Lo que se fija acá es lo que el docente ve en el momento: por qué una imagen
 * no entra, y que el mensaje no salga mientras otra sigue subiendo.
 */

const archivo = (name: string, type: string, size = 1000) => ({ name, type, size }) as File;

const adjunto = (estado: AdjuntoDeImagen['estado'], url?: string): AdjuntoDeImagen => ({
  id: estado,
  nombre: `${estado}.png`,
  tipo: 'image/png',
  vistaPrevia: 'blob:x',
  estado,
  url
});

describe('qué imágenes se pueden adjuntar', () => {
  it('rechaza lo que el modelo no puede ver, y dice por qué', () => {
    const { aceptadas, rechazos } = revisarImagenes([archivo('a.gif', 'image/gif'), archivo('b.png', 'image/png')], 0);

    expect(aceptadas.map((a) => a.name)).toEqual(['b.png']);
    expect(rechazos.map((r) => [r.archivo.name, r.motivo])).toEqual([['a.gif', 'tipo']]);
  });

  it('rechaza una imagen demasiado grande', () => {
    const { rechazos } = revisarImagenes([archivo('foto.jpg', 'image/jpeg', TAMANO_MAXIMO_DE_IMAGEN + 1)], 0);

    expect(rechazos[0].motivo).toBe('tamano');
  });

  it('cuenta las que ya estaban adjuntas contra el máximo', () => {
    const ya = MAXIMO_DE_IMAGENES_POR_MENSAJE - 1;
    const { aceptadas, rechazos } = revisarImagenes([archivo('1.png', 'image/png'), archivo('2.png', 'image/png')], ya);

    expect(aceptadas).toHaveLength(1);
    expect(rechazos.map((r) => r.motivo)).toEqual(['cantidad']);
  });
});

describe('las imágenes de un pegado', () => {
  it('toma las imágenes', () => {
    const datos = { files: [archivo('captura.png', 'image/png'), archivo('x.pdf', 'application/pdf')], types: ['Files'] };

    expect(imagenesDe(datos as unknown as DataTransfer).map((a) => a.name)).toEqual(['captura.png']);
  });

  it('si viene texto al lado, el docente quería pegar el texto', () => {
    const datos = { files: [archivo('render.png', 'image/png')], types: ['text/plain', 'text/html', 'Files'] };

    expect(imagenesDe(datos as unknown as DataTransfer)).toEqual([]);
  });

  it('sin datos no hay nada', () => {
    expect(imagenesDe(null)).toEqual([]);
  });
});

describe('qué viaja en el mensaje', () => {
  it('sólo las que terminaron de subir', () => {
    expect(partesDeArchivo([adjunto('lista', 'https://x/lista.png'), adjunto('subiendo'), adjunto('error')])).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'https://x/lista.png', filename: 'lista.png' }
    ]);
  });

  it('una imagen sola alcanza para mandar', () => {
    expect(puedeEnviar('', [adjunto('lista', 'https://x')])).toBe(true);
  });

  it('no sale mientras otra sigue subiendo', () => {
    expect(puedeEnviar('mirá esto', [adjunto('lista', 'https://x'), adjunto('subiendo')])).toBe(false);
  });

  it('sin texto ni imágenes no hay mensaje', () => {
    expect(puedeEnviar('   ', [adjunto('error')])).toBe(false);
  });
});
