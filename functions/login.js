/**
 * POST /api/login  { password }
 *
 * ตรวจรหัสผ่านกับ SITE_PASSWORD แล้วออก cookie ที่เซ็นด้วย HMAC
 * cookie เป็น HttpOnly — JavaScript ฝั่งหน้าเว็บอ่านไม่ได้ ลด XSS
 */

import { COOKIE_NAME, createToken, json, requireEnv, safeEqual } from './_auth.js';

// หน่วงเวลาเมื่อรหัสผิด เพื่อชะลอการยิงเดารหัสอัตโนมัติ
const WRONG_PASSWORD_DELAY_MS = 700;

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'ต้องเรียกด้วยเมธอด POST' }, 405);
  }

  try {
    requireEnv();
  } catch (err) {
    // ไม่ส่งรายละเอียด env ออกไปให้ผู้เรียก — log ไว้ฝั่งเซิร์ฟเวอร์พอ
    console.error('ตั้งค่าเซิร์ฟเวอร์ไม่ครบ:', err.message);
    return json({ error: 'ระบบยังตั้งค่าไม่สมบูรณ์ กรุณาติดต่อผู้ดูแล' }, 500);
  }

  let password = '';
  try {
    ({ password = '' } = await request.json());
  } catch {
    return json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
  }

  if (!password || !safeEqual(password, process.env.SITE_PASSWORD)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return json({ error: 'รหัสผ่านไม่ถูกต้อง' }, 401);
  }

  const cookie = [
    `${COOKIE_NAME}=${createToken()}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${12 * 3600}`,
  ].join('; ');

  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}
