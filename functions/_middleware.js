// 모든 요청 앞에서 로그인 여부를 확인한다.
import { SESSION_COOKIE, getCookie, verifySession, devBypass } from '../lib/auth.js';
import { json } from '../lib/http.js';

const PUBLIC_PATHS = new Set(['/login.html', '/login', '/login.js', '/style.css', '/favicon.svg', '/auth/login', '/auth/callback', '/auth/logout']);

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path)) return withSecurityHeaders(await next());

  let user = null;
  if (devBypass(request, env)) {
    user = { email: 'dev@localhost', name: '로컬 개발자' };
  } else {
    user = await verifySession(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  }

  if (!user) {
    if (path.startsWith('/api/')) {
      return json({ error: 'unauthenticated' }, 401);
    }
    return Response.redirect(new URL('/login', url).toString(), 302);
  }

  data.user = user;
  return withSecurityHeaders(await next());
}

function withSecurityHeaders(res) {
  const r = new Response(res.body, res);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'same-origin');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'"
  );
  if (!r.headers.has('Cache-Control')) r.headers.set('Cache-Control', 'private, no-store');
  return r;
}
