/* ============================================================
   X32 — หน้ารายละเอียดสินทรัพย์รายตัว
   ============================================================ */

import { api, showError } from './api.js';
import { lineChart } from './chart.js';
import { el, replace } from './dom.js';
import {
  marketBadge, num, pct, pctPlain, qualityBadge, thaiDateTime, trendBadge,
} from './format.js';

const HORIZON_META = {
  short: ['ระยะสั้น', '1–3 เดือน'],
  mid: ['ระยะกลาง', '6–18 เดือน'],
  long: ['ระยะยาว', '3 ปีขึ้นไป'],
  dividend: ['เน้นปันผล', 'กระแสเงินสดสม่ำเสมอ'],
};

const FACTOR_META = {
  value: ['ความถูกของราคา', 'ราคาถูกเมื่อเทียบกับกำไรและมูลค่าทางบัญชี'],
  quality: ['คุณภาพกิจการ', 'ทำกำไรเก่ง หนี้ไม่มาก รายได้เติบโต'],
  momentum: ['โมเมนตัมราคา', 'ราคากำลังไปได้ดีเทียบกับตัวอื่นในกลุ่ม'],
  dividend: ['ปันผล', 'จ่ายปันผลสูงและจ่ายได้อย่างยั่งยืน'],
};

/** แถวคะแนนพร้อมแถบแสดงสัดส่วน — ใช้ทั้งส่วนระยะและส่วนปัจจัย */
function scoreRow(label, hint, score, note) {
  const width = score === null || score === undefined
    ? 0 : Math.max(0, Math.min(100, score));

  return el('div', {
    style: 'padding:10px 0;border-bottom:2px solid var(--line)',
  },
  el('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:baseline' },
    el('strong', { text: label }),
    el('span', { class: 'mono', style: 'font-size:1.15rem' },
      score === null || score === undefined
        ? el('span', { class: 'muted', text: 'ไม่มีข้อมูล' })
        : el('span', { text: score.toFixed(0) })),
  ),
  el('span', {
    class: 'bar',
    style: 'width:100%;height:14px;margin:6px 0 4px',
  }, el('i', { style: `width:${width}%` })),
  el('div', { class: 'small muted', text: hint }),
  note ? el('div', { class: 'small', style: 'margin-top:4px' }, note) : null,
  );
}

function renderHorizons(data) {
  const box = document.getElementById('horizons');
  const scores = data.horizon_scores || {};
  const rows = Object.entries(HORIZON_META).map(([key, [label, period]]) => {
    const entry = scores[key] || {};
    const confidence = entry.confidence ?? 0;

    // ความมั่นใจต่ำแปลว่าคะแนนนี้คิดจากข้อมูลไม่ครบ ต้องบอกให้ชัด
    const note = entry.score !== null && entry.score !== undefined && confidence < 0.8
      ? el('span', { class: 'badge badge-warn',
        text: `คิดจากข้อมูล ${Math.round(confidence * 100)}% ของที่ควรมี` })
      : null;

    return scoreRow(`${label} (${period})`, '', entry.score ?? null, note);
  });
  replace(box, rows);
}

/* ── บทวิเคราะห์จาก AI ──────────────────────────────────── */

// สีของข้อสรุปแต่ละระยะ — ต้องตรงกับ enum ใน pipeline/agents/analyst.py
const VERDICT_CLASS = {
  'น่าสนใจ': 'badge badge-up',
  'เฝ้าดู': 'badge badge-warn',
  'ยังไม่เหมาะ': 'badge',
};

function aiHorizonRow(key, entry) {
  const [label, period] = HORIZON_META[key] || [key, ''];
  return el('div', { style: 'padding:12px 0;border-bottom:2px solid var(--line)' },
    el('div', { style: 'display:flex;gap:8px;align-items:baseline;flex-wrap:wrap' },
      el('strong', { text: label }),
      el('span', { class: 'small muted', text: period }),
      el('span', { class: VERDICT_CLASS[entry.verdict] || 'badge', text: entry.verdict }),
    ),
    el('p', { style: 'margin:6px 0 0', text: entry.reason }),
  );
}

function renderAI(data) {
  const box = document.getElementById('ai-body');
  const ai = data.ai;

  // วิเคราะห์เฉพาะอันดับต้นเพื่อคุมค่าใช้จ่าย — บอกผู้ใช้ตรงๆ ดีกว่าซ่อนช่องว่างไว้เฉยๆ
  if (!ai) {
    replace(box, el('p', { class: 'muted', style: 'margin:0' },
      'ยังไม่มีบทวิเคราะห์สำหรับสินทรัพย์ตัวนี้ — ระบบวิเคราะห์เชิงลึกเฉพาะตัวที่ติดอันดับต้น '
      + 'ของแต่ละระยะในรอบล่าสุด เพื่อควบคุมค่าใช้จ่าย'));
    return;
  }

  const horizons = Object.keys(HORIZON_META)
    .filter((k) => ai.horizons?.[k])
    .map((k) => aiHorizonRow(k, ai.horizons[k]));

  replace(box,
    el('p', { class: 'small muted', style: 'margin:0 0 4px', text: 'สินทรัพย์นี้คืออะไร' }),
    el('p', { style: 'margin:0 0 16px', text: ai.business }),

    el('p', { style: 'margin:0 0 18px;font-size:1.05rem', text: ai.summary }),

    el('h2', { style: 'margin-bottom:0', text: 'แยกตามระยะการลงทุน' }),
    el('div', {}, horizons),

    ai.risks?.length
      ? el('div', { style: 'margin-top:18px' },
        el('h2', { style: 'margin-bottom:6px', text: 'ความเสี่ยงที่เห็นจากตัวเลข' }),
        el('ul', { style: 'margin:0;padding-left:20px' },
          ai.risks.map((r) => el('li', { style: 'margin:4px 0', text: r }))))
      : null,

    ai.jargon?.length
      ? el('div', { style: 'margin-top:18px' },
        el('h2', { style: 'margin-bottom:6px', text: 'ศัพท์ที่ใช้ในหน้านี้' }),
        el('div', {}, ai.jargon.map((j) => el('div', { class: 'small', style: 'margin:4px 0' },
          el('strong', { class: 'mono', text: j.term }), ' — ',
          el('span', { text: j.meaning })))))
      : null,

    el('p', {
      class: 'small muted',
      style: 'margin:18px 0 0;border-top:2px solid var(--line);padding-top:10px',
    },
    'คำอธิบายนี้เขียนโดย AI จากตัวเลขที่ระบบคำนวณไว้แล้ว ไม่ใช่คำแนะนำการลงทุน '
    + 'และไม่ได้พยากรณ์ราคาในอนาคต',
    // บทวิเคราะห์อัปเดตรายสัปดาห์ ส่วนตัวเลขอัปเดตรายวัน — ต้องบอกให้ชัดว่าคนละรอบกัน
    data.ai_generated_at
      ? el('span', { text: ` · เขียนเมื่อ ${thaiDateTime(data.ai_generated_at)} `
          + '(ตัวเลขในหน้านี้อัปเดตรายวัน บทวิเคราะห์อัปเดตรายสัปดาห์)' })
      : null),
  );
}

function renderFactors(data) {
  const rows = Object.entries(FACTOR_META).map(([key, [label, hint]]) => {
    const score = data[`score_${key}`];
    const coverage = data[`coverage_${key}`] ?? 0;
    const note = (score === null || score === undefined) && coverage === 0
      ? el('span', { class: 'small muted',
        text: 'ปัจจัยนี้ใช้ประเมินสินทรัพย์ประเภทนี้ไม่ได้ หรือไม่มีข้อมูล' })
      : null;
    return scoreRow(label, hint, score ?? null, note);
  });

  // คะแนนเทคนิคคำนวณจากราคาล้วน จึงมีเสมอไม่ว่าจะมีงบการเงินหรือไม่
  rows.push(scoreRow('สัญญาณทางเทคนิค',
    'แนวโน้ม เส้นค่าเฉลี่ย RSI และโมเมนตัมราคา', data.score_technical ?? null));

  replace(document.getElementById('factors'), rows);
}

function stat(label, valueNode, hint) {
  return el('div', { class: 'stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value mono' }, valueNode),
    hint ? el('div', { class: 'small muted', text: hint }) : null,
  );
}

function renderHeadline(data) {
  document.getElementById('title').textContent = data.symbol;
  document.getElementById('subtitle').textContent =
    `${data.name}${data.sector ? ' · ' + data.sector : ''}`;

  replace(document.getElementById('headline'),
    stat('ราคาล่าสุด', num(data.price, 2), data.currency || ''),
    stat('ผลตอบแทน 1 ปี', pct(data.ret_1y)),
    stat('ผลตอบแทน 3 เดือน', pct(data.ret_3m)),
    stat('ขาดทุนสูงสุด 3 ปี', pct(data.max_drawdown_3y),
      'ราคาเคยลงจากจุดสูงสุดมากที่สุดเท่าไร'),
  );
}

function renderFundamentals(data) {
  const marketCapText = data.market_cap
    ? `${(data.market_cap / 1e9).toLocaleString('th-TH', { maximumFractionDigits: 1 })} พันล้าน`
    : '—';

  replace(document.getElementById('fundamentals'),
    stat('P/E', data.trailing_pe ? num(data.trailing_pe, 1)
      : el('span', { class: 'muted', text: '—' }), 'ราคาต่อกำไรต่อหุ้น ยิ่งต่ำยิ่งถูก'),
    stat('P/BV', data.price_to_book ? num(data.price_to_book, 2)
      : el('span', { class: 'muted', text: '—' }), 'ราคาต่อมูลค่าทางบัญชี'),
    stat('ROE', data.roe !== null && data.roe !== undefined ? pctPlain(data.roe)
      : el('span', { class: 'muted', text: '—' }), 'ผลตอบแทนต่อส่วนของผู้ถือหุ้น'),
    stat('อัตราปันผล', pctPlain(data.dividend_yield), 'ต่อปี'),
    stat('อัตรากำไรสุทธิ', data.profit_margin !== null && data.profit_margin !== undefined
      ? pctPlain(data.profit_margin) : el('span', { class: 'muted', text: '—' }),
    'กำไรสุทธิต่อรายได้'),
    stat('การเติบโตของรายได้', data.revenue_growth !== null && data.revenue_growth !== undefined
      ? pct(data.revenue_growth) : el('span', { class: 'muted', text: '—' }), 'เทียบปีก่อน'),
    stat('จ่ายปันผลจากกำไร', data.payout_ratio !== null && data.payout_ratio !== undefined
      ? pctPlain(data.payout_ratio) : el('span', { class: 'muted', text: '—' }),
    'ไม่เกิน 70% ถือว่ายั่งยืน'),
    stat('มูลค่าตลาด', el('span', { text: marketCapText })),
  );
}

function renderTechnical(data) {
  replace(document.getElementById('technical'),
    stat('แนวโน้ม', trendBadge(data.trend), `ความชัดเจน ${data.trend_strength ?? 0}%`),
    stat('RSI (14 วัน)', data.rsi !== null && data.rsi !== undefined
      ? num(data.rsi, 1) : el('span', { class: 'muted', text: '—' }),
    'เกิน 70 = ซื้อมากไป, ต่ำกว่า 30 = ขายมากไป'),
    stat('ราคาเทียบเส้น 200 วัน', pct(data.price_vs_sma200),
      'เหนือเส้น = ขาขึ้นระยะยาว'),
    stat('ความผันผวนต่อปี', pctPlain(data.volatility),
      'ยิ่งสูงยิ่งแกว่งแรง'),
  );

  const fmtLevels = (values) => (values?.length
    ? values.map((v) => v.toLocaleString('th-TH', { maximumFractionDigits: 2 })).join('  ·  ')
    : 'ไม่พบระดับที่ชัดเจน');

  replace(document.getElementById('levels'),
    el('div', { class: 'grid grid-2' },
      el('div', { class: 'stat' },
        el('div', { class: 'label', text: 'แนวรับ (ราคาที่เคยมีแรงซื้อ)' }),
        el('div', { class: 'mono up', text: fmtLevels(data.support) })),
      el('div', { class: 'stat' },
        el('div', { class: 'label', text: 'แนวต้าน (ราคาที่เคยมีแรงขาย)' }),
        el('div', { class: 'mono down', text: fmtLevels(data.resistance) })),
    ));
}

/** วาดกราฟราคา 1 ปี ด้วยโมดูล SVG ที่เขียนเอง */
function renderChart(data) {
  const history = data.history || [];
  if (!history.length) return;

  document.getElementById('chart-range').textContent =
    `${history[0].d} → ${history[history.length - 1].d}`;
  lineChart(document.getElementById('chart'), history);
}

// ชื่อที่ Windows สงวนไว้ให้อุปกรณ์ — pipeline เติม _ ต่อท้ายให้ไฟล์สร้างได้
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * แปลงสัญลักษณ์เป็นชื่อไฟล์ที่ฝั่งเซิร์ฟเวอร์ใช้จริง (เช่น GC=F → GC_F, COM7 → COM7_)
 * ต้องตรงกับ safe_filename() ใน pipeline/main.py เสมอ
 */
function safeFilename(symbol) {
  const safe = symbol.replace(/[=/]/g, '_');
  return WINDOWS_RESERVED.has(safe.toUpperCase()) ? `${safe}_` : safe;
}

async function boot() {
  const symbol = new URLSearchParams(location.search).get('s');
  if (!symbol) {
    showError(new Error('ไม่ได้ระบุสินทรัพย์'));
    return;
  }

  let data;
  try {
    data = await api({ file: 'asset', symbol: safeFilename(symbol) });
  } catch (err) {
    showError(err);
    return;
  }

  document.title = `${data.symbol} — X32`;

  // ป้ายกำกับข้างชื่อ
  const badges = [marketBadge(data.market), qualityBadge(data.data_quality)]
    .filter(Boolean);
  if (badges.length) {
    document.getElementById('subtitle').after(
      el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, badges));
  }

  renderHeadline(data);
  renderAI(data);
  renderChart(data);
  renderHorizons(data);
  renderFactors(data);
  renderFundamentals(data);
  renderTechnical(data);

  document.getElementById('disclaimer').textContent =
    `${data.disclaimer}  (ข้อมูลอัปเดต ${thaiDateTime(data.generated_at)})`;
}

boot();
