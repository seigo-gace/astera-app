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

const MANUAL_PURPOSES = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
type ManualPurpose = (typeof MANUAL_PURPOSES)[number];

type ManualPurposeContract = {
  version: 'app-purpose-v1';
  selected_by: 'user';
  purpose: ManualPurpose;
  objective: string;
  required_focus: readonly string[];
  operating_rules: readonly string[];
};

const COMMON_PURPOSE_RULES = [
  'Treat the selected purpose as execution intent, never as evidence or user-authored source text.',
  'Keep the original user prompt as the analysis target; do not replace it with the purpose label.',
  'Do not invent facts, candidates, claims, sources, constraints, or user preferences that are not present or evidenced.',
  'Preserve uncertainty explicitly and separate confirmed, contradicted, and unresolved material.',
  'Produce decision material only; do not silently convert the purpose into a final autonomous decision.',
] as const;

export const MANUAL_PURPOSE_CONTRACTS: Readonly<Record<ManualPurpose, ManualPurposeContract>> = {
  review: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'review',
    objective: 'Review the supplied material as a whole and surface correctness issues, weaknesses, omissions, risks, and concrete improvement material.',
    required_focus: [
      'target_scope',
      'claims_and_assumptions',
      'internal_consistency',
      'evidence_strength',
      'risks_and_failure_modes',
      'missing_or_weak_points',
      'improvement_material',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  compare: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'compare',
    objective: 'Identify the comparison candidates and compare them on explicit axes, trade-offs, conditions, risks, and evidence without collapsing them into an unsupported winner.',
    required_focus: [
      'candidate_extraction',
      'comparison_axes',
      'shared_conditions',
      'differences',
      'trade_offs',
      'risks_and_constraints',
      'evidence_per_candidate',
      'decision_conditions',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  verify: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'verify',
    objective: 'Extract externally or internally verifiable claims and test them against available evidence, contradictions, uncertainty, and source quality.',
    required_focus: [
      'claim_extraction',
      'verification_targets',
      'supporting_evidence',
      'counter_evidence',
      'source_quality',
      'contradictions',
      'uncertainty_retention',
      'verification_gaps',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  improve: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'improve',
    objective: 'Find concrete defects or limitations in the supplied material and generate improvement material that preserves stated constraints and exposes side effects and rollback concerns.',
    required_focus: [
      'current_state',
      'defects_and_bottlenecks',
      'constraints_to_preserve',
      'improvement_options',
      'expected_effects',
      'side_effects',
      'compatibility_and_regression_risks',
      'validation_conditions',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  research: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'research',
    objective: 'Structure the research target, identify entities and claims that require evidence, and organize authoritative/current findings, gaps, and conflicts.',
    required_focus: [
      'research_question',
      'entity_extraction',
      'claim_extraction',
      'evidence_requirements',
      'source_authority',
      'source_freshness',
      'conflicting_findings',
      'remaining_gaps',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  plan: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'plan',
    objective: 'Turn the stated goal into execution-ready planning material with prerequisites, dependencies, sequence, gates, risks, fallback conditions, and measurable completion criteria.',
    required_focus: [
      'goal_and_scope',
      'prerequisites',
      'dependencies',
      'execution_sequence',
      'validation_gates',
      'risks_and_blockers',
      'fallback_and_rollback',
      'completion_criteria',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
  consider: {
    version: 'app-purpose-v1',
    selected_by: 'user',
    purpose: 'consider',
    objective: 'Structure the issue under consideration and produce balanced decision material covering options, opposing views, risks, conditions, unknowns, and consequences.',
    required_focus: [
      'decision_question',
      'options',
      'advantages_and_disadvantages',
      'opposing_views',
      'risks_and_failure_conditions',
      'constraints',
      'unknowns',
      'decision_conditions',
    ],
    operating_rules: COMMON_PURPOSE_RULES,
  },
};

export type CoreProcessAdapterInput = {
  prompt: string;
  purpose: string;
  files: unknown[];
};

type AdapterError = Error & { code?: string; retryable?: boolean };

function adapterError(code: string, message: string, retryable = false): AdapterError {
  return Object.assign(new Error(message), { code, retryable });
}

function manualPurpose(value: string): ManualPurpose | null {
  return MANUAL_PURPOSES.includes(value as ManualPurpose) ? value as ManualPurpose : null;
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

  const selectedPurpose = manualPurpose(purpose);
  if (!selectedPurpose) {
    throw adapterError('APP_PURPOSE_UNSUPPORTED', `Appで未定義のPurposeです: ${purpose || 'unknown'}`, false);
  }

  return {
    question,
    context: JSON.stringify({ app_purpose_contract: MANUAL_PURPOSE_CONTRACTS[selectedPurpose] }),
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
  for (let index = 0; index < APP_SECTION_KEYS.length; index += 1) {
    const block = blocks[index]!;
    const appKey = APP_SECTION_KEYS[index]!;
    const canonicalKey = CANONICAL_SECTION_KEYS[index]!;
    const expectedPrefix = EXPECTED_SECTION_PREFIXES[index]!;
    const lines = block.split('\n');
    const title = (lines.shift() ?? '').trim();
    const body = lines.join('\n').trim();
    if (!title.startsWith(expectedPrefix) || !body) {
      throw adapterError(
        'ASTERA_MAIN8_RESPONSE_INVALID',
        `Astera Core Main8のSection ${index + 1} を検証できません。`,
        false,
      );
    }
    sections[appKey] = {
      title,
      body,
      canonical_key: canonicalKey,
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