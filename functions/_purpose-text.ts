import { FunctionHttpError } from './_account-projection';

export const MAX_PURPOSE_TEXT_CHARACTERS = 2_000;

function rawText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePurposeText(value: unknown): string | null {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const purposeText = rawText(source.purpose_text ?? source.purposeText ?? source.user_objective ?? source.userObjective);
  if (!purposeText) return null;
  if ([...purposeText].length > MAX_PURPOSE_TEXT_CHARACTERS) {
    throw new FunctionHttpError(
      413,
      'PURPOSE_TEXT_TOO_LARGE',
      `自由入力の目的は${MAX_PURPOSE_TEXT_CHARACTERS.toLocaleString()}文字以内です。`,
    );
  }
  return purposeText;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fingerprintWithPurposeText(baseFingerprint: string, purposeText: string | null): Promise<string> {
  return sha256(JSON.stringify({ baseFingerprint, purposeText }));
}

export function samePurposeText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left?.trim() || null) === (right?.trim() || null);
}
