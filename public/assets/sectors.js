/* ============================================================
   X32 — หน้าอุตสาหกรรมและธีม

   สองชั้นที่ต่างกันโดยตั้งใจ:
   1. ตารางภาพรวม — ตัวเลขล้วนที่ pipeline คำนวณ ใช้เทียบกลุ่มต่อกลุ่มได้ทันที
   2. บทวิเคราะห์ฉบับเต็ม — AI เขียนจากตัวเลขชุดเดียวกัน อ่านเพื่อเข้าใจ "ทำไม"

   ต้องแยกให้ผู้ใช้เห็นชัดว่าอันไหนเป็นข้อมูล อันไหนเป็นการตีความ
   ============================================================ */

import { api, showError } from './api.js';
import { el, replace } from './dom.js';
import { marketBadge, num, pct, pctPlain, scoreBar, thaiDateTime } from './format.js';

const KINDS = [
  { id: 'sector', label: 'อุตสาหกรรม' },
  { id: 'theme', label: 'ธีมการลงทุน' },
];

const REGIONS = [
  { id: 'all', label: 'ทั้งหมด', match: () => true },
  { id: 'TH', label: 'ในประเทศ', match: (g) => g.region === 'TH' || g.region === 'MIXED' },
  { id: 'FOREIGN', label: 'ต่างประเทศ', match: (g) => g.region === 'FOREIGN' || g.region === 'MIXED' },
];

const KIND_HELP = {
  sector: 'จัดกลุ่มตามการจัดประเภทมาตรฐานของข้อมูลต้นทาง แยกหุ้นไทยกับหุ้นต่างประเทศออกจากกัน '
        + 'เพราะอุตสาหกรรมเดียวกันในสองตลาดมีตัวขับเคลื่อนคนละอย่าง · '
        + 'ETF และทองไม่มีข้อมูลอุตสาหกรรมจึงไม่ปรากฏในมุมมองนี้',
  theme: 'ธีมคือรายชื่อที่ระบบจัดกลุ่มเอง ไม่ใช่การจัดประเภทมาตรฐาน — ใช้เมื่อแรงขับเคลื่อนเดียวกัน '
       + 'ดันหุ้นที่อยู่คนละอุตสาหกรรม เช่น AI ดันทั้งผู้ออกแบบชิปและผู้ผลิตแผงวงจร · '
       + 'หนึ่งบริษัทอยู่ได้หลายธีม',
};

const VERDICT_CLASS = {
  'โครงสร้างเติบโตชัด': 'badge badge-up',
  'เติบโตแต่ต้องเลือกตัว': 'badge badge-accent',
  'ทรงตัว/ตามวัฏจักร': 'badge',
  'เผชิญแรงกดดันเชิงโครงสร้าง': 'badge badge-down',
};

const state = { kind: 'sector', region: 'all', open: null };
let data = null;

/* ── ตารางภาพรวม ────────────────────────────────────────── */

function groupRow(group) {
  const s = group.stats;
  const verdict = group.ai?.verdict;

  return el('tr', {
    class: state.open === group.id ? 'row-open' : '',
    on: { click: () => { state.open = group.id; render(); scrollToArticle(); } },
  },
  el('td', {},
    el('strong', { text: group.label }),
    verdict ? el('div', {}, el('span', { class: VERDICT_CLASS[verdict] || 'badge', text: verdict })) : null,
    group.ai ? null : el('div', { class: 'muted small', text: 'ยังไม่มีบทวิเคราะห์' })),
  el('td', {}, group.region === 'MIXED'
    ? el('span', { class: 'badge', text: 'ไทย + ตปท.' })
    : marketBadge(group.region === 'TH' ? 'TH' : 'ตปท.')),
  el('td', { class: 'num mono', text: s.count }),
  el('td', { class: 'num' }, pct(s.median_ret_1m, 1)),
  el('td', { class: 'num' }, pct(s.median_ret_6m, 1)),
  el('td', { class: 'num' }, pct(s.median_ret_1y, 1)),
  el('td', { class: 'num' }, s.median_pe ? num(s.median_pe, 1) : el('span', { class: 'muted', text: '—' })),
  el('td', { class: 'num' }, pctPlain(s.median_dividend_yield)),
  el('td', { class: 'num mono', text: `${s.uptrend_count}/${s.count}` }),
  el('td', { class: 'num' }, scoreBar(s.median_mid_long)));
}

function visibleGroups() {
  const region = REGIONS.find((r) => r.id === state.region) || REGIONS[0];
  return (data.groups || [])
    .filter((g) => g.kind === state.kind && region.match(g))
    .sort((a, b) => (b.stats.median_mid_long || 0) - (a.stats.median_mid_long || 0));
}

function filterChip(label, count, selected, onClick, cls = 'chip') {
  return el('button', {
    class: cls,
    attrs: { type: 'button', role: 'tab', 'aria-selected': String(selected) },
    on: { click: onClick },
  },
  el('span', { text: label }),
  count === null ? null : el('span', { class: 'n', text: count }));
}

/* ── บทวิเคราะห์ฉบับเต็ม ────────────────────────────────── */

/** ย่อหน้ายาว — ใช้ text ผ่าน el() เสมอ จึงไม่มีทางที่ข้อความจาก AI จะกลายเป็น HTML */
const para = (text) => el('p', { class: 'read', text });

function pointList(points) {
  return el('div', { class: 'points' }, ...points.map((p) => el('div', { class: 'point' },
    el('h4', { text: p.title }),
    el('p', { class: 'read', text: p.detail }))));
}

function pickCard(pick, group) {
  const stats = (group.top || []).find((t) => t.symbol === pick.symbol);
  return el('div', { class: 'pick-card' },
    el('div', { class: 'pick-head' },
      el('a', { class: 'mono', href: `/asset.html?s=${encodeURIComponent(pick.symbol)}`, text: pick.symbol }),
      stats ? marketBadge(stats.market) : null,
      el('span', { class: 'muted small', text: pick.role })),
    stats ? el('div', { class: 'pick-stats mono small' },
      `คะแนนกลาง-ยาว ${stats.mid_long_score ?? '—'}`,
      ` · P/E ${stats.trailing_pe ? stats.trailing_pe.toFixed(1) : '—'}`,
      ` · ปันผล ${stats.dividend_yield ? (stats.dividend_yield * 100).toFixed(2) : '0.00'}%`,
      ` · 1 ปี ${stats.ret_1y !== null && stats.ret_1y !== undefined ? (stats.ret_1y * 100).toFixed(1) : '—'}%`) : null,
    el('p', { class: 'read', text: pick.why }));
}

function articleCard(group) {
  const ai = group.ai;

  if (!ai) {
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { text: group.label })),
      el('p', { class: 'read' },
        'กลุ่มนี้ยังไม่มีบทวิเคราะห์ — ตัวเลขในตารางด้านบนใช้ได้ตามปกติ '
        + 'บทวิเคราะห์จะถูกเขียนในรอบถัดไปที่ pipeline ทำงาน'));
  }

  const sections = [
    el('div', { class: 'card-head' },
      el('h2', { text: `${group.label} · ${group.region_label}` }),
      el('span', { class: VERDICT_CLASS[ai.verdict] || 'badge', text: ai.verdict })),
    el('p', { class: 'lead', text: ai.headline }),
  ];

  if (group.kind === 'theme' && group.rationale) {
    sections.push(el('div', { class: 'notice' },
      el('strong', { text: 'ทำไมหุ้นเหล่านี้ถึงถูกจัดอยู่ด้วยกัน · ' }),
      el('span', { text: group.rationale })));
  }

  sections.push(
    el('h3', { class: 'sec', text: 'กลุ่มนี้ทำอะไร' }), para(ai.what_is_it),
    el('h3', { class: 'sec', text: 'แรงขับเคลื่อนการเติบโต' }), pointList(ai.growth_drivers || []),
    el('h3', { class: 'sec', text: 'มุมมองระยะกลางถึงยาว' }), para(ai.structural_view),
    el('h3', { class: 'sec', text: 'ตอนนี้อยู่ช่วงไหนของวัฏจักร' }), para(ai.cycle_position),
    el('h3', { class: 'sec', text: 'หุ้นเด่นของกลุ่ม และเด่นเพราะอะไร' }),
    el('div', { class: 'picks' }, ...(ai.top_picks || []).map((p) => pickCard(p, group))),
    el('h3', { class: 'sec', text: 'ความเสี่ยงที่จะทำให้ภาพนี้ไม่เป็นจริง' }), pointList(ai.risks || []),
    el('h3', { class: 'sec', text: 'สัญญาณที่ควรตามดู' }),
    el('ul', { class: 'read' }, ...(ai.watch_signals || []).map((s) => el('li', { text: s }))),
    el('h3', { class: 'sec', text: 'เหมาะกับใคร' }), para(ai.who_fits),
  );

  if (ai.jargon?.length) {
    sections.push(
      el('h3', { class: 'sec', text: 'ศัพท์ที่ใช้ในบทความนี้' }),
      el('dl', { class: 'jargon' }, ...ai.jargon.flatMap((j) => [
        el('dt', { text: j.term }), el('dd', { text: j.meaning }),
      ])));
  }

  sections.push(el('p', { class: 'muted small', style: 'margin-top:22px' },
    `สมาชิกทั้งหมดในกลุ่ม (${group.members.length} ตัว): ${group.members.join(' · ')}`));

  return el('div', { class: 'card article' }, ...sections);
}

function scrollToArticle() {
  document.getElementById('article').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── วาดหน้า ────────────────────────────────────────────── */

function render() {
  const all = data.groups || [];

  replace(document.getElementById('kind-tabs'), KINDS.map((k) => filterChip(
    k.label, all.filter((g) => g.kind === k.id).length, state.kind === k.id,
    () => { state.kind = k.id; state.open = null; render(); }, 'tab',
  )));

  replace(document.getElementById('region-chips'), REGIONS.map((r) => filterChip(
    r.label, all.filter((g) => g.kind === state.kind && r.match(g)).length,
    state.region === r.id,
    () => { state.region = r.id; render(); },
  )));

  document.getElementById('kind-help').textContent = KIND_HELP[state.kind];

  const groups = visibleGroups();
  document.getElementById('group-count').textContent = `${groups.length} กลุ่ม`;

  replace(document.getElementById('group-rows'), groups.length
    ? groups.map(groupRow)
    : el('tr', {}, el('td', {
      class: 'skeleton', attrs: { colspan: 10 },
      text: 'ไม่มีกลุ่มในเงื่อนไขที่เลือก',
    })));

  const open = groups.find((g) => g.id === state.open);
  replace(document.getElementById('article'), open
    ? articleCard(open)
    : el('p', { class: 'muted small', text: '↑ คลิกที่แถวใดก็ได้เพื่ออ่านบทวิเคราะห์ฉบับเต็มของกลุ่มนั้น' }));
}

async function boot() {
  try {
    data = await api({ file: 'sectors' });
  } catch (err) {
    showError(err);
    return;
  }

  const stamp = data.ai_generated_at
    ? `ตัวเลข ณ ${thaiDateTime(data.generated_at)} · บทวิเคราะห์เขียนเมื่อ ${thaiDateTime(data.ai_generated_at)}`
    : `ตัวเลข ณ ${thaiDateTime(data.generated_at)} · ยังไม่มีบทวิเคราะห์`;
  document.getElementById('updated').textContent = stamp;
  document.getElementById('ai-note').textContent = data.ai_note || '';
  document.getElementById('disclaimer').textContent = data.disclaimer || '';

  render();
}

boot();
