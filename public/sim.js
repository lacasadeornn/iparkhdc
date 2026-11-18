// conrisk 계산 모듈 (브라우저와 Node 테스트가 함께 사용)
// - 5x5 확률·영향 점수, 등급
// - 확률(%) + 3점 추정(최소·최빈·최대) 기반 몬테카를로 예비비 산정

export const CATEGORIES = ['안전', '공정', '원가', '품질', '환경', '인허가·법규', '계약·협력사', '설계'];
export const STATUSES = ['식별', '대응중', '발현', '종결'];
export const STRATEGIES = ['회피', '전가', '완화', '수용'];

/** 확률 등급(1~5)을 대표 발생확률(%)로 */
export const LEVEL_TO_PROB = { 1: 5, 2: 20, 3: 40, 4: 60, 5: 85 };

/** 발생확률(%) → 확률 등급(1~5). 경계: <10, <30, <50, <70, 그 이상 */
export function probToLevel(pct) {
  const p = Number(pct) || 0;
  if (p < 10) return 1;
  if (p < 30) return 2;
  if (p < 50) return 3;
  if (p < 70) return 4;
  return 5;
}

export function score(p, i) {
  return (Number(p) || 0) * (Number(i) || 0);
}

/** 점수 등급: 15 이상 높음, 8~14 중간, 7 이하 낮음 */
export function band(s) {
  if (s >= 15) return 'high';
  if (s >= 8) return 'mid';
  return 'low';
}
export const BAND_LABEL = { high: '높음', mid: '중간', low: '낮음' };

export function residualLevel(r) {
  return probToLevel(r.prob);
}
export function residualScore(r) {
  return score(residualLevel(r), r.rI);
}
export function inherentScore(r) {
  return score(r.iP, r.iI);
}

export function isOpen(r) {
  return r.status !== '종결';
}

/** 오늘(YYYY-MM-DD) 기준 기한 초과 여부 */
export function isOverdue(r, today) {
  return isOpen(r) && !!r.due && r.due < today;
}

/**
 * 이번 주 결정할 리스크 상위 n건.
 * 대상: 종결 아닌 리스크. 순위: 잔존점수 → 기한초과 → 대응전략 없음 → 원가 기대값.
 */
export function decisionsNeeded(risks, today, n = 3) {
  const rows = risks.filter(isOpen).map((r) => {
    const reasons = [];
    const s = residualScore(r);
    if (band(s) === 'high') reasons.push(`잔존 점수 ${s}(높음)`);
    if (isOverdue(r, today)) reasons.push(`조치 기한 ${r.due} 경과`);
    if (!r.strategy) reasons.push('대응 전략 미정');
    if (!r.owner) reasons.push('담당자 미지정');
    if (r.status === '발현') reasons.push('이미 발현됨');
    const ev = expectedCost(r);
    return { r, s, ev, reasons, overdue: isOverdue(r, today) };
  });
  rows.sort(
    (a, b) =>
      (b.r.status === '발현') - (a.r.status === '발현') ||
      b.s - a.s ||
      b.overdue - a.overdue ||
      !b.r.strategy - !a.r.strategy ||
      b.ev - a.ev
  );
  return rows.slice(0, n);
}

// ---------- 확률분포 ----------

export function triMean(min, mode, max) {
  return (Number(min) + Number(mode) + Number(max)) / 3;
}

/** 삼각분포 역함수 샘플링. u ∈ [0,1) */
export function triInv(u, a, c, b) {
  a = Number(a); c = Number(c); b = Number(b);
  if (!(b > a)) return a;
  if (c < a) c = a;
  if (c > b) c = b;
  const fc = (c - a) / (b - a);
  if (u < fc) return a + Math.sqrt(u * (b - a) * (c - a));
  return b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** 재현 가능한 난수 (mulberry32) */
export function rng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pr(r) {
  const p = (Number(r.prob) || 0) / 100;
  return Math.min(1, Math.max(0, p));
}

/** 리스크 1건의 원가 기대값 = 발생확률 × 삼각분포 평균 */
export function expectedCost(r) {
  return pr(r) * triMean(r.cMin || 0, r.cMl || 0, r.cMax || 0);
}
export function expectedDays(r) {
  return pr(r) * triMean(r.dMin || 0, r.dMl || 0, r.dMax || 0);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/**
 * 몬테카를로 예비비 산정.
 * 가정: 리스크 간 독립, 공기 영향은 모두 주공정(critical path)에 더해짐(보수적).
 * @returns {{iterations, cost:{mean,p50,p80,p90,expected,samples}, days:{...}, contrib:[]}}
 */
export function simulate(risks, { iterations = 10000, seed = 20261118 } = {}) {
  const open = risks.filter(isOpen).filter((r) => pr(r) > 0);
  const rand = rng(seed);
  const cost = new Float64Array(iterations);
  const days = new Float64Array(iterations);
  for (let k = 0; k < iterations; k++) {
    let c = 0, d = 0;
    for (let j = 0; j < open.length; j++) {
      const r = open[j];
      if (rand() < pr(r)) {
        c += triInv(rand(), r.cMin || 0, r.cMl || 0, r.cMax || 0);
        d += triInv(rand(), r.dMin || 0, r.dMl || 0, r.dMax || 0);
      }
    }
    cost[k] = c;
    days[k] = d;
  }
  const summarize = (arr, expected) => {
    const sorted = Array.from(arr).sort((x, y) => x - y);
    let sum = 0;
    for (const v of sorted) sum += v;
    return {
      mean: sum / (sorted.length || 1),
      p50: quantile(sorted, 0.5),
      p80: quantile(sorted, 0.8),
      p90: quantile(sorted, 0.9),
      expected,
      samples: sorted,
    };
  };
  const expC = open.reduce((s, r) => s + expectedCost(r), 0);
  const expD = open.reduce((s, r) => s + expectedDays(r), 0);
  const contrib = open
    .map((r) => ({ id: r.id, title: r.title, cost: expectedCost(r), days: expectedDays(r) }))
    .sort((a, b) => b.cost - a.cost);
  return {
    iterations,
    riskCount: open.length,
    cost: summarize(cost, expC),
    days: summarize(days, expD),
    contrib,
  };
}

/** 히스토그램 (bins개 구간) */
export function histogram(sorted, bins = 30) {
  if (!sorted.length) return [];
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, n: 0 }));
  for (const v of sorted) {
    const i = Math.min(bins - 1, Math.floor((v - lo) / w));
    out[i].n++;
  }
  return out;
}
