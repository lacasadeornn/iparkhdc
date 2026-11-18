// 외부 판정: 실제 RSA 키로 서명한 토큰을 만들어 검증 로직이 위조·만료·타 앱 토큰을 거절하는지 확인
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGoogleIdToken, signSession, verifySession, isAllowed, b64urlEncode, _resetJwksCache, SESSION_TTL_SEC,
} from '../lib/auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NONCE = 'nonce-123';

async function makeKey(kid) {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kid, privateKey: kp.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

async function sign(key, claims, header = {}) {
  const h = b64urlEncode(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const p = b64urlEncode(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64urlEncode(sig);
}

const now = Date.now();
const base = () => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1234',
  email: 'kim@example.com',
  email_verified: true,
  name: '김현장',
  nonce: NONCE,
  iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 3600,
});

const good = await makeKey('k1');
const attacker = await makeKey('k1'); // 같은 kid, 다른 키
const fetchImpl = async () => new Response(JSON.stringify({ keys: [good.jwk] }), { status: 200 });
const opts = { clientId: CLIENT_ID, nonce: NONCE, now, fetchImpl };

async function rejects(token, reason, o = opts) {
  _resetJwksCache();
  await assert.rejects(verifyGoogleIdToken(token, o), (e) => e.message === reason);
}

test('정상 토큰은 통과', async () => {
  _resetJwksCache();
  const c = await verifyGoogleIdToken(await sign(good, base()), opts);
  assert.equal(c.email, 'kim@example.com');
});

test('다른 키로 서명한 위조 토큰 거절', async () => {
  await rejects(await sign(attacker, base()), 'bad_signature');
});

test('다른 앱(aud)용 토큰 거절', async () => {
  await rejects(await sign(good, { ...base(), aud: 'other-app' }), 'bad_audience');
});

test('발급자(iss) 위조 거절', async () => {
  await rejects(await sign(good, { ...base(), iss: 'https://evil.example' }), 'bad_issuer');
});

test('만료 토큰 거절', async () => {
  await rejects(await sign(good, { ...base(), exp: Math.floor(now / 1000) - 3600 }), 'expired');
});

test('nonce 불일치(재사용 공격) 거절', async () => {
  await rejects(await sign(good, { ...base(), nonce: 'other' }), 'bad_nonce');
});

test('이메일 미인증 계정 거절', async () => {
  await rejects(await sign(good, { ...base(), email_verified: false }), 'email_not_verified');
});

test('alg=none / HS256 토큰 거절', async () => {
  await rejects(await sign(good, base(), { alg: 'HS256' }), 'bad_alg');
  await rejects('a.b', 'malformed_token');
});

test('허용 목록', () => {
  assert.equal(isAllowed('a@x.com', {}), true);
  assert.equal(isAllowed('a@x.com', { allowedEmails: 'b@x.com' }), false);
  assert.equal(isAllowed('A@X.com', { allowedEmails: 'b@x.com, a@x.com' }), true);
  assert.equal(isAllowed('a@hdc.co.kr', { allowedDomains: 'hdc.co.kr' }), true);
  assert.equal(isAllowed('a@evilhdc.co.kr', { allowedDomains: 'hdc.co.kr' }), false);
  assert.equal(isAllowed('a@gmail.com', { allowedDomains: 'hdc.co.kr' }), false);
});

test('세션 쿠키: 정상·변조·만료·다른 비밀값', async () => {
  const secret = 'x'.repeat(32);
  const v = await signSession({ email: 'kim@example.com' }, secret, now);
  assert.equal((await verifySession(v, secret, now)).email, 'kim@example.com');
  const [body, sig] = v.split('.');
  const forged = b64urlEncode(JSON.stringify({ email: 'boss@example.com', exp: 9999999999 })) + '.' + sig;
  assert.equal(await verifySession(forged, secret, now), null);
  assert.equal(await verifySession(v, 'y'.repeat(32), now), null);
  assert.equal(await verifySession(v, secret, now + (SESSION_TTL_SEC + 10) * 1000), null);
  assert.equal(await verifySession(body, secret, now), null);
  await assert.rejects(signSession({}, 'short'), /session_secret_missing/);
});
