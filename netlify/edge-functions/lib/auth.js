/**
 * ตรวจ session cookie ฝั่ง Edge (Deno)
 *
 * ต้องให้ผลตรงกับ `functions/_auth.js` ทุกประการ เพราะ cookie ใบเดียวกัน
 * ถูกออกโดยฝั่ง Node แล้วมาตรวจที่ฝั่งนี้ — อัลกอริทึมเดียวกัน (HMAC-SHA256,
 * เข้ารหัสผลลัพธ์เป็น base64url) แต่คนละ API: ที่นั่นใช้ node:crypto ที่นี่ใช้ Web Crypto
 *
 * ถ้าแก้วิธีเซ็นที่ไฟล์ใดไฟล์หนึ่ง ต้องแก้อีกไฟล์ให้ตรงกันเสมอ ไม่งั้น login ผ่าน
 * แต่ถามไม่ได้ — และอาการจะออกมาเป็น 401 ที่หาสาเหตุยาก
 */

export const COOKIE_NAME = 'x32_session';

/** แปลง ArrayBuffer เป็น base64url (ไม่มี padding) ให้ตรงกับ digest('base64url') ของ Node */
function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * เทียบสตริงแบบเวลาคงที่
 * เทียบความยาวก่อนแล้ว XOR ทุกตัวอักษรจนจบเสมอ ไม่หยุดกลางคัน
 * เพื่อไม่ให้เวลาที่ใช้บอกใบ้ว่าตรงกันถึงตัวที่เท่าไร
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sign(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/** อ่าน token จาก header Cookie */
export function tokenFromRequest(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

/** true เฉพาะเมื่อลายเซ็นถูกต้องและยังไม่หมดอายุ */
export async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, await sign(payload, secret))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}
