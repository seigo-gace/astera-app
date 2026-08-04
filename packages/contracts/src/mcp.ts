export const DETERMINISTIC_JAPANESE_MCP_REPOSITORY = 'seigo-gace/Deterministic-Japanese-Parser-MCP' as const;

export type MeaningGraphNode = {
  id: string;
  kind: 'action' | 'target' | 'constraint' | 'reference' | 'condition' | 'exception';
  text: string;
};

export type MeaningGraphEdge = {
  from: string;
  to: string;
  relation: 'acts_on' | 'must_preserve' | 'depends_on' | 'refers_to' | 'limited_to' | 'excepts';
};

export type DeterministicJapaneseMcpResponse = {
  schemaVersion: string;
  parserVersion: string;
  requestId: string;
  meaningGraph: {
    nodes: MeaningGraphNode[];
    edges: MeaningGraphEdge[];
  };
  taskGraph: {
    orderedTaskIds: string[];
    prohibitedTaskIds: string[];
  };
  warnings: string[];
  elapsedMs: number;
};

export type DeterministicJapaneseMcpConnectionPolicy = {
  endpoint: string;
  expectedSchemaVersion: string;
  pinnedParserVersion: string;
  timeoutMs: number;
  failClosed: true;
  initialDecisionBudgetMs: 100;
};

export function validateMcpConnectionPolicy(policy: DeterministicJapaneseMcpConnectionPolicy): string[] {
  const errors: string[] = [];
  if (!policy.endpoint.startsWith('https://')) errors.push('endpoint');
  if (!policy.expectedSchemaVersion) errors.push('expectedSchemaVersion');
  if (!policy.pinnedParserVersion) errors.push('pinnedParserVersion');
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) errors.push('timeoutMs');
  if (policy.failClosed !== true) errors.push('failClosed');
  if (policy.initialDecisionBudgetMs !== 100) errors.push('initialDecisionBudgetMs');
  return errors;
}
