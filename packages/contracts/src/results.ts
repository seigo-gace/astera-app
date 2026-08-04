export const RESULT_SECTION_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

export type ResultSectionKey = (typeof RESULT_SECTION_KEYS)[number];

export type ResultSection = {
  key: ResultSectionKey;
  title: string;
  content: string;
  sourceIds: string[];
};

export type SourceReference = {
  id: string;
  url: string;
  title: string;
  retrievedAt: string;
  status: 'verified' | 'unverified' | 'unavailable';
};

export type AsteraResultEnvelope = {
  schemaVersion: string;
  runtimeVersion: string;
  purposeVersion: string;
  jobId: string;
  completionState: 'complete' | 'partial' | 'failed';
  sections: Record<ResultSectionKey, ResultSection>;
  sources: SourceReference[];
  warnings: string[];
  generatedAt: string;
};

export function missingResultSections(value: Partial<Record<ResultSectionKey, unknown>>): ResultSectionKey[] {
  return RESULT_SECTION_KEYS.filter((key) => value[key] == null);
}
