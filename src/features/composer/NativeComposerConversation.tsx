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
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './native-composer.css';

type PurposeKey = 'auto' | 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
type ExecutionOptionKey = 'translation' | 'agent-mode' | 'document' | 'external-storage-transfer';
type CurrentExecutionOptionKey = Exclude<ExecutionOptionKey, 'document'>;
type ComposerPhase = 'draft' | 'uploading' | 'estimating' | 'submitting' | 'queued' | 'running' | 'assembling_result' | 'completed' | 'failed' | 'cancelled';
type AgentMode = 'low' | 'medium' | 'high';
type PickerKind = 'add' | 'context' | 'purpose' | null;

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
type JobEstimate = { estimateId: string; requiredCredits: number; availableCredits: number; expiresAt: string };
type ResultSection = { key: string; title: string; body: string; sourceIds: string[] };
type ResultSource = { id: string; title: string; url: string; status: string; retrievedAt: string };
type CatalogItem = { id: string; title: string; status?: string };
type Turn = {
  id: string;
  prompt: string;
  purpose: PurposeKey;
  privateMode: boolean;
  jobId: string;
  phase: ComposerPhase;
  sections: ResultSection[];
  sources: ResultSource[];
  error: ApiError | null;
};
type EditBaseline = { turnId: string; jobId: string; prompt: string; privateMode: boolean; purpose: PurposeKey };

const MAX_INPUT_CHARACTERS = 200_000;
const PRIVATE_OUTPUT_TTL_MS = 60 * 60 * 1000;
const RESULT_KEYS: readonly string[] = [
  'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
  'counter_view', 'alternatives', 'recommendation', 'next_prompt',
];
const RESULT_TITLES: Record<string, string> = {
  true_purpose: '真の目的',
  missing_assumptions: '不足前提',
  fact_check: '事実確認',
  risk_detection: '危機・リスク',
  counter_view: '反対視点',
  alternatives: '比較案',
  recommendation: '推奨判断',
  next_prompt: '主役AIへの再指示',
};
const CURRENT_OPTION_KEYS: readonly CurrentExecutionOptionKey[] = ['translation', 'agent-mode', 'external-storage-transfer'];
const OPTION_LABELS: Record<CurrentExecutionOptionKey, string> = {
  translation: '高精度翻訳',
  'agent-mode': 'Agent Mode',
  'external-storage-transfer': '外部Storage転送',
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
const PURPOSE_LABELS: Record<PurposeKey, string> = {
  auto: 'Auto', review: 'レビュー', compare: '比較', verify: '検証', improve: '改善', research: '調査', plan: '計画', consider: '検討',
};
const AGENT_MODE_CHOICES: ReadonlyArray<{ key: AgentMode; label: string }> = [
  { key: 'low', label: 'Fast' },
  { key: 'medium', label: 'Balanced' },
  { key: 'high', label: 'Deep' },
];
const AGENT_MODE_LABELS: Record<AgentMode, string> = { low: 'Fast', medium: 'Balanced', high: 'Deep' };

function defaultLanguage(): string {
  return document.documentElement.lang || navigator.language || 'ja-JP';
}
function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}
function extractEstimate(payload: unknown): JobEstimate {
  const root = asRecord(payload);
  const source = asRecord(root.estimate ?? root.data ?? root);
  const estimateId = recordText(source, ['estimate_id', 'estimateId', 'id']);
  const requiredCredits = numberValue(source.required_credits ?? source.requiredCredits);
  const availableCredits = numberValue(source.available_credits ?? source.availableCredits);
  const expiresAt = recordText(source, ['expires_at', 'expiresAt']);
  if (!estimateId || !expiresAt || requiredCredits <= 0) {
    throw new ApiError('Server Estimateの必須項目が不足しています。', 502, 'JOB_ESTIMATE_INVALID', payload);
  }
  return { estimateId, requiredCredits, availableCredits, expiresAt };
}
function sectionBody(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(String).join('\n').trim();
  return recordText(asRecord(value), ['body', 'content', 'text']);
}
function resultRecord(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const job = asRecord(root.job ?? root.data ?? root);
  return asRecord(job.result ?? root.result ?? job);
}
function normalizeResult(payload: unknown): ResultSection[] {
  const root = asRecord(payload);
  const result = resultRecord(payload);
  const raw = result.sections ?? root.sections;
  if (Array.isArray(raw)) {
    const map = new Map<string, ResultSection>();
    for (const item of raw) {
      const record = asRecord(item);
      const key = recordText(record, ['key']);
      const body = sectionBody(record);
      if (!key || !body || map.has(key)) continue;
      map.set(key, {
        key,
        title: recordText(record, ['title'], RESULT_TITLES[key] ?? key),
        body,
        sourceIds: asArray(record.sourceIds ?? record.source_ids).map(String),
      });
    }
    const ordered = RESULT_KEYS.map((key) => map.get(key)).filter((value): value is ResultSection => Boolean(value));
    if (ordered.length === RESULT_KEYS.length) return ordered;
  }
  const objectSections = asRecord(raw);
  const normalized: ResultSection[] = [];
  for (const key of RESULT_KEYS) {
    const source = objectSections[key] ?? result[key];
    const body = sectionBody(source);
    if (!body) continue;
    const record = asRecord(source);
    normalized.push({
      key,
      title: recordText(record, ['title'], RESULT_TITLES[key] ?? key),
      body,
      sourceIds: asArray(record.sourceIds ?? record.source_ids).map(String),
    });
  }
  if (normalized.length !== RESULT_KEYS.length) {
    throw new ApiError(`固定8項目Resultが不足しています。受信: ${normalized.length}`, 502, 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE', payload);
  }
  return normalized;
}
function normalizeSources(payload: unknown): ResultSource[] {
  const result = resultRecord(payload);
  return asArray(result.sources).map((item, index) => {
    const source = asRecord(item);
    const url = recordText(source, ['url', 'source_url']);
    const id = recordText(source, ['id', 'source_id'], String(index + 1));
    return {
      id,
      title: recordText(source, ['title', 'name'], url || `Source ${index + 1}`),
      url,
      status: recordText(source, ['status', 'verification_status'], 'unverified'),
      retrievedAt: recordText(source, ['retrievedAt', 'retrieved_at']),
    };
  });
}
function jobSource(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  return asRecord(root.job ?? root.data ?? root);
}
function jobState(payload: unknown): string {
  return recordText(jobSource(payload), ['state', 'status', 'job_state']).toLowerCase();
}
function jobId(payload: unknown): string {
  return recordText(jobSource(payload), ['job_id', 'jobId', 'id']);
}
function terminalJobError(payload: unknown): ApiError {
  const source = jobSource(payload);
  const nested = asRecord(source.error);
  return new ApiError(
    recordText(nested, ['message'], recordText(source, ['message', 'error_message'], 'Jobを完了できませんでした。')),
    502,
    recordText(nested, ['code'], recordText(source, ['error_code', 'code'], 'JOB_FAILED')),
    payload,
  );
}
function phaseLabel(phase: ComposerPhase): string {
  return ({
    draft: '入力待ち', uploading: 'File Upload中', estimating: 'Credit確認中', submitting: 'Job作成中', queued: '実行待ち',
    running: 'Astera実行中', assembling_result: 'Result構成中', completed: '完了', failed: '停止', cancelled: '取消済み',
  } satisfies Record<ComposerPhase, string>)[phase];
}
function records(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[];
  const data = asRecord(root.data);
  for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[];
  return [];
}
function catalogItem(value: unknown, kind: 'project' | 'storage'): CatalogItem | null {
  const record = asRecord(value);
  const id = kind === 'project' ? recordText(record, ['project_id', 'id']) : recordText(record, ['destination_id', 'id']);
  if (!id) return null;
  const title = kind === 'project' ? recordText(record, ['name', 'title'], id) : recordText(record, ['display_name', 'name', 'provider'], id);
  return { id, title, status: recordText(record, ['status']) };
}
function hydratePersistedTurn(value: unknown): Turn | null {
  const record = asRecord(value);
  const id = recordText(record, ['turn_id', 'id']);
  const jobIdValue = recordText(record, ['job_id']);
  const prompt = recordText(record, ['prompt']);
  const rawPurpose = recordText(record, ['purpose'], 'auto');
  const purpose: PurposeKey = ['auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'].includes(rawPurpose)
    ? rawPurpose as PurposeKey
    : 'auto';
  if (!id || !jobIdValue || !prompt) return null;
  const result = asRecord(record.result);
  if (!Object.keys(result).length) {
    return { id, prompt, purpose, privateMode: false, jobId: jobIdValue, phase: 'queued', sections: [], sources: [], error: null };
  }
  try {
    return {
      id,
      prompt,
      purpose,
      privateMode: false,
      jobId: jobIdValue,
      phase: 'completed',
      sections: normalizeResult({ result }),
      sources: normalizeSources({ result }),
      error: null,
    };
  } catch {
    return {
      id,
      prompt,
      purpose,
      privateMode: false,
      jobId: jobIdValue,
      phase: 'failed',
      sections: [],
      sources: [],
      error: new ApiError('保存済みResultの固定8項目を復元できません。', 502, 'CONVERSATION_RESULT_INVALID'),
    };
  }
}

export default function NativeComposerConversation({ route }: { route: RouteMatch }) {
  const [prompt, setPrompt] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [purpose, setPurpose] = useState<PurposeKey>('auto');
  const [selectedOptions, setSelectedOptions] = useState<ExecutionOptionKey[]>([]);
  const [targetLanguage, setTargetLanguage] = useState(defaultLanguage());
  const [agentMode, setAgentMode] = useState<AgentMode>('medium');
  const [storageDestinationId, setStorageDestinationId] = useState('');
  const [privateMode, setPrivateMode] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [phase, setPhase] = useState<ComposerPhase>('draft');
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [picker, setPicker] = useState<PickerKind>(null);
  const [projects, setProjects] = useState<CatalogItem[]>([]);
  const [destinations, setDestinations] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [evidenceMode, setEvidenceMode] = useState(false);
  const [editing, setEditing] = useState<EditBaseline | null>(null);
  const [conversationId, setConversationId] = useState(route.id === 'chat-detail' ? route.params.id || '' : '');
  const [conversationLoading, setConversationLoading] = useState(route.id === 'chat-detail');
  const [optionVisibility, setOptionVisibility] = useState<Record<CurrentExecutionOptionKey, boolean>>({
    translation: true,
    'agent-mode': true,
    'external-storage-transfer': true,
  });

  const executionLock = useRef(false);
  const pollController = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragIndex = useRef<number | null>(null);
  const privateTurnTimers = useRef(new Map<string, number>());

  useEffect(() => {
    document.documentElement.classList.add('native-composer-route');
    document.documentElement.classList.remove('exterior-composer-route');
    document.documentElement.dataset.nativeWorkspace = 'true';
    return () => {
      document.documentElement.classList.remove('native-composer-route');
      delete document.documentElement.dataset.nativeWorkspace;
    };
  }, []);

  useEffect(() => () => {
    pollController.current?.abort();
    for (const timer of privateTurnTimers.current.values()) window.clearTimeout(timer);
    privateTurnTimers.current.clear();
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    const max = window.innerWidth <= 600 ? 150 : 210;
    element.style.height = `${Math.min(max, Math.max(50, element.scrollHeight))}px`;
    element.style.overflowY = element.scrollHeight > max ? 'auto' : 'hidden';
  }, [prompt]);

  useEffect(() => {
    let controller = new AbortController();
    const apply = (payload: unknown) => {
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
      void apiRequest('/api/preferences', { signal: controller.signal }).then(apply).catch(() => undefined);
    };
    const change = (event: Event) => {
      if (event instanceof CustomEvent) apply(event.detail);
      else load();
    };
    window.addEventListener('astera:option-preferences', change);
    window.addEventListener('focus', load);
    load();
    return () => {
      controller.abort();
      window.removeEventListener('astera:option-preferences', change);
      window.removeEventListener('focus', load);
    };
  }, []);

  useEffect(() => {
    if (route.id !== 'chat-detail' || !route.params.id) {
      setConversationLoading(false);
      return;
    }
    const controller = new AbortController();
    setConversationLoading(true);
    apiRequest(`/api/conversations/${encodeURIComponent(route.params.id)}`, { signal: controller.signal })
      .then((payload) => {
        const root = asRecord(payload);
        const conversation = asRecord(root.conversation ?? root.data ?? root);
        const loaded = asArray(conversation.turns).map(hydratePersistedTurn).filter((turn): turn is Turn => turn !== null);
        setTurns(loaded);
        setConversationId(recordText(conversation, ['conversation_id', 'id'], route.params.id));
        setProjectId(recordText(conversation, ['project_id']));
        setPrivateMode(false);
        const last = loaded.at(-1);
        if (last) setPurpose(last.purpose);
        setPhase('draft');
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof ApiError ? caught : new ApiError('Chat履歴を読み込めませんでした。'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setConversationLoading(false);
      });
    return () => controller.abort();
  }, [route.id, route.params.id]);

  const readyFileIds = files.filter((file) => file.status === 'ready' && file.uploadId).map((file) => file.uploadId as string);
  const hasPendingFiles = files.some((file) => file.status === 'uploading');
  const hasFailedFiles = files.some((file) => file.status === 'error');
  const activeWork = ['uploading', 'estimating', 'submitting', 'queued', 'running', 'assembling_result'].includes(phase);
  const visibleOptionKeys = CURRENT_OPTION_KEYS.filter((key) => optionVisibility[key]);

  const executionOptions = useMemo(() => selectedOptions.map((key) => {
    if (key === 'translation') return { key, profileVersion: 'translation-flash-lite', targetLanguage };
    if (key === 'agent-mode') return { key, policyVersion: 'v1', mode: agentMode };
    if (key === 'document') return { key, templateSource: 'personal', templateId: '', templateVersion: 'latest' };
    return { key, destinationId: storageDestinationId, adapterVersion: 'v1', format: 'markdown' };
  }), [agentMode, selectedOptions, storageDestinationId, targetLanguage]);

  const evidenceTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.sources.length > 0 || turn.sections.some((section) => section.sourceIds.length > 0)) ?? null,
    [turns],
  );
  const evidenceItems = useMemo(() => {
    if (!evidenceTurn) return [];
    if (evidenceTurn.sources.length) return evidenceTurn.sources;
    return Array.from(new Set(evidenceTurn.sections.flatMap((section) => section.sourceIds).filter(Boolean)))
      .map((id) => ({ id, title: id, url: '', status: 'referenced', retrievedAt: '' } satisfies ResultSource));
  }, [evidenceTurn]);
  const hasEvidence = evidenceItems.length > 0;

  const validate = useCallback((): ApiError | null => {
    if (!prompt.trim()) return new ApiError('実行する本文を入力してください。', 422, 'ASTERA_INPUT_REQUIRED');
    if ([...prompt].length > MAX_INPUT_CHARACTERS) return new ApiError(`入力は${MAX_INPUT_CHARACTERS.toLocaleString()}文字以内です。`, 413, 'ASTERA_INPUT_TOO_LARGE');
    if (hasPendingFiles) return new ApiError('File Uploadの完了を待ってください。', 409, 'FILE_UPLOAD_IN_PROGRESS');
    if (hasFailedFiles) return new ApiError('Uploadに失敗したFileをRetryまたは削除してください。', 409, 'FILE_UPLOAD_FAILED');
    if (files.length !== readyFileIds.length) return new ApiError('実Byte参照がないFileは実行できません。', 409, 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED');
    if (selectedOptions.includes('translation') && !targetLanguage.trim()) return new ApiError('翻訳先言語を選択してください。', 422, 'TARGET_LANGUAGE_REQUIRED');
    if (selectedOptions.includes('external-storage-transfer') && !storageDestinationId.trim()) return new ApiError('転送先Storageを選択してください。', 422, 'STORAGE_DESTINATION_REQUIRED');
    return null;
  }, [files.length, hasFailedFiles, hasPendingFiles, prompt, readyFileIds.length, selectedOptions, storageDestinationId, targetLanguage]);

  const upsertTurn = useCallback((turn: Turn) => setTurns((current) => {
    const index = current.findIndex((item) => item.id === turn.id);
    if (index < 0) return [...current, turn];
    const next = [...current];
    next[index] = turn;
    return next;
  }), []);
  const patchTurn = useCallback((turnId: string, patch: Partial<Turn>) => {
    setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, ...patch } : turn));
  }, []);
  const armPrivateTurnExpiry = useCallback((turnId: string) => {
    const old = privateTurnTimers.current.get(turnId);
    if (old) window.clearTimeout(old);
    const timer = window.setTimeout(() => {
      privateTurnTimers.current.delete(turnId);
      setTurns((current) => current.filter((turn) => turn.id !== turnId));
      setNotice('Private Mode Outputの60分TTLが終了したため、この端末Memoryから破棄しました。');
    }, PRIVATE_OUTPUT_TTL_MS);
    privateTurnTimers.current.set(turnId, timer);
  }, []);
  const completeTurn = useCallback((turnId: string, payload: unknown, isPrivate: boolean) => {
    const sections = normalizeResult(payload);
    const sources = normalizeSources(payload);
    patchTurn(turnId, { phase: 'completed', sections, sources, error: null });
    setPhase('completed');
    setEvidenceMode(false);
    if (isPrivate) {
      armPrivateTurnExpiry(turnId);
      setNotice('Private Mode Resultは保存されません。Outputはこの端末Memoryでも60分後に破棄されます。');
    } else {
      setNotice('Resultを保存しました。履歴からいつでも開けます。');
      window.dispatchEvent(new CustomEvent('astera:history-updated'));
    }
  }, [armPrivateTurnExpiry, patchTurn]);

  const persistTurn = useCallback(async (
    turnId: string,
    id: string,
    submittedText: string,
    currentPurpose: PurposeKey,
    isPrivate: boolean,
  ) => {
    if (isPrivate) return;
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        last = await apiRequest('/api/conversations', {
          method: 'POST',
          body: {
            conversation_id: conversationId || null,
            client_turn_id: turnId,
            job_id: id,
            prompt: submittedText,
            purpose: currentPurpose,
          },
          idempotent: true,
        });
        const root = asRecord(last);
        const nextId = recordText(root, ['conversation_id', 'conversationId']);
        if (nextId) {
          setConversationId(nextId);
          if (route.id !== 'chat-detail') window.history.replaceState({}, '', `/app/chats/${encodeURIComponent(nextId)}`);
        }
        window.dispatchEvent(new CustomEvent('astera:history-updated'));
        return;
      } catch (caught) {
        last = caught;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
    }
    const persistError = last instanceof ApiError ? last : new ApiError('Chat履歴の保存に失敗しました。', 502, 'CONVERSATION_PERSIST_FAILED');
    setNotice(`Jobは実行されていますがChat履歴を保存できませんでした: ${persistError.code}`);
  }, [conversationId, route.id]);

  const pollJob = useCallback(async (turnId: string, id: string, isPrivate: boolean) => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (controller.signal.aborted) return;
      const payload = await apiRequest(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal, timeoutMs: 15_000 });
      const state = jobState(payload);
      if (['queued', 'validating', 'reserving_credit', 'uploading'].includes(state)) {
        setPhase('queued');
        patchTurn(turnId, { phase: 'queued' });
      } else if (state === 'running') {
        setPhase('running');
        patchTurn(turnId, { phase: 'running' });
      } else if (state === 'assembling_result' || state === 'assembling') {
        setPhase('assembling_result');
        patchTurn(turnId, { phase: 'assembling_result' });
      } else if (state === 'completed' || state === 'complete') {
        completeTurn(turnId, payload, isPrivate);
        return;
      } else if (state === 'cancelled' || state === 'canceled') {
        setPhase('cancelled');
        patchTurn(turnId, { phase: 'cancelled' });
        return;
      } else if (state === 'failed' || state === 'partially_completed' || state === 'partial') {
        const failure = terminalJobError(payload);
        setPhase('failed');
        patchTurn(turnId, { phase: 'failed', error: failure });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(800 + attempt * 100, 2_500)));
    }
    const failure = new ApiError('Job状態の確認期限を超えました。Historyから状態を再確認してください。', 504, 'JOB_POLL_TIMEOUT');
    setPhase('failed');
    patchTurn(turnId, { phase: 'failed', error: failure });
  }, [completeTurn, patchTurn]);

  const runJob = useCallback(async () => {
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
    setEvidenceMode(false);
    const submittedText = prompt.trim();
    const edit = editing;
    const sendPurpose = purpose;
    const sendPrivateMode = privateMode;
    setPhase('estimating');
    const revisionPayload = edit && edit.privateMode === sendPrivateMode && edit.purpose === sendPurpose
      ? { revision_of_job_id: edit.jobId, revision_base_prompt: edit.prompt }
      : {};
    try {
      const estimatePayload = await apiRequest('/api/jobs/estimate', {
        method: 'POST',
        body: {
          prompt: submittedText,
          purpose: sendPurpose,
          options: executionOptions,
          file_ids: readyFileIds,
          private_mode: sendPrivateMode,
          project_id: projectId || null,
          ...revisionPayload,
        },
        idempotent: true,
      });
      const estimate = extractEstimate(estimatePayload);
      if (estimate.availableCredits < estimate.requiredCredits) {
        throw new ApiError(
          `Creditが不足しています。必要 ${estimate.requiredCredits.toLocaleString()} / 利用可能 ${estimate.availableCredits.toLocaleString()}`,
          409,
          'CREDIT_INSUFFICIENT_FOR_ESTIMATE',
          estimatePayload,
        );
      }
      if (new Date(estimate.expiresAt).getTime() <= Date.now()) {
        throw new ApiError('見積りの有効期限が切れました。もう一度実行してください。', 409, 'ESTIMATE_EXPIRED', estimatePayload);
      }

      setPhase('submitting');
      const requestId = crypto.randomUUID();
      const payload = await apiRequest('/api/jobs', {
        method: 'POST',
        idempotencyKey: requestId,
        body: {
          request_id: requestId,
          prompt: submittedText,
          purpose: sendPurpose,
          options: executionOptions,
          file_ids: readyFileIds,
          private_mode: sendPrivateMode,
          project_id: projectId || null,
          estimate_id: estimate.estimateId,
          ...revisionPayload,
        },
      });
      const id = jobId(payload);
      if (!id) throw new ApiError('作成されたJob IDを受信できませんでした。', 502, 'JOB_ID_MISSING', payload);
      const turnId = edit?.turnId ?? crypto.randomUUID();
      const immediate = jobState(payload);
      upsertTurn({
        id: turnId,
        prompt: submittedText,
        purpose: sendPurpose,
        privateMode: sendPrivateMode,
        jobId: id,
        phase: immediate === 'completed' || immediate === 'complete' ? 'completed' : immediate === 'failed' ? 'failed' : 'queued',
        sections: [],
        sources: [],
        error: null,
      });
      setCurrentJobId(id);
      setPrompt('');
      setEditing(null);
      setPhase('queued');
      await persistTurn(turnId, id, submittedText, sendPurpose, sendPrivateMode);
      if (immediate === 'completed' || immediate === 'complete') {
        completeTurn(turnId, payload, sendPrivateMode);
        return;
      }
      if (immediate === 'failed' || immediate === 'partially_completed' || immediate === 'partial') {
        const failure = terminalJobError(payload);
        setPhase('failed');
        patchTurn(turnId, { phase: 'failed', error: failure });
        return;
      }
      await pollJob(turnId, id, sendPrivateMode);
    } catch (caught) {
      const jobError = caught instanceof ApiError ? caught : new ApiError(caught instanceof Error ? caught.message : 'Jobを開始できませんでした。');
      setError(jobError);
      setPhase('failed');
    } finally {
      executionLock.current = false;
    }
  }, [completeTurn, editing, executionOptions, patchTurn, persistTurn, pollJob, privateMode, projectId, prompt, purpose, readyFileIds, upsertTurn, validate]);

  const cancelJob = useCallback(async () => {
    if (!currentJobId) return;
    const turn = turns.find((item) => item.jobId === currentJobId);
    try {
      await apiRequest(`/api/jobs/${encodeURIComponent(currentJobId)}/cancel`, { method: 'POST', idempotent: true });
      pollController.current?.abort();
      setPhase('cancelled');
      if (turn) patchTurn(turn.id, { phase: 'cancelled' });
      setNotice('取消Requestを送信しました。投稿内容は会話に保持しています。');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('取消Requestに失敗しました。'));
    }
  }, [currentJobId, patchTurn, turns]);

  const uploadFile = useCallback(async (file: File, localId: string) => {
    setPhase('uploading');
    try {
      const requestId = crypto.randomUUID();
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
        throw new ApiError(
          recordText(source, ['message'], `Uploadに失敗しました (${response.status})`),
          response.status,
          recordText(source, ['code'], `HTTP_${response.status}`),
          payload,
        );
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
      setFiles((current) => [...current, { localId, file, name: file.name, size: file.size, type: file.type || 'application/octet-stream', status: 'uploading' }]);
      void uploadFile(file, localId);
    }
  }, [uploadFile]);
  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files ?? []);
    if (pasted.length) addFiles(pasted);
  };
  const onDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length) addFiles(dropped);
  };
  const retryFile = (entry: UploadedFile) => {
    setFiles((current) => current.map((item) => item.localId === entry.localId ? { ...item, status: 'uploading', error: undefined } : item));
    void uploadFile(entry.file, entry.localId);
  };
  const reorderFile = (from: number, to: number) => setFiles((current) => {
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  const toggleOption = (key: CurrentExecutionOptionKey) => setSelectedOptions((current) => {
    if (current.includes(key)) {
      if (key === 'external-storage-transfer') setStorageDestinationId('');
      return current.filter((value) => value !== key);
    }
    if (key === 'translation' && !targetLanguage.trim()) setTargetLanguage(defaultLanguage());
    return [...current, key];
  });
  const selectAgentMode = (mode: AgentMode) => {
    const disable = selectedOptions.includes('agent-mode') && agentMode === mode;
    setAgentMode(mode);
    setSelectedOptions((current) => disable ? current.filter((value) => value !== 'agent-mode') : current.includes('agent-mode') ? current : [...current, 'agent-mode']);
  };
  const loadCatalogs = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [projectPayload, storagePayload] = await Promise.all([
        apiRequest('/api/projects').catch(() => null),
        apiRequest('/api/storage/destinations').catch(() => null),
      ]);
      setProjects(records(projectPayload, ['projects', 'items']).map((item) => catalogItem(item, 'project')).filter((item): item is CatalogItem => item !== null));
      setDestinations(records(storagePayload, ['destinations', 'items']).map((item) => catalogItem(item, 'storage')).filter((item): item is CatalogItem => item !== null && !['revoked', 'deleted'].includes((item.status ?? '').toLowerCase())));
    } finally {
      setCatalogLoading(false);
    }
  }, []);
  const openContextPicker = () => {
    setPicker('context');
    void loadCatalogs();
  };
  const editTurn = (turn: Turn) => {
    if (!turn.jobId || turn.phase !== 'completed') return;
    setPrompt(turn.prompt);
    setPurpose(turn.purpose);
    setPrivateMode(turn.privateMode);
    setEditing({ turnId: turn.id, jobId: turn.jobId, prompt: turn.prompt, privateMode: turn.privateMode, purpose: turn.purpose });
    setEvidenceMode(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const resetComposer = () => {
    pollController.current?.abort();
    setPrompt('');
    setTurns([]);
    setFiles([]);
    setCurrentJobId('');
    setConversationId('');
    setError(null);
    setNotice('');
    setPhase('draft');
    setEditing(null);
    setEvidenceMode(false);
    setPicker(null);
    window.history.replaceState({}, '', '/app/new');
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
      void runJob();
    }
  };

  const renderPurposeChoices = () => (
    <div className="native-purpose-list">
      <button type="button" className={purpose === 'auto' ? 'is-selected' : ''} onClick={() => { setPurpose('auto'); setPicker(null); }}><span>Auto</span>{purpose === 'auto' && <b>✓</b>}</button>
      {PURPOSE_CHOICES.map((item) => <button key={item.key} type="button" className={purpose === item.key ? 'is-selected' : ''} onClick={() => { setPurpose(item.key); setPicker(null); }}><span>{item.label}</span>{purpose === item.key && <b>✓</b>}</button>)}
    </div>
  );

  const renderVisibleOptions = () => visibleOptionKeys.map((key) => key === 'agent-mode' ? (
    <details key={key} className="native-option-accordion">
      <summary className={selectedOptions.includes(key) ? 'native-option-accordion-trigger is-selected' : 'native-option-accordion-trigger'}><span>{OPTION_LABELS[key]}</span><b>{selectedOptions.includes(key) ? AGENT_MODE_LABELS[agentMode] : '›'}</b></summary>
      <div className="native-agent-mode-choices">
        {AGENT_MODE_CHOICES.map((choice) => <button key={choice.key} type="button" className={selectedOptions.includes(key) && agentMode === choice.key ? 'is-selected' : ''} onClick={(event) => { selectAgentMode(choice.key); event.currentTarget.closest('details')?.removeAttribute('open'); }}><span>{choice.label}</span>{selectedOptions.includes(key) && agentMode === choice.key && <b>✓</b>}</button>)}
      </div>
    </details>
  ) : <button key={key} type="button" className={selectedOptions.includes(key) ? 'is-selected' : ''} onClick={() => toggleOption(key)}><span>{OPTION_LABELS[key]}</span></button>);

  const pickerBody = picker && (
    <div className="native-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
      <section className="native-picker" role="dialog" aria-modal="true" aria-label={picker === 'add' ? '追加' : picker === 'purpose' ? '用途・目的' : 'Option・対象選択'}>
        <header><strong>{picker === 'add' ? '追加' : picker === 'purpose' ? '用途・目的' : 'Option・対象'}</strong><button type="button" aria-label="閉じる" onClick={() => setPicker(null)}>×</button></header>
        <div className="native-picker-body">
          {picker === 'purpose' && renderPurposeChoices()}
          {picker === 'add' && <><button type="button" onClick={() => { setPicker(null); fileInputRef.current?.click(); }}><span>Fileを追加</span><b>＋</b></button>{renderVisibleOptions()}<button type="button" className={privateMode ? 'is-selected' : ''} aria-pressed={privateMode} onClick={() => setPrivateMode((current) => !current)}><span>Private Mode</span><b>{privateMode ? 'ON' : 'OFF'}</b></button></>}
          {picker === 'context' && <>{catalogLoading && <p className="native-picker-status">登録済み項目を読み込んでいます…</p>}{renderVisibleOptions()}{selectedOptions.includes('translation') && optionVisibility.translation && <label className="native-picker-field"><span>翻訳先言語</span><input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} /></label>}{selectedOptions.includes('external-storage-transfer') && optionVisibility['external-storage-transfer'] && <label className="native-picker-field"><span>外部Storage転送先</span><select value={storageDestinationId} onChange={(event) => setStorageDestinationId(event.target.value)}><option value="">選択してください</option>{destinations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}<label className="native-picker-field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Projectなし</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button type="button" className="native-picker-apply" onClick={() => setPicker(null)}>完了</button></>}
        </div>
      </section>
    </div>
  );

  const evidenceControl = {
    available: hasEvidence,
    mode: evidenceMode ? 'evidence' as const : 'main' as const,
    onModeChange: (mode: 'main' | 'evidence') => setEvidenceMode(mode === 'evidence'),
  };

  if (conversationLoading) {
    return <ResponsivePageShell route={route} fullWidth evidenceControl={evidenceControl}><BusyState label="Chat履歴を読み込んでいます…" /></ResponsivePageShell>;
  }

  return (
    <ResponsivePageShell route={route} fullWidth evidenceControl={evidenceControl}>
      <div className="native-composer-workspace" data-native-composer="true" onDragOver={(event) => event.preventDefault()} onDrop={onDropFiles}>
        <section className="native-timeline" aria-live="polite">
          <div className="native-timeline-inner">
            {turns.length === 0 && !activeWork && !error && !evidenceMode && <div className="native-empty-state"><h1>何を判断材料にしますか？</h1></div>}
            {evidenceMode ? (
              <section className="native-evidence-view" aria-label="根拠一覧">
                <header><h1>根拠</h1><span>{evidenceItems.length}件</span></header>
                {evidenceItems.length === 0 ? <p className="native-evidence-empty">このResultには根拠情報がありません。</p> : (
                  <ol>{evidenceItems.map((source, index) => <li key={`${source.id}-${index}`}><span className="native-evidence-number">{index + 1}</span><div>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <strong>{source.title}</strong>}<small>{[source.status, source.retrievedAt].filter(Boolean).join(' · ')}</small></div></li>)}</ol>
                )}
              </section>
            ) : (
              <>
                {turns.map((turn) => (
                  <article className="native-turn" key={turn.id} data-turn-id={turn.id}>
                    <div className="native-user-turn">
                      <section className="native-user-message" aria-label="ユーザー投稿"><p>{turn.prompt}</p></section>
                      <div className="native-user-actions">
                        <button type="button" aria-label="投稿をコピー" title="コピー" onClick={() => void navigator.clipboard?.writeText(turn.prompt)}><span aria-hidden="true">⧉</span></button>
                        <button type="button" aria-label="投稿を編集" title="編集" disabled={turn.phase !== 'completed'} onClick={() => editTurn(turn)}><span aria-hidden="true">✎</span></button>
                      </div>
                    </div>
                    {['queued', 'running', 'assembling_result'].includes(turn.phase) && <section className="native-processing" role="status"><span className="native-processing-dot" /><div><strong>{phaseLabel(turn.phase)}</strong><small>{turn.jobId ? `Job ${turn.jobId}` : 'Asteraが処理を進めています'}</small></div>{turn.jobId === currentJobId && <button type="button" onClick={() => void cancelJob()}>取消</button>}</section>}
                    {turn.error && <section className="native-error" role="alert"><div><strong>{turn.error.message}</strong><code>{turn.error.code}</code></div></section>}
                    {turn.sections.length > 0 && (
                      <section className="native-response">
                        <header><strong>ASTERA</strong><button type="button" aria-label="回答を全てコピー" onClick={() => void navigator.clipboard?.writeText(turn.sections.map((section) => `${section.title}\n${section.body}`).join('\n\n'))}><span aria-hidden="true">⧉</span></button></header>
                        <div className="native-result-sections">{turn.sections.map((section, index) => <article key={section.key} className="native-result-section"><div className="native-result-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><button type="button" aria-label={`${section.title}をコピー`} onClick={() => void navigator.clipboard?.writeText(section.body)}>コピー</button></div><p>{section.body}</p></article>)}</div>
                      </section>
                    )}
                  </article>
                ))}
                {activeWork && turns.every((turn) => turn.jobId !== currentJobId) && <section className="native-processing" role="status"><span className="native-processing-dot" /><div><strong>{phaseLabel(phase)}</strong><small>送信準備中</small></div></section>}
                {error && <section className="native-error" role="alert"><div><strong>{error.message}</strong><code>{error.code}</code></div><button type="button" onClick={() => { setError(null); setPhase('draft'); }}>閉じる</button></section>}
              </>
            )}
          </div>
        </section>

        <section className="native-composer-dock">
          {notice && <div className="native-notice" role="status">{notice}</div>}
          {editing && <div className="native-editing-banner"><span>投稿を編集しています</span><button type="button" onClick={() => { setEditing(null); setPrompt(''); }}>キャンセル</button></div>}
          {files.length > 0 && (
            <ul className="native-file-queue" aria-label="File Queue">
              {files.map((file, index) => <li key={file.localId} draggable={file.status !== 'uploading'} onDragStart={() => { dragIndex.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragIndex.current !== null) reorderFile(dragIndex.current, index); dragIndex.current = null; }}><div><strong>{file.name}</strong><small>{file.status === 'ready' ? 'Upload完了' : file.status === 'uploading' ? 'Uploading…' : file.error}</small></div><div>{file.status === 'error' && <button type="button" onClick={() => retryFile(file)}>Retry</button>}<button type="button" onClick={() => setFiles((current) => current.filter((item) => item.localId !== file.localId))} disabled={file.status === 'uploading'}>×</button></div></li>)}
            </ul>
          )}
          <div className="native-composer">
            <textarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKeyDown} onPaste={onPaste} maxLength={MAX_INPUT_CHARACTERS} rows={1} placeholder="メッセージを入力" aria-label="Astera入力" />
            <div className="native-composer-actions">
              <div className="native-left-tools">
                <button type="button" className="native-round-button" aria-label="Fileと実行Optionを追加" onClick={() => setPicker('add')}>＋</button>
                <button type="button" className="native-purpose-button" aria-label="Purposeを選択" onClick={() => setPicker('purpose')}>{PURPOSE_LABELS[purpose]} <span aria-hidden="true">⌄</span></button>
                {selectedOptions.filter((key): key is CurrentExecutionOptionKey => key !== 'document').map((key) => {
                  const label = key === 'agent-mode' ? `Agent ${AGENT_MODE_LABELS[agentMode]}` : OPTION_LABELS[key];
                  return <span className="native-form-chip is-option" key={key}><span>{label}</span><button type="button" aria-label={`${label}を削除`} onClick={() => toggleOption(key)}>×</button></span>;
                })}
              </div>
              <div className="native-right-tools">
                {turns.length > 0 && <button type="button" className="native-text-button" onClick={resetComposer}>新規</button>}
                <button type="button" className="native-run-button" aria-label="実行" onClick={() => void runJob()} disabled={activeWork || !prompt.trim()}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.6 4.3 21 12 3.6 19.7l2.2-6.2 8.4-1.5-8.4-1.5-2.2-6.2Z" fill="currentColor" /></svg></button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesSelected} />
          </div>
          <div className="native-composer-hint"><span>Enter＝改行 / Ctrl・⌘＋Enter＝実行</span><span>{[...prompt].length.toLocaleString()} / {MAX_INPUT_CHARACTERS.toLocaleString()}</span></div>
        </section>
        {pickerBody}
      </div>
    </ResponsivePageShell>
  );
}
