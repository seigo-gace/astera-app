const SECTION_HEADER =
  /^(?:\d{2}\s+(?:True Objective|Missing Context|Fact Check|Risk Detection|Opposing View|Comparison Material|Comparison|Evidence Status|Evidence State|Re-instruction to Main AI(?: \/ User)?)|\d{2}\s+(?:本当の目的|前提不足|事実確認|危機察知|反対視点|比較案|根拠成立状態|主役AI／利用者への再指示))/m;

const KEY_BY_INDEX = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

export function asteraResultFromV8PlainText(text: string): Record<string, unknown> {
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw Object.assign(new Error('Astera Process Responseが空です。'), {
      code: 'ASTERA_PROCESS_RESPONSE_INVALID',
      retryable: true,
    });
  }

  const blocks = normalized.split(/\n---\n/);
  const sections: Record<string, { body: string }> = {};

  for (let i = 0; i < KEY_BY_INDEX.length; i++) {
    const key = KEY_BY_INDEX[i] as (typeof KEY_BY_INDEX)[number];
    const block = blocks[i]?.trim() || '';
    if (!block) continue;
    const lines = block.split('\n');
    const body = lines.slice(1).join('\n').trim() || lines[0]?.trim() || block;
    if (body) sections[key] = { body };
  }

  if (Object.keys(sections).length < KEY_BY_INDEX.length && SECTION_HEADER.test(normalized)) {
    const parts = normalized.split(/(?=^(?:\d{2}\s+(?:True Objective|Missing Context|Fact Check|Risk Detection|Opposing View|Comparison Material|Comparison|Evidence Status|Evidence State|Re-instruction)|\d{2}\s+(?:本当の目的|前提不足|事実確認|危機察知|反対視点|比較案|根拠成立状態|主役AI)))/m);
    for (let i = 0; i < KEY_BY_INDEX.length && i < parts.length; i++) {
      const key = KEY_BY_INDEX[i] as (typeof KEY_BY_INDEX)[number];
      const part = parts[i]?.trim();
      if (!part || sections[key]) continue;
      const lines = part.split('\n');
      const body = lines.slice(1).join('\n').trim() || lines[0]?.trim() || part;
      sections[key] = { body };
    }
  }

  return {
    schema_version: 'astera-result-v1',
    runtime_version: 'astera-v8-process-plaintext',
    purpose_version: 'purpose-v1',
    completion_state: 'complete',
    sections,
    sources: [],
  };
}
