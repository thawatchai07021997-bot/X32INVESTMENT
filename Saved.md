# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**เฟส 1–3 ใช้งานจริง · สายอัตโนมัติครบวงจร · หน้าถาม-ตอบ AI ใช้ได้แล้ว (2026-08-08)**
เว็บ: https://x32-investment-copilot.netlify.app (site id `63e8f519-f2be-4f7d-82a9-ebf3839a8d03`)
repo: github.com/thawatchai07021997-bot/X32INVESTMENT (private) → Netlify auto-deploy จาก `main`
วงจร: cron → Actions รัน pipeline → commit `data-private/` → Netlify build (~27 วิ) → เว็บสด
ตรวจผ่าน: `/data-private/*` → 404 · `/api/data` `/api/quota` `/api/chat` → 401 · GET chat → 405
ต้นทุนถาม AI: 1.40 บาท/คำถามที่ค้น 3 รอบ (จำกัด 30 คำถาม/วัน = เพดาน ~42 บาท/วัน)
pipeline 146 สินทรัพย์ ~13 วินาที (ไม่มี AI) / ~5.5 นาที (มี AI 10 ตัว)
Dashboard กรอง 3 ชั้น (กลุ่ม × อุตสาหกรรม × ระยะ) · หน้ารายตัวมีเหตุผลจาก AI ครบ 4 ระยะ
ต้นทุนจริงที่วัดได้ 6.92 บาท/รอบ ≈ 30 บาท/เดือน (รันสัปดาห์ละครั้ง)

## ทำต่อจากตรงนี้
1. **ปรับ `summarizeAsset()`** ใน `netlify/edge-functions/lib/tools.js` — ตัดสินใจว่าจะให้ AI
   เห็น field ไหนตอนคัดกรอง (ตอนนี้เป็นชุดขั้นต่ำ) ผู้ใช้ยังไม่ได้เลือก มีคอมเมนต์
   ระบุตัวเลือกทั้งหมดไว้แล้ว · ทุก field คูณด้วยจำนวนตัวที่คืน (สูงสุด 25)
2. **DoD ที่ยังเหลือ:** backtest เกณฑ์คัดกรอง → ทบทวนคำอธิบายให้คนไม่มีพื้นฐาน
   การเงินอ่านรู้เรื่อง → News Agent (RSS) → กองทุนรวมไทย (ต้องมี SEC API key ก่อน)
3. **deploy ตอนนี้ทำเองอัตโนมัติ** — แค่ `git push` ก็ขึ้นเว็บ ไม่ต้อง `netlify deploy` แล้ว
4. บังคับ AI วิเคราะห์ใหม่ก่อนครบ 7 วัน: ตั้ง env `AI_FORCE=1` (ดู `analyst.py:260`)

## ติดปัญหา / Blockers
- **เครื่องนี้มี 2 บัญชี GitHub** — repo X32 อยู่ใต้ `thawatchai07021997-bot` แต่ Credential
  Manager ล็อกอินค้างด้วย `thawatchai070240-stack` (โปรเจกต์อื่น) · แก้ถาวรแล้วด้วย
  `git config --local credential.useHttpPath true` + ใส่ username ใน remote URL
  → GCM เก็บ credential แยกตาม path ทั้งสองบัญชีใช้พร้อมกันได้ **อย่าไปแก้ global config**
- Netlify CLI login หมดอายุได้ ถ้า `netlify status` บอก Not logged in ให้ `npx netlify login` ใหม่
- กองทุนรวมไทย (เฟส 3) ต้องสมัคร API key ที่ api.sec.or.th ก่อน

## ไฟล์สำคัญ
| ไฟล์ | หน้าที่ |
|---|---|
| `pipeline/config.py` | universe + น้ำหนักปัจจัย + เกณฑ์ + ตั้งค่า AI — แก้ที่นี่ที่เดียว |
| `pipeline/agents/analyst.py` | Analyst agent — 1 call/สินทรัพย์, prompt caching, cache 7 วัน |
| `pipeline/knowledge/framework.md` | ความรู้ 10 บทที่ AI ใช้เป็นเกณฑ์ (สกัดจาก X.15) |
| `pipeline/quant/factors.py` | คะแนนปัจจัยพื้นฐาน + เทียบหน่วยอัตราปันผล |
| `functions/_auth.js` | ตรรกะ session cookie (HMAC) ใช้ร่วมทุก function |
| `netlify/edge-functions/chat.js` | หน้าถาม-ตอบ AI — วน tool loop + stream SSE (อยู่บน Edge) |
| `netlify/edge-functions/lib/tools.js` | เครื่องมือ 3 ตัวที่ AI เรียกดูข้อมูล + `summarizeAsset()` |
| `netlify.toml` | กลไกที่ทำให้ `data-private/` เป็นส่วนตัว |

## การตัดสินใจสำคัญ (ทั้งหมด 2026-08-07)
- **กราฟ SVG เขียนเองใน `public/assets/chart.js`** — CDN ถูกบล็อกในเครือข่ายนี้ และการไม่พึ่ง
  CDN ทำให้บุคคลที่สามไม่เห็นว่าผู้ใช้ดูสินทรัพย์ตัวไหน · ห้ามกลับไปใช้ CDN
- ให้คะแนนแบบ percentile ในกลุ่ม + บังคับกลุ่มขั้นต่ำ 8 ตัว (กลุ่มตัวเดียวได้ 100 เสมอ ไร้ความหมาย)
- สูตรระยะยาวมีโมเมนตัม 15% — ไม่งั้นกองทุนพันธบัตรที่ราคาไม่โตจะขึ้นอันดับ 1
- ระยะ "เน้นปันผล" ต้องจ่ายปันผลจริง ≥1.5% — สูตรมีน้ำหนักคุณภาพ 40% ทำให้หุ้นเติบโต
  ที่แทบไม่จ่ายปันผล (NVDA 0.45%) เคยขึ้นอันดับ 1 ของระยะนี้
- เกณฑ์คัดกรองส่งไปกับ dashboard.json (`screening`) เพราะหน้าเว็บจัดอันดับซ้ำเองตอนกรอง
  ถ้า hardcode สองที่จะเพี้ยนเงียบๆ เมื่อแก้ฝั่ง Python
- AI ใช้ Sonnet 5 + effort low + Top 10 + วิเคราะห์ใหม่ทุก 7 วัน (Opus 5 รายวันจะ ~1,500 บาท/เดือน)

## บั๊กที่เจอและแก้แล้ว (อย่าให้เกิดซ้ำ)
- **yfinance คืน `dividendYield` เป็นเปอร์เซ็นต์ ไม่ใช่ทศนิยม** → เดิมแสดงปันผล 795%
  แก้ด้วย `calibrate_dividend_unit()` ที่เทียบ `dividendRate ÷ ราคา` กับค่าที่ได้ ทั้ง universe ก่อนใช้
- INTUCH.BK ถอดออกจาก universe แล้ว (ควบรวมกับ GULF ไม่มีข้อมูลใน yfinance)
- อย่าตั้งชื่อไฟล์ทดสอบว่า `inspect.py` — บังโมดูล stdlib ของ Python
- **`COM7.json` ใช้ชื่ออุปกรณ์สงวนของ Windows** (CON/PRN/AUX/NUL/COM1-9/LPT1-9) → git
  index ไม่ได้ แก้ด้วย `safe_filename()` ใน `pipeline/main.py` เติม `_` ต่อท้าย
  **ต้องแก้คู่กับ `safeFilename()` ใน `public/assets/asset.js` เสมอ** ไม่งั้น 404 เฉพาะบางตัว
- **คีย์ต้องอยู่ใน `.env` เท่านั้น ไม่ใช่ `.env.example`** — ไฟล์ example ถูก commit ขึ้น repo
  เคยวางผิดไฟล์มาแล้ว 2026-08-07 · เช็คด้วย `grep sk-ant .env.example` ก่อน push เสมอ
- **Netlify Function ตัน 10 วินาทีบนแผน Free** (Pro ได้ 26) และ streaming ไม่ช่วยขยายเลย
  งานที่ต้องรอ AI นานต้องอยู่บน **Edge Function** (CPU 50ms/req แต่รอ network ไม่นับ,
  มีเวลา 40 วินาทีก่อนต้องส่ง header) · แต่ Edge รันบน Deno: แตะไฟล์ตรงๆ ไม่ได้
  ต้องเรียกผ่าน Function ฝั่ง Node และใช้ Web Crypto แทน node:crypto
- **netlify-cli 17 ใช้กับ Node 24 ไม่ได้** — พังเป็น "Cannot find module" ที่เปลี่ยนชื่อไปเรื่อยๆ
  (`@colors/colors` → `@dabh/diagnostics` → `@bugsnag/js`) ทั้งที่ไฟล์อยู่ครบ · อัปเป็น 27 แล้วหาย
- **อย่ารัน `npm install` ขณะ `netlify dev` เปิดอยู่** — Windows ล็อกไฟล์ ทำให้ npm rollback
  ค้างแล้วเขียน `package-lock.json` ที่ dependency ขาด · ถ้าเจอ ให้ `git checkout package-lock.json`
  แล้วลบ `node_modules` ติดตั้งใหม่
- **AI ต้องสั่งห้ามใช้มาร์กดาวน์** — `dom.js` ใช้ `textContent` ล้วนเพื่อกัน XSS
  ถ้าไม่สั่ง ผู้ใช้จะเห็น `**ตัวหนา**` เป็นดาวจริงๆ บนหน้าจอ
- **อย่าใช้ปุ่ม "link to a new repository" ของ Netlify** — มัน push แค่ผลลัพธ์ deploy
  (`public/` + `netlify.toml` = 13 ไฟล์) ขึ้น repo ใหม่ ไม่ใช่ซอร์สโค้ด · pipeline กับ
  `functions/` หายหมด ถ้า build จาก repo นั้นเว็บจะพัง · ต้อง "Link to a different
  repository" แล้วเลือก repo ที่มีโค้ดครบเท่านั้น (เกิดจริง 2026-08-08 แก้แล้ว)

## Session Log (เก็บ 3 ครั้งล่าสุด)
- 2026-08-07 (2): ตัวกรองกลุ่ม + อุตสาหกรรมใน Dashboard, พื้นปันผลขั้นต่ำ 1.5%,
  เฟส 2 ครบและทดสอบ API จริงผ่าน 10/10 ตัว, เพิ่มรายงานต้นทุนท้ายการรัน
- 2026-08-07 (3): แก้บั๊กชื่อไฟล์ COM7 → git init + commit แรก `481b73c` →
  สร้าง Netlify site → deploy production สำเร็จ ผู้ใช้ใช้งานเว็บได้จริงแล้ว
- 2026-08-08 (1): push ขึ้น GitHub (แก้ปัญหา 2 บัญชี) → ผูก Netlify กับ repo (พลาดไปผูก repo
  ที่ Netlify สร้างเอง แก้แล้ว) → ทดสอบ workflow ครบวงจรผ่าน `ebf9f05` → DoD ข้อ 2 เสร็จ
- 2026-08-08 (2): เฟส 3 — หน้าถาม-ตอบ AI บน Edge Function + โควตา 30/วัน (Blobs)
  ทดสอบครบ 3 เครื่องมือด้วย API จริง → เพิ่ม cache ที่ผลลัพธ์เครื่องมือ ลดต้นทุน
  2.81 → 1.40 บาท/คำถาม → deploy `0e28b0f` ผ่าน → DoD เหลือ 3 ข้อ
