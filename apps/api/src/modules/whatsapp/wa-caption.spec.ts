import { BadRequestException } from '@nestjs/common';

import { cleanCaption, WA_CAPTION_MAX, waMediaObject } from './wa-shared';

describe('texto de la foto (caption)', () => {
  it('se recorta y vacio es null', () => {
    expect(cleanCaption('  Tu pedido va así  ')).toBe('Tu pedido va así');
    expect(cleanCaption('   ')).toBeNull();
    expect(cleanCaption(undefined)).toBeNull();
    expect(cleanCaption(['no', 'string'])).toBeNull();
  });

  it('pasado el tope de Meta, error claro antes de enviar', () => {
    expect(cleanCaption('a'.repeat(WA_CAPTION_MAX))).toHaveLength(WA_CAPTION_MAX);
    expect(() => cleanCaption('a'.repeat(WA_CAPTION_MAX + 1))).toThrow(BadRequestException);
  });
});

describe('objeto del medio para la Cloud API', () => {
  const link = 'https://almacen.ejemplo/f.jpg';

  it('foto y video llevan el texto', () => {
    expect(waMediaObject('image', link, undefined, 'Hola')).toEqual({ link, caption: 'Hola' });
    expect(waMediaObject('video', link, undefined, 'Mira')).toEqual({ link, caption: 'Mira' });
  });

  it('sin texto queda como antes', () => {
    expect(waMediaObject('image', link)).toEqual({ link });
    expect(waMediaObject('image', link, undefined, null)).toEqual({ link });
  });

  it('documento lleva el nombre; audio y sticker nunca llevan texto', () => {
    expect(waMediaObject('document', link, 'guia.pdf')).toEqual({ link, filename: 'guia.pdf' });
    expect(waMediaObject('audio', link, undefined, 'x')).toEqual({ link });
    expect(waMediaObject('sticker', link, undefined, 'x')).toEqual({ link });
  });
});
