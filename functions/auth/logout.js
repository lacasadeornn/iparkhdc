import { SESSION_COOKIE, cookie } from '../../lib/auth.js';

export function onRequest({ request }) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/login?bye=1', request.url).toString(),
      'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }),
      'Cache-Control': 'no-store',
    },
  });
}
