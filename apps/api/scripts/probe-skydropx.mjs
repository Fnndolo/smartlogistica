/**
 * PROBE de la API Pro de Skydropx (sandbox): descubre host + auth OAuth y
 * prueba una cotizacion real Medellin (050015) -> Pasto (520003), 1kg.
 * Correr: node scripts/probe-skydropx.mjs <API_KEY> <API_SECRET>
 */
const KEY = process.argv[2];
const SECRET = process.argv[3];
if (!KEY || !SECRET) {
  console.log('uso: node scripts/probe-skydropx.mjs <API_KEY> <API_SECRET>');
  process.exit(1);
}

const HOSTS = ['https://sb-pro.skydropx.com', 'https://app.skydropx.com', 'https://pro.skydropx.com'];

async function tryJson(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { status: res.status, body: text };
  } catch (e) {
    return { status: 'ERR', body: String(e.message).slice(0, 120) };
  }
}

for (const host of HOSTS) {
  console.log(`\n===== ${host} =====`);
  // OAuth client_credentials (forma JSON y forma form-urlencoded)
  const tokenUrl = `${host}/api/v1/oauth/token`;
  let token = null;
  for (const [label, init] of [
    ['json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: KEY, client_secret: SECRET, grant_type: 'client_credentials' }),
    }],
    ['form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: KEY, client_secret: SECRET, grant_type: 'client_credentials' }).toString(),
    }],
  ]) {
    const r = await tryJson(tokenUrl, init);
    console.log(`token ${label}: HTTP ${r.status}: ${r.body.slice(0, 160)}`);
    if (r.status === 200) {
      try { token = JSON.parse(r.body).access_token ?? null; } catch { /* no-json */ }
      if (token) break;
    }
  }
  if (!token) continue;
  console.log(`TOKEN OK (${String(token).slice(0, 18)}...)`);

  // Cotizacion Medellin -> Pasto (forma Pro v1)
  const quote = await tryJson(`${host}/api/v1/quotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      quotation: {
        address_from: { country_code: 'CO', postal_code: '050015', area_level1: 'Antioquia', area_level2: 'Medellín', area_level3: 'Medellín' },
        address_to: { country_code: 'CO', postal_code: '520003', area_level1: 'Nariño', area_level2: 'Pasto', area_level3: 'Pasto' },
        parcel: { length: 30, width: 25, height: 25, weight: 2 },
        declared_amount: 500000,
      },
    }),
  });
  console.log(`quotation POST: HTTP ${quote.status}: ${quote.body.slice(0, 1200)}`);
  // Si es asincrona: poll por id
  try {
    const qid = JSON.parse(quote.body)?.id ?? JSON.parse(quote.body)?.data?.id ?? null;
    if (qid) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await tryJson(`${host}/api/v1/quotations/${qid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log(`\npoll ${i}: HTTP ${poll.status}: ${poll.body.slice(0, 2500)}`);
        try {
          const parsed = JSON.parse(poll.body);
          const done = parsed?.is_completed ?? parsed?.data?.attributes?.is_completed;
          if (done) {
            const rates = parsed?.rates ?? [];
            console.log('\n--- RESUMEN RATES ---');
            for (const rt of rates) {
              console.log(
                `${rt.provider_display_name} [${rt.provider_service_name}] success=${rt.success} status=${rt.status} total=${rt.total} days=${rt.days} err=${JSON.stringify(rt.error_messages)?.slice(0, 140)}`,
              );
            }
            break;
          }
        } catch { /* seguir */ }
      }
    }
  } catch { /* sin id */ }

  // Contrato de CREAR ENVIO: cuerpo vacio -> los 422 nos dictan los campos.
  const ship = await tryJson(`${host}/api/v1/shipments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ shipment: {} }),
  });
  console.log(`\nshipments POST vacio: HTTP ${ship.status}: ${ship.body.slice(0, 900)}`);
  break;
}
