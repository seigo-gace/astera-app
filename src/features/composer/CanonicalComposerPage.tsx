import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { ApiError, apiRequest, apiUrl, asArray, asRecord, recordText } from '../../platform/api-client';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './canonical-composer.css';

type PurposeKey = 'auto' | 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
type ExecutionOptionKey = 'translation' | 'agent-mode' | 'document' | 'external-storage-transfer';
type CreditState = 'normal' | 'low' | 'critical' | 'insufficient' | 'purchase_pending' | 'credited' | 'resume_available' | 'resume_blocked';
type ComposerPhase = 'draft' | 'uploading' | 'estimating' | 'confirmation' | 'submitting' | 'queued' | 'running' | 'assembling_result' | 'completed' | 'failed' | 'cancelled';

type UploadedFile = {
  localId: string;
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
};

type ResultSection = {
  key: string;
  title: string;
  body: string;
  sourceIds: string[];
};

type DraftSnapshot = {
  prompt: string;
  purpose: PurposeKey;
  selectedOptions: ExecutionOptionKey[];
  targetLanguage: string;
  agentMode: 'low' | 'medium' | 'high';
  documentTemplateId: string;
  storageDestinationId: string;
  privateMode: boolean;
  projectId: string;
};

const DRAFT_STORAGE_KEY = 'astera-canonical-composer-draft-v1';
const MAX_INPUT_CHARACTERS = 200_000;
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

const PURPOSES: ReadonlyArray<{ key: PurposeKey; label: string; description: string }> = [
  { key: 'auto', label: '自動', description: '入力内容から最適な観点を選択' },
  { key: 'review', label: 'レビュー', description: '内容の妥当性と改善点を確認' },
  { key: 'compare', label: '比較', description: '複数案を同じ条件で比較' },
  { key: 'verify', label: '検証', description: '事実・前提・成立条件を確認' },
  { key: 'improve', label: '改善', description: '問題点を特定し改善案を整理' },
  { key: 'research', label: '調査', description: '必要な情報と根拠を収集' },
  { key: 'plan', label: '計画', description: '順序・依存関係・判断点を設計' },
  { key: 'consider', label: '検討', description: '選択肢・リスク・推奨判断を整理' },
];

const OPTION_LABELS: Record<ExecutionOptionKey, string> = {
  translation: '高精度翻訳',
  'agent-mode': 'Agent Mode',
  document: '書類作成',
  'external-storage-transfer': '外部Storage転送',
};

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

function readDraft(): DraftSnapshot {
  const fallback: DraftSnapshot = {
    prompt: '',
    purpose: 'auto',
    selectedOptions: [],
    targetLanguage: '',
    agentMode: 'medium',
    documentTemplateId: '',
    storageDestinationId: '',
    privateMode: false,
    projectId: '',
  };
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DraftSnapshot>;
    const purpose = PURPOSES.some((item) => item.key === parsed.purpose) ? parsed.purpose as PurposeKey : 'auto';
    const selectedOptions = Array.isArray(parsed.selectedOptions)
      ? parsed.selectedOptions.filter((value): value is ExecutionOptionKey => typeof value === 'string' && value in OPTION_LABELS)
      : [];
    return { ...fallback, ...parsed, purpose, selectedOptions };
  } catch {
    return fallback;
  }
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
  if (available < required) return 'insufficient';
  return 'normal';
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
    uploading: 'FileをUploadしています',
    estimating: '予定Creditと実行条件を確認しています',
    confirmation: '実行前確認',
    submitting: 'Creditを予約してJobを作成しています',
    queued: '実行待ち',
    running: 'Asteraが処理しています',
    assembling_result: '固定8項目Resultを構成しています',
    completed: '完了',
    failed: '停止',
    cancelled: '取消済み',
  };
  return labels[phase];
}

export default function CanonicalComposerPage({ route }: { route: RouteMatch }) {
  const initialDraft = useMemo(readDraft, []);
  const [prompt, setPrompt] = useState(initialDraft.prompt);
  const [purpose, setPurpose] = useState<PurposeKey>(initialDraft.purpose);
  const [selectedOptions, setSelectedOptions] = useState<ExecutionOptionKey[]>(initialDraft.selectedOptions);
  const [targetLanguage, setTargetLanguage] = useState(initialDraft.targetLanguage);
  const [agentMode, setAgentMode] = useState<'low' | 'medium' | 'high'>(initialDraft.agentMode);
  const [documentTemplateId, setDocumentTemplateId] = useState(initialDraft.documentTemplateId);
  const [storageDestinationId, setStorageDestinationId] = useState(initialDraft.storageDestinationId);
  const [privateMode, setPrivateMode] = useState(initialDraft.privateMode);
  const [projectId, setProjectId] = useState(initialDraft.projectId);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [estimate, setEstimate] = useState<JobEstimate | null>(null);
  const [phase, setPhase] = useState<ComposerPhase>('draft');
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [resultSections, setResultSections] = useState<ResultSection[]>([]);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const executionLock = useRef(false);
  const pollController = useRef<AbortController | null>(null);
  const estimateFingerprint = useRef('');

  const draftSnapshot = useMemo<DraftSnapshot>(() => ({
    prompt,
    purpose,
    selectedOptions,
    targetLanguage,
    agentMode,
    documentTemplateId,
    storageDestinationId,
    privateMode,
    projectId,
  }), [agentMode, documentTemplateId, privateMode, projectId, prompt, purpose, selectedOptions, storageDestinationId, targetLanguage]);

  useEffect(() => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftSnapshot));
  }, [draftSnapshot]);

  useEffect(() => () => pollController.current?.abort(), []);

  useEffect(() => {
    setEstimate(null);
    estimateFingerprint.current = '';
    if (!['submitting', 'queued', 'running', 'assembling_result'].includes(phase)) setPhase('draft');
  }, [draftSnapshot]);

  const readyFileIds = files.filter((file) => file.status === 'ready' && file.uploadId).map((file) => file.uploadId as string);
  const hasPendingFiles = files.some((file) => file.status === 'uploading');
  const hasFailedFiles = files.some((file) => file.status === 'error');

  const executionOptions = useMemo(() => selectedOptions.map((key) => {
    if (key === 'translation') return { key, profileVersion: 'document-v1', targetLanguage };
    if (key === 'agent-mode') return { key, policyVersion: 'v1', mode: agentMode };
    if (key === 'document') return { key, templateSource: 'personal', templateId: documentTemplateId, templateVersion: 'latest' };
    return { key, destinationId: storageDestinationId, adapterVersion: 'v1', format: 'markdown' };
  }), [agentMode, documentTemplateId, selectedOptions, storageDestinationId, targetLanguage]);

  const requestFingerprint = useMemo(() => JSON.stringify({
    prompt,
    purpose,
    options: executionOptions,
    fileIds: readyFileIds,
    privateMode,
    projectId,
  }), [executionOptions, privateMode, projectId, prompt, purpose, readyFileIds]);

  const validate = useCallback((): ApiError | null => {
    if (!prompt.trim()) return new ApiError('実行する本文を入力してください。', 422, 'ASTERA_INPUT_REQUIRED');
    if ([...prompt].length > MAX_INPUT_CHARACTERS) return new ApiError(`入力は${MAX_INPUT_CHARACTERS.toLocaleString()}文字以内です。`, 413, 'ASTERA_INPUT_TOO_LARGE');
    if (hasPendingFiles) return new ApiError('File Uploadの完了を待ってください。', 409, 'FILE_UPLOAD_IN_PROGRESS');
    if (hasFailedFiles) return new ApiError('Uploadに失敗したFileをRetryまたは削除してください。', 409, 'FILE_UPLOAD_FAILED');
    if (files.length !== readyFileIds.length) return new ApiError('実Byte参照がないFileは実行できません。', 409, 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED');
    if (selectedOptions.includes('translation') && !targetLanguage.trim()) return new ApiError('翻訳先言語を指定してください。', 422, 'TARGET_LANGUAGE_REQUIRED');
    if (selectedOptions.includes('document') && !documentTemplateId.trim()) return new ApiError('書類Templateを指定してください。', 422, 'DOCUMENT_TEMPLATE_REQUIRED');
    if (selectedOptions.includes('external-storage-transfer') && !storageDestinationId.trim()) return new ApiError('転送先Storageを指定してください。', 422, 'STORAGE_DESTINATION_REQUIRED');
    if (privateMode && selectedOptions.includes('external-storage-transfer')) return new ApiError('Private Modeでは外部Storage転送を実行できません。', 422, 'PRIVATE_MODE_TRANSFER_FORBIDDEN');
    return null;
  }, [documentTemplateId, files.length, hasFailedFiles, hasPendingFiles, privateMode, prompt, readyFileIds.length, selectedOptions, storageDestinationId, targetLanguage]);

  const uploadFile = useCallback(async (file: File, localId: string) => {
    const requestId = crypto.randomUUID();
    try {
      const form = new FormData();
      form.append('file', file, file.name);
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
    } catch (caught) {
      const uploadError = caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : 'Uploadに失敗しました。', 0, 'FILE_UPLOAD_FAILED');
      setFiles((current) => current.map((item) => item.localId === localId ? { ...item, status: 'error', error: `${uploadError.message} (${uploadError.code})` } : item));
    }
  }, []);

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    for (const file of chosen) {
      const localId = crypto.randomUUID();
      setFiles((current) => [...current, { localId, name: file.name, size: file.size, type: file.type || 'application/octet-stream', status: 'uploading' }]);
      void uploadFile(file, localId);
    }
    event.target.value = '';
  };

  const toggleOption = (key: ExecutionOptionKey) => {
    setSelectedOptions((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  };

  const estimateJob = useCallback(async () => {
    if (executionLock.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setPhase('failed');
      return;
    }
    executionLock.current = true;
    setError(null);
    setNotice('');
    setResultSections([]);
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
  }, [executionOptions, privateMode, projectId, prompt, purpose, readyFileIds, requestFingerprint, validate]);

  const pollJob = useCallback(async (id: string) => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (controller.signal.aborted) return;
      const payload = await apiRequest(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal, timeoutMs: 15_000 });
      const state = jobState(payload);
      if (state === 'queued' || state === 'validating' || state === 'reserving_credit' || state === 'uploading') setPhase('queued');
      else if (state === 'running') setPhase('running');
      else if (state === 'assembling_result' || state === 'assembling') setPhase('assembling_result');
      else if (state === 'completed' || state === 'complete') {
        setResultSections(normalizeResult(payload));
        setPhase('completed');
        setNotice('Resultを保存しました。HistoryとProjectから再確認できます。');
        localStorage.removeItem(DRAFT_STORAGE_KEY);
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
  }, []);

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
    try {
      const payload = await apiRequest('/api/jobs', {
        method: 'POST',
        idempotencyKey: requestId,
        body: {
          request_id: requestId,
          prompt: prompt.trim(),
          purpose,
          options: executionOptions,
          file_ids: readyFileIds,
          private_mode: privateMode,
          project_id: projectId || null,
          estimate_id: estimate.estimateId,
        },
      });
      const id = jobId(payload);
      if (!id) throw new ApiError('作成されたJob IDを受信できませんでした。', 502, 'JOB_ID_MISSING', payload);
      setCurrentJobId(id);
      const immediateState = jobState(payload);
      if (immediateState === 'completed' || immediateState === 'complete') {
        setResultSections(normalizeResult(payload));
        setPhase('completed');
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        return;
      }
      setPhase('queued');
      await pollJob(id);
    } catch (caught) {
      const jobError = caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : 'Jobを開始できませんでした。');
      setError(jobError);
      setPhase('failed');
    } finally {
      executionLock.current = false;
    }
  }, [estimate, executionOptions, pollJob, privateMode, projectId, prompt, purpose, readyFileIds, requestFingerprint]);

  const cancelJob = async () => {
    if (!currentJobId) return;
    try {
      await apiRequest(`/api/jobs/${encodeURIComponent(currentJobId)}/cancel`, { method: 'POST', idempotent: true });
      pollController.current?.abort();
      setPhase('cancelled');
      setNotice('取消Requestを送信しました。入力内容は保持しています。');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('取消Requestに失敗しました。'));
    }
  };

  const resetComposer = () => {
    pollController.current?.abort();
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setPrompt('');
    setPurpose('auto');
    setSelectedOptions([]);
    setTargetLanguage('');
    setAgentMode('medium');
    setDocumentTemplateId('');
    setStorageDestinationId('');
    setPrivateMode(false);
    setProjectId('');
    setFiles([]);
    setEstimate(null);
    setResultSections([]);
    setCurrentJobId('');
    setError(null);
    setNotice('');
    setPhase('draft');
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void estimateJob();
    }
  };

  const activeWork = ['uploading', 'estimating', 'submitting', 'queued', 'running', 'assembling_result'].includes(phase);
  const preview = prompt.replace(/\s+/g, ' ').trim().slice(0, 96);

  const composerBody = (
    <>
      <section className="canonical-composer-card">
        <div className="canonical-composer-toolbar">
          <span className="canonical-phase" role="status" aria-live="polite">{phaseLabel(phase)}</span>
          <div>
            <button type="button" className="platform-button" onClick={() => setFullscreen(true)}>全画面</button>
            <button type="button" className="platform-button" onClick={resetComposer} disabled={activeWork}>新規</button>
          </div>
        </div>

        <label className="canonical-field">
          <span>本文</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            maxLength={MAX_INPUT_CHARACTERS}
            rows={10}
            placeholder="判断材料に変えたい内容を入力してください。Enterは改行、Ctrl／Command＋Enterで実行前確認を開きます。"
          />
          <small>{[...prompt].length.toLocaleString()} / {MAX_INPUT_CHARACTERS.toLocaleString()}</small>
        </label>

        <fieldset className="canonical-purpose-grid">
          <legend>Purpose（1つだけ選択）</legend>
          {PURPOSES.map((item) => (
            <label key={item.key} className={purpose === item.key ? 'is-selected' : ''}>
              <input type="radio" name="purpose" value={item.key} checked={purpose === item.key} onChange={() => setPurpose(item.key)} />
              <strong>{item.label}</strong><span>{item.description}</span>
            </label>
          ))}
        </fieldset>

        <section className="canonical-option-section">
          <h2>実行Option</h2>
          <div className="canonical-option-grid">
            {(Object.keys(OPTION_LABELS) as ExecutionOptionKey[]).map((key) => (
              <label key={key} className={selectedOptions.includes(key) ? 'is-selected' : ''}>
                <input type="checkbox" checked={selectedOptions.includes(key)} onChange={() => toggleOption(key)} disabled={privateMode && key === 'external-storage-transfer'} />
                <span>{OPTION_LABELS[key]}</span>
              </label>
            ))}
          </div>
          {selectedOptions.includes('translation') && <label className="canonical-field"><span>翻訳先言語</span><input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} placeholder="例: English" /></label>}
          {selectedOptions.includes('agent-mode') && <label className="canonical-field"><span>Agent強度</span><select value={agentMode} onChange={(event) => setAgentMode(event.target.value as 'low' | 'medium' | 'high')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>}
          {selectedOptions.includes('document') && <label className="canonical-field"><span>書類Template ID</span><input value={documentTemplateId} onChange={(event) => setDocumentTemplateId(event.target.value)} /></label>}
          {selectedOptions.includes('external-storage-transfer') && <label className="canonical-field"><span>Storage Destination ID</span><input value={storageDestinationId} onChange={(event) => setStorageDestinationId(event.target.value)} /></label>}
        </section>

        <div className="canonical-two-column">
          <label className="canonical-field"><span>Project ID（任意）</span><input value={projectId} onChange={(event) => setProjectId(event.target.value)} /></label>
          <label className="canonical-private-toggle"><input type="checkbox" checked={privateMode} onChange={(event) => { setPrivateMode(event.target.checked); if (event.target.checked) setSelectedOptions((current) => current.filter((key) => key !== 'external-storage-transfer')); }} /><span><strong>Private Mode</strong><small>本文・Fileを通常保存対象から除外</small></span></label>
        </div>

        <section className="canonical-files">
          <div className="canonical-section-head"><div><h2>File Queue</h2><p>実Byte Upload完了後の参照IDだけをJobへ渡します。</p></div><label className="platform-button">Fileを追加<input type="file" multiple hidden onChange={onFilesSelected} /></label></div>
          {files.length === 0 ? <p className="canonical-empty">Fileは選択されていません。</p> : <ul>{files.map((file) => <li key={file.localId}><div><strong>{file.name}</strong><span>{file.size.toLocaleString()} bytes</span><small className={`is-${file.status}`}>{file.status === 'ready' ? 'Upload完了' : file.status === 'uploading' ? 'Uploading…' : file.error}</small></div><button type="button" className="platform-button" onClick={() => setFiles((current) => current.filter((item) => item.localId !== file.localId))} disabled={file.status === 'uploading'}>削除</button></li>)}</ul>}
        </section>

        {error && <div className="canonical-alert is-error" role="alert"><strong>{error.message}</strong><code>{error.code}</code></div>}
        {notice && <div className="canonical-alert is-success" role="status">{notice}</div>}

        <div className="canonical-primary-actions">
          <button type="button" className="platform-button is-primary" onClick={() => void estimateJob()} disabled={activeWork || !prompt.trim()}>予定Creditを確認</button>
          {currentJobId && <a className="platform-button" href={`/app/results/${encodeURIComponent(currentJobId)}`}>保存Resultを開く</a>}
          {['queued', 'running', 'assembling_result'].includes(phase) && <button type="button" className="platform-button" onClick={() => void cancelJob()}>取消</button>}
        </div>
      </section>

      {estimate && phase === 'confirmation' && (
        <section className={`canonical-confirmation is-${estimate.creditState}`} aria-labelledby="execution-confirmation-title">
          <div className="canonical-section-head"><div><span className="canonical-credit-state">{estimate.creditState.toUpperCase()}</span><h2 id="execution-confirmation-title">実行前確認</h2></div><button type="button" className="platform-button" onClick={() => { setEstimate(null); setPhase('draft'); }}>戻る</button></div>
          <dl>
            <div><dt>今回の予定Credit</dt><dd>{estimate.requiredCredits.toLocaleString()}</dd></div>
            <div><dt>現在利用可能量</dt><dd>{estimate.availableCredits.toLocaleString()}</dd></div>
            <div><dt>予約中Credit</dt><dd>{estimate.reservedCredits.toLocaleString()}</dd></div>
            <div><dt>実行後見込残高</dt><dd>{Math.max(0, estimate.availableCredits - estimate.requiredCredits).toLocaleString()}</dd></div>
            {estimate.estimatedRemainingRuns !== undefined && <div><dt>概算残り実行回数</dt><dd>{estimate.estimatedRemainingRuns.toLocaleString()}</dd></div>}
          </dl>
          {estimate.creditState === 'low' && <p className="canonical-warning">残高が少なくなっています。今回の実行後にCredit追加を検討してください。</p>}
          {estimate.creditState === 'critical' && <p className="canonical-warning">次回以降の実行が停止する可能性があります。</p>}
          {estimate.creditState === 'insufficient' || estimate.availableCredits < estimate.requiredCredits ? (
            <div className="canonical-insufficient-actions"><p>Credit不足のためAstera本体へ送信せず、入力内容を保持しています。</p><a className="platform-button is-primary" href={`/account/credit?return_to=${encodeURIComponent(window.location.pathname)}`}>Creditを追加</a><button type="button" className="platform-button" onClick={() => { setEstimate(null); setPhase('draft'); }}>内容を修正</button><button type="button" className="platform-button" onClick={() => setNotice('下書きをこの端末へ保存しました。')}>下書きを保存</button></div>
          ) : <button type="button" className="platform-button is-primary" onClick={() => void submitJob()} disabled={activeWork}>Creditを予約して実行</button>}
        </section>
      )}

      {resultSections.length > 0 && (
        <section className="canonical-result" aria-label="Astera固定8項目Result">
          <button type="button" className="canonical-prompt-accordion" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((value) => !value)}><span><strong>{promptExpanded ? '投稿内容を閉じる' : '投稿内容を表示'}</strong>{!promptExpanded && <small>{preview}{prompt.length > 96 ? '…' : ''}</small>}</span><span aria-hidden="true">{promptExpanded ? '⌃' : '⌄'}</span></button>
          {promptExpanded && <div className="canonical-original-prompt">{prompt}</div>}
          <div className="canonical-result-grid">{resultSections.map((section, index) => <article key={section.key}><header><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2></header><p>{section.body}</p>{section.sourceIds.length > 0 && <small>Source: {section.sourceIds.join(', ')}</small>}</article>)}</div>
        </section>
      )}
    </>
  );

  return (
    <ResponsivePageShell route={route} description="入力、実行前Credit確認、Job進捗、固定8項目Resultを一貫して扱います。" fullWidth>
      {composerBody}
      {fullscreen && <div className="canonical-fullscreen" role="dialog" aria-modal="true" aria-label="全画面入力"><div className="canonical-fullscreen-panel"><div className="canonical-section-head"><h2>全画面入力</h2><button type="button" className="platform-button" onClick={() => setFullscreen(false)}>閉じる</button></div><textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKeyDown} maxLength={MAX_INPUT_CHARACTERS} /><div className="canonical-primary-actions"><span>{[...prompt].length.toLocaleString()} / {MAX_INPUT_CHARACTERS.toLocaleString()}</span><button type="button" className="platform-button is-primary" onClick={() => { setFullscreen(false); void estimateJob(); }} disabled={!prompt.trim()}>予定Creditを確認</button></div></div></div>}
    </ResponsivePageShell>
  );
}