import type {
  ActorContext,
  AsteraResultEnvelope,
  CreateJobRequest,
  DeterministicJapaneseMcpResponse,
} from '../../../packages/contracts/src/index';

export type InternalProcessRequest = {
  actor: ActorContext;
  job: CreateJobRequest;
  meaning?: DeterministicJapaneseMcpResponse;
};

export type InternalProcessResponse = {
  result?: AsteraResultEnvelope;
  resourceUsage?: {
    inputUnits: number;
    outputUnits: number;
    durationMs: number;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export const contaboAppApiReadiness = {
  status: 'contract_source_only',
  deployed: false,
  postgresMigrationApplied: false,
  vaultConnected: false,
  privateDataBrokerVerified: false,
  deterministicJapaneseMcpConnected: false,
} as const;

export function validateInternalProcessRequest(request: InternalProcessRequest): string[] {
  const errors: string[] = [];
  if (request.actor.accountStatus !== 'active') errors.push('ACCOUNT_NOT_ACTIVE');
  if (request.actor.authStage !== 'authenticated') errors.push('AUTHENTICATION_INCOMPLETE');
  if (!request.job.requestId) errors.push('REQUEST_ID_REQUIRED');
  if (!request.job.tenantId || request.job.tenantId !== request.actor.tenantId) errors.push('TENANT_MISMATCH');
  if (!request.job.prompt && request.job.fileIds.length === 0) errors.push('INPUT_REQUIRED');
  return errors;
}
