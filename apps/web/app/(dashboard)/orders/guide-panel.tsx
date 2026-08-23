'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Truck,
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
  }, [recipient, pkg, rotuloId, codOn, codValue, courier, postalCodeTo, packagingCode, sdxCity, orderId]);

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
      toast.success(`Guia ${g.number} generada`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      // Montado a mano: con factura + guia el pedido queda COMPLETO -> cambia
      // de seccion en la lista de la sede.
      if (manual) qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo generar la guia'),
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
        packageContent: pkg!.content.trim() || 'CELULAR',
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
      toast.success(`Guia ${g.number} generada`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      if (manual) qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo generar la guia'),
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
      <div className="flex justify-center py-10">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-5">
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : 'No se pudo preparar la guia.'}
        </p>
      </div>
    );
  }

  const emitted = result ?? preview?.guide ?? null;
  if (emitted) return <GuideDoneView orderId={orderId} guide={emitted} carrierName={emittedCarrier} />;
  if (!recipient || !pkg || !preview) return null;

  const sdx = courier === 'skydropx';

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

  return (
    <div className="space-y-5 p-5">
      {/* Transportadora: Coordinadora (flujo directo, por defecto) o Skydropx
          (agregador: cotiza varias transportadoras y genera con la elegida). */}
      <section className="space-y-3">
        <SectionTitle>Transportadora</SectionTitle>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setCourier('coordinadora')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !sdx ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Coordinadora
          </button>
          <button
            type="button"
            onClick={() => setCourier('skydropx')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sdx ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Skydropx
          </button>
        </div>
      </section>

      {/* Remitente (de la sede) */}
      <section className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Remitente (origen)</p>
        <p className="mt-0.5 font-medium">{preview.sender.name}</p>
        <p className="text-xs text-muted-foreground">
          {preview.sender.address}
          {preview.sender.cityName ? ` · ${preview.sender.cityName}` : ''} · {preview.sender.phone}
        </p>
      </section>

      {/* Destinatario (de VTEX, editable) */}
      <section className="space-y-3">
        <SectionTitle>Destinatario</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <Input value={recipient.name} onChange={(e) => patchR({ name: e.target.value })} />
          </Field>
          {/* Documento en AMBOS modos (mismo estado). En Skydropx es solo
              informativo/registro: NO viaja en el payload de Skydropx. */}
          <Field label="Documento (cedula/NIT)">
            <Input value={recipient.document} onChange={(e) => patchR({ document: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Direccion">
              <Input value={recipient.address} onChange={(e) => patchR({ address: e.target.value })} />
            </Field>
          </div>
          {sdx ? (
            <>
              {/* Ciudades del catalogo POSTAL nacional embebido, en el formato
                  que Skydropx pide (ciudad + departamento completo) —
                  independiente del catalogo de Coordinadora. Elegir una fija
                  tambien su codigo postal automaticamente. */}
              <Field label="Ciudad de destino">
                <CityPicker
                  value={
                    sdxCity
                      ? `${sdxCity.name} — ${sdxCity.department}`
                      : quotedCity
                        ? `${quotedCity.name} — ${quotedCity.department}`
                        : // Sin eleccion ni cotizacion: la ciudad YA resuelta del
                          // preview (la misma automatica del modo Coordinadora).
                          quote?.cityTo ||
                          (recipient?.cityName ?? '').replace(/\s*\(.*?\)\s*/g, '').trim()
                  }
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
              </Field>
              {/* Skydropx enruta por CP: se asigna SOLO segun la ciudad (al
                  elegirla o al cotizar, del catalogo postal nacional). Queda
                  editable por si hay que corregirlo. */}
              <Field label="Codigo postal destino">
                <Input
                  inputMode="numeric"
                  placeholder="Automático"
                  maxLength={10}
                  className="w-32 tabular-nums"
                  value={postalCodeTo}
                  onChange={(e) => setPostalCodeTo(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label="Telefono">
                <Input value={recipient.phone} onChange={(e) => patchR({ phone: e.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Ciudad de destino">
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
              </Field>
              <Field label="Telefono">
                <Input value={recipient.phone} onChange={(e) => patchR({ phone: e.target.value })} />
              </Field>
            </>
          )}
        </div>
        {sdx ? (
          <p className="text-[11px] text-muted-foreground">
            El código postal se pone solo según la ciudad del pedido (catálogo postal nacional); si
            eliges otra ciudad, se actualiza con ella.
          </p>
        ) : !recipient.cityCode ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No se reconocio la ciudad de VTEX — selecciona la ciudad de destino.
          </p>
        ) : null}
      </section>

      {/* Paquete */}
      <section className="space-y-3">
        <SectionTitle>Paquete</SectionTitle>
        {sdx && sdxPresets.length > 0 ? (
          <Field label="Paquete guardado (Skydropx)">
            {/* Los paquetes PROPIOS del modo Skydropx (se gestionan en Ajustes >
                Paquetes Skydropx): elegirlo llena medidas, peso y — si el
                preset los trae del panel de Skydropx — contenido y embalaje. */}
            <select
              defaultValue=""
              onChange={(e) => {
                const p = sdxPresets.find((x) => x.name === e.target.value);
                if (p) {
                  patchP({
                    weight: String(p.weight),
                    height: String(p.height),
                    width: String(p.width),
                    length: String(p.length),
                    ...(p.content ? { content: p.content } : {}),
                  });
                  if (p.packagingCode) setPackagingCode(p.packagingCode);
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">— Personalizado —</option>
              {sdxPresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {p.height}x{p.width}x{p.length} cm · {p.weight} kg
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {sdx ? (
          /* Embalaje del catalogo de Skydropx (los presets generales de paquete
             son de Coordinadora y en este modo NO aplican). */
          <Field label="Embalaje (Skydropx)">
            {packagingsError ? (
              <p className="text-xs text-muted-foreground">
                {packagingsError instanceof ApiError
                  ? packagingsError.message
                  : 'No se pudo cargar el catálogo de embalajes de Skydropx.'}
              </p>
            ) : (
              <select
                value={packagingCode}
                onChange={(e) => setPackagingCode(e.target.value)}
                disabled={packagingsPending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {packagingsPending ? (
                  <option value={packagingCode}>Cargando embalajes…</option>
                ) : (
                  <>
                    {/* Borrador viejo con un codigo que ya no esta en el catalogo. */}
                    {!(packagings ?? []).some((p) => p.code === packagingCode) ? (
                      <option value={packagingCode}>{packagingCode}</option>
                    ) : null}
                    {(packagings ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            )}
          </Field>
        ) : preview.packagePresets.length > 0 ? (
          <Field label="Paquete guardado">
            {/* Igual que los "empaques" del portal de Coordinadora: elegirlo llena
                peso y medidas (despues se pueden ajustar a mano). */}
            <select
              defaultValue=""
              onChange={(e) => {
                const p = preview.packagePresets.find((x) => x.name === e.target.value);
                if (p) {
                  patchP({
                    weight: String(p.weight),
                    height: String(p.height),
                    width: String(p.width),
                    length: String(p.length),
                  });
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">— Personalizado —</option>
              {preview.packagePresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {p.height}x{p.width}x{p.length} cm · {p.weight} kg
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contenido">
            <Input value={pkg.content} onChange={(e) => patchP({ content: e.target.value })} />
          </Field>
          <Field label="Valor declarado (COP) — por defecto, la mitad de la compra">
            <Input
              inputMode="numeric"
              value={pkg.declaredValue}
              onChange={(e) => patchP({ declaredValue: e.target.value.replace(/[^\d.]/g, '') })}
            />
          </Field>
        </div>
        {!sdx ? (
          <Field label="Observaciones (opcional)">
            <Input
              value={pkg.observations}
              placeholder="Aparece en la guía de Coordinadora; vacío = sin observaciones"
              maxLength={300}
              onChange={(e) => patchP({ observations: e.target.value })}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Peso (kg)">
            <Input inputMode="decimal" value={pkg.weight} onChange={(e) => patchP({ weight: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Alto (cm)">
            <Input inputMode="decimal" value={pkg.height} onChange={(e) => patchP({ height: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Ancho (cm)">
            <Input inputMode="decimal" value={pkg.width} onChange={(e) => patchP({ width: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Largo (cm)">
            <Input inputMode="decimal" value={pkg.length} onChange={(e) => patchP({ length: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
        </div>
        {!sdx ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="w-24">
              <Field label="Unidades">
                <Input inputMode="numeric" value={pkg.units} onChange={(e) => patchP({ units: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
            <Field label="Formato de rotulo">
              <select
                value={rotuloId ?? ''}
                onChange={(e) => setRotuloId(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {coordinadoraRotuloOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
      </section>

      {sdx ? (
        /* Cotizacion Skydropx: todas las transportadoras disponibles para la
           ruta, como tarjetas seleccionables (ya vienen ordenadas por precio). */
        <section className="space-y-3">
          <SectionTitle>Tarifas</SectionTitle>
          <Button
            variant="outline"
            onClick={() => quoteMutation.mutate(sdxCity)}
            loading={quoteMutation.isPending}
            disabled={!canQuote || quoteMutation.isPending}
          >
            Cotizar transportadoras
          </Button>
          {quote ? (
            quote.rates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
                <Truck className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Ninguna transportadora disponible para esta ruta</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Revisa el código postal de destino o ajusta las medidas del paquete.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {quote.rates.map((r) => (
                  <RateCard
                    key={r.id}
                    rate={r}
                    selected={r.id === selectedRateId}
                    onSelect={() => setSelectedRateId(r.id)}
                  />
                ))}
              </div>
            )
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Cotiza para ver las transportadoras disponibles con precio y tiempo de entrega.
            </p>
          )}
        </section>
      ) : (
        /* Recaudo contraentrega: para TODOS los pedidos (manuales y de
           marketplace). Coordinadora cobra el valor al entregar. NO aplica en
           modo Skydropx. */
        <section className="space-y-3">
          <SectionTitle>Cobro del envio</SectionTitle>
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setCodOn(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                !codOn ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Normal (ya pagado)
            </button>
            <button
              type="button"
              onClick={() => setCodOn(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                codOn ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Recaudo contraentrega
            </button>
          </div>
          {codOn ? (
            <div className="max-w-xs">
              <Field label="Valor a recaudar (COP) — lo cobra Coordinadora al entregar">
                <Input
                  inputMode="numeric"
                  value={codValue}
                  onChange={(e) => setCodValue(e.target.value.replace(/[^\d.]/g, ''))}
                  className="tabular-nums"
                />
              </Field>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Si hubo un abono inicial, pon aqui solo lo que falta por cobrar.
              </p>
            </div>
          ) : null}
        </section>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <p className="text-[11px] text-muted-foreground">
          {sdx ? (
            selectedRate ? (
              <>
                Saldrá por <b className="text-foreground/80">{selectedRate.carrier}</b> ·{' '}
                {formatCOP(selectedRate.total)}
              </>
            ) : (
              'Cotiza y elige una tarifa para generar la guía.'
            )
          ) : (
            'El rotulo se adjunta al chat al generar la guia.'
          )}
        </p>
        <Button
          onClick={() => (sdx ? generateSkydropx.mutate() : generate.mutate())}
          loading={generating}
          disabled={(sdx ? !canGenerateSdx : !canGenerate) || generating}
        >
          <Truck className="h-4 w-4" />
          Generar guia
        </Button>
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

/** Tarjeta de tarifa Skydropx, seleccionable como una radio card. */
function RateCard({
  rate,
  selected,
  onSelect,
}: {
  rate: SkydropxRate;
  selected: boolean;
  onSelect: () => void;
}) {
  const brand = CARRIER_BRAND_COLORS[rate.carrierCode.toLowerCase()] ?? '#64748b';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-xl border bg-card p-3 text-left transition-colors',
        selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-accent/40',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white"
          style={{ backgroundColor: brand }}
          aria-hidden
        >
          {(rate.carrier.trim().charAt(0) || '?').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="font-semibold">{rate.carrier}</span>
            {rate.service ? <span className="text-muted-foreground"> · {rate.service}</span> : null}
          </p>
          {rate.days !== null ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Tiempo estimado · {rate.days} {rate.days === 1 ? 'día hábil' : 'días hábiles'}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-base font-semibold tabular-nums">{formatCOP(rate.total)}</p>
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
    <div className="space-y-4 p-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
        <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        <h3 className="mt-2 text-base font-semibold">Guia {guide.number} generada</h3>
        <p className="mt-0.5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          {carrier}
        </p>
      </div>

      <TrackingTimeline orderId={orderId} />

      <p className="text-center text-[11px] text-muted-foreground">
        {isCoordinadora
          ? 'El rotulo esta en la conversacion. Para generar otra guia, anulala primero en Coordinadora.'
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="h-4 w-4" />
          Seguimiento del envio
        </h4>
        <div className="flex items-center gap-3">
          {data?.trackingUrl ? (
            <a
              href={data.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
            >
              <ExternalLink className="h-3 w-3" />
              {data.carrier ?? 'Coordinadora'}
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => refetch()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Actualizar seguimiento"
            title="Actualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo consultar el seguimiento.</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Este pedido aun no tiene guia para rastrear.</p>
        ) : (
          <>
            {/* Con Skydropx el envio puede salir por CUALQUIER transportadora:
                dejarla siempre visible junto al estado. */}
            {data.carrier ? (
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium">
                <Truck className="h-3 w-3 text-muted-foreground" />
                Enviado por <span className="font-semibold">{data.carrier}</span>
              </p>
            ) : null}

            {delivered ? (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Entregado {data.fechaEntrega}
                {data.horaEntrega ? ` · ${data.horaEntrega}` : ''}
              </div>
            ) : data.descripcionEstado ? (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-700 dark:text-sky-400">
                <MapPin className="h-4 w-4 shrink-0" />
                {data.descripcionEstado}
              </div>
            ) : null}

            {data.novedades.length > 0 ? (
              <div className="mb-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Novedades
                </p>
                {data.novedades.map((n, i) => (
                  <p key={i} className="text-xs">
                    {n.descripcion}
                    <span className="text-muted-foreground">
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
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-foreground' : 'bg-foreground/40'}`}
                      />
                      {i < data.estados.length - 1 ? <span className="my-0.5 w-px flex-1 bg-border" /> : null}
                    </div>
                    <div className="pb-3">
                      <p className="text-sm leading-snug">{e.descripcion}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.fecha}
                        {e.hora ? ` · ${e.hora}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aun sin movimientos registrados. La transportadora los actualiza al recoger y mover el paquete.
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
