import { FunctionHttpError, type D1Database } from './_account-projection';

export const PURPOSE_KEYS = ['auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
export const OPTION_KEYS = ['translation', 'agent-mode', 'document', 'external-storage-transfer'] as const;
const MAX_INPUT_CHARACTERS = 200_000;
const MAX_REVISION_DIFF_CELLS = 4_000_000;
const MILLI = 1000;

export type PurposeKey = (typeof PURPOSE_KEYS)[number];
export type OptionKey = (typeof OPTION_KEYS)[number];

export type CreditPolicy = {
  version: string;
  asciiMilliPerChar: number;
  nonAsciiMilliPerChar: number;
  optionMultiplierMilli: number;
  outputBilled: boolean;
  warningThresholdsPublished: boolean;
  lowThreshold: number;
  criticalThreshold: number;
  maxEstimate: number;
  estimateTtlSeconds: number;
  reservationTtlSeconds: number;
};

type CreditPolicyRow = {
  version: string;
  low_threshold: number;
  critical_threshold: number;
  max_estimate: number;
  estimate_ttl_seconds: number;
  reservation_ttl_seconds: number;
  ascii_milli_per_char: number | null;
  non_ascii_milli_per_char: number | null;
  option_multiplier_milli: number | null;
  output_billed: number | null;
  warning_thresholds_published: number | null;
};

export type NormalizedExecutionOption = {
  key: OptionKey;
  config: Record<string, string>;
};

export type RevisionContext = {
  parentJobId: string;
  basePrompt: string;
};

export type EstimateInput = {
  prompt: string;
  purpose: PurposeKey;
  options: NormalizedExecutionOption[];
  fileIds: string[];
  privateMode: boolean;
  projectId: string | null;
  revision: RevisionContext | null;
};

export type RevisionCreditMetric = {
  characters: number;
  milliCredits: number;
};

function integer(value: unknown, name: string, min = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min) throw new FunctionHttpError(503, 'CREDIT_POLICY_INVALID', `${name}が不正です。`);
  return parsed;
}

export async function loadActiveCreditPolicy(db: D1Database): Promise<CreditPolicy> {
  let row: CreditPolicyRow | null;
  try {
    row = await db.prepare(
      `SELECT p.version, p.low_threshold, p.critical_threshold, p.max_estimate,
              p.estimate_ttl_seconds, p.reservation_ttl_seconds,
              f.ascii_milli_per_char, f.non_ascii_milli_per_char, f.option_multiplier_milli,
              f.output_billed, f.warning_thresholds_published
       FROM credit_policies p
       LEFT JOIN credit_formula_policies f ON f.version = p.version
       WHERE p.status = 'active'
       LIMIT 1`,
    ).first<CreditPolicyRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'CREDIT_POLICY_SCHEMA_NOT_READY', 'Credit Policy用D1 Migrationが適用されていません。', message);
    }
    throw error;
  }

  if (!row) throw new FunctionHttpError(503, 'ACTIVE_CREDIT_POLICY_NOT_PUBLISHED', 'Active Credit Policyが公開されていません。');
  if (
    row.ascii_milli_per_char == null
    || row.non_ascii_milli_per_char == null
    || row.option_multiplier_milli == null
    || row.output_billed == null
    || row.warning_thresholds_published == null
  ) {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_FORMULA_NOT_READY', 'Active Credit Policyの計算式が公開されていません。');
  }

  const policy: CreditPolicy = {
    version: row.version,
    asciiMilliPerChar: integer(row.ascii_milli_per_char, 'ascii_milli_per_char', 1),
    nonAsciiMilliPerChar: integer(row.non_ascii_milli_per_char, 'non_ascii_milli_per_char', 1),
    optionMultiplierMilli: integer(row.option_multiplier_milli, 'option_multiplier_milli', 0),
    outputBilled: integer(row.output_billed, 'output_billed', 0) === 1,
    warningThresholdsPublished: integer(row.warning_thresholds_published, 'warning_thresholds_published', 0) === 1,
    lowThreshold: integer(row.low_threshold, 'low_threshold', 0),
    criticalThreshold: integer(row.critical_threshold, 'critical_threshold', 0),
    maxEstimate: integer(row.max_estimate, 'max_estimate', 1),
    estimateTtlSeconds: integer(row.estimate_ttl_seconds, 'estimate_ttl_seconds', 60),
    reservationTtlSeconds: integer(row.reservation_ttl_seconds, 'reservation_ttl_seconds', 60),
  };

  if (policy.outputBilled) {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_OUTPUT_BILLING_UNSUPPORTED', '現行Astera Credit正本では出力文字数を減算しません。');
  }
  if (policy.warningThresholdsPublished && policy.criticalThreshold > policy.lowThreshold) {
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
  if ([...prompt].length > MAX_INPUT_CHARACTERS) throw new FunctionHttpError(413, 'ASTERA_INPUT_TOO_LARGE', '入力は200,000文字以内です。');
  const purpose = text(source.purpose) as PurposeKey;
  if (!PURPOSE_KEYS.includes(purpose)) throw new FunctionHttpError(422, 'PURPOSE_INVALID', 'Purposeは8種から一つだけ指定してください。');
  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const options = rawOptions.map(normalizeOption);
  if (new Set(options.map((option) => option.key)).size !== options.length) throw new FunctionHttpError(422, 'EXECUTION_OPTION_DUPLICATED', '同じOptionを重複指定できません。');
  const rawFileIds = source.file_ids ?? source.fileIds;
  const fileIds = Array.isArray(rawFileIds) ? rawFileIds.map(text).filter(Boolean) : [];
  if (new Set(fileIds).size !== fileIds.length) throw new FunctionHttpError(422, 'FILE_ID_DUPLICATED', '同じFileを重複指定できません。');
  const privateMode = source.private_mode === true || source.privateMode === true;
  const projectId = text(source.project_id ?? source.projectId) || null;
  const parentJobId = text(source.revision_of_job_id ?? source.revisionOfJobId);
  const basePrompt = text(source.revision_base_prompt ?? source.revisionBasePrompt);
  if ((parentJobId && !basePrompt) || (!parentJobId && basePrompt)) {
    throw new FunctionHttpError(422, 'REVISION_CONTEXT_INCOMPLETE', '修整再投稿には親Jobと修整前本文の両方が必要です。');
  }
  if ([...basePrompt].length > MAX_INPUT_CHARACTERS) {
    throw new FunctionHttpError(413, 'REVISION_BASE_INPUT_TOO_LARGE', '修整前本文は200,000文字以内です。');
  }
  const revision = parentJobId ? { parentJobId, basePrompt } : null;
  return { prompt, purpose, options, fileIds, privateMode, projectId, revision };
}

function assertBillableCharacters(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INPUT_CHARACTERS) {
    throw new FunctionHttpError(422, 'REVISION_BILLABLE_CHARACTERS_INVALID', '修整文字数を安全に計算できません。', { value });
  }
  return value;
}

function characterMilli(character: string, policy: CreditPolicy): number {
  const codePoint = character.codePointAt(0);
  return codePoint != null && codePoint <= 0x7f ? policy.asciiMilliPerChar : policy.nonAsciiMilliPerChar;
}

export function inputCreditMilli(value: string, policy: CreditPolicy): number {
  let total = 0;
  for (const character of value) {
    total += characterMilli(character, policy);
    if (!Number.isSafeInteger(total)) throw new FunctionHttpError(422, 'CREDIT_INPUT_WEIGHT_OVERFLOW', '入力文字数のCredit換算値が大きすぎます。');
  }
  return total;
}

function betterMetric(
  aCharacters: number,
  aMilli: number,
  bCharacters: number,
  bMilli: number,
): boolean {
  return aCharacters < bCharacters || (aCharacters === bCharacters && aMilli < bMilli);
}

export function revisedCreditMetric(basePrompt: string, revisedPrompt: string, policy: CreditPolicy): RevisionCreditMetric {
  const before = [...basePrompt];
  const after = [...revisedPrompt];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > prefix && afterEnd > prefix && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const left = before.slice(prefix, beforeEnd);
  const right = after.slice(prefix, afterEnd);
  if (left.length === 0) return { characters: assertBillableCharacters(right.length), milliCredits: inputCreditMilli(right.join(''), policy) };
  if (right.length === 0) return { characters: assertBillableCharacters(left.length), milliCredits: inputCreditMilli(left.join(''), policy) };

  if (left.length * right.length > MAX_REVISION_DIFF_CELLS) {
    throw new FunctionHttpError(
      422,
      'REVISION_DIFF_TOO_COMPLEX',
      '修整範囲が大きく、正確な修整文字数を安全な計算量で確定できません。修整範囲を分けて再試行してください。',
      { before_changed_window: left.length, after_changed_window: right.length },
    );
  }

  let previousCharacters = new Array<number>(right.length + 1).fill(0);
  let previousMilli = new Array<number>(right.length + 1).fill(0);
  for (let column = 1; column <= right.length; column += 1) {
    previousCharacters[column] = column;
    previousMilli[column] = previousMilli[column - 1] + characterMilli(right[column - 1], policy);
  }

  let currentCharacters = new Array<number>(right.length + 1).fill(0);
  let currentMilli = new Array<number>(right.length + 1).fill(0);
  for (let row = 1; row <= left.length; row += 1) {
    currentCharacters[0] = row;
    currentMilli[0] = previousMilli[0] + characterMilli(left[row - 1], policy);
    for (let column = 1; column <= right.length; column += 1) {
      if (left[row - 1] === right[column - 1]) {
        currentCharacters[column] = previousCharacters[column - 1];
        currentMilli[column] = previousMilli[column - 1];
        continue;
      }

      const substitutionCharacters = previousCharacters[column - 1] + 1;
      const substitutionMilli = previousMilli[column - 1] + characterMilli(right[column - 1], policy);
      const insertionCharacters = currentCharacters[column - 1] + 1;
      const insertionMilli = currentMilli[column - 1] + characterMilli(right[column - 1], policy);
      const deletionCharacters = previousCharacters[column] + 1;
      const deletionMilli = previousMilli[column] + characterMilli(left[row - 1], policy);

      let bestCharacters = substitutionCharacters;
      let bestMilli = substitutionMilli;
      if (betterMetric(insertionCharacters, insertionMilli, bestCharacters, bestMilli)) {
        bestCharacters = insertionCharacters;
        bestMilli = insertionMilli;
      }
      if (betterMetric(deletionCharacters, deletionMilli, bestCharacters, bestMilli)) {
        bestCharacters = deletionCharacters;
        bestMilli = deletionMilli;
      }
      currentCharacters[column] = bestCharacters;
      currentMilli[column] = bestMilli;
    }
    [previousCharacters, currentCharacters] = [currentCharacters, previousCharacters];
    [previousMilli, currentMilli] = [currentMilli, previousMilli];
  }

  return {
    characters: assertBillableCharacters(previousCharacters[right.length]),
    milliCredits: previousMilli[right.length],
  };
}

export function calculateRequiredCredits(
  policy: CreditPolicy,
  input: EstimateInput,
  billableMilliCredits = inputCreditMilli(input.prompt, policy),
): number {
  if (!Number.isSafeInteger(billableMilliCredits) || billableMilliCredits < 0) {
    throw new FunctionHttpError(422, 'CREDIT_INPUT_WEIGHT_INVALID', '入力文字数のCredit換算値が不正です。');
  }
  const multiplierMilli = MILLI + input.options.length * policy.optionMultiplierMilli;
  if (!Number.isSafeInteger(multiplierMilli) || multiplierMilli <= 0) {
    throw new FunctionHttpError(503, 'CREDIT_POLICY_MULTIPLIER_INVALID', 'Credit Option倍率を計算できません。');
  }
  const numerator = billableMilliCredits * multiplierMilli;
  if (!Number.isSafeInteger(numerator)) {
    throw new FunctionHttpError(422, 'CREDIT_ESTIMATE_OVERFLOW', '予定Creditを安全に計算できません。');
  }
  const required = Math.floor(numerator / (MILLI * MILLI));
  if (!Number.isSafeInteger(required) || required <= 0) {
    throw new FunctionHttpError(422, 'CREDIT_ESTIMATE_INVALID', '予定Creditを安全に計算できません。', { required });
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
    revision: input.revision ? { parentJobId: input.revision.parentJobId, basePrompt: input.revision.basePrompt } : null,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function promptFingerprint(prompt: string): Promise<string> {
  return sha256(prompt);
}

export async function requestFingerprint(input: EstimateInput, uploadFingerprints: string[]): Promise<string> {
  return sha256(stableInput(input, uploadFingerprints));
}

export function revisedCharacterCount(basePrompt: string, revisedPrompt: string): number {
  const before = [...basePrompt];
  const after = [...revisedPrompt];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > prefix && afterEnd > prefix && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  let left = before.slice(prefix, beforeEnd);
  let right = after.slice(prefix, afterEnd);
  if (left.length === 0) return assertBillableCharacters(right.length);
  if (right.length === 0) return assertBillableCharacters(left.length);

  if (left.length * right.length > MAX_REVISION_DIFF_CELLS) {
    throw new FunctionHttpError(
      422,
      'REVISION_DIFF_TOO_COMPLEX',
      '修整範囲が大きく、正確な修整文字数を安全な計算量で確定できません。修整範囲を分けて再試行してください。',
      { before_changed_window: left.length, after_changed_window: right.length },
    );
  }

  if (left.length < right.length) [left, right] = [right, left];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      const insertion = current[column - 1] + 1;
      const deletion = previous[column] + 1;
      current[column] = Math.min(substitution, insertion, deletion);
    }
    [previous, current] = [current, previous];
  }
  return assertBillableCharacters(previous[right.length]);
}

export function creditState(usable: number, required: number, policy: CreditPolicy): 'normal' | 'low' | 'critical' | 'insufficient' {
  if (usable < required) return 'insufficient';
  if (!policy.warningThresholdsPublished) return 'normal';
  const after = usable - required;
  if (after <= policy.criticalThreshold) return 'critical';
  if (after <= policy.lowThreshold) return 'low';
  return 'normal';
}
