import { conIdsUnicos } from './ids-unicos';

describe('los mensajes de una conversación guardada', () => {
  it('con ids vacíos repetidos salen con ids distintos', () => {
    const mensajes = [
      { id: 'u1', role: 'user' },
      { id: '', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: '', role: 'assistant' }
    ];

    const ids = conIdsUnicos(mensajes).map((m) => m.id);

    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe('u1');
    expect(ids[2]).toBe('u2');
  });

  it('un id repetido lo conserva el primero y el segundo recibe otro', () => {
    const ids = conIdsUnicos([{ id: 'a' }, { id: 'a' }, { id: 'a-1' }]).map((m) => m.id);

    expect(ids[0]).toBe('a');
    expect(new Set(ids).size).toBe(3);
  });

  it('es estable: el mismo historial da los mismos ids', () => {
    const historial = [{ id: '' }, { id: '' }];

    expect(conIdsUnicos(historial).map((m) => m.id)).toEqual(conIdsUnicos(historial).map((m) => m.id));
  });

  it('si ya estaban bien no toca nada', () => {
    const mensajes = [{ id: 'a' }, { id: 'b' }];

    expect(conIdsUnicos(mensajes)).toBe(mensajes);
  });
});
