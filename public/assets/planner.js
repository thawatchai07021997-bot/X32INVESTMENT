/* ============================================================
   X32 — หน้าวางแผนการลงทุน

   คำนวณทั้งหมดในเบราว์เซอร์ ไม่เรียก AI และไม่เรียกเซิร์ฟเวอร์ระหว่างคำนวณ
   เพราะเป็นคณิตศาสตร์ล้วนที่ต้องให้คำตอบเดิมทุกครั้งและตรวจย้อนได้
   ปรับตัวเลขแล้วเห็นผลทันที ไม่มีค่าใช้จ่ายต่อครั้ง
   ============================================================ */

import { api, showError } from './api.js';
import { el, replace } from './dom.js';
import {
  DEFAULT_ASSUMPTIONS, dividendPortfolio, portfolioStats,
  screenDividendAssets, simulate, toTodayValue,
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

let dashboard = null;
let selected = [];

/* ── เลือกสินทรัพย์ ─────────────────────────────────────── */

/** ระยะเวลาถือครองกำหนดว่าจะใช้อันดับของระยะไหนใน Dashboard */
function horizonForYears(years) {
  if (years <= 1) return 'short';
  if (years <= 3) return 'mid';
  return 'long';
}

/**
 * จัดพอร์ตให้อัตโนมัติจากอันดับต้นของระยะที่ตรงกับเวลาที่ผู้ใช้ตั้งใจถือ
 * แล้วกรองตามระดับความเสี่ยงที่รับได้
 */
function pickGuided(risk, years) {
  const profile = RISK_PROFILES[risk];
  const horizon = horizonForYears(years);
  const ranked = dashboard.horizons[horizon]?.items || [];

  // เริ่มจากอันดับต้นของระยะนั้น ถ้าไม่พอให้ดึงจากทั้ง universe มาเสริม
  const pool = [...ranked];
  const seen = new Set(pool.map((a) => a.symbol));
  const rest = dashboard.all_assets
    .filter((a) => !seen.has(a.symbol))
    .sort((a, b) => (b.horizon_scores?.[horizon]?.score || 0) - (a.horizon_scores?.[horizon]?.score || 0));
  pool.push(...rest);

  const beta = (a) => (Number.isFinite(a.beta) ? a.beta : 1);
  const vol = (a) => (Number.isFinite(a.volatility) ? a.volatility : 0.3);
  const score = (a) => a.horizon_scores?.[horizon]?.score || 0;

  const eligible = pool.filter((a) => {
    if (a.data_quality !== 'full' && risk !== 'high') return false;
    return beta(a) <= profile.maxBeta;
  });

  const sorters = {
    // เสี่ยงต่ำ: เอาตัวที่แกว่งน้อยก่อน แต่ยังต้องมีคะแนนพอใช้
    stability: (a, b) => (vol(a) - vol(b)) || (score(b) - score(a)),
    score: (a, b) => score(b) - score(a),
    // เสี่ยงสูง: เอาคะแนนสูงและยอมรับตัวที่แกว่งแรง
    growth: (a, b) => (score(b) + beta(b) * 10) - (score(a) + beta(a) * 10),
  };

  return eligible.sort(sorters[profile.sortBy]).slice(0, profile.count);
}

function renderSelected() {
  const box = document.getElementById('selected');
  if (!selected.length) {
    replace(box, el('span', { class: 'muted small', text: 'ยังไม่ได้เลือกสินทรัพย์' }));
    return;
  }
  replace(box, selected.map((a) => el('span', { class: 'chip' },
    `${a.symbol} · ${a.market}`,
    el('button', {
      class: 'chip-x', text: '×', attrs: { type: 'button', 'aria-label': `เอา ${a.symbol} ออก` },
      on: { click: () => { selected = selected.filter((x) => x.symbol !== a.symbol); renderSelected(); } },
    }))));
}

function renderPicker(keyword = '') {
  const box = document.getElementById('asset-picker');
  const q = keyword.trim().toLowerCase();
  const list = dashboard.all_assets
    .filter((a) => !q || a.symbol.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
    .slice(0, 60);

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
          renderPicker(document.getElementById('search').value);
        },
      },
    }, el('strong', { text: a.symbol }), ` ${a.name || ''}`);
  }));
}

/* ── กราฟช่วงผลลัพธ์ ────────────────────────────────────── */

/**
 * วาดกราฟแสดงช่วงผลลัพธ์ตามเวลา
 * แถบทึบคือช่วงที่มีโอกาสเกิด 80% (เปอร์เซ็นไทล์ 10 ถึง 90) เส้นกลางคือมัธยฐาน
 * เส้นประคือเงินที่ใส่ไปสะสม — จุดที่เส้นมัธยฐานตัดขึ้นเหนือเส้นประคือจุดคุ้มทุน
 */
function fanChart(container, path) {
  const W = 720;
  const H = 300;
  const PAD = { top: 16, right: 12, bottom: 28, left: 62 };
  const maxValue = Math.max(...path.map((p) => p.p90)) * 1.05;
  const years = path.length - 1;

  const x = (year) => PAD.left + (year / years) * (W - PAD.left - PAD.right);
  const y = (value) => H - PAD.bottom - (value / maxValue) * (H - PAD.top - PAD.bottom);

  const svgNS = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  const svg = node('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });

  // เส้นแนวนอนบอกระดับเงิน
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxValue / 4) * i;
    svg.append(node('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(value), y2: y(value),
      stroke: 'currentColor', 'stroke-opacity': 0.15, 'stroke-width': 1,
    }));
    const label = node('text', {
      x: PAD.left - 8, y: y(value) + 4, 'text-anchor': 'end',
      'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6,
    });
    label.textContent = value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${Math.round(value / 1000)}k`;
    svg.append(label);
  }

  // แถบช่วงผลลัพธ์ 80%
  const upper = path.map((p) => `${x(p.year)},${y(p.p90)}`).join(' ');
  const lower = path.slice().reverse().map((p) => `${x(p.year)},${y(p.p10)}`).join(' ');
  svg.append(node('polygon', {
    points: `${upper} ${lower}`, fill: 'var(--accent)', 'fill-opacity': 0.18,
  }));

  // เงินที่ใส่ไปสะสม
  svg.append(node('polyline', {
    points: path.map((p) => `${x(p.year)},${y(p.invested)}`).join(' '),
    fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.5,
    'stroke-width': 2, 'stroke-dasharray': '6 4',
  }));

  // มัธยฐาน
  svg.append(node('polyline', {
    points: path.map((p) => `${x(p.year)},${y(p.median)}`).join(' '),
    fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3,
  }));

  // ปีบนแกนนอน
  for (let year = 0; year <= years; year += Math.max(1, Math.round(years / 6))) {
    const label = node('text', {
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
  const val = (id, fallback) => {
    const n = Number(document.getElementById(id).value);
    return Number.isFinite(n) ? n / 100 : fallback;
  };
  return {
    ...DEFAULT_ASSUMPTIONS,
    marketReturn: { TH: val('a-th', 0.08), US: val('a-us', 0.10) },
    goldReturn: val('a-gold', 0.06),
    inflation: val('a-inf', 0.02),
  };
}

function statRow(label, value, note) {
  return el('div', { class: 'stat-row' },
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value', text: value }),
    note ? el('span', { class: 'muted small', text: note }) : null);
}

const baht = (v) => `${Math.round(v).toLocaleString('th-TH')} บาท`;

function runSimulation() {
  const years = Math.max(1, Number(document.getElementById('years').value) || 10);
  const risk = document.getElementById('risk').value;
  const mode = document.getElementById('pick-mode').value;

  if (mode === 'guide') {
    selected = pickGuided(risk, years);
    renderSelected();
  }
  if (!selected.length) {
    showError(new Error('กรุณาเลือกสินทรัพย์อย่างน้อย 1 ตัว'));
    return;
  }

  const assumptions = readAssumptions();
  // ลงเท่ากันทุกตัว — ตรงไปตรงมาและไม่ต้องเดาว่าตัวไหนควรหนักกว่ากัน
  const holdings = selected.map((asset) => ({ asset, weight: 1 / selected.length }));
  const stats = portfolioStats(holdings, assumptions);

  const lumpSum = Math.max(0, Number(document.getElementById('lump').value) || 0);
  const monthly = Math.max(0, Number(document.getElementById('monthly').value) || 0);
  const runs = Number(document.getElementById('runs').value) || 5000;

  if (lumpSum + monthly === 0) {
    showError(new Error('กรุณาระบุเงินก้อนหรือเงิน DCA อย่างน้อยหนึ่งอย่าง'));
    return;
  }

  const result = simulate({ mu: stats.mu, sigma: stats.sigma, years, lumpSum, monthly, runs });
  const growth = (result.median - result.invested) / result.invested;

  document.getElementById('sim-badge').textContent =
    `${selected.length} ตัว · เสี่ยง${RISK_PROFILES[risk].label}`;

  replace(document.getElementById('sim-summary'),
    el('p', { class: 'lead' },
      `ใส่เงินรวม ${baht(result.invested)} ตลอด ${years} ปี · ผลลัพธ์ที่เป็นไปได้มากที่สุด `,
      el('strong', { text: baht(result.median) }),
      ` (โต ${pctText(growth)})`),
    el('div', { class: 'stat-grid' },
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

  fanChart(document.getElementById('sim-chart'), result.path);

  replace(document.getElementById('sim-table'),
    el('p', { class: 'muted small' },
      'แถบสีคือช่วงที่มีโอกาสเกิด 80% เส้นทึบคือกรณีกลาง เส้นประคือเงินที่ใส่ไปสะสม · '
      + 'ตัวเลขทั้งหมดมาจากการจำลอง ไม่ใช่การรับประกัน ผลจริงขึ้นกับสิ่งที่ไม่มีใครทำนายได้'));

  document.getElementById('sim-result').hidden = false;
  document.getElementById('notice').hidden = true;
}

/* ── พอร์ตปันผล ─────────────────────────────────────────── */

function runIncome() {
  const target = Math.max(0, Number(document.getElementById('target').value) || 0);
  const count = Math.max(3, Number(document.getElementById('count').value) || 6);
  const minYield = (Number(document.getElementById('min-yield').value) || 3) / 100;
  const applyTax = document.getElementById('tax').value === '1';

  if (!target) {
    showError(new Error('กรุณาระบุเป้าหมายปันผลต่อเดือน'));
    return;
  }

  const candidates = screenDividendAssets(dashboard.all_assets, { minYield });
  const portfolio = dividendPortfolio(target, candidates, { count, applyTax });

  if (!portfolio) {
    showError(new Error(`ไม่มีสินทรัพย์ที่ผ่านเกณฑ์ปันผล ${pctText(minYield)} ลองลดเกณฑ์ลง`));
    return;
  }

  document.getElementById('income-badge').textContent =
    `${portfolio.holdings.length} ตัว · ปันผลสุทธิ ${pctText(portfolio.netYield)}`;

  replace(document.getElementById('income-summary'),
    el('p', { class: 'lead' },
      'ต้องใช้เงินต้นประมาณ ',
      el('strong', { text: baht(portfolio.capital) }),
      ` จึงจะได้ปันผลสุทธิเฉลี่ย ${baht(target)} ต่อเดือน`),
    el('div', { class: 'stat-grid' },
      statRow('ปันผลสุทธิรวมต่อปี', baht(portfolio.annualTarget), 'หลังหักภาษี ณ ที่จ่ายแล้ว'),
      statRow('อัตราปันผลสุทธิของพอร์ต', pctText(portfolio.netYield), 'ถ่วงน้ำหนักตามคะแนนคุณภาพ'),
      statRow('ภาษีที่ถูกหักรวมต่อปี',
        baht(portfolio.holdings.reduce((s, h) => s + h.grossAnnual - h.netAnnual, 0)),
        applyTax ? 'ไทย 10% · สหรัฐฯ 15%' : 'ไม่ได้คิดภาษี')));

  const table = document.getElementById('income-table');
  replace(table,
    el('thead', {}, el('tr', {},
      ...['สินทรัพย์', 'ตลาด', 'สัดส่วน', 'เงินลงทุน', 'ปันผล/ปี (ก่อนภาษี)', 'สุทธิ/ปี', 'สุทธิ/เดือน']
        .map((h) => el('th', { text: h })))),
    el('tbody', {}, ...portfolio.holdings.map((h) => el('tr', {},
      el('td', {}, el('a', { href: `/asset.html?s=${encodeURIComponent(h.asset.symbol)}`, text: h.asset.symbol }),
        el('div', { class: 'muted small', text: h.asset.name || '' })),
      el('td', {}, marketBadge(h.asset.market)),
      el('td', { class: 'mono', text: pctText(h.weight) }),
      el('td', { class: 'mono', text: baht(h.amount) }),
      el('td', { class: 'mono', text: baht(h.grossAnnual) }),
      el('td', { class: 'mono', text: baht(h.netAnnual) }),
      el('td', { class: 'mono', text: baht(h.netAnnual / 12) })))));

  replace(document.getElementById('income-notes'),
    el('div', { class: 'notice' },
      el('strong', { text: 'ข้อควรรู้ก่อนใช้ตัวเลขนี้' }),
      el('ul', {},
        el('li', { text: 'หุ้นไทยส่วนใหญ่จ่ายปันผลปีละ 1–2 ครั้ง ไม่ใช่ทุกเดือน ตัวเลขต่อเดือนคือค่าเฉลี่ยที่เกลี่ยแล้ว' }),
        el('li', { text: 'อัตราปันผลคำนวณจากที่จ่ายมาแล้วในอดีต บริษัทลดหรืองดจ่ายได้เมื่อกำไรลดลง' }),
        el('li', { text: 'ระบบตัดตัวที่จ่ายเกินกำไรและตัวที่ปันผลสูงเกิน 12% ออกแล้ว เพราะมักเกิดจากราคาที่เพิ่งร่วงแรง' }),
        el('li', { text: 'ราคาหุ้นยังขึ้นลงได้ เงินต้นที่ลงไปไม่ได้ถูกล็อกไว้ที่มูลค่าเดิม' }))));

  document.getElementById('income-result').hidden = false;
  document.getElementById('notice').hidden = true;
}

/* ── เริ่มทำงาน ─────────────────────────────────────────── */

function bindTabs() {
  const tabs = [...document.querySelectorAll('#tabs .tab')];
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.removeAttribute('aria-current'));
    tab.setAttribute('aria-current', 'page');
    document.getElementById('panel-sim').hidden = tab.dataset.panel !== 'sim';
    document.getElementById('panel-income').hidden = tab.dataset.panel !== 'income';
  }));
}

async function boot() {
  bindTabs();
  try {
    dashboard = await api({ file: 'dashboard' });
  } catch (err) {
    showError(err);
    return;
  }

  document.getElementById('updated').textContent =
    `ข้อมูล ณ ${thaiDateTime(dashboard.generated_at)}`;
  document.getElementById('disclaimer').textContent = dashboard.disclaimer;

  // ข้อมูลรุ่นเก่ายังไม่มี beta/volatility ต้องบอกให้รู้ว่าผลจะหยาบกว่าที่ควร
  if (!dashboard.all_assets.some((a) => Number.isFinite(a.beta))) {
    const box = document.getElementById('notice');
    box.hidden = false;
    box.textContent = 'ข้อมูลชุดนี้ยังไม่มีค่า beta และความผันผวน — ระบบจะประมาณให้ '
      + 'ผลลัพธ์จึงหยาบกว่าปกติ · จะแม่นขึ้นเองหลัง pipeline รันรอบถัดไป';
  }

  document.getElementById('pick-mode').addEventListener('change', (e) => {
    const manual = e.target.value === 'manual';
    document.getElementById('manual-box').hidden = !manual;
    if (manual) renderPicker();
    else { selected = []; renderSelected(); }
  });
  document.getElementById('search').addEventListener('input', (e) => renderPicker(e.target.value));
  document.getElementById('run-sim').addEventListener('click', runSimulation);
  document.getElementById('run-income').addEventListener('click', runIncome);

  renderSelected();
}

boot();
