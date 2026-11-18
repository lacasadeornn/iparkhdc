// 외부 판정: 시뮬레이션 결과가 해석적으로 계산한 값과 맞는지 확인
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, triInv, triMean, probToLevel, band, decisionsNeeded, expectedCost } from '../public/sim.js';
import { SEED_RISKS } from '../public/seed.js';

test('삼각분포 역함수: 경계와 최빈값', () => {
  assert.equal(triInv(0, 10, 20, 40), 10);
  assert.ok(Math.abs(triInv(1 - 1e-12, 10, 20, 40) - 40) < 1e-3);
  // F(c) = (c-a)/(b-a) = 1/3 → u=1/3 에서 값은 최빈값 20
  assert.ok(Math.abs(triInv(1 / 3, 10, 20, 40) - 20) < 1e-9);
  assert.equal(triInv(0.5, 5, 5, 5), 5); // 폭 0
});

test('시뮬레이션 평균이 해석적 기대값과 1% 이내 (예시 데이터, 50,000회)', () => {
  const r = simulate(SEED_RISKS, { iterations: 50000 });
  const relC = Math.abs(r.cost.mean - r.cost.expected) / r.cost.expected;
  const relD = Math.abs(r.days.mean - r.days.expected) / r.days.expected;
  assert.ok(relC < 0.01, `원가 상대오차 ${relC}`);
  assert.ok(relD < 0.01, `공기 상대오차 ${relD}`);
  assert.ok(r.cost.p50 <= r.cost.p80 && r.cost.p80 <= r.cost.p90);
  assert.equal(r.riskCount, SEED_RISKS.filter((x) => x.status !== '종결').length);
});

test('확률 100%, 고정값 리스크 → P50=P80=값', () => {
  const r = simulate([{ id: 'X', status: '식별', prob: 100, cMin: 7, cMl: 7, cMax: 7, dMin: 3, dMl: 3, dMax: 3 }], { iterations: 1000 });
  assert.equal(r.cost.p50, 7);
  assert.equal(r.cost.p80, 7);
  assert.equal(r.days.p90, 3);
});

test('단일 리스크 발생확률 30% → P50=0, P80>0, 발생 비율 ≈ 30%', () => {
  const r = simulate([{ id: 'X', status: '식별', prob: 30, cMin: 10, cMl: 20, cMax: 30, dMin: 0, dMl: 0, dMax: 0 }], { iterations: 40000 });
  assert.equal(r.cost.p50, 0);
  assert.ok(r.cost.p80 > 0);
  const hit = r.cost.samples.filter((v) => v > 0).length / 40000;
  assert.ok(Math.abs(hit - 0.3) < 0.01, `발생 비율 ${hit}`);
});

test('종결 리스크는 계산에서 빠짐', () => {
  const r = simulate([{ id: 'X', status: '종결', prob: 100, cMin: 1, cMl: 1, cMax: 1 }], { iterations: 100 });
  assert.equal(r.riskCount, 0);
  assert.equal(r.cost.p90, 0);
});

test('1만 회 × 예시 데이터가 1초 안에 끝남', () => {
  const t0 = performance.now();
  simulate(SEED_RISKS, { iterations: 10000 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms}ms`);
});

test('등급 환산·점수 구간', () => {
  assert.deepEqual([5, 10, 29, 30, 49, 50, 69, 70, 100].map(probToLevel), [1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(band(15), 'high');
  assert.equal(band(14), 'mid');
  assert.equal(band(8), 'mid');
  assert.equal(band(7), 'low');
  assert.equal(expectedCost({ prob: 50, cMin: 0, cMl: 30, cMax: 60 }), 15);
  assert.equal(triMean(0, 30, 60), 30);
});

test('결정 필요 리스크: 발현·고점수 우선, 종결 제외', () => {
  const risks = [
    { id: 'A', status: '식별', prob: 5, rI: 1, strategy: '완화', owner: 'x' },
    { id: 'B', status: '대응중', prob: 80, rI: 5, strategy: '완화', owner: 'x' },
    { id: 'C', status: '발현', prob: 5, rI: 2, strategy: '', owner: '' },
    { id: 'D', status: '종결', prob: 99, rI: 5, strategy: '완화', owner: 'x' },
  ];
  const d = decisionsNeeded(risks, '2026-11-18', 3).map((x) => x.r.id);
  assert.deepEqual(d, ['C', 'B', 'A']);
});
