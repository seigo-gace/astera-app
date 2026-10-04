import { codedError, GRANITE_MODEL_ID, QWEN_MODEL_ID, requestAiCore, type EngineResult } from './translation-ai-core.js';

export type SemanticVerdict = { equivalent: boolean; score: number; criticalDifferences: string[] };
export const SEMANTIC_PASS_SCORE = 0.98;

function object(raw: string, code: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const body = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    throw codedError(code, 'AI Core returned invalid semantic-validation JSON.', true);
  }
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

const MEANING_SYSTEM = [
  'You are an independent semantic recorder for translation quality control.',
  'Read only supplied text and produce a compact English semantic record; do not improve it.',
  'Capture every claim, command, prohibition, negation, condition, exception, comparison, quantity relation, deadline, entity, and uncertainty.',
  'Preserve must/must not/may/should/only/if/unless/before/after distinctions.',
  'Return strict JSON only with array keys claims,constraints,conditions,entities,quantities,uncertainties.',
].join(' ');

const VERDICT_SYSTEM = [
  'You are the Astera independent semantic-equivalence judge.',
  'Compare two English semantic records independently produced from an original and its translation.',
  'Judge meaning, not wording. Any changed negation, command strength, condition, exception, quantity relation, deadline, entity, or safety constraint is critical.',
  'Return strict JSON only: {"equivalent":boolean,"score":number,"critical_differences":string[]}.',
  'Use equivalent=true only when no material meaning is missing, added, weakened, strengthened, or contradicted.',
].join(' ');

export async function meaningRecord(source: string, timeoutMs: number): Promise<EngineResult> {
  const result = await requestAiCore(QWEN_MODEL_ID, MEANING_SYSTEM, `TEXT_BEGIN\n${source}\nTEXT_END`, timeoutMs, 4096);
  const parsed = object(result.text, 'TRANSLATION_SEMANTIC_RECORD_INVALID');
  const keys = ['claims', 'constraints', 'conditions', 'entities', 'quantities', 'uncertainties'] as const;
  const normalized: Record<string, string[]> = {};
  for (const key of keys) {
    if (!Array.isArray(parsed[key])) throw codedError('TRANSLATION_SEMANTIC_RECORD_INVALID', `Semantic record is missing array field: ${key}.`, true);
    normalized[key] = strings(parsed[key]);
  }
  return { ...result, text: JSON.stringify(normalized) };
}

export async function semanticVerdict(sourceRecord: string, candidateRecord: string, timeoutMs: number): Promise<{ verdict: SemanticVerdict; result: EngineResult }> {
  const result = await requestAiCore(
    GRANITE_MODEL_ID,
    VERDICT_SYSTEM,
    `ORIGINAL_RECORD_BEGIN\n${sourceRecord}\nORIGINAL_RECORD_END\nTRANSLATION_RECORD_BEGIN\n${candidateRecord}\nTRANSLATION_RECORD_END`,
    timeoutMs,
    2048,
  );
  const parsed = object(result.text, 'TRANSLATION_SEMANTIC_VERDICT_INVALID');
  const scoreValue = Number(parsed.score);
  const verdict = {
    equivalent: parsed.equivalent === true,
    score: Number.isFinite(scoreValue) ? Math.max(0, Math.min(1, scoreValue)) : 0,
    criticalDifferences: strings(parsed.critical_differences),
  };
  return { verdict, result };
}

export function semanticPass(verdict: SemanticVerdict): boolean {
  return verdict.equivalent && verdict.score >= SEMANTIC_PASS_SCORE && verdict.criticalDifferences.length === 0;
}
