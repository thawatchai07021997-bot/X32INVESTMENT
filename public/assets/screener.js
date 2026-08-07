/* ============================================================
   X32 — หน้าคัดกรองสินทรัพย์ทั้งหมด
   กรองและเรียงลำดับฝั่งเบราว์เซอร์ทั้งหมด (ข้อมูล ~150 ตัว เร็วพอ
   และไม่ต้องเรียกเซิร์ฟเวอร์ซ้ำทุกครั้งที่เปลี่ยนตัวกรอง)
   ============================================================ */

import { api, showError } from './api.js';
import { el, replace } from './dom.js';
import {
  assetLink, marketBadge, num, pct, pctPlain, qualityBadge, thaiDateTime, trendBadge,
} from './format.js';

/** นิยามคอลัมน์: key ใช้เรียงลำดับ, render สร้าง cell */
const COLUMNS = [
  { key: 'symbol', label: 'สินทรัพย์', numeric: false },
  { key: 'market', label: 'ตลาด', numeric: false },
  { key: 'price', label: 'ราคา', numeric: true },
  { key: 'ret_1m', label: '1 เดือน', numeric: true },
  { key: 'ret_6m', label: '6 เดือน', numeric: true },
  { key: 'ret_1y', label: '1 ปี', numeric: true },
  { key: 'dividend_yield', label: 'ปันผล', numeric: true },
  { key: 'trailing_pe', label: 'P/E', numeric: true },
  { key: 'score_quality', label: 'คุณภาพ', numeric: true },
  { key: 'score_value', label: 'ความถูก', numeric: true },
  { key: 'score_technical', label: 'เทคนิค', numeric: true },
];

const FILTERS = {
  market: [['', 'ทั้งหมด'], ['TH', 'ไทย'], ['US', 'สหรัฐฯ'], ['GLOBAL', 'ทั่วโลก']],
  class: [['', 'ทั้งหมด'], ['stock', 'หุ้นรายตัว'], ['etf', 'ETF'], ['gold', 'ทองคำ']],
  trend: [['', 'ทั้งหมด'], ['uptrend', 'ขาขึ้น'], ['sideways', 'ออกข้าง'], ['downtrend', 'ขาลง']],
  return: [['', 'ไม่กำหนด'], ['0', 'มากกว่า 0%'], ['0.1', 'ตั้งแต่ 10%'],
    ['0.2', 'ตั้งแต่ 20%'], ['0.5', 'ตั้งแต่ 50%']],
};

let allAssets = [];
let sortKey = 'ret_1y';
let sortDescending = true;

function fillSelect(id, options) {
  replace(document.getElementById(id),
    options.map(([value, label]) => el('option', { text: label, attrs: { value } })));
}

/** คืนรายการที่ผ่านตัวกรองทั้งหมด */
function applyFilters() {
  const market = document.getElementById('f-market').value;
  const assetClass = document.getElementById('f-class').value;
  const trend = document.getElementById('f-trend').value;
  const minReturn = document.getElementById('f-return').value;
  const query = document.getElementById('f-search').value.trim().toLowerCase();

  return allAssets.filter((a) => {
    if (market && a.market !== market) return false;
    if (assetClass && a.asset_class !== assetClass) return false;
    if (trend && a.trend !== trend) return false;
    if (minReturn !== '' && !(a.ret_1y !== null && a.ret_1y >= Number(minReturn))) return false;
    if (query) {
      const haystack = `${a.symbol} ${a.name || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function sortAssets(items) {
  const column = COLUMNS.find((c) => c.key === sortKey);
  return [...items].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    // ค่าที่ไม่มีข้อมูลไปอยู่ท้ายเสมอ ไม่ว่าจะเรียงทางไหน
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const diff = column?.numeric ? va - vb : String(va).localeCompare(String(vb));
    return sortDescending ? -diff : diff;
  });
}

function renderHead() {
  replace(document.getElementById('head-row'), COLUMNS.map((col) => {
    const active = col.key === sortKey;
    return el('th', {
      style: 'cursor:pointer;user-select:none',
      title: 'คลิกเพื่อเรียงลำดับ',
      text: `${col.label}${active ? (sortDescending ? ' ▼' : ' ▲') : ''}`,
      on: {
        click: () => {
          if (sortKey === col.key) {
            sortDescending = !sortDescending;
          } else {
            sortKey = col.key;
            sortDescending = col.numeric;   // ตัวเลขเริ่มจากมากไปน้อย
          }
          render();
        },
      },
    });
  }));
}

function assetRow(item) {
  const cell = (node, cls = 'num') => el('td', { class: cls }, node);
  const dash = () => el('span', { class: 'muted', text: '—' });

  return el('tr', { on: { click: () => { location.href = assetLink(item.symbol); } } },
    el('td', {},
      el('strong', { class: 'mono', text: item.symbol }), ' ',
      qualityBadge(item.data_quality),
      el('div', { class: 'small muted', text: (item.name || '').slice(0, 40) })),
    el('td', {}, marketBadge(item.market)),
    cell(num(item.price, 2)),
    cell(pct(item.ret_1m)),
    cell(pct(item.ret_6m)),
    cell(pct(item.ret_1y)),
    cell(pctPlain(item.dividend_yield)),
    cell(item.trailing_pe ? num(item.trailing_pe, 1) : dash()),
    cell(item.score_quality !== null && item.score_quality !== undefined
      ? num(item.score_quality, 0) : dash()),
    cell(item.score_value !== null && item.score_value !== undefined
      ? num(item.score_value, 0) : dash()),
    cell(item.score_technical !== null && item.score_technical !== undefined
      ? num(item.score_technical, 0) : dash()),
  );
}

function render() {
  const filtered = sortAssets(applyFilters());
  document.getElementById('result-count').textContent = `${filtered.length} รายการ`;
  renderHead();

  const tbody = document.getElementById('rows');
  replace(tbody, filtered.length
    ? filtered.map(assetRow)
    : el('tr', {}, el('td', {
      class: 'skeleton', text: 'ไม่พบสินทรัพย์ที่ตรงกับเงื่อนไข',
      attrs: { colspan: COLUMNS.length },
    })));
}

async function boot() {
  let data;
  try {
    data = await api({ file: 'dashboard' });
  } catch (err) {
    showError(err);
    return;
  }

  allAssets = data.all_assets || [];
  document.getElementById('updated').textContent =
    `อัปเดตล่าสุด ${thaiDateTime(data.generated_at)} · ${allAssets.length} สินทรัพย์`;
  document.getElementById('disclaimer').textContent = data.disclaimer;

  fillSelect('f-market', FILTERS.market);
  fillSelect('f-class', FILTERS.class);
  fillSelect('f-trend', FILTERS.trend);
  fillSelect('f-return', FILTERS.return);

  for (const id of ['f-market', 'f-class', 'f-trend', 'f-return']) {
    document.getElementById(id).addEventListener('change', render);
  }
  document.getElementById('f-search').addEventListener('input', render);

  render();
}

boot();
