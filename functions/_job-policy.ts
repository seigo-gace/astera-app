import { FunctionHttpError, type D1Database } from './_account-projection';

export const PURPOSE_KEYS = ['auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
export const OPTION_KEYS = ['translation', 'agent-mode', 'document', 'external-storage-transfer'] as const;

export type PurposeKey = (typeof PURPOSE_KEYS)[number];
export type OptionKey = (typeof OPTION_KEYS)[number];

export type CreditPolicy = {
  version: string;
  baseCredits: number;
  charactersPerCredit: number;
  fileBytesPerCredit: number;
  optionCosts: Record<OptionKey, number>;
  lowThreshold: number;
  criticalThreshold: number;
  maxEstimate: number;
  estimateTtlSeconds: number;
  reservationTtlSeconds: number;
};

type CreditPolicyRow = {
  version: string;
  base_credits: number;
  characters_per_credit: number;
  file_bytes_per_credit: number;
  option_costs: string;
  low_threshold: number;
  critical_threshold: number;
  max_estimate: number;
  estimate_ttl_seconds: number;
  reservation_ttl_seconds: number;
};

export type NormalizedExecutionOption = {
  key: OptionKey;
  config: Record<string, string>;
};

export type EstimateInput = {
  prompt: string;
  purpose: PurposeKey;
  options: NormalizedExecutionOption[];
  fileIds: string[];
  privateMode: boolean;
  projectId: string | null;
};

function integer(value: unknown, name: string, min = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min) throw new FunctionHttpError(503, 'CREDIT_POLICY_INVALID', `${name}が不正です。`);
  return parsed;
}

function parseOptionCosts(raw: string): Record<OptionKey, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_OPTION_COSTS_INVALID', 'Option Cost PolicyがJSONではありません。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_OPTION_COSTS_INVALID', 'Option Cost Policyの形式が不正です。');
  }
  const source = parsed as Record<string, unknown>;
  return Object.fromEntries(OPTION_KEYS.map((key) => [key, integer(source[key] ?? 0, `option_costs.${key}`, 0)])) as Record<OptionKey, number>;
}

export async function loadActiveCreditPolicy(db: D1Database): Promise<CreditPolicy> {
  let row: CreditPolicyRow | null;
  try {
    row = await db.prepare(
      `SELECT version, base_credits, characters_per_credit, file_bytes_per_credit, option_costs,
              low_threshold, critical_threshold, max_estimate, estimate_ttl_seconds, reservation_ttl_seconds
       FROM credit_policies WHERE status = 'active' LIMIT 1`,
    ).first<CreditPolicyRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'CREDIT_POLICY_SCHEMA_NOT_READY', 'Credit Policy用D1 Migrationが適用されていません。', message);
    }
    throw error;
  }
  if (!row) throw new FunctionHttpError(503, 'ACTIVE_CREDIT_POLICY_NOT_PUBLISHED', 'Active Credit Policyが公開されていません。');
  const policy: CreditPolicy = {
    version: row.version,
    baseCredits: integer(row.base_credits, 'base_credits', 1),
    charactersPerCredit: integer(row.characters_per_credit, 'characters_per_credit', 1),
    fileBytesPerCredit: integer(row.file_bytes_per_credit, 'file_bytes_per_credit', 1),
    optionCosts: parseOptionCosts(row.option_costs),
    lowThreshold: integer(row.low_threshold, 'low_threshold', 0),
    criticalThreshold: integer(row.critical_threshold, 'critical_threshold', 0),
    maxEstimate: integer(row.max_estimate, 'max_estimate', 1),
    estimateTtlSeconds: integer(row.estimate_ttl_seconds, 'estimate_ttl_seconds', 60),
    reservationTtlSeconds: integer(row.reservation_ttl_seconds, 'reservation_ttl_seconds', 60),
  };
  if (policy.criticalThreshold > policy.lowThreshold) {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_THRESHOLD_INVALID', 'Critical ThresholdはLow Threshold以下である必要があります。');
  }
  return policy;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOption(value: unknown): NormalizedExecutionOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FunctionHttpError(422, 'EXECUTION_OPTION_INVALID', 'Execution Optionの形式が不正です。');
  }
  const source = value as Record<string, unknown>;
  const key = text(source.key) as OptionKey;
  if (!OPTION_KEYS.includes(key)) throw new FunctionHttpError(422, 'EXECUTION_OPTION_UNSUPPORTED', `未対応Optionを拒否しました: ${key || 'unknown'}`);
  const config: Record<string, string> = {};
  if (key === 'translation') {
    const targetLanguage = text(source.targetLanguage ?? source.target_language);
    const profileVersion = text(source.profileVersion ?? source.profile_version);
    if (!targetLanguage || !profileVersion) throw new FunctionHttpError(422, 'TRANSLATION_OPTION_INCOMPLETE', '翻訳先言語とProfile Versionが必要です。');
    config.targetLanguage = targetLanguage;
    config.profileVersion = profileVersion;
  } else if (key === 'agent-mode') {
    const mode = text(source.mode);
    const policyVersion = text(source.policyVersion ?? source.policy_version);
    if (!['low', 'medium', 'high'].includes(mode) || !policyVersion) throw new FunctionHttpError(422, 'AGENT_OPTION_INCOMPLETE', 'Agent ModeとPolicy Versionが必要です。');
    config.mode = mode;
    config.policyVersion = policyVersion;
  } else if (key === 'document') {
    const templateId = text(source.templateId ?? source.template_id);
    const templateVersion = text(source.templateVersion ?? source.template_version);
    const templateSource = text(source.templateSource ?? source.template_source);
    if (!templateId || !templateVersion || !['official', 'personal'].includes(templateSource)) throw new FunctionHttpError(422, 'DOCUMENT_OPTION_INCOMPLETE', 'Document Template情報が不足しています。');
    config.templateId = templateId;
    config.templateVersion = templateVersion;
    config.templateSource = templateSource;
  } else {
    const destinationId = text(source.destinationId ?? source.destination_id);
    const adapterVersion = text(source.adapterVersion ?? source.adapter_version);
    const format = text(source.format);
    if (!destinationId || !adapterVersion || !format) throw new FunctionHttpError(422, 'STORAGE_TRANSFER_OPTION_INCOMPLETE', 'Storage転送先情報が不足しています。');
    config.destinationId = destinationId;
    config.adapterVersion = adapterVersion;
    config.format = format;
  }
  return { key, config };
}

export function normalizeEstimateInput(value: unknown): EstimateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FunctionHttpError(400, 'JOB_REQUEST_INVALID', 'Job RequestのJSONを確認できません。');
  const source = value as Record<string, unknown>;
  const prompt = text(source.prompt ?? source.input);
  if (!prompt) throw new FunctionHttpError(422, 'ASTERA_INPUT_REQUIRED', '実行する本文がありません。');
  if ([...prompt].length > 200_000) throw new FunctionHttpError(413, 'ASTERA_INPUT_TOO_LARGE', '入力は200,000文字以内です。');
  const purpose = text(source.purpose) as PurposeKey;
  if (!PURPOSE_KEYS.includes(purpose)) throw new FunctionHttpError(422, 'PURPOSE_INVALID', 'Purposeは8種から一つだけ指定してください。');
  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const options = rawOptions.map(normalizeOption);
  if (new Set(options.map((option) => option.key)).size !== options.length) throw new FunctionHttpError(422, 'EXECUTION_OPTION_DUPLICATED', '同じOptionを重複指定できません。');
  const fileIds = Array.isArray(source.file_ids ?? source.fileIds)
    ? (source.file_ids ?? source.fileIds as unknown[]).map(text).filter(Boolean)
    : [];
  if (new Set(fileIds).size !== fileIds.length) throw new FunctionHttpError(422, 'FILE_ID_DUPLICATED', '同じFileを重複指定できません。');
  const privateMode = source.private_mode === true || source.privateMode === true;
  if (privateMode && options.some((option) => option.key === 'external-storage-transfer')) {
    throw new FunctionHttpError(422, 'PRIVATE_MODE_TRANSFER_FORBIDDEN', 'Private Modeでは外部Storage転送を実行できません。');
  }
  const projectId = text(source.project_id ?? source.projectId) || null;
  return { prompt, purpose, options, fileIds, privateMode, projectId };
}

export function calculateRequiredCredits(policy: CreditPolicy, input: EstimateInput, totalFileBytes: number): number {
  const promptCost = Math.ceil([...input.prompt].length / policy.charactersPerCredit);
  const fileCost = totalFileBytes > 0 ? Math.ceil(totalFileBytes / policy.fileBytesPerCredit) : 0;
  const optionCost = input.options.reduce((sum, option) => sum + policy.optionCosts[option.key], 0);
  const required = policy.baseCredits + promptCost + fileCost + optionCost;
  if (!Number.isSafeInteger(required) || required <= 0 || required > policy.maxEstimate) {
    throw new FunctionHttpError(422, 'JOB_ESTIMATE_OUT_OF_POLICY', '予定CreditがPolicyの上限を超えています。', { required, max: policy.maxEstimate });
  }
  return required;
}

function stableInput(input: EstimateInput, uploadFingerprints: string[]): string {
  return JSON.stringify({
    prompt: input.prompt,
    purpose: input.purpose,
    options: input.options.map((option) => ({ key: option.key, config: Object.fromEntries(Object.entries(option.config).sort(([a], [b]) => a.localeCompare(b))) })),
    files: uploadFingerprints,
    privateMode: input.privateMode,
    projectId: input.projectId,
  });
}

export async function requestFingerprint(input: EstimateInput, uploadFingerprints: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableInput(input, uploadFingerprints)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function creditState(usable: number, required: number, policy: CreditPolicy): 'normal' | 'low' | 'critical' | 'insufficient' {
  if (usable < required) return 'insufficient';
  const after = usable - required;
  if (after <= policy.criticalThreshold) return 'critical';
  if (after <= policy.lowThreshold) return 'low';
  return 'normal';
}
