/**
 * GET  /api/quota — อ่านยอดใช้วันนี้ (ไม่นับเพิ่ม)
 * POST /api/quota — จองสิทธิ์ถามหนึ่งครั้ง แล้วคืนยอดล่าสุด
 *
 * ทำไมต้องแยกเป็น Function ไม่รวมไว้ใน Edge Function:
 * Netlify Blobs เป็นแพ็กเกจ npm ซึ่งใน Edge Functions ยังเป็น beta
 * ส่วนใน Functions (Node) เป็นของที่รองรับเต็มรูปแบบแล้ว จึงวางตัวนับไว้ฝั่งนี้
 *
 * โควตารีเซ็ตตามวันที่ไทย ไม่ใช่แบบ 24 ชั่วโมงย้อนหลัง —
 * ผู้ใช้คาดเดาได้ง่ายกว่าว่า "พรุ่งนี้เช้าถามได้ใหม่"
 */

import { getStore } from '@netlify/blobs';

import { json, requireAuth } from './_auth.js';

const DAILY_LIMIT = 30;

/** วันที่ปัจจุบันตามเวลาไทย รูปแบบ YYYY-MM-DD — ใช้เป็น key ของ blob */
function thaiDateKey() {
  // en-CA ให้รูปแบบ YYYY-MM-DD พอดี ไม่ต้องประกอบสตริงเอง
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

/** เวลาที่โควตาจะรีเซ็ต = เที่ยงคืนถัดไปตามเวลาไทย (ส่งเป็น ISO ให้หน้าเว็บแสดงผลเอง) */
function nextResetISO() {
  const now = new Date();
  const thaiNow = new Date(now.getTime() + 7 * 3600 * 1000);
  thaiNow.setUTCHours(0, 0, 0, 0);
  thaiNow.setUTCDate(thaiNow.getUTCDate() + 1);
  return new Date(thaiNow.getTime() - 7 * 3600 * 1000).toISOString();
}

export default async function handler(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const store = getStore('chat-quota');
  const key = thaiDateKey();

  let used = 0;
  try {
    // ต้องอ่านแบบ strong — ค่าเริ่มต้นของ Blobs คือ eventual ซึ่งอ่านค่าที่เพิ่ง
    // เขียนไปไม่ทัน · ทดสอบจริง: ยิงถาม AI 4 ครั้งแบบเรียงต่อกัน (ไม่ใช่พร้อมกัน)
    // ตัวนับขึ้นแค่ 3 เพราะครั้งที่ 4 อ่านเจอค่าก่อนครั้งที่ 3 · แปลว่าเพดาน 30
    // ครั้ง/วันที่ใช้คุมค่าใช้จ่ายรั่วได้จริงแม้ใช้งานคนเดียวทีละคำถาม
    used = Number(await store.get(key, { consistency: 'strong' })) || 0;
  } catch (err) {
    // อ่าน blob ไม่ได้ = ระบบนับพัง ไม่ใช่ผู้ใช้ใช้เกิน — ปล่อยให้ถามต่อได้
    // แต่ต้อง log ไว้ ไม่งั้นโควตาจะพังเงียบๆ แล้วไม่มีใครรู้
    console.error('อ่านโควตาไม่สำเร็จ:', err.message);
    return json({ allowed: true, used: 0, limit: DAILY_LIMIT, resets_at: nextResetISO(), degraded: true });
  }

  if (request.method === 'GET') {
    return json({ allowed: used < DAILY_LIMIT, used, limit: DAILY_LIMIT, resets_at: nextResetISO() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'ต้องเรียกด้วยเมธอด GET หรือ POST' }, 405);
  }

  if (used >= DAILY_LIMIT) {
    return json(
      { allowed: false, used, limit: DAILY_LIMIT, resets_at: nextResetISO(),
        error: `ใช้ครบ ${DAILY_LIMIT} คำถามของวันนี้แล้ว` },
      429,
    );
  }

  const next = used + 1;
  // Blobs ไม่มี increment แบบ atomic และเวอร์ชัน 8.2.0 ไม่มี conditional write
  // (SetOptions มีแต่ metadata) — ถ้ายิง "พร้อมกัน" จริงๆ หลายแท็บ ยอดยังนับตกได้
  // ยอมรับได้เพราะเว็บนี้มีผู้ใช้คนเดียว และการนับตกทำให้ "ถามได้มากกว่า" ไม่ใช่ "ถูกบล็อกผิด"
  // ส่วนกรณีถามเรียงต่อกันทีละคำถามซึ่งเกิดจริงทุกวัน แก้แล้วด้วย consistency: 'strong' ข้างบน
  await store.set(key, String(next));

  return json({ allowed: true, used: next, limit: DAILY_LIMIT, resets_at: nextResetISO() });
}
