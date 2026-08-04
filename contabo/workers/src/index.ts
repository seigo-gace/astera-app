export type WorkerKind = 'cleanup' | 'deletion' | 'transfer' | 'reconciliation' | 'usage-sync';

export type WorkerJobEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  jobId: string;
  kind: WorkerKind;
  tenantId: string;
  correlationId: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  notBefore?: string;
  payload: TPayload;
};

export const contaboWorkersReadiness = {
  status: 'contract_source_only',
  deployed: false,
  queueConnected: false,
  deadLetterQueueConnected: false,
  privatePayloadCanaryVerified: false,
} as const;

export function shouldRetryWorkerJob(job: WorkerJobEnvelope, retryable: boolean): boolean {
  return retryable && job.attempt < job.maxAttempts;
}

export function assertNoPrivatePayload(payload: Record<string, unknown>): string[] {
  const prohibited = ['prompt', 'body', 'fileContent', 'extractedText', 'password', 'token', 'apiKey'];
  return prohibited.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
}
