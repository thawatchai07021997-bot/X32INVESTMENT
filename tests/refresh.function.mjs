/**
 * ทดสอบ functions/refresh.js ตัวจริง — ยิงแหล่งข้อมูลจริงด้วย ticker ทั้ง 146 ตัว
 *
 * ต้องรันด้วย: node --experimental-test-module-mocks tests/refresh.function.mjs
 * (ใช้ mock.module แทน @netlify/blobs กับ ./_auth.js เพื่อไม่ต้องมี Netlify runtime)
 *
 * เหตุผลที่ต้องมี: Netlify คิดเงินเป็นเครดิตและ deploy ครั้งละ 15 เครดิต
 * การ deploy ไปแก้บั๊กที่จับได้ในเครื่องจึงแพงจริง ไม่ใช่แค่เสียเวลา
 */

import { mock } from 'node:test';
import { readFileSync } from 'node:fs';

// ── Blobs ปลอม ที่จำค่าไว้ในหน่วยความจำ ─────────────────────
const blobs = new Map();
let blobReads = [];
mock.module('@netlify/blobs', {
  namedExports: {
    getStore: () => ({
      async get(key, opts) {
        blobReads.push({ key, opts });
        const raw = blobs.get(key);
        if (raw === undefined) return null;
        return opts?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async setJSON(key, value) { blobs.set(key, JSON.stringify(value)); },
    }),
  },
});

// ── auth ปลอม ที่สลับให้ผ่าน/ไม่ผ่านได้ ─────────────────────
let authPasses = true;
mock.module(new URL('../functions/_auth.js', import.meta.url).href, {
  namedExports: {
    requireAuth: () => (authPasses ? null : new Response(
      JSON.stringify({ error: 'ต้องเข้าสู่ระบบก่อน' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )),
    json: (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  },
});

const { default: handler } = await import('../functions/refresh.js');

const post = (body) => new Request('https://x32.test/api/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ได้ ${JSON.stringify(got)} คาด ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ── 1) เส้นทางที่ต้องปฏิเสธ ──────────────────────────────────
check('GET → 405',
  (await handler(new Request('https://x32.test/api/refresh'))).status, 405);

authPasses = false;
check('ไม่ได้ล็อกอิน → 401', (await handler(post({ symbols: ['AAPL'] }))).status, 401);
authPasses = true;

check('ไม่ส่ง symbols → 400', (await handler(post({}))).status, 400);
check('symbols ว่าง → 400', (await handler(post({ symbols: [] }))).status, 400);
check('symbols รูปแบบผิดล้วน → 400',
  (await handler(post({ symbols: ['<script>', 'a b c', '../../etc/passwd', 'x'.repeat(40)] }))).status, 400);

// ── 2) ยิงจริงด้วย ticker ทั้ง universe ──────────────────────
const tickers = JSON.parse(readFileSync(
  new URL('./fixtures/tickers.json', import.meta.url), 'utf-8'));
console.log(`\nยิงจริง ${tickers.length} ticker …`);

const t0 = Date.now();
const res = await handler(post({ symbols: tickers }));
const body = await res.json();
const elapsed = Date.now() - t0;

check('ยิงจริง → 200', res.status, 200);
if (res.status !== 200) {
  console.log('  error:', body.error);
} else {
  console.log(`  ใช้เวลา ${elapsed}ms (เพดาน Netlify Function = 10,000ms)`);
  check('ได้ราคาครบทุกตัว', body.returned, tickers.length);
  check('บอกจำนวนที่ขอไป', body.requested, tickers.length);

  const th = tickers.filter((t) => t.endsWith('.BK'));
  const thGot = th.filter((t) => body.quotes[t]?.price != null);
  check(`หุ้นไทยได้ราคาครบ (${th.length} ตัว)`, thGot.length, th.length);

  const sample = body.quotes['ADVANC.BK'];
  console.log(`  ADVANC.BK: ราคา ${sample.price} · ${sample.change_pct?.toFixed(2)}%`
    + ` · ช้า ${sample.delayed_by} นาที · ${sample.market_state}`);
  check('หุ้นไทยรายงานความช้า 15 นาที', sample.delayed_by, 15);
  check('หุ้นสหรัฐฯ ไม่ช้า', body.quotes['AAPL'].delayed_by, 0);

  const keys = Object.keys(body.quotes['AAPL']).sort();
  check('ส่งกลับแค่ 4 ฟิลด์ที่ใช้', keys,
    ['change_pct', 'delayed_by', 'market_state', 'price']);

  const bytes = JSON.stringify(body).length;
  console.log(`  ขนาดที่ส่งกลับ ${(bytes / 1024).toFixed(1)} KB`);
  check('ขนาดไม่เกิน 30 KB (bandwidth คิดเป็นเครดิต)', bytes < 30720, true);
}

// ── 3) กดครั้งที่สองต้องใช้ session เดิม ไม่ขอ crumb ใหม่ ────
check('ครั้งแรกเก็บ session ลง Blobs', blobs.has('yahoo-session'), true);
const stored = JSON.parse(blobs.get('yahoo-session'));
blobReads = [];
const t1 = Date.now();
const res2 = await handler(post({ symbols: ['AAPL', 'ADVANC.BK'] }));
const elapsed2 = Date.now() - t1;
check('ครั้งที่สอง → 200', res2.status, 200);
check('อ่าน session แบบ strong (กัน Blobs ให้ค่าเก่า)',
  blobReads[0]?.opts?.consistency, 'strong');
check('ใช้ crumb เดิม ไม่ขอใหม่',
  JSON.parse(blobs.get('yahoo-session')).crumb, stored.crumb);
console.log(`  ครั้งที่สองใช้ ${elapsed2}ms (ครั้งแรก ${elapsed}ms)`);

// ── 4a) crumb หมดอายุ (ปลายทางตอบ 401) → ต้องขอใหม่แล้วยังได้ราคา
blobs.set('yahoo-session', JSON.stringify({ cookie: 'A3=stale', crumb: 'deadcrumb01', at: Date.now() }));
const res3 = await handler(post({ symbols: ['AAPL'] }));
check('crumb หมดอายุ → ขอใหม่แล้วได้ 200', res3.status, 200);
check('crumb ถูกเปลี่ยนเป็นของใหม่',
  JSON.parse(blobs.get('yahoo-session')).crumb !== 'deadcrumb01', true);

// ── 4b) session เสียจนใส่ลง HTTP header ไม่ได้ (fetch โยน error ไม่ใช่ตอบ 401)
// เคสนี้เคยทำให้ปุ่มใช้ไม่ได้จนครบ TTL 6 ชั่วโมง เพราะทางเดิมรับแต่ 401
blobs.set('yahoo-session', JSON.stringify({ cookie: 'A3=ไทยใส่header ไม่ได้', crumb: 'x1', at: Date.now() }));
const res3b = await handler(post({ symbols: ['AAPL'] }));
check('session เสียจน fetch โยน error → ยังกู้คืนได้ 200', res3b.status, 200);
const body3b = await res3b.json();
check('กู้คืนแล้วได้ราคาจริง', body3b.quotes?.AAPL?.price > 0, true);

// ── 5) เกิน MAX_SYMBOLS ต้องถูกตัด ไม่ใช่ยิงทั้งหมด ──────────
const many = Array.from({ length: 300 }, (_, i) => `SYM${i}`);
const res4 = await handler(post({ symbols: many }));
const body4 = await res4.json();
check('ขอ 300 ตัว → ตัดเหลือ 200', body4.requested ?? 200, 200);

console.log(`\nสรุป: PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
