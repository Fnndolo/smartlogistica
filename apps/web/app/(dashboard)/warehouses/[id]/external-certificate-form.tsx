'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ExternalCertificateSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

interface Props {
  warehouseId: string;
}

interface TestResult {
  ok: boolean;
  issuer?: string;
  paymentMethods?: string[];
  error?: string;
}

/**
 * Conexion con el emisor externo de certificados. Se muestra solo cuando la
 * sede esta en modo 'external'.
 *
 * El medio de pago es UNO FIJO para toda la sede: el emisor lo recibe como
 * texto libre y agrega a su catalogo cualquier valor nuevo, asi que no se le
 * pasa el de Alegra ("Efectivo", "Transferencia"...). El desplegable se llena
 * con los que el propio emisor declara al probar la conexion.
 */
export function ExternalCertificateForm({ warehouseId }: Props) {
  const qc = useQueryClient();
  const base = `/v1/warehouses/${warehouseId}/certificate/external`;

  const { data: config, isLoading } = useQuery({
    queryKey: ['external-certificate', warehouseId],
    queryFn: () => api.get<ExternalCertificateSummary | null>(base),
  });

  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // Mientras no se edite, se muestra lo guardado.
  const urlValue = baseUrl ?? config?.baseUrl ?? '';
  const methodValue = paymentMethod ?? config?.paymentMethod ?? '';
  const methods = test?.paymentMethods ?? [];

  const save = async () => {
    if (!urlValue.trim()) return toast.error('Falta la URL del emisor');
    if (!methodValue.trim()) return toast.error('Elige el medio de pago');
    if (!config?.hasApiKey && !apiKey.trim()) return toast.error('Falta la API key');
    setSaving(true);
    try {
      await api.put<ExternalCertificateSummary>(base, {
        baseUrl: urlValue.trim(),
        paymentMethod: methodValue.trim(),
        // Solo viaja cuando se cambia: asi se puede editar la URL sin volver a
        // pegar la clave.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      setBaseUrl(null);
      setPaymentMethod(null);
      await qc.invalidateQueries({ queryKey: ['external-certificate', warehouseId] });
      toast.success('Emisor guardado');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.post<TestResult>(`${base}/test`);
      setTest(result);
      if (result.ok) toast.success(`Conectado con ${result.issuer}`);
      else toast.error(result.error ?? 'No se pudo conectar');
      await qc.invalidateQueries({ queryKey: ['external-certificate', warehouseId] });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo probar la conexión';
      setTest({ ok: false, error: message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando emisor…
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      {config?.status === 'error' && config.lastError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            El último intento falló: {config.lastError}
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ext-url">URL del emisor</Label>
          <Input
            id="ext-url"
            value={urlValue}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://mi-generador.up.railway.app"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-key">API key</Label>
          <Input
            id="ext-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasApiKey ? '•••••••• (guardada)' : 'elv_live_…'}
            autoComplete="new-password"
          />
          <p className="text-[11.5px] text-muted-foreground">
            {config?.hasApiKey
              ? 'Ya hay una clave guardada. Déjalo vacío para conservarla.'
              : 'Se guarda cifrada; no se vuelve a mostrar.'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ext-method">Medio de pago de los certificados</Label>
        {methods.length > 0 ? (
          <select
            id="ext-method"
            value={methodValue}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Elige uno…
            </option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="ext-method"
            value={methodValue}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="ADDI"
            autoComplete="off"
          />
        )}
        <p className="text-[11.5px] text-muted-foreground">
          Todos los certificados de esta sede salen con este medio de pago, sin importar cómo se
          haya registrado el pago en Alegra. Pulsa <strong>Probar conexión</strong> para traer la
          lista que acepta el emisor.
        </p>
      </div>

      {test?.ok ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Conectado con <strong>{test.issuer}</strong>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={testing || !config?.hasApiKey}
          title={config?.hasApiKey ? undefined : 'Guarda primero la API key'}
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Probar conexión
        </Button>
      </div>
    </div>
  );
}
