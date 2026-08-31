/**
 * Renderiza un SOPORTE DE ENTREGA de ejemplo para revisarlo a ojo, sin tocar la
 * base de datos ni ninguna API.
 *
 *   cd apps/api
 *   node -r ts-node/register/transpile-only scripts/render-delivery-support-sample.ts salida.pdf
 */
import { writeFileSync } from 'node:fs';

import { DeliverySupportService } from '../src/modules/orders/delivery-support.service';

async function main(): Promise<void> {
  const pdf = await new DeliverySupportService().build({
    invoiceNumber: '29297',
    customerName: 'MARILUZ OCHOA',
    customerDocument: '1070015827',
    customerPhone: '3172384683',
    address: 'CR 21 # 15A-54 VRD EL POMAR, PASTO, NARIÑO',
    deliveryDate: '2026-08-28',
    items: [
      {
        name: 'PORTATIL ASUS EXPERTBOOK PM1503 CDA 512 GB 16GB DDR5 AMD RYZEN 7 170 15.6"',
        quantity: 1,
      },
      { name: 'MOUSE INALÁMBRICO LOGITECH M170 NEGRO', quantity: 2 },
    ],
  });
  const out = process.argv[2] ?? 'soporte-entrega-ejemplo.pdf';
  writeFileSync(out, pdf);
  console.log(`OK ${out} — ${pdf.length} bytes`);
}

void main();
