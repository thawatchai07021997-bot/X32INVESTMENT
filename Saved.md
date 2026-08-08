# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**5 หน้าใช้งานจริง: Dashboard · อุตสาหกรรม · คัดกรอง · วางแผน · ถาม-ตอบ AI** · 146 สินทรัพย์
· ปฏิทินปันผล 133/146 (12 เดือนครบ) · บทวิเคราะห์กลุ่ม 23/24 · **DoD 11/14** · ตรวจผ่าน
`/data-private/*`→404 `/api/*`→401 · ต้นทุน AI ~77 บาท/เดือน · เว็บ x32-investment-copilot
.netlify.app · repo `thawatchai07021997-bot/X32INVESTMENT` (private) → auto-deploy จาก `main`

## ทำต่อจากตรงนี้
0. **⚠ เครดิต Netlify เหลือ 43/300 (8 ส.ค. 69) = deploy ได้อีก ~2 ครั้งก่อนเว็บถูกพัก**
   ลด cron เป็นสัปดาห์ละครั้งแล้ว **ชั่วคราว** · กฎเครดิตอยู่ใน `../Learning.md`
   **แก้ถาวร: ย้ายข้อมูลไป Netlify Blobs แทน commit เข้า repo** — Actions POST เข้า endpoint
   ใหม่ (shared secret) แล้ว `functions/data.js` อ่าน Blobs ก่อน ไม่มีค่อย fallback ไปไฟล์ที่
   bundle มา (ไม่มีความเสี่ยง) → อัปเดตรายวันได้โดยไม่ deploy
1. **beta ของ ETF ตราสารหนี้ทำให้เลขความเสี่ยงผิด** — yfinance ไม่ให้ `beta` กับ ETF (ขาด
   31/146) `portfolioStats()` แทนด้วย `1` · SPY/VOO/VTI ถูกแล้ว แต่ผิดหนัก 6 ตัว (vol จริง
   เทียบ `marketVolatility` .16): HYG .035 IEF .050 LQD .053 TLT .093 VYM .094 SCHD .119
   → sigma เกินจริง ~4 เท่า Monte Carlo โชว์ drawdown เท่าพอร์ตหุ้นล้วน = ดันคนเริ่มต้น
   ออกจากตัวเลือกที่เหมาะกับเขา · **แก้:** regression เทียบ benchmark ใน `quant/factors.py`
2. **DoD ที่เหลือ:** backtest → ทบทวนคำอธิบายให้คนไม่มีพื้นฐานการเงินอ่านรู้เรื่อง → News
   Agent (RSS) → กองทุนรวมไทย (สมัคร API key ที่ api.sec.or.th ก่อน) · กลุ่ม "การเงิน/ธนาคาร"
   ยังไม่มีบทวิเคราะห์ — **ไม่ต้องแก้มือ** รอบหน้าเขียนเอง

## ไฟล์สำคัญ / Blockers
- 2 บัญชี GitHub — local `credential.useHttpPath` ตั้งแล้ว **อย่าแก้ global** (`github-two-accounts`)
- ไม่มี `gh` CLI/token → กด `workflow_dispatch` ไม่ได้ · รันนอกรอบ: `./.venv/Scripts/python.exe
  pipeline/main.py` (~31 นาที) แล้ว commit `data-private/` เอง · `AI_FORCE=1`/`SECTOR_AI_FORCE=1`
  บังคับให้ AI เขียนใหม่
- `pipeline/config.py` universe+น้ำหนัก+เกณฑ์+AI+`THEMES` แก้ที่นี่ที่เดียว · `functions/_auth.js`
  session cookie ต้องตรงกับ `edge-functions/lib/auth.js` เสมอ · `functions/refresh.js` ราคาสด
  · `public/assets/finance.js` คณิตศาสตร์วางแผน ไม่ยุ่ง DOM · `tests/` รันด้วย `node` เปล่าๆ
  ยกเว้น `refresh.function.mjs` ต้องใส่ `--experimental-test-module-mocks`

## กฎที่ต้องรู้ (เฉพาะ X32 — กฎที่ใช้ข้ามโปรเจกต์อยู่ใน `../Learning.md`)
- **`symbol` ≠ `ticker`** — เว็บแสดง `ADVANC` แต่แหล่งข้อมูลรู้จัก `ADVANC.BK` · ส่ง `symbol`
  ไปขอราคาจะไม่ได้หุ้นไทยเลยทั้ง 49 ตัว · benchmark มีแค่ `ticker` ไม่มี `symbol`
- 2 กฎที่เหตุผลเขียนกำกับไว้ในโค้ดแล้ว: ความถี่ปันผลใช้มัธยฐานระยะห่าง ไม่ใช่ครั้ง÷ปี
  (`quant/dividends.py`) · `fetch_prices()` ชุดย่อยต้องส่ง `use_cache=False` (`sources/stocks.py`)
- **จัดพอร์ตอย่าเรียงคะแนนแล้วหยิบ N ตัวแรก** (เคยได้ ETF ตราสารหนี้ล้วน 6 ตัว) ใช้
  `selectDiversified()` · `groupOf()` แยกตลาดเพื่อบังคับกระจาย แต่ `concentration()` รวมตลาด
  เพื่อรายงานความเสี่ยง — ห้ามใช้เกณฑ์เดียวกัน
- **ห้ามใช้ CDN** (ถูกบล็อก + บุคคลที่สามเห็นว่าผู้ใช้ดูตัวไหน) · **`format.js` คืน DOM node
  ไม่ใช่ string** · `dom.js` ใช้ `textContent` กัน XSS → สั่ง AI ห้ามมาร์กดาวน์เสมอ

## Session Log (3 ครั้งล่าสุด)
- 2026-08-08 (4): หน้าอุตสาหกรรม 24 กลุ่ม + ยกเครื่องหน้าวางแผน → `85a45cc`
- 2026-08-08 (5): ทดสอบ `/api/plan-summary` ครั้งแรก เจอ 3 บั๊กแก้หมด `64277c7` `77f36c3` · pipeline เต็มรอบ 46.75 บาท `9aa879b`
- 2026-08-08 (6): บันทึกบทสรุป AI ไปกับแผน `736e5f3` · ปุ่มอัปเดตราคาสด `/api/refresh`
  (22 เทสต์ · 146 ตัวใน 0.8 วิ) + ลด cron เพราะเครดิต Netlify
