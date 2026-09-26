export type PurposeSelectionKey = 'auto' | 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
export type PurposeSelectionOrigin = 'user' | 'auto';

export type RevisionPurposeAuthority =
  | { mode: 'revision' }
  | {
      mode: 'full';
      reason: 'REVISION_PURPOSE_MISMATCH';
      parent_purpose: string | null;
      current_purpose: PurposeSelectionKey;
      required_action: 'start_new_analysis';
    };

export function purposeSelectionOrigin(purpose: PurposeSelectionKey): PurposeSelectionOrigin {
  return purpose === 'auto' ? 'auto' : 'user';
}

export function revisionPurposeAuthority(parentPurpose: string, currentPurpose: PurposeSelectionKey): RevisionPurposeAuthority {
  const normalizedParent = parentPurpose.trim();
  if (normalizedParent === currentPurpose) return { mode: 'revision' };
  return {
    mode: 'full',
    reason: 'REVISION_PURPOSE_MISMATCH',
    parent_purpose: normalizedParent || null,
    current_purpose: currentPurpose,
    required_action: 'start_new_analysis',
  };
}
