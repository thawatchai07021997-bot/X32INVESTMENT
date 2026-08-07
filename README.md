# X32 — Investment Copilot

ระบบผู้ช่วยวิเคราะห์การลงทุนส่วนตัว คัดกรองหุ้นไทย หุ้นต่างประเทศ ETF และทองคำ
แยกตามระยะการลงทุน พร้อมอธิบายเหตุผลด้วยภาษาที่คนทั่วไปเข้าใจ

> **ระบบนี้จัดทำเพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน**
> ผลตอบแทนในอดีตไม่ได้รับประกันผลตอบแทนในอนาคต การลงทุนมีความเสี่ยง
> เว็บต้องมีรหัสผ่านเสมอ **ห้ามเปิดให้เข้าถึงแบบสาธารณะ** — การแนะนำการลงทุน
> ต่อสาธารณะในประเทศไทยต้องได้รับใบอนุญาตจาก ก.ล.ต.

---

## สถาปัตยกรรม

```
GitHub Actions (cron รายวัน)              Netlify
┌──────────────────────────┐             ┌────────────────────────┐
│ Python pipeline          │   commit    │ public/   (static)     │
│  ดึงข้อมูล → คำนวณ →     │  ─────────► │ functions/ (Node)      │
│  จัดอันดับ → JSON        │    push     │  login / data / chat   │
└──────────────────────────┘             └────────────────────────┘
                                              ↑ อ่าน data-private/
```

**ทำไมต้องแยก:** Netlify Functions รองรับแค่ JavaScript/TypeScript/Go ไม่รองรับ Python
จึงให้ Python รันบน GitHub Actions แล้วเขียนผลเป็น JSON ผลพลอยได้คือเว็บโหลดเร็ว
(อ่านไฟล์นิ่ง) และไม่เสียค่า AI ทุกครั้งที่มีคนเปิดเว็บ

**ข้อมูลเป็นส่วนตัวได้อย่างไร:** `data-private/` ไม่ได้อยู่ใน publish directory
(`netlify.toml` ตั้ง `publish = "public"`) จึงไม่มี URL สาธารณะ
ไฟล์ถูกส่งให้ Functions ผ่าน `included_files` และเข้าถึงได้ผ่าน `/api/data`
ที่ตรวจ session cookie ก่อนเท่านั้น — เปิด `/data-private/dashboard.json` ตรงๆ จะได้ 404

---

## โครงสร้างไฟล์

| ที่อยู่ | หน้าที่ |
|---|---|
| `pipeline/config.py` | universe, น้ำหนักปัจจัย, เกณฑ์คัดกรอง — **แก้ที่นี่ที่เดียว** |
| `pipeline/sources/` | ดึงข้อมูล: `stocks.py` (yfinance), `gold.py` (สมาคมค้าทองคำ) |
| `pipeline/quant/` | `indicators.py` เทคนิค · `factors.py` ปัจจัยพื้นฐาน · `screener.py` จัดอันดับ |
| `pipeline/main.py` | จุดรันทั้งหมด → เขียน `data-private/*.json` |
| `functions/` | Netlify Functions: `login.js`, `data.js`, `_auth.js` |
| `public/` | หน้าเว็บ (static, ไม่มี build step) |
| `.github/workflows/daily.yml` | cron รายวัน |

---

## ติดตั้งและรันในเครื่อง

```bash
cd C:/ProjectX/X32
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt pyarrow
```

รัน pipeline เพื่อสร้างข้อมูล:

```bash
.venv/Scripts/python pipeline/main.py
```

ตั้งค่า `.env` (คัดลอกจาก `.env.example`) แล้วเปิดเว็บในเครื่อง:

```bash
npm install
npx netlify dev --port 8888
```

---

## ขั้นตอน Deploy ครั้งแรก

1. **สร้าง GitHub repository แบบ Private** แล้ว push โค้ดขึ้นไป
   (แนะนำ private เพราะไฟล์ `data-private/` ถูก commit ไปด้วย)

2. **เชื่อม Netlify กับ repo** — Netlify จะอ่าน `netlify.toml` เองทั้งหมด
   ไม่ต้องตั้ง build command หรือ publish directory ด้วยมือ

3. **ตั้ง Environment Variables ที่ Netlify** (Site settings → Environment variables)

   | ตัวแปร | ค่า |
   |---|---|
   | `SITE_PASSWORD` | รหัสผ่านเข้าเว็บที่ตั้งเอง — ใช้ตัวยาวๆ |
   | `SESSION_SECRET` | สตริงสุ่มยาว 32 ตัวอักษรขึ้นไป ใช้เซ็น cookie |
   | `ANTHROPIC_API_KEY` | (เฟส 2) สำหรับ AI Agents |

4. **ตั้ง Secrets ที่ GitHub** (Settings → Secrets and variables → Actions)
   ใส่ `ANTHROPIC_API_KEY` เพื่อให้ cron รัน AI Agents ได้ (เฟส 2)

5. **ทดสอบ cron** — ไปที่แท็บ Actions แล้วกด "Run workflow" ด้วยมือหนึ่งครั้ง
   ต้องเห็น commit ข้อมูลใหม่เข้า repo และ Netlify deploy ตามอัตโนมัติ

> **ห้าม commit ไฟล์ `.env` เด็ดขาด** — อยู่ใน `.gitignore` แล้ว
> ค่าลับทั้งหมดต้องอยู่ที่ Netlify และ GitHub Secrets เท่านั้น

---

## วิธีให้คะแนน

**สองชั้น** — ชั้นคำนวณด้วย Python ล้วน (แม่นยำ ทำซ้ำได้ ไม่มีค่าใช้จ่าย)
และชั้นอธิบายด้วย AI (เฟส 2)

คะแนน 4 ปัจจัยคิดแบบ **เปรียบเทียบกันเองภายในกลุ่ม** (percentile) ไม่ใช่เกณฑ์ตายตัว
เพราะ P/E ที่ถือว่า "ถูก" ในตลาดไทยกับสหรัฐฯ ต่างกันมาก
กลุ่มที่มีสมาชิกน้อยกว่า 8 ตัวจะถูกยุบไปเทียบกับกลุ่มที่กว้างขึ้น
(กลุ่มที่มีสมาชิกตัวเดียวย่อมได้ที่ 1 เสมอ = 100 คะแนน ซึ่งไร้ความหมาย)

| ปัจจัย | ดูอะไร | ใช้กับ |
|---|---|---|
| ความถูกของราคา | P/E, P/BV, EV/EBITDA, FCF yield | หุ้น, ETF |
| คุณภาพกิจการ | ROE, อัตรากำไร, หนี้สินต่อทุน, การเติบโตรายได้ | หุ้น |
| โมเมนตัมราคา | ผลตอบแทน 3/6/12 เดือน | ทุกประเภท |
| ปันผล | อัตราปันผล, ความยั่งยืนของการจ่าย | หุ้น, ETF |

ทองคำได้เฉพาะคะแนนโมเมนตัม เพราะไม่มีงบการเงินและไม่จ่ายปันผล

`confidence` ที่แสดงบนเว็บบอกว่าคะแนนนั้นคำนวณจากข้อมูลกี่เปอร์เซ็นต์ของที่ควรมีครบ

---

## สถานะการพัฒนา

- ✅ **เฟส 1** — pipeline, Dashboard, หน้ารายตัว, หน้าคัดกรอง, กราฟ, ระบบรหัสผ่าน, cron
- ⬜ **เฟส 2** — AI Agents วิเคราะห์และอธิบายเหตุผลรายตัว
- ⬜ **เฟส 3** — ถาม-ตอบ AI, ข่าว, backtest, กองทุนรวมไทย (SEC Open API)

ดู `Plan.md` (เป้าหมายและขอบเขต) และ `Saved.md` (สถานะล่าสุด) ประกอบ
