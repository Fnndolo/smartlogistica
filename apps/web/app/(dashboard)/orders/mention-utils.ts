import type { MemberSummary } from '@smartlogistica/shared';

/** El "handle" de un miembro para mencionar: la parte del correo antes de la @. */
export function handleOf(email: string): string {
  return (email.split('@')[0] ?? email).trim();
}

/**
 * Si el cursor esta escribiendo una mencion (`@algo` sin espacios), devuelve el
 * inicio del token y el texto ya escrito tras la @. Si no, null. Solo dispara
 * cuando la @ va al inicio o tras un espacio (no en medio de un correo).
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1] ?? '')) return null; // @ en medio de una palabra
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null; // ya hay un espacio -> la mencion termino
  return { start: at, query };
}

/** userIds a mencionar: miembros cuyo `@handle` aparece como token en el texto. */
export function mentionsInText(text: string, members: MemberSummary[]): string[] {
  const ids: string[] = [];
  for (const m of members) {
    const h = handleOf(m.email);
    if (!h) continue;
    const re = new RegExp(`(^|\\s)@${escapeRegExp(h)}(?=$|\\s|[^\\w-])`, 'i');
    if (re.test(text)) ids.push(m.userId);
  }
  return [...new Set(ids)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
