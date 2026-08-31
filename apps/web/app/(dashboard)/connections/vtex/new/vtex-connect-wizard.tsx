'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
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
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { BTN_GHOST, BTN_PRIMARY, BTN_QUIET, LABEL_MICRO } from '../../connection-ui';

const STEPS = ['Cuenta', 'Credenciales', 'Confirmar'];

// En el asistente los botones van a tamaño normal (no .btn-sm), para que la
// fila de acciones quede pareja con el primario.
const BTN_GHOST_LG = `${BTN_GHOST} px-[15px] py-2 text-[13px]`;
const BTN_QUIET_LG = `${BTN_QUIET} px-[15px] py-2 text-[13px]`;

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
    defaultValues: { accountName: '', label: '', appKey: '', appToken: '' },
  });

  const { register, trigger, getValues, formState, watch } = form;
  const accountName = watch('accountName');

  async function goNextFromStep1() {
    const valid = vtexAccountNameSchema.safeParse(accountName);
    if (!valid.success) {
      const issue = valid.error.issues[0];
      form.setError('accountName', { message: issue?.message ?? 'Inválido' });
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
      toast.success(`Conexión verificada (${result.sampleOrderCount} pedidos en cuenta)`);
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
        toast.success('Conexión VTEX creada — sincronizando pedidos...');
        router.push('/connections');
        router.refresh();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'No se pudo crear la conexión';
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <WizardSteps steps={STEPS} current={step} />

      <div className="rounded-[14px] border border-border bg-card p-6">
        {step === 0 ? (
          <StepAccountName
            value={accountName}
            register={register('accountName')}
            labelRegister={register('label')}
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

/** Pasos del asistente en el lenguaje Cobalto (paso hecho = cobalto solido). */
function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2.5" aria-label="Progreso">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        const isLast = index === steps.length - 1;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11.5px] font-extrabold tabular-nums transition-colors [transition-duration:140ms]',
                  done &&
                    'border-transparent bg-gradient-to-b from-accent to-accent-deep text-accent-foreground',
                  active && 'border-accent bg-wash text-accent-ink ring-4 ring-accent/15',
                  !done && !active && 'border-border bg-card text-hint',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'truncate text-[12.5px] font-bold transition-colors [transition-duration:140ms]',
                  active || done ? 'text-foreground' : 'text-hint',
                )}
              >
                {label}
              </span>
            </div>
            {!isLast ? (
              <span aria-hidden className={cn('h-px flex-1', done ? 'bg-accent' : 'bg-border')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepAccountName({
  value,
  register,
  labelRegister,
  error,
  onNext,
}: {
  value: string;
  register: ReturnType<ReturnType<typeof useForm<VtexCredentialsInput>>['register']>;
  labelRegister: ReturnType<ReturnType<typeof useForm<VtexCredentialsInput>>['register']>;
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
        <Label htmlFor="accountName" className={LABEL_MICRO}>
          Account name VTEX
        </Label>
        {/* Envuelve en pantallas chicas: el dominio nunca empuja la pagina. */}
        <div className="flex flex-wrap items-stretch overflow-hidden rounded-[10px] border border-input bg-card">
          <span className="flex items-center whitespace-nowrap bg-surface px-3 text-[11.5px] text-hint">
            https://
          </span>
          <Input
            id="accountName"
            className="min-w-[8rem] flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder="smartgadgetsonline767"
            aria-invalid={Boolean(error)}
            {...register}
          />
          <span className="flex items-center whitespace-nowrap bg-surface px-3 text-[11.5px] text-hint">
            .vtexcommercestable.com.br
          </span>
        </div>
        <FieldError message={error} />
      </div>

      {/* Nombre visible. Con dos tiendas VTEX conectadas es lo unico que las
          distingue en las pestañas de pedidos y en la lista de conexiones. */}
      <div className="space-y-1.5">
        <Label htmlFor="label" className={LABEL_MICRO}>
          Nombre de la tienda <span className="font-normal normal-case text-hint">(opcional)</span>
        </Label>
        <Input
          id="label"
          className="rounded-[10px] border-input bg-card shadow-none"
          placeholder="Ej. Smart Gadgets"
          maxLength={40}
          {...labelRegister}
        />
        <p className="text-[11.5px] leading-[1.45] text-hint">
          Así la verás en las pestañas de pedidos. Si lo dejas vacío se usa el account name. Se
          puede cambiar después.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" className={BTN_PRIMARY} disabled={!value}>
          Siguiente
          <ArrowRight />
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
        <div className="flex items-center gap-2 rounded-[10px] border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12.5px]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span className="min-w-0 text-foreground">
            Conexión verificada ·{' '}
            <span className="text-muted-foreground">
              {testResult.sampleOrderCount} pedidos visibles
            </span>
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className={BTN_QUIET_LG} onClick={onBack}>
          Atrás
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className={BTN_GHOST_LG} onClick={onTest} loading={testing}>
            <KeyRound />
            Probar conexión
          </Button>
          <Button className={BTN_PRIMARY} onClick={onNext} disabled={!testResult}>
            Siguiente
            <ArrowRight />
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
      <Label htmlFor={id} className={LABEL_MICRO}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          className="rounded-[10px] pr-10"
          {...register}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[7px] p-1.5 text-hint transition-colors [transition-duration:140ms] hover:bg-wash hover:text-accent-ink"
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
      <div className="space-y-2">
        <SummaryRow label="Tienda" value={values.label?.trim() || values.accountName} />
        <SummaryRow label="Account" value={values.accountName} />
        <SummaryRow label="App Key" value={maskMiddle(values.appKey)} />
        <SummaryRow label="App Token" value={maskMiddle(values.appToken)} />
      </div>

      <div className="rounded-[10px] border border-border bg-surface p-3 text-[12px] text-muted-foreground">
        Al confirmar registramos un webhook seguro en tu cuenta VTEX para los estados
        ready-for-handling y handling. Tus credenciales se cifran con AES-256-GCM antes de
        almacenarse.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className={BTN_QUIET_LG} onClick={onBack} disabled={submitting}>
          Atrás
        </Button>
        <Button className={BTN_PRIMARY} onClick={onConfirm} loading={submitting}>
          Crear conexión
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface px-3 py-2">
      <span className={LABEL_MICRO}>{label}</span>
      <span className="max-w-[60%] truncate font-mono text-[11.5px] text-foreground">{value}</span>
    </div>
  );
}

function maskMiddle(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function HelperBlock() {
  return (
    <div className="rounded-[14px] border border-dashed border-input bg-card p-4 text-[12px] text-muted-foreground">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint">
        Cómo obtener tu App Key + App Token
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>Entra al admin de VTEX: Cuenta → Gestión de aplicaciones → Llaves de aplicación.</li>
        <li>Crea una nueva llave con permisos sobre OMS (Orders).</li>
        <li>Copia el App Key y el App Token generados — guárdalos en un lugar seguro.</li>
      </ol>
    </div>
  );
}
