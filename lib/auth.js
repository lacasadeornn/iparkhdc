// conrisk 인증 도구: Google ID 토큰 검증 + 서명된 세션 쿠키
// 클라이언트 비밀값(client secret)은 쓰지 않는다. (OpenID Connect id_token + form_post 흐름)

const enc = new TextEncoder();
const dec = new TextDecoder();

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const SESSION_COOKIE = 'cr_session';
export const NONCE_COOKIE = 'cr_nonce';
export const SESSION_TTL_SEC = 8 * 60 * 60; // 8시간

export function b64urlEncode(bytes) {
  if (typeof bytes === 'string') bytes = enc.encode(bytes);
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(n = 24) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64urlEncode(a);
}

let jwksCache = { at: 0, keys: null };

async function getJwks(fetchImpl) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const body = await res.json();
  jwksCache = { at: Date.now(), keys: body.keys || [] };
  return jwksCache.keys;
}

export function _resetJwksCache() {
  jwksCache = { at: 0, keys: null };
}

/** 허용 계정 확인. 둘 다 비어 있으면 인증된 모든 Google 계정 허용. */
export function isAllowed(email, { allowedEmails = '', allowedDomains = '' } = {}) {
  const e = String(email || '').toLowerCase().trim();
  const emails = splitList(allowedEmails);
  const domains = splitList(allowedDomains);
  if (!emails.length && !domains.length) return true;
  if (emails.includes(e)) return true;
  const domain = e.split('@')[1] || '';
  return domains.includes(domain);
}

function splitList(s) {
  return String(s || '')
    .split(/[,\s;]+/)
    .map((x) => x.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * Google ID 토큰(JWT) 검증. 실패하면 Error(사유) 를 던진다.
 * @returns 검증된 claims
 */
export async function verifyGoogleIdToken(token, { clientId, nonce, now = Date.now(), fetchImpl = fetch }) {
  if (!clientId) throw new Error('client_id_missing');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  let header, claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch {
    throw new Error('malformed_token');
  }
  if (header.alg !== 'RS256') throw new Error('bad_alg');
  const keys = await getJwks(fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown_kid');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(parts[2]),
    enc.encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('bad_signature');
  const nowSec = Math.floor(now / 1000);
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('bad_issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 60) throw new Error('expired');
  if (typeof claims.iat === 'number' && claims.iat > nowSec + 300) throw new Error('issued_in_future');
  if (!nonce || claims.nonce !== nonce) throw new Error('bad_nonce');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email_not_verified');
  if (!claims.email) throw new Error('no_email');
  return claims;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signSession(data, secret, now = Date.now()) {
  if (!secret || secret.length < 16) throw new Error('session_secret_missing');
  const payload = { ...data, exp: Math.floor(now / 1000) + SESSION_TTL_SEC };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64urlEncode(sig);
}

export async function verifySession(value, secret, now = Date.now()) {
  if (!value || !secret) return null;
  const [body, sig] = String(value).split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const p = JSON.parse(dec.decode(b64urlDecode(body)));
    if (typeof p.exp !== 'number' || p.exp < Math.floor(now / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookie(name, value, { maxAge, sameSite = 'Lax', path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

/** 로컬 개발용 우회: DEV_AUTH_BYPASS=1 이고 localhost 로 접속했을 때만 */
export function devBypass(request, env) {
  if (env.DEV_AUTH_BYPASS !== '1') return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}
