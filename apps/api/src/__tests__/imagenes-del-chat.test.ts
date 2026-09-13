import {
  esTipoDeImagenDelChat,
  imagenesParaElModelo,
  prepararImagenesAdjuntas
} from '@api/services/agent/chat-images';

/**
 * Qué imágenes ve el modelo en cada vuelta.
 *
 * El historial se reenvía entero en cada pregunta, así que una imagen que viaja
 * siempre se paga siempre. Y el modelo ve la imagen pero no su dirección: sin la
 * nota, «poné esta foto en la lección» no se puede cumplir.
 */

const imagen = (nombre: string) => ({
  type: 'file',
  mediaType: 'image/png',
  filename: nombre,
  url: `https://media.example.test/${nombre}`
});

const docente = (texto: string, ...partes: object[]) => ({
  id: texto,
  role: 'user',
  parts: [{ type: 'text', text: texto }, ...partes]
});

const asistente = (texto: string) => ({ id: `r-${texto}`, role: 'assistant', parts: [{ type: 'text', text: texto }] });

const archivos = (mensaje: { parts?: unknown }) =>
  (mensaje.parts as Array<{ type: string }>).filter((parte) => parte.type === 'file');

const textoDe = (mensaje: { parts?: unknown }) =>
  (mensaje.parts as Array<{ type: string; text?: string }>)
    .filter((parte) => parte.type === 'text')
    .map((parte) => parte.text)
    .join('\n');

describe('las imágenes que ve el modelo', () => {
  it('sólo las dos últimas vueltas del docente llevan sus imágenes', () => {
    const historial = [
      docente('mirá esto', imagen('vieja.png')),
      asistente('ok'),
      docente('y esta', imagen('media.png')),
      asistente('ok'),
      docente('última', imagen('nueva.png'))
    ];

    const resultado = prepararImagenesAdjuntas(historial);

    expect(archivos(resultado[0])).toEqual([]);
    expect(archivos(resultado[2])).toHaveLength(1);
    expect(archivos(resultado[4])).toHaveLength(1);
  });

  it('la imagen que deja de viajar queda nombrada con su dirección', () => {
    const resultado = prepararImagenesAdjuntas([
      docente('mirá esto', imagen('vieja.png')),
      docente('b'),
      docente('c')
    ]);

    expect(textoDe(resultado[0])).toContain('"vieja.png" — https://media.example.test/vieja.png');
    expect(textoDe(resultado[0])).toContain('no longer shown');
  });

  it('la imagen visible también lleva su dirección, para poder insertarla', () => {
    const [mensaje] = prepararImagenesAdjuntas([docente('ponela en la lección', imagen('foto.png'))]);

    expect(archivos(mensaje)).toHaveLength(1);
    expect(textoDe(mensaje)).toContain('https://media.example.test/foto.png');
    expect(textoDe(mensaje)).toContain('you can see them above');
  });

  it('no toca los mensajes sin imágenes, ni un PDF adjunto', () => {
    const pdf = { type: 'file', mediaType: 'application/pdf', url: 'https://media.example.test/a.pdf' };
    const historial = [docente('hola'), docente('con pdf', pdf), asistente('listo')];

    const resultado = prepararImagenesAdjuntas(historial, 0);

    expect(resultado[0]).toBe(historial[0]);
    expect(resultado[1]).toBe(historial[1]);
    expect(resultado[2]).toBe(historial[2]);
  });

  it('no muta el historial que recibe: el mismo arreglo se guarda después', () => {
    const historial = [docente('a', imagen('x.png')), docente('b'), docente('c')];
    const copia = JSON.parse(JSON.stringify(historial));

    prepararImagenesAdjuntas(historial);

    expect(historial).toEqual(copia);
  });

  it('una imagen incrustada no copia sus datos en la nota', () => {
    const incrustada = { type: 'file', mediaType: 'image/png', filename: 'pegada.png', url: 'data:image/png;base64,AAAA' };

    const [mensaje] = prepararImagenesAdjuntas([docente('a', incrustada)]);

    expect(textoDe(mensaje)).toContain('"pegada.png" (embedded, no URL)');
    expect(textoDe(mensaje)).not.toContain('base64');
  });

  it('con cero vueltas no viaja ninguna', () => {
    const resultado = prepararImagenesAdjuntas([docente('a', imagen('x.png'))], 0);

    expect(archivos(resultado[0])).toEqual([]);
  });

  it('acepta lo que Gemini puede ver y rechaza lo que no', () => {
    expect(esTipoDeImagenDelChat('image/png')).toBe(true);
    expect(esTipoDeImagenDelChat('image/jpeg')).toBe(true);
    expect(esTipoDeImagenDelChat('image/webp')).toBe(true);
    expect(esTipoDeImagenDelChat('image/gif')).toBe(false);
    expect(esTipoDeImagenDelChat('image/svg+xml')).toBe(false);
  });
});

describe('las imágenes que se le bajan al modelo', () => {
  const BUCKET = 'https://media.example.test/media';

  const propia = (nombre: string) => ({
    type: 'file',
    mediaType: 'image/png',
    filename: nombre,
    url: `${BUCKET}/${nombre}`
  });

  it('baja las del bucket propio y las pasa incrustadas', async () => {
    const descargar = vi.fn(async (url: string, tipo: string) => `data:${tipo};base64,${Buffer.from(url).toString('base64')}`);

    const [mensaje] = await imagenesParaElModelo([docente('mirá', propia('foto.png'))], {
      basesPermitidas: [BUCKET],
      descargar
    });

    expect(descargar).toHaveBeenCalledWith(`${BUCKET}/foto.png`, 'image/png');
    expect((archivos(mensaje)[0] as unknown as { url: string }).url).toMatch(/^data:image\/png;base64,/);
  });

  it('una dirección de otro lado no se baja nunca: la manda el navegador', async () => {
    const descargar = vi.fn(async () => 'data:image/png;base64,AAAA');
    const ajena = { type: 'file', mediaType: 'image/png', filename: 'interna.png', url: 'http://203.0.113.7/latest' };

    const [mensaje] = await imagenesParaElModelo([docente('mirá', ajena)], { basesPermitidas: [BUCKET], descargar });

    expect(descargar).not.toHaveBeenCalled();
    expect(archivos(mensaje)).toEqual([]);
    expect(textoDe(mensaje)).toContain('"interna.png" could not be loaded');
  });

  it('un prefijo parecido no cuenta como el bucket', async () => {
    const descargar = vi.fn(async () => 'data:image/png;base64,AAAA');
    const parecida = { ...propia('x.png'), url: 'https://media.example.test/media-ajena/x.png' };

    await imagenesParaElModelo([docente('a', parecida)], { basesPermitidas: [`${BUCKET}/`], descargar });

    expect(descargar).not.toHaveBeenCalled();
  });

  it('si la descarga falla, lo dice en vez de mandar una imagen rota', async () => {
    const [mensaje] = await imagenesParaElModelo([docente('a', propia('caida.png'))], {
      basesPermitidas: [BUCKET],
      descargar: async () => {
        throw new Error('timeout');
      }
    });

    expect(archivos(mensaje)).toEqual([]);
    expect(textoDe(mensaje)).toContain('"caida.png" could not be loaded');
  });

  it('sin bucket configurado no se baja nada', async () => {
    const descargar = vi.fn(async () => 'data:image/png;base64,AAAA');

    await imagenesParaElModelo([docente('a', propia('x.png'))], { basesPermitidas: [null, ''], descargar });

    expect(descargar).not.toHaveBeenCalled();
  });

  it('no toca las respuestas del asistente ni los mensajes sin imágenes', async () => {
    const historial = [docente('hola'), asistente('ok')];

    const resultado = await imagenesParaElModelo(historial, { basesPermitidas: [BUCKET], descargar: vi.fn() });

    expect(resultado[0]).toBe(historial[0]);
    expect(resultado[1]).toBe(historial[1]);
  });
});
