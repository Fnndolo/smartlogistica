'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  vtexAccountNameSchema,
  vtexCredentialsSchema,
  type VtexCredentialsInput,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Stepper } from '@/components/ui/stepper';
import { ApiError, api } from '@/lib/api-client';

const STEPS = ['Cuenta', 'Credenciales', 'Confirmar'];

type TestResult = { ok: true; sampleOrderCount: number } | null;

export function VtexConnectWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [submitting, startTransition] = useTransition();
  const [showAppKey, setShowAppKey] = useState(false);
  const [showAppToken, setShowAppToken] = useState(false);

  const form = useForm<VtexCredentialsInput>({
    resolver: zodResolver(vtexCredentialsSchema),
    mode: 'onChange',
    defaultValues: { accountName: '', appKey: '', appToken: '' },
  });

  const { register, trigger, getValues, formState, watch } = form;
  const accountName = watch('accountName');

  async function goNextFromStep1() {
    const valid = vtexAccountNameSchema.safeParse(accountName);
    if (!valid.success) {
      const issue = valid.error.issues[0];
      form.setError('accountName', { message: issue?.message ?? 'Invalido' });
      return;
    }
    form.clearErrors('accountName');
    setStep(1);
  }

  async function handleTest() {
    const ok = await trigger(['appKey', 'appToken']);
    if (!ok) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ ok: true; sampleOrderCount: number }>(
        '/v1/connections/vtex/test',
        getValues(),
      );
      setTestResult(result);
      toast.success(`Conexion verificada (${result.sampleOrderCount} pedidos en cuenta)`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo conectar a VTEX';
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  function handleConfirm() {
    startTransition(async () => {
      try {
        await api.post('/v1/connections/vtex', getValues());
        toast.success('Conexion VTEX creada — sincronizando pedidos...');
        router.push('/connections');
        router.refresh();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'No se pudo crear la conexion';
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={step} />

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {step === 0 ? (
          <StepAccountName
            value={accountName}
            register={register('accountName')}
            error={formState.errors.accountName?.message}
            onNext={goNextFromStep1}
          />
        ) : null}

        {step === 1 ? (
          <StepCredentials
            register={register}
            showAppKey={showAppKey}
            showAppToken={showAppToken}
            toggleAppKey={() => setShowAppKey((s) => !s)}
            toggleAppToken={() => setShowAppToken((s) => !s)}
            errors={formState.errors}
            testing={testing}
            testResult={testResult}
            onBack={() => setStep(0)}
            onTest={handleTest}
            onNext={() => setStep(2)}
          />
        ) : null}

        {step === 2 ? (
          <StepConfirm
            values={getValues()}
            onBack={() => setStep(1)}
            onConfirm={handleConfirm}
            submitting={submitting}
          />
        ) : null}
      </div>

      <HelperBlock />
    </div>
  );
}

function StepAccountName({
  value,
  register,
  error,
  onNext,
}: {
  value: string;
  register: ReturnType<ReturnType<typeof useForm<VtexCredentialsInput>>['register']>;
  error?: string;
  onNext: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="accountName">Account name VTEX</Label>
        <div className="flex items-stretch overflow-hidden rounded-md border border-input">
          <span className="flex items-center bg-muted px-3 text-xs text-muted-foreground">https://</span>
          <Input
            id="accountName"
            className="border-0 shadow-none focus-visible:ring-0"
            placeholder="smartgadgetsonline767"
            aria-invalid={Boolean(error)}
            {...register}
          />
          <span className="flex items-center bg-muted px-3 text-xs text-muted-foreground">.vtexcommercestable.com.br</span>
        </div>
        <FieldError message={error} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!value}>
          Siguiente
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </form>
  );
}

function StepCredentials({
  register,
  showAppKey,
  showAppToken,
  toggleAppKey,
  toggleAppToken,
  errors,
  testing,
  testResult,
  onBack,
  onTest,
  onNext,
}: {
  register: ReturnType<typeof useForm<VtexCredentialsInput>>['register'];
  showAppKey: boolean;
  showAppToken: boolean;
  toggleAppKey: () => void;
  toggleAppToken: () => void;
  errors: { appKey?: { message?: string }; appToken?: { message?: string } };
  testing: boolean;
  testResult: TestResult;
  onBack: () => void;
  onTest: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <SecretField
        id="appKey"
        label="App Key"
        type={showAppKey ? 'text' : 'password'}
        onToggle={toggleAppKey}
        register={register('appKey')}
        error={errors.appKey?.message}
        placeholder="vtexappkey-XXXXXXX"
        autoComplete="off"
      />
      <SecretField
        id="appToken"
        label="App Token"
        type={showAppToken ? 'text' : 'password'}
        onToggle={toggleAppToken}
        register={register('appToken')}
        error={errors.appToken?.message}
        placeholder="XXXXXXXXXXXXXXXXXXX"
        autoComplete="off"
      />

      {testResult ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-foreground">
            Conexion verificada · <span className="text-muted-foreground">{testResult.sampleOrderCount} pedidos visibles</span>
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          Atras
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onTest} loading={testing}>
            <KeyRound className="h-4 w-4" />
            Probar conexion
          </Button>
          <Button onClick={onNext} disabled={!testResult}>
            Siguiente
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SecretField({
  id,
  label,
  type,
  onToggle,
  register,
  error,
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  type: 'text' | 'password';
  onToggle: () => void;
  register: ReturnType<ReturnType<typeof useForm<VtexCredentialsInput>>['register']>;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          className="pr-10"
          {...register}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={type === 'password' ? 'Mostrar' : 'Ocultar'}
        >
          {type === 'password' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

function StepConfirm({
  values,
  onBack,
  onConfirm,
  submitting,
}: {
  values: VtexCredentialsInput;
  onBack: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SummaryRow label="Account" value={values.accountName} />
        <SummaryRow label="App Key" value={maskMiddle(values.appKey)} />
        <SummaryRow label="App Token" value={maskMiddle(values.appToken)} />
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Al confirmar registramos un webhook seguro en tu cuenta VTEX para los estados
        ready-for-handling y handling. Tus credenciales se cifran con AES-256-GCM antes de almacenarse.
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Atras
        </Button>
        <Button onClick={onConfirm} loading={submitting}>
          {submitting ? null : <Loader2 className="hidden" />}
          Crear conexion
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function maskMiddle(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function HelperBlock() {
  return (
    <div className="rounded-md border border-dashed border-border bg-background p-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Como obtener tu App Key + App Token</p>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>Entra al admin de VTEX: Cuenta → Gestion de aplicaciones → Llaves de aplicacion.</li>
        <li>Crea una nueva llave con permisos sobre OMS (Orders).</li>
        <li>Copia el App Key y el App Token generados — guardalos en un lugar seguro.</li>
      </ol>
    </div>
  );
}
