import type { D1Database } from './_account-projection';

export type ShareManagementActor = { userId: string; tenantId: string };

type ShareRow = {
  id: string;
  tenant_id: string;
  result_id: string;
  revision_number: number;
  share_kind: 'public' | 'private';
  created_by_user_id: string;
  recipient_user_id: string | null;
  token_prefix: string | null;
  password_hash: string | null;
  download_allowed: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export class ShareManagementError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ShareManagementError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function passwordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 120_000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2-sha256:${iterations}:${bytesToBase64Url(salt)}:${bytesToBase64Url(new Uint8Array(bits))}`;
}
function status(row: ShareRow): 'active' | 'expired' | 'revoked' {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= Date.now()) return 'expired';
  return 'active';
}
function publicManagedShare(row: ShareRow): Record<string, unknown> {
  return {
    id: row.id,
    share_id: row.id,
    result_id: row.result_id,
    revision_number: Number(row.revision_number),
    visibility: row.share_kind,
    recipient_user_id: row.recipient_user_id,
    token_prefix: row.token_prefix,
    password_protected: Boolean(row.password_hash),
    download_allowed: Boolean(row.download_allowed),
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    status: status(row),
  };
}
async function ownedShare(db: D1Database, actor: ShareManagementActor, shareId: string): Promise<ShareRow> {
  const row = await db.prepare(`SELECT id,tenant_id,result_id,revision_number,share_kind,created_by_user_id,recipient_user_id,
      token_prefix,password_hash,download_allowed,expires_at,revoked_at,created_at
    FROM result_shares
    WHERE id=?1 AND tenant_id=?2 AND created_by_user_id=?3
    LIMIT 1`).bind(shareId, actor.tenantId, actor.userId).first<ShareRow>();
  if (!row) throw new ShareManagementError(404, 'SHARE_NOT_FOUND', 'Shareが見つかりません。');
  return row;
}
function validFutureExpiry(raw: unknown): string {
  const value = text(raw);
  const parsed = Date.parse(value);
  const now = Date.now();
  if (!value || !Number.isFinite(parsed) || parsed <= now || parsed > now + 90 * 24 * 60 * 60 * 1000) {
    throw new ShareManagementError(422, 'SHARE_EXPIRY_INVALID', '共有期限は現在から90日以内の未来日時です。');
  }
  return new Date(parsed).toISOString();
}

export async function listManagedShares(db: D1Database, actor: ShareManagementActor): Promise<Record<string, unknown>> {
  const rows = (await db.prepare(`SELECT id,tenant_id,result_id,revision_number,share_kind,created_by_user_id,recipient_user_id,
      token_prefix,password_hash,download_allowed,expires_at,revoked_at,created_at
    FROM result_shares
    WHERE tenant_id=?1 AND created_by_user_id=?2
    ORDER BY created_at DESC`).bind(actor.tenantId, actor.userId).all<ShareRow>()).results ?? [];
  return { shares: rows.map(publicManagedShare) };
}

export async function updateManagedShare(
  db: D1Database,
  actor: ShareManagementActor,
  shareId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const body = record(value);
  const current = await ownedShare(db, actor, shareId);
  if (current.revoked_at) throw new ShareManagementError(409, 'SHARE_REVOKED', '失効済みShareは変更できません。新しいShareを作成してください。');

  const hasExpiry = Object.prototype.hasOwnProperty.call(body, 'expires_at');
  const hasDownload = Object.prototype.hasOwnProperty.call(body, 'download_allowed');
  const hasRecipient = Object.prototype.hasOwnProperty.call(body, 'recipient_user_id');
  const hasPassword = Object.prototype.hasOwnProperty.call(body, 'password');
  const clearPassword = body.clear_password === true;
  const requestedVisibility = text(body.visibility ?? body.share_kind);
  if (requestedVisibility && requestedVisibility !== current.share_kind) {
    throw new ShareManagementError(422, 'SHARE_VISIBILITY_IMMUTABLE', 'Public／Private種別は変更できません。新しいShareを作成してください。');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'result_id') || Object.prototype.hasOwnProperty.call(body, 'revision_number')) {
    throw new ShareManagementError(422, 'SHARE_SNAPSHOT_IMMUTABLE', '共有対象Result／Revisionは変更できません。新しいShareを作成してください。');
  }
  if (!hasExpiry && !hasDownload && !hasRecipient && !hasPassword && !clearPassword) {
    throw new ShareManagementError(422, 'SHARE_PATCH_EMPTY', '変更するShare設定がありません。');
  }

  let expiresAt = current.expires_at;
  if (hasExpiry) expiresAt = validFutureExpiry(body.expires_at);

  let downloadAllowed = Boolean(current.download_allowed);
  if (hasDownload) {
    if (typeof body.download_allowed !== 'boolean') throw new ShareManagementError(422, 'SHARE_DOWNLOAD_FLAG_INVALID', 'download_allowedはtrue／falseで指定してください。');
    downloadAllowed = body.download_allowed;
  }

  let recipient = current.recipient_user_id;
  let encodedPassword = current.password_hash;
  if (current.share_kind === 'public') {
    if (hasRecipient) throw new ShareManagementError(422, 'SHARE_RECIPIENT_NOT_APPLICABLE', 'Public ShareにはRecipientを設定できません。');
    if (clearPassword && hasPassword && text(body.password)) {
      throw new ShareManagementError(422, 'SHARE_PASSWORD_PATCH_CONFLICT', 'Password再設定と解除を同時に指定できません。');
    }
    if (clearPassword) encodedPassword = null;
    if (hasPassword) {
      const password = text(body.password);
      if (password && password.length < 8) throw new ShareManagementError(422, 'SHARE_PASSWORD_TOO_SHORT', 'Passwordは8文字以上です。');
      if (password) encodedPassword = await passwordHash(password);
    }
  } else {
    if (hasPassword || clearPassword) throw new ShareManagementError(422, 'SHARE_PASSWORD_NOT_APPLICABLE', 'Private ShareはRecipient Accountで保護するためPasswordを設定しません。');
    if (hasRecipient) {
      const nextRecipient = text(body.recipient_user_id);
      if (!nextRecipient || nextRecipient === actor.userId) throw new ShareManagementError(422, 'SHARE_RECIPIENT_INVALID', '共有先Accountを確認してください。');
      const exists = await db.prepare(`SELECT id FROM user WHERE id=?1 LIMIT 1`).bind(nextRecipient).first<{ id: string }>();
      if (!exists) throw new ShareManagementError(422, 'SHARE_RECIPIENT_INVALID', '共有先Accountを確認してください。');
      recipient = nextRecipient;
    }
  }

  await db.prepare(`UPDATE result_shares
    SET recipient_user_id=?1,password_hash=?2,download_allowed=?3,expires_at=?4
    WHERE id=?5 AND tenant_id=?6 AND created_by_user_id=?7 AND revoked_at IS NULL`)
    .bind(recipient, encodedPassword, downloadAllowed ? 1 : 0, expiresAt, current.id, actor.tenantId, actor.userId).run();
  return { share: publicManagedShare(await ownedShare(db, actor, current.id)) };
}
