'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Truck,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  coordinadoraRotuloOptions,
  type CoordinadoraCity,
  type CreateSkydropxGuideInput,
  type Guide,
  type GuidePreview,
  type GuideTracking,
  type SkydropxPackaging,
  type SkydropxCity,
  type SkydropxPackagePreset,
  type SkydropxQuoteResponse,
  type SkydropxRate,
} from '@smartlogistica/shared';

import { CityPicker } from '@/components/city-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { clearDraft, getDraft, setDraft } from './panel-drafts';

/* ── Lenguaje visual "Cobalto" (mockup aprobado) ─────────────────────────────
   Constantes de ESTILO unicamente: el campo del mockup (.input) es una
   superficie BLANCA sobre el lienzo, con el borde de campo mas fuerte, 10px de
   radio, 38px de alto minimo y borde cobalto al pasar el mouse. */
const INPUT_CLS =
  'h-auto min-h-[38px] rounded-[10px] border-input bg-card text-[13.5px] shadow-none transition-colors placeholder:text-hint hover:border-accent max-md:min-h-[42px]';
/** Mismo tratamiento para los <select> nativos (la flecha la pone el sufijo). */
const SELECT_CLS =
  'h-auto min-h-[38px] w-full max-w-full appearance-none rounded-[10px] border border-input bg-card px-3 py-2 pr-9 text-[13.5px] shadow-none outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-[42px]';
/** Sufijo dentro del campo (.input .suffix): unidad, flecha o pista corta. */
const SUFFIX_CLS =
  'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-hint';
/** Identificadores (guia, codigo postal, DANE) en monoespaciada (.mono): la
 *  monoespaciada corre mas ancha, asi que el mockup la baja al 92% para que
 *  case con el texto vecino. */
const MONO_CLS = 'font-mono text-[0.92em] tracking-[0.02em]';
/** Foco de teclado visible sobre las superficies cobalto. */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card';
/** Alcanza SOLO el disparador del CityPicker (el desplegable vive mas adentro):
 *  lo deja identico a un .input del mockup. */
const CITY_TRIGGER_CLS =
  '[&>div>button]:min-h-[38px] [&>div>button]:rounded-[10px] [&>div>button]:border-input [&>div>button]:bg-card [&>div>button]:text-[13.5px] [&>div>button]:transition-colors [&>div>button:hover]:border-accent max-md:[&>div>button]:min-h-[42px] [&>div>button>span]:min-w-0';
/** Boton primario del mockup (.btn-primary): degradado cobalto -> cobalto
 *  profundo, halo de color y el reflejo interno del borde superior. */
const BTN_PRIMARY_CLS =
  'h-auto max-w-full whitespace-normal rounded-[11px] bg-[linear-gradient(to_bottom,hsl(var(--accent)),hsl(var(--accent-deep)))] px-[18px] py-2.5 text-center text-[13.5px] font-extrabold tracking-[0.01em] text-accent-foreground shadow-[0_6px_18px_-6px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,background] [transition-duration:120ms] hover:-translate-y-px hover:shadow-[0_10px_24px_-8px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 max-sm:w-full [&_svg]:size-[15px]';
/** Boton secundario del mockup (.btn-ghost). */
const BTN_GHOST_CLS =
  'h-auto max-w-full whitespace-normal rounded-[11px] border border-input bg-card px-[18px] py-2.5 text-center text-[13.5px] font-extrabold tracking-[0.01em] text-muted-foreground shadow-none hover:bg-card hover:border-accent hover:text-accent motion-reduce:transition-none max-sm:w-full [&_svg]:size-[15px]';

interface Recipient {
  name: string;
  document: string;
  address: string;
  cityCode: string;
  cityName: string;
  phone: string;
}
interface Pkg {
  weight: string;
  height: string;
  width: string;
  length: string;
  units: string;
  content: string;
  declaredValue: string;
  observations: string;
}

/** Transportadora del panel: Coordinadora (directa) o Skydropx (agregador). */
type Courier = 'coordinadora' | 'skydropx';

/** Embalaje por defecto del catalogo de Skydropx: '4G' = Caja de carton. */
const DEFAULT_PACKAGING_CODE = '4G';

/** Ciudad de destino en modo Skydropx: nombre limpio (sin el parentesis del
 *  catalogo) + departamento COMPLETO tal cual ("Antioquia"). Sale del catalogo
 *  de Coordinadora porque Skydropx no expone catalogo propio de ciudades. */
interface SdxCity {
  name: string;
  department: string;
}

interface GuideDraft {
  recipient: Recipient;
  pkg: Pkg;
  rotuloId: number | null;
  // Recaudo contraentrega (solo pedidos montados a mano).
  codOn?: boolean;
  codValue?: string;
  // Modo Skydropx: transportadora elegida y CP destino (sobreviven al cerrar).
  courier?: Courier;
  postalCodeTo?: string;
  // Modo Skydropx: ciudad de destino elegida del catalogo de Coordinadora
  // (opcionales: los borradores viejos no los traen).
  cityTo?: string;
  departmentTo?: string;
  // Modo Skydropx: embalaje elegido del catalogo (opcional: los borradores
  // viejos no lo traen -> cae al default '4G').
  packagingCode?: string;
}

export function GuidePanel({
  orderId,
  manual = false,
  orderTotal,
}: {
  orderId: string;
  /** Pedido MONTADO a mano: habilita la opcion de recaudo contraentrega. */
  manual?: boolean;
  /** Total del pedido (default del valor a recaudar). */
  orderTotal?: string;
}) {
  const qc = useQueryClient();
  // Arrancar del borrador si el usuario ya habia editado aqui (cerro el drawer
  // o navego y volvio); si no, se llena desde el preview.
  const draft = getDraft<GuideDraft>(`guide:${orderId}`);
  const [recipient, setRecipient] = useState<Recipient | null>(draft?.recipient ?? null);
  const [pkg, setPkg] = useState<Pkg | null>(draft?.pkg ?? null);
  const [rotuloId, setRotuloId] = useState<number | null>(draft?.rotuloId ?? null);
  const [codOn, setCodOn] = useState<boolean>(draft?.codOn ?? false);
  const [codValue, setCodValue] = useState<string>(draft?.codValue ?? orderTotal ?? '');
  const [result, setResult] = useState<Guide | null>(null);

  // === Skydropx ===
  const [courier, setCourier] = useState<Courier>(draft?.courier ?? 'coordinadora');
  const [postalCodeTo, setPostalCodeTo] = useState<string>(draft?.postalCodeTo ?? '');
  // Embalaje del catalogo de Skydropx (persiste en el borrador).
  const [packagingCode, setPackagingCode] = useState<string>(
    draft?.packagingCode ?? DEFAULT_PACKAGING_CODE,
  );
  // Ciudad de destino elegida del catalogo postal nacional (persiste en el
  // borrador). Alimenta la PROXIMA cotizacion: el server la prefiere sobre la
  // ciudad del pedido.
  const [sdxCity, setSdxCity] = useState<SdxCity | null>(
    draft?.cityTo ? { name: draft.cityTo, department: draft.departmentTo ?? '' } : null,
  );
  // Espejo para leer la eleccion VIGENTE dentro del onSuccess de cotizar (si
  // el usuario eligio otra ciudad mientras la cotizacion volaba, la respuesta
  // vieja se descarta en vez de pisarle el CP y las tarifas).
  const sdxCityRef = useRef<SdxCity | null>(sdxCity);
  useEffect(() => {
    sdxCityRef.current = sdxCity;
  }, [sdxCity]);
  // Ciudad con la que salio la ULTIMA cotizacion: la guia debe llevar estos
  // MISMOS valores (vive solo en memoria, igual que las tarifas).
  const [quotedCity, setQuotedCity] = useState<SdxCity | null>(null);
  // La cotizacion vive solo en memoria: las tarifas caducan rapido y siempre
  // conviene re-cotizar al volver (el CP resuelto SI persiste en el borrador).
  const [quote, setQuote] = useState<SkydropxQuoteResponse | null>(null);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  // Nombre visible de la transportadora con la que salio la guia (para la
  // tarjeta de exito; tras remontar lo repone el endpoint de rastreo).
  const [emittedCarrier, setEmittedCarrier] = useState<string | null>(null);
  // Chip de paquete guardado resaltado. PRESENTACIONAL: solo dice cual se
  // pulso (el estado real son las medidas en `pkg`), igual que el `value` que
  // llevaba el <select> al que reemplaza. '' = Personalizado.
  const [presetName, setPresetName] = useState<string>('');
  const [sdxPresetName, setSdxPresetName] = useState<string>('');

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['guide-preview', orderId],
    queryFn: () => api.get<GuidePreview>(`/v1/orders/${orderId}/guide-preview`),
    retry: false,
  });

  // Catalogo de EMBALAJES de Skydropx (Caja de carton 4G, Saco bolsa 5H4...).
  // Es un catalogo fijo -> staleTime largo; solo se consulta en modo Skydropx.
  // Los presets generales de paquete son de Coordinadora y aqui no aplican.
  const {
    data: packagings,
    error: packagingsError,
    isPending: packagingsPending,
  } = useQuery({
    queryKey: ['skydropx-packagings'],
    queryFn: () => api.get<SkydropxPackaging[]>('/v1/skydropx/packagings'),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
    enabled: courier === 'skydropx',
  });

  // Paquetes guardados PROPIOS del modo Skydropx (los gestiona /settings; los
  // "Mis paquetes" del panel de Skydropx no los expone su API). Elegir uno
  // llena medidas, peso y, si el preset los trae, contenido y embalaje.
  const { data: sdxPresets = [] } = useQuery({
    queryKey: ['skydropx-package-presets'],
    queryFn: () => api.get<SkydropxPackagePreset[]>('/v1/skydropx/package-presets'),
    staleTime: 60_000,
    retry: false,
    enabled: courier === 'skydropx',
  });

  useEffect(() => {
    if (preview && recipient === null) {
      setRecipient({
        name: preview.recipient.name ?? '',
        document: preview.recipient.document ?? '',
        address: preview.recipient.address ?? '',
        cityCode: preview.recipient.cityCode ?? '',
        cityName: preview.recipient.cityName ?? '',
        phone: preview.recipient.phone ?? '',
      });
      // El CP llega YA resuelto en el preview: el campo arranca lleno (solo
      // si no hay uno en el borrador — lo tecleado o elegido manda).
      if (preview.recipient.postalCode) {
        setPostalCodeTo((cur) => cur || preview.recipient.postalCode || '');
      }
      setPkg({
        weight: String(preview.package.weight),
        height: String(preview.package.height),
        width: String(preview.package.width),
        length: String(preview.package.length),
        units: String(preview.package.units),
        content: preview.package.content,
        declaredValue: String(preview.package.declaredValue),
        observations: preview.package.observations ?? '',
      });
      setRotuloId(preview.rotuloId);
    }
  }, [preview, recipient]);

  // Persistir el borrador con cada edicion (sobrevive cierre del drawer).
  useEffect(() => {
    if (recipient && pkg) {
      setDraft<GuideDraft>(`guide:${orderId}`, {
        recipient,
        pkg,
        rotuloId,
        codOn,
        codValue,
        courier,
        postalCodeTo,
        // Embalaje elegido en modo Skydropx (sobrevive cierre del drawer).
        packagingCode,
        // Ciudad elegida en modo Skydropx (sobrevive cierre del drawer).
        ...(sdxCity ? { cityTo: sdxCity.name, departmentTo: sdxCity.department } : {}),
      });
    }
  }, [
    recipient,
    pkg,
    rotuloId,
    codOn,
    codValue,
    courier,
    postalCodeTo,
    packagingCode,
    sdxCity,
    orderId,
  ]);

  const generate = useMutation({
    // Con clave: si cierran el drawer con la guia EN CURSO, al volver el boton
    // sigue "cargando" (useIsMutating) y no se puede re-enviar.
    mutationKey: ['op-guide', orderId],
    mutationFn: () =>
      api.post<Guide>(`/v1/orders/${orderId}/guide`, {
        recipient: {
          name: recipient!.name.trim(),
          document: recipient!.document.trim(),
          address: recipient!.address.trim(),
          cityCode: recipient!.cityCode.trim(),
          phone: recipient!.phone.trim(),
        },
        package: {
          weight: Number(pkg!.weight),
          height: Number(pkg!.height),
          width: Number(pkg!.width),
          length: Number(pkg!.length),
          units: Math.max(1, Number(pkg!.units) || 1),
          content: pkg!.content.trim(),
          declaredValue: Number(pkg!.declaredValue) || 0,
          ...(pkg!.observations.trim() ? { observations: pkg!.observations.trim() } : {}),
        },
        ...(rotuloId ? { rotuloId } : {}),
        // Recaudo contraentrega (para TODOS los pedidos): Coordinadora cobra
        // este valor al entregar.
        ...(codOn && Number(codValue) > 0 ? { codValue: Number(codValue) } : {}),
      }),
    onSuccess: (g) => {
      setResult(g);
      clearDraft(`guide:${orderId}`);
      toast.success(`Guía ${g.number} generada`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      // Montado a mano: con factura + guia el pedido queda COMPLETO -> cambia
      // de seccion en la lista de la sede.
      if (manual) qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo generar la guía'),
  });

  // Paquete en el shape que pide Skydropx (cotizar y generar usan el MISMO:
  // asi la tarifa elegida corresponde a lo que de verdad se envia).
  const sdxPackage = () => ({
    weight: Number(pkg!.weight),
    length: Number(pkg!.length),
    width: Number(pkg!.width),
    height: Number(pkg!.height),
    declaredValue: Number(pkg!.declaredValue) || 0,
  });

  const quoteMutation = useMutation({
    // La ciudad viaja como variable de la mutacion: en onSuccess se sabe con
    // certeza cual se envio a cotizar (aunque el estado cambie mientras tanto).
    mutationFn: (city: SdxCity | null) =>
      api.post<SkydropxQuoteResponse>(`/v1/orders/${orderId}/skydropx-quote`, {
        package: sdxPackage(),
        // Vacio = que el server lo resuelva con la direccion del pedido.
        ...(postalCodeTo.trim() ? { postalCodeTo: postalCodeTo.trim() } : {}),
        // Ciudad elegida del catalogo: el server la prefiere sobre la del pedido.
        ...(city ? { cityTo: city.name, departmentTo: city.department } : {}),
      }),
    onSuccess: (q, city) => {
      // Si el usuario eligio OTRA ciudad mientras esta cotizacion volaba, la
      // respuesta es de un destino viejo: se descarta ENTERA (tarifas y CP
      // incluidos) — aplicarla dejaria el picker en la ciudad nueva con el
      // CP y las tarifas de la anterior.
      if (sdxCityRef.current !== null && sdxCityRef.current !== city) {
        toast.info('Cambiaste la ciudad: vuelve a cotizar.');
        return;
      }
      setQuote(q);
      // La tarifa elegida pertenece a la cotizacion anterior -> se re-elige.
      setSelectedRateId(null);
      // CP resuelto por el server: se muestra para poder corregirlo.
      setPostalCodeTo(q.postalCodeTo);
      // La ciudad elegida queda CONSUMIDA por esta cotizacion (la guia saldra
      // con estos mismos valores y el picker muestra la ciudad resuelta).
      // Si fue automatica, el server devuelve ciudad + departamento resueltos
      // (formato Skydropx) y el picker los muestra tal cual.
      setQuotedCity(
        city ?? (q.cityTo ? { name: q.cityTo, department: q.departmentTo || q.cityTo } : null),
      );
      setSdxCity(null);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cotizar con Skydropx'),
  });

  const selectedRate = quote?.rates.find((r) => r.id === selectedRateId) ?? null;

  const generateSkydropx = useMutation({
    // MISMA clave que la guia de Coordinadora: una sola guia en vuelo por
    // pedido, sin importar por cual transportadora salga.
    mutationKey: ['op-guide', orderId],
    mutationFn: () => {
      const body: CreateSkydropxGuideInput = {
        rateId: selectedRate!.id,
        // La doc de Skydropx exige tambien la cotizacion y el slug del carrier.
        ...(quote ? { quotationId: quote.quotationId } : {}),
        carrier: selectedRate!.carrier,
        carrierCode: selectedRate!.carrierCode,
        package: sdxPackage(),
        // Puede ir vacio si hay ciudad (Skydropx acepta ciudad+depto sin CP).
        postalCodeTo: postalCodeTo.trim(),
        // Los MISMOS valores de ciudad con los que salio la ultima cotizacion.
        ...(quotedCity ? { cityTo: quotedCity.name, departmentTo: quotedCity.department } : {}),
        recipient: {
          name: recipient!.name.trim(),
          address: recipient!.address.trim(),
          phone: recipient!.phone.trim(),
        },
        packageContent: pkg!.content.trim() || 'TECNOLOGIA',
        // Embalaje del catalogo de Skydropx (codigo, ej. '4G' caja de carton).
        ...(packagingCode ? { packagingCode } : {}),
      };
      return api.post<Guide>(`/v1/orders/${orderId}/guide-skydropx`, body);
    },
    onSuccess: (g) => {
      // El server ya hizo TODO el cierre (chat, WhatsApp, VTEX): aqui solo se
      // replica el onSuccess de la guia de Coordinadora.
      setEmittedCarrier(selectedRate?.carrier ?? null);
      setResult(g);
      clearDraft(`guide:${orderId}`);
      toast.success(`Guía ${g.number} generada`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      if (manual) qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo generar la guía'),
  });

  // Pendiente GLOBAL: cuenta la mutacion en vuelo aunque este panel se haya
  // remontado. "Hacer todo" (op-all) tambien genera guia -> tambien bloquea.
  const guideInFlight = useIsMutating({ mutationKey: ['op-guide', orderId] });
  const allInFlight = useIsMutating({ mutationKey: ['op-all', orderId] });
  const generating = guideInFlight > 0 || allInFlight > 0;

  // Si la guia la disparo una instancia YA desmontada, sus onSuccess no corren
  // aqui: al terminar (generating true->false) se refresca el preview.
  const wasBusy = useRef(generating);
  useEffect(() => {
    if (wasBusy.current && !generating) {
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
    }
    wasBusy.current = generating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-[22px]">
        {/* .notice-warn del mockup: mismo aviso ambar que el resto del drawer. */}
        <p className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {error instanceof ApiError ? error.message : 'No se pudo preparar la guía.'}
          </span>
        </p>
      </div>
    );
  }

  const emitted = result ?? preview?.guide ?? null;
  if (emitted)
    return <GuideDoneView orderId={orderId} guide={emitted} carrierName={emittedCarrier} />;
  if (!recipient || !pkg || !preview) return null;

  const sdx = courier === 'skydropx';

  /** Ciudad y departamento de destino VIGENTES en modo Skydropx: lo elegido
   *  manda, luego lo que salio en la cotizacion, y de base lo que el preview
   *  ya resolvio con el catalogo postal (por eso ambos campos arrancan llenos). */
  const sdxCityName =
    sdxCity?.name ||
    quotedCity?.name ||
    quote?.cityTo ||
    (recipient?.cityName ?? '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const sdxDepartment =
    sdxCity?.department ||
    quotedCity?.department ||
    quote?.departmentTo ||
    preview?.recipient.department ||
    '';

  const canGenerate =
    recipient.name.trim().length >= 2 &&
    recipient.document.trim().length >= 3 &&
    recipient.address.trim().length >= 3 &&
    recipient.cityCode.trim().length >= 4 &&
    recipient.phone.trim().length >= 5 &&
    Number(pkg.weight) > 0 &&
    pkg.content.trim().length >= 1 &&
    (!codOn || Number(codValue) > 0);

  // Cotizar solo exige el paquete completo; el CP puede resolverlo el server.
  const canQuote =
    Number(pkg.weight) > 0 &&
    Number(pkg.height) > 0 &&
    Number(pkg.width) > 0 &&
    Number(pkg.length) > 0;

  const canGenerateSdx =
    selectedRate !== null &&
    recipient.name.trim().length >= 2 &&
    recipient.address.trim().length >= 3 &&
    recipient.phone.trim().length >= 5 &&
    // CP *o* ciudad, no ambos: Skydropx acepta ciudad+departamento sin CP.
    (postalCodeTo.trim().length >= 4 || quotedCity !== null) &&
    Number(pkg.weight) > 0;

  const patchR = (p: Partial<Recipient>) => setRecipient((r) => (r ? { ...r, ...p } : r));
  const patchP = (p: Partial<Pkg>) => setPkg((v) => (v ? { ...v, ...p } : v));

  // Total mas bajo de la cotizacion vigente (solo para la pastilla "Más
  // barata" de la tarjeta de tarifa; puramente visual).
  const cheapestRateTotal =
    quote && quote.rates.length > 0 ? Math.min(...quote.rates.map((r) => r.total)) : null;

  return (
    <div className="p-[22px]">
      {/* Transportadora: Coordinadora (flujo directo, por defecto) o Skydropx
          (agregador: cotiza varias transportadoras y genera con la elegida). */}
      <div
        role="group"
        aria-label="Transportadora"
        className="mb-[18px] flex max-w-full flex-wrap gap-[3px] rounded-xl border border-border bg-wash p-[3px] sm:inline-flex"
      >
        <button
          type="button"
          onClick={() => setCourier('coordinadora')}
          aria-pressed={!sdx}
          className={cn(
            'inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-4 py-[7px] text-[13px] font-extrabold transition-colors sm:flex-none sm:justify-start max-md:min-h-[40px]',
            FOCUS_RING,
            !sdx ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground',
          )}
        >
          <CourierMark slug="coordinadora" />
          Coordinadora
        </button>
        <button
          type="button"
          onClick={() => setCourier('skydropx')}
          aria-pressed={sdx}
          className={cn(
            'inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-4 py-[7px] text-[13px] font-extrabold transition-colors sm:flex-none sm:justify-start max-md:min-h-[40px]',
            FOCUS_RING,
            sdx ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground',
          )}
        >
          <CourierMark slug="skydropx" />
          Skydropx
        </button>
      </div>

      {/* Remitente (de la sede) */}
      <section className="mb-5 rounded-[14px] border border-border bg-surface px-4 py-3.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
          Remitente (origen)
        </p>
        <p className="mt-0.5 break-words text-[13.5px] font-semibold">{preview.sender.name}</p>
        <p className="break-words text-xs text-hint">
          {preview.sender.address}
          {preview.sender.cityName ? ` · ${preview.sender.cityName}` : ''} · {preview.sender.phone}
        </p>
      </section>

      {/* En modo Skydropx, formulario y tarifas van a dos columnas cuando el
          PANEL da el ancho (la cotizacion es la columna derecha); si no, todo
          fluye en una sola columna. Mismo orden de DOM.
          OJO: el reparto NO puede depender del viewport — el drawer se
          redimensiona a mano, asi que un `min-[860px]` partia en dos columnas
          un panel de 560px. Con flex-wrap el corte lo decide el ANCHO REAL:
          las bases (480px + 340px + 20px de hueco) hacen que se apilen por
          debajo de ~840px de panel, y el factor de crecimiento gigante de la
          izquierda deja la columna de tarifas clavada en sus 340px. */}
      <div className={cn('mb-5', sdx ? 'flex flex-wrap items-start gap-5' : 'space-y-5')}>
        <div className={cn('space-y-5', sdx && 'min-w-0 flex-[999_1_480px]')}>
          {/* Destinatario (de VTEX, editable) */}
          <section className="space-y-2.5">
            <SectionTitle
              icon={MapPin}
              hint={sdx ? 'catálogo postal nacional' : 'llega listo del pedido — solo verifica'}
            >
              {sdx ? 'Destino' : 'Destinatario'}
            </SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre">
                <Input
                  value={recipient.name}
                  onChange={(e) => patchR({ name: e.target.value })}
                  className={INPUT_CLS}
                />
              </Field>
              {/* Documento en AMBOS modos (mismo estado). En Skydropx es solo
              informativo/registro: NO viaja en el payload de Skydropx. */}
              <Field label="Cédula / NIT">
                <Input
                  value={recipient.document}
                  onChange={(e) => patchR({ document: e.target.value })}
                  className={cn(INPUT_CLS, MONO_CLS)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Dirección">
                  <Input
                    value={recipient.address}
                    onChange={(e) => patchR({ address: e.target.value })}
                    className={INPUT_CLS}
                  />
                </Field>
              </div>
              {sdx ? (
                <>
                  {/* Ciudades del catalogo POSTAL nacional embebido, en el formato
                  que Skydropx pide (ciudad + departamento completo) —
                  independiente del catalogo de Coordinadora. Elegir una fija
                  tambien su codigo postal automaticamente. */}
                  <Field label="Ciudad">
                    <div className={CITY_TRIGGER_CLS}>
                      {/* Solo la ciudad: el departamento tiene su propio campo. */}
                      <CityPicker
                        value={sdxCityName}
                        onPick={(c: CoordinadoraCity) => {
                          setSdxCity({ name: c.name, department: c.department });
                          // CP automatico de la ciudad elegida (viene colado en el
                          // shape adaptado del catalogo postal).
                          const cp = (c as CoordinadoraCity & { postalCode?: string }).postalCode;
                          if (cp) setPostalCodeTo(cp);
                          // Las tarifas cotizadas son de otro destino -> re-cotizar.
                          setSelectedRateId(null);
                        }}
                        search={(q) =>
                          api
                            .get<SkydropxCity[]>(`/v1/skydropx/cities?q=${encodeURIComponent(q)}`)
                            // Al shape del picker; el DANE hace de key.
                            .then((rows) =>
                              rows.map((r) => ({
                                code: r.dane,
                                name: r.city,
                                department: r.department,
                                postalCode: r.postalCode,
                              })),
                            )
                        }
                        queryKey={`sdx-dest-${orderId}`}
                      />
                    </div>
                  </Field>
                  {/* Departamento: se llena SOLO con la ciudad (catalogo postal
                  nacional), igual que el CP. Skydropx lo pide como area_level1. */}
                  <Field label="Departamento">
                    <Input
                      readOnly
                      value={sdxDepartment}
                      className={cn(INPUT_CLS, 'cursor-default')}
                    />
                  </Field>
                  {/* Skydropx enruta por CP: llega YA resuelto en el preview (la
                  ciudad del pedido) y se actualiza al elegir otra ciudad.
                  Editable por si hay que corregirlo. */}
                  <Field label="Código postal">
                    <Input
                      inputMode="numeric"
                      placeholder="Ej: 110111"
                      maxLength={10}
                      className={cn(INPUT_CLS, MONO_CLS, 'tabular-nums')}
                      value={postalCodeTo}
                      onChange={(e) => setPostalCodeTo(e.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                  <Field label="Teléfono">
                    <Input
                      value={recipient.phone}
                      onChange={(e) => patchR({ phone: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Ciudad (DANE)">
                    <div
                      className={cn(
                        'relative',
                        CITY_TRIGGER_CLS,
                        recipient.cityCode ? '[&>div>button]:pr-20' : '',
                      )}
                    >
                      <CityPicker
                        value={recipient.cityName || recipient.cityCode}
                        onPick={(c: CoordinadoraCity) =>
                          patchR({ cityCode: c.code, cityName: `${c.name} — ${c.department}` })
                        }
                        search={(q) =>
                          api.get<CoordinadoraCity[]>(
                            `/v1/orders/${orderId}/guide-cities?q=${encodeURIComponent(q)}`,
                          )
                        }
                        queryKey={`dest-${orderId}`}
                      />
                      {recipient.cityCode ? (
                        <span className={cn(SUFFIX_CLS, MONO_CLS)} aria-hidden>
                          {recipient.cityCode}
                        </span>
                      ) : null}
                    </div>
                  </Field>
                  <Field label="Teléfono">
                    <Input
                      value={recipient.phone}
                      onChange={(e) => patchR({ phone: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </Field>
                </>
              )}
            </div>
            {!sdx && !recipient.cityCode ? (
              <p className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  No se reconoció la ciudad de VTEX — selecciona la ciudad de destino.
                </span>
              </p>
            ) : null}
          </section>

          {/* Paquete */}
          <section className="space-y-2.5">
            <SectionTitle
              icon={Package}
              hint={
                sdx ? 'tus paquetes del panel de Skydropx' : 'paquetes de guía globales (Ajustes)'
              }
            >
              Paquete
            </SectionTitle>
            {sdx && sdxPresets.length > 0 ? (
              /* Los paquetes PROPIOS del modo Skydropx (se gestionan en Ajustes >
              Paquetes Skydropx): elegirlo llena medidas, peso y — si el
              preset los trae del panel de Skydropx — contenido y embalaje.
              Aqui va DESPLEGABLE y no en chips como Coordinadora: son decenas
              (los del panel de Skydropx) y en chips inundan el panel. */
              <Field label="Paquete guardado">
                <div className="relative">
                  <select
                    value={sdxPresetName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setSdxPresetName(name);
                      const p = sdxPresets.find((x) => x.name === name);
                      if (!p) return; // "Personalizado": no toca las medidas
                      patchP({
                        weight: String(p.weight),
                        height: String(p.height),
                        width: String(p.width),
                        length: String(p.length),
                        ...(p.content ? { content: p.content } : {}),
                      });
                      if (p.packagingCode) setPackagingCode(p.packagingCode);
                    }}
                    className={SELECT_CLS}
                  >
                    <option value="">Personalizado</option>
                    {sdxPresets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} · {p.height}×{p.width}×{p.length} cm · {p.weight} kg
                      </option>
                    ))}
                  </select>
                  <span className={SUFFIX_CLS} aria-hidden>
                    ▾
                  </span>
                </div>
              </Field>
            ) : null}
            {sdx ? (
              /* Embalaje del catalogo de Skydropx (los presets generales de paquete
             son de Coordinadora y en este modo NO aplican). */
              <Field label="Embalaje">
                {packagingsError ? (
                  <p className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {packagingsError instanceof ApiError
                        ? packagingsError.message
                        : 'No se pudo cargar el catálogo de embalajes de Skydropx.'}
                    </span>
                  </p>
                ) : (
                  <div className="relative">
                    <select
                      value={packagingCode}
                      onChange={(e) => setPackagingCode(e.target.value)}
                      disabled={packagingsPending}
                      className={SELECT_CLS}
                    >
                      {packagingsPending ? (
                        <option value={packagingCode}>Cargando embalajes…</option>
                      ) : (
                        <>
                          {/* Borrador viejo con un codigo que ya no esta en el catalogo. */}
                          {!(packagings ?? []).some((p) => p.code === packagingCode) ? (
                            <option value={packagingCode}>{packagingCode}</option>
                          ) : null}
                          {/* El codigo del catalogo (4G, 5H4…) va en la
                              etiqueta: un <option> nativo no admite el sufijo
                              en monoespaciada que dibuja el mockup. */}
                          {(packagings ?? []).map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name} · {p.code}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                    <span className={SUFFIX_CLS} aria-hidden>
                      ▾
                    </span>
                  </div>
                )}
              </Field>
            ) : preview.packagePresets.length > 0 ? (
              /* Igual que los "empaques" del portal de Coordinadora: elegirlo llena
              peso y medidas (despues se pueden ajustar a mano). */
              <PresetChips label="Paquete guardado">
                {preview.packagePresets.map((p) => (
                  <PresetChip
                    key={p.name}
                    active={presetName === p.name}
                    onClick={() => {
                      // Como el <select> al que reemplaza: solo aplica al
                      // CAMBIAR. Re-pulsar el activo no pisa lo editado a mano.
                      if (presetName === p.name) return;
                      setPresetName(p.name);
                      patchP({
                        weight: String(p.weight),
                        height: String(p.height),
                        width: String(p.width),
                        length: String(p.length),
                      });
                    }}
                  >
                    {p.name} · {p.height}×{p.width}×{p.length} · {p.weight} kg
                  </PresetChip>
                ))}
                <PresetChip active={presetName === ''} onClick={() => setPresetName('')}>
                  Personalizado
                </PresetChip>
              </PresetChips>
            ) : null}
            {/* Medidas: mismo orden del mockup (Alto · Ancho · Largo · Peso). */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field label="Alto">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={pkg.height}
                    onChange={(e) => patchP({ height: e.target.value.replace(/[^\d.]/g, '') })}
                    className={cn(INPUT_CLS, 'pr-9 tabular-nums')}
                  />
                  <span className={SUFFIX_CLS} aria-hidden>
                    cm
                  </span>
                </div>
              </Field>
              <Field label="Ancho">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={pkg.width}
                    onChange={(e) => patchP({ width: e.target.value.replace(/[^\d.]/g, '') })}
                    className={cn(INPUT_CLS, 'pr-9 tabular-nums')}
                  />
                  <span className={SUFFIX_CLS} aria-hidden>
                    cm
                  </span>
                </div>
              </Field>
              <Field label="Largo">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={pkg.length}
                    onChange={(e) => patchP({ length: e.target.value.replace(/[^\d.]/g, '') })}
                    className={cn(INPUT_CLS, 'pr-9 tabular-nums')}
                  />
                  <span className={SUFFIX_CLS} aria-hidden>
                    cm
                  </span>
                </div>
              </Field>
              <Field label="Peso">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={pkg.weight}
                    onChange={(e) => patchP({ weight: e.target.value.replace(/[^\d.]/g, '') })}
                    className={cn(INPUT_CLS, 'pr-9 tabular-nums')}
                  />
                  <span className={SUFFIX_CLS} aria-hidden>
                    kg
                  </span>
                </div>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contenido">
                <Input
                  value={pkg.content}
                  onChange={(e) => patchP({ content: e.target.value })}
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Valor declarado">
                <div className="relative">
                  <Input
                    inputMode="numeric"
                    value={pkg.declaredValue}
                    onChange={(e) =>
                      patchP({ declaredValue: e.target.value.replace(/[^\d.]/g, '') })
                    }
                    className={cn(INPUT_CLS, 'tabular-nums', !sdx ? 'pr-[116px]' : '')}
                  />
                  {!sdx ? (
                    <span className={SUFFIX_CLS} aria-hidden>
                      mitad de la compra
                    </span>
                  ) : null}
                </div>
              </Field>
            </div>
            {!sdx ? (
              <Field label="Observaciones">
                <Input
                  value={pkg.observations}
                  placeholder="Aparece en la guía de Coordinadora; vacío = sin observaciones"
                  maxLength={300}
                  onChange={(e) => patchP({ observations: e.target.value })}
                  className={INPUT_CLS}
                />
              </Field>
            ) : null}
            {!sdx ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="w-24">
                  <Field label="Unidades">
                    <Input
                      inputMode="numeric"
                      value={pkg.units}
                      onChange={(e) => patchP({ units: e.target.value.replace(/\D/g, '') })}
                      className={cn(INPUT_CLS, 'tabular-nums')}
                    />
                  </Field>
                </div>
                <Field label="Formato de rótulo">
                  <div className="relative">
                    <select
                      value={rotuloId ?? ''}
                      onChange={(e) => setRotuloId(Number(e.target.value))}
                      className={SELECT_CLS}
                    >
                      {coordinadoraRotuloOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className={SUFFIX_CLS} aria-hidden>
                      ▾
                    </span>
                  </div>
                </Field>
              </div>
            ) : null}
          </section>
        </div>

        {sdx ? (
          /* Cotizacion Skydropx: todas las transportadoras disponibles para la
           ruta, como tarjetas seleccionables (ya vienen ordenadas por precio). */
          <section className="min-w-0 flex-[1_1_340px] space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-extrabold">
              <Zap className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              Selección de transportadora
              {quote && quote.rates.length > 0 ? (
                <span className="ml-auto text-[11px] font-semibold text-hint">
                  {quote.rates.length} disponibles
                </span>
              ) : null}
            </div>
            <Button
              variant="ghost"
              onClick={() => quoteMutation.mutate(sdxCity)}
              loading={quoteMutation.isPending}
              disabled={!canQuote || quoteMutation.isPending}
              className={BTN_GHOST_CLS}
            >
              Cotizar transportadoras
            </Button>
            {quote ? (
              quote.rates.length === 0 ? (
                <div className="rounded-[15px] border border-dashed border-input bg-surface px-4 py-8 text-center">
                  <Truck className="mx-auto h-5 w-5 text-hint" />
                  <p className="mt-2 text-[13.5px] font-extrabold">
                    Ninguna transportadora disponible para esta ruta
                  </p>
                  <p className="mt-0.5 text-xs text-hint">
                    Revisa el código postal de destino o ajusta las medidas del paquete.
                  </p>
                </div>
              ) : (
                /* pt para que la pastilla flotante (-top-2) de la primera tarjeta
                 no se monte sobre el boton de cotizar. */
                <div className="space-y-2.5 pt-1.5">
                  {quote.rates.map((r) => (
                    <RateCard
                      key={r.id}
                      rate={r}
                      selected={r.id === selectedRateId}
                      cheapest={r.total === cheapestRateTotal}
                      onSelect={() => setSelectedRateId(r.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              <p className="text-xs text-hint">
                Cotiza para ver las transportadoras disponibles con precio y tiempo de entrega.
              </p>
            )}
          </section>
        ) : (
          /* Recaudo contraentrega: para TODOS los pedidos (manuales y de
           marketplace). Coordinadora cobra el valor al entregar. NO aplica en
           modo Skydropx. */
          <section className="space-y-2.5">
            <SectionTitle icon={CreditCard} tone="success">
              Cobro del envío
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-surface px-4 py-3.5">
              <button
                type="button"
                onClick={() => setCodOn(!codOn)}
                aria-pressed={codOn}
                className={cn(
                  'inline-flex items-center gap-2.5 rounded-[10px] max-md:min-h-[40px]',
                  FOCUS_RING,
                )}
              >
                <span
                  className={cn(
                    'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors motion-reduce:transition-none',
                    codOn ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-input',
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-[left] motion-reduce:transition-none',
                      codOn ? 'left-[19px]' : 'left-[3px]',
                    )}
                  />
                </span>
                <b className="text-[13px]">Recaudo contraentrega</b>
              </button>
              {codOn ? (
                <div className="min-w-[min(100%,200px)] flex-1">
                  <div className="relative max-w-[200px]">
                    <Input
                      inputMode="numeric"
                      aria-label="Valor a recaudar"
                      value={codValue}
                      onChange={(e) => setCodValue(e.target.value.replace(/[^\d.]/g, ''))}
                      className={cn(INPUT_CLS, 'pr-[76px] tabular-nums')}
                    />
                    <span className={SUFFIX_CLS} aria-hidden>
                      a recaudar
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-hint">
                    Si hubo un abono inicial, pon aquí solo lo que falta por cobrar.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={() => (sdx ? generateSkydropx.mutate() : generate.mutate())}
          loading={generating}
          disabled={(sdx ? !canGenerateSdx : !canGenerate) || generating}
          className={BTN_PRIMARY_CLS}
        >
          <Truck />
          {sdx ? (
            selectedRate ? (
              <>
                Generar guía · {selectedRate.carrier}{' '}
                <span className="tabular-nums">{formatCOP(selectedRate.total)}</span>
              </>
            ) : (
              'Generar guía'
            )
          ) : (
            /* El modo Skydropx nombra su transportadora: el directo tambien. */
            'Generar guía Coordinadora'
          )}
        </Button>
        {sdx && quote ? (
          <Button
            variant="ghost"
            onClick={() => quoteMutation.mutate(sdxCity)}
            loading={quoteMutation.isPending}
            disabled={!canQuote || quoteMutation.isPending}
            className={BTN_GHOST_CLS}
          >
            Cotizar de nuevo
          </Button>
        ) : null}
        <p className="min-w-[min(100%,220px)] flex-1 text-xs leading-[1.45] text-hint">
          {sdx ? (
            <>
              Mismo cierre: <b className="text-muted-foreground">rótulo al chat</b>,{' '}
              <b className="text-muted-foreground">WhatsApp</b>,{' '}
              <b className="text-muted-foreground">VTEX</b> — sin importar la transportadora.
            </>
          ) : (
            <>
              Después: <b className="text-muted-foreground">rótulo al chat</b> →{' '}
              <b className="text-muted-foreground">guía por WhatsApp</b> →{' '}
              <b className="text-muted-foreground">cierre en VTEX</b>. Todo solo.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Colores de marca por transportadora (cuadrito con la inicial, como en la UI
 * de Skydropx). Slugs desconocidos caen al gris neutro.
 */
const CARRIER_BRAND_COLORS: Record<string, string> = {
  coordinadora: '#1d4ed8',
  servientrega: '#16a34a',
  interrapidisimo: '#111827',
  envia: '#dc2626',
  '99minutes': '#7c3aed',
};

/** Transportadoras con logo real en /public/carriers/<code>.webp (cuadrado
 *  256x256 con el fondo PROPIO del logo horneado: cubre el 100% del chip);
 *  las demas caen a la inicial con color de marca. */
const CARRIER_LOGOS = new Set(['coordinadora', 'servientrega', 'interrapidisimo', 'envia']);

/**
 * Marca chiquita para el selector de transportadora (18px). Los logos son
 * baldosas cuadradas con SU fondo horneado, asi que el de Coordinadora es azul
 * sobre BLANCO: sin un borde de pelo se perderia contra el boton activo (que
 * tambien es blanco). El borde se lo da la baldosa, no el logo.
 */
function CourierMark({ slug }: { slug: 'coordinadora' | 'skydropx' }) {
  return (
    <span
      className="block h-[18px] w-[18px] shrink-0 overflow-hidden rounded-[5px] ring-1 ring-inset ring-border"
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/carriers/${slug}.webp`} alt="" className="h-full w-full object-cover" />
    </span>
  );
}

/** Chip de transportadora: logo real si lo hay, inicial de color si no. */
function CarrierChip({
  code,
  name,
  size = 'h-10 w-10',
}: {
  code: string;
  name: string;
  size?: string;
}) {
  const slug = code.trim().toLowerCase();
  if (CARRIER_LOGOS.has(slug)) {
    return (
      <span className={cn('block shrink-0 overflow-hidden rounded-lg', size)} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/carriers/${slug}.webp`} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg text-base font-bold text-white',
        size,
      )}
      style={{ backgroundColor: CARRIER_BRAND_COLORS[slug] ?? '#64748b' }}
      aria-hidden
    >
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  );
}

/** Tarjeta de tarifa Skydropx, seleccionable como una radio card. */
function RateCard({
  rate,
  selected,
  cheapest = false,
  onSelect,
}: {
  rate: SkydropxRate;
  selected: boolean;
  /** Tarifa mas barata de la cotizacion (pastilla verde; se oculta al elegirla). */
  cheapest?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative w-full rounded-[15px] border bg-surface px-[15px] py-[13px] text-left',
        // Solo lo que anima el mockup (.rate): el degradado del estado elegido
        // aparece de golpe, como alli.
        // duration-[130ms] es AMBIGUA para Tailwind (tailwindcss-animate añade
        // su propio duration-*) y no emite nada: va como propiedad literal.
        'transition-[border-color,box-shadow,transform] [transition-duration:130ms]',
        'hover:-translate-y-px hover:border-accent',
        FOCUS_RING,
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        selected
          ? 'border-accent bg-gradient-to-b from-accent/[0.06] to-surface shadow-[0_10px_26px_-10px_hsl(var(--accent)/0.35)] ring-1 ring-accent'
          : 'border-border hover:shadow-card',
      )}
    >
      {selected ? (
        <span className="absolute -top-2 right-3.5 rounded-full bg-accent px-[9px] py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-accent-foreground">
          Elegida
        </span>
      ) : cheapest ? (
        <span className="absolute -top-2 right-3.5 rounded-full bg-emerald-600 px-[9px] py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-white dark:bg-emerald-500">
          Más barata
        </span>
      ) : null}
      <div className="flex items-center gap-[11px]">
        <CarrierChip code={rate.carrierCode} name={rate.carrier} size="h-10 w-10 rounded-[11px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold tracking-[-0.01em]">{rate.carrier}</p>
          {rate.service ? (
            <p className="truncate text-[11.5px] font-semibold text-hint">{rate.service}</p>
          ) : null}
        </div>
        {/* Indicador tipo radio (espejo de aria-pressed, solo decorativo). */}
        <span
          className={cn(
            'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
            selected ? 'border-accent bg-accent' : 'border-input',
          )}
          aria-hidden
        >
          {selected ? <span className="h-[7px] w-[7px] rounded-full bg-white" /> : null}
        </span>
      </div>
      <p className="mt-[9px] flex items-center gap-[7px] text-[11.5px] font-semibold text-muted-foreground">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" aria-hidden />
        Recepción · {rate.pickup ? 'Con recolección' : 'Llevar a oficina'}
      </p>
      <p className="mt-[9px] flex items-center gap-[7px] text-[11.5px] font-semibold text-muted-foreground">
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full border-2 border-accent bg-card"
          aria-hidden
        />
        Entrega · {rate.officeDelivery ? 'Domicilio + Sucursal' : 'Domicilio'}
      </p>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-1 border-t border-dashed border-input pt-2.5">
        {rate.days !== null ? (
          <p className="min-w-0 text-[11.5px] font-bold text-muted-foreground">
            Tiempo estimado ·{' '}
            <b className="text-foreground">
              {rate.days} {rate.days === 1 ? 'día hábil' : 'días hábiles'}
            </b>
          </p>
        ) : null}
        <p className="ml-auto shrink-0 text-[19px] font-extrabold tabular-nums tracking-[-0.02em]">
          {formatCOP(rate.total)}
        </p>
      </div>
    </button>
  );
}

/**
 * Rastreo del pedido. Hook compartido entre la tarjeta de exito y el timeline:
 * misma queryKey -> una sola peticion (React Query dedup) y ambos ven la
 * transportadora real aunque el panel se haya remontado.
 */
function useOrderTracking(orderId: string) {
  return useQuery({
    queryKey: ['order-tracking', orderId],
    queryFn: () => api.get<GuideTracking | null>(`/v1/orders/${orderId}/tracking`),
    staleTime: 60_000,
  });
}

function GuideDoneView({
  orderId,
  guide,
  carrierName,
}: {
  orderId: string;
  guide: Guide;
  /** Transportadora recien emitida (Skydropx); null = Coordinadora o remonte. */
  carrierName?: string | null;
}) {
  const { data: tracking } = useOrderTracking(orderId);
  const carrier = tracking?.carrier ?? carrierName ?? 'Coordinadora';
  const isCoordinadora = carrier.toLowerCase().includes('coordinadora');
  return (
    <div className="space-y-4 p-[22px]">
      <div className="rounded-[12px] bg-emerald-500/10 px-3.5 py-3 text-center text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="mx-auto h-7 w-7" />
        <h3 className="mt-2 break-words text-[13.5px] font-extrabold">
          Guía <span className={cn(MONO_CLS, 'break-all')}>{guide.number}</span> generada
        </h3>
        <p className="mt-0.5 flex flex-wrap items-center justify-center gap-1.5 text-[12.5px] font-semibold text-emerald-600/90 dark:text-emerald-400/90">
          <Package className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{carrier}</span>
        </p>
      </div>

      <TrackingTimeline orderId={orderId} />

      <p className="text-center text-xs text-hint">
        {isCoordinadora
          ? 'El rótulo está en la conversación. Para generar otra guía, anúlala primero en Coordinadora.'
          : `La guía está en la conversación. Para generar otra, anúlala primero en ${carrier}.`}
      </p>
    </div>
  );
}

/** Seguimiento detallado del envio (rastreo): estado, novedades y timeline. */
function TrackingTimeline({ orderId }: { orderId: string }) {
  const { data, isLoading, isFetching, refetch, error } = useOrderTracking(orderId);

  const delivered = Boolean(data?.fechaEntrega?.trim());
  const hasMovements = (data?.estados.length ?? 0) > 0;

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
        <h4 className="flex min-w-0 items-center gap-2.5 text-sm font-extrabold tracking-[-0.01em]">
          <span
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-wash text-accent"
            aria-hidden
          >
            <Truck className="h-4 w-4" />
          </span>
          <span className="min-w-0 break-words">Seguimiento del envío</span>
        </h4>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {data?.trackingUrl ? (
            <a
              href={data.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{data.carrier ?? 'Coordinadora'}</span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => refetch()}
            className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-hint transition-colors hover:text-accent max-md:h-10 max-md:w-10"
            aria-label="Actualizar seguimiento"
            title="Actualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="px-4 py-3.5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <p className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
            <span className="min-w-0 break-words">No se pudo consultar el seguimiento.</span>
          </p>
        ) : !data ? (
          <p className="text-[13.5px] text-muted-foreground">
            Este pedido aún no tiene guía para rastrear.
          </p>
        ) : (
          <>
            {/* Con Skydropx el envio puede salir por CUALQUIER transportadora:
                dejarla siempre visible junto al estado, con su logo. El
                rastreo trae el NOMBRE ("Interrapidísimo") -> normalizar a slug. */}
            {data.carrier ? (
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-[3px] text-[11.5px] font-bold text-accent-ink">
                <CarrierChip
                  code={data.carrier
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/\p{Diacritic}/gu, '')
                    .replace(/[^a-z0-9]/g, '')}
                  name={data.carrier}
                  size="h-4 w-4 rounded text-[9px]"
                />
                Enviado por <span className="font-semibold">{data.carrier}</span>
              </p>
            ) : null}

            {delivered ? (
              <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-emerald-500/10 px-3.5 py-[11px] text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">
                  Entregado {data.fechaEntrega}
                  {data.horaEntrega ? ` · ${data.horaEntrega}` : ''}
                </span>
              </div>
            ) : data.descripcionEstado ? (
              <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-wash px-3.5 py-[11px] text-[12.5px] font-semibold text-accent-ink">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{data.descripcionEstado}</span>
              </div>
            ) : null}

            {data.novedades.length > 0 ? (
              <div className="mb-3 space-y-1.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px]">
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Novedades
                </p>
                {data.novedades.map((n, i) => (
                  <p key={i} className="break-words text-[12.5px]">
                    {n.descripcion}
                    <span className="text-hint">
                      {n.fecha ? ` · ${n.fecha}` : ''}
                      {n.hora ? ` ${n.hora}` : ''}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}

            {hasMovements ? (
              <ol>
                {data.estados.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-input'}`}
                      />
                      {i < data.estados.length - 1 ? (
                        <span className="my-0.5 w-px flex-1 bg-input" />
                      ) : null}
                    </div>
                    <div className="min-w-0 pb-3">
                      <p className="break-words text-[13.5px] leading-snug">{e.descripcion}</p>
                      <p className="text-[11px] text-hint">
                        {e.fecha}
                        {e.hora ? ` · ${e.hora}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">
                Aún sin movimientos registrados. La transportadora los actualiza al recoger y mover
                el paquete.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatCOP(value: number): string {
  if (Number.isNaN(value)) return '$0';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toLocaleString('es-CO')}`;
  }
}

/** Cabecera de seccion (patron Cobalto): chip de icono tintado + titulo, con
 *  pista opcional a la derecha. tone="success" = chip esmeralda (cobros). */
function SectionTitle({
  icon: Icon,
  tone = 'accent',
  hint,
  children,
}: {
  icon?: LucideIcon;
  tone?: 'accent' | 'success';
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    /* flex-wrap: en un panel angosto la pista salta a su propia linea en vez de
       estrujar (o desbordar) el titulo. */
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {Icon ? (
        <span
          className={cn(
            'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]',
            tone === 'success'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-wash text-accent',
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">{children}</h3>
      {hint ? (
        <span className="ml-auto min-w-0 break-words text-right text-xs text-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** Fila de pastillas del mockup (.preset-chips). Como el control es un GRUPO de
 *  botones (no un campo), el micro-rotulo no es un <label> suelto: da su nombre
 *  accesible al grupo. */
function PresetChips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-[5px]">
      <p className="break-words text-[11px] font-bold uppercase leading-[1.35] tracking-[0.06em] text-hint">
        {label}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** Pastilla de preset (.preset): al pulsarla queda con borde y texto cobalto
 *  sobre el lavado del acento. */
function PresetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-w-0 max-w-full break-words rounded-[10px] border px-[13px] py-[7px] text-left text-[12.5px] font-bold transition-colors motion-reduce:transition-none max-md:min-h-[40px]',
        FOCUS_RING,
        active
          ? 'border-accent bg-wash text-accent-ink'
          : 'border-input bg-card text-muted-foreground hover:border-accent hover:text-accent',
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-[5px]">
      <Label className="block break-words text-[11px] font-bold uppercase leading-[1.35] tracking-[0.06em] text-hint">
        {label}
      </Label>
      {children}
    </div>
  );
}
