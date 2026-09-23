import { randomBytes } from 'node:crypto';

const APP = 'https://staging.asterav8.jp';
const MAIL = 'https://api.mail.tm';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  capture(response) {
    const raw = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const value of raw) {
      const first = String(value).split(';', 1)[0];
      const index = first.indexOf('=');
      if (index > 0) this.values.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
    }
  }
  header() { return [...this.values].map(([k, v]) => `${k}=${v}`).join('; '); }
}

function jsonOrNull(text) { try { return JSON.parse(text); } catch { return null; } }
function collection(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['hydra:member', 'member', '@graph', 'items', 'data']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

async function request(url, init = {}, jar) {
  const headers = new Headers(init.headers || {});
  if (jar?.header()) headers.set('Cookie', jar.header());
  const response = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar?.capture(response);
  return response;
}

async function follow(url, init = {}, jar, max = 10) {
  let current = url;
  let options = { ...init };
  for (let hop = 0; hop <= max; hop += 1) {
    const response = await request(current, options, jar);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    current = new URL(location, current).toString();
    if ([301, 302, 303].includes(response.status) && String(options.method || 'GET').toUpperCase() !== 'GET') {
      options = { method: 'GET', headers: { Accept: 'text/html,application/json' } };
    }
  }
  throw new Error('REDIRECT_LIMIT_EXCEEDED');
}

async function mailJson(path, init = {}, token = '') {
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${MAIL}${path}`, { ...init, headers });
  const text = await response.text();
  const body = jsonOrNull(text);
  if (!response.ok) throw new Error(`MAIL_TM_${path.replaceAll('/', '_')}_${response.status}:${text.slice(0, 200)}`);
  if (body === null) throw new Error(`MAIL_TM_NON_JSON_${path.replaceAll('/', '_')}:${response.headers.get('content-type') || 'missing'}`);
  return body;
}

function decodeHtmlEntities(value) {
  return String(value).replaceAll('&amp;', '&').replaceAll('&#38;', '&').replaceAll('&#x26;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function verificationUrl(message) {
  const sources = [message?.text, ...(Array.isArray(message?.html) ? message.html : []), message?.intro]
    .filter(Boolean).map(decodeHtmlEntities).join('\n');
  const urls = sources.match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (const candidate of urls) {
    let parsed;
    try { parsed = new URL(candidate.replace(/[),.;]+$/, '')); } catch { continue; }
    if (parsed.hostname === 'staging.asterav8.jp' && parsed.pathname.includes('/api/auth/verify-email')) return parsed.toString();
  }
  throw new Error('VERIFICATION_URL_NOT_FOUND');
}

const nonce = `${Date.now()}-${randomBytes(5).toString('hex')}`;
const mailPassword = `M-${randomBytes(18).toString('base64url')}!7`;
const asteraPassword = `A-${randomBytes(18).toString('base64url')}!9`;
let mailToken = '';
let mailAccountId = '';
let email = '';

console.log(`::add-mask::${mailPassword}`);
console.log(`::add-mask::${asteraPassword}`);

try {
  const domainsBody = await mailJson('/domains');
  const domainItems = collection(domainsBody);
  console.log(`MAIL_TM_DOMAINS_SHAPE=${Object.keys(domainsBody || {}).sort().join(',') || 'array'} COUNT=${domainItems.length}`);
  const domain = domainItems.find((item) => item?.isActive !== false && item?.is_active !== false && item?.domain)?.domain;
  if (!domain) throw new Error('MAIL_TM_ACTIVE_DOMAIN_NOT_FOUND');
  email = `astera-e2e-${nonce}@${domain}`;
  console.log(`::add-mask::${email}`);

  const account = await mailJson('/accounts', { method: 'POST', body: JSON.stringify({ address: email, password: mailPassword }) });
  mailAccountId = String(account?.id || '');
  if (!mailAccountId) throw new Error('MAIL_TM_ACCOUNT_ID_MISSING');
  const token = await mailJson('/token', { method: 'POST', body: JSON.stringify({ address: email, password: mailPassword }) });
  mailToken = String(token?.token || '');
  if (!mailToken) throw new Error('MAIL_TM_TOKEN_MISSING');
  console.log(`::add-mask::${mailToken}`);
  console.log('MAILBOX_GATE=PASS');

  const jar = new CookieJar();
  const signup = await request(`${APP}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, Accept: 'application/json' },
    body: JSON.stringify({ email, name: email, password: asteraPassword, callbackURL: `${APP}/app/new` }),
  }, jar);
  const signupText = await signup.text();
  if (!signup.ok) throw new Error(`ASTERA_SIGNUP_FAILED_${signup.status}:${signupText.slice(0, 300)}`);
  console.log(`ASTERA_SIGNUP=PASS HTTP=${signup.status}`);

  let message = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const messages = collection(await mailJson('/messages', {}, mailToken));
    const item = messages.find((candidate) => candidate?.id);
    if (item?.id) {
      message = await mailJson(`/messages/${encodeURIComponent(item.id)}`, {}, mailToken);
      console.log(`VERIFICATION_EMAIL=RECEIVED ATTEMPT=${attempt}`);
      break;
    }
    if (attempt === 60) throw new Error('VERIFICATION_EMAIL_TIMEOUT');
    await sleep(2000);
  }

  const verify = await follow(verificationUrl(message), { method: 'GET', headers: { Accept: 'text/html,application/json' } }, jar);
  const verifyText = await verify.text();
  if (!verify.ok) throw new Error(`ASTERA_EMAIL_VERIFY_FAILED_${verify.status}:${verifyText.slice(0, 300)}`);
  console.log(`ASTERA_EMAIL_VERIFY=PASS HTTP=${verify.status}`);

  const signIn = await request(`${APP}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, Accept: 'application/json' },
    body: JSON.stringify({ email, password: asteraPassword, rememberMe: true, callbackURL: `${APP}/app/new` }),
  }, jar);
  const signInText = await signIn.text();
  const signInBody = jsonOrNull(signInText);
  if (!signIn.ok) throw new Error(`ASTERA_SIGNIN_FAILED_${signIn.status}:${signInText.slice(0, 300)}`);
  if (signInBody?.twoFactorRedirect === true || signInBody?.data?.twoFactorRedirect === true) throw new Error('UNEXPECTED_2FA_FOR_NEW_E2E_ACCOUNT');
  if (!jar.header()) throw new Error('ASTERA_SESSION_COOKIE_MISSING');
  console.log(`ASTERA_SIGNIN=PASS HTTP=${signIn.status}`);

  const sessionResponse = await request(`${APP}/api/auth/get-session`, { method: 'GET', headers: { Origin: APP, Accept: 'application/json' } }, jar);
  const sessionText = await sessionResponse.text();
  const session = jsonOrNull(sessionText);
  const sessionUser = session?.user || session?.data?.user;
  if (!sessionResponse.ok || !sessionUser?.id || !sessionUser?.email) throw new Error(`ASTERA_SESSION_INVALID_${sessionResponse.status}:${sessionText.slice(0, 300)}`);
  console.log(`ASTERA_SESSION=PASS HTTP=${sessionResponse.status}`);

  const accountResponse = await request(`${APP}/api/account`, { method: 'GET', headers: { Origin: APP, Accept: 'application/json' } }, jar);
  const accountText = await accountResponse.text();
  const projection = jsonOrNull(accountText)?.account;
  if (!accountResponse.ok) throw new Error(`ASTERA_ACCOUNT_FAILED_${accountResponse.status}:${accountText.slice(0, 300)}`);
  if (projection?.account_status !== 'active') throw new Error(`ASTERA_ACCOUNT_NOT_ACTIVE:${projection?.account_status || 'missing'}`);
  if (projection?.email_verified !== true) throw new Error('ASTERA_ACCOUNT_EMAIL_NOT_VERIFIED');
  if (!projection?.credit || !Number.isFinite(Number(projection.credit.available))) throw new Error('ASTERA_CREDIT_PROJECTION_MISSING');
  console.log(`ASTERA_ACCOUNT_PROJECTION=PASS HTTP=${accountResponse.status} STATUS=${projection.account_status} CREDIT_AVAILABLE=${Number(projection.credit.available)}`);
  console.log('REAL_BETTER_AUTH_STAGING_E2E=PASS');
} finally {
  if (mailToken && mailAccountId) {
    const response = await fetch(`${MAIL}/accounts/${encodeURIComponent(mailAccountId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${mailToken}` } }).catch(() => null);
    console.log(`MAILBOX_CLEANUP=${response?.status === 204 ? 'PASS' : 'BEST_EFFORT'}`);
  }
}
