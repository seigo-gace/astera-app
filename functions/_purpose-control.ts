import { FunctionHttpError } from './_account-projection';
import type { PurposeKey } from './_job-policy';

export type PurposeSelectionOrigin = 'user' | 'auto';

export function purposeSelectionOrigin(purpose: PurposeKey): PurposeSelectionOrigin {
  return purpose === 'auto' ? 'auto' : 'user';
}

export function assertRevisionPurposeAuthority(parentPurpose: string, currentPurpose: PurposeKey): void {
  const normalizedParent = parentPurpose.trim();
  if (normalizedParent === currentPurpose) return;
  throw new FunctionHttpError(
    409,
    'REVISION_PURPOSE_MISMATCH',
    '用途を変更した実行は修整再投稿として扱えません。新しい分析として実行してください。',
    {
      parent_purpose: normalizedParent || null,
      current_purpose: currentPurpose,
      required_action: 'start_new_analysis',
    },
  );
}
