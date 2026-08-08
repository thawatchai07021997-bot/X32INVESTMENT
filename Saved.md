# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**ใช้งานจริง 5 หน้า: Dashboard · อุตสาหกรรม · คัดกรอง · วางแผน · ถาม-ตอบ AI · สายอัตโนมัติครบวงจร**
เว็บ: https://x32-investment-copilot.netlify.app (site id `63e8f519-f2be-4f7d-82a9-ebf3839a8d03`)
repo: github.com/thawatchai07021997-bot/X32INVESTMENT (private) → Netlify auto-deploy จาก `main`
วงจร: cron → Actions รัน pipeline → commit `data-private/` → Netlify build (~27 วิ) → เว็บสด
ตรวจผ่าน: `/data-private/*` → 404 · `/api/data` `/api/quota` `/api/chat` → 401 · GET chat → 405
ต้นทุน: pipeline ~30 บาท/เดือน · ถาม AI 1.40 บาท/คำถาม (จำกัด 30/วัน = เพดาน ~42 บาท/วัน)

## ทำต่อจากตรงนี้
0. **ยังไม่ commit ทั้งหมด** — งานรอบล่าสุด (ดู Session Log) เขียนเสร็จและทดสอบ UI ผ่านแล้ว
   แต่ยังไม่ได้ `git add`/`push` · ตรวจ staged files ว่าไม่มี secret ก่อนเสมอ
1. **ทดสอบที่ยังค้าง 2 อย่าง**
   - `sector_analyst` รันจริง 1 กลุ่ม (`theme:ai_chip`) ยังไม่เห็นผล — สคริปต์ทดสอบอยู่ที่
     scratchpad `t6.py` · ต้องดูคุณภาพบทความ + **วัดต้นทุนจริงต่อกลุ่ม** แล้วคูณ 24 กลุ่ม
     (ประเมินไว้ 25–35 บาท/รอบ ยังไม่ยืนยัน) ถ้าบทความตื้นไปให้ขยับ `SECTOR_AI_EFFORT`
     เป็น medium **พร้อมขยาย `SECTOR_AI_MAX_TOKENS`** ไม่งั้น JSON ขาดกลาง
   - `/api/plan-summary` (Edge Function ใหม่) ยังไม่เคยถูกเรียกเลยสักครั้ง
2. **กดรัน workflow หนึ่งรอบ** — `dashboard.json` ชุดปัจจุบันยังไม่มี beta/volatility และ
   ยังไม่มี `dividend_months` ปฏิทินปันผลจึงว่างและหน้าวางแผนขึ้นคำเตือนสีเหลือง
   (ทดสอบดึงสดแล้ว 5 ตัว ได้ข้อมูลปันผลจริงครบ — ตรรกะถูก รอแค่ข้อมูลเต็มชุด)
   · `data-private/*.json` ตอนนี้เป็นไฟล์ทดสอบที่ script สร้าง pipeline รอบหน้าจะเขียนทับ
3. **DoD ที่เหลือ:** backtest → ทบทวนคำอธิบายให้คนไม่มีพื้นฐานการเงินอ่านรู้เรื่อง
   → News Agent (RSS) → กองทุนรวมไทย (ต้องสมัคร API key ที่ api.sec.or.th ก่อน)
4. `summarizeAsset()` ใน `lib/tools.js` ยังเป็นชุด field ขั้นต่ำ ผู้ใช้ยังไม่ตัดสินใจ
5. deploy อัตโนมัติแล้ว — แค่ `git push` · บังคับเขียนใหม่: `AI_FORCE=1` / `SECTOR_AI_FORCE=1`

## ติดปัญหา / Blockers
- เครื่องนี้มี 2 บัญชี GitHub — แก้ถาวรด้วย local `credential.useHttpPath` (ดูความจำ
  `github-two-accounts`) · **อย่าไปแก้ global config**

## ไฟล์สำคัญ
| ไฟล์ | หน้าที่ |
|---|---|
| `pipeline/config.py` | universe + น้ำหนัก + เกณฑ์ + ตั้งค่า AI — แก้ที่นี่ที่เดียว · เหตุผลอยู่ในคอมเมนต์ |
| `functions/_auth.js` | session cookie (HMAC) — ต้องตรงกับ `edge-functions/lib/auth.js` เสมอ |
| `netlify/edge-functions/chat.js` | ถาม-ตอบ AI — วน tool loop + stream SSE (ต้องอยู่บน Edge) |
| `netlify/edge-functions/lib/tools.js` | เครื่องมือ 3 ตัวที่ AI เรียกดูข้อมูล + `summarizeAsset()` |
| `public/assets/finance.js` | คณิตศาสตร์วางแผนการลงทุน — ไม่ยุ่ง DOM ทดสอบแยกได้ |
| `pipeline/config.py` → `THEMES` | ธีมข้ามอุตสาหกรรม จัดรายชื่อด้วยมือ — แก้ที่นี่ที่เดียว |
| `pipeline/quant/sectors.py` | รวมสถิติรายกลุ่ม + เลือกหุ้นเด่น (ป้อนให้ AI) |
| `pipeline/quant/dividends.py` | สรุป "ปกติจ่ายเดือนไหน" จากประวัติ XD 3 ปี |
| `pipeline/agents/sector_analyst.py` | บทวิเคราะห์รายอุตสาหกรรม/ธีม — เขียนใหม่ทุก 30 วัน |
| `netlify/edge-functions/plan-summary.js` | AI สรุปแผนเป็นภาษาคน (ใช้โควตาก้อนเดียวกับ chat) |

## กฎที่ต้องรู้ (อย่าให้เกิดซ้ำ)
- **structured output รับ `minItems` ได้แค่ 0 หรือ 1 และไม่รับ `maxItems` เลย** — ใส่ไปได้ 400
  ทั้งคำขอ · ต้องเขียนจำนวนข้อที่ต้องการไว้ใน `description` แทน
- **`max_tokens` นับโทเคนที่โมเดลใช้คิดรวมด้วย** — effort medium + 12000 ทำให้ JSON ขาดกลาง
  ประโยคทุกครั้ง แล้วไปโผล่เป็น error "Unterminated string" ซึ่งหลอกให้ไล่หาผิดทาง
  · ต้องเช็ค `stop_reason == "max_tokens"` แยกจาก JSONDecodeError เสมอ
- **ต้นทุน sector AI จริง = 4.08 บาท/กลุ่ม (24 กลุ่ม, effort low)** สูงกว่าที่ประเมินไว้ 2 เท่า
- **ความถี่ปันผลห้ามคิดจาก "จำนวนครั้ง ÷ จำนวนปีปฏิทิน"** — กรอบข้อมูลเริ่ม/จบกลางปีเสมอ
  หุ้นรายไตรมาสจะกลายเป็น "ปีละ 3 ครั้ง" · ต้องใช้มัธยฐานระยะห่างระหว่างการจ่ายเทียบ 365 วัน
- **`fetch_prices()` ของชุดย่อยต้องส่ง `use_cache=False`** — `fetch_benchmarks()` เคยเขียนทับ
  cache ราคาทั้ง universe ด้วยดัชนี 6 ตัว ทำให้ fallback ที่ Plan.md บังคับไว้ใช้ไม่ได้จริง
- **ห้ามใช้ CDN** — ถูกบล็อกในเครือข่ายนี้ และทำให้บุคคลที่สามเห็นว่าผู้ใช้ดูสินทรัพย์ตัวไหน
- **Function ตัน 10 วินาที (แผน Free) และ streaming ไม่ช่วย** — งานรอ AI ต้องอยู่บน Edge
  (รอ network ไม่กิน CPU quota, มี 40 วินาทีก่อนส่ง header) แลกกับ Deno: แตะไฟล์ไม่ได้ ใช้ Web Crypto
- **netlify-cli 17 ใช้กับ Node 24 ไม่ได้** — พังเป็น "Cannot find module" ที่เปลี่ยนชื่อไปเรื่อยๆ · อัป 27 แล้วหาย
- **อย่ารัน `npm install` ขณะ `netlify dev` เปิด** — Windows ล็อกไฟล์ → lockfile เพี้ยน
  ถ้าเจอ: `git checkout package-lock.json` แล้วลบ `node_modules` ติดตั้งใหม่
- **ต้องสั่ง AI ห้ามใช้มาร์กดาวน์** — `dom.js` ใช้ `textContent` กัน XSS ไม่งั้นเห็น `**` บนจอ
- **`format.js` คืน DOM node ไม่ใช่ string** — ใส่ใน `text:` จะได้ `[object HTMLSpanElement]`
- **จัดพอร์ตอย่าเรียงคะแนนแล้วหยิบ N ตัวแรก** — เคยได้ ETF ตราสารหนี้สหรัฐฯ ล้วน 6 ตัวที่ขึ้นลง
  เหมือนกันหมด · ต้องจำกัดจำนวนต่อกลุ่มด้วย `selectDiversified()`
- **ชื่อไฟล์สงวนของ Windows (COM7) แก้พร้อมกัน 3 ที่** — `main.py`, `asset.js`, `lib/tools.js`
- **คีย์อยู่ใน `.env` เท่านั้น ไม่ใช่ `.env.example`** — เช็ค `grep sk-ant .env.example` ก่อน push
- **อย่าใช้ปุ่ม "link to a new repository" ของ Netlify** — push แค่ผลลัพธ์ deploy ไม่ใช่ซอร์ส
  ต้อง "Link to a **different** repository"

## Session Log (3 ครั้งล่าสุด)
- 2026-08-08 (2): เฟส 3 ถาม-ตอบ AI บน Edge + โควตา 30/วัน → cache ลด 2.81→1.40 บาท → `0e28b0f`
- 2026-08-08 (3): หน้าวางแผน — Monte Carlo ตอบเป็นช่วง + พอร์ตปันผลหักภาษี
  ทดสอบคณิตศาสตร์ผ่าน 20 ข้อ · บังคับกระจายข้ามกลุ่มลดเงินต้น 8.14→6.99 ล้าน → `e271072`
- 2026-08-08 (4): **ยังไม่ commit** · เพิ่มหน้าอุตสาหกรรม + ยกเครื่องหน้าวางแผน
  - pipeline: ปฏิทินปันผลจาก `actions=True` (ไม่มีคำขอเพิ่ม) · จัดกลุ่ม 24 กลุ่ม
    (อุตสาหกรรม 16 แยกไทย/ตปท. + ธีม 8) · `sector_analyst` เขียนบทความยาวทุก 30 วัน
  - เว็บ: `/sectors.html` ใหม่ · planner เพิ่มปุ่มล้างค่า, เลือกตามอุตสาหกรรม/ธีม,
    คิดย้อนจากเป้าหมาย, ปฏิทินปันผล 12 เดือน, บันทึกหลายแผน, ปุ่มให้ AI สรุปแผน
  - ทดสอบผ่าน: goal-seek ตรงกับ Monte Carlo (โอกาสถึงเป้า 50.6%) · เลือกธีมแล้วหยิบ
    สลับกลุ่มจริง · ปันผลสดจาก yfinance 5 ตัวถูกต้อง · บทวิเคราะห์ AI 1 กลุ่มคุณภาพดี
