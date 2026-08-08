# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**เฟส 1–3 ใช้งานจริง · สายอัตโนมัติครบวงจร · หน้าถาม-ตอบ AI ใช้ได้แล้ว**
เว็บ: https://x32-investment-copilot.netlify.app (site id `63e8f519-f2be-4f7d-82a9-ebf3839a8d03`)
repo: github.com/thawatchai07021997-bot/X32INVESTMENT (private) → Netlify auto-deploy จาก `main`
วงจร: cron → Actions รัน pipeline → commit `data-private/` → Netlify build (~27 วิ) → เว็บสด
ตรวจผ่าน: `/data-private/*` → 404 · `/api/data` `/api/quota` `/api/chat` → 401 · GET chat → 405
ต้นทุน: pipeline ~30 บาท/เดือน · ถาม AI 1.40 บาท/คำถาม (จำกัด 30/วัน = เพดาน ~42 บาท/วัน)

## ทำต่อจากตรงนี้
1. **ปรับ `summarizeAsset()`** ใน `netlify/edge-functions/lib/tools.js` — เลือกว่า AI ควรเห็น
   field ไหนตอนคัดกรอง ตอนนี้เป็นชุดขั้นต่ำ ผู้ใช้ยังไม่ตัดสินใจ · คอมเมนต์ในไฟล์ระบุตัวเลือกครบ
2. **DoD ที่เหลือ:** backtest เกณฑ์คัดกรอง → ทบทวนคำอธิบายให้คนไม่มีพื้นฐานการเงินอ่านรู้เรื่อง
   → News Agent (RSS) → กองทุนรวมไทย
3. deploy อัตโนมัติแล้ว — แค่ `git push` · บังคับ AI วิเคราะห์ใหม่ก่อน 7 วัน: env `AI_FORCE=1`

## ติดปัญหา / Blockers
- เครื่องนี้มี 2 บัญชี GitHub — แก้ถาวรด้วย local `credential.useHttpPath` (ดูความจำ
  `github-two-accounts`) · **อย่าไปแก้ global config**
- กองทุนรวมไทยต้องสมัคร API key ที่ api.sec.or.th ก่อน · Netlify CLI login หมดอายุได้
  (ถ้าบอก Not logged in ให้ `npx netlify login` ใหม่)

## ไฟล์สำคัญ
| ไฟล์ | หน้าที่ |
|---|---|
| `pipeline/config.py` | universe + น้ำหนัก + เกณฑ์ + ตั้งค่า AI — แก้ที่นี่ที่เดียว · เหตุผลอยู่ในคอมเมนต์ |
| `functions/_auth.js` | session cookie (HMAC) — ต้องตรงกับ `edge-functions/lib/auth.js` เสมอ |
| `netlify/edge-functions/chat.js` | ถาม-ตอบ AI — วน tool loop + stream SSE (ต้องอยู่บน Edge) |
| `netlify/edge-functions/lib/tools.js` | เครื่องมือ 3 ตัวที่ AI เรียกดูข้อมูล + `summarizeAsset()` |

## กฎที่ต้องรู้ (อย่าให้เกิดซ้ำ)
- **กราฟ SVG เขียนเองใน `chart.js`** — CDN ถูกบล็อกในเครือข่ายนี้ และการไม่พึ่ง CDN ทำให้
  บุคคลที่สามไม่เห็นว่าผู้ใช้ดูสินทรัพย์ตัวไหน · ห้ามกลับไปใช้ CDN
- **Function ตัน 10 วินาที (แผน Free) และ streaming ไม่ช่วย** — งานรอ AI ต้องอยู่บน Edge
  (รอ network ไม่กิน CPU quota, มี 40 วินาทีก่อนส่ง header) แลกกับ Deno: แตะไฟล์ไม่ได้ ใช้ Web Crypto
- **netlify-cli 17 ใช้กับ Node 24 ไม่ได้** — พังเป็น "Cannot find module" ที่เปลี่ยนชื่อไปเรื่อยๆ
  ทั้งที่ไฟล์อยู่ครบ · อัปเป็น 27 แล้วหาย
- **อย่ารัน `npm install` ขณะ `netlify dev` เปิด** — Windows ล็อกไฟล์ → lockfile เพี้ยน
  ถ้าเจอ: `git checkout package-lock.json` แล้วลบ `node_modules` ติดตั้งใหม่
- **ต้องสั่ง AI ห้ามใช้มาร์กดาวน์** — `dom.js` ใช้ `textContent` กัน XSS ไม่งั้นเห็น `**` บนจอ
- **ชื่อไฟล์สงวนของ Windows (COM7 ฯลฯ) แก้พร้อมกัน 3 ที่** — `pipeline/main.py`,
  `public/assets/asset.js`, `edge-functions/lib/tools.js` · แก้ไม่ครบ = 404 เฉพาะบางตัว
- **คีย์อยู่ใน `.env` เท่านั้น ไม่ใช่ `.env.example`** — เช็ค `grep sk-ant .env.example` ก่อน push
- **อย่าใช้ปุ่ม "link to a new repository" ของ Netlify** — มัน push แค่ผลลัพธ์ deploy 13 ไฟล์
  ขึ้น repo ใหม่ ไม่ใช่ซอร์สโค้ด · ต้อง "Link to a **different** repository"

## Session Log (3 ครั้งล่าสุด)
- 2026-08-07 (3): แก้บั๊ก COM7 → git init → สร้าง Netlify site → deploy production สำเร็จ
- 2026-08-08 (1): push ขึ้น GitHub (แก้ 2 บัญชี) → ผูก Netlify กับ repo → workflow ครบวงจร
- 2026-08-08 (2): เฟส 3 ถาม-ตอบ AI บน Edge + โควตา 30/วัน → cache ลด 2.81→1.40 บาท → `0e28b0f`
