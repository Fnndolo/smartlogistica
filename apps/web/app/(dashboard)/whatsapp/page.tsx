import type { Metadata } from 'next';

import { WhatsappInbox } from './inbox-client';

export const metadata: Metadata = { title: 'WhatsApp' };

/**
 * Bandeja de entrada de WhatsApp (estilo WhatsApp Web): TODOS los chats del
 * numero del negocio, con contadores de no leidos, etiquetas y el chat
 * completo al lado (el mismo panel calcado del drawer de pedidos).
 */
export default function WhatsappPage() {
  return <WhatsappInbox />;
}
