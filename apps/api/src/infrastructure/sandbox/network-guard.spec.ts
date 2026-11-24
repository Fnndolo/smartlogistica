/**
 * El guardian se instala al importarse y solo con SANDBOX_MODE: se carga en un
 * registro de modulos aislado, con el env de pruebas, y se verifica sin salir a
 * la red (las peticiones permitidas van a un adaptador falso).
 */
import type { AxiosStatic, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const fakeAdapter = async (cfg: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
  data: 'ok',
  status: 200,
  statusText: 'OK',
  headers: {},
  config: cfg,
});

describe('guardian de red', () => {
  const realFetch = globalThis.fetch;
  const env = { ...process.env };

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...env };
  });

  function load(sandbox: boolean): AxiosStatic {
    process.env.SANDBOX_MODE = sandbox ? 'true' : '';
    process.env.SANDBOX_WA_ALLOWED_PHONES = '3001234567';
    let ax!: AxiosStatic;
    // require (no import): el guardian se instala AL CARGARSE, asi que hay que
    // cargarlo despues de fijar el env y en un registro de modulos aislado.
    /* eslint-disable @typescript-eslint/no-require-imports */
    jest.isolateModules(() => {
      ax = require('axios').default as AxiosStatic;
      require('./network-guard');
    });
    /* eslint-enable @typescript-eslint/no-require-imports */
    return ax;
  }

  it('sin modo pruebas no toca nada', async () => {
    const before = globalThis.fetch;
    const ax = load(false);
    expect(globalThis.fetch).toBe(before);
    const res = await ax
      .create({ adapter: fakeAdapter })
      .post('https://api.alegra.com/api/v1/invoices', {});
    expect(res.data).toBe('ok');
  });

  it('bloquea escrituras de axios.create y deja pasar lecturas', async () => {
    const ax = load(true);
    const http = ax.create({
      baseURL: 'https://api.alegra.com/api/v1',
      adapter: fakeAdapter,
    });
    await expect(http.post('/invoices', { total: 1 })).rejects.toThrow(
      /Ambiente de pruebas: se bloqueó Alegra \(POST api\.alegra\.com\/api\/v1\/invoices\)/,
    );
    await expect(http.get('/items')).resolves.toMatchObject({ data: 'ok' });
  });

  it('bloquea escrituras de la instancia por defecto de axios', async () => {
    const ax = load(true);
    await expect(
      ax.post('https://x.vtexcommercestable.com.br/api/oms/pvt/orders/1/invoice', {}, {
        adapter: fakeAdapter,
      }),
    ).rejects.toThrow(/VTEX/);
  });

  it('simula "leido" de WhatsApp sin salir a la red', async () => {
    const ax = load(true);
    const neverCalled = jest.fn(fakeAdapter);
    const res = await ax
      .create({ baseURL: 'https://waba-v2.360dialog.io', adapter: neverCalled })
      .post('/messages', { messaging_product: 'whatsapp', status: 'read', message_id: 'w' });
    expect(res.data).toEqual({ success: true, sandbox: true });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('fetch: bloquea WhatsApp a un numero no autorizado y deja pasar uno autorizado', async () => {
    const spy = jest.fn(async () => new Response('{"messages":[{"id":"x"}]}'));
    globalThis.fetch = spy as unknown as typeof fetch;
    load(true);
    const url = 'https://graph.facebook.com/v21.0/123/messages';
    await expect(
      fetch(url, { method: 'POST', body: JSON.stringify({ to: '573209999999' }) }),
    ).rejects.toThrow(/\+57 3209999999/);
    expect(spy).not.toHaveBeenCalled();
    await fetch(url, { method: 'POST', body: JSON.stringify({ to: '573001234567' }) });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
