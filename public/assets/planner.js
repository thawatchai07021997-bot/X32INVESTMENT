/* ============================================================
   X32 — หน้าวางแผนการลงทุน

   คณิตศาสตร์ทั้งหมดทำในเบราว์เซอร์ ไม่เรียกเซิร์ฟเวอร์ระหว่างคำนวณ
   เพราะต้องให้คำตอบเดิมทุกครั้ง ตรวจย้อนได้ ปรับตัวเลขแล้วเห็นผลทันที
   และไม่มีค่าใช้จ่ายต่อครั้ง

   จุดเดียวที่เรียกเซิร์ฟเวอร์คือปุ่ม "ให้ AI สรุปแผนนี้" ซึ่งส่งเฉพาะ
   ตัวเลขที่คำนวณเสร็จแล้วไปให้เรียบเรียง — AI ไม่ได้คำนวณอะไรเลย
   ============================================================ */

import { api, showError } from './api.js';
import { el, replace } from './dom.js';
import {
  DEFAULT_ASSUMPTIONS, MONTH_TH, concentration, dividendCalendar, dividendPortfolio,
  matchesFocus, portfolioStats, screenDividendAssets, simulate, solveMonthly,
  toTodayValue,
} from './finance.js';
import { marketBadge, thaiDateTime } from './format.js';

/**
 * format.js คืนค่าเป็น DOM node เสมอ (เพื่อใส่สีเขียว/แดงตามทิศทาง)
 * แต่หน้านี้ต้องประกอบตัวเลขเข้าไปในประโยค จึงต้องมีรุ่นที่คืนข้อความล้วน
 */
const pctText = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const numText = (value, digits = 2) => value.toLocaleString('th-TH', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const baht = (v) => `${Math.round(v).toLocaleString('th-TH')} บาท`;

/**
 * นิยามระดับความเสี่ยง — แปลจาก "ยอมให้เงินต้นติดลบได้แค่ไหน" เป็นเกณฑ์คัดหุ้น
 *
 * ความเสี่ยงต่ำไม่ได้แปลว่าเลือกหุ้นที่ดีกว่า แต่แปลว่าถือหลายตัวขึ้นและเลี่ยงตัวที่
 * แกว่งแรงตามตลาด (beta สูง) ผลที่ตามมาคือช่วงผลลัพธ์แคบลงทั้งด้านบนและด้านล่าง
 */
const RISK_PROFILES = {
  low: { label: 'ต่ำ', count: 10, maxBeta: 1.15, sortBy: 'stability' },
  mid: { label: 'กลาง', count: 8, maxBeta: 1.6, sortBy: 'score' },
  high: { label: 'สูง', count: 5, maxBeta: Infinity, sortBy: 'growth' },
};

const FOCUS_LABELS = { all: 'ไทย + ต่างประเทศ', th: 'เฉพาะหุ้นไทย', foreign: 'เฉพาะต่างประเทศ' };

/* ค่าตั้งต้นของทุกช่อง — ใช้ทั้งตอนกด "ล้างค่าทั้งหมด" และตอนเปิดหน้าครั้งแรก
   เก็บไว้ที่เดียวเพื่อไม่ให้ค่าใน HTML กับปุ่มล้างค่าเลื่อนจากกันเมื่อแก้ทีหลัง */
const DEFAULTS = {
  'pick-mode': 'guide', focus: 'all', risk: 'mid', 'calc-mode': 'forward',
  lump: '100000', monthly: '5000', goal: '5000000', years: '10', runs: '5000',
  'a-th': '8', 'a-us': '10', 'a-gold': '6', 'a-inf': '2',
  target: '30000', count: '6', 'min-yield': '3', 'income-focus': 'all', tax: '1',
};

const SIM_FIELDS = ['pick-mode', 'focus', 'risk', 'calc-mode', 'lump', 'monthly',
  'goal', 'years', 'runs', 'a-th', 'a-us', 'a-gold', 'a-inf'];
const INCOME_FIELDS = ['target', 'count', 'min-yield', 'income-focus', 'tax'];

const STORE_PLANS = 'x32.planner.plans';
const STORE_LAST = 'x32.planner.last';

let dashboard = null;
let selected = [];
let selectedGroups = new Set();
// ผลการคำนวณล่าสุด — เก็บไว้ให้ปุ่ม "ให้ AI สรุป" ส่งต่อโดยไม่ต้องคำนวณซ้ำ
let lastSim = null;
let lastIncome = null;

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;

/* ── ความจำของฟอร์ม ─────────────────────────────────────── */

/** อ่านค่าทุกช่องเป็น object เดียว — ใช้ทั้งการจำค่าล่าสุดและการบันทึกแผน */
function readForm() {
  const state = {};
  for (const id of [...SIM_FIELDS, ...INCOME_FIELDS]) state[id] = val(id);
  return {
    fields: state,
    manual: selected.map((a) => a.symbol),
    groups: [...selectedGroups],
    tab: $('panel-sim').hidden ? 'income' : 'sim',
  };
}

function applyForm(plan) {
  for (const [id, value] of Object.entries(plan.fields || {})) {
    const node = $(id);
    if (node) node.value = value;
  }
  selectedGroups = new Set(plan.groups || []);
  const bySymbol = new Map((dashboard.all_assets || []).map((a) => [a.symbol, a]));
  selected = (plan.manual || []).map((s) => bySymbol.get(s)).filter(Boolean);
  switchTab(plan.tab === 'income' ? 'income' : 'sim');
  syncPickMode();
  syncCalcMode();
  renderSelected();
}

/** localStorage อาจถูกปิดไว้หรือเต็ม — ทุกการเรียกต้องล้มแล้วไปต่อได้ */
function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // เต็มหรือถูกปิด — ไม่ใช่เรื่องคอขาดบาดตาย ปล่อยให้ใช้งานต่อได้โดยไม่จำค่า
  }
}

const rememberForm = () => writeStore(STORE_LAST, readForm());

/* ── แผนที่บันทึกไว้ ────────────────────────────────────── */

function renderPlanList() {
  const plans = readStore(STORE_PLANS, []);
  const box = $('saved-plans');
  replace(box, plans.length
    ? plans.map((p) => el('option', {
      text: `${p.name} · ${thaiDateTime(p.savedAt, { dateStyle: 'short', timeStyle: 'short' })}`,
      attrs: { value: p.id },
    }))
    : el('option', { text: 'ยังไม่มีแผนที่บันทึกไว้', attrs: { value: '' } }));
  const hasPlans = plans.length > 0;
  $('load-plan').disabled = !hasPlans;
  $('delete-plan').disabled = !hasPlans;
}

function savePlan() {
  const plans = readStore(STORE_PLANS, []);
  const suggestion = $('panel-sim').hidden
    ? `พอร์ตปันผล ${Number(val('target')).toLocaleString('th-TH')}/เดือน`
    : `จำลอง ${val('years')} ปี · ${FOCUS_LABELS[val('focus')]}`;
  const name = (prompt('ตั้งชื่อแผนนี้', suggestion) || '').trim();
  if (!name) return;

  plans.unshift({ id: String(Date.now()), name, savedAt: new Date().toISOString(), ...readForm() });
  // เก็บ 20 แผนล่าสุดพอ — เกินกว่านี้รายการยาวจนหาไม่เจอและกิน localStorage ฟรีๆ
  writeStore(STORE_PLANS, plans.slice(0, 20));
  renderPlanList();
  flash(`บันทึกแผน "${name}" แล้ว`);
}

function loadPlan() {
  const id = val('saved-plans');
  const plan = readStore(STORE_PLANS, []).find((p) => p.id === id);
  if (!plan) return;
  applyForm(plan);
  hideResults();
  flash(`เปิดแผน "${plan.name}" แล้ว — กดคำนวณเพื่อดูผลด้วยข้อมูลล่าสุด`);
}

function deletePlan() {
  const id = val('saved-plans');
  const plans = readStore(STORE_PLANS, []);
  const plan = plans.find((p) => p.id === id);
  if (!plan || !confirm(`ลบแผน "${plan.name}" ?`)) return;
  writeStore(STORE_PLANS, plans.filter((p) => p.id !== id));
  renderPlanList();
}

/* ── ข้อความแจ้งเตือนชั่วคราว ───────────────────────────── */

let flashTimer = null;
function flash(message) {
  const box = $('notice');
  box.hidden = false;
  box.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { box.hidden = true; }, 6000);
}

/* ── เลือกสินทรัพย์ ─────────────────────────────────────── */

/** ระยะเวลาถือครองกำหนดว่าจะใช้อันดับของระยะไหนใน Dashboard */
function horizonForYears(years) {
  if (years <= 1) return 'short';
  if (years <= 3) return 'mid';
  return 'long';
}

const scoreOf = (asset, horizon) => asset.horizon_scores?.[horizon]?.score || 0;
const betaOf = (a) => (Number.isFinite(a.beta) ? a.beta : 1);
const volOf = (a) => (Number.isFinite(a.volatility) ? a.volatility : 0.3);

/** เรียงตามระดับความเสี่ยงที่ผู้ใช้รับได้ */
function sorterFor(profile, horizon) {
  return {
    // เสี่ยงต่ำ: เอาตัวที่แกว่งน้อยก่อน แต่ยังต้องมีคะแนนพอใช้
    stability: (a, b) => (volOf(a) - volOf(b)) || (scoreOf(b, horizon) - scoreOf(a, horizon)),
    score: (a, b) => scoreOf(b, horizon) - scoreOf(a, horizon),
    // เสี่ยงสูง: เอาคะแนนสูงและยอมรับตัวที่แกว่งแรง
    growth: (a, b) => (scoreOf(b, horizon) + betaOf(b) * 10) - (scoreOf(a, horizon) + betaOf(a) * 10),
  }[profile.sortBy];
}

function eligibleAssets(pool, profile, risk, focus) {
  return pool.filter((a) => {
    if (!matchesFocus(a, focus)) return false;
    if (a.data_quality !== 'full' && risk !== 'high') return false;
    return betaOf(a) <= profile.maxBeta;
  });
}

/**
 * จัดพอร์ตให้อัตโนมัติจากอันดับต้นของระยะที่ตรงกับเวลาที่ผู้ใช้ตั้งใจถือ
 * แล้วกรองตามระดับความเสี่ยงและตลาดที่สนใจ
 */
function pickGuided(risk, years, focus) {
  const profile = RISK_PROFILES[risk];
  const horizon = horizonForYears(years);
  const ranked = dashboard.horizons[horizon]?.items || [];

  // เริ่มจากอันดับต้นของระยะนั้น ถ้าไม่พอให้ดึงจากทั้ง universe มาเสริม
  const seen = new Set(ranked.map((a) => a.symbol));
  const pool = [...ranked, ...dashboard.all_assets
    .filter((a) => !seen.has(a.symbol))
    .sort((a, b) => scoreOf(b, horizon) - scoreOf(a, horizon))];

  return eligibleAssets(pool, profile, risk, focus)
    .sort(sorterFor(profile, horizon))
    .slice(0, profile.count);
}

/**
 * จัดพอร์ตจากกลุ่มที่ผู้ใช้เลือก (อุตสาหกรรมหรือธีม)
 *
 * **หยิบแบบสลับกลุ่มไปเรื่อยๆ ไม่ใช่รวมทุกกลุ่มแล้วเรียงคะแนน** เพราะถ้าเรียงรวม
 * กลุ่มที่คะแนนดีทั้งกลุ่มจะกินโควตาจนหมด แล้วกลุ่มอื่นที่ผู้ใช้ตั้งใจเลือกจะไม่โผล่เลย
 * สักตัว ซึ่งขัดกับเจตนาของการกดเลือกหลายกลุ่ม
 */
function pickFromGroups(risk, years, focus) {
  const profile = RISK_PROFILES[risk];
  const horizon = horizonForYears(years);
  const bySymbol = new Map(dashboard.all_assets.map((a) => [a.symbol, a]));

  const queues = [...selectedGroups]
    .map((id) => (dashboard.groups || []).find((g) => g.id === id))
    .filter(Boolean)
    .map((group) => eligibleAssets(
      group.members.map((s) => bySymbol.get(s)).filter(Boolean),
      profile, risk, focus,
    ).sort(sorterFor(profile, horizon)));

  const picked = [];
  const taken = new Set();
  for (let round = 0; picked.length < profile.count; round += 1) {
    const before = picked.length;
    for (const queue of queues) {
      if (picked.length >= profile.count) break;
      const asset = queue[round];
      if (!asset || taken.has(asset.symbol)) continue;
      taken.add(asset.symbol);
      picked.push(asset);
    }
    if (picked.length === before) break;   // ทุกกลุ่มหมดของแล้ว
  }
  return picked;
}

function renderSelected() {
  const box = $('selected');
  if (!selected.length) {
    replace(box, el('span', { class: 'muted small', text: 'ยังไม่ได้เลือกสินทรัพย์' }));
    return;
  }
  replace(box, selected.map((a) => el('span', { class: 'chip' },
    `${a.symbol} · ${a.market}`,
    el('button', {
      class: 'chip-x', text: '×', attrs: { type: 'button', 'aria-label': `เอา ${a.symbol} ออก` },
      on: {
        click: () => {
          selected = selected.filter((x) => x.symbol !== a.symbol);
          renderSelected();
          rememberForm();
        },
      },
    }))));
}

function renderPicker(keyword = '') {
  const box = $('asset-picker');
  const q = keyword.trim().toLowerCase();
  const focus = val('focus');
  const list = dashboard.all_assets
    .filter((a) => matchesFocus(a, focus))
    .filter((a) => !q || a.symbol.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
    .slice(0, 60);

  if (!list.length) {
    replace(box, el('p', { class: 'muted small', text: 'ไม่พบสินทรัพย์ที่ตรงกับคำค้นและตลาดที่เลือก' }));
    return;
  }

  replace(box, list.map((a) => {
    const picked = selected.some((s) => s.symbol === a.symbol);
    return el('button', {
      class: `pick ${picked ? 'pick-on' : ''}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (picked) selected = selected.filter((s) => s.symbol !== a.symbol);
          else if (selected.length < 20) selected.push(a);
          renderSelected();
          renderPicker(val('search'));
          rememberForm();
        },
      },
    }, el('strong', { text: a.symbol }), ` ${a.name || ''}`);
  }));
}

/** จำนวนสมาชิกของกลุ่มที่เหลือหลังกรองด้วยตลาดที่ผู้ใช้เลือก */
function groupSize(group, focus) {
  const bySymbol = new Map(dashboard.all_assets.map((a) => [a.symbol, a]));
  return group.members
    .map((s) => bySymbol.get(s))
    .filter((a) => a && matchesFocus(a, focus)).length;
}

function renderGroupChips() {
  const mode = val('pick-mode');
  const box = $('group-box');
  box.hidden = mode !== 'sector' && mode !== 'theme';
  if (box.hidden) return;

  const focus = val('focus');
  const groups = (dashboard.groups || [])
    .filter((g) => g.kind === (mode === 'sector' ? 'sector' : 'theme'))
    .map((g) => ({ ...g, size: groupSize(g, focus) }))
    .filter((g) => g.size > 0);

  $('group-label').textContent = mode === 'sector'
    ? 'เลือกอุตสาหกรรมที่สนใจ (กดได้หลายกลุ่ม)'
    : 'เลือกธีมที่สนใจ (กดได้หลายกลุ่ม)';
  $('group-help').textContent = mode === 'sector'
    ? 'อุตสาหกรรมมาจากการจัดประเภทมาตรฐานของข้อมูลต้นทาง · '
      + 'กลุ่มที่มีสมาชิกน้อยกว่า 3 ตัวไม่ถูกแสดง เพราะอันดับภายในกลุ่มจะไม่มีความหมาย'
    : 'ธีมเป็นรายชื่อที่ระบบจัดกลุ่มเอง ไม่ใช่การจัดประเภทมาตรฐาน — '
      + 'กดค้างที่ชื่อกลุ่มเพื่อดูเหตุผลที่จัดเข้ากลุ่มนี้ · อ่านฉบับเต็มได้ที่หน้าอุตสาหกรรม';

  if (!groups.length) {
    replace($('group-chips'), el('p', {
      class: 'muted small',
      text: 'ไม่มีกลุ่มที่มีสมาชิกในตลาดที่เลือก ลองเปลี่ยนเป็น "ไทย + ต่างประเทศ"',
    }));
    return;
  }

  replace($('group-chips'), groups.map((g) => el('button', {
    class: 'chip',
    title: g.rationale || `${g.region_label} · ${g.members.length} ตัวในกลุ่ม`,
    attrs: { type: 'button', 'aria-selected': String(selectedGroups.has(g.id)) },
    on: {
      click: () => {
        if (selectedGroups.has(g.id)) selectedGroups.delete(g.id);
        else selectedGroups.add(g.id);
        renderGroupChips();
        rememberForm();
      },
    },
  },
  el('span', { text: g.kind === 'sector' ? `${g.label} · ${g.region_label}` : g.label }),
  el('span', { class: 'n', text: g.size }))));
}

/* ── การสลับโหมด ────────────────────────────────────────── */

function syncPickMode() {
  const mode = val('pick-mode');
  $('manual-box').hidden = mode !== 'manual';
  if (mode === 'manual') renderPicker(val('search'));
  renderGroupChips();
}

function syncCalcMode() {
  const goalMode = val('calc-mode') === 'goal';
  $('goal-box').hidden = !goalMode;
  $('monthly-box').hidden = goalMode;
}

function switchTab(panel) {
  for (const tab of document.querySelectorAll('#tabs .tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === panel));
  }
  $('panel-sim').hidden = panel !== 'sim';
  $('panel-income').hidden = panel !== 'income';
}

function hideResults() {
  $('sim-result').hidden = true;
  $('income-result').hidden = true;
  $('sim-ai-out').hidden = true;
  $('income-ai-out').hidden = true;
  lastSim = null;
  lastIncome = null;
}

/** คืนค่าทุกช่องกลับเป็นค่าตั้งต้น แล้วล้างผลที่ค้างอยู่ */
function resetAll() {
  for (const [id, value] of Object.entries(DEFAULTS)) {
    const node = $(id);
    if (node) node.value = value;
  }
  $('search').value = '';
  selected = [];
  selectedGroups = new Set();
  hideResults();
  syncPickMode();
  syncCalcMode();
  renderSelected();
  rememberForm();
  flash('ล้างค่าทั้งหมดกลับเป็นค่าตั้งต้นแล้ว');
}

/* ── กราฟช่วงผลลัพธ์ ────────────────────────────────────── */

const svgNS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs) {
  const node = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * วาดกราฟแสดงช่วงผลลัพธ์ตามเวลา
 * แถบทึบคือช่วงที่มีโอกาสเกิด 80% (เปอร์เซ็นไทล์ 10 ถึง 90) เส้นกลางคือมัธยฐาน
 * เส้นประคือเงินที่ใส่ไปสะสม — จุดที่เส้นมัธยฐานตัดขึ้นเหนือเส้นประคือจุดคุ้มทุน
 */
function fanChart(container, path, goal = null) {
  const W = 720;
  const H = 300;
  const PAD = { top: 16, right: 12, bottom: 28, left: 62 };
  const maxValue = Math.max(...path.map((p) => p.p90), goal || 0) * 1.05;
  const years = path.length - 1;

  const x = (year) => PAD.left + (year / years) * (W - PAD.left - PAD.right);
  const y = (value) => H - PAD.bottom - (value / maxValue) * (H - PAD.top - PAD.bottom);

  const svg = svgNode('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });

  // เส้นแนวนอนบอกระดับเงิน
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxValue / 4) * i;
    svg.append(svgNode('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(value), y2: y(value),
      stroke: 'currentColor', 'stroke-opacity': 0.15, 'stroke-width': 1,
    }));
    const label = svgNode('text', {
      x: PAD.left - 8, y: y(value) + 4, 'text-anchor': 'end',
      'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6,
    });
    label.textContent = value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${Math.round(value / 1000)}k`;
    svg.append(label);
  }

  // แถบช่วงผลลัพธ์ 80%
  const upper = path.map((p) => `${x(p.year)},${y(p.p90)}`).join(' ');
  const lower = path.slice().reverse().map((p) => `${x(p.year)},${y(p.p10)}`).join(' ');
  svg.append(svgNode('polygon', {
    points: `${upper} ${lower}`, fill: 'var(--accent)', 'fill-opacity': 0.18,
  }));

  // เงินที่ใส่ไปสะสม
  svg.append(svgNode('polyline', {
    points: path.map((p) => `${x(p.year)},${y(p.invested)}`).join(' '),
    fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.5,
    'stroke-width': 2, 'stroke-dasharray': '6 4',
  }));

  // เส้นเป้าหมาย — มีเฉพาะโหมดคิดย้อนจากเป้าหมาย
  if (goal) {
    svg.append(svgNode('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(goal), y2: y(goal),
      stroke: 'var(--info)', 'stroke-width': 2, 'stroke-dasharray': '2 3',
    }));
    const tag = svgNode('text', {
      x: W - PAD.right, y: y(goal) - 6, 'text-anchor': 'end',
      'font-size': 11, fill: 'var(--info)', 'font-weight': 700,
    });
    tag.textContent = 'เป้าหมาย';
    svg.append(tag);
  }

  // มัธยฐาน
  svg.append(svgNode('polyline', {
    points: path.map((p) => `${x(p.year)},${y(p.median)}`).join(' '),
    fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3,
  }));

  // ปีบนแกนนอน
  for (let year = 0; year <= years; year += Math.max(1, Math.round(years / 6))) {
    const label = svgNode('text', {
      x: x(year), y: H - 8, 'text-anchor': 'middle',
      'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6,
    });
    label.textContent = `ปี ${year}`;
    svg.append(label);
  }

  replace(container, svg);
}

/* ── จำลองผลตอบแทน ──────────────────────────────────────── */

function readAssumptions() {
  const numberOr = (id, fallback) => {
    const n = Number(val(id));
    return Number.isFinite(n) ? n / 100 : fallback;
  };
  return {
    ...DEFAULT_ASSUMPTIONS,
    marketReturn: { TH: numberOr('a-th', 0.08), US: numberOr('a-us', 0.10) },
    goldReturn: numberOr('a-gold', 0.06),
    inflation: numberOr('a-inf', 0.02),
  };
}

function statRow(label, value, note) {
  return el('div', { class: 'stat-row' },
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value', text: value }),
    note ? el('span', { class: 'muted small', text: note }) : null);
}

/** เลือกสินทรัพย์ตามโหมดที่ผู้ใช้ตั้งไว้ — คืนข้อความบอกปัญหาถ้าเลือกไม่ได้ */
function resolveSelection(risk, years, focus) {
  const mode = val('pick-mode');

  if (mode === 'guide') {
    selected = pickGuided(risk, years, focus);
    if (!selected.length) {
      return 'ไม่มีสินทรัพย์ที่ผ่านเกณฑ์ความเสี่ยงและตลาดที่เลือก ลองเพิ่มระดับความเสี่ยงหรือเปลี่ยนตลาด';
    }
  } else if (mode === 'sector' || mode === 'theme') {
    if (!selectedGroups.size) return 'กรุณาเลือกอย่างน้อย 1 กลุ่มก่อนกดคำนวณ';
    selected = pickFromGroups(risk, years, focus);
    if (!selected.length) {
      return 'กลุ่มที่เลือกไม่มีสินทรัพย์ที่ผ่านเกณฑ์ความเสี่ยงและตลาดที่เลือก '
           + 'ลองเพิ่มระดับความเสี่ยงหรือเลือกกลุ่มอื่นเพิ่ม';
    }
  } else if (!selected.length) {
    return 'กรุณาเลือกสินทรัพย์อย่างน้อย 1 ตัว';
  }
  return null;
}

function runSimulation() {
  const years = Math.max(1, Number(val('years')) || 10);
  const risk = val('risk');
  const focus = val('focus');
  const goalMode = val('calc-mode') === 'goal';

  const problem = resolveSelection(risk, years, focus);
  renderSelected();
  if (problem) {
    showError(new Error(problem));
    return;
  }

  const assumptions = readAssumptions();
  // ลงเท่ากันทุกตัว — ตรงไปตรงมาและไม่ต้องเดาว่าตัวไหนควรหนักกว่ากัน
  const holdings = selected.map((asset) => ({ asset, weight: 1 / selected.length }));
  const stats = portfolioStats(holdings, assumptions);

  const lumpSum = Math.max(0, Number(val('lump')) || 0);
  const runs = Number(val('runs')) || 5000;
  const goal = goalMode ? Math.max(0, Number(val('goal')) || 0) : null;

  if (goalMode && !goal) {
    showError(new Error('กรุณาระบุเป้าหมายเงินปลายทาง'));
    return;
  }

  let monthly = Math.max(0, Number(val('monthly')) || 0);
  let solved = null;
  if (goalMode) {
    solved = solveMonthly({ target: goal, years, lumpSum, mu: stats.mu, sigma: stats.sigma });
    monthly = Math.max(0, Math.round(solved.monthly));
  } else if (lumpSum + monthly === 0) {
    showError(new Error('กรุณาระบุเงินก้อนหรือเงิน DCA อย่างน้อยหนึ่งอย่าง'));
    return;
  }

  const result = simulate({ mu: stats.mu, sigma: stats.sigma, years, lumpSum, monthly, runs, goal });
  const growth = (result.median - result.invested) / result.invested;
  const thWeight = selected.filter((a) => a.market === 'TH').length / selected.length;

  $('sim-badge').textContent = `${selected.length} ตัว · เสี่ยง${RISK_PROFILES[risk].label} · ${FOCUS_LABELS[focus]}`;

  // ประโยคเปิดต่างกันตามโจทย์ที่ผู้ใช้ถาม — โหมดเป้าหมายต้องตอบ "เดือนละเท่าไร" ก่อน
  const lead = goalMode
    ? el('p', { class: 'lead' },
      solved.alreadyEnough
        ? `เงินก้อน ${baht(lumpSum)} ที่ลงวันนี้ โตถึงเป้าหมายได้เองใน ${years} ปี โดยไม่ต้องเติมเพิ่ม `
        : `ถ้าอยากมี ${baht(goal)} ในอีก ${years} ปี ต้องลงเพิ่มเดือนละ `,
      el('strong', { text: solved.alreadyEnough ? '(ไม่ต้องเติมเพิ่ม)' : baht(monthly) }),
      ` · โอกาสไปถึงเป้าจริง ${pctText(result.goalProbability, 1)}`)
    : el('p', { class: 'lead' },
      `ใส่เงินรวม ${baht(result.invested)} ตลอด ${years} ปี · ผลลัพธ์ที่เป็นไปได้มากที่สุด `,
      el('strong', { text: baht(result.median) }),
      ` (โต ${pctText(growth)})`);

  replace($('sim-summary'), lead,
    el('div', { class: 'stat-grid' },
      goalMode ? statRow('โอกาสไปถึงเป้าหมาย', pctText(result.goalProbability, 1),
        'ตัวเลขที่คำนวณให้ทำให้ "กรณีกลาง" ถึงเป้าพอดี จึงอยู่ราวครึ่งหนึ่งเสมอ '
        + 'อยากมั่นใจกว่านี้ต้องลงมากกว่าที่แนะนำ') : null,
      statRow('เงินที่ใส่ไปทั้งหมด', baht(result.invested),
        `เงินก้อน ${baht(lumpSum)} + เดือนละ ${baht(monthly)}`),
      statRow('กรณีดี (โอกาส 10%)', baht(result.p90), 'ตลาดเป็นใจตลอดทาง'),
      statRow('กรณีกลาง', baht(result.median), 'ครึ่งหนึ่งของความเป็นไปได้อยู่เหนือเส้นนี้'),
      statRow('กรณีแย่ (โอกาส 10%)', baht(result.p10), 'ต้องรับได้ก่อนตัดสินใจลงทุน'),
      statRow('โอกาสที่จะขาดทุน', pctText(result.lossProbability), 'จบลงด้วยเงินน้อยกว่าที่ใส่ไป'),
      statRow('เคยติดลบจากจุดสูงสุด', pctText(result.medianDrawdown),
        `กรณีแย่ถึง ${pctText(result.worstDrawdown)}`),
      statRow('มูลค่าตามกำลังซื้อวันนี้', baht(toTodayValue(result.median, years, assumptions.inflation)),
        `หักเงินเฟ้อ ${pctText(assumptions.inflation)} ต่อปีแล้ว`),
      statRow('ผลตอบแทนคาดหวังของพอร์ต', `${pctText(stats.mu)} ต่อปี`,
        `ความผันผวน ${pctText(stats.sigma)} · beta ${numText(stats.beta)}`)));

  fanChart($('sim-chart'), result.path, goal);

  replace($('sim-table'),
    el('p', { class: 'muted small' },
      'แถบสีคือช่วงที่มีโอกาสเกิด 80% เส้นทึบคือกรณีกลาง เส้นประคือเงินที่ใส่ไปสะสม · '
      + 'ตัวเลขทั้งหมดมาจากการจำลอง ไม่ใช่การรับประกัน ผลจริงขึ้นกับสิ่งที่ไม่มีใครทำนายได้'));

  lastSim = {
    kind: 'sim',
    years, lumpSum, monthly, invested: result.invested,
    median: result.median, p10: result.p10, p90: result.p90,
    lossProbability: result.lossProbability,
    medianDrawdown: result.medianDrawdown, worstDrawdown: result.worstDrawdown,
    todayValue: toTodayValue(result.median, years, assumptions.inflation),
    mu: stats.mu, sigma: stats.sigma, beta: stats.beta,
    count: selected.length, thWeight,
    // คิดความกระจุกตัวมาให้เสร็จ ไม่ให้ AI ไปบวกน้ำหนักรายตัวเอง
    concentration: concentration(holdings),
    holdings: selected.map((a) => ({ symbol: a.symbol, market: a.market, weight: 1 / selected.length })),
  };

  $('sim-result').hidden = false;
  $('sim-ai-out').hidden = true;
  $('notice').hidden = true;
  rememberForm();
}

/* ── พอร์ตปันผล ─────────────────────────────────────────── */

/** แถบปฏิทิน 12 เดือน — ความสูงของแท่งคือเงินที่เข้าในเดือนนั้น */
function renderCalendar(container, calendar) {
  const peak = Math.max(...calendar.months.map((m) => m.amount), 1);
  const average = calendar.total / 12;

  replace(container, el('div', { class: 'calendar' },
    ...calendar.months.map((m) => {
      const height = Math.round((m.amount / peak) * 100);
      const names = [...new Set(m.symbols)].join(', ');
      return el('div', {
        class: `cal-col ${m.amount > 0 ? '' : 'cal-empty'}`,
        title: m.amount > 0
          ? `${MONTH_TH[m.month]} · ${baht(m.amount)}\nจาก: ${names}`
          : `${MONTH_TH[m.month]} · ไม่มีเงินปันผลเข้า`,
      },
      el('div', { class: 'cal-amount mono', text: m.amount > 0 ? `${Math.round(m.amount / 1000)}k` : '—' }),
      el('div', { class: 'cal-bar' }, el('i', { style: `height:${height}%` })),
      el('div', { class: 'cal-month', text: MONTH_TH[m.month] }));
    }),
  ),
  el('p', { class: 'muted small', style: 'margin:10px 0 0' },
    `เฉลี่ยถ้าเกลี่ยเท่ากันทุกเดือนคือ ${baht(average)} — แท่งที่สูงกว่านี้คือเดือนที่เงินเข้าเป็นก้อน `
    + 'ตัวเลขอิงวันขึ้นเครื่องหมาย XD ย้อนหลัง เงินจริงเข้าบัญชีหลังจากนั้นราว 2–6 สัปดาห์'));
}

function monthsCell(asset) {
  const months = asset.dividend_months || [];
  if (!months.length) {
    return el('span', { class: 'muted', title: 'ระบบยังไม่มีประวัติการจ่ายของตัวนี้', text: '—' });
  }
  const text = months.map((m) => MONTH_TH[m]).join(' · ');
  return el('span', {},
    el('span', { text }),
    asset.dividend_confidence === 'low'
      ? el('span', {
        class: 'badge badge-warn', style: 'margin-left:6px',
        text: 'ไม่แน่นอน',
        title: 'จ่ายไม่ตรงเดือนเดิมทุกปี หรือมีประวัติสั้นเกินกว่าจะสรุปรูปแบบได้',
      })
      : null);
}

function runIncome() {
  const target = Math.max(0, Number(val('target')) || 0);
  const count = Math.max(3, Number(val('count')) || 6);
  const minYield = (Number(val('min-yield')) || 3) / 100;
  const applyTax = val('tax') === '1';
  const focus = val('income-focus');

  if (!target) {
    showError(new Error('กรุณาระบุเป้าหมายปันผลต่อเดือน'));
    return;
  }

  const candidates = screenDividendAssets(dashboard.all_assets, { minYield, focus });
  const portfolio = dividendPortfolio(target, candidates, { count, applyTax });

  if (!portfolio) {
    showError(new Error(
      `ไม่มีสินทรัพย์ใน "${FOCUS_LABELS[focus]}" ที่ผ่านเกณฑ์ปันผล ${pctText(minYield)} `
      + 'ลองลดเกณฑ์ลงหรือขยายตลาดที่โฟกัส',
    ));
    return;
  }

  const calendar = dividendCalendar(portfolio.holdings);
  const taxPaid = portfolio.holdings.reduce((s, h) => s + h.grossAnnual - h.netAnnual, 0);
  const thWeight = portfolio.holdings
    .filter((h) => h.asset.market === 'TH')
    .reduce((s, h) => s + h.weight, 0);

  $('income-badge').textContent =
    `${portfolio.holdings.length} ตัว · ปันผลสุทธิ ${pctText(portfolio.netYield)} · ${FOCUS_LABELS[focus]}`;

  replace($('income-summary'),
    el('p', { class: 'lead' },
      'ต้องใช้เงินต้นประมาณ ',
      el('strong', { text: baht(portfolio.capital) }),
      ` จึงจะได้ปันผลสุทธิเฉลี่ย ${baht(target)} ต่อเดือน`),
    el('div', { class: 'stat-grid' },
      statRow('ปันผลสุทธิรวมต่อปี', baht(portfolio.annualTarget), 'หลังหักภาษี ณ ที่จ่ายแล้ว'),
      statRow('อัตราปันผลสุทธิของพอร์ต', pctText(portfolio.netYield), 'ถ่วงน้ำหนักตามคะแนนคุณภาพ'),
      statRow('ภาษีที่ถูกหักรวมต่อปี', baht(taxPaid),
        applyTax ? 'ไทย 10% · สหรัฐฯ 15%' : 'ไม่ได้คิดภาษี'),
      statRow('สัดส่วนหุ้นไทยในพอร์ต', pctText(thWeight, 1),
        thWeight === 1 ? 'ทั้งพอร์ตอยู่ในตลาดเดียว — ความเสี่ยงกระจุกที่เศรษฐกิจไทย'
          : thWeight === 0 ? 'ไม่มีหุ้นไทยเลย — รับความเสี่ยงค่าเงินเต็มจำนวน' : ''),
      // total = 0 แปลว่าไม่มีปฏิทินของตัวไหนเลย ไม่ใช่ "เงินเข้าทุกเดือน"
      // ถ้าไม่แยกสองกรณีนี้ ผู้ใช้จะอ่านว่าพอร์ตนี้จ่ายสม่ำเสมอทั้งที่ระบบยังไม่รู้อะไรเลย
      statRow('เดือนที่ไม่มีเงินปันผลเข้า',
        calendar.total <= 0 ? 'ยังไม่มีข้อมูล'
          : calendar.gapMonths.length ? `${calendar.gapMonths.length} เดือน` : 'ไม่มี',
        calendar.total <= 0 ? 'ระบบยังไม่มีประวัติการจ่ายของหุ้นในพอร์ตนี้'
          : calendar.gapMonths.length
            ? `เดือน ${calendar.gapMonths.map((m) => MONTH_TH[m]).join(' · ')}`
            : 'มีเงินเข้าทุกเดือนของปี')));

  if (calendar.total > 0) {
    $('calendar-note').textContent =
      'ตัวเลข "ต่อเดือน" ข้างบนเป็นค่าเฉลี่ยที่เกลี่ยแล้ว ของจริงเงินเข้าตามรอบจ่ายปันผลของแต่ละบริษัท '
      + 'กราฟนี้คือภาพที่เกิดขึ้นจริงถ้าถือพอร์ตชุดนี้'
      + (calendar.lowConfidence
        ? ` · มี ${calendar.lowConfidence} ตัวที่จ่ายไม่ตรงเดือนเดิมทุกปี ตำแหน่งแท่งของตัวนั้นจึงเป็นการประมาณ`
        : '');
    renderCalendar($('calendar'), calendar);
  } else {
    $('calendar-note').textContent = '';
    replace($('calendar'), el('p', {
      class: 'muted small',
      text: 'ยังไม่มีประวัติเดือนจ่ายปันผลของหุ้นในพอร์ตนี้ — ปฏิทินจะขึ้นเองหลัง pipeline '
          + 'ดึงข้อมูลรอบถัดไป',
    }));
  }

  replace($('income-table'),
    el('thead', {}, el('tr', {},
      ...['สินทรัพย์', 'ตลาด', 'สัดส่วน', 'เงินลงทุน', 'ปันผล/ปี (ก่อนภาษี)', 'สุทธิ/ปี',
        'สุทธิ/เดือน (เฉลี่ย)', 'ปกติจ่ายเดือน', 'ความถี่']
        .map((h) => el('th', { text: h })))),
    el('tbody', {}, ...portfolio.holdings.map((h) => el('tr', {},
      el('td', {}, el('a', { href: `/asset.html?s=${encodeURIComponent(h.asset.symbol)}`, text: h.asset.symbol }),
        el('div', { class: 'muted small', text: h.asset.name || '' })),
      el('td', {}, marketBadge(h.asset.market)),
      el('td', { class: 'mono', text: pctText(h.weight) }),
      el('td', { class: 'mono', text: baht(h.amount) }),
      el('td', { class: 'mono', text: baht(h.grossAnnual) }),
      el('td', { class: 'mono', text: baht(h.netAnnual) }),
      el('td', { class: 'mono', text: baht(h.netAnnual / 12) }),
      el('td', {}, monthsCell(h.asset)),
      el('td', { class: 'small', text: h.asset.dividend_pattern || '—' })))));

  const notes = [
    'อัตราปันผลคำนวณจากที่จ่ายมาแล้วในอดีต บริษัทลดหรืองดจ่ายได้เมื่อกำไรลดลง',
    'ระบบตัดตัวที่จ่ายเกินกำไรและตัวที่ปันผลสูงเกิน 12% ออกแล้ว เพราะมักเกิดจากราคาที่เพิ่งร่วงแรง',
    'ราคาหุ้นยังขึ้นลงได้ เงินต้นที่ลงไปไม่ได้ถูกล็อกไว้ที่มูลค่าเดิม',
    'เดือนที่จ่ายอิงประวัติย้อนหลัง 3 ปี บริษัทเลื่อนหรือเปลี่ยนรอบจ่ายได้',
  ];
  if (calendar.unknown.amount > 0) {
    notes.push(`ระบบยังไม่มีประวัติการจ่ายของ ${calendar.unknown.symbols.join(', ')} `
      + `(คิดเป็น ${baht(calendar.unknown.amount)} ต่อปี) จึงไม่ได้ลงในกราฟปฏิทิน`);
  }
  if (thWeight > 0 && thWeight < 1) {
    notes.push('พอร์ตมีทั้งหุ้นไทยและต่างประเทศ — ส่วนที่เป็นต่างประเทศจะได้เงินปันผลเป็นเงินตราต่างประเทศ '
      + 'จำนวนเงินบาทที่ได้จริงจึงขึ้นกับค่าเงินวันที่แลกด้วย');
  }

  replace($('income-notes'),
    el('div', { class: 'notice' },
      el('strong', { text: 'ข้อควรรู้ก่อนใช้ตัวเลขนี้' }),
      el('ul', {}, ...notes.map((t) => el('li', { text: t })))));

  lastIncome = {
    kind: 'income',
    target, capital: portfolio.capital, netYield: portfolio.netYield, taxPaid,
    count: portfolio.holdings.length, thWeight,
    // คิดความกระจุกตัวมาให้เสร็จ ไม่ให้ AI ไปบวกน้ำหนักรายตัวเอง
    concentration: concentration(portfolio.holdings),
    gapMonths: calendar.gapMonths, peakMonthShare: calendar.peakShare,
    holdings: portfolio.holdings.map((h) => ({
      symbol: h.asset.symbol, market: h.asset.market, weight: h.weight,
      yield: h.asset.dividend_yield, months: h.asset.dividend_months || [],
    })),
  };

  $('income-result').hidden = false;
  $('income-ai-out').hidden = true;
  $('notice').hidden = true;
  rememberForm();
}

/* ── สรุปแผนด้วย AI ─────────────────────────────────────── */

/**
 * ส่งตัวเลขที่คำนวณเสร็จแล้วไปให้ AI เรียบเรียง
 * ปุ่มถูกล็อกระหว่างรอ เพราะแต่ละครั้งนับโควตาเดียวกับหน้าถาม AI
 */
async function summarisePlan(plan, buttonId, outputId, noteId) {
  const button = $(buttonId);
  const output = $(outputId);
  const note = $(noteId);

  if (!plan) {
    note.textContent = 'ยังไม่มีผลการคำนวณ กดคำนวณก่อน';
    return;
  }

  button.disabled = true;
  note.textContent = 'กำลังให้ AI อ่านตัวเลขและเรียบเรียง…';
  output.hidden = true;

  try {
    const response = await fetch('/api/plan-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    });
    if (response.status === 401) {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `สรุปแผนไม่สำเร็จ (${response.status})`);

    output.textContent = body.summary;
    output.hidden = false;
    note.textContent = body.quota
      ? `ใช้โควตาไปแล้ว ${body.quota.used}/${body.quota.limit} ครั้งวันนี้`
      : '';
  } catch (err) {
    note.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

/* ── เริ่มทำงาน ─────────────────────────────────────────── */

function bindEvents() {
  for (const tab of document.querySelectorAll('#tabs .tab')) {
    tab.addEventListener('click', () => { switchTab(tab.dataset.panel); rememberForm(); });
  }

  $('pick-mode').addEventListener('change', () => {
    // เปลี่ยนวิธีเลือกแล้วรายการเดิมไม่มีความหมายอีกต่อไป ต้องล้างให้เอง
    // ไม่งั้นผู้ใช้จะเจอพอร์ตที่ผสมของสองโหมดโดยไม่รู้ตัว
    selected = [];
    renderSelected();
    syncPickMode();
    rememberForm();
  });
  $('focus').addEventListener('change', () => { syncPickMode(); rememberForm(); });
  $('calc-mode').addEventListener('change', () => { syncCalcMode(); rememberForm(); });
  $('search').addEventListener('input', (e) => renderPicker(e.target.value));

  $('clear-picks').addEventListener('click', () => {
    selected = [];
    selectedGroups = new Set();
    renderSelected();
    renderGroupChips();
    if (val('pick-mode') === 'manual') renderPicker(val('search'));
    rememberForm();
  });

  $('run-sim').addEventListener('click', runSimulation);
  $('reset-sim').addEventListener('click', resetAll);
  $('run-income').addEventListener('click', runIncome);
  $('reset-income').addEventListener('click', resetAll);

  $('save-plan').addEventListener('click', savePlan);
  $('load-plan').addEventListener('click', loadPlan);
  $('delete-plan').addEventListener('click', deletePlan);

  $('sim-ai').addEventListener('click', () => summarisePlan(lastSim, 'sim-ai', 'sim-ai-out', 'sim-ai-note'));
  $('income-ai').addEventListener('click', () => summarisePlan(lastIncome, 'income-ai', 'income-ai-out', 'income-ai-note'));

  // จำค่าที่กรอกไว้ทุกช่อง เพื่อไม่ต้องกรอกใหม่ทั้งหมดเมื่อกลับเข้ามา
  for (const id of [...SIM_FIELDS, ...INCOME_FIELDS]) {
    $(id).addEventListener('change', rememberForm);
  }
}

async function boot() {
  bindEvents();
  try {
    dashboard = await api({ file: 'dashboard' });
  } catch (err) {
    showError(err);
    return;
  }

  $('updated').textContent = `ข้อมูล ณ ${thaiDateTime(dashboard.generated_at)}`;
  $('disclaimer').textContent = dashboard.disclaimer;

  renderPlanList();

  const last = readStore(STORE_LAST, null);
  if (last) applyForm(last);
  else {
    syncPickMode();
    syncCalcMode();
    renderSelected();
  }

  // ข้อมูลรุ่นเก่ายังไม่มี beta/volatility ต้องบอกให้รู้ว่าผลจะหยาบกว่าที่ควร
  const warnings = [];
  if (!dashboard.all_assets.some((a) => Number.isFinite(a.beta))) {
    warnings.push('ข้อมูลชุดนี้ยังไม่มีค่า beta และความผันผวน — ระบบจะประมาณให้ ผลลัพธ์จึงหยาบกว่าปกติ');
  }
  if (!dashboard.all_assets.some((a) => (a.dividend_months || []).length)) {
    warnings.push('ยังไม่มีประวัติเดือนจ่ายปันผลในข้อมูลชุดนี้ — ปฏิทินปันผลจะยังว่าง');
  }
  if (!(dashboard.groups || []).length) {
    warnings.push('ข้อมูลชุดนี้ยังไม่มีรายชื่ออุตสาหกรรม/ธีม — โหมดเลือกตามกลุ่มจะยังไม่มีตัวเลือก');
  }
  if (warnings.length) {
    const box = $('notice');
    box.hidden = false;
    box.textContent = `${warnings.join(' · ')} · จะครบเองหลัง pipeline รันรอบถัดไป`;
  }
}

boot();
