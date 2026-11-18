// 리스크 대장 저장소 (Cloudflare KV, 바인딩 이름 CONRISK_KV)
// 동시 수정 충돌은 version 으로 막는다. (낙관적 잠금)
import { json } from '../../lib/http.js';

const KEY = 'register:v1';
const MAX_BYTES = 1_000_000;

export async function onRequestGet({ env }) {
  if (!env.CONRISK_KV) return json({ error: 'storage_unbound' }, 503);
  const doc = await env.CONRISK_KV.get(KEY, 'json');
  return json(doc || { version: 0, risks: null });
}

export async function onRequestPut({ request, env, data }) {
  if (!env.CONRISK_KV) return json({ error: 'storage_unbound' }, 503);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: 'too_large' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!Array.isArray(body.risks)) return json({ error: 'bad_shape' }, 400);
  const current = (await env.CONRISK_KV.get(KEY, 'json')) || { version: 0 };
  if (Number(body.baseVersion) !== Number(current.version)) {
    return json({ error: 'conflict', current }, 409);
  }
  const doc = {
    version: Number(current.version) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: data.user.email,
    risks: body.risks,
  };
  await env.CONRISK_KV.put(KEY, JSON.stringify(doc));
  return json({ version: doc.version, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
}
