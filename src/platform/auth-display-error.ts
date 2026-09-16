import { authErrorCode } from './auth-client';
import type { PlatformTextKey } from './platform-text';

const AUTH_ERROR_TEXT_BY_CODE: Record<string, PlatformTextKey> = {
  INVALID_EMAIL_OR_PASSWORD: 'authErrorInvalidCredentials',
  INVALID_CREDENTIALS: 'authErrorInvalidCredentials',
  USER_NOT_FOUND: 'authErrorInvalidCredentials',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'authErrorInvalidCredentials',
  EMAIL_NOT_VERIFIED: 'authErrorEmailNotVerified',
  USER_ALREADY_EXISTS: 'authErrorAccountAlreadyExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'authErrorAccountAlreadyExists',
  INVALID_PASSWORD: 'authErrorInvalidPassword',
  PASSWORD_TOO_SHORT: 'authErrorPasswordLength',
  PASSWORD_TOO_LONG: 'authErrorPasswordLength',
  RATE_LIMIT_EXCEEDED: 'authErrorRateLimited',
  TOO_MANY_REQUESTS: 'authErrorRateLimited',
  HTTP_429: 'authErrorRateLimited',
  INVALID_TOKEN: 'authErrorInvalidToken',
  TOKEN_EXPIRED: 'authErrorInvalidToken',
  RESET_TOKEN_EXPIRED: 'authErrorInvalidToken',
  SESSION_EXPIRED: 'authErrorSessionExpired',
  INVALID_CALLBACK_URL: 'authErrorOAuthFailed',
  PROVIDER_NOT_FOUND: 'authErrorOAuthFailed',
  FAILED_TO_GET_USER_INFO: 'authErrorOAuthFailed',
  FAILED_TO_GET_OAUTH2_TOKENS: 'authErrorOAuthFailed',
  OAUTH2_REQUEST_ERROR: 'authErrorOAuthFailed',
  PASSKEY_AUTHENTICATION_FAILED: 'authErrorPasskeyFailed',
  PASSKEY_SIGN_IN_FAILED: 'authErrorPasskeyFailed',
};

type TextResolver = (key: PlatformTextKey) => string;

export function authDisplayError(
  error: unknown,
  text: TextResolver,
  fallbackKey: PlatformTextKey,
): string {
  const code = authErrorCode(error, '').trim().toUpperCase();
  const key = AUTH_ERROR_TEXT_BY_CODE[code]
    ?? (code.startsWith('HTTP_429') ? 'authErrorRateLimited' : undefined)
    ?? fallbackKey;
  return text(key);
}
