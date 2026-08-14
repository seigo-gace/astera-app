type RevisionBaseline = {
  jobId: string;
  prompt: string;
  privateMode: boolean;
};

type RevisionEstimate = RevisionBaseline & {
  estimateId: string;
  billableCharacters: number | null;
};

type PendingJob = RevisionBaseline;

const REVISION_ESTIMATE_MARK = 'data-astera-revision-credit';
let initialized = false;
let revisionArmed = false;
let baseline: RevisionBaseline | null = null;
let lastEstimate: RevisionEstimate | null = null;
const estimateContexts = new Map<string, RevisionBaseline>();
const pendingJobs = new Map<string, PendingJob>();

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolean(value: unknown): boolean {
  return value === true;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    return new URL(raw, window.location.href);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

async function requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const body = init?.body;
  if (typeof body === 'string' && body.trim()) {
    try {
      return record(JSON.parse(body));
    } catch {
      return null;
    }
  }
  if (input instanceof Request) {
    try {
      return record(await input.clone().json());
    } catch {
      return null;
    }
  }
  return null;
}

function requestWithJson(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  payload: Record<string, unknown>,
): [RequestInfo | URL, RequestInit | undefined] {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('Content-Type', 'application/json');
  const body = JSON.stringify(payload);
  if (input instanceof Request) {
    return [new Request(input, { ...init, headers, body }), undefined];
  }
  return [input, { ...init, headers, body }];
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) return null;
  try {
    return record(await response.clone().json());
  } catch {
    return null;
  }
}

function nested(source: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!source) return null;
  for (const key of keys) {
    const value = record(source[key]);
    if (value) return value;
  }
  return source;
}

function estimateId(payload: Record<string, unknown> | null): string {
  const source = nested(payload, ['estimate', 'data']);
  return text(source?.estimate_id ?? source?.estimateId ?? source?.id);
}

function jobInfo(payload: Record<string, unknown> | null): { id: string; state: string } {
  const source = nested(payload, ['job', 'data']);
  return {
    id: text(source?.job_id ?? source?.jobId ?? source?.id),
    state: text(source?.state ?? source?.status ?? source?.job_state).toLowerCase(),
  };
}

function clearRevisionFields(payload: Record<string, unknown>): void {
  delete payload.revision_of_job_id;
  delete payload.revisionOfJobId;
  delete payload.revision_base_prompt;
  delete payload.revisionBasePrompt;
}

function revisionContextFor(prompt: string, privateMode: boolean): RevisionBaseline | null {
  if (!revisionArmed || !baseline) return null;
  if (privateMode !== baseline.privateMode) return null;
  if (!prompt || prompt === baseline.prompt) return null;
  return baseline;
}

function attachRevision(payload: Record<string, unknown>, context: RevisionBaseline | null): void {
  clearRevisionFields(payload);
  if (!context) return;
  payload.revision_of_job_id = context.jobId;
  payload.revision_base_prompt = context.prompt;
}

function commitBaseline(candidate: PendingJob | undefined): void {
  if (!candidate) return;
  baseline = candidate;
  revisionArmed = false;
  lastEstimate = null;
}

function clearSession(): void {
  revisionArmed = false;
  baseline = null;
  lastEstimate = null;
  estimateContexts.clear();
  pendingJobs.clear();
  removeEstimateMarker();
}

function removeEstimateMarker(): void {
  document.querySelectorAll(`[${REVISION_ESTIMATE_MARK}]`).forEach((node) => node.remove());
}

function renderEstimateMarker(): void {
  const existing = document.querySelector(`[${REVISION_ESTIMATE_MARK}]`);
  if (!lastEstimate || lastEstimate.billableCharacters === null) {
    existing?.remove();
    return;
  }
  const list = document.querySelector('.canonical-confirmation dl');
  if (!(list instanceof HTMLElement)) return;
  const value = lastEstimate.billableCharacters.toLocaleString('ja-JP');
  if (existing instanceof HTMLElement) {
    const dd = existing.querySelector('dd');
    if (dd?.textContent !== value && dd) dd.textContent = value;
    if (existing.parentElement !== list) list.append(existing);
    return;
  }
  const row = document.createElement('div');
  row.setAttribute(REVISION_ESTIMATE_MARK, 'true');
  const dt = document.createElement('dt');
  dt.textContent = '修整Credit対象文字数';
  const dd = document.createElement('dd');
  dd.textContent = value;
  row.append(dt, dd);
  list.append(row);
}

function handleComposerInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  if (!event.target.closest('.canonical-composer-card, .canonical-fullscreen')) return;
  if (!baseline || !document.querySelector('.canonical-result')) return;
  const next = event.target.value.trim();
  revisionArmed = next.length > 0 && next !== baseline.prompt;
}

function handleComposerClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.closest('.canonical-composer-toolbar')) return;
  if (button.textContent?.trim() === '新規') clearSession();
}

function scheduleMarker(): void {
  queueMicrotask(renderEstimateMarker);
}

export function initializeRevisionCreditBridge(): void {
  if (initialized) return;
  initialized = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (!url || !url.pathname.startsWith('/api/jobs')) return originalFetch(input, init);

    let nextInput = input;
    let nextInit = init;
    let requestPayload: Record<string, unknown> | null = null;
    let revisionContext: RevisionBaseline | null = null;
    let submitted: PendingJob | null = null;
    let submittedEstimateId = '';

    if (method === 'POST' && (url.pathname === '/api/jobs/estimate' || url.pathname === '/api/jobs')) {
      requestPayload = await requestJson(input, init);
      if (requestPayload) {
        const prompt = text(requestPayload.prompt ?? requestPayload.input);
        const privateMode = boolean(requestPayload.private_mode ?? requestPayload.privateMode);
        if (url.pathname === '/api/jobs/estimate') {
          revisionContext = revisionContextFor(prompt, privateMode);
          attachRevision(requestPayload, revisionContext);
        } else {
          submittedEstimateId = text(requestPayload.estimate_id ?? requestPayload.estimateId);
          revisionContext = submittedEstimateId ? estimateContexts.get(submittedEstimateId) ?? null : null;
          attachRevision(requestPayload, revisionContext);
          if (prompt) submitted = { jobId: '', prompt, privateMode };
        }
        [nextInput, nextInit] = requestWithJson(input, init, requestPayload);
      }
    }

    const response = await originalFetch(nextInput, nextInit);
    if (!response.ok) return response;
    const payload = await responseJson(response);

    if (method === 'POST' && url.pathname === '/api/jobs/estimate') {
      const id = estimateId(payload);
      const source = nested(payload, ['estimate', 'data']);
      const billingMode = text(source?.billing_mode ?? source?.billingMode);
      const billableCharacters = numeric(source?.billable_characters ?? source?.billableCharacters);
      if (id && revisionContext && billingMode === 'revision') {
        estimateContexts.set(id, revisionContext);
        lastEstimate = { ...revisionContext, estimateId: id, billableCharacters };
      } else {
        if (id) estimateContexts.delete(id);
        lastEstimate = null;
      }
      scheduleMarker();
      return response;
    }

    if (method === 'POST' && url.pathname === '/api/jobs') {
      const info = jobInfo(payload);
      if (info.id && submitted) {
        const pending = { ...submitted, jobId: info.id };
        pendingJobs.set(info.id, pending);
        if (info.state === 'completed' || info.state === 'complete') {
          commitBaseline(pending);
          pendingJobs.delete(info.id);
        }
      }
      if (submittedEstimateId) estimateContexts.delete(submittedEstimateId);
      return response;
    }

    if (method === 'GET') {
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (match) {
        const info = jobInfo(payload);
        const id = info.id || decodeURIComponent(match[1]);
        if (info.state === 'completed' || info.state === 'complete') {
          commitBaseline(pendingJobs.get(id));
          pendingJobs.delete(id);
        } else if (['failed', 'cancelled', 'canceled'].includes(info.state)) {
          pendingJobs.delete(id);
        }
      }
    }

    return response;
  };

  document.addEventListener('input', handleComposerInput, true);
  document.addEventListener('click', handleComposerClick, true);
  const observer = new MutationObserver(scheduleMarker);
  observer.observe(document.documentElement, { subtree: true, childList: true });
}
