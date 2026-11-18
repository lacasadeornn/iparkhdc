// Google 이 id_token 을 form_post 로 보내 주는 곳.
import {
  NONCE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  getCookie,
  cookie,
  verifyGoogleIdToken,
  isAllowed,
  signSession,
} from '../../lib/auth.js';

function fail(url, reason) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/login?error=' + encodeURIComponent(reason), url).toString(),
      'Set-Cookie': cookie(NONCE_COOKIE, '', { maxAge: 0, sameSite: 'None', path: '/auth' }),
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const form = await request.formData();
  if (form.get('error')) return fail(url, 'google_' + String(form.get('error')).slice(0, 40));
  const saved = getCookie(request, NONCE_COOKIE) || '';
  const [nonce, state] = saved.split('.');
  if (!nonce || !state || form.get('state') !== state) return fail(url, 'bad_state');
  if (!env.SESSION_SECRET) return fail(url, 'session_secret_missing');

  let claims;
  try {
    claims = await verifyGoogleIdToken(String(form.get('id_token') || ''), {
      clientId: env.GOOGLE_CLIENT_ID,
      nonce,
    });
  } catch (e) {
    return fail(url, e.message);
  }
  if (!isAllowed(claims.email, { allowedEmails: env.ALLOWED_EMAILS, allowedDomains: env.ALLOWED_DOMAINS })) {
    return fail(url, 'not_allowed');
  }
  const session = await signSession({ email: claims.email, name: claims.name || claims.email }, env.SESSION_SECRET);
  const headers = new Headers({ Location: new URL('/', url).toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL_SEC }));
  headers.append('Set-Cookie', cookie(NONCE_COOKIE, '', { maxAge: 0, sameSite: 'None', path: '/auth' }));
  return new Response(null, { status: 303, headers });
}

export function onRequestGet({ request }) {
  return Response.redirect(new URL('/login', request.url).toString(), 302);
}
