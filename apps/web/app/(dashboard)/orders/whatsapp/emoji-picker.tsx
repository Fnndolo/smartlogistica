'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Plus, Smile, Sticker as StickerIcon, X } from 'lucide-react';
import type { WaMessage, WaStickerFav, WaThread } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/* ==================== Picker de emojis y stickers ==================== */

/** Categorias como WhatsApp (pestañas arriba con icono + Recientes). */
export const EMOJI_GROUPS: Array<{ icon: string; label: string; list: string }> = [
  {
    icon: '😀',
    label: 'Emoticonos y personas',
    list:
      '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿💀👻👽🤖💩' +
      '👍👎👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏✍️💪🖕✊👊🤛🤜👏🙌👐🤲🤳💅👀👁️👄🦷👅👂👃🧠',
  },
  {
    icon: '🐻',
    label: 'Animales y naturaleza',
    list:
      '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🦂🐢🐍🦎🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🦓🦍🐘🦒🐄🐎🐖🐑🦙🐐🦌🐕🐩🐈🐓🦃🦚🦜🦢🦩🐇🦝🦨🦥🐿️🦔' +
      '🌵🎄🌲🌳🌴🌱🌿🍀🎍🎋🍃🍂🍁🍄🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌙⭐🌟💫✨☀️⛅☁️🌧️⛈️🌩️❄️⛄💨💧💦☔🌊🌈🌍🌎🌏',
  },
  {
    icon: '🍔',
    label: 'Comida y bebidas',
    list: '🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🥠🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🍾🧊',
  },
  {
    icon: '⚽',
    label: 'Actividades',
    list: '⚽🏀🏈⚾🎾🏐🎱🏓🏸⛳🏹🎣🥊🥋🎽🛹⛸️🎿🛷🥌🏆🥇🥈🥉🏅🎖️🎮🕹️🎰🎲🧩🎭🎨🧵🧶🎯🎳🎪🎤🎧🎼🎹🥁🎷🎺🎸🎻🎬🏹',
  },
  {
    icon: '🚗',
    label: 'Viajes y lugares',
    list: '🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🚚🚛🚜🏍️🛵🚲🛴🚨🚔🚖✈️🛫🛬🛩️🚀🛸🚁⛵🚤🛳️⛴️🚢⚓⛽🚧🚦🚥🚏🗺️🗿🗽🗼🏰🏯🏟️🎡🎢🎠⛲⛱️🏖️🏝️🏜️🌋⛰️🏔️🗻🏕️⛺🏠🏡🏘️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫💒⛪🕌🛕🕋⛩️🚄🚅🚂🚉🚊🚝🚞🚋🚃🚟🚠🚡',
  },
  {
    icon: '💡',
    label: 'Objetos',
    list: '📱💻⌨️🖥️🖨️🖱️💽💾💿📀📷📸📹🎥📞☎️📺📻⏰⌚⏳⌛💡🔦🕯️💸💵💰💳💎🪜🧰🔧🔨🛠️⚙️🧲🧨🔪🏺🔮🧿🔭🔬💊💉🩸🧬🧹🧺🧻🚽🚿🛁🧼🧽🛎️🔑🗝️🚪🪑🛋️🛏️🧸🖼️🛍️🎁🎈🎀🎊🎉📦📫📜📃📊📈📉📆📅📇📋📁📂📰📓📚📖🔖📎📐📏📌📍✂️🖊️✒️📝✏️🔍🔎🔐🔒🔓',
  },
  {
    icon: '🔣',
    label: 'Símbolos',
    list: '❤️🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝💟💋✅❌❓❗‼️⁉️💯🔥✨🎵🎶➕➖➗✖️💲™️©️®️🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷⚠️🚫♻️🔞📵🚭🚱🚳🚷🛑💤♠️♥️♦️♣️🃏🀄🎴🔔🔕📣📢💬💭🗯️♨️💈🛐⚛️✝️☪️☮️🕎🔯♈♉♊♋♌♍♎♏♐♑♒♓⛎',
  },
  {
    icon: '🏳️',
    label: 'Banderas',
    list: '🏳️🏴🏁🚩🏳️‍🌈🇨🇴🇺🇸🇲🇽🇪🇸🇦🇷🇧🇷🇨🇱🇵🇪🇪🇨🇻🇪🇵🇦🇨🇷🇬🇹🇭🇳🇸🇻🇳🇮🇩🇴🇨🇺🇵🇷🇧🇴🇵🇾🇺🇾🇨🇦🇬🇧🇫🇷🇩🇪🇮🇹🇵🇹🇳🇱🇨🇭🇸🇪🇳🇴🇩🇰🇯🇵🇰🇷🇨🇳🇮🇳🇷🇺🇦🇺🇹🇷🇬🇷🇮🇱🇸🇦🇦🇪🇪🇬🇿🇦🇳🇬',
  },
];

/** Busqueda basica en español (palabra -> emojis). */
const EMOJI_KEYWORDS: Record<string, string> = {
  corazon: '❤️🧡💛💚💙💜🖤🤍💔💕💖💘', amor: '❤️😍🥰😘💕💋', risa: '😂🤣😆😅😄', jaja: '😂🤣',
  feliz: '😀😃😄😊🙂', triste: '😢😭😞🙁', llorar: '😢😭', enojo: '😠😡🤬', rabia: '😠😡🤬',
  fuego: '🔥', ok: '👌👍✅', bien: '👍✅💯', mal: '👎❌', gracias: '🙏', porfavor: '🙏',
  mano: '👋🤝👏🙌✋', saludo: '👋🤗', fiesta: '🥳🎉🎊🎈', musica: '🎵🎶🎧🎸🎹', baile: '💃🕺',
  dinero: '💰💵💸💳', plata: '💰💵💸', comida: '🍔🍕🌭🍟🍗', cafe: '☕', cerveza: '🍺🍻',
  perro: '🐶🐕', gato: '🐱🐈', casa: '🏠🏡', carro: '🚗🏎️🚙', moto: '🏍️🛵', avion: '✈️🛫',
  telefono: '📱☎️📞', celular: '📱', foto: '📷📸', video: '🎥📹', regalo: '🎁🎀',
  estrella: '⭐🌟✨', sol: '☀️🌞', luna: '🌙🌛', lluvia: '🌧️☔⛈️', frio: '🥶❄️⛄', calor: '🥵☀️',
  check: '✅✔️', chulo: '✅', equis: '❌', pregunta: '❓', alerta: '⚠️🚨', prohibido: '🚫⛔',
  cohete: '🚀', cien: '💯', bandera: '🏁🚩🏳️', colombia: '🇨🇴', dormir: '😴🥱💤',
  beso: '😘😗💋', guiño: '😉', pensar: '🤔🧐', ojos: '👀', paquete: '📦', caja: '📦',
  envio: '📦🚚✈️', camion: '🚚🚛', reloj: '⏰⌚⏳', tiempo: '⏰⌛', fantasma: '👻',
  calavera: '💀', diablo: '😈', payaso: '🤡', robot: '🤖', unicornio: '🦄', flor: '🌹🌷🌸💐',
  arbol: '🌳🎄🌴', libro: '📚📖', lapiz: '✏️🖊️', tijeras: '✂️', llave: '🔑🗝️', candado: '🔒🔐',
  medalla: '🏅🥇🏆', trofeo: '🏆', balon: '⚽🏀', futbol: '⚽', gol: '⚽🥅🎉',
};

/** Recientes (localStorage), como la pestaña Recientes de WhatsApp. */
const RECENT_EMOJI_KEY = 'wa-recent-emojis';
const getRecentEmojis = (): string[] => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(String).slice(0, 24) : [];
  } catch {
    return [];
  }
};
export const pushRecentEmoji = (e: string): void => {
  try {
    const cur = getRecentEmojis().filter((x) => x !== e);
    window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify([e, ...cur].slice(0, 24)));
  } catch {
    /* sin storage */
  }
};

/** Trocea una tira de emojis en emojis completos (ZWJ/VS16/tonos/banderas). */
export const splitEmojis = (list: string): string[] =>
  list.match(
    /[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|[\u{1F3FB}-\u{1F3FF}])*/gu,
  ) ?? [];

/** Panel de emojis y stickers, estilo WhatsApp Web (pestañas abajo). */
export function EmojiStickerPicker({
  thread,
  onEmoji,
  onSticker,
  onCreateSticker,
}: {
  thread: WaThread;
  onEmoji: (emoji: string) => void;
  onSticker: (vars: { stickerId?: string; messageId?: string }) => void;
  onCreateSticker: () => void;
}) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
  const [q, setQ] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => setRecents(getRecentEmojis()), []);

  const pickEmoji = (e: string) => {
    onEmoji(e);
    pushRecentEmoji(e);
    setRecents(getRecentEmojis());
  };
  const jumpTo = (key: string) => sectionRefs.current[key]?.scrollIntoView({ block: 'start' });

  // Busqueda basica en español (diccionario de palabras clave).
  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    const out = new Set<string>();
    for (const [word, emojis] of Object.entries(EMOJI_KEYWORDS)) {
      if (word.includes(query)) splitEmojis(emojis).forEach((e) => out.add(e));
    }
    return [...out];
  }, [query]);

  const { data: favs = [] } = useQuery({
    queryKey: ['wa-stickers'],
    queryFn: () => api.get<WaStickerFav[]>('/v1/whatsapp/stickers'),
    staleTime: 60_000,
    enabled: tab === 'sticker',
  });

  // Stickers RECIENTES del hilo (los que ya pasaron por el chat).
  const recentStickers = useMemo(() => {
    const seen = new Set<string>();
    const out: WaMessage[] = [];
    for (let i = thread.messages.length - 1; i >= 0 && out.length < 18; i--) {
      const m = thread.messages[i]!;
      if (m.kind === 'sticker' && m.mediaUrl && !seen.has(m.mediaUrl)) {
        seen.add(m.mediaUrl);
        out.push(m);
      }
    }
    return out;
  }, [thread.messages]);

  return (
    <div className="border-t border-border bg-[#f0f2f5] dark:bg-[#202c33]">
      {tab === 'emoji' ? (
        <>
          {/* Pestañas ARRIBA por categoria (con Recientes), como WhatsApp. */}
          <div className="flex items-center justify-around border-b border-border/60 px-1">
            <button
              type="button"
              onClick={() => jumpTo('recientes')}
              className="px-1.5 py-1.5 text-[#54656f] dark:text-[#8696a0]"
              title="Recientes"
              aria-label="Recientes"
            >
              <Clock3 className="h-5 w-5" />
            </button>
            {EMOJI_GROUPS.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => jumpTo(g.label)}
                className="px-1 py-1 text-[19px] leading-[24px] opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
                title={g.label}
                aria-label={g.label}
              >
                {g.icon}
              </button>
            ))}
          </div>
          {/* Buscador */}
          <div className="px-3 pb-1 pt-2">
            <div className="flex h-9 items-center gap-2 rounded-full border border-[#00a884]/60 bg-white px-3 dark:bg-[#2a3942]">
              <span className="text-[#667781] dark:text-[#8696a0]">🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar emoji"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[#667781] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
              />
              {q ? (
                <button type="button" onClick={() => setQ('')} aria-label="Limpiar">
                  <X className="h-3.5 w-3.5 text-[#667781]" />
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      <div className={cn('overflow-y-auto px-3 py-2', tab === 'emoji' ? 'h-[220px]' : 'h-[264px]')}>
        {tab === 'emoji' ? (
          query ? (
            <div className="flex flex-wrap">
              {results.length === 0 ? (
                <p className="w-full py-6 text-center text-[12.5px] text-[#667781] dark:text-[#8696a0]">
                  Sin resultados para «{q}».
                </p>
              ) : (
                results.map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickEmoji(e)}
                    className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                  >
                    {e}
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {recents.length > 0 ? (
                <div
                  ref={(el) => {
                    sectionRefs.current['recientes'] = el;
                  }}
                >
                  <p className="px-1 pb-1 pt-1 text-[13px] text-[#667781] dark:text-[#8696a0]">Recientes</p>
                  <div className="flex flex-wrap">
                    {recents.map((e, i) => (
                      <button
                        key={`rec-${i}`}
                        type="button"
                        onClick={() => pickEmoji(e)}
                        className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {EMOJI_GROUPS.map((g) => (
                <div
                  key={g.label}
                  ref={(el) => {
                    sectionRefs.current[g.label] = el;
                  }}
                >
                  <p className="px-1 pb-1 pt-3 text-[13px] text-[#667781] dark:text-[#8696a0]">{g.label}</p>
                  <div className="flex flex-wrap">
                    {splitEmojis(g.list).map((e, i) => (
                      <button
                        key={`${g.label}-${i}`}
                        type="button"
                        onClick={() => pickEmoji(e)}
                        className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )
        ) : (
          <div>
            <p className="px-1 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
              Favoritos
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={onCreateSticker}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-[#667781] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
              >
                <Plus className="h-6 w-6" />
                <span className="text-[11px]">Crear</span>
              </button>
              {favs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSticker({ stickerId: s.id })}
                  className="aspect-square overflow-hidden rounded-xl p-1 transition-transform hover:scale-105"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt="Sticker favorito" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
            {recentStickers.length > 0 ? (
              <>
                <p className="px-1 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
                  Recientes del chat
                </p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {recentStickers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSticker({ messageId: m.id })}
                      className="aspect-square overflow-hidden rounded-xl p-1 transition-transform hover:scale-105"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.mediaUrl ?? ''} alt="Sticker" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {favs.length === 0 && recentStickers.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-[#667781] dark:text-[#8696a0]">
                Aún no hay stickers: crea uno con «Crear» o agrega a Favoritos los que lleguen al
                chat (clic en el sticker → Añadir a Favoritos).
              </p>
            ) : null}
          </div>
        )}
      </div>
      {/* Pestañas abajo, como WhatsApp Web */}
      <div className="flex justify-center gap-1 border-t border-border py-1.5">
        <button
          type="button"
          onClick={() => setTab('emoji')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-4 py-1 text-[12.5px] transition-colors',
            tab === 'emoji'
              ? 'bg-white font-medium text-[#111b21] shadow-sm dark:bg-[#2a3942] dark:text-[#e9edef]'
              : 'text-[#667781] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5',
          )}
        >
          <Smile className="h-4 w-4" />
          Emoji
        </button>
        <button
          type="button"
          onClick={() => setTab('sticker')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-4 py-1 text-[12.5px] transition-colors',
            tab === 'sticker'
              ? 'bg-white font-medium text-[#111b21] shadow-sm dark:bg-[#2a3942] dark:text-[#e9edef]'
              : 'text-[#667781] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5',
          )}
        >
          <StickerIcon className="h-4 w-4" />
          Stickers
        </button>
      </div>
    </div>
  );
}
