/* ============================================================
   X32 — หน้า Dashboard
   ============================================================ */

import { api, showError } from './api.js';
import { el, replace } from './dom.js';
import {
  assetLink, marketBadge, num, pct, pctPlain, qualityBadge,
  scoreBar, thaiDateTime, trendBadge,
} from './format.js';

const HORIZON_ORDER = ['short', 'mid', 'long', 'dividend'];

/* กลุ่มสินทรัพย์ที่กดเลือกได้ — นิยามให้ตรงกับ universe ใน pipeline/config.py
   เพิ่มกลุ่มใหม่ที่นี่ที่เดียว ส่วนที่เหลือของหน้าจะปรับตามเอง */
const GROUPS = [
  { id: 'all', label: 'ทั้งหมด', match: () => true },
  { id: 'th', label: 'หุ้นไทย', match: (a) => a.asset_class === 'stock' && a.market === 'TH' },
  { id: 'us', label: 'หุ้น US', match: (a) => a.asset_class === 'stock' && a.market === 'US' },
  { id: 'etf', label: 'ETF', match: (a) => a.asset_class === 'etf' },
  { id: 'gold', label: 'ทอง', match: (a) => a.asset_class === 'gold' },
];

/* yfinance คืนชื่ออุตสาหกรรมเป็นภาษาอังกฤษ — แปลให้อ่านง่าย
   ชื่อที่ไม่มีในตารางจะแสดงตามต้นฉบับ ไม่หายไปจากตัวกรอง */
const SECTOR_TH = {
  'Technology': 'เทคโนโลยี',
  'Financial Services': 'การเงิน/ธนาคาร',
  'Healthcare': 'การแพทย์',
  'Industrials': 'อุตสาหกรรม',
  'Consumer Cyclical': 'สินค้าฟุ่มเฟือย',
  'Consumer Defensive': 'สินค้าจำเป็น',
  'Energy': 'พลังงาน',
  'Utilities': 'สาธารณูปโภค',
  'Real Estate': 'อสังหาริมทรัพย์',
  'Communication Services': 'สื่อสาร',
  'Basic Materials': 'วัตถุดิบ',
};

/* กลุ่มที่มีสมาชิกน้อยกว่านี้ อันดับแทบไม่มีความหมาย — เตือนผู้ใช้แต่ยังแสดงให้ดู */
const SMALL_GROUP_WARN = 5;

const HORIZON_HELP = {
  short: 'จัดอันดับจากโมเมนตัมราคาและสัญญาณทางเทคนิค เหมาะกับการถือระยะสั้นและต้องติดตามใกล้ชิด ' +
         'ระยะนี้ไม่ได้ดูว่าราคาถูกหรือแพงเทียบมูลค่ากิจการ',
  mid: 'ผสมระหว่างโมเมนตัมราคา คุณภาพกิจการ และความถูกของราคา ' +
       'เป็นจุดสมดุลระหว่างจังหวะเข้าซื้อกับพื้นฐานของกิจการ',
  long: 'เน้นคุณภาพกิจการและความถูกของราคาเป็นหลัก บวกน้ำหนักการเติบโตเล็กน้อย ' +
        'เพื่อไม่ให้สินทรัพย์ที่ราคาไม่โตแต่จ่ายปันผลสม่ำเสมอขึ้นอันดับต้นโดยไม่สมเหตุผล',
  dividend: 'เน้นอัตราปันผลและความยั่งยืนของการจ่าย (จ่ายไม่เกิน 70% ของกำไรถือว่ายั่งยืน)',
};

/* ── ส่วนแสดงผลย่อย ─────────────────────────────────────── */

function renderTicker(benchmarks) {
  const box = document.getElementById('ticker');
  if (!benchmarks?.length) {
    replace(box, el('div', { class: 'skeleton', text: 'ไม่มีข้อมูลดัชนี' }));
    return;
  }
  replace(box, benchmarks.map((b) => el('div', {},
    el('div', { class: 'name', text: b.name }),
    el('div', { class: 'px' }, num(b.price, 2)),
    el('div', { class: 'small mono' }, pct(b.change_1d),
      el('span', { class: 'muted', text: ' วันนี้' })),
  )));
}

function statCard(label, valueNode, extra) {
  return el('div', { class: 'stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value mono' }, valueNode,
      extra ? el('span', { class: 'small muted', text: ` ${extra}` }) : null),
  );
}

function renderSummary(summary, generatedAt) {
  document.getElementById('updated').textContent =
    `อัปเดตล่าสุด ${thaiDateTime(generatedAt)}`;

  const target = (summary.target_threshold * 100).toFixed(0);
  replace(document.getElementById('summary'),
    statCard('สินทรัพย์ที่ติดตาม', el('span', { text: summary.total_assets })),
    statCard(`ผลตอบแทน 1 ปี ≥ ${target}%`,
      el('span', { text: summary.meets_target_1y }), `(${summary.meets_target_pct}%)`),
    statCard('อยู่ในแนวโน้มขาขึ้น',
      el('span', { class: 'up', text: summary.uptrend_count }), `(${summary.uptrend_pct}%)`),
    statCard('มีข้อมูลงบการเงินครบ',
      el('span', { text: summary.full_fundamental_data })),
  );
}

function renderGold(gold) {
  if (!gold) return;
  document.getElementById('gold-card').hidden = false;

  const stamp = document.getElementById('gold-updated');
  stamp.textContent = thaiDateTime(gold.updated_at, { dateStyle: 'short', timeStyle: 'short' });
  // ราคาทองดึงจากสมาคมค้าทองคำซึ่งล้มเหลวชั่วคราวได้ ต้องบอกผู้ใช้เมื่อเป็นค่าเก่า
  stamp.className = gold.is_stale ? 'badge badge-warn' : 'badge';
  if (gold.is_stale) stamp.textContent += ' · ข้อมูลจากรอบก่อน';

  const change = gold.change_from_prev_day;
  const changeNode = el('span', {
    class: change > 0 ? 'up' : change < 0 ? 'down' : '',
    text: `${change > 0 ? '+' : ''}${(change ?? 0).toLocaleString('th-TH')}`,
  });

  replace(document.getElementById('gold-body'),
    statCard('ทองแท่ง — รับซื้อ', num(gold.bar_buy, 0)),
    statCard('ทองแท่ง — ขายออก', num(gold.bar_sell, 0)),
    statCard('เปลี่ยนแปลงจากวันก่อน', changeNode),
    statCard('ทองโลก (USD/ออนซ์)', num(gold.gold_spot_usd, 2)),
  );

  document.getElementById('gold-source').textContent =
    `${gold.unit} · ที่มา: ${gold.source}`;
}

function horizonRow(item, index, horizon) {
  const hs = item.horizon_scores?.[horizon] || {};
  const confidence = hs.confidence ?? 1;

  // ความมั่นใจต่ำ = คะแนนคิดจากข้อมูลไม่ครบทุกด้าน ต้องบอกผู้ใช้ให้เห็น
  const confidenceBadge = confidence < 0.8
    ? el('span', {
      class: 'badge badge-warn',
      text: `ข้อมูล ${Math.round(confidence * 100)}%`,
      title: `คะแนนนี้คำนวณจากข้อมูล ${Math.round(confidence * 100)}% ของที่ควรมีครบ`,
    })
    : null;

  return el('tr', { on: { click: () => { location.href = assetLink(item.symbol); } } },
    el('td', { class: 'rank', text: index + 1 }),
    el('td', {},
      el('strong', { class: 'mono', text: item.symbol }), ' ',
      qualityBadge(item.data_quality), ' ', confidenceBadge,
      el('div', { class: 'small muted', text: (item.name || '').slice(0, 44) }),
    ),
    el('td', {}, marketBadge(item.market)),
    el('td', { class: 'num' }, num(item.price, 2)),
    el('td', { class: 'num' }, pct(item.ret_1m)),
    el('td', { class: 'num' }, pct(item.ret_1y)),
    el('td', { class: 'num' }, pctPlain(item.dividend_yield)),
    el('td', { class: 'num' }, item.trailing_pe ? num(item.trailing_pe, 1)
      : el('span', { class: 'muted', text: '—' })),
    el('td', {}, trendBadge(item.trend)),
    el('td', { class: 'num' }, scoreBar(hs.score)),
  );
}

function renderHorizonTable(items, horizon) {
  const tbody = document.getElementById('horizon-rows');
  if (!items?.length) {
    replace(tbody, el('tr', {}, el('td', {
      class: 'skeleton', text: 'ไม่มีสินทรัพย์ผ่านเกณฑ์ในระยะนี้',
      attrs: { colspan: 10 },
    })));
    return;
  }
  replace(tbody, items.map((item, i) => horizonRow(item, i, horizon)));
}

function moverRow(item) {
  return el('div', {
    style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;'
         + 'border-bottom:2px solid var(--line);cursor:pointer',
    on: { click: () => { location.href = assetLink(item.symbol); } },
  },
  el('span', {},
    el('strong', { class: 'mono', text: item.symbol }), ' ',
    el('span', { class: 'small muted', text: (item.name || '').slice(0, 26) })),
  el('span', { class: 'mono' }, pct(item.ret_1w, 1)),
  );
}

function renderMovers(movers) {
  const fill = (id, items) => {
    const box = document.getElementById(id);
    replace(box, items?.length
      ? items.map(moverRow)
      : el('p', { class: 'muted small', text: 'ไม่มีข้อมูล' }));
  };
  fill('gainers', movers.gainers);
  fill('losers', movers.losers);
}

/* ── การกรองและจัดอันดับฝั่งหน้าเว็บ ─────────────────────── */

/* จัดอันดับสินทรัพย์ชุดหนึ่งตามระยะที่เลือก
   ใช้เกณฑ์ชุดเดียวกับ pipeline/quant/screener.py ที่ส่งมาใน data.screening
   เพื่อให้ผล "ทั้งหมด / ทุกอุตสาหกรรม" ตรงกับที่ pipeline คำนวณไว้เป๊ะ */
function rankAssets(assets, horizon, screening) {
  const minConfidence = screening?.min_confidence ?? 0.5;
  const minDividend = screening?.min_dividend_yield ?? 0;
  const topN = screening?.top_n ?? 10;

  // นับแยกว่าตัวที่หายไปถูกตัดด้วยเหตุใด เพื่อให้คำอธิบายใต้ตารางตรงความจริง
  let lowDividend = 0;

  const eligible = assets.filter((a) => {
    const hs = a.horizon_scores?.[horizon];
    if (!hs || hs.score === null || hs.score === undefined) return false;
    if ((hs.confidence ?? 0) < minConfidence) return false;
    // ระยะปันผลต้องจ่ายปันผลจริงถึงเกณฑ์ — ตรงกับ screener.qualifies() ฝั่ง Python
    if (horizon === 'dividend' && (a.dividend_yield ?? 0) < minDividend) {
      lowDividend += 1;
      return false;
    }
    return true;
  });
  eligible.sort((a, b) => b.horizon_scores[horizon].score - a.horizon_scores[horizon].score);

  return { items: eligible.slice(0, topN), eligibleCount: eligible.length, lowDividend };
}

/* นับจำนวนสินทรัพย์ในแต่ละอุตสาหกรรม เรียงจากมากไปน้อย
   ETF และทองไม่มีข้อมูล sector จึงถูกข้ามไปโดยปริยาย */
function sectorCounts(assets) {
  const counts = new Map();
  for (const a of assets) {
    const s = a.sector;
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]);
}

function filterChip(label, count, selected, onClick, cls = 'chip') {
  return el('button', {
    class: cls,
    attrs: { role: 'tab', 'aria-selected': String(selected) },
    on: { click: onClick },
  },
  el('span', { text: label }),
  count === null ? null : el('span', { class: 'n', text: count }),
  );
}

/* ── จุดเริ่มของหน้า ─────────────────────────────────────── */

async function boot() {
  let data;
  try {
    data = await api({ file: 'dashboard' });
  } catch (err) {
    showError(err);
    return;
  }

  if (data.is_stale) {
    const notice = document.getElementById('notice');
    notice.hidden = false;
    notice.textContent = `⚠ ${data.stale_note}`;
  }

  renderSummary(data.summary, data.generated_at);
  renderTicker(data.benchmarks);
  renderGold(data.thai_gold);
  renderMovers(data.movers || {});
  document.getElementById('disclaimer').textContent = data.disclaimer;

  const tabs = document.getElementById('tabs');
  const groupTabs = document.getElementById('group-tabs');
  const sectorRow = document.getElementById('sector-row');
  const sectorChips = document.getElementById('sector-chips');
  const help = document.getElementById('horizon-help');
  const count = document.getElementById('horizon-count');
  const note = document.getElementById('scope-note');

  // เริ่มที่ระยะกลาง — สมดุลที่สุดสำหรับผู้เริ่มต้น
  const state = { group: 'all', sector: 'all', horizon: 'mid' };
  const assets = data.all_assets || [];

  const groupAssets = () => {
    const g = GROUPS.find((x) => x.id === state.group) || GROUPS[0];
    return assets.filter(g.match);
  };

  const scopedAssets = () => {
    const inGroup = groupAssets();
    return state.sector === 'all'
      ? inGroup
      : inGroup.filter((a) => a.sector === state.sector);
  };

  function renderGroupTabs() {
    replace(groupTabs, GROUPS.map((g) => filterChip(
      g.label, assets.filter(g.match).length, state.group === g.id,
      () => {
        state.group = g.id;
        state.sector = 'all';   // อุตสาหกรรมที่เลือกไว้อาจไม่มีอยู่ในกลุ่มใหม่
        render();
      },
      'tab',
    )));
  }

  function renderSectorChips() {
    const inGroup = groupAssets();
    const pairs = sectorCounts(inGroup);

    // ETF และทองไม่มีข้อมูลอุตสาหกรรม — ซ่อนทั้งแถวแทนการแสดงแถวเปล่า
    sectorRow.hidden = pairs.length === 0;
    if (!pairs.length) return;

    replace(sectorChips, [
      filterChip('ทุกอุตสาหกรรม', inGroup.length, state.sector === 'all',
        () => { state.sector = 'all'; render(); }),
      ...pairs.map(([sector, n]) => filterChip(
        SECTOR_TH[sector] || sector, n, state.sector === sector,
        () => { state.sector = sector; render(); },
      )),
    ]);
  }

  function renderHorizonTabs() {
    replace(tabs, HORIZON_ORDER
      .filter((h) => data.horizons[h])
      .map((h) => filterChip(
        data.horizons[h].label, null, state.horizon === h,
        () => { state.horizon = h; render(); },
        'tab',
      )));
  }

  /* บอกผู้ใช้เมื่อขอบเขตที่เลือกทำให้อันดับตีความต่างจากปกติ */
  function renderScopeNote(scope, { eligibleCount: eligible, lowDividend }) {
    const parts = [];
    const divPct = ((data.screening?.min_dividend_yield ?? 0) * 100).toFixed(1);

    if (eligible === 0) {
      if (lowDividend > 0) {
        // ทั้งกลุ่มจ่ายปันผลต่ำกว่าเกณฑ์ — พบกับกลุ่มเทคโนโลยีที่เน้นเติบโต
        parts.push(`ไม่มีสินทรัพย์ในขอบเขตนี้ที่จ่ายปันผลถึง ${divPct}% `
                 + '— กลุ่มนี้เน้นการเติบโตมากกว่าการจ่ายปันผล');
      } else {
        // เกิดกับทองและ ETF บางตัวที่ไม่มีงบการเงิน จึงให้คะแนนระยะที่ต้อง
        // ใช้คุณภาพกิจการไม่ได้ — ต้องชี้ทางออกให้ ไม่ใช่ปล่อยตารางว่าง
        const usable = HORIZON_ORDER.filter((h) => h !== state.horizon
          && rankAssets(scope, h, data.screening).eligibleCount > 0);
        const hint = usable.length
          ? ` — ลองดู "${data.horizons[usable[0]].label}" ที่ใช้ข้อมูลคนละชุด`
          : '';
        parts.push('สินทรัพย์ในขอบเขตนี้ไม่มีข้อมูลพอให้คะแนนระยะนี้ '
                 + `(พบบ่อยกับทองและ ETF ที่ไม่มีงบการเงินให้วิเคราะห์)${hint}`);
      }
    } else {
      const dropped = scope.length - eligible;
      if (dropped > 0) {
        const reasons = [];
        if (lowDividend > 0) reasons.push(`${lowDividend} ตัวจ่ายปันผลไม่ถึง ${divPct}%`);
        if (dropped - lowDividend > 0) {
          reasons.push(`${dropped - lowDividend} ตัวข้อมูลไม่พอให้คะแนนระยะนี้`);
        }
        parts.push(`แสดง ${eligible} ตัวจากทั้งหมด ${scope.length} ตัวในขอบเขตนี้ `
                 + `— ตัดออก ${reasons.join(' และ ')}`);
      }
      if (eligible < SMALL_GROUP_WARN) {
        parts.push(`ขอบเขตนี้มีเพียง ${eligible} ตัว — อันดับบอกได้แค่ว่าตัวไหนดีกว่ากันเอง `
                 + 'ไม่ได้แปลว่าน่าลงทุนกว่าสินทรัพย์นอกกลุ่ม');
      }
    }

    note.hidden = parts.length === 0;
    note.textContent = parts.length ? `※ ${parts.join(' · ')}` : '';
    note.style.color = eligible < SMALL_GROUP_WARN ? 'var(--accent)' : 'var(--muted)';
  }

  function render() {
    renderGroupTabs();
    renderSectorChips();
    renderHorizonTabs();

    const scope = scopedAssets();
    const result = rankAssets(scope, state.horizon, data.screening);
    const { items } = result;

    // ต่อท้ายเกณฑ์ปันผลขั้นต่ำจากข้อมูลจริง ไม่เขียนตัวเลขทับใน HORIZON_HELP
    // ผู้ใช้จะได้รู้ว่าทำไมหุ้นคุณภาพดีบางตัวไม่โผล่ในระยะนี้
    const minDiv = data.screening?.min_dividend_yield;
    help.textContent = (HORIZON_HELP[state.horizon] || '')
      + (state.horizon === 'dividend' && minDiv
        ? ` และคัดเฉพาะตัวที่จ่ายปันผลจริงตั้งแต่ ${(minDiv * 100).toFixed(1)}% ขึ้นไป`
        : '');
    count.textContent = `${items.length} อันดับ`;
    renderHorizonTable(items, state.horizon);
    renderScopeNote(scope, result);
  }

  render();
}

boot();
