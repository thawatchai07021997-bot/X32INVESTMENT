/**
 * ทดสอบ savePlan/loadPlan ของจริงใน planner.js
 *
 * planner.js ผูกกับ DOM จึง import ตรงๆ ไม่ได้ → stub DOM/localStorage ไว้ก่อน
 * แล้วปล่อยให้ boot() ลงทะเบียน event listener ตามปกติ · จากนั้นเรียก listener
 * ที่โค้ดลงทะเบียนไว้เอง = ได้ทดสอบฟังก์ชันจริง ไม่ใช่ฟังก์ชันที่เขียนเลียนแบบ
 */

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.value = '';
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.attrs = {};
    this.style = { cssText: '' };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); }
  append(...c) { this.children.push(...c); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  querySelectorAll() { return []; }
}
globalThis.Node = FakeNode;

const nodes = new Map();
const byId = (id) => {
  if (!nodes.has(id)) nodes.set(id, new FakeNode());
  return nodes.get(id);
};

globalThis.document = {
  getElementById: byId,
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createTextNode: (t) => { const n = new FakeNode('#text'); n.textContent = t; return n; },
  querySelectorAll: () => [],
};

const store = new Map();
let quotaExceeded = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (quotaExceeded) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    store.set(k, v);
  },
  removeItem: (k) => store.delete(k),
};

// เสิร์ฟ dashboard.json ตัวจริงจากเครื่อง เพื่อให้เส้นทางคำนวณวิ่งด้วยข้อมูลจริง
// ไม่ใช่ข้อมูลปลอมที่อาจไม่ตรงรูปกับของจริง
import { readFileSync } from 'node:fs';
const DASHBOARD = JSON.parse(
  readFileSync(new URL('../data-private/dashboard.json', import.meta.url), 'utf-8'),
);
const SUMMARY = 'พอร์ตนี้มีโอกาสขาดทุน 8.1% และเคยติดลบ 27% ระหว่างทาง';
let summaryFails = false;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/data')) {
    return { ok: true, status: 200, json: async () => DASHBOARD };
  }
  if (u.includes('/api/plan-summary')) {
    if (summaryFails) return { ok: false, status: 502, json: async () => ({ error: 'ทดสอบกรณีล้ม' }) };
    return { ok: true, status: 200, json: async () => ({ summary: SUMMARY, quota: { used: 5, limit: 30 } }) };
  }
  throw new Error(`เทสต์ไม่รู้จัก URL: ${u}`);
};
globalThis.location = { href: '', pathname: '/planner.html', search: '' };
let promptAnswer = 'แผนทดสอบ';
globalThis.prompt = () => promptAnswer;
globalThis.confirm = () => true;

await import('../public/assets/planner.js');
await new Promise((r) => setTimeout(r, 30));   // ปล่อยให้ boot() วิ่งจนจบ (fetch พังแล้ว return)

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ได้ ${JSON.stringify(got)} คาด ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const PLANS = 'x32.planner.plans';
const readPlans = () => JSON.parse(store.get(PLANS) || '[]');

// ตั้งค่าฟอร์มให้เหมือนค่าตั้งต้นจริงของหน้าเว็บ ไม่งั้นเส้นทางคำนวณตีกลับทันที
const FORM = {
  'pick-mode': 'guide', focus: 'all', risk: 'mid', 'calc-mode': 'forward',
  lump: '500000', monthly: '10000', goal: '5000000', years: '15', runs: '2000',
  'a-th': '8', 'a-us': '10', 'a-gold': '6', 'a-inf': '2',
  target: '30000', count: '6', 'min-yield': '3', 'income-focus': 'all', tax: '1',
};
for (const [id, v] of Object.entries(FORM)) byId(id).value = v;

// ── 1) บันทึกตอนยังไม่มีบทสรุป AI → ต้องไม่พังและไม่มี ai.text
byId('panel-sim').hidden = false;
byId('save-plan').fire('click');
check('บันทึกได้ 1 แผน', readPlans().length, 1);
check('ยังไม่มีบทสรุป AI', readPlans()[0].ai, { sim: null, income: null });
check('ข้อความแจ้งไม่พูดถึง AI', /บทสรุปของ AI/.test(byId('notice').textContent), false);

// ── 2) คำนวณจริง แล้วให้ AI สรุป แล้วกดบันทึก → ต้องเก็บข้อความไปด้วย
byId('run-sim').fire('click');
byId('sim-ai').fire('click');
await new Promise((r) => setTimeout(r, 50));
if (byId('sim-ai-out').textContent !== SUMMARY) {
  console.log('  note:', JSON.stringify(byId('sim-ai-note').textContent));
}
const gotSummary = byId('sim-ai-out').textContent === SUMMARY;
check('AI ตอบแล้วขึ้นบนจอ', gotSummary, true);

if (gotSummary) {
  promptAnswer = 'แผนที่มีบทสรุป';
  byId('save-plan').fire('click');
  const saved = readPlans()[0];
  check('บันทึกบทสรุป AI ลง localStorage', saved.ai.sim.text, SUMMARY);
  check('บันทึกเวลาที่ AI เขียนไว้ด้วย', typeof saved.ai.sim.at === 'string', true);
  check('ข้อความแจ้งบอกว่าเก็บบทสรุปแล้ว', /เก็บบทสรุปของ AI/.test(byId('notice').textContent), true);

  // ── 3) เปิดแผนนั้นใหม่ → บทสรุปต้องกลับมา (นี่คือบั๊กที่วัชเจอ)
  byId('sim-ai-out').textContent = '';
  byId('sim-ai-out').hidden = true;
  byId('saved-plans').value = saved.id;
  byId('load-plan').fire('click');
  check('เปิดแผนแล้วบทสรุปกลับมา', byId('sim-ai-out').textContent, SUMMARY);
  check('กล่องบทสรุปไม่ถูกซ่อน', byId('sim-ai-out').hidden, false);
  check('มีวันที่กำกับว่าเป็นของเก่า', /บทสรุปที่บันทึกไว้เมื่อ/.test(byId('sim-ai-note').textContent), true);
  check('เตือนว่าเป็นราคาของวันนั้น', /ราคาของวันนั้น/.test(byId('sim-ai-note').textContent), true);

  // ── 4) คำนวณใหม่ → บทสรุปเดิมต้องถูกลืม ไม่ติดไปกับแผนชุดใหม่
  byId('run-sim').fire('click');
  check('คำนวณใหม่แล้วซ่อนบทสรุปเดิม', byId('sim-ai-out').hidden, true);
  promptAnswer = 'แผนหลังคำนวณใหม่';
  byId('save-plan').fire('click');
  check('บทสรุปเก่าไม่ติดไปกับแผนใหม่', readPlans()[0].ai.sim, null);
}

// ── 5) ฝั่งพอร์ตปันผล — ต้องทำงานเหมือนกัน และต้องเก็บได้พร้อมกันสองแท็บ
byId('panel-sim').hidden = true;
byId('run-income').fire('click');
byId('income-ai').fire('click');
await new Promise((r) => setTimeout(r, 50));
check('ปันผล: AI ตอบแล้วขึ้นบนจอ', byId('income-ai-out').textContent, SUMMARY);

byId('panel-sim').hidden = false;
byId('run-sim').fire('click');
byId('sim-ai').fire('click');
await new Promise((r) => setTimeout(r, 50));
promptAnswer = 'แผนที่มีบทสรุปสองแท็บ';
byId('save-plan').fire('click');
const both = readPlans()[0];
check('เก็บบทสรุปทั้งสองแท็บในแผนเดียว',
  [!!both.ai.sim?.text, !!both.ai.income?.text], [true, true]);
check('ข้อความแจ้งบอกครบสองแท็บ',
  /จำลอง \+ พอร์ตปันผล/.test(byId('notice').textContent), true);

byId('sim-ai-out').textContent = '';
byId('income-ai-out').textContent = '';
byId('saved-plans').value = both.id;
byId('load-plan').fire('click');
check('เปิดแผนแล้วได้คืนทั้งสองแท็บ',
  [byId('sim-ai-out').textContent, byId('income-ai-out').textContent], [SUMMARY, SUMMARY]);

// ── 6) AI ล้ม → ต้องไม่บันทึกข้อความค้างจากครั้งก่อน
byId('run-sim').fire('click');
summaryFails = true;
byId('sim-ai').fire('click');
await new Promise((r) => setTimeout(r, 50));
promptAnswer = 'แผนที่ AI ล้ม';
byId('save-plan').fire('click');
check('AI ล้ม → ไม่บันทึกบทสรุป', readPlans()[0].ai.sim, null);
summaryFails = false;

// ── 7) localStorage เต็ม → ต้องบอกว่าไม่สำเร็จ ไม่ใช่บอกว่าบันทึกแล้ว
quotaExceeded = true;
promptAnswer = 'แผนที่บันทึกไม่ลง';
const before = readPlans().length;
byId('save-plan').fire('click');
check('พื้นที่เต็ม → จำนวนแผนไม่เพิ่ม', readPlans().length, before);
check('พื้นที่เต็ม → แจ้งว่าไม่สำเร็จ', /ไม่สำเร็จ/.test(byId('notice').textContent), true);

console.log(`\nสรุป: PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
