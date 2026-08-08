# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**5 หน้าใช้งานจริง: Dashboard · อุตสาหกรรม · คัดกรอง · วางแผน · ถาม-ตอบ AI · สายอัตโนมัติครบ**
146 สินทรัพย์ · volatility 146/146 · ปฏิทินปันผล 133/146 (ครบ 12 เดือน) · บทวิเคราะห์กลุ่ม
23/24 · **DoD 11/14** · ตรวจผ่าน `/data-private/*`→404 `/api/*`→401 · ต้นทุน pipeline ~30 +
กลุ่ม ~47 บาท/เดือน · ถาม AI 1.40 บาท/ครั้ง (30/วัน)
เว็บ: https://x32-investment-copilot.netlify.app · site id `63e8f519-f2be-4f7d-82a9-ebf3839a8d03`
repo: github.com/thawatchai07021997-bot/X32INVESTMENT (private) → Netlify auto-deploy จาก `main`

## ทำต่อจากตรงนี้
1. **beta ของ ETF ตราสารหนี้ทำให้เลขความเสี่ยงผิด — ทำก่อนข้ออื่น**
   yfinance ไม่ให้ `beta` กับ ETF (ขาด 31/146) `portfolioStats()` แทนด้วย `1` · SPY/VOO/VTI
   ถูกอยู่แล้ว แต่ผิดหนัก 6 ตัว (vol จริงเทียบ `marketVolatility` 0.16): HYG .035 IEF .050
   LQD .053 TLT .093 VYM .094 SCHD .119 → พอร์ตตราสารหนี้ได้ sigma สูงเกินจริง ~4 เท่า Monte
   Carlo โชว์ drawdown เท่าพอร์ตหุ้นล้วน = ดันคนเริ่มต้นออกจากตัวเลือกที่เหมาะกับเขา
   **แก้:** beta จาก regression เทียบ benchmark ใน `quant/factors.py` ไม่ใช่ `info["beta"]`
2. **DoD ที่เหลือ:** backtest → ทบทวนคำอธิบายให้คนไม่มีพื้นฐานการเงินอ่านรู้เรื่อง →
   News Agent (RSS) → กองทุนรวมไทย (ต้องสมัคร API key ที่ api.sec.or.th ก่อน)
3. กลุ่ม "การเงิน/ธนาคาร" ยังไม่มีบทวิเคราะห์ (network สะดุด) — **ไม่ต้องแก้มือ** รอบหน้าเขียนเอง
4. deploy อัตโนมัติ แค่ `git push` · บังคับเขียนใหม่ `AI_FORCE=1`/`SECTOR_AI_FORCE=1` · ไม่มี
   `gh` CLI/token → กด `workflow_dispatch` ไม่ได้ ต้องรันนอกรอบใช้ `./.venv/Scripts/python.exe
   pipeline/main.py` แล้ว commit `data-private/` เอง (~31 นาที)

## ไฟล์สำคัญ / Blockers
- 2 บัญชี GitHub บนเครื่อง — local `credential.useHttpPath` ตั้งไว้แล้วใน repo นี้
  (ความจำ `github-two-accounts`) · **อย่าแก้ global config**
- `pipeline/config.py` — universe + น้ำหนัก + เกณฑ์ + ตั้งค่า AI + `THEMES` · แก้ที่นี่ที่เดียว
- `functions/_auth.js` — session cookie (HMAC) ต้องตรงกับ `edge-functions/lib/auth.js` เสมอ
- `netlify/edge-functions/` — `chat.js` (tool loop + SSE) · `plan-summary.js` (โควตาร่วมกัน)
- `public/assets/finance.js` — คณิตศาสตร์วางแผน + `concentration()` · ไม่ยุ่ง DOM ทดสอบแยกได้
- `pipeline/quant/{sectors,dividends,factors}.py` · `pipeline/agents/sector_analyst.py`

## กฎที่ต้องรู้ (เฉพาะ X32 — กฎที่ใช้ข้ามโปรเจกต์ย้ายไป `../Learning.md` แล้ว)
- **ความถี่ปันผลห้ามคิดจาก "จำนวนครั้ง ÷ จำนวนปี"** — กรอบข้อมูลเริ่ม/จบกลางปี หุ้นรายไตรมาส
  จะกลายเป็นปีละ 3 ครั้ง · ใช้มัธยฐานระยะห่างระหว่างการจ่ายเทียบ 365 วัน
- **`fetch_prices()` ของชุดย่อยต้องส่ง `use_cache=False`** — ไม่งั้น `fetch_benchmarks()`
  เขียนทับ cache ราคาทั้ง universe ด้วยดัชนี 6 ตัว ทำให้ fallback ใช้ไม่ได้จริง
- **จัดพอร์ตอย่าเรียงคะแนนแล้วหยิบ N ตัวแรก** — เคยได้ ETF ตราสารหนี้ล้วน 6 ตัว ใช้
  `selectDiversified()` · `groupOf()` แยกตลาด (บังคับกระจาย) แต่ `concentration()` รวมตลาด
  (รายงานความเสี่ยง) — อย่าทำให้สองอันใช้เกณฑ์เดียวกัน
- **ห้ามใช้ CDN** — ถูกบล็อก + บุคคลที่สามเห็นว่าผู้ใช้ดูสินทรัพย์ตัวไหน · **`format.js` คืน
  DOM node ไม่ใช่ string** และ `dom.js` ใช้ `textContent` กัน XSS → สั่ง AI ห้ามมาร์กดาวน์เสมอ

## Session Log (3 ครั้งล่าสุด)
- 2026-08-08 (3): หน้าวางแผน Monte Carlo + พอร์ตปันผลหักภาษี → `e271072`
- 2026-08-08 (4): หน้าอุตสาหกรรม 24 กลุ่ม + ยกเครื่องหน้าวางแผน → `85a45cc`
- 2026-08-08 (5): ทดสอบ `/api/plan-summary` บน production ครั้งแรก เจอ 3 บั๊กแก้หมด →
  `concentration()` `64277c7` · โควตา strong + หัวข้อ prompt `77f36c3` · pipeline `9aa879b`
