import {
  CATEGORIES, STATUSES, STRATEGIES, BAND_LABEL,
  band, score, residualLevel, residualScore, inherentScore, isOpen, isOverdue,
  decisionsNeeded, expectedCost, simulate, histogram,
} from './sim.js';
import { SEED_RISKS } from './seed.js';

const LOCAL_KEY = 'conrisk.register.v1';
const state = {
  risks: [],
  version: 0,
  storage: 'local', // 'kv' | 'local'
  user: null,
  sort: { key: 'res', dir: -1 },
  matrixMode: 'residual',
  editingId: null,
  updatedBy: null,
  updatedAt: null,
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- 저장소 ----------
async function load() {
  try {
    const me = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
    if (me) {
      state.user = me.user;
      $('#user-email').textContent = me.user.email;
    }
    const res = await fetch('/api/register');
    if (res.status === 401) return (location.href = '/login');
    if (res.ok) {
      const doc = await res.json();
      state.storage = 'kv';
      state.version = doc.version || 0;
      state.updatedBy = doc.updatedBy;
      state.updatedAt = doc.updatedAt;
      state.risks = Array.isArray(doc.risks) ? doc.risks : structuredClone(SEED_RISKS);
      if (!Array.isArray(doc.risks)) await save(true);
      return;
    }
  } catch (e) {
    console.warn('서버 저장소 사용 불가', e);
  }
  state.storage = 'local';
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    state.risks = raw ? JSON.parse(raw) : structuredClone(SEED_RISKS);
  } catch {
    state.risks = structuredClone(SEED_RISKS);
  }
}

async function save(silent = false) {
  if (state.storage === 'kv') {
    const res = await fetch('/api/register', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: state.version, risks: state.risks }),
    });
    if (res.status === 409) {
      const body = await res.json();
      state.version = body.current.version;
      state.risks = body.current.risks || [];
      state.updatedBy = body.current.updatedBy;
      state.updatedAt = body.current.updatedAt;
      render();
      toast(`다른 사용자(${body.current.updatedBy || '알 수 없음'})가 먼저 수정했습니다. 최신 내용을 불러왔으니 다시 입력해 주세요.`, 'err');
      return false;
    }
    if (!res.ok) {
      toast('저장 실패: ' + res.status, 'err');
      return false;
    }
    const b = await res.json();
    state.version = b.version;
    state.updatedBy = b.updatedBy;
    state.updatedAt = b.updatedAt;
  } else {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.risks));
    } catch {
      toast('이 브라우저에 저장하지 못했습니다.', 'err');
      return false;
    }
  }
  if (!silent) toast('저장했습니다.');
  renderBanner();
  return true;
}

function renderBanner() {
  const b = $('#storage-banner');
  if (state.storage === 'local') {
    b.textContent = '공유 저장소(Cloudflare KV)가 연결되지 않아 이 브라우저에만 저장됩니다. 팀이 함께 쓰려면 README의 "KV 연결" 절차를 따르세요.';
    b.className = 'banner warn';
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

// ---------- 공통 ----------
function badge(sc) {
  const b = band(sc);
  return h('span', { class: 'badge ' + b, title: BAND_LABEL[b] }, sc);
}

function render() {
  renderBanner();
  renderDash();
  renderTable();
  if (!$('#tab-sim').hidden) runSim();
}

// ---------- 대시보드 ----------
function renderDash() {
  const t = today();
  const open = state.risks.filter(isOpen);
  const high = open.filter((r) => band(residualScore(r)) === 'high');
  const overdue = open.filter((r) => isOverdue(r, t));
  const noPlan = open.filter((r) => !r.strategy);
  const ev = open.reduce((a, r) => a + expectedCost(r), 0);
  const k = $('#kpis');
  k.replaceChildren(
    kpi('진행 중 리스크', `${open.length}건`, `전체 ${state.risks.length}건 중 상태 "종결" 제외`),
    kpi('잔존 높음', `${high.length}건`, '진행 중 리스크 중 잔존 점수 15 이상', high.length ? 'bad' : ''),
    kpi('조치 기한 경과', `${overdue.length}건`, `진행 중 리스크 중 기한 < 오늘(${t})`, overdue.length ? 'bad' : ''),
    kpi('대응전략 미정', `${noPlan.length}건`, '진행 중 리스크 중 대응전략 칸이 비어 있음', noPlan.length ? 'warn' : ''),
    kpi('원가 기대값 합계', `${fmt(ev)} 백만원`, 'Σ(발생확률 × 삼각분포 평균), 진행 중 리스크')
  );

  const ol = $('#decisions');
  const d = decisionsNeeded(state.risks, t, 3);
  ol.replaceChildren(
    ...(d.length
      ? d.map(({ r, s: sc, reasons }) =>
          h('li', {},
            h('button', { class: 'link', onclick: () => openEditor(r.id) }, `${r.id} ${r.title}`),
            ' ', badge(sc),
            h('div', { class: 'small muted' }, reasons.length ? reasons.join(' · ') : '잔존 점수 상위'),
            r.actions ? h('div', { class: 'small' }, '조치: ', r.actions) : h('div', { class: 'small warn-text' }, '조치 계획 없음')
          ))
      : [h('li', { class: 'muted' }, '진행 중 리스크가 없습니다.')])
  );

  renderMatrix();

  const byCat = CATEGORIES.map((c) => {
    const rs = open.filter((r) => r.category === c);
    return { c, n: rs.length, high: rs.filter((r) => band(residualScore(r)) === 'high').length, ev: rs.reduce((a, r) => a + expectedCost(r), 0) };
  }).filter((x) => x.n);
  const max = Math.max(1, ...byCat.map((x) => x.ev));
  $('#by-category').replaceChildren(
    h('table', { class: 'mini' },
      h('thead', {}, h('tr', {}, h('th', {}, '분류'), h('th', { class: 'num' }, '진행 중'), h('th', { class: 'num' }, '잔존 높음'), h('th', {}, '원가 기대값(백만원)'))),
      h('tbody', {}, byCat.map((x) => {
        const bar = h('span', { class: 'bar' });
        bar.style.width = (x.ev / max) * 100 + '%';
        return h('tr', {}, h('td', {}, x.c), h('td', { class: 'num' }, x.n), h('td', { class: 'num' }, x.high), h('td', {}, h('div', { class: 'barcell' }, bar, h('span', {}, fmt(x.ev)))));
      }))
    )
  );
}

function kpi(label, value, how, cls = '') {
  return h('div', { class: 'kpi ' + cls }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-how' }, how));
}

function renderMatrix() {
  const mode = state.matrixMode;
  const open = state.risks.filter(isOpen);
  const cells = {};
  for (const r of open) {
    const p = mode === 'residual' ? residualLevel(r) : Number(r.iP);
    const i = mode === 'residual' ? Number(r.rI) : Number(r.iI);
    const k = p + '-' + i;
    (cells[k] = cells[k] || []).push(r);
  }
  const tbl = h('table', { class: 'matrix' });
  const tb = h('tbody');
  for (let p = 5; p >= 1; p--) {
    const tr = h('tr', {}, h('th', { class: 'axis' }, p));
    for (let i = 1; i <= 5; i++) {
      const rs = cells[p + '-' + i] || [];
      const td = h('td', { class: 'cell ' + band(score(p, i)), title: rs.map((r) => `${r.id} ${r.title}`).join('\n') || `확률 ${p} × 영향 ${i} = ${p * i}` }, rs.length ? String(rs.length) : '');
      tr.append(td);
    }
    tb.append(tr);
  }
  tb.append(h('tr', {}, h('th', {}), [1, 2, 3, 4, 5].map((i) => h('th', { class: 'axis' }, i))));
  tbl.append(tb);
  $('#matrix').replaceChildren(
    h('div', { class: 'matrix-wrap' }, h('div', { class: 'ylabel' }, '확률 ↑'), tbl),
    h('div', { class: 'xlabel' }, '영향 →')
  );
}

// ---------- 대장 ----------
function sortVal(r, key) {
  switch (key) {
    case 'inh': return inherentScore(r);
    case 'res': return residualScore(r);
    case 'ev': return expectedCost(r);
    case 'prob': return Number(r.prob) || 0;
    default: return String(r[key] || '');
  }
}

function filtered() {
  const q = $('#q').value.trim().toLowerCase();
  const st = $('#f-status').value;
  const cat = $('#f-cat').value;
  return state.risks.filter((r) =>
    (!st || r.status === st) &&
    (!cat || r.category === cat) &&
    (!q || [r.id, r.title, r.cause, r.effect, r.owner, r.actions].join(' ').toLowerCase().includes(q))
  );
}

function renderTable() {
  const t = today();
  const { key, dir } = state.sort;
  const rows = filtered().sort((a, b) => {
    const x = sortVal(a, key), y = sortVal(b, key);
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  $$('#tbl th').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === key));
  $('#tbl tbody').replaceChildren(
    ...rows.map((r) =>
      h('tr', { class: r.status === '종결' ? 'closed' : '', onclick: () => openEditor(r.id), tabindex: '0', onkeydown: (e) => e.key === 'Enter' && openEditor(r.id) },
        h('td', {}, r.id),
        h('td', {}, r.title),
        h('td', {}, r.category),
        h('td', {}, r.owner || h('span', { class: 'warn-text' }, '미지정')),
        h('td', {}, h('span', { class: 'status s-' + STATUSES.indexOf(r.status) }, r.status)),
        h('td', { class: 'num' }, badge(inherentScore(r))),
        h('td', { class: 'num' }, badge(residualScore(r))),
        h('td', { class: 'num' }, fmt(r.prob)),
        h('td', { class: 'num' }, fmt(expectedCost(r), 1)),
        h('td', { class: isOverdue(r, t) ? 'warn-text' : '' }, r.due || '-', isOverdue(r, t) ? ' (경과)' : '')
      )
    )
  );
  const meta = state.storage === 'kv' && state.updatedAt
    ? ` · 마지막 저장 ${new Date(state.updatedAt).toLocaleString('ko-KR')} (${state.updatedBy})`
    : '';
  $('#tbl-count').textContent = `표시 ${rows.length}건 / 전체 ${state.risks.length}건${meta}`;
}

function nextId() {
  const n = state.risks.reduce((m, r) => Math.max(m, parseInt(String(r.id).replace(/\D/g, ''), 10) || 0), 0) + 1;
  return 'R-' + String(n).padStart(3, '0');
}

function fillSelect(sel, opts) {
  for (const o of opts) sel.append(h('option', { value: o }, o));
}

function openEditor(id) {
  const f = $('#frm');
  f.reset();
  $('#frm-err').hidden = true;
  state.editingId = id || null;
  const r = id ? state.risks.find((x) => x.id === id) : { category: '공정', status: '식별', iP: 3, iI: 3, prob: 30, rI: 3, cMin: 0, cMl: 0, cMax: 0, dMin: 0, dMl: 0, dMax: 0 };
  $('#dlg-title').textContent = id ? `${id} 수정` : '새 리스크 등록';
  for (const el of f.elements) if (el.name && r[el.name] != null) el.value = r[el.name];
  $('#btn-del').hidden = !id;
  $('#frm-meta').textContent = r.updatedBy ? `최근 수정: ${r.updatedBy} · ${new Date(r.updatedAt).toLocaleString('ko-KR')}` : '';
  $('#dlg').showModal();
}

function readForm() {
  const f = $('#frm');
  const o = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value.trim();
  }
  const err = [];
  if (!o.title) err.push('리스크명을 입력하세요.');
  for (const k of ['iP', 'iI', 'rI']) if (!(o[k] >= 1 && o[k] <= 5)) err.push('등급은 1~5 사이여야 합니다.');
  if (!(o.prob >= 0 && o.prob <= 100)) err.push('발생확률은 0~100% 입니다.');
  if (!(o.cMin <= o.cMl && o.cMl <= o.cMax)) err.push('원가는 최소 ≤ 최빈 ≤ 최대 여야 합니다.');
  if (!(o.dMin <= o.dMl && o.dMl <= o.dMax)) err.push('공기는 최소 ≤ 최빈 ≤ 최대 여야 합니다.');
  return { o, err: [...new Set(err)] };
}

async function onSubmit(e) {
  e.preventDefault();
  const { o, err } = readForm();
  if (err.length) {
    $('#frm-err').textContent = err.join(' ');
    $('#frm-err').hidden = false;
    return;
  }
  const stamp = { updatedAt: new Date().toISOString(), updatedBy: state.user ? state.user.email : '로컬' };
  const before = structuredClone(state.risks);
  if (state.editingId) {
    const i = state.risks.findIndex((x) => x.id === state.editingId);
    state.risks[i] = { ...state.risks[i], ...o, ...stamp };
  } else {
    state.risks.push({ id: nextId(), ...o, ...stamp });
  }
  if (await save()) {
    $('#dlg').close();
  } else if (state.storage === 'local') {
    state.risks = before;
  }
  render();
}

async function onDelete() {
  if (!state.editingId) return;
  if (!confirm(`${state.editingId} 를 삭제할까요? (보통은 상태를 "종결"로 바꾸는 것을 권합니다)`)) return;
  state.risks = state.risks.filter((x) => x.id !== state.editingId);
  await save();
  $('#dlg').close();
  render();
}

function exportCsv() {
  const cols = ['id', 'title', 'category', 'status', 'owner', 'cause', 'effect', 'iP', 'iI', 'strategy', 'actions', 'due', 'prob', 'rI', 'cMin', 'cMl', 'cMax', 'dMin', 'dMl', 'dMax', 'updatedBy', 'updatedAt'];
  const head = ['ID', '리스크', '분류', '상태', '담당', '원인', '영향', '고유확률', '고유영향', '대응전략', '대응조치', '조치기한', '잔존발생확률%', '잔존영향', '원가최소', '원가최빈', '원가최대', '공기최소', '공기최빈', '공기최대', '수정자', '수정일시'];
  // 수식 주입 방지: = + - @ 로 시작하면 앞에 ' 를 붙인다
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const lines = [head.map(cell).join(','), ...state.risks.map((r) => cols.map((c) => cell(r[c])).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `conrisk_${today()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- 예비비 ----------
function runSim() {
  const iterations = Number($('#iters').value);
  const t0 = performance.now();
  const res = simulate(state.risks, { iterations });
  const ms = performance.now() - t0;
  $('#sim-meta').textContent = `대상 ${res.riskCount}건(종결 제외, 확률 0% 제외) · ${fmt(iterations)}회 · ${fmt(ms)}ms · 난수 시드 고정(같은 입력이면 같은 결과)`;
  $('#sim-kpis').replaceChildren(
    kpi('원가 P50', `${fmt(res.cost.p50)} 백만원`, '반복 결과의 중앙값'),
    kpi('원가 P80 (권장 예비비)', `${fmt(res.cost.p80)} 백만원`, '80% 확률로 이 금액 이내', 'accent'),
    kpi('원가 평균 / 기대값', `${fmt(res.cost.mean)} / ${fmt(res.cost.expected)}`, '시뮬레이션 평균 / 해석적 기대값 (근접해야 정상)'),
    kpi('공기 P50', `${fmt(res.days.p50)} 일`, '반복 결과의 중앙값'),
    kpi('공기 P80 (권장 여유)', `${fmt(res.days.p80)} 일`, '80% 확률로 이 일수 이내', 'accent'),
    kpi('공기 평균 / 기대값', `${fmt(res.days.mean, 1)} / ${fmt(res.days.expected, 1)}`, '주공정 합산 가정')
  );
  drawHist($('#hist-cost'), res.cost, '백만원');
  drawHist($('#hist-days'), res.days, '일');
  drawTornado(res.contrib);
}

function drawHist(el, dist, unit) {
  const bins = histogram(dist.samples, 30);
  const W = 520, H = 220, L = 40, B = 34, T = 10, R = 10;
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const lo = bins.length ? bins[0].x0 : 0, hi = bins.length ? bins[bins.length - 1].x1 : 1;
  const x = (v) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R);
  const y = (n) => H - B - (n / maxN) * (H - B - T);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hist', role: 'img', 'aria-label': `분포 히스토그램 (${unit})` });
  svg.append(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis-line' }));
  for (const b of bins) {
    svg.append(s('rect', { x: x(b.x0) + 0.5, y: y(b.n), width: Math.max(0, x(b.x1) - x(b.x0) - 1), height: H - B - y(b.n), class: 'hbar' }, s('title', {}, `${fmt(b.x0)}~${fmt(b.x1)} ${unit}: ${b.n}회`)));
  }
  for (const [label, v, cls] of [['P50', dist.p50, 'p50'], ['P80', dist.p80, 'p80'], ['P90', dist.p90, 'p90']]) {
    svg.append(s('line', { x1: x(v), x2: x(v), y1: T, y2: H - B, class: 'pline ' + cls }));
    svg.append(s('text', { x: x(v) + 3, y: T + 10 + (cls === 'p80' ? 14 : cls === 'p90' ? 28 : 0), class: 'plabel ' + cls }, `${label} ${fmt(v)}`));
  }
  svg.append(s('text', { x: L, y: H - 12, class: 'tick' }, fmt(lo)));
  svg.append(s('text', { x: W - R, y: H - 12, class: 'tick end' }, fmt(hi) + ' ' + unit));
  svg.append(s('text', { x: L - 6, y: T + 8, class: 'tick end' }, maxN));
  svg.append(s('text', { x: L - 6, y: H - B, class: 'tick end' }, '0'));
  el.replaceChildren(svg);
}

function drawTornado(contrib) {
  const max = Math.max(1, ...contrib.map((c) => c.cost));
  $('#tornado').replaceChildren(
    h('table', { class: 'mini' },
      h('thead', {}, h('tr', {}, h('th', {}, '리스크'), h('th', {}, '원가 기대값(백만원)'), h('th', { class: 'num' }, '공기 기대값(일)'))),
      h('tbody', {}, contrib.map((c) => {
        const bar = h('span', { class: 'bar' });
        bar.style.width = (c.cost / max) * 100 + '%';
        return h('tr', {}, h('td', {}, `${c.id} ${c.title}`), h('td', {}, h('div', { class: 'barcell' }, bar, h('span', {}, fmt(c.cost, 1)))), h('td', { class: 'num' }, fmt(c.days, 1)));
      }))
    )
  );
}

// ---------- 초기화 ----------
function bind() {
  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'sim') runSim();
    })
  );
  $$('#matrix-mode button').forEach((b) =>
    b.addEventListener('click', () => {
      state.matrixMode = b.dataset.mode;
      $$('#matrix-mode button').forEach((x) => x.classList.toggle('active', x === b));
      renderMatrix();
    })
  );
  fillSelect($('#f-status'), STATUSES);
  fillSelect($('#f-cat'), CATEGORIES);
  fillSelect($('#frm [name=category]'), CATEGORIES);
  fillSelect($('#frm [name=status]'), STATUSES);
  fillSelect($('#frm [name=strategy]'), STRATEGIES);
  ['#q', '#f-status', '#f-cat'].forEach((sel) => $(sel).addEventListener('input', renderTable));
  $$('#tbl th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
      renderTable();
    })
  );
  $('#btn-new').addEventListener('click', () => openEditor(null));
  $('#btn-export').addEventListener('click', exportCsv);
  $('#frm').addEventListener('submit', onSubmit);
  $('#btn-cancel').addEventListener('click', () => $('#dlg').close());
  $('#btn-del').addEventListener('click', onDelete);
  $('#btn-sim').addEventListener('click', runSim);
  $('#iters').addEventListener('change', runSim);
}

bind();
await load();
render();
