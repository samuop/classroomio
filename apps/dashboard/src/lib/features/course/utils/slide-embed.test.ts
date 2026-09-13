import { diapositivaIncrustable } from './slide-embed';

/**
 * Del enlace que pega el docente al que se muestra dentro de la lección.
 *
 * Los formatos salen de lo que copian los botones de cada sitio. Cada caso que
 * cambia la dirección existe porque la original se veía mal o no se veía.
 */

const GOOGLE = 'https://docs.google.com/presentation/d/1AbC-dEf_2345';
const LIMPIA = `${GOOGLE}/preview`;

describe('diapositivaIncrustable — Google Slides', () => {
  it('cambia el enlace de «Compartir» por la vista sin el editor alrededor', () => {
    expect(diapositivaIncrustable(`${GOOGLE}/edit?usp=sharing`)).toEqual({ url: LIMPIA, proveedor: 'google' });
  });

  it('no arrastra la diapositiva abierta ni el número de cuenta', () => {
    expect(diapositivaIncrustable(`https://docs.google.com/presentation/u/1/d/1AbC-dEf_2345/edit#slide=id.p3`)?.url).toBe(
      LIMPIA
    );
  });

  it('cambia también el modo presentación, que Google no deja mostrar dentro de otra página', () => {
    expect(diapositivaIncrustable(`${GOOGLE}/present`)?.url).toBe(LIMPIA);
    expect(diapositivaIncrustable(GOOGLE)?.url).toBe(LIMPIA);
  });

  it('deja como está lo que ya se puede incrustar', () => {
    const publicada = 'https://docs.google.com/presentation/d/e/2PACX-1vAbC/embed?start=false&loop=false&delayms=3000';

    expect(diapositivaIncrustable(publicada)).toEqual({ url: publicada, proveedor: 'google' });
    expect(diapositivaIncrustable(`${GOOGLE}/embed?start=true`)?.url).toBe(`${GOOGLE}/embed?start=true`);
    expect(diapositivaIncrustable(LIMPIA)?.url).toBe(LIMPIA);
  });
});

describe('diapositivaIncrustable — Canva', () => {
  it('arma el ?embed aunque el enlace copiado ya traiga parámetros', () => {
    // Antes se le pegaba `?embed` al final: `…/view?utm_content=X?embed`, que Canva no reconoce.
    const copiado =
      'https://www.canva.com/design/DAFaBc123/view?utm_content=DAFaBc123&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink';

    expect(diapositivaIncrustable(copiado)).toEqual({
      url: 'https://www.canva.com/design/DAFaBc123/view?embed',
      proveedor: 'canva'
    });
  });

  it('conserva el código de acceso de los enlaces con vista pública', () => {
    expect(diapositivaIncrustable('https://www.canva.com/design/DAFaBc123/Xy_z-9/view?utm_source=sharebutton')?.url).toBe(
      'https://www.canva.com/design/DAFaBc123/Xy_z-9/view?embed'
    );
  });

  it('pasa a la vista un enlace de edición y agrega el www', () => {
    expect(diapositivaIncrustable('https://canva.com/design/DAFaBc123/edit')?.url).toBe(
      'https://www.canva.com/design/DAFaBc123/view?embed'
    );
  });

  it('no duplica el ?embed', () => {
    expect(diapositivaIncrustable('https://www.canva.com/design/DAFaBc123/view?embed')?.url).toBe(
      'https://www.canva.com/design/DAFaBc123/view?embed'
    );
  });
});

describe('diapositivaIncrustable — lo demás', () => {
  it('deja pasar otro sitio sin tocarlo, marcado como tal', () => {
    expect(diapositivaIncrustable('https://slides.example.com/deck/42')).toEqual({
      url: 'https://slides.example.com/deck/42',
      proveedor: 'otro'
    });
  });

  it('no acepta lo que no es un enlace web', () => {
    expect(diapositivaIncrustable('')).toBeNull();
    expect(diapositivaIncrustable('   ')).toBeNull();
    expect(diapositivaIncrustable(null)).toBeNull();
    expect(diapositivaIncrustable('mi presentación')).toBeNull();
    expect(diapositivaIncrustable('javascript:alert(1)')).toBeNull();
  });
});
