# Saved — X32
> Session ล่าสุด: 2026-08-08

## สถานะปัจจุบัน
**เฟส 1 + เฟส 2 ใช้งานจริงบน production แล้ว · ผู้ใช้ login เข้าใช้ได้ยืนยันแล้ว**
เว็บ: https://x32-investment-copilot.netlify.app (site id `63e8f519-f2be-4f7d-82a9-ebf3839a8d03`)
ตรวจผ่าน: `/data-private/*` → 404 · `/api/data` ไม่มี cookie → 401 · `included_files` ทำงานถูก
git repo local: commit แรก `481b73c` (185 ไฟล์, branch `main`) — **ยังไม่มี remote**
pipeline 146 สินทรัพย์ ~13 วินาที (ไม่มี AI) / ~5.5 นาที (มี AI 10 ตัว)
Dashboard กรอง 3 ชั้น (กลุ่ม × อุตสาหกรรม × ระยะ) · หน้ารายตัวมีเหตุผลจาก AI ครบ 4 ระยะ
ต้นทุนจริงที่วัดได้ 6.92 บาท/รอบ ≈ 30 บาท/เดือน (รันสัปดาห์ละครั้ง)

## ทำต่อจากตรงนี้ (นัดทำต่อ 2026-08-08)
1. **GitHub repo (private)** — งานถัดไปที่ตกลงกันไว้ · เครื่องไม่มี `gh` CLI ต้องสร้างผ่าน
   เว็บ github.com ก่อน (ผู้ใช้ทำ) แล้วผมต่อให้: `git remote add origin <url>` →
   `git push -u origin main` · จากนั้นใส่ `ANTHROPIC_API_KEY` ใน repo Settings → Secrets
   → Actions · ครบแล้ว `.github/workflows/daily.yml` จะอัปเดตข้อมูลเองวันละ 2 รอบ
2. **deploy ใหม่หลังแก้โค้ด:** `cd /c/ProjectX/X32 && npx netlify deploy --prod` (link ไว้แล้ว)
3. **เฟส 3:** `functions/chat.js` + `chat.html`, News Agent (RSS), backtest, กองทุนไทย

## ติดปัญหา / Blockers
- ~~คีย์เก่าที่เคยส่งผ่านแชท~~ **revoke แล้ว (ผู้ใช้ยืนยัน 2026-08-07)** — คีย์ใน `.env`
  เป็นตัวใหม่ · ตรวจแล้วมีเฉพาะ `.env` ที่มีคีย์ และ `.gitignore` ครอบคลุมอยู่
- ยังไม่มี GitHub repo → ข้อมูลยังไม่อัปเดตอัตโนมัติ ต้องรัน pipeline เองแล้ว `netlify deploy --prod`
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

## Session Log (เก็บ 3 ครั้งล่าสุด)
- 2026-08-07 (1): กำหนดวัตถุประสงค์ → ออกแบบสถาปัตยกรรม → สร้าง pipeline + เว็บครบเฟส 1
- 2026-08-07 (2): ตัวกรองกลุ่ม + อุตสาหกรรมใน Dashboard, พื้นปันผลขั้นต่ำ 1.5%,
  เฟส 2 ครบและทดสอบ API จริงผ่าน 10/10 ตัว, เพิ่มรายงานต้นทุนท้ายการรัน
- 2026-08-07 (3): แก้บั๊กชื่อไฟล์ COM7 → git init + commit แรก `481b73c` →
  สร้าง Netlify site → deploy production สำเร็จ ผู้ใช้ใช้งานเว็บได้จริงแล้ว
