import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';

export type AuthEnv = {
  ASTERA_DB: unknown;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_RP_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  AUTH_EMAIL_ENDPOINT?: string;
  AUTH_EMAIL_TOKEN?: string;
};

type AuthEmailTemplate = 'verify-email' | 'reset-password' | 'two-factor';

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_NOT_CONFIGURED`);
  return normalized;
}

async function sendAuthEmail(
  env: AuthEnv,
  input: {
    to: string;
    template: AuthEmailTemplate;
    variables: Record<string, string>;
    privateData?: boolean;
  },
): Promise<void> {
  const endpoint = required(env.AUTH_EMAIL_ENDPOINT, 'AUTH_EMAIL_ENDPOINT');
  const token = required(env.AUTH_EMAIL_TOKEN, 'AUTH_EMAIL_TOKEN');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      to: input.to,
      template: input.template,
      variables: input.variables,
      private_data: input.privateData === true,
    }),
  });
  if (!response.ok) throw new Error(`AUTH_EMAIL_DELIVERY_FAILED_${response.status}`);
}

export function createAuth(env: AuthEnv) {
  const baseURL = required(env.BETTER_AUTH_URL, 'BETTER_AUTH_URL');
  const rpID = env.BETTER_AUTH_RP_ID?.trim() || new URL(baseURL).hostname;
  const socialProviders = {
    ...(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
      ? { google: { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim() } }
      : {}),
    ...(env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim()
      ? { github: { clientId: env.GITHUB_CLIENT_ID.trim(), clientSecret: env.GITHUB_CLIENT_SECRET.trim() } }
      : {}),
  };

  return betterAuth({
    appName: 'Astera',
    baseURL,
    basePath: '/api/auth',
    secret: required(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET'),
    database: env.ASTERA_DB as never,
    trustedOrigins: [new URL(baseURL).origin],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
    },
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          template: 'reset-password',
          variables: { action_url: url, app_name: 'Astera' },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          template: 'verify-email',
          variables: { action_url: url, app_name: 'Astera' },
        });
      },
    },
    socialProviders,
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    advanced: {
      cookiePrefix: 'astera',
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Astera',
        otpOptions: {
          period: 300,
          async sendOTP({ user, otp }) {
            await sendAuthEmail(env, {
              to: user.email,
              template: 'two-factor',
              variables: {
                otp_code: otp,
                app_name: 'Astera',
                expiration_minutes: '5',
              },
              privateData: true,
            });
          },
        },
      }),
      passkey({
        rpID,
        rpName: 'Astera',
        origin: new URL(baseURL).origin,
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
      }),
    ],
  });
}
