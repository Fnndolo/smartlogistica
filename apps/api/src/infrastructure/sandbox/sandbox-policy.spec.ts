import {
  decideOutbound,
  isSandboxMode,
  sandboxAllowedPhones,
  type OutboundDecision,
} from './sandbox-policy';

const PHONES = new Set(['3001234567']);
const decide = (method: string, url: string, body?: unknown): OutboundDecision['action'] =>
  decideOutbound({ method, url, body }, PHONES).action;

const soap = (proc: string) =>
  `<?xml version="1.0"?><soapenv:Envelope><soapenv:Body><tns:${proc}><p></p></tns:${proc}></soapenv:Body></soapenv:Envelope>`;

describe('modo pruebas: variables', () => {
  it('se activa solo con un valor afirmativo', () => {
    expect(isSandboxMode({ SANDBOX_MODE: 'true' })).toBe(true);
    expect(isSandboxMode({ SANDBOX_MODE: ' 1 ' })).toBe(true);
    expect(isSandboxMode({ SANDBOX_MODE: 'false' })).toBe(false);
    expect(isSandboxMode({})).toBe(false);
  });

  it('normaliza los celulares autorizados a 10 digitos', () => {
    const phones = sandboxAllowedPhones({
      SANDBOX_WA_ALLOWED_PHONES: '+57 300 123 4567, 573109876543;123',
    });
    expect([...phones].sort()).toEqual(['3001234567', '3109876543']);
  });
});

describe('modo pruebas: que puede salir', () => {
  it('toda lectura pasa', () => {
    expect(decide('GET', 'https://x.vtexcommercestable.com.br/api/oms/pvt/orders')).toBe('allow');
    expect(decide('get', 'https://api.alegra.com/api/v1/items')).toBe('allow');
  });

  it('VTEX: preparar, facturar y webhook se bloquean', () => {
    const base = 'https://acct.vtexcommercestable.com.br';
    expect(decide('POST', `${base}/api/oms/pvt/orders/1-01/start-handling`, {})).toBe('block');
    expect(decide('POST', `${base}/api/oms/pvt/orders/1-01/invoice`, {})).toBe('block');
    expect(decide('POST', `${base}/api/orders/hook/config`, {})).toBe('block');
  });

  it('Alegra: facturas y contactos se bloquean', () => {
    expect(decide('POST', 'https://api.alegra.com/api/v1/invoices', {})).toBe('block');
    expect(decide('PUT', 'https://api.alegra.com/api/v1/contacts/9', {})).toBe('block');
  });

  it('Skydropx: token y cotizar pasan; crear la guia no', () => {
    const base = 'https://api-pro.skydropx.com';
    expect(decide('POST', `${base}/api/v1/oauth/token`, '{}')).toBe('allow');
    expect(decide('POST', `${base}/api/v1/quotations`, '{}')).toBe('allow');
    expect(decide('POST', `${base}/api/v1/shipments`, '{}')).toBe('block');
  });

  it('Coordinadora SOAP: rastrear e imprimir pasan; generar guia no', () => {
    const url = 'https://ws.coordinadora.com/agw/ws/guias/1.6/server.php';
    expect(decide('POST', url, soap('Guias_rastreoExtendido'))).toBe('allow');
    expect(decide('POST', url, soap('Guias_imprimirRotulos'))).toBe('allow');
    expect(decide('POST', url, soap('Guias_generarGuia'))).toBe('block');
  });

  it('suite de Coordinadora: login, listado y rotulo pasan; editar guia no', () => {
    const base = 'https://envios.coordinadora.com';
    expect(decide('POST', `${base}/api/auth/signin/keycloak`, 'x=1')).toBe('allow');
    expect(
      decide('POST', 'https://sso.coordinadora.com/realms/c/login-actions/authenticate?s=1', 'u=1'),
    ).toBe('allow');
    expect(decide('POST', `${base}/api/proxy/suiteBackendService/guias/listado`, {})).toBe('allow');
    expect(decide('POST', `${base}/api/proxy/suiteBackendService/etiquetas/impresion`, {})).toBe(
      'allow',
    );
    expect(decide('PUT', `${base}/api/proxy/suiteBackendService/guias`, {})).toBe('block');
  });

  it('Addi: el inicio de sesion pasa', () => {
    expect(decide('POST', 'https://auth.addi.com/co/authenticate', '{}')).toBe('allow');
    expect(decide('POST', 'https://login.addi.com/login', 'a=1')).toBe('allow');
  });

  it('WhatsApp: solo a numeros autorizados', () => {
    const d360 = 'https://waba-v2.360dialog.io/messages';
    const meta = 'https://graph.facebook.com/v21.0/123/messages';
    expect(decide('POST', d360, { to: '573001234567', type: 'text' })).toBe('allow');
    // fetch manda el cuerpo como texto JSON
    expect(decide('POST', meta, JSON.stringify({ to: '573001234567' }))).toBe('allow');
    expect(decide('POST', d360, { to: '573209999999', type: 'text' })).toBe('block');
    expect(decide('POST', meta, JSON.stringify({ to: '573209999999' }))).toBe('block');
  });

  it('WhatsApp: leido/escribiendo se simula; webhook y plantillas se bloquean; subir media pasa', () => {
    const base = 'https://waba-v2.360dialog.io';
    expect(decide('POST', `${base}/messages`, { status: 'read', message_id: 'w' })).toBe(
      'simulate',
    );
    expect(decide('POST', `${base}/v1/configs/webhook`, { url: 'x' })).toBe('block');
    expect(decide('POST', `${base}/message_templates`, {})).toBe('block');
    expect(decide('DELETE', `${base}/message_templates`)).toBe('block');
    expect(decide('POST', `${base}/media`, 'form')).toBe('allow');
    expect(decide('POST', 'https://graph.facebook.com/v21.0/waba/subscribed_apps', {})).toBe(
      'block',
    );
  });

  it('la IA pasa', () => {
    expect(decide('POST', 'https://api.anthropic.com/v1/messages', '{}')).toBe('allow');
  });

  it('lo desconocido se bloquea', () => {
    expect(decide('POST', 'https://api.nuevo-proveedor.com/v1/orders', {})).toBe('block');
    expect(decide('DELETE', 'https://api.alegra.com/api/v1/invoices/1')).toBe('block');
    expect(decide('POST', 'no-es-url', {})).toBe('block');
  });

  it('el motivo dice que sistema y que numero', () => {
    const d = decideOutbound(
      { method: 'POST', url: 'https://waba-v2.360dialog.io/messages', body: { to: '3209999999' } },
      PHONES,
    );
    expect(d).toEqual({
      action: 'block',
      reason: 'el WhatsApp a +57 3209999999 (no está en SANDBOX_WA_ALLOWED_PHONES)',
    });
  });
});
