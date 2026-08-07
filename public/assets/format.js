/* ============================================================
   การจัดรูปแบบตัวเลขและป้ายกำกับ — คืนค่าเป็น DOM node เสมอ
   ============================================================ */

import { el } from './dom.js';

const DASH = () => el('span', { class: 'muted', text: '—' });

/** เปอร์เซ็นต์พร้อมสีและเครื่องหมาย เช่น 0.1234 → +12.34% (เขียว) */
export function pct(value, digits = 2) {
  if (value === null || value === undefined) return DASH();
  const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
  const sign = value > 0 ? '+' : '';
  return el('span', { class: cls, text: `${sign}${(value * 100).toFixed(digits)}%` });
}

/** เปอร์เซ็นต์แบบไม่ใส่สี ใช้กับค่าที่ไม่มีทิศทาง เช่น อัตราปันผล */
export function pctPlain(value, digits = 2) {
  if (value === null || value === undefined) return DASH();
  return el('span', { text: `${(value * 100).toFixed(digits)}%` });
}

export function num(value, digits = 2) {
  if (value === null || value === undefined) return DASH();
  return el('span', {
    text: value.toLocaleString('th-TH', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }),
  });
}

/** ย่อมูลค่าตลาดให้อ่านง่าย เช่น 3.2 ล้านล้าน */
export function marketCap(value) {
  if (!value) return DASH();
  for (const [size, label] of [[1e12, 'ล้านล้าน'], [1e9, 'พันล้าน'], [1e6, 'ล้าน']]) {
    if (value >= size) return el('span', { text: `${(value / size).toFixed(1)} ${label}` });
  }
  return num(value, 0);
}

export function trendBadge(trend) {
  const map = {
    uptrend: ['badge badge-up', 'ขาขึ้น'],
    downtrend: ['badge badge-down', 'ขาลง'],
    sideways: ['badge', 'ออกข้าง'],
  };
  const [cls, label] = map[trend] || ['badge', '—'];
  return el('span', { class: cls, text: label });
}

/** ป้ายบอกความครบถ้วนของข้อมูล — ผู้ใช้ควรรู้ว่าคะแนนคิดจากข้อมูลแค่ไหน */
export function qualityBadge(quality) {
  if (quality === 'partial') {
    return el('span', {
      class: 'badge badge-warn', text: 'ข้อมูลบางส่วน',
      title: 'ข้อมูลงบการเงินไม่ครบทุกด้าน',
    });
  }
  if (quality === 'technical_only') {
    return el('span', {
      class: 'badge badge-warn', text: 'เทคนิคล้วน',
      title: 'ไม่มีข้อมูลงบการเงิน วิเคราะห์จากราคาเท่านั้น',
    });
  }
  return null;
}

export function marketBadge(market) {
  return market === 'TH'
    ? el('span', { class: 'badge badge-th', text: 'ไทย' })
    : el('span', { class: 'badge', text: market || '—' });
}

/** แถบคะแนน 0-100 ที่มองเห็นสัดส่วนได้ทันที */
export function scoreBar(score) {
  if (score === null || score === undefined) return DASH();
  const width = Math.max(0, Math.min(100, score));
  return el('span', {},
    el('span', { class: 'mono', text: score.toFixed(0) }),
    el('span', { class: 'bar' }, el('i', { style: `width:${width}%` })),
  );
}

export function assetLink(symbol) {
  return `/asset.html?s=${encodeURIComponent(symbol)}`;
}

export function thaiDateTime(value, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', opts);
}
