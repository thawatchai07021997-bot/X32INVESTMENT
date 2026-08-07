/**
 * ตัวช่วยด้านการยืนยันตัวตน ใช้ร่วมกันทุก function
 *
 * แนวคิด: ไม่มีฐานข้อมูลผู้ใช้ — มีรหัสผ่านเดียวเก็บใน environment variable
 * เมื่อใส่รหัสถูก จะได้ cookie ที่เซ็นด้วย HMAC พร้อมเวลาหมดอายุ
 * cookie ปลอมไม่ได้เพราะไม่รู้ SESSION_SECRET
 */

import crypto from 'node:crypto';

export const COOKIE_NAME = 'x32_session';
const SESSION_HOURS = 12;

/** ตรวจว่า env var ที่จำเป็นถูกตั้งครบหรือยัง */
export function requireEnv() {
  const missing = ['SITE_PASSWORD', 'SESSION_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`ยังไม่ได้ตั้งค่า environment variable: ${missing.join(', ')}`);
  }
}

/**
 * เปรียบเทียบสตริงแบบใช้เวลาคงที่ (timing-safe)
 * ป้องกันการเดารหัสทีละตัวอักษรจากการวัดเวลาตอบสนอง
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual ต้องการ buffer ยาวเท่ากัน จึง hash ก่อนเพื่อให้ยาวเท่ากันเสมอ
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function sign(payload) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
}

/** สร้าง token ที่มีเวลาหมดอายุฝังอยู่และเซ็นกำกับ */
export function createToken() {
  const expiresAt = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

/** ตรวจ token — คืน true เฉพาะเมื่อลายเซ็นถูกต้องและยังไม่หมดอายุ */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/** อ่าน session token จาก header Cookie */
export function tokenFromRequest(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

/** ตรวจสิทธิ์เข้าถึง — คืน Response 401 ถ้าไม่ผ่าน, คืน null ถ้าผ่าน */
export function requireAuth(request) {
  if (verifyToken(tokenFromRequest(request))) return null;
  return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401);
}

/** สร้าง Response แบบ JSON ที่ห้าม cache (ข้อมูลเป็นส่วนตัว) */
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
