/**
 * POST /api/refresh — ดึงราคาล่าสุดของทั้ง universe มาแสดงทับราคาจากรอบ pipeline
 *
 * ทำไมต้องมี: pipeline รันวันละ 2 ครั้ง (หลังตลาดไทยและสหรัฐฯ ปิด) ราคาที่เห็น
 * ระหว่างวันจึงเป็นราคาปิดของรอบก่อน ปุ่มนี้ให้ผู้ใช้ดึงราคาสดมาดูได้เองเมื่อต้องการ
 *
 * **อัปเดตแค่ราคา ไม่แตะคะแนนหรืออันดับ** — คะแนนคัดกรองทุกระยะคำนวณจากราคาปิด
 * รายวันกับงบการเงิน ราคาที่วิ่งระหว่างวันไม่ได้เปลี่ยนว่าตัวไหนน่าลงทุน ถ้าจัดอันดับ
 * ใหม่ตามราคาสดจะได้อันดับที่แกว่งไปมาทั้งวันโดยไม่มีความหมายทางการวิเคราะห์
 *
 * ไม่กินโควตา AI เพราะไม่ได้เรียกโมเดลเลย และไม่ทำให้ Netlify ต้อง deploy ใหม่
 * (ข้อมูลส่งกลับเป็น JSON ตรงๆ ไม่เขียนไฟล์ลง repo) จึงไม่กินเครดิต deploy
 *
 * ที่มาของราคาเป็น endpoint ที่ไม่เป็นทางการของ Yahoo ตัวเดียวกับที่ yfinance
 * ใช้ใน pipeline — Plan.md รับความเสี่ยงข้อนี้ไว้แล้ว และถ้าล้มก็แค่คืน error
 * ให้หน้าเว็บแสดงราคาเดิมต่อไป ไม่มีอะไรพัง
 */

import { getStore } from '@netlify/blobs';

import { json, requireAuth } from './_auth.js';

// ต้องมี User-Agent ของเบราว์เซอร์ ไม่งั้น Yahoo ตอบ 401 ทุกครั้ง
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// cookie + crumb ใช้ซ้ำได้นาน — เก็บไว้ใน Blobs เพื่อข้าม 2 คำขอแรกในการกดครั้งถัดไป
// (การกดครั้งแรกใช้ ~760ms ครั้งถัดไปเหลือ ~250ms) · 6 ชั่วโมงเป็นค่าที่ปลอดภัย
// กว่าอายุจริงมาก ถ้าหมดอายุก่อนกำหนด โค้ดจะรู้เองจาก 401 แล้วขอใหม่
const SESSION_TTL_MS = 6 * 3600 * 1000;
const SESSION_KEY = 'yahoo-session';

/** ขอ cookie + crumb ชุดใหม่จาก Yahoo */
async function newSession() {
  const res = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const cookie = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('ขอ cookie จากแหล่งข้อมูลไม่สำเร็จ');

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 32) throw new Error('ขอ crumb จากแหล่งข้อมูลไม่สำเร็จ');

  return { cookie, crumb, at: Date.now() };
}

/**
 * ยิงขอราคา — ถ้า session หมดอายุจะขอใหม่แล้วลองซ้ำหนึ่งครั้ง
 * ที่ต้องลองซ้ำเพราะ crumb หมดอายุเมื่อไรไม่มีใครรับประกัน รู้ได้จาก 401 เท่านั้น
 */
async function fetchQuotes(symbols, store) {
  let session = null;
  try {
    // อ่านแบบ strong — Blobs อ่านแบบ eventual เป็นค่าเริ่มต้นแล้วได้ session เก่า
    // ที่เพิ่งถูกเขียนทับไป ทำให้ต้องเสียคำขอไปกับ crumb ที่ใช้ไม่ได้
    session = await store.get(SESSION_KEY, { type: 'json', consistency: 'strong' });
  } catch {
    session = null;   // อ่าน Blobs ไม่ได้ = แค่ขอ session ใหม่ ไม่ใช่เรื่องคอขาดบาดตาย
  }

  if (!session?.crumb || Date.now() - (session.at || 0) > SESSION_TTL_MS) {
    session = await newSession();
    await store.setJSON(SESSION_KEY, session).catch(() => {});
  }

  const url = (s) => 'https://query1.finance.yahoo.com/v7/finance/quote'
    + `?symbols=${encodeURIComponent(symbols.join(','))}&crumb=${encodeURIComponent(s.crumb)}`;

  const ask = (s) => fetch(url(s), { headers: { 'User-Agent': UA, cookie: s.cookie } });

  // ครั้งแรกอาจล้มได้สองแบบ: ตอบ 401/403 (crumb หมดอายุ) หรือ **โยน error**
  // (session ใน Blobs เสียจนใส่ลง header ไม่ได้ หรือเน็ตสะดุด) — ต้องรับทั้งสองแบบ
  // ไม่งั้น session เสียหนึ่งครั้งจะทำให้ปุ่มนี้ใช้ไม่ได้จนครบ TTL 6 ชั่วโมง
  let res = null;
  try {
    res = await ask(session);
  } catch {
    res = null;
  }

  if (!res || res.status === 401 || res.status === 403) {
    session = await newSession();
    await store.setJSON(SESSION_KEY, session).catch(() => {});
    res = await ask(session);
  }
  if (!res.ok) throw new Error(`แหล่งข้อมูลตอบ ${res.status}`);

  const body = await res.json();
  return body?.quoteResponse?.result || [];
}

// รับเฉพาะสัญลักษณ์รูปแบบที่ระบบเราใช้ — กันไม่ให้หน้าเว็บ (หรือใครก็ตามที่มี
// session) สั่งให้เซิร์ฟเวอร์ไปยิงอะไรก็ได้ที่ปลายทาง
const SYMBOL_PATTERN = /^[A-Za-z0-9.^=-]{1,15}$/;
const MAX_SYMBOLS = 200;

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'ต้องเรียกด้วยเมธอด POST' }, 405);
  }

  const denied = requireAuth(request);
  if (denied) return denied;

  let symbols;
  try {
    ({ symbols } = await request.json());
  } catch {
    return json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
  }

  symbols = (Array.isArray(symbols) ? symbols : [])
    .filter((s) => typeof s === 'string' && SYMBOL_PATTERN.test(s))
    .slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json({ error: 'ไม่มีสัญลักษณ์ที่ขอมา' }, 400);

  try {
    const rows = await fetchQuotes(symbols, getStore('market-session'));

    // ส่งกลับเฉพาะฟิลด์ที่หน้าเว็บใช้ — ทั้งชุดจาก Yahoo หนักกว่า 10 เท่า
    // โดยไม่ได้ใช้ และ bandwidth ของ Netlify คิดเป็นเครดิต
    const quotes = {};
    for (const q of rows) {
      if (!q?.symbol) continue;
      quotes[q.symbol] = {
        price: q.regularMarketPrice ?? null,
        change_pct: q.regularMarketChangePercent ?? null,
        // ความช้าของแต่ละตลาด (นาที) — ต้องบอกผู้ใช้ ไม่ใช่ปล่อยให้เข้าใจว่า
        // ทุกตัวเป็นราคาวินาทีนี้ · หุ้นไทยช้า 15 นาที ทองช้า 10 นาที
        delayed_by: q.exchangeDataDelayedBy ?? null,
        // ตลาดเปิดอยู่หรือปิดแล้ว — ถ้าปิด ราคานี้คือราคาปิด ไม่ใช่ราคาที่วิ่ง
        market_state: typeof q.marketState === 'string' ? q.marketState : null,
      };
    }

    return json({
      fetched_at: new Date().toISOString(),
      requested: symbols.length,
      returned: Object.keys(quotes).length,
      quotes,
    });
  } catch (err) {
    console.error('refresh ล้มเหลว:', err.message);
    // ล้มแล้วต้องบอกให้ชัดว่าราคาเดิมยังใช้ได้ ไม่ใช่ปล่อยให้ผู้ใช้คิดว่าเว็บพัง
    return json({ error: 'ดึงราคาล่าสุดไม่สำเร็จ กำลังแสดงราคาจากรอบอัปเดตล่าสุดต่อไป' }, 502);
  }
}
