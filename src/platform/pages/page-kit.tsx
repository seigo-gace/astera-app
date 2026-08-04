import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, asRecord, recordText, textValue, type JsonObject } from '../api-client';
import { safeReturnPath, type RouteMatch } from '../route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';

type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

export function useResource<T = unknown>(path: string | null): [ResourceState<T>, () => void] {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<ResourceState<T>>(path ? { status: 'loading' } : { status: 'ready', data: null as T });

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRequest<T>(path, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      });
    return () => controller.abort();
  }, [path, nonce]);

  return [state, () => setNonce((value) => value + 1)];
}

export function safeNavigate(path: string): void {
  window.location.assign(safeReturnPath(path, '/app/new'));
}

export function Field({ label, name, type = 'text', autoComplete, required = false, minLength, maxLength, placeholder, inputMode, value, onChange }: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  value?: string;
  onChange?: (value: string) => void;
}) {
  return <label className="platform-field"><span>{label}</span><input name={name} type={type} autoComplete={autoComplete} required={required} minLength={minLength} maxLength={maxLength} placeholder={placeholder} inputMode={inputMode} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} /></label>;
}

export function SelectField({ label, name, options, value, onChange }: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return <label className="platform-field"><span>{label}</span><select name={name} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
}

export function FormResult({ state }: { state: { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string } }) {
  if (state.type === 'idle') return null;
  if (state.type === 'working') return <div className="platform-form-result" role="status">送信しています…</div>;
  return <div className={`platform-form-result is-${state.type}`} role={state.type === 'error' ? 'alert' : 'status'}><strong>{state.message}</strong>{state.code && <code>{state.code}</code>}</div>;
}

export type SubmitState = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };

type SubmitOptions = {
  method?: 'POST' | 'PATCH' | 'DELETE';
  success?: string;
  navigateTo?: string;
  idempotent?: boolean;
  idempotencyKey?: string;
  dedupeKey?: string;
  timeoutMs?: number;
};

const inFlightIdempotentSubmissions = new Map<string, Promise<unknown>>();

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export async function submitForm(endpoint: string, body: JsonObject, setState: (state: SubmitState) => void, options: SubmitOptions = {}): Promise<unknown | null> {
  setState({ type: 'working' });
  const method = options.method ?? 'POST';
  const requestKey = options.idempotent
    ? options.dedupeKey ?? `${method}:${endpoint}:${stableSerialize(body)}`
    : null;

  let request: Promise<unknown>;
  if (requestKey) {
    const existing = inFlightIdempotentSubmissions.get(requestKey);
    if (existing) {
      request = existing;
    } else {
      request = apiRequest(endpoint, {
        method,
        body,
        idempotent: true,
        idempotencyKey: options.idempotencyKey,
        timeoutMs: options.timeoutMs,
      });
      inFlightIdempotentSubmissions.set(requestKey, request);
    }
  } else {
    request = apiRequest(endpoint, {
      method,
      body,
      idempotencyKey: options.idempotencyKey,
      timeoutMs: options.timeoutMs,
    });
  }

  try {
    const payload = await request;
    setState({ type: 'success', message: options.success ?? '完了しました。' });
    if (options.navigateTo) window.setTimeout(() => safeNavigate(options.navigateTo as string), 250);
    return payload;
  } catch (error) {
    setState({ type: 'error', message: error instanceof Error ? error.message : '処理に失敗しました。', code: error instanceof ApiError ? error.code : 'UNKNOWN_ERROR' });
    return null;
  } finally {
    if (requestKey && inFlightIdempotentSubmissions.get(requestKey) === request) {
      inFlightIdempotentSubmissions.delete(requestKey);
    }
  }
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="platform-panel"><header><h2>{title}</h2>{actions}</header><div className="platform-panel-body">{children}</div></section>;
}

export function KeyValueGrid({ value }: { value: unknown }) {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(([, item]) => item !== null && item !== undefined && typeof item !== 'object');
  if (!entries.length) return <EmptyState>表示できる情報がありません。</EmptyState>;
  return <dl className="platform-kv-grid">{entries.map(([key, item]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{textValue(item, '—')}</dd></div>)}</dl>;
}

export function RecordList({ items, titleKeys = ['title', 'name', 'display_name', 'id'], subtitleKeys = ['description', 'summary', 'status', 'created_at'], link, empty = '対象Dataはありません。' }: {
  items: unknown[];
  titleKeys?: string[];
  subtitleKeys?: string[];
  link?: (record: JsonObject) => string | null;
  empty?: string;
}) {
  if (!items.length) return <EmptyState>{empty}</EmptyState>;
  return <div className="platform-record-list">{items.map((item, index) => {
    const record = asRecord(item);
    const title = recordText(record, titleKeys, `Item ${index + 1}`);
    const subtitle = recordText(record, subtitleKeys);
    const href = link?.(record) ?? null;
    const content = <><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</>;
    return href ? <a className="platform-record" href={href} key={`${title}-${index}`}>{content}<b aria-hidden="true">›</b></a> : <div className="platform-record" key={`${title}-${index}`}>{content}</div>;
  })}</div>;
}

export function AuthCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return <div className="platform-auth-card">{children}{footer && <footer>{footer}</footer>}</div>;
}

export function ResourceShell({ route, endpoint, description, children }: {
  route: RouteMatch;
  endpoint: string;
  description: string;
  children: (payload: unknown, reload: () => void) => ReactNode;
}) {
  const [state, reload] = useResource(endpoint);
  return <ResponsivePageShell route={route} description={description}>{state.status === 'loading' && <BusyState />}{state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}{state.status === 'ready' && children(state.data, reload)}</ResponsivePageShell>;
}
