// 로그인 없이 접근했을 때 막히는지 확인한다.
// 사용법: node scripts/check-gate.mjs https://conrisk.pages.dev
//        (로컬) node scripts/check-gate.mjs http://127.0.0.1:8788 conrisk.test
const base = process.argv[2] || 'https://conrisk.pages.dev';
const hostOverride = process.argv[3];
const cases = [
  ['/', [302], '/login'],
  ['/index.html', [302, 308], null],
  ['/app.js', [302], '/login'],
  ['/sim.js', [302], '/login'],
  ['/api/register', [401], null],
  ['/api/me', [401], null],
  ['/login', [200], null],
  ['/auth/login', [302], 'accounts.google.com'],
];
let fail = 0;
for (const [path, codes, loc] of cases) {
  const headers = hostOverride ? { Host: hostOverride } : {};
  const r = await fetch(base + path, { redirect: 'manual', headers });
  const l = r.headers.get('location') || '';
  const ok = codes.includes(r.status) && (!loc || l.includes(loc));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path} -> ${r.status} ${l.slice(0, 80)}`);
}
// 위조 세션 쿠키도 거절되는지
const forged = await fetch(base + '/api/register', {
  headers: { Cookie: 'cr_session=eyJlbWFpbCI6ImJvc3NAZXhhbXBsZS5jb20iLCJleHAiOjk5OTk5OTk5OTl9.AAAA', ...(hostOverride ? { Host: hostOverride } : {}) },
});
console.log(`${forged.status === 401 ? 'PASS' : 'FAIL'} 위조 쿠키 /api/register -> ${forged.status}`);
if (forged.status !== 401) fail++;
console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
