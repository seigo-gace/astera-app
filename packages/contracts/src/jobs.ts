export type JobState =
  | 'draft'
  | 'validating'
  | 'estimating'
  | 'credit_low'
  | 'credit_critical'
  | 'credit_insufficient'
  | 'awaiting_confirmation'
  | 'reserving_credit'
  | 'purchase_pending'
  | 'uploading'
  | 'queued'
  | 'running'
  | 'assembling_result'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type SelectedExecutionOption =
  | { key: 'translation'; profileVersion: string; targetLanguage: string; sourceLanguage?: string; glossaryId?: string }
  | { key: 'agent-mode'; policyVersion: string; mode: 'low' | 'medium' | 'high' }
  | { key: 'document'; templateSource: 'official' | 'personal'; templateId: string; templateVersion: string }
  | { key: 'external-storage-transfer'; destinationId: string; adapterVersion: string; format: string };

export type JobEstimate = {
  estimateId: string;
  requiredCredits: number;
  availableCredits: number;
  reservedCredits: number;
  expiresAt: string;
  policyVersion: string;
};

export type CreateJobRequest = {
  requestId: string;
  tenantId: string;
  prompt: string;
  purpose: string;
  options: SelectedExecutionOption[];
  fileIds: string[];
  privateMode: boolean;
  estimateId: string;
};

export function canReserveEstimate(estimate: JobEstimate): boolean {
  return estimate.requiredCredits > 0 && estimate.availableCredits >= estimate.requiredCredits;
}
