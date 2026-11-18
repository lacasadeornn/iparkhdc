// Google 로그인 화면으로 보낸다. (OpenID Connect, response_type=id_token, response_mode=form_post)
import { NONCE_COOKIE, randomToken, cookie } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.GOOGLE_CLIENT_ID) {
    return Response.redirect(new URL('/login?error=client_id_missing', url).toString(), 302);
  }
  const nonce = randomToken();
  const state = randomToken();
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', new URL('/auth/callback', url).toString());
  auth.searchParams.set('response_type', 'id_token');
  auth.searchParams.set('response_mode', 'form_post');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('nonce', nonce);
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  if (env.ALLOWED_DOMAINS && !String(env.ALLOWED_DOMAINS).includes(',')) {
    auth.searchParams.set('hd', String(env.ALLOWED_DOMAINS).trim());
  }
  // Google 이 cross-site POST 로 돌아오므로 nonce 쿠키는 SameSite=None 이어야 한다.
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': cookie(NONCE_COOKIE, nonce + '.' + state, { maxAge: 600, sameSite: 'None', path: '/auth' }),
      'Cache-Control': 'no-store',
    },
  });
}
