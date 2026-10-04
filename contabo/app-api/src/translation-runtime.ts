import type { VaultClient } from './vault-client.js';
import { GRANITE_MODEL_ID, QWEN_MODEL_ID, requestAiCore, type EngineResult } from './translation-ai-core.js';
import { decodeBatch, deterministicValidationError, encodeBatch, guidanceBlock, serializeMeaningBatch, translationInstruction, validateBatchStructure, type TranslationStrategy } from './translation-quality.js';
import { meaningRecord, SEMANTIC_PASS_SCORE, semanticPass, semanticVerdict } from './translation-semantic.js';

type TranslationRuntimeConfig = { modelId: string; apiKeyRef: string; timeoutMs: number };
type Slot = { body: string; apply: (next: string) => unknown };
type BatchResult = EngineResult & { bodies: string[] };
type Usage = {
  provider: 'ai_core_qwen3'; model: string; validationModel: string; calls: number;
  inputTokens: number; outputTokens: number; externalApiCalls: 0; validationFallbacks: number;
  semanticValidations: number; semanticRetries: number; targetLanguage: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function slot(value: unknown): Slot | null {
  if (typeof value === 'string') return { body: value, apply: (next) => next };
  const source = record(value);
  for (const key of ['body', 'content', 'text']) {
    if (typeof source[key] === 'string') return { body: source[key] as string, apply: (next) => ({ ...source, [key]: next }) };
  }
  return null;
}
function collect(result: Record<string, unknown>): Array<{ set: (value: unknown) => void; slot: Slot }> {
  const found: Array<{ set: (value: unknown) => void; slot: Slot }> = [];
  const sections = result.sections;
  if (Array.isArray(sections)) {
    sections.forEach((item, index) => {
      const current = slot(item);
      if (current?.body.trim()) found.push({ set: (value) => { sections[index] = value; }, slot: current });
    });
    return found;
  }
  const objectSections = record(sections);
  if (Object.keys(objectSections).length) {
    for (const [key, value] of Object.entries(objectSections)) {
      const current = slot(value);
      if (current?.body.trim()) found.push({ set: (next) => { objectSections[key] = next; }, slot: current });
    }
    result.sections = objectSections;
    return found;
  }
  for (const key of ['true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection', 'counter_view', 'alternatives', 'recommendation', 'next_prompt']) {
    const current = slot(result[key]);
    if (current?.body.trim()) found.push({ set: (value) => { result[key] = value; }, slot: current });
  }
  return found;
}

async function translateBatch(bodies: string[], language: string, strategy: TranslationStrategy, timeoutMs: number, guidance = ''): Promise<BatchResult> {
  const encoded = encodeBatch(bodies);
  const response = await requestAiCore(
    QWEN_MODEL_ID,
    translationInstruction(strategy),
    `TARGET_LANGUAGE=${language}\nSTRATEGY=${strategy}${guidanceBlock(strategy, guidance)}\nBEGIN_BATCH\n${encoded.text}\nEND_BATCH`,
    timeoutMs,
    8192,
  );
  try {
    const translated = decodeBatch(response.text, bodies.length, encoded.tokens);
    validateBatchStructure(bodies, translated);
    return { ...response, bodies: translated };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('translation validation failed'), { engineUsage: response });
  }
}

export async function translateAsteraResult(payload: unknown, targetLanguage: string, _vault: VaultClient, config: TranslationRuntimeConfig): Promise<{ result: unknown; usage: Usage }> {
  if (!targetLanguage.trim()) throw Object.assign(new Error('Translation target language is required.'), { code: 'TARGET_LANGUAGE_REQUIRED' });
  const cloned = structuredClone(payload) as unknown;
  const root = record(cloned);
  const result = record(root.result ?? root.data ?? root);
  const slots = collect(result);
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, validationFallbacks: 0, semanticValidations: 0, semanticRetries: 0 };
  const add = (engine: EngineResult) => { totals.calls += 1; totals.inputTokens += engine.inputTokens; totals.outputTokens += engine.outputTokens; };

  if (slots.length) {
    const originals = slots.map(({ slot: current }) => current.body);
    let candidate: BatchResult;
    try {
      candidate = await translateBatch(originals, targetLanguage, 'document', config.timeoutMs);
      add(candidate);
    } catch (error) {
      if (!deterministicValidationError(error)) throw error;
      const failedUsage = (error as { engineUsage?: EngineResult }).engineUsage;
      if (failedUsage) add(failedUsage);
      totals.validationFallbacks += 1;
      candidate = await translateBatch(originals, targetLanguage, 'lines', config.timeoutMs);
      add(candidate);
    }

    const sourceMeaning = await meaningRecord(serializeMeaningBatch(originals), config.timeoutMs); add(sourceMeaning);
    const candidateMeaning = await meaningRecord(serializeMeaningBatch(candidate.bodies), config.timeoutMs); add(candidateMeaning);
    const first = await semanticVerdict(sourceMeaning.text, candidateMeaning.text, targetLanguage, config.timeoutMs); add(first.result); totals.semanticValidations += 1;

    if (!semanticPass(first.verdict)) {
      totals.semanticRetries += 1;
      const guidanceParts = [...first.verdict.criticalDifferences];
      if (!first.verdict.targetLanguageMatch) guidanceParts.push(`Candidate prose must be translated into requested target language ${targetLanguage}; do not leave source prose untranslated.`);
      if (!guidanceParts.length) guidanceParts.push(`Semantic score ${first.verdict.score.toFixed(3)} was below ${SEMANTIC_PASS_SCORE}. Preserve every material meaning exactly.`);
      const retry = await translateBatch(originals, targetLanguage, 'semantic_retry', config.timeoutMs, guidanceParts.join('\n')); add(retry);
      const retryMeaning = await meaningRecord(serializeMeaningBatch(retry.bodies), config.timeoutMs); add(retryMeaning);
      const second = await semanticVerdict(sourceMeaning.text, retryMeaning.text, targetLanguage, config.timeoutMs); add(second.result); totals.semanticValidations += 1;
      if (!semanticPass(second.verdict)) {
        const languageStatus = second.verdict.targetLanguageMatch ? 'match' : 'mismatch';
        throw Object.assign(new Error(`Translation failed semantic equivalence after retry: score=${second.verdict.score.toFixed(3)}; target_language=${languageStatus}; differences=${second.verdict.criticalDifferences.join(' | ') || 'unspecified'}`), { code: 'TRANSLATION_SEMANTIC_EQUIVALENCE_FAILED' });
      }
      candidate = retry;
    }
    slots.forEach(({ set, slot: current }, index) => set(current.apply(candidate.bodies[index] ?? current.body)));
  }

  return {
    result: cloned,
    usage: {
      provider: 'ai_core_qwen3', model: QWEN_MODEL_ID, validationModel: GRANITE_MODEL_ID,
      calls: totals.calls, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, externalApiCalls: 0,
      validationFallbacks: totals.validationFallbacks, semanticValidations: totals.semanticValidations,
      semanticRetries: totals.semanticRetries, targetLanguage,
    },
  };
}
