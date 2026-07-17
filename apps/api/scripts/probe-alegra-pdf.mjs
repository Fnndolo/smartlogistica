/** SOLO LECTURA — encuentra como traer el PDF de una factura de Alegra. */
import pg from 'pg';
import crypto from 'node:crypto';
import axios from 'axios';
const { Client } = pg;
const INVOICE_ID = '26125';
function kekDec(b,k){const iv=b.subarray(1,13),t=b.subarray(13,29),c=b.subarray(29),d=crypto.createDecipheriv('aes-256-gcm',k,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]);}
function decF(b,dek){const iv=b.subarray(0,12),t=b.subarray(12,28),c=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',dek,iv);d.setAuthTag(t);return Buffer.concat([d.update(c),d.final()]).toString('utf8');}
const stripSsl=(u)=>{const x=new URL(u);x.searchParams.delete('sslmode');return x.toString();};
const pgSsl=()=>(process.env.TENANT_DB_SSLMODE??'require')==='disable'?undefined:{rejectUnauthorized:false};
const adminDb=(u,db)=>{const x=new URL(u);x.pathname=`/${db}`;return x.toString();};
async function main(){
  const kek=Buffer.from(process.env.KEK_V1??'','base64');
  const control=new Client({connectionString:stripSsl(process.env.CONTROL_PLANE_DATABASE_URL),ssl:pgSsl()});await control.connect();
  const t=(await control.query(`SELECT id,"dbName" FROM "Tenant" WHERE status='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
  const dek=kekDec((await control.query(`SELECT "wrappedDek" FROM "TenantDek" WHERE "tenantId"=$1`,[t.id])).rows[0].wrappedDek,kek);await control.end();
  const tdb=new Client({connectionString:stripSsl(adminDb(process.env.TENANT_DB_ADMIN_URL,t.dbName)),ssl:pgSsl()});await tdb.connect();
  const al=(await tdb.query(`SELECT email,"encryptedToken" FROM "AlegraConnection" LIMIT 1`)).rows[0];await tdb.end();
  const auth=`Basic ${Buffer.from(`${al.email}:${decF(al.encryptedToken,dek)}`).toString('base64')}`;

  // Ver campos del invoice relacionados con pdf/print.
  try {
    const inv=(await axios.get(`https://api.alegra.com/api/v1/invoices/${INVOICE_ID}`,{headers:{Accept:'application/json',Authorization:auth},timeout:20000})).data;
    console.log('campos pdf/print del invoice:', JSON.stringify({pdf:inv.pdf, printingTemplate:inv.printingTemplate, printUrl:inv.printUrl, publicUrl:inv.publicUrl, barCodeContent: inv.barCodeContent ? '(...)' : undefined}));
  } catch(e){console.log('get invoice err', e.response?.status);}

  const tries = [
    ['GET /invoices/{id}/pdf', `https://api.alegra.com/api/v1/invoices/${INVOICE_ID}/pdf`, {}],
    ['GET /invoices/{id} Accept pdf', `https://api.alegra.com/api/v1/invoices/${INVOICE_ID}`, {Accept:'application/pdf'}],
    ['GET /invoices/{id}?fields=pdf', `https://api.alegra.com/api/v1/invoices/${INVOICE_ID}?fields=pdf`, {Accept:'application/json'}],
  ];
  for(const [label,url,extra] of tries){
    try {
      const r=await axios.get(url,{headers:{Authorization:auth,...extra},responseType:'arraybuffer',timeout:25000});
      const ct=r.headers['content-type']||''; const buf=Buffer.from(r.data);
      const head=buf.subarray(0,8).toString('latin1');
      console.log(`  ✔ ${label}: status=${r.status} content-type=${ct} bytes=${buf.length} head=${JSON.stringify(head)}${head.startsWith('%PDF')?' <-- PDF!':''}`);
    } catch(e){ console.log(`  ✗ ${label}: ${e.response?.status} ${e.message}`); }
  }

  // Campo `pdf` en ?fields=pdf.
  try {
    const j=(await axios.get(`https://api.alegra.com/api/v1/invoices/${INVOICE_ID}?fields=pdf`,{headers:{Accept:'application/json',Authorization:auth},timeout:25000})).data;
    const pdf=j.pdf;
    console.log('\n  campo pdf:', pdf==null?'null':`tipo=${typeof pdf} len=${String(pdf).length} head=${String(pdf).slice(0,40)}`);
    if(typeof pdf==='string' && /^https?:/.test(pdf)){
      const r=await axios.get(pdf,{responseType:'arraybuffer',timeout:25000});
      const b=Buffer.from(r.data); console.log(`   URL pdf -> status=${r.status} ct=${r.headers['content-type']} bytes=${b.length} head=${JSON.stringify(b.subarray(0,8).toString('latin1'))}`);
    }
  } catch(e){ console.log('  fields=pdf err', e.response?.status, e.message); }
}
main().catch(e=>{console.error(e.message);process.exit(1);});
