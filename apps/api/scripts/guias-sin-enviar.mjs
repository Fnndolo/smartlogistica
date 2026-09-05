/**
 * Pedidos con GUIA GENERADA a los que NUNCA les salio el WhatsApp con el rotulo.
 *
 * Sale de la caida del 4-sep: la guia se rendia en silencio cuando el proveedor
 * no devolvia el listado de plantillas. Ya esta arreglado (ahora se envia por
 * nombre), pero lo que no salio no se recupera solo.
 *
 * SOLO LECTURA. Escribe un CSV y no manda ni un mensaje: reenviar 200 avisos de
 * "su guia va en camino" a clientes que quiza ya recibieron el paquete se
 * decide mirando la lista, no a ciegas.
 *
 *   node --env-file=.env.local scripts/guias-sin-enviar.mjs [desde-ISO] [salida.csv]
 */
import pg from 'pg';
import { writeFileSync } from 'node:fs';

const { Client } = pg;
const s=(u)=>{const x=new URL(u);x.searchParams.delete('sslmode');return x.toString();};
const ssl=()=>(process.env.TENANT_DB_SSLMODE??'require')==='disable'?undefined:{rejectUnauthorized:false};
const adb=(u,db)=>{const x=new URL(u);x.pathname=`/${db}`;return x.toString();};
const csv=(v)=>`"${String(v ?? '').replace(/"/g,'""')}"`;

const desde = process.argv[2] ?? '2026-09-04 00:00:00-05';
const salida = process.argv[3] ?? 'guias-sin-enviar.csv';

const c=new Client({connectionString:s(process.env.CONTROL_PLANE_DATABASE_URL),ssl:ssl()});await c.connect();
const t=(await c.query(`SELECT "dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
await c.end();
const d=new Client({connectionString:s(adb(process.env.TENANT_DB_ADMIN_URL,t.dbName)),ssl:ssl()});await d.connect();

const rows=(await d.query(`
  SELECT o."externalId", o."customerName", o."customerPhone", o."guideNumber",
         o.status, w.name AS sede, e."createdAt"
  FROM "OrderEvent" e
  JOIN "Order" o ON o.id = e."orderId"
  LEFT JOIN "Warehouse" w ON w.id = o."warehouseId"
  WHERE e.type = 'guide_generated'
    AND e."createdAt" >= $1::timestamptz
    AND NOT EXISTS (SELECT 1 FROM "WaMessage" m WHERE m."contactId" = 'guide:' || o.id)
  ORDER BY e."createdAt"`, [desde])).rows;

const head='Fecha guia (Colombia),Pedido,Cliente,Telefono,Guia,Estado,Sede\n';
const body=rows.map((r)=>[
  csv(new Date(r.createdAt).toLocaleString('es-CO',{timeZone:'America/Bogota'})),
  csv(r.externalId), csv(r.customerName), csv(r.customerPhone),
  csv(r.guideNumber ?? 'SIN GUIA'), csv(r.status), csv(r.sede),
].join(',')).join('\n');
writeFileSync(salida, '﻿' + head + body, 'utf8');

const porDia = new Map();
for (const r of rows) {
  const k = new Date(r.createdAt).toLocaleDateString('es-CO',{timeZone:'America/Bogota'});
  porDia.set(k, (porDia.get(k) ?? 0) + 1);
}
console.log(`${rows.length} pedidos sin aviso de guia -> ${salida}`);
for (const [k,v] of porDia) console.log(`   ${k}: ${v}`);
console.log(`   sin numero de guia: ${rows.filter(r=>!r.guideNumber).length}`);
await d.end();
