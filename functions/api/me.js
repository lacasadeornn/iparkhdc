import { json } from '../../lib/http.js';

export function onRequestGet({ data, env }) {
  return json({
    user: data.user,
    storage: env.CONRISK_KV ? 'kv' : 'none',
  });
}
