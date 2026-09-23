const APP_SECTION_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

const CANONICAL_SECTION_KEYS = [
  '01_purpose',
  '02_premise',
  '03_facts',
  '04_crisis',
  '05_opposition',
  '06_comparison',
  '07_evidence_status',
  '08_reinstruction',
] as const;

const EXPECTED_SECTION_PREFIXES = ['01 ', '02 ', '03 ', '04 ', '05 ', '06 ', '07 ', '08 '] as const;

export type CoreProcessAdapterInput = {
  prompt: string;
  purpose: string;
  files: unknown[];
};

type AdapterError = Error & { code?: string; retryable?: boolean };

function adapterError(code: string, message: string, retryable = false): AdapterError {
  return Object.assign(new Error(message), { code, retryable });
}

export function buildCoreProcessRequest(input: CoreProcessAdapterInput): { question: string; context?: string } {
  if (input.files.length > 0) {
    throw adapterError(
      'ASTERA_FILE_INPUT_BRIDGE_NOT_CONNECTED',
      'File付きJobを最新Astera Coreへ渡すContent Bridgeが未接続です。File内容を解析したふりをせず安全停止しました。',
      false,
    );
  }

  const question = input.prompt.trim();
  if (!question) throw adapterError('PROMPT_REQUIRED', 'Promptがありません。');
  const purpose = input.purpose.trim().toLowerCase();
  if (!purpose || purpose === 'auto') return { question };

  return {
    question,
    context: `User-selected analysis purpose: ${purpose}. Preserve this as analysis intent; do not treat it as evidence.`,
  };
}

export function parseCoreMain8Response(raw: string): {
  result: {
    schema_version: string;
    runtime_version: string;
    purpose_version: string;
    completion_state: 'complete';
    sections: Record<string, { title: string; body: string; canonical_key: string; source_ids: string[] }>;
    sources: unknown[];
    warnings: string[];
    generated_at: string;
  };
} {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const blocks = normalized ? normalized.split(/\n---\n/) : [];
  if (blocks.length !== APP_SECTION_KEYS.length) {
    throw adapterError(
      'ASTERA_MAIN8_RESPONSE_INCOMPLETE',
      `Astera Core Main8のSection数が不正です。受信: ${blocks.length}`,
      false,
    );
  }

  const sections: Record<string, { title: string; body: string; canonical_key: string; source_ids: string[] }> = {};
  for (let index = 0; index < blocks.length; index += 1) {
    const lines = blocks[index].split('\n');
    const title = (lines.shift() ?? '').trim();
    const body = lines.join('\n').trim();
    if (!title.startsWith(EXPECTED_SECTION_PREFIXES[index]) || !body) {
      throw adapterError(
        'ASTERA_MAIN8_RESPONSE_INVALID',
        `Astera Core Main8のSection ${index + 1} を検証できません。`,
        false,
      );
    }
    sections[APP_SECTION_KEYS[index]] = {
      title,
      body,
      canonical_key: CANONICAL_SECTION_KEYS[index],
      source_ids: [],
    };
  }

  return {
    result: {
      schema_version: 'astera-result-v2-main8-compat',
      runtime_version: 'astera-v8',
      purpose_version: 'astera_judgment_v4',
      completion_state: 'complete',
      sections,
      sources: [],
      warnings: [],
      generated_at: new Date().toISOString(),
    },
  };
}

export function parseCoreProcessError(raw: string, status: number): AdapterError {
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : null;
  const code = typeof nested?.code === 'string'
    ? nested.code
    : typeof record.code === 'string'
      ? record.code
      : `ASTERA_PROCESS_HTTP_${status}`;
  const message = typeof nested?.message === 'string'
    ? nested.message
    : typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : raw.trim() || `Astera Process APIに失敗しました (${status})`;
  const retryable = nested?.retryable === true || status >= 500;
  return adapterError(code, message, retryable);
}
