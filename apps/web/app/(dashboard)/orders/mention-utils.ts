import type { MemberSummary } from '@smartlogistica/shared';

/** El "handle" de un miembro: la parte del correo antes de la @ (fallback legacy). */
export function handleOf(email: string): string {
  return (email.split('@')[0] ?? email).trim();
}

/** Como se menciona a un miembro: su NOMBRE (ej. "David Castro"); sin nombre, el handle. */
export function mentionName(m: Pick<MemberSummary, 'name' | 'email'>): string {
  return m.name?.trim() || handleOf(m.email);
}

/** Minusculas y sin acentos, para comparar nombres al buscar. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Si el cursor esta escribiendo una mencion (`@algo`), devuelve el inicio del
 * token y el texto tras la @. Los NOMBRES llevan espacios ("@David Castro"),
 * asi que el token admite espacios; el que decide si el popup se muestra es el
 * caller (solo cuando la query matchea a alguien). Solo dispara cuando la @ va
 * al inicio o tras un espacio (no en medio de un correo).
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1] ?? '')) return null; // @ en medio de una palabra
  const query = upto.slice(at + 1);
  if (query.length > 40 || query.includes('\n')) return null;
  return { start: at, query };
}

/** Miembros que matchean la query de una mencion en curso (por nombre o handle). */
export function matchMembers(query: string, members: MemberSummary[]): MemberSummary[] {
  const q = fold(query.trim());
  return members
    .filter((m) => {
      const name = fold(mentionName(m));
      const handle = fold(handleOf(m.email));
      // Prefijo por palabra: "cas" matchea "David Castro" (por "Castro") y "@david.castro".
      return (
        name.includes(q) ||
        handle.includes(q) ||
        name.split(/\s+/).some((w) => w.startsWith(q))
      );
    })
    .slice(0, 6);
}

/** userIds mencionados: miembros cuyo `@Nombre` (o `@handle` legacy) aparece en el texto. */
export function mentionsInText(text: string, members: MemberSummary[]): string[] {
  const ids: string[] = [];
  for (const m of members) {
    const tokens = [mentionName(m), handleOf(m.email)];
    for (const t of tokens) {
      if (!t) continue;
      const re = new RegExp(`(^|\\s)@${escapeRegExp(t)}(?=$|\\s|[^\\p{L}\\p{N}_-])`, 'iu');
      if (re.test(text)) {
        ids.push(m.userId);
        break;
      }
    }
  }
  return [...new Set(ids)];
}

/**
 * Divide un texto en segmentos normales y menciones (@Nombre / @handle) de los
 * miembros dados, para pintar las menciones como chips (azul, estilo Google
 * Chat). Los tokens mas largos van primero para que "@David Castro" gane sobre
 * un hipotetico "@David".
 */
export function splitMentions(
  text: string,
  members: MemberSummary[],
): Array<{ kind: 'text' | 'mention'; value: string }> {
  const tokens = [
    ...new Set(
      members.flatMap((m) => [mentionName(m), handleOf(m.email)]).filter((t) => t.length > 0),
    ),
  ].sort((a, b) => b.length - a.length);
  if (tokens.length === 0 || !text.includes('@')) return [{ kind: 'text', value: text }];

  const re = new RegExp(
    `(^|\\s)(@(?:${tokens.map(escapeRegExp).join('|')}))(?=$|\\s|[^\\p{L}\\p{N}_-])`,
    'giu',
  );
  const out: Array<{ kind: 'text' | 'mention'; value: string }> = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = (match.index ?? 0) + (match[1]?.length ?? 0);
    const token = match[2] ?? '';
    if (idx > last) out.push({ kind: 'text', value: text.slice(last, idx) });
    out.push({ kind: 'mention', value: token });
    last = idx + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out.length ? out : [{ kind: 'text', value: text }];
}

/** Iniciales para el avatar: "David Castro" -> "DC"; "ana" -> "AN". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${second}`.toUpperCase() || '?';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
