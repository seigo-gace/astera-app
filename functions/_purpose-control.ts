export type PurposeSelectionKey = 'auto' | 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
export type PurposeSelectionOrigin = 'user' | 'auto';

export type RevisionPurposeAuthority =
  | { ok: true }
  | {
      ok: false;
      code: 'REVISION_PURPOSE_MISMATCH';
      status: 409;
      parent_purpose: string | null;
      current_purpose: PurposeSelectionKey;
      required_action: 'start_new_analysis';
    };

export function purposeSelectionOrigin(purpose: PurposeSelectionKey): PurposeSelectionOrigin {
  return purpose === 'auto' ? 'auto' : 'user';
}

export function revisionPurposeAuthority(parentPurpose: string, currentPurpose: PurposeSelectionKey): RevisionPurposeAuthority {
  const normalizedParent = parentPurpose.trim();
  if (normalizedParent === currentPurpose) return { ok: true };
  return {
    ok: false,
    code: 'REVISION_PURPOSE_MISMATCH',
    status: 409,
    parent_purpose: normalizedParent || null,
    current_purpose: currentPurpose,
    required_action: 'start_new_analysis',
  };
}
