import { concentration } from '../public/assets/finance.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = Math.abs(got - want) < 1e-9 || got === want;
  console.log(`${ok ? 'ผ่าน' : 'ไม่ผ่าน'}  ${name}: ได้ ${got} · คาด ${want}`);
  ok ? pass++ : fail++;
};

const a = (symbol, market, sector, asset_class = 'stock') =>
  ({ symbol, market, sector, asset_class });
const eq = (assets) => assets.map((x) => ({ asset: x, weight: 1 / assets.length }));

// 1) พอร์ต 8 ตัวลงเท่ากัน — top3 ต้องได้ 3/8
const p8 = eq([
  a('ADVANC.BK', 'TH', 'Communication'), a('PTT.BK', 'TH', 'Energy'),
  a('SCC.BK', 'TH', 'Materials'), a('MSFT', 'US', 'Technology'),
  a('XOM', 'US', 'Energy'), a('JNJ', 'US', 'Healthcare'),
  a('VOO', 'US', null, 'etf'), a('BND', 'US', null, 'etf'),
]);
const c8 = concentration(p8);
check('8 ตัวเท่ากัน · top3Share', c8.top3Share, 3 / 8);
check('8 ตัวเท่ากัน · maxWeight', c8.maxWeight, 1 / 8);
// Energy = PTT + XOM ข้ามตลาด ต้องรวมเป็นก้อนเดียว = 2/8
check('Energy ไทย+สหรัฐรวมกัน', c8.topGroupShare, 2 / 8);
check('ชื่อกลุ่มหนักสุด', c8.topGroupLabel, 'Energy');
// กลุ่ม: Communication, Energy, Materials, Technology, Healthcare, etf = 6
check('จำนวนกลุ่ม (ETF สองตัวนับกลุ่มเดียว)', c8.groupCount, 6);

// 2) พอร์ต 4 ตัว — top3 ต้องเป็น 0 ไม่ใช่ 0.75
const c4 = concentration(eq([
  a('A', 'TH', 'Energy'), a('B', 'TH', 'Energy'),
  a('C', 'US', 'Technology'), a('D', 'US', 'Technology'),
]));
check('4 ตัว · top3Share ถูกกดเป็น 0', c4.top3Share, 0);
check('4 ตัว · ยังรายงาน maxWeight', c4.maxWeight, 0.25);

// 3) พอร์ต 6 ตัว — เกณฑ์ขอบล่าง ต้องรายงาน
const c6 = concentration(eq([
  a('A', 'TH', 'Energy'), a('B', 'TH', 'Materials'), a('C', 'US', 'Technology'),
  a('D', 'US', 'Healthcare'), a('E', 'US', 'Financials'), a('F', 'US', 'Utilities'),
]));
check('6 ตัว · top3Share รายงานแล้ว', c6.top3Share, 3 / 6);

// 4) น้ำหนักไม่เท่ากัน (หน้าปันผล)
const cw = concentration([
  { asset: a('O', 'US', 'Real Estate'), weight: 0.40 },
  { asset: a('ADVANC.BK', 'TH', 'Communication'), weight: 0.25 },
  { asset: a('PTT.BK', 'TH', 'Energy'), weight: 0.15 },
  { asset: a('SCC.BK', 'TH', 'Materials'), weight: 0.10 },
  { asset: a('XOM', 'US', 'Energy'), weight: 0.06 },
  { asset: a('JNJ', 'US', 'Healthcare'), weight: 0.04 },
]);
check('น้ำหนักต่างกัน · maxWeight', cw.maxWeight, 0.40);
check('น้ำหนักต่างกัน · maxSymbol', cw.maxSymbol, 'O');
check('น้ำหนักต่างกัน · top3Share', cw.top3Share, 0.80);
check('น้ำหนักต่างกัน · Energy รวม', shareOf(cw, 'Real Estate'), 0.40);

function shareOf(c, label) { return c.topGroupLabel === label ? c.topGroupShare : -1; }

// 5) กรณีขอบ — ไม่มีข้อมูล / ข้อมูลพิการ ต้องไม่ระเบิด
const cEmpty = concentration([]);
check('พอร์ตว่าง · maxWeight', cEmpty.maxWeight, 0);
check('พอร์ตว่าง · groupCount', cEmpty.groupCount, 0);
check('พอร์ตว่าง · maxSymbol', cEmpty.maxSymbol, null);
check('ส่ง null เข้ามา', concentration(null).groupCount, 0);
const cBad = concentration([
  { asset: a('A', 'TH', 'Energy'), weight: NaN },
  { asset: null, weight: 0.5 },
  { asset: a('B', 'TH', 'Energy'), weight: 0.5 },
]);
check('มีแถวเสีย · เหลือตัวที่ใช้ได้', cBad.maxSymbol, 'B');
check('มีแถวเสีย · groupCount', cBad.groupCount, 1);

// 6) ไม่มี sector เลย (ETF ล้วน) — ต้องไม่ได้ label ว่าง
const cEtf = concentration(eq([
  a('VOO', 'US', null, 'etf'), a('BND', 'US', null, 'etf'),
]));
check('ETF ล้วน · label ไม่ว่าง', cEtf.topGroupLabel, 'etf');

console.log(`\nสรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
