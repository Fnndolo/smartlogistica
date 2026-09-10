import { redirect } from 'next/navigation';

/**
 * Menciones se mudo DENTRO de Chats, como una pestaña. La ruta se conserva
 * redirigiendo porque hay enlaces vivos hacia ella: marcadores del equipo y la
 * campana de notificaciones. Un 404 aqui seria romper algo que funcionaba por
 * una decision de menu.
 */
export default function MentionsPage() {
  redirect('/chats?tab=menciones');
}
