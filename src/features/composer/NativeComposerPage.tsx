import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ApiError, apiRequest, apiUrl, asArray, asRecord, recordText } from '../../platform/api-client';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './native-composer.css';

type PurposeKey = 'auto' | 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
type ExecutionOptionKey = 'translation' | 'agent-mode' | 'document' | 'external-storage-transfer';
type CurrentExecutionOptionKey = Exclude<ExecutionOptionKey, 'document'>;
type CreditState = 'normal' | 'low' | 'critical' | 'insufficient' | 'purchase_pending' | 'credited' | 'resume_available' | 'resume_blocked';
type ComposerPhase = 'draft' | 'uploading' | 'estimating' | 'confirmation' | 'submitting' | 'queued' | 'running' | 'assembling_result' | 'completed' | 'failed' | 'cancelled';
type DocumentTemplateSource = 'official' | 'personal';
type AgentMode = 'low' | 'medium' | 'high';
type PickerKind = 'add' | 'context' | null;

type UploadedFile = {
  localId: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: 'uploading' | 'ready' | 'error';
  uploadId?: string;
  error?: string;
};

type JobEstimate = {
  estimateId: string;
  requiredCredits: number;
  availableCredits: number;
  reservedCredits: number;
  estimatedRemainingRuns?: number;
  creditState: CreditState;
  expiresAt: string;
  billingMode: 'full' | 'revision';
  billableCharacters?: number;
};

type ResultSection = {
  key: string;
  title: string;
  body: string;
  sourceIds: string[];
};

type CatalogItem = {
  id: string;
  title: string;
  source?: DocumentTemplateSource;
  status?: string;
};

type RevisionBaseline = {
  jobId: string;
  prompt: string;
  privateMode: boolean;
};

const MAX_INPUT_CHARACTERS = 200_000;
const PRIVATE_OUTPUT_TTL_MS = 60 * 60 * 1000;
const RESULT_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

const CURRENT_OPTION_KEYS: readonly CurrentExecutionOptionKey[] = [
  'translation',
  'agent-mode',
  'external-storage-transfer',
];

const OPTION_LABELS: Record<CurrentExecutionOptionKey, string> = {
  translation: '高精度翻訳',
  'agent-mode': 'Agent Mode',
  'external-storage-transfer': '外部Storage転送',
};

const AGENT_MODE_CHOICES: ReadonlyArray<{ key: AgentMode; label: string }> = [
  { key: 'low', label: 'エージェント低' },
  { key: 'medium', label: 'エージェント中' },
  { key: 'high', label: 'エージェント高' },
];

const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  low: 'エージェント低',
  medium: 'エージェント中',
  high: 'エージェント高',
};

const PURPOSE_CHOICES: ReadonlyArray<{ key: Exclude<PurposeKey, 'auto'>; label: string }> = [
  { key: 'review', label: 'レビュー' },
  { key: 'compare', label: '比較' },
  { key: 'verify', label: '検証' },
  { key: 'improve', label: '改善' },
  { key: 'research', label: '調査' },
  { key: 'plan', label: '計画' },
  { key: 'consider', label: '検討' },
];

const PURPOSE_LABELS = Object.fromEntries(PURPOSE_CHOICES.map((item) => [item.key, item.label])) as Record<Exclude<PurposeKey, 'auto'>, string>;

const RESULT_TITLES: Record<(typeof RESULT_KEYS)[number], string> = {
  true_purpose: '真の目的',
  missing_assumptions: '不足前提',
  fact_check: '事実確認',
  risk_detection: '危機・リスク',
  counter_view: '反対視点',
  alternatives: '比較案',
  recommendation: '推奨判断',
  next_prompt: '主役AIへの再指示',
};

function defaultLanguage(): string {
  return document.documentElement.lang || navigator.language || 'ja-JP';
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function creditState(value: unknown, required: number, available: number): CreditState {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  const allowed = new Set<CreditState>(['normal', 'low', 'critical', 'insufficient', 'purchase_pending', 'credited', 'resume_available', 'resume_blocked']);
  if (allowed.has(normalized as CreditState)) return normalized as CreditState;
  return available < required ? 'insufficient' : 'normal';
}

function extractEstimate(payload: unknown): JobEstimate {
  const root = asRecord(payload);
  const source = asRecord(root.estimate ?? root.data ?? root);
  const requiredCredits = numberValue(source.required_credits ?? source.requiredCredits);
  const availableCredits = numberValue(source.available_credits ?? source.availableCredits);
  const reservedCredits = numberValue(source.reserved_credits ?? source.reservedCredits);
  const estimateId = recordText(source, ['estimate_id', 'estimateId', 'id']);
  const expiresAt = recordText(source, ['expires_at', 'expiresAt']);
  if (!estimateId || !expiresAt || requiredCredits <= 0) {
    throw new ApiError('Server Estimateの必須項目が不足しています。', 502, 'JOB_ESTIMATE_INVALID', payload);
  }
  const rawBillable = numberValue(source.billable_characters ?? source.billableCharacters, -1);
  return {
    estimateId,
    requiredCredits,
    availableCredits,
    reservedCredits,
    estimatedRemainingRuns: numberValue(source.estimated_remaining_runs ?? source.estimatedRemainingRuns, -1) >= 0
      ? numberValue(source.estimated_remaining_runs ?? source.estimatedRemainingRuns)
      : undefined,
    creditState: creditState(source.credit_state ?? source.creditState, requiredCredits, availableCredits),
    expiresAt,
    billingMode: recordText(source, ['billing_mode', 'billingMode']) === 'revision' ? 'revision' : 'full',
    billableCharacters: rawBillable >= 0 ? rawBillable : undefined,
  };
}

function sectionBody(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(String).join('\n').trim();
  const record = asRecord(value);
  return recordText(record, ['body', 'content', 'text']);
}

function normalizeResult(payload: unknown): ResultSection[] {
  const root = asRecord(payload);
  const job = asRecord(root.job ?? root.data ?? root);
  const result = asRecord(job.result ?? root.result ?? job);
  const rawSections = result.sections ?? root.sections;

  if (Array.isArray(rawSections)) {
    const byKey = new Map<string, ResultSection>();
    for (const item of rawSections) {
      const record = asRecord(item);
      const key = recordText(record, ['key']);
      const body = sectionBody(record);
      if (!key || !body || byKey.has(key)) continue;
      byKey.set(key, {
        key,
        title: recordText(record, ['title'], RESULT_TITLES[key as keyof typeof RESULT_TITLES] ?? key),
        body,
        sourceIds: asArray(record.sourceIds ?? record.source_ids).map(String),
      });
    }
    const ordered = RESULT_KEYS.map((key) => byKey.get(key)).filter((value): value is ResultSection => Boolean(value));
    if (ordered.length === RESULT_KEYS.length) return ordered;
  }

  const objectSections = asRecord(rawSections);
  const normalized = RESULT_KEYS.map((key) => {
    const source = objectSections[key] ?? result[key];
    const body = sectionBody(source);
    if (!body) return null;
    const record = asRecord(source);
    return {
      key,
      title: recordText(record, ['title'], RESULT_TITLES[key]),
      body,
      sourceIds: asArray(record.sourceIds ?? record.source_ids).map(String),
    } satisfies ResultSection;
  }).filter((value): value is NonNullable<typeof value> => value !== null);

  if (normalized.length !== RESULT_KEYS.length) {
    throw new ApiError(`固定8項目Resultが不足しています。受信: ${normalized.length}`, 502, 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE', payload);
  }
  return normalized;
}

function jobSource(payload: unknown) {
  const root = asRecord(payload);
  return asRecord(root.job ?? root.data ?? root);
}

function jobState(payload: unknown): string {
  return recordText(jobSource(payload), ['state', 'status', 'job_state']).toLowerCase();
}

function jobId(payload: unknown): string {
  return recordText(jobSource(payload), ['job_id', 'jobId', 'id']);
}

function phaseLabel(phase: ComposerPhase): string {
  const labels: Record<ComposerPhase, string> = {
    draft: '入力待ち',
    uploading: 'File Upload中',
    estimating: 'Credit確認中',
    confirmation: '実行前確認',
    submitting: 'Job作成中',
    queued: '実行待ち',
    running: 'Astera実行中',
    assembling_result: 'Result構成中',
    completed: '完了',
    failed: '停止',
    cancelled: '取消済み',
  };
  return labels[phase];
}

function records(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[];
  const data = asRecord(root.data);
  for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[];
  return [];
}

function catalogItem(value: unknown, kind: 'project' | 'template' | 'storage'): CatalogItem | null {
  const record = asRecord(value);
  const id = kind === 'project'
    ? recordText(record, ['project_id', 'id'])
    : kind === 'template'
      ? recordText(record, ['template_id', 'id', 'google_file_id'])
      : recordText(record, ['destination_id', 'id']);
  if (!id) return null;
  const title = kind === 'project'
    ? recordText(record, ['name', 'title'], id)
    : kind === 'template'
      ? recordText(record, ['title', 'name', 'display_name'], id)
      : recordText(record, ['display_name', 'name', 'provider'], id);
  const flag = recordText(record, ['template_source', 'source', 'scope', 'owner_scope']).toLowerCase();
  const source: DocumentTemplateSource | undefined = kind === 'template'
    ? (record.is_official === true || flag === 'official' || flag === 'astera' ? 'official' : 'personal')
    : undefined;
  return { id, title, source, status: recordText(record, ['status']) };
}

export default function NativeComposerPage({ route }: { route: RouteMatch }) {
  const [prompt, setPrompt] = useState('');
  const [purpose, setPurpose] = useState<PurposeKey>('auto');
  const [selectedOptions, setSelectedOptions] = useState<ExecutionOptionKey[]>([]);
  const [targetLanguage, setTargetLanguage] = useState(defaultLanguage());
  const [agentMode, setAgentMode] = useState<AgentMode>('medium');
  const [documentTemplateId, setDocumentTemplateId] = useState('');
  const [documentTemplateSource, setDocumentTemplateSource] = useState<DocumentTemplateSource>('personal');
  const [storageDestinationId, setStorageDestinationId] = useState('');
  const [privateMode] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [estimate, setEstimate] = useState<JobEstimate | null>(null);
  const [phase, setPhase] = useState<ComposerPhase>('draft');
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [resultSections, setResultSections] = useState<ResultSection[]>([]);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [projects, setProjects] = useState<CatalogItem[]>([]);
  const [templates, setTemplates] = useState<CatalogItem[]>([]);
  const [destinations, setDestinations] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [optionVisibility, setOptionVisibility] = useState<Record<CurrentExecutionOptionKey, boolean>>({
    translation: true,
    'agent-mode': true,
    'external-storage-transfer': true,
  });
  const [revisionBaseline, setRevisionBaseline] = useState<RevisionBaseline | null>(null);
  const executionLock = useRef(false);
  const pollController = useRef<AbortController | null>(null);
  const estimateFingerprint = useRef('');
  const privateOutputTimer = useRef<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('native-composer-route');
    document.documentElement.classList.remove('exterior-composer-route');
    document.documentElement.dataset.nativeWorkspace = 'true';
    return () => {
      document.documentElement.classList.remove('native-composer-route');
      delete document.documentElement.dataset.nativeWorkspace;
    };
  }, []);

  useEffect(() => {
    let controller = new AbortController();
    const applyPreferences = (payload: unknown) => {
      const root = asRecord(payload);
      const data = asRecord(root.preferences ?? root.data ?? root);
      setOptionVisibility({
        translation: data.translation !== false,
        'agent-mode': data.agent_mode !== false && data.agentMode !== false,
        'external-storage-transfer': data.storage_transfer !== false && data.storageTransfer !== false,
      });
    };
    const load = () => {
      controller.abort();
      controller = new AbortController();
      apiRequest('/api/preferences', { signal: controller.signal }).then(applyPreferences).catch(() => undefined);
    };
    const onPreferenceChange = (event: Event) => {
      if (event instanceof CustomEvent) applyPreferences(event.detail);
      else load();
    };
    window.addEventListener('astera:option-preferences', onPreferenceChange);
    window.addEventListener('focus', load);
    load();
    return () => {
      controller.abort();
      window.removeEventListener('astera:option-preferences', onPreferenceChange);
      window.removeEventListener('focus', load);
    };
  }, []);

  const clearPrivateOutputTimer = useCallback(() => {
    if (privateOutputTimer.current !== null) {
      window.clearTimeout(privateOutputTimer.current);
      privateOutputTimer.current = null;
    }
  }, []);

  const armPrivateOutputExpiry = useCallback(() => {
    clearPrivateOutputTimer();
    if (!privateMode) return;
    privateOutputTimer.current = window.setTimeout(() => {
      privateOutputTimer.current = null;
      setResultSections([]);
      setPrompt('');
      setCurrentJobId('');
      setRevisionBaseline(null);
      setPromptExpanded(false);
      setEstimate(null);
      setPhase('draft');
      setNotice('Private Mode Outputの60分TTLが終了したため、この端末Memoryから破棄しました。');
    }, PRIVATE_OUTPUT_TTL_MS);
  }, [clearPrivateOutputTimer, privateMode]);

  useEffect(() => () => {
    pollController.current?.abort();
    clearPrivateOutputTimer();
  }, [clearPrivateOutputTimer]);

  const readyFileIds = files.filter((file) => file.status === 'ready' && file.uploadId).map((file) => file.uploadId as string);
  const hasPendingFiles = files.some((file) => file.status === 'uploading');
  const hasFailedFiles = files.some((file) => file.status === 'error');

  const executionOptions = useMemo(() => selectedOptions.map((key) => {
    if (key === 'translation') return { key, profileVersion: 'translation-flash-lite', targetLanguage };
    if (key === 'agent-mode') return { key, policyVersion: 'v1', mode: agentMode };
    if (key === 'document') return { key, templateSource: documentTemplateSource, templateId: documentTemplateId, templateVersion: 'latest' };
    return { key, destinationId: storageDestinationId, adapterVersion: 'v1', format: 'markdown' };
  }), [agentMode, documentTemplateId, documentTemplateSource, selectedOptions, storageDestinationId, targetLanguage]);

  const revisionPayload = useMemo(() => revisionBaseline && revisionBaseline.privateMode === privateMode
    ? {
        revision_of_job_id: revisionBaseline.jobId,
        revision_base_prompt: revisionBaseline.prompt,
      }
    : {}, [privateMode, revisionBaseline]);

  const requestFingerprint = useMemo(() => JSON.stringify({
    prompt,
    purpose,
    options: executionOptions,
    fileIds: readyFileIds,
    privateMode,
    projectId,
    revision: revisionBaseline?.jobId ?? '',
  }), [executionOptions, privateMode, projectId, prompt, purpose, readyFileIds, revisionBaseline?.jobId]);

  useEffect(() => {
    setEstimate(null);
    estimateFingerprint.current = '';
    if (!['submitting', 'queued', 'running', 'assembling_result'].includes(phase)) setPhase('draft');
  }, [requestFingerprint]);

  const validate = useCallback((): ApiError | null => {
    if (!prompt.trim()) return new ApiError('実行する本文を入力してください。', 422, 'ASTERA_INPUT_REQUIRED');
    if ([...prompt].length > MAX_INPUT_CHARACTERS) return new ApiError(`入力は${MAX_INPUT_CHARACTERS.toLocaleString()}文字以内です。`, 413, 'ASTERA_INPUT_TOO_LARGE');
    if (hasPendingFiles) return new ApiError('File Uploadの完了を待ってください。', 409, 'FILE_UPLOAD_IN_PROGRESS');
    if (hasFailedFiles) return new ApiError('Uploadに失敗したFileをRetryまたは削除してください。', 409, 'FILE_UPLOAD_FAILED');
    if (files.length !== readyFileIds.length) return new ApiError('実Byte参照がないFileは実行できません。', 409, 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED');
    if (selectedOptions.includes('translation') && !targetLanguage.trim()) return new ApiError('翻訳先言語を選択してください。', 422, 'TARGET_LANGUAGE_REQUIRED');
    if (selectedOptions.includes('document') && !documentTemplateId.trim()) return new ApiError('書類Templateを選択してください。', 422, 'DOCUMENT_TEMPLATE_REQUIRED');
    if (selectedOptions.includes('external-storage-transfer') && !storageDestinationId.trim()) return new ApiError('転送先Storageを選択してください。', 422, 'STORAGE_DESTINATION_REQUIRED');
    return null;
  }, [documentTemplateId, files.length, hasFailedFiles, hasPendingFiles, prompt, readyFileIds.length, selectedOptions, storageDestinationId, targetLanguage]);

  const uploadFile = useCallback(async (file: File, localId: string) => {
    const requestId = crypto.randomUUID();
    setPhase('uploading');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('private_mode', privateMode ? 'true' : 'false');
      const response = await fetch(apiUrl('/api/uploads'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Idempotency-Key': requestId, 'X-Request-ID': requestId },
        body: form,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const source = asRecord(asRecord(payload).error ?? payload);
        throw new ApiError(recordText(source, ['message'], `Uploadに失敗しました (${response.status})`), response.status, recordText(source, ['code'], `HTTP_${response.status}`), payload);
      }
      const source = asRecord(asRecord(payload).file ?? asRecord(payload).data ?? payload);
      const uploadId = recordText(source, ['upload_id', 'object_id', 'storage_reference', 'id']);
      if (!uploadId) throw new ApiError('Upload済み実Byte参照を受信できませんでした。', 502, 'UPLOAD_REFERENCE_MISSING', payload);
      setFiles((current) => current.map((item) => item.localId === localId ? { ...item, status: 'ready', uploadId, error: undefined } : item));
      setPhase('draft');
    } catch (caught) {
      const uploadError = caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : 'Uploadに失敗しました。', 0, 'FILE_UPLOAD_FAILED');
      setFiles((current) => current.map((item) => item.localId === localId ? { ...item, status: 'error', error: `${uploadError.message} (${uploadError.code})` } : item));
      setPhase('draft');
    }
  }, [privateMode]);

  const addFiles = useCallback((chosen: File[]) => {
    for (const file of chosen) {
      const localId = crypto.randomUUID();
      setFiles((current) => [...current, {
        localId,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        status: 'uploading',
      }]);
      void uploadFile(file, localId);
    }
  }, [uploadFile]);

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const retryFile = (entry: UploadedFile) => {
    setFiles((current) => current.map((item) => item.localId === entry.localId ? { ...item, status: 'uploading', error: undefined } : item));
    void uploadFile(entry.file, entry.localId);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files ?? []);
    if (pasted.length > 0) addFiles(pasted);
  };

  const onDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  };

  const reorderFile = (from: number, to: number) => {
    setFiles((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const toggleOption = (key: CurrentExecutionOptionKey) => {
    setSelectedOptions((current) => {
      if (current.includes(key)) {
        if (key === 'external-storage-transfer') setStorageDestinationId('');
        return current.filter((value) => value !== key);
      }
      if (key === 'translation' && !targetLanguage.trim()) setTargetLanguage(defaultLanguage());
      return [...current, key];
    });
  };

  const selectAgentMode = (mode: AgentMode) => {
    const disableCurrent = selectedOptions.includes('agent-mode') && agentMode === mode;
    setAgentMode(mode);
    setSelectedOptions((current) => {
      if (disableCurrent) return current.filter((value) => value !== 'agent-mode');
      return current.includes('agent-mode') ? current : [...current, 'agent-mode'];
    });
  };

  const loadCatalogs = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [projectPayload, templatePayload, storagePayload] = await Promise.all([
        apiRequest('/api/projects').catch(() => null),
        apiRequest('/api/templates').catch(() => null),
        apiRequest('/api/storage/destinations').catch(() => null),
      ]);
      setProjects(records(projectPayload, ['projects', 'items']).map((item) => catalogItem(item, 'project')).filter((item): item is CatalogItem => item !== null));
      setTemplates(records(templatePayload, ['templates', 'items']).map((item) => catalogItem(item, 'template')).filter((item): item is CatalogItem => item !== null));
      setDestinations(records(storagePayload, ['destinations', 'items'])
        .map((item) => catalogItem(item, 'storage'))
        .filter((item): item is CatalogItem => item !== null && !['revoked', 'deleted'].includes((item.status ?? '').toLowerCase())));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const openContextPicker = () => {
    setPicker('context');
    void loadCatalogs();
  };

  const estimateJob = useCallback(async () => {
    if (executionLock.current) return;
    clearPrivateOutputTimer();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setPhase('failed');
      return;
    }
    executionLock.current = true;
    setError(null);
    setNotice('');
    setPhase('estimating');
    try {
      const payload = await apiRequest('/api/jobs/estimate', {
        method: 'POST',
        body: {
          prompt: prompt.trim(),
          purpose,
          options: executionOptions,
          file_ids: readyFileIds,
          private_mode: privateMode,
          project_id: projectId || null,
          ...revisionPayload,
        },
        idempotent: true,
      });
      const nextEstimate = extractEstimate(payload);
      setEstimate(nextEstimate);
      estimateFingerprint.current = requestFingerprint;
      setPhase('confirmation');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : '見積りに失敗しました。'));
      setPhase('failed');
    } finally {
      executionLock.current = false;
    }
  }, [clearPrivateOutputTimer, executionOptions, privateMode, projectId, prompt, purpose, readyFileIds, requestFingerprint, revisionPayload, validate]);

  const pollJob = useCallback(async (id: string, submittedPrompt: string) => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (controller.signal.aborted) return;
      const payload = await apiRequest(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal, timeoutMs: 15_000 });
      const state = jobState(payload);
      if (['queued', 'validating', 'reserving_credit', 'uploading'].includes(state)) setPhase('queued');
      else if (state === 'running') setPhase('running');
      else if (state === 'assembling_result' || state === 'assembling') setPhase('assembling_result');
      else if (state === 'completed' || state === 'complete') {
        setResultSections(normalizeResult(payload));
        setRevisionBaseline({ jobId: id, prompt: submittedPrompt, privateMode });
        setPhase('completed');
        setNotice(privateMode
          ? 'Private Mode Resultは保存されません。Outputはこの端末Memoryでも60分後に破棄されます。'
          : 'Resultを保存しました。必要なら本文を修整して再投稿できます。');
        armPrivateOutputExpiry();
        return;
      } else if (state === 'cancelled' || state === 'canceled') {
        setPhase('cancelled');
        setNotice('Jobを取り消しました。入力内容は保持しています。');
        return;
      } else if (state === 'failed' || state === 'partially_completed' || state === 'partial') {
        throw new ApiError(recordText(jobSource(payload), ['message', 'error_message'], 'Jobを完了できませんでした。'), 502, recordText(jobSource(payload), ['error_code', 'code'], 'JOB_FAILED'), payload);
      }
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(800 + attempt * 100, 2_500)));
    }
    throw new ApiError('Job状態の確認期限を超えました。Historyから状態を再確認してください。', 504, 'JOB_POLL_TIMEOUT');
  }, [armPrivateOutputExpiry, privateMode]);

  const submitJob = useCallback(async () => {
    if (executionLock.current || !estimate) return;
    if (estimateFingerprint.current !== requestFingerprint) {
      setEstimate(null);
      setError(new ApiError('入力条件が変わったため、もう一度予定Creditを確認してください。', 409, 'ESTIMATE_STALE'));
      setPhase('failed');
      return;
    }
    if (new Date(estimate.expiresAt).getTime() <= Date.now()) {
      setEstimate(null);
      setError(new ApiError('見積りの有効期限が切れました。もう一度確認してください。', 409, 'ESTIMATE_EXPIRED'));
      setPhase('failed');
      return;
    }
    if (estimate.creditState === 'insufficient' || estimate.availableCredits < estimate.requiredCredits) {
      setPhase('confirmation');
      return;
    }

    executionLock.current = true;
    setError(null);
    setNotice('');
    setPhase('submitting');
    const requestId = crypto.randomUUID();
    const submittedPrompt = prompt.trim();
    try {
      const payload = await apiRequest('/api/jobs', {
        method: 'POST',
        idempotencyKey: requestId,
        body: {
          request_id: requestId,
          prompt: submittedPrompt,
          purpose,
          options: executionOptions,
          file_ids: readyFileIds,
          private_mode: privateMode,
          project_id: projectId || null,
          estimate_id: estimate.estimateId,
          ...revisionPayload,
        },
      });
      const id = jobId(payload);
      if (!id) throw new ApiError('作成されたJob IDを受信できませんでした。', 502, 'JOB_ID_MISSING', payload);
      setCurrentJobId(id);
      const immediateState = jobState(payload);
      if (immediateState === 'completed' || immediateState === 'complete') {
        setResultSections(normalizeResult(payload));
        setRevisionBaseline({ jobId: id, prompt: submittedPrompt, privateMode });
        setPhase('completed');
        setNotice(privateMode
          ? 'Private Mode Resultは保存されません。Outputはこの端末Memoryでも60分後に破棄されます。'
          : 'Resultを保存しました。必要なら本文を修整して再投稿できます。');
        armPrivateOutputExpiry();
        return;
      }
      setPhase('queued');
      await pollJob(id, submittedPrompt);
    } catch (caught) {
      const jobError = caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : 'Jobを開始できませんでした。');
      setError(jobError);
      setPhase('failed');
    } finally {
      executionLock.current = false;
    }
  }, [armPrivateOutputExpiry, estimate, executionOptions, pollJob, privateMode, projectId, prompt, purpose, readyFileIds, requestFingerprint, revisionPayload]);

  const cancelJob = async () => {
    if (!currentJobId) return;
    try {
      await apiRequest(`/api/jobs/${encodeURIComponent(currentJobId)}/cancel`, { method: 'POST', idempotent: true });
      pollController.current?.abort();
      clearPrivateOutputTimer();
      setPhase('cancelled');
      setNotice('取消Requestを送信しました。入力内容は保持しています。');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('取消Requestに失敗しました。'));
    }
  };

  const resetComposer = () => {
    pollController.current?.abort();
    clearPrivateOutputTimer();
    setPrompt('');
    setPurpose('auto');
    setSelectedOptions([]);
    setTargetLanguage(defaultLanguage());
    setAgentMode('medium');
    setDocumentTemplateId('');
    setDocumentTemplateSource('personal');
    setStorageDestinationId('');
    setProjectId('');
    setFiles([]);
    setEstimate(null);
    setResultSections([]);
    setCurrentJobId('');
    setRevisionBaseline(null);
    setError(null);
    setNotice('');
    setPhase('draft');
    setPicker(null);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === '/' || event.key === '@') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const start = event.currentTarget.selectionStart ?? 0;
      const end = event.currentTarget.selectionEnd ?? start;
      if (start === end && (start === 0 || /\s/.test(event.currentTarget.value[start - 1] ?? ''))) {
        event.preventDefault();
        if (event.key === '/') setPicker('add');
        else openContextPicker();
        return;
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void estimateJob();
    }
  };

  const activeWork = ['uploading', 'estimating', 'submitting', 'queued', 'running', 'assembling_result'].includes(phase);
  const preview = prompt.replace(/\s+/g, ' ').trim().slice(0, 96);
  const selectedProject = projects.find((item) => item.id === projectId);
  const visibleOptionKeys = CURRENT_OPTION_KEYS.filter((key) => optionVisibility[key]);
  const chips = [
    ...selectedOptions.filter((key): key is CurrentExecutionOptionKey => key !== 'document').map((key) => OPTION_LABELS[key]),
    ...(projectId ? [`Project:${selectedProject?.title ?? projectId}`] : []),
  ];

  const renderPurposeAccordion = () => (
    <details className="native-option-accordion native-purpose-accordion">
      <summary className={purpose === 'auto' ? 'native-option-accordion-trigger' : 'native-option-accordion-trigger is-selected'}>
        <span>用途・目的</span>
        <b>{purpose === 'auto' ? '›' : PURPOSE_LABELS[purpose]}</b>
      </summary>
      <div className="native-agent-mode-choices">
        {PURPOSE_CHOICES.map((item) => {
          const active = purpose === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={active ? 'is-selected' : ''}
              aria-pressed={active}
              onClick={(event) => {
                setPurpose((current) => current === item.key ? 'auto' : item.key);
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              <span>{item.label}</span>
              {active && <b aria-hidden="true">✓</b>}
            </button>
          );
        })}
      </div>
    </details>
  );

  const renderVisibleOptions = () => visibleOptionKeys.map((key) => {
    if (key === 'agent-mode') {
      const selected = selectedOptions.includes('agent-mode');
      return (
        <details key={key} className="native-option-accordion">
          <summary className={selected ? 'native-option-accordion-trigger is-selected' : 'native-option-accordion-trigger'}>
            <span>{OPTION_LABELS[key]}</span>
            <b>{selected ? AGENT_MODE_LABELS[agentMode] : '›'}</b>
          </summary>
          <div className="native-agent-mode-choices">
            {AGENT_MODE_CHOICES.map((choice) => {
              const active = selected && agentMode === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  className={active ? 'is-selected' : ''}
                  aria-pressed={active}
                  onClick={() => selectAgentMode(choice.key)}
                >
                  <span>{choice.label}</span>
                  {active && <b aria-hidden="true">✓</b>}
                </button>
              );
            })}
          </div>
        </details>
      );
    }
    return (
      <button key={key} type="button" className={selectedOptions.includes(key) ? 'is-selected' : ''} onClick={() => toggleOption(key)}>
        <span>{OPTION_LABELS[key]}</span>
      </button>
    );
  });

  const pickerBody = picker && (
    <div className="native-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setPicker(null);
    }}>
      <section className="native-picker" role="dialog" aria-modal="true" aria-label={picker === 'add' ? '追加' : 'Option・対象選択'}>
        <header>
          <strong>{picker === 'add' ? '追加' : 'Option・対象'}</strong>
          <button type="button" aria-label="閉じる" onClick={() => setPicker(null)}>×</button>
        </header>
        <div className="native-picker-body">
          {picker === 'add' && (
            <>
              <button type="button" onClick={() => { setPicker(null); fileInputRef.current?.click(); }}><span>Fileを追加</span><b>＋</b></button>
              {renderPurposeAccordion()}
              {renderVisibleOptions()}
            </>
          )}
          {picker === 'context' && (
            <>
              {catalogLoading && <p className="native-picker-status">登録済み項目を読み込んでいます…</p>}
              {renderVisibleOptions()}
              {selectedOptions.includes('translation') && optionVisibility.translation && (
                <label className="native-picker-field"><span>翻訳先言語</span><input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} placeholder="例: English / ja-JP" /></label>
              )}
              {selectedOptions.includes('external-storage-transfer') && optionVisibility['external-storage-transfer'] && (
                <>
                  <label className="native-picker-field"><span>外部Storage転送先</span><select value={storageDestinationId} onChange={(event) => setStorageDestinationId(event.target.value)}><option value="">選択してください</option>{destinations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                  <a className="native-picker-link" href="/app/settings/storage-destinations">外部Storage設定を開く</a>
                </>
              )}
              <label className="native-picker-field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Projectなし</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <button type="button" className="native-picker-apply" onClick={() => setPicker(null)}>完了</button>
            </>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="native-composer-workspace" data-native-composer="true" onDragOver={(event) => event.preventDefault()} onDrop={onDropFiles}>
        <section className="native-timeline" aria-live="polite">
          <div className="native-timeline-inner">
            {resultSections.length === 0 && !activeWork && !error && (
              <div className="native-empty-state">
                <h1>何を判断材料にしますか？</h1>
                <p>本文を入力し、必要な時だけ <strong>/</strong>・<strong>＋</strong>・<strong>@</strong> を使います。</p>
              </div>
            )}

            {(resultSections.length > 0 || activeWork || error) && (
              <article className="native-turn">
                <section className="native-user-message">
                  <button type="button" className="native-user-message-trigger" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((value) => !value)}>
                    <span>{promptExpanded ? '投稿内容を閉じる' : '投稿内容を表示'}</span>
                    {!promptExpanded && <small>{preview}{prompt.length > 96 ? '…' : ''}</small>}
                    <b aria-hidden="true">{promptExpanded ? '⌃' : '⌄'}</b>
                  </button>
                  {promptExpanded && <p>{prompt}</p>}
                  {chips.length > 0 && <div className="native-message-chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>}
                </section>

                {activeWork && (
                  <section className="native-processing" role="status">
                    <span className="native-processing-dot" />
                    <div><strong>{phaseLabel(phase)}</strong><small>{currentJobId ? `Job ${currentJobId}` : 'Asteraが処理を進めています'}</small></div>
                    {['queued', 'running', 'assembling_result'].includes(phase) && <button type="button" onClick={() => void cancelJob()}>取消</button>}
                  </section>
                )}

                {error && (
                  <section className="native-error" role="alert">
                    <div><strong>{error.message}</strong><code>{error.code}</code></div>
                    <button type="button" onClick={() => { setError(null); setPhase('draft'); }}>閉じる</button>
                  </section>
                )}

                {resultSections.length > 0 && (
                  <section className="native-response">
                    <header><strong>ASTERA</strong><button type="button" onClick={() => void navigator.clipboard?.writeText(resultSections.map((section) => `${section.title}\n${section.body}`).join('\n\n'))}>全てコピー</button></header>
                    <div className="native-result-sections">
                      {resultSections.map((section, index) => (
                        <article key={section.key} className="native-result-section">
                          <div className="native-result-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><button type="button" aria-label={`${section.title}をコピー`} onClick={() => void navigator.clipboard?.writeText(section.body)}>コピー</button></div>
                          <p>{section.body}</p>
                          {section.sourceIds.length > 0 && <small>Source: {section.sourceIds.join(', ')}</small>}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </article>
            )}
          </div>
        </section>

        <section className="native-composer-dock">
          {notice && <div className="native-notice" role="status">{notice}</div>}
          {chips.length > 0 && <div className="native-selected-chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>}
          {files.length > 0 && (
            <ul className="native-file-queue" aria-label="File Queue">
              {files.map((file, index) => (
                <li
                  key={file.localId}
                  draggable={file.status !== 'uploading'}
                  onDragStart={() => { dragIndex.current = index; }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex.current !== null) reorderFile(dragIndex.current, index);
                    dragIndex.current = null;
                  }}
                >
                  <div><strong>{file.name}</strong><small>{file.status === 'ready' ? 'Upload完了' : file.status === 'uploading' ? 'Uploading…' : file.error}</small></div>
                  <div>
                    {file.status === 'error' && <button type="button" onClick={() => retryFile(file)}>Retry</button>}
                    <button type="button" onClick={() => setFiles((current) => current.filter((item) => item.localId !== file.localId))} disabled={file.status === 'uploading'}>×</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="native-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={onPaste}
              maxLength={MAX_INPUT_CHARACTERS}
              rows={1}
              placeholder="Asteraに判断材料へ変えてほしい内容を入力"
              aria-label="Astera入力"
            />
            <div className="native-composer-actions">
              <div className="native-left-tools">
                <button type="button" className="native-round-button" aria-label="Fileと実行Optionを追加" onClick={() => setPicker('add')}>＋</button>
              </div>
              <div className="native-right-tools">
                {resultSections.length > 0 && <button type="button" className="native-text-button" onClick={resetComposer}>新規</button>}
                <button type="button" className="native-run-button" aria-label="予定Creditを確認" onClick={() => void estimateJob()} disabled={activeWork || !prompt.trim()}>↑</button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesSelected} />
          </div>
          <div className="native-composer-hint"><span>Enter＝改行 / Ctrl・⌘＋Enter＝実行前確認</span><span>{[...prompt].length.toLocaleString()} / {MAX_INPUT_CHARACTERS.toLocaleString()}</span></div>
        </section>

        {estimate && phase === 'confirmation' && (
          <div className="native-sheet-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) { setEstimate(null); setPhase('draft'); }
          }}>
            <section className={`native-confirm-sheet is-${estimate.creditState}`} role="dialog" aria-modal="true" aria-labelledby="native-confirm-title">
              <header><div><small>{estimate.creditState.toUpperCase()}</small><h2 id="native-confirm-title">実行前確認</h2></div><button type="button" onClick={() => { setEstimate(null); setPhase('draft'); }}>×</button></header>
              <dl>
                <div><dt>今回の予定Credit</dt><dd>{estimate.requiredCredits.toLocaleString()}</dd></div>
                <div><dt>利用可能Credit</dt><dd>{estimate.availableCredits.toLocaleString()}</dd></div>
                <div><dt>予約中Credit</dt><dd>{estimate.reservedCredits.toLocaleString()}</dd></div>
                <div><dt>実行後見込</dt><dd>{Math.max(0, estimate.availableCredits - estimate.requiredCredits).toLocaleString()}</dd></div>
                {estimate.estimatedRemainingRuns !== undefined && <div><dt>概算残り実行回数</dt><dd>{estimate.estimatedRemainingRuns.toLocaleString()}</dd></div>}
                {estimate.billingMode === 'revision' && estimate.billableCharacters !== undefined && <div><dt>修整Credit対象文字数</dt><dd>{estimate.billableCharacters.toLocaleString()}</dd></div>}
              </dl>
              {(estimate.creditState === 'low' || estimate.creditState === 'critical') && <p className="native-credit-warning">Credit残高が少なくなっています。</p>}
              {estimate.creditState === 'insufficient' || estimate.availableCredits < estimate.requiredCredits ? (
                <div className="native-sheet-actions">
                  <p>Credit不足のためJobは開始しません。入力内容は保持しています。</p>
                  <a href={`/account/credit?return_to=${encodeURIComponent(window.location.pathname)}`}>Creditを追加</a>
                  <button type="button" onClick={() => { setEstimate(null); setPhase('draft'); }}>内容を修正</button>
                </div>
              ) : (
                <div className="native-sheet-actions">
                  <button type="button" className="is-primary" onClick={() => void submitJob()} disabled={activeWork}>Creditを予約して実行</button>
                  <button type="button" onClick={() => { setEstimate(null); setPhase('draft'); }}>戻る</button>
                </div>
              )}
            </section>
          </div>
        )}

        {pickerBody}
      </div>
    </ResponsivePageShell>
  );
}
