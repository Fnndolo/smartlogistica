'use client';

// El chat de WhatsApp (calcado a WhatsApp Web) vive ahora partido en modulos
// dentro de ./whatsapp/. Este archivo queda SOLO como re-export para no tocar
// a los consumidores existentes (order-drawer y la bandeja /whatsapp).
export { WhatsappPanel } from './whatsapp/panel';
export { Ticks } from './whatsapp/icons';
export type { BubbleActions, MsgMenuAnchor } from './whatsapp/menus';
